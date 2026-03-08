"""
Microsoft WLID Claimer — authenticates accounts and extracts WLID tokens.
Exact same logic as the Node.js microsoft-claimer.js.
"""
import re
import requests
import urllib.parse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

TOKEN_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}


def _parse_lr(text, left, right):
    try:
        s = text.index(left) + len(left)
        e = text.index(right, s)
        return text[s:e]
    except (ValueError, IndexError):
        return ""


def _decode_json_string(text):
    try:
        return text.encode().decode("unicode_escape")
    except Exception:
        return text


def authenticate_account(email, password):
    """Authenticate a Microsoft account and return a WLID token."""
    s = requests.Session()
    s.max_redirects = 10
    s.headers.update(DEFAULT_HEADERS)

    try:
        # Step 1: Navigate to billing/redeem page
        r = s.get("https://account.microsoft.com/billing/redeem",
                   headers={**DEFAULT_HEADERS, "Referer": "https://account.microsoft.com/"},
                   allow_redirects=True, timeout=20)
        text = r.text

        # Step 2: Extract redirect URL
        rurl_match = re.search(r'"urlPost":"([^"]+)"', text)
        if not rurl_match:
            return {"email": email, "success": False, "error": "Could not extract redirect URL"}
        rurl = "https://login.microsoftonline.com" + _decode_json_string(rurl_match.group(1))
        r = s.get(rurl, headers={**DEFAULT_HEADERS, "Referer": "https://account.microsoft.com/"}, allow_redirects=True, timeout=20)
        text = r.text

        # Step 3: Extract AAD URL
        furl_match = re.search(r'urlGoToAADError":"([^"]+)"', text)
        if not furl_match:
            return {"email": email, "success": False, "error": "Could not extract AAD URL"}
        furl = _decode_json_string(furl_match.group(1))
        furl = furl.replace("&jshs=0", f"&jshs=2&jsh=&jshp=&username={urllib.parse.quote(email)}&login_hint={urllib.parse.quote(email)}")

        # Step 4: Load login form
        r = s.get(furl, headers={**DEFAULT_HEADERS, "Referer": "https://login.microsoftonline.com/"}, allow_redirects=True, timeout=20)
        text = r.text

        # Extract PPFT
        sft_tag = None
        for pattern in [r'value=\\?"([^"\\]+)\\?"', r'value="([^"]+)"', r'name="PPFT"[^>]+value="([^"]+)"', r'value="([^"]+)"[^>]+name="PPFT"']:
            m = re.search(pattern, text, re.DOTALL)
            if m:
                sft_tag = m.group(1)
                break
        if not sft_tag:
            return {"email": email, "success": False, "error": "Could not extract sFT tag"}

        # Extract urlPost
        url_post = None
        for pattern in [r'"urlPost":"([^"]+)"', r"urlPost:'([^']+)'"]:
            m = re.search(pattern, text, re.DOTALL)
            if m:
                url_post = m.group(1)
                break
        if not url_post:
            return {"email": email, "success": False, "error": "Could not extract urlPost"}

        # Step 5: Submit credentials
        login_data = {
            "login": email, "loginfmt": email, "passwd": password, "PPFT": sft_tag,
        }
        r = s.post(url_post, data=login_data,
                    headers={**DEFAULT_HEADERS, "Content-Type": "application/x-www-form-urlencoded",
                             "Referer": furl, "Origin": "https://login.live.com"},
                    allow_redirects=True, timeout=20)
        login_text = r.text.replace("\\", "")

        if "Your account or password is incorrect" in login_text or "sErrTxt" in login_text:
            return {"email": email, "success": False, "error": "Invalid credentials"}

        # Step 6: Extract second sFT
        ppft2 = None
        m = re.search(r'"sFT":"([^"]+)"', login_text)
        if m:
            ppft2 = m.group(1)

        if not ppft2:
            # Handle privacy notice form
            action_m = re.search(r'<form[^>]*action="([^"]+)"', login_text)
            if action_m and "privacynotice" in action_m.group(1):
                inputs = re.findall(r'<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"', login_text)
                if inputs:
                    form_data = {n: v for n, v in inputs}
                    r = s.post(action_m.group(1), data=form_data,
                               headers={**DEFAULT_HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
                               allow_redirects=True, timeout=20)
                    redirect_m = re.search(r"ucis\.RedirectUrl\s*=\s*'([^']+)'", r.text)
                    if redirect_m:
                        redirect_url = redirect_m.group(1).replace("u0026", "&").replace("\\&", "&")
                        r = s.get(redirect_url, headers=DEFAULT_HEADERS, allow_redirects=True, timeout=20)
                        login_text = r.text.replace("\\", "")
            m = re.search(r'"sFT":"([^"]+)"', login_text)
            if m:
                ppft2 = m.group(1)

        if not ppft2:
            return {"email": email, "success": False, "error": "Could not extract second sFT token"}

        # Step 7: Final login
        lurl_m = re.search(r'"urlPost":"([^"]+)"', login_text)
        if not lurl_m:
            return {"email": email, "success": False, "error": "Could not extract final login URL"}

        final_data = {"LoginOptions": "1", "type": "28", "ctx": "", "hpgrequestid": "", "PPFT": ppft2, "canary": ""}
        r = s.post(lurl_m.group(1), data=final_data,
                    headers={**DEFAULT_HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
                    allow_redirects=True, timeout=20)
        finish_text = r.text

        # Step 8: Follow replace URL
        reurl_m = re.search(r'replace\("([^"]+)"\)', finish_text)
        reresp = finish_text
        if reurl_m:
            r = s.get(reurl_m.group(1), headers={**DEFAULT_HEADERS, "Referer": "https://login.live.com/"},
                       allow_redirects=True, timeout=20)
            reresp = r.text

        # Step 9: Submit final form
        action_m = re.search(r'<form[^>]*action="([^"]+)"', reresp)
        if action_m and "javascript" not in action_m.group(1):
            inputs = re.findall(r'<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"', reresp)
            if not inputs:
                inputs = re.findall(r'<input[^>]*value="([^"]*)"[^>]*name="([^"]+)"', reresp)
                inputs = [(n, v) for v, n in inputs]
            if inputs:
                form_data = {n: v for n, v in inputs}
                r = s.post(action_m.group(1), data=form_data,
                           headers={**DEFAULT_HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
                           allow_redirects=True, timeout=20)

        # Step 10: Get token
        token_r = s.get(
            "https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL",
            headers={**TOKEN_HEADERS, "User-Agent": DEFAULT_HEADERS["User-Agent"],
                     "Referer": "https://account.microsoft.com/billing/redeem"},
            timeout=20,
        )
        token_data = token_r.json()
        if not token_data or not isinstance(token_data, list) or not token_data[0].get("token"):
            return {"email": email, "success": False, "error": "Invalid token structure"}

        return {"email": email, "success": True, "token": token_data[0]["token"]}

    except Exception as ex:
        return {"email": email, "success": False, "error": str(ex)}


def claim_wlids(accounts, threads=5, on_progress=None, stop_event=None):
    """Claim WLID tokens from multiple accounts."""
    parsed = []
    for acc in accounts:
        i = acc.find(":")
        if i == -1:
            parsed.append((acc, ""))
        else:
            parsed.append((acc[:i], acc[i+1:]))

    results = [None] * len(parsed)
    done = [0]
    lock = threading.Lock()

    def worker(idx):
        if stop_event and stop_event.is_set():
            return
        email, password = parsed[idx]
        results[idx] = authenticate_account(email, password)
        with lock:
            done[0] += 1
            if on_progress:
                try:
                    on_progress(done[0], len(parsed))
                except Exception:
                    pass

    with ThreadPoolExecutor(max_workers=min(threads, len(parsed))) as pool:
        futs = {pool.submit(worker, i): i for i in range(len(parsed))}
        for f in as_completed(futs):
            try:
                f.result()
            except Exception:
                pass

    return [r for r in results if r]
