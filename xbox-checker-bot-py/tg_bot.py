# ============================================================
#  Telegram Bot — DLX Data Processing Interface
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
from auth_stripe_checker import check_card as auth_check_card, probe_site as auth_probe_site
from braintree_auth_checker import check_card as b3auth_check_card, probe_site as b3auth_probe_site
from authnet_checker import check_card as authnet_check_card, probe_site as authnet_probe_site
from br3_charge_checker import check_card as br3charge_check_card, probe_site as br3charge_probe_site
from auto_stripe_checker import check_card as autostripe_check_card, probe_site as autostripe_probe_site
from shopify_gql_checker import check_card as shopifygql_check_card
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
    "b3auth": {"name": "Braintree Auth", "cmd": "/chkapib3auth"},
    "b3charge": {"name": "Braintree $1 Charge", "cmd": "/chkapib3charge"},
    "authnet": {"name": "Authorize.net", "cmd": "/chkapiauthnet"},
    "autostripe": {"name": "Auto Stripe (WooCommerce)", "cmd": "/chkapiautostripe"},
    "shopifygql": {"name": "Shopify GQL", "cmd": "/chkapishopifygql"},
}


def probe_gate(gate_key):
    start = time.time()
    try:
        if gate_key == "auth":
            alive, detail = auth_probe_site()
        elif gate_key == "b3auth":
            alive, detail = b3auth_probe_site()
        elif gate_key == "b3charge":
            alive, detail = br3charge_probe_site()
        elif gate_key == "authnet":
            alive, detail = authnet_probe_site()
        elif gate_key == "autostripe":
            alive, detail = autostripe_probe_site()
        elif gate_key == "shopifygql":
            sites = load_shopify_sites()
            if sites:
                alive = True
                detail = f"{len(sites)} sites loaded"
            else:
                alive = False
                detail = "No sites in sites.txt"
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
#  Shopify sites loader
# ============================================================
def load_shopify_sites():
    if not os.path.exists(SITES_FILE):
        return []
    with open(SITES_FILE, 'r') as f:
        return [line.strip() for line in f if line.strip() and not line.strip().startswith('#')]


# ============================================================
#  Gate runner
# ============================================================
def _run_gate(gate, c_num, c_mm, c_yy, c_cvv, proxy_dict):
    cc_line = f"{c_num}|{c_mm}|{c_yy}|{c_cvv}"
    if gate == "auth":
        return auth_check_card(cc_line, proxy_dict)
    elif gate == "b3auth":
        return b3auth_check_card(cc_line, proxy_dict)
    elif gate == "b3charge":
        return br3charge_check_card(cc_line, proxy_dict)
    elif gate == "authnet":
        return authnet_check_card(cc_line, proxy_dict)
    elif gate == "autostripe":
        return autostripe_check_card(cc_line, proxy_dict)
    elif gate == "shopifygql":
        return shopifygql_check_card(cc_line, proxy_dict)
    else:
        return auth_check_card(cc_line, proxy_dict)


def process_single_entry(entry, proxies_list, user_id, gate="auth"):
    raw_proxy = random.choice(proxies_list) if proxies_list else None
    proxy_dict = format_proxy(raw_proxy)

    try:
        c_data = entry.split('|')
        if len(c_data) == 4:
            c_num, c_mm, c_yy, c_cvv = c_data

            user_bin_list = user_bins.get(user_id)
            if user_bin_list:
                if not any(c_num.startswith(b) for b in user_bin_list):
                    return "SKIPPED | BIN not allowed"

            try:
                result = _run_gate(gate, c_num, c_mm, c_yy, c_cvv, proxy_dict)
            except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
                if proxy_dict:
                    try:
                        result = _run_gate(gate, c_num, c_mm, c_yy, c_cvv, None)
                    except Exception as e2:
                        result = f"Error: {str(e2)}"
                else:
                    result = f"Error: connection failed"

            if proxy_dict and ("ProxyError" in result or "Tunnel connection failed" in result or "503 Service Unavailable" in result):
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
#  Processing runner
# ============================================================
DEFAULT_THREADS = 5


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
#  Message formatters (NO separators)
# ============================================================

def fmt_start(username, user_id):
    """Clean welcome message with banner."""
    name = f"@{username}" if username else f"User"
    return (
        f"⚡ <b>DLX Engine</b>\n\n"
        f"Welcome, <b>{name}</b>\n"
        f"Your ID: <code>{user_id}</code>\n\n"
        f"Use /help to see all available commands and get started."
    )


def fmt_unauthorized():
    return (
        "🔒 <b>Access Denied</b>\n\n"
        "You need to redeem a key first.\n"
        "Use: <code>/redeem YOUR-KEY</code>"
    )


def fmt_live(idx, total, results, start_time, entry="", status_text="", done=False):
    title = "✅ Engine Complete" if done else "⚡ Engine Active"
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
        f"📦 Loaded: <code>{total}</code>\n"
        f"📊 Progress: <code>{idx}/{total}</code>\n"
        f"⚡ Speed: <code>{cpm} CPM</code>\n"
        f"⏳ ETA: <code>{eta}s</code>\n\n"
        f"🔍 Current:\n<code>{entry}</code>\n\n"
        f"📋 Status: {status_text}\n\n"
        f"✅ Valid: <code>{results['approved']}</code>\n"
        f"❌ Dead: <code>{results['declined']}</code>\n"
        f"⏭️ Skipped: <code>{results['skipped']}</code>\n"
        f"⚠️ Issues: <code>{results['errors']}</code>"
    )


def fmt_results(results):
    return (
        "📊 <b>Session Complete</b>\n\n"
        f"Total: <code>{results['total']}</code>\n"
        f"✅ Approved: <code>{results['approved']}</code>\n"
        f"❌ Declined: <code>{results['declined']}</code>\n"
        f"⏭️ Skipped: <code>{results['skipped']}</code>\n"
        f"⚠️ Errors: <code>{results['errors']}</code>"
    )


def fmt_stats(user_id):
    stats = load_stats()
    uid = str(user_id)
    s = stats.get(uid)
    if not s:
        return "📊 <b>No Stats</b>\n\nYou haven't run any sessions yet."
    return (
        "📊 <b>Your Lifetime Stats</b>\n\n"
        f"Sessions: <code>{s.get('sessions', 0)}</code>\n"
        f"Total Processed: <code>{s.get('total', 0)}</code>\n"
        f"✅ Approved: <code>{s.get('approved', 0)}</code>\n"
        f"❌ Declined: <code>{s.get('declined', 0)}</code>\n"
        f"⏭️ Skipped: <code>{s.get('skipped', 0)}</code>\n"
        f"⚠️ Errors: <code>{s.get('errors', 0)}</code>"
    )


def fmt_mykey(user_id):
    users = load_users()
    entry = users.get(str(user_id))
    if not entry:
        return "🔑 <b>No Key</b>\n\nYou haven't redeemed a key."
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
        "🔑 <b>Your Key Info</b>\n\n"
        f"Key: <code>{key}</code>\n"
        f"Redeemed: <code>{redeemed}</code>\n"
        f"Expires: <code>{exp_text}</code>\n"
        f"Line Limit: <code>{limit_text}</code>"
    )


# ============================================================
#  Inline keyboard helpers
# ============================================================
def stop_button_markup(user_id):
    return {
        "inline_keyboard": [[
            {"text": "🛑 Stop", "callback_data": f"stop_{user_id}"}
        ]]
    }


def help_main_markup():
    """Main /help menu with category buttons."""
    return {
        "inline_keyboard": [
            [
                {"text": "🔒 Gates", "callback_data": "help_gates"},
                {"text": "🔧 Tools", "callback_data": "help_tools"},
            ],
            [
                {"text": "⚙️ Commands", "callback_data": "help_commands"},
                {"text": "📖 How to Use", "callback_data": "help_howto"},
            ],
            [
                {"text": "👑 Admin", "callback_data": "help_admin"},
            ],
        ]
    }


def help_back_markup():
    return {
        "inline_keyboard": [[
            {"text": "◀️ Back", "callback_data": "help_back"},
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
    ("b3auth", "/b3auth", "Braintree Auth", True),
    ("b3charge", "/b3charge", "Braintree $1 Charge", True),
    ("authnet", "/authnet", "Authorize.net", True),
    ("autostripe", "/autostripe", "Auto Stripe (WooCommerce)", True),
    ("shopifygql", "/shopifygql", "Shopify GQL", True),
]

GATE_MAP = {
    "/auth": ("auth", "Stripe Auth"),
    "/b3auth": ("b3auth", "Braintree Auth"),
    "/b3charge": ("b3charge", "Braintree $1 Charge"),
    "/authnet": ("authnet", "Authorize.net"),
    "/autostripe": ("autostripe", "Auto Stripe (WooCommerce)"),
    "/shopifygql": ("shopifygql", "Shopify GQL"),
}

CHKAPI_CMDS = {
    "/chkapiauth": "auth",
    "/chkapib3auth": "b3auth",
    "/chkapib3charge": "b3charge",
    "/chkapiauthnet": "authnet",
    "/chkapiautostripe": "autostripe",
    "/chkapishopifygql": "shopifygql",
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
        answer_callback(cb_id, f"🔴 {gate_name} disabled!")
        if chat_id and msg_id:
            edit_message(chat_id, msg_id,
                f"🔴 <b>{gate_name} — DISABLED</b>\n\n"
                f"Gate has been turned off. Users cannot use it.\n"
                f"Use the check command again to re-enable.")
        return

    if data.startswith("gate_on_"):
        if not is_admin(cb_user_id):
            answer_callback(cb_id, "Admin only.")
            return
        gate_key = data.replace("gate_on_", "")
        set_gate_enabled(gate_key, True, by_user=cb_user_id)
        gate_name = GATE_PROBE_MAP.get(gate_key, {}).get("name", gate_key)
        answer_callback(cb_id, f"🟢 {gate_name} enabled!")
        if chat_id and msg_id:
            edit_message(chat_id, msg_id,
                f"🟢 <b>{gate_name} — ENABLED</b>\n\n"
                f"Gate is back online for all users.")
        return

    if data == "gate_keep":
        answer_callback(cb_id, "No changes made.")
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, "✅ <b>No changes made.</b>")
        return

    # Help menu navigation
    if data == "help_gates":
        answer_callback(cb_id)
        txt = (
            "🔒 <b>Available Gates</b>\n\n"
            "<code>/auth</code>  ·  Stripe Auth\n"
            "<code>/b3auth</code>  ·  Braintree Auth\n"
            "<code>/b3charge</code>  ·  Braintree $1 Charge\n"
            "<code>/authnet</code>  ·  Authorize.net\n"
            "<code>/autostripe</code>  ·  Auto Stripe (WooCommerce)\n"
            "<code>/shopifygql</code>  ·  Shopify GQL"
        )
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, txt, reply_markup=help_back_markup())
        return

    if data == "help_tools":
        answer_callback(cb_id)
        txt = (
            "🔧 <b>Tools</b>\n\n"
            "<code>/gen 424242 10</code>  ·  Generate cards from BIN\n"
            "<code>/binlookup 424242</code>  ·  BIN info lookup\n"
            "<code>/vbv 4111...</code>  ·  VBV/3DS check\n"
            "<code>/analyze https://...</code>  ·  Detect payment provider"
        )
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, txt, reply_markup=help_back_markup())
        return

    if data == "help_commands":
        answer_callback(cb_id)
        txt = (
            "⚙️ <b>Commands</b>\n\n"
            "<code>/bin 424242</code>  ·  Set BIN filter\n"
            "<code>/clearbin</code>  ·  Clear BIN filter\n"
            "<code>/cancel</code>  ·  Stop active task\n"
            "<code>/gates</code>  ·  List all gates + hit rates\n"
            "<code>/stats</code>  ·  Your lifetime stats\n"
            "<code>/mykey</code>  ·  Check your key info\n"
            "<code>/redeem KEY</code>  ·  Redeem access key"
        )
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, txt, reply_markup=help_back_markup())
        return

    if data == "help_howto":
        answer_callback(cb_id)
        txt = (
            "📖 <b>How to Use</b>\n\n"
            "<b>Single card:</b>\n"
            "<code>/auth 4111111111111111|01|25|123</code>\n\n"
            "<b>Bulk check:</b>\n"
            "1. Send a <code>.txt</code> file with cards\n"
            "2. Reply to it with the gate command\n\n"
            "<b>Generate cards:</b>\n"
            "<code>/gen 424242 10</code>\n\n"
            "<b>BIN lookup:</b>\n"
            "<code>/binlookup 424242</code>"
        )
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, txt, reply_markup=help_back_markup())
        return

    if data == "help_admin":
        answer_callback(cb_id)
        if not is_admin(cb_user_id):
            txt = "🔒 <b>Admin section is restricted.</b>"
        else:
            txt = (
                "👑 <b>Admin Commands</b>\n\n"
                "<code>/genkey</code>  ·  Generate single key\n"
                "<code>/genkeys 10</code>  ·  Bulk generate keys\n"
                "<code>/adminkey ID 7d</code>  ·  Promote to admin\n"
                "<code>/adminlist</code>  ·  List all admins\n"
                "<code>/authlist</code>  ·  List authorized users\n"
                "<code>/revoke ID</code>  ·  Revoke user access\n"
                "<code>/broadcast msg</code>  ·  Message all users\n"
                "<code>/scrapeproxies</code>  ·  Scrape fresh proxies\n"
                "<code>/chkapis</code>  ·  Health check all APIs"
            )
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, txt, reply_markup=help_back_markup())
        return

    if data == "help_back":
        answer_callback(cb_id)
        txt = (
            "📚 <b>Help Center</b>\n\n"
            "Choose a category below to explore commands and features."
        )
        if chat_id and msg_id:
            edit_message(chat_id, msg_id, txt, reply_markup=help_main_markup())
        return

    # Unknown callback
    answer_callback(cb_id, "Unknown action.")


# ============================================================
#  Command handler
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
    text = (msg.get("text") or "").strip()

    if not text:
        return

    # --- /start ---
    if text == "/start":
        send_message(chat_id, fmt_start(username, user_id))
        return

    # --- /help ---
    if text == "/help":
        txt = (
            "📚 <b>Help Center</b>\n\n"
            "Choose a category below to explore commands and features."
        )
        send_message(chat_id, txt, reply_markup=help_main_markup())
        return

    # --- /bin ---
    if text.startswith("/bin") and not text.startswith("/binlookup"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> <code>/bin 424242,555555</code>")
            return
        bins = parts[1].replace(" ", "").split(",")
        user_bins[user_id] = bins
        send_message(chat_id, f"✅ <b>BIN filter set:</b> <code>{', '.join(bins)}</code>")
        return

    # --- /clearbin ---
    if text == "/clearbin":
        if user_id in user_bins:
            del user_bins[user_id]
            send_message(chat_id, "✅ <b>BIN filter cleared.</b>")
        else:
            send_message(chat_id, "ℹ️ <b>No BIN filter active.</b>")
        return

    # --- /cancel ---
    if text == "/cancel":
        if user_id in active_users:
            cancel_flags[user_id] = True
            send_message(chat_id, "🛑 <b>Stopping your task...</b>")
        else:
            send_message(chat_id, "ℹ️ <b>No active task.</b>")
        return

    # --- /gen ---
    if text.startswith("/gen") and text.split()[0] == "/gen":
        if not is_authorized(user_id):
            send_message(chat_id, fmt_unauthorized())
            return
        parts = text.split()
        if len(parts) < 2:
            send_message(chat_id,
                "🎴 <b>Card Generator</b>\n\n"
                "<b>Usage:</b> <code>/gen 424242 10</code>\n"
                "Use <code>x</code> for random digits")
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
            send_message(chat_id, "❌ <b>Invalid BIN.</b>")
            return
        card_text = "\n".join(f"<code>{c}</code>" for c in cards)
        send_message(chat_id,
            f"🎴 <b>Generated {len(cards)} Cards</b>\n\n"
            f"BIN: <code>{bin_input}</code>\n\n"
            f"{card_text}")
        return

    # --- /binlookup ---
    if text.startswith("/binlookup"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> <code>/binlookup 424242</code>")
            return
        bin_num = parts[1].strip().split('|')[0][:6]
        info, err = bin_lookup(bin_num)
        if info:
            send_message(chat_id,
                f"🔍 <b>BIN Lookup — {bin_num}</b>\n\n"
                f"Brand: <code>{info['brand']}</code>\n"
                f"Type: <code>{info['type']}</code>\n"
                f"Bank: <code>{info['bank']}</code>\n"
                f"Country: <code>{info['country']}</code> {info['emoji']}")
        else:
            send_message(chat_id, f"❌ <b>BIN Lookup Failed</b>\n\n{err}")
        return

    # --- /vbv ---
    if text.startswith("/vbv"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> <code>/vbv 4111111111111111</code>")
            return
        result = vbv_lookup(parts[1].strip())
        send_message(chat_id, f"🔒 <b>VBV/3DS Check</b>\n\n{result}")
        return

    # --- /analyze ---
    if text.startswith("/analyze"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> <code>/analyze https://example.com</code>")
            return
        if not is_authorized(user_id):
            send_message(chat_id, fmt_unauthorized())
            return
        url = parts[1].strip()
        send_message(chat_id, f"🔍 <b>Analyzing...</b>\n<code>{url[:60]}</code>")

        def _do_analyze():
            info = analyze_url(url)
            provider = info.get('provider', 'unknown')
            merchant = info.get('merchant', 'Unknown')
            product = info.get('product', '-')
            amount = info.get('amount', '-')
            currency = info.get('currency', 'USD')
            stripe_key = info.get('stripe_key', '-')
            error = info.get('error')
            lines_out = [
                f"🌐 <b>URL Analysis</b>\n",
                f"URL: <code>{url[:80]}</code>",
                f"Provider: <code>{provider.upper()}</code>",
                f"Merchant: <code>{merchant}</code>",
            ]
            if product and product != '-':
                lines_out.append(f"Product: <code>{product}</code>")
            if amount:
                lines_out.append(f"Amount: <code>{amount} {currency}</code>")
            if stripe_key and stripe_key != '-':
                lines_out.append(f"Stripe Key: <code>{stripe_key[:20]}...</code>")
            if error:
                lines_out.append(f"⚠️ Error: {error}")
            send_message(chat_id, "\n".join(lines_out))

        threading.Thread(target=_do_analyze, daemon=True).start()
        return

    # --- /scrapeproxies (admin) ---
    if text == "/scrapeproxies":
        if not is_admin(user_id):
            return
        send_message(chat_id, "🔄 <b>Scraping proxies...</b>")

        def _do_scrape():
            proxies = scrape_proxies()
            if proxies:
                with open(PROXIES_FILE, 'w') as f:
                    f.write('\n'.join(proxies))
                load_global_proxies()
                send_message(chat_id,
                    f"✅ <b>Scraped {len(proxies)} Proxies</b>\n\n"
                    f"Active proxies: <code>{get_proxy_count()}</code>")
            else:
                send_message(chat_id, "❌ <b>Failed to scrape proxies.</b>")

        threading.Thread(target=_do_scrape, daemon=True).start()
        return

    # --- /adminkey ---
    if text.startswith("/adminkey"):
        if int(user_id) not in ADMIN_IDS:
            send_message(chat_id, "🔒 <b>Owner only.</b>")
            return
        parts = text.split()
        if len(parts) < 2:
            send_message(chat_id,
                "<b>Usage:</b> <code>/adminkey 123456789 7d</code>\n"
                "Duration optional (default: permanent).")
            return
        target_id = parts[1].strip()
        if not target_id.isdigit():
            send_message(chat_id, "❌ <b>Invalid user ID.</b>")
            return
        duration_seconds = None
        if len(parts) >= 3:
            parsed = parse_duration(parts[2])
            if parsed == -1:
                send_message(chat_id, "❌ <b>Invalid duration.</b>\nExamples: 7d, 1mo, perm")
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
            f"👑 <b>Admin Granted</b>\n\n"
            f"User: <code>{target_id}</code>\n"
            f"Duration: <code>{dur_label}</code>")
        return

    # --- /adminlist ---
    if text == "/adminlist":
        if int(user_id) not in ADMIN_IDS:
            send_message(chat_id, "🔒 <b>Owner only.</b>")
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
            f"👑 <b>Admins ({len(lines_out)})</b>\n\n"
            "<code>" + "\n".join(lines_out) + "</code>")
        return

    # --- /chkapi* ---
    if text in CHKAPI_CMDS:
        if not is_admin(user_id):
            return
        gate_key = CHKAPI_CMDS[text]
        gate_info = GATE_PROBE_MAP.get(gate_key, {})
        gate_name = gate_info.get("name", gate_key)
        currently_enabled = is_gate_enabled(gate_key)

        send_message(chat_id, f"🔍 <b>Probing {gate_name}...</b>")
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
                action_text = "Gate is disabled. Re-enable?"
                buttons = {"inline_keyboard": [[
                    {"text": "🟢 Re-enable", "callback_data": f"gate_on_{gate_key}"},
                    {"text": "❌ Keep off", "callback_data": "gate_keep"},
                ]]}

        enabled_label = "🟢 Enabled" if currently_enabled else "🔴 Disabled"
        send_message(chat_id,
            f"🛡️ <b>API Check — {gate_name}</b>\n\n"
            f"Status: {status_line}\n"
            f"Detail: <code>{detail}</code>\n"
            f"Latency: <code>{latency}ms</code>\n"
            f"Currently: {enabled_label}\n\n"
            f"{action_text}",
            reply_markup=buttons)
        return

    # --- /chkapis ---
    if text == "/chkapis":
        if not is_admin(user_id):
            return
        send_message(chat_id, "🔍 <b>Checking all gates...</b>")
        lines_out = ["🛡️ <b>API Health Report</b>\n"]
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
            lines_out.append(
                f"{icon} <code>{info['cmd']}</code> — {info['name']}\n"
                f"    {status}  ·  {en_icon} {'On' if enabled else 'Off'}")
        if any_dead:
            lines_out.append(f"\n⚠️ <b>{len(any_dead)} dead gate(s)</b>")
        else:
            lines_out.append(f"\n✅ <b>All gates operational</b>")
        send_message(chat_id, "\n".join(lines_out))
        return

    # --- /gates ---
    if text == "/gates":
        gs = load_gate_stats()
        lines_out = ["🚀 <b>Available Gates</b>\n"]
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
                f"{status_icon} <code>{cmd}</code>  ·  {label}\n"
                f"    {status_text}  ·  {total} checked  ·  {approved} hits  ·  {rate}%")
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
            send_message(chat_id, "🔒 <b>Admin only.</b>")
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
                        send_message(chat_id, "❌ <b>Invalid duration.</b>\nExamples: 1d, 7d, 1mo, perm")
                        return
                    duration_seconds = parsed
            except ValueError:
                parsed = parse_duration(parts[1])
                if parsed == -1:
                    send_message(chat_id,
                        "<b>Usage:</b> <code>/genkey [limit] [duration]</code>\n"
                        "Examples: /genkey 500 7d, /genkey 7d, /genkey")
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
            f"🔑 <b>Key Generated</b>\n\n"
            f"<code>{key}</code>\n"
            f"Duration: <code>{dur_label}</code>\n"
            f"Line Limit: <code>{limit_label}</code>")
        return

    # --- /genkeys ---
    if text.startswith("/genkeys"):
        if not is_admin(user_id):
            send_message(chat_id, "🔒 <b>Admin only.</b>")
            return
        parts = text.split()
        if len(parts) < 2:
            send_message(chat_id,
                "<b>Usage:</b> <code>/genkeys 10 500 7d</code>\n\n"
                "count · limit · duration")
            return
        try:
            count = int(parts[1])
        except ValueError:
            send_message(chat_id, "❌ <b>Invalid count.</b>")
            return
        if count < 1 or count > 500:
            send_message(chat_id, "❌ <b>Count must be 1-500.</b>")
            return
        line_limit = None
        duration_seconds = None
        if len(parts) >= 3:
            try:
                line_limit = int(parts[2])
                if len(parts) >= 4:
                    parsed = parse_duration(parts[3])
                    if parsed == -1:
                        send_message(chat_id, "❌ <b>Invalid duration.</b>")
                        return
                    duration_seconds = parsed
            except ValueError:
                parsed = parse_duration(parts[2])
                if parsed == -1:
                    send_message(chat_id, "❌ <b>Invalid format.</b>")
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
            caption=f"🔑 <b>{count} Keys Generated</b>\n"
                    f"Duration: <code>{dur_label}</code>\n"
                    f"Line Limit: <code>{limit_label}</code>")
        return

    # --- /revoke ---
    if text.startswith("/revoke"):
        if not is_admin(user_id):
            send_message(chat_id, "🔒 <b>Admin only.</b>")
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> <code>/revoke 123456789</code>")
            return
        target_id = parts[1].strip()
        users = load_users()
        if target_id in users:
            del users[target_id]
            save_users(users)
            send_message(chat_id, f"✅ <b>Access Revoked</b>\n\nUser <code>{target_id}</code> removed.")
        else:
            send_message(chat_id, f"❌ <b>User not found.</b>\n\n<code>{target_id}</code> is not authorized.")
        return

    # --- /authlist ---
    if text == "/authlist":
        if not is_admin(user_id):
            send_message(chat_id, "🔒 <b>Admin only.</b>")
            return
        users = load_users()
        if not users:
            send_message(chat_id, "ℹ️ <b>No authorized users.</b>")
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
            f"👥 <b>Authorized Users ({len(users)})</b>\n\n"
            "<code>" + "\n".join(lines_out) + "</code>")
        return

    # --- /broadcast ---
    if text.startswith("/broadcast"):
        if not is_admin(user_id):
            send_message(chat_id, "🔒 <b>Admin only.</b>")
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> /broadcast Your message here")
            return
        broadcast_text = parts[1]
        users = load_users()
        sent = 0
        failed = 0
        for uid in users:
            try:
                resp = send_message(int(uid), f"📢 <b>Broadcast</b>\n\n{broadcast_text}")
                if resp.get("ok"):
                    sent += 1
                else:
                    failed += 1
            except Exception:
                failed += 1
        send_message(chat_id,
            f"📢 <b>Broadcast Complete</b>\n\n"
            f"Sent: <code>{sent}</code>\n"
            f"Failed: <code>{failed}</code>")
        return

    # --- /redeem ---
    if text.startswith("/redeem"):
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            send_message(chat_id, "<b>Usage:</b> <code>/redeem YOUR-KEY</code>")
            return
        key = parts[1].strip()
        keys = load_keys()
        if key not in keys:
            send_message(chat_id, "❌ <b>Invalid key.</b>")
            return
        if keys[key].get("used"):
            send_message(chat_id, "❌ <b>Key already used.</b>")
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
            f"✅ <b>Access Granted</b>\n\n"
            f"Duration: <code>{dur_label}</code>\n"
            f"Line Limit: <code>{limit_label}</code>\n\n"
            f"Welcome aboard.")
        return

    # --- Gate commands ---
    cmd_base = text.split()[0] if text else ""
    if cmd_base in GATE_MAP:
        gate, gate_label = GATE_MAP[cmd_base]

        if not is_gate_enabled(gate):
            send_message(chat_id,
                f"⛔ <b>{gate_label} — Offline</b>\n\n"
                f"This gate has been disabled by an admin.\n"
                f"Try another gate or check /gates for available options.")
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
                send_message(chat_id, f"❌ <b>Invalid format.</b>\n\nUse: <code>{cmd_base} CC|MM|YY|CVV</code>")
                return

            send_message(chat_id, f"🔍 <b>Checking...</b>\n<code>{cc_input}</code>")

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
                    f"{icon} <b>{status}</b>\n\n"
                    f"Card: <code>{cc_input}</code>\n"
                    f"Gate: <code>{gate_label}</code>\n"
                    f"Result: {result}")

            threading.Thread(target=_single_check, daemon=True).start()
            return

        # Bulk mode
        reply = msg.get("reply_to_message")
        if not reply or not reply.get("document"):
            send_message(chat_id,
                f"📋 <b>Usage</b>\n\n"
                f"<b>Single:</b> <code>{cmd_base} CC|MM|YY|CVV</code>\n"
                f"<b>Bulk:</b> Reply to a .txt file with <code>{cmd_base}</code>")
            return

        doc = reply["document"]
        fname = doc.get("file_name", "")
        if not fname.lower().endswith(".txt"):
            send_message(chat_id, "❌ <b>Only .txt files are accepted.</b>")
            return

        with active_lock:
            if user_id in active_users:
                send_message(chat_id, "⚠️ <b>You already have a task running.</b>")
                return
            active_users.add(user_id)

        cancel_flags.pop(user_id, None)

        content = download_file(doc["file_id"])
        if not content:
            with active_lock:
                active_users.discard(user_id)
            send_message(chat_id, "❌ <b>Failed to download file.</b>")
            return

        file_lines = [l.strip() for l in content.splitlines() if l.strip()]
        if not file_lines:
            with active_lock:
                active_users.discard(user_id)
            send_message(chat_id, "❌ <b>File is empty.</b>")
            return

        user_limit = get_user_line_limit(user_id)
        if user_limit and len(file_lines) > user_limit:
            with active_lock:
                active_users.discard(user_id)
            send_message(chat_id,
                f"❌ <b>File Too Large</b>\n\n"
                f"Your key allows <code>{user_limit}</code> lines.\n"
                f"Your file has <code>{len(file_lines)}</code> lines.")
            return

        init_resp = send_message(
            chat_id,
            f"⚡ Starting Engine — <b>{gate_label}</b>...",
            reply_markup=stop_button_markup(user_id)
        )
        progress_msg_id = init_resp.get("result", {}).get("message_id")

        def _run(gate=gate):
            start_time = time.time()
            last_edit_time = [0]

            def on_progress(idx, total, results, entry, status, detail):
                if status == "APPROVED":
                    status_text = "✅ APPROVED — " + detail
                elif status == "DECLINED":
                    status_text = "❌ DECLINED — " + detail
                elif status == "SKIPPED":
                    status_text = "⏭️ SKIPPED — " + detail
                else:
                    status_text = "⚠️ ERROR — " + detail

                if status == "APPROVED":
                    send_message(chat_id,
                        f"🎯 <b>HIT FOUND</b>\n\n"
                        f"<code>{entry}</code>\n\n"
                        f"{detail}\n"
                        f"[{idx}/{total}]")

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
                                 entry="Finished", status_text="✅ Completed", done=True))

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
