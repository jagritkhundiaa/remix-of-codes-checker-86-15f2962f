"""
Microsoft Account Password Changer — Python port of microsoft-changer.js.
Uses account.live.com login flow to change passwords.
"""
import re
import time
import random
import requests
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}


def _random_delay(min_ms, max_ms):
    time.sleep((min_ms + random.random() * (max_ms - min_ms)) / 1000)


def _is_password_change_context(html, url=""):
    on_url = bool(re.search(r'account\.live\.com/.*password/change', url, re.I))
    has_markers = any(x in html for x in ["NewPassword", "iNewPwd", "ChangePasswordForm", "API/ChangePassword"])
    return on_url and has_markers


def _login_to_account_live(session, email, password):
    """Login via account.live.com/password/Change redirect flow."""
    try:
        r = session.get("https://account.live.com/password/Change", allow_redirects=True, timeout=20)
        text = r.text
        final_url = str(r.url)

        if _is_password_change_context(text, final_url):
            return {"success": True, "page": text, "final_url": final_url}

        # Extract PPFT
        ppft = None
        for pat in [r"sFT\s*:\s*'([^']+)'", r'sFTTag\s*:.*?value="([^"]+)"', r'value=\\?"([^"\\]+)\\?"',
                     r'name="PPFT"[^>]*value="([^"]+)"', r'value="([^"]+)"[^>]*name="PPFT"']:
            m = re.search(pat, text, re.DOTALL)
            if m:
                ppft = m.group(1)
                break
        if not ppft:
            return {"success": False, "error": "Could not extract login form", "retryable": True}

        # Extract urlPost
        url_post = None
        for pat in [r'"urlPost"\s*:\s*"([^"]+)"', r"urlPost\s*:\s*'([^']+)'"]:
            m = re.search(pat, text, re.DOTALL)
            if m:
                url_post = m.group(1)
                break
        if not url_post:
            return {"success": False, "error": "Could not extract urlPost", "retryable": False}

        # Submit credentials
        login_data = {
            "login": email, "loginfmt": email, "passwd": password, "PPFT": ppft,
            "PPSX": "PassportR", "type": "11", "LoginOptions": "3",
            "NewUser": "1", "i21": "0", "CookieDisclosure": "0",
            "IsFidoSupported": "0", "isSignupPost": "0",
        }
        r = session.post(url_post, data=login_data,
                         headers={"Content-Type": "application/x-www-form-urlencoded"},
                         allow_redirects=True, timeout=20)
        after_text = r.text
        after_url = str(r.url)

        if "incorrect" in after_text or "password is incorrect" in after_text:
            return {"success": False, "error": "Invalid credentials", "retryable": False}
        if "locked" in after_text.lower():
            return {"success": False, "error": "Account locked", "retryable": False}
        if "doesn't exist" in after_text or "doesn\\'t exist" in after_text:
            return {"success": False, "error": "Account not found", "retryable": False}

        if _is_password_change_context(after_text, after_url):
            return {"success": True, "page": after_text, "final_url": after_url}

        # Handle intermediate forms
        current_page = after_text
        current_url = after_url
        for _ in range(5):
            if _is_password_change_context(current_page, current_url):
                return {"success": True, "page": current_page, "final_url": current_url}
            fm = re.search(r'<form[^>]*action="([^"]+)"', current_page)
            if not fm or "javascript" in fm.group(1):
                break
            action = fm.group(1)
            if not action.startswith("http"):
                action = requests.compat.urljoin(current_url, action)
            inputs = re.findall(r'<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"', current_page)
            form_data = {n: v for n, v in inputs}
            r = session.post(action, data=form_data, headers={"Content-Type": "application/x-www-form-urlencoded"},
                             allow_redirects=True, timeout=20)
            current_page = r.text
            current_url = str(r.url)

        return {"success": True, "page": current_page, "final_url": current_url}
    except Exception as ex:
        return {"success": False, "error": str(ex), "retryable": True}


def _submit_password_change(page_html, page_url, email, old_password, new_password, session):
    """Submit the password change form."""
    has_old = any(x in page_html for x in ["OldPassword", "iOldPwd", "oldPassword", "proofInput"])
    has_new = any(x in page_html for x in ["NewPassword", "iNewPwd"])
    is_ctx = _is_password_change_context(page_html, page_url or "") or has_old or has_new

    if not is_ctx:
        return {"email": email, "success": False, "error": "Session expired", "retryable": True}

    try:
        # Try API method
        api_canary = re.search(r'"apiCanary"\s*:\s*"([^"]+)"', page_html, re.DOTALL)
        canary = re.search(r'"canary"\s*:\s*"([^"]+)"', page_html, re.DOTALL)
        sctx = re.search(r'"sCtx"\s*:\s*"([^"]+)"', page_html, re.DOTALL)
        flow_token = re.search(r'"sFT"\s*:\s*"([^"]+)"', page_html, re.DOTALL)

        if api_canary and (has_new or has_old):
            import json
            body = {}
            if canary:
                body["canary"] = canary.group(1)
            if sctx:
                body["sCtx"] = sctx.group(1)
            if flow_token:
                body["token"] = flow_token.group(1)
            if old_password:
                body["oldPassword"] = old_password
            body["password"] = new_password
            body["expiryEnabled"] = False
            body["uiflvr"] = 1001

            r = session.post("https://account.live.com/API/ChangePassword",
                             json=body,
                             headers={"Content-Type": "application/json", "canary": api_canary.group(1),
                                      "hpgact": "commit", "X-Requested-With": "XMLHttpRequest"},
                             allow_redirects=True, timeout=20)

            try:
                jr = r.json()
                if jr.get("error"):
                    err_code = str(jr["error"].get("code", jr["error"]))
                    if "PasswordIncorrect" in err_code or "1003" in err_code:
                        return {"email": email, "success": False, "error": "Current password incorrect"}
                    if "TooShort" in err_code:
                        return {"email": email, "success": False, "error": "New password too short"}
                    if "SameAsOld" in err_code:
                        return {"email": email, "success": False, "error": "New password same as old"}
                    return {"email": email, "success": False, "error": f"API error: {err_code}"}
                if jr.get("success") or jr.get("State") == 1 or jr.get("HasSucceeded"):
                    return {"email": email, "success": True, "new_password": new_password}
            except Exception:
                pass

            text = r.text
            if "PasswordChanged" in text or "password has been changed" in text or "successfully changed" in text:
                return {"email": email, "success": True, "new_password": new_password}
            if "incorrect" in text.lower():
                return {"email": email, "success": False, "error": "Current password incorrect"}

        # Form-based fallback
        fm = re.search(r'<form[^>]*action="([^"]*[Pp]assword[^"]*)"', page_html, re.DOTALL)
        if fm:
            action = fm.group(1)
            if not action.startswith("http"):
                action = f"https://account.live.com{action}"
            form_data = {"NewPassword": new_password, "RetypePassword": new_password}
            if canary:
                form_data["canary"] = canary.group(1)
            r = session.post(action, data=form_data, headers={"Content-Type": "application/x-www-form-urlencoded"},
                             allow_redirects=True, timeout=20)
            if "PasswordChanged" in r.text or "password has been changed" in r.text:
                return {"email": email, "success": True, "new_password": new_password}
            if "incorrect" in r.text.lower():
                return {"email": email, "success": False, "error": "Current password incorrect"}

        return {"email": email, "success": False, "error": "Password change not confirmed", "retryable": False}
    except Exception as ex:
        return {"email": email, "success": False, "error": str(ex), "retryable": True}


def change_password(email, old_password, new_password):
    """Change password for a single account with retries."""
    for attempt in range(3):
        s = requests.Session()
        s.headers.update(DEFAULT_HEADERS)

        login_result = _login_to_account_live(s, email, old_password)
        if not login_result["success"]:
            if login_result.get("retryable") and attempt < 2:
                time.sleep(5 + random.random() * 5)
                continue
            return {"email": email, "success": False, "error": login_result.get("error", "Login failed")}

        page = login_result["page"]
        url = login_result.get("final_url", "")

        # Navigate to password change if not already there
        if not _is_password_change_context(page, url):
            _random_delay(500, 1500)
            r = s.get("https://account.live.com/password/Change", allow_redirects=True, timeout=20)
            page = r.text
            url = str(r.url)
            # Handle intermediate forms
            for _ in range(3):
                if _is_password_change_context(page, url):
                    break
                fm = re.search(r'<form[^>]*action="([^"]+)"', page)
                if not fm or "javascript" in fm.group(1):
                    break
                action = fm.group(1) if fm.group(1).startswith("http") else requests.compat.urljoin(url, fm.group(1))
                inputs = re.findall(r'<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"', page)
                r = s.post(action, data={n: v for n, v in inputs}, headers={"Content-Type": "application/x-www-form-urlencoded"},
                           allow_redirects=True, timeout=20)
                page = r.text
                url = str(r.url)

        result = _submit_password_change(page, url, email, old_password, new_password, s)
        if result["success"] or not result.get("retryable"):
            return result
        if attempt < 2:
            time.sleep(5 + random.random() * 10)

    return {"email": email, "success": False, "error": "Max retries exceeded"}


def change_passwords(accounts, new_password, threads=3, on_progress=None, stop_event=None):
    """Change passwords for multiple accounts."""
    parsed = []
    for a in accounts:
        i = a.find(":")
        if i == -1:
            parsed.append((a, ""))
        else:
            parsed.append((a[:i], a[i+1:]))

    results = []
    lock = threading.Lock()
    idx = [0]

    def worker():
        while True:
            if stop_event and stop_event.is_set():
                break
            with lock:
                i = idx[0]
                idx[0] += 1
            if i >= len(parsed):
                break
            _random_delay(2000, 6000)
            email, password = parsed[i]
            result = change_password(email, password, new_password)
            with lock:
                results.append(result)
            if on_progress:
                on_progress(len(results), len(parsed))

    wc = min(threads, len(parsed), 3)
    workers = []
    for _ in range(wc):
        t = threading.Thread(target=worker)
        t.start()
        workers.append(t)
    for t in workers:
        t.join()

    return results
