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
#  VBV / 3DS Lookup
# ============================================================
def vbv_lookup(cc_line):
    """Real VBV/3DS check via VoidAPI."""
    parts = cc_line.split('|')
    if not parts:
        return "Error | Invalid input"
    num = parts[0].strip()
    if not num or len(num) < 13:
        return "Error | Invalid card number"

    brand = get_card_brand(num)
    cc = num
    mm = parts[1].strip() if len(parts) > 1 else "01"
    yy = parts[2].strip() if len(parts) > 2 else "30"
    cvv = parts[3].strip() if len(parts) > 3 else "123"

    VOIDAPI_KEY = "VDX-SHA2X-NZ0RS-O7HAM"
    LIVE_STATUSES = [
        "authenticate_successful", "authenticate_attempt_successful",
        "authentication_successful", "authentication_attempt_successful",
        "three_d_secure_passed", "three_d_secure_authenticated",
        "three_d_secure_attempted", "liability_shifted",
        "liability_shift_possible", "frictionless_flow", "challenge_not_required",
    ]

    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        headers = {
            "Accept": "*/*",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
            "Cache-Control": "no-cache",
        }
        url = f"https://api.voidapi.xyz/v2/vbv??key={VOIDAPI_KEY}&card={cc}|{mm}|{yy}|{cvv}"

        for attempt in range(3):
            try:
                r = requests.get(url, headers=headers, timeout=35, verify=False)
                text = r.text.strip()
                if "524: A timeout occurred" in text:
                    if attempt < 2:
                        import time
                        time.sleep(5)
                        continue
                    return f"{brand.upper()} | ⚠️ API Timeout | BIN: {num[:6]}"

                def _gstr(src, a, b):
                    try:
                        return src.split(a, 1)[1].split(b, 1)[0]
                    except Exception:
                        return ""

                status = _gstr(text, 'status":"', '"') or "Card type not support."

                if status in LIVE_STATUSES:
                    return f"{brand.upper()} | ✅ Non-VBV / Non-3DS | {status} | BIN: {num[:6]}"
                else:
                    return f"{brand.upper()} | 🔒 VBV/3DS Enrolled | {status} | BIN: {num[:6]}"

            except Exception:
                if attempt < 2:
                    import time
                    time.sleep(1)
                    continue
                return f"{brand.upper()} | ⚠️ Check Failed | BIN: {num[:6]}"

    except Exception as e:
        return f"{brand.upper()} | Error: {str(e)[:40]} | BIN: {num[:6]}"


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
