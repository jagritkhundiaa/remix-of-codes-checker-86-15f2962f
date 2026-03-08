"""
Microsoft Code Puller — fetches Game Pass perk codes from accounts,
then validates them via PrepareRedeem.
Exact same logic as the Node.js microsoft-puller.js.
"""
import re
import uuid
import time
import math
import requests
import urllib.parse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from ms_code_checker import check_codes
from wlid_store import get_wlids

# ── Code format validation ──
INVALID_CHARS = set("AEIOULSO015")


def _is_invalid_code_format(code):
    if not code or len(code) < 5 or " " in code:
        return True
    return any(c in INVALID_CHARS for c in code)


# ── Xbox Live OAuth Login ──
MICROSOFT_OAUTH_URL = (
    "https://login.live.com/oauth20_authorize.srf"
    "?client_id=00000000402B5328"
    "&redirect_uri=https://login.live.com/oauth20_desktop.srf"
    "&scope=service::user.auth.xboxlive.com::MBI_SSL"
    "&display=touch&response_type=token&locale=en"
)


def _parse_lr(text, left, right):
    try:
        s = text.index(left) + len(left)
        e = text.index(right, s)
        return text[s:e]
    except (ValueError, IndexError):
        return ""


def _fetch_oauth_tokens(session):
    try:
        r = session.get(MICROSOFT_OAUTH_URL, allow_redirects=True, timeout=15)
        text = r.text
        ppft = None
        for pat in [r'value=\\?"([^"\\]+)\\?"', r'value="([^"]+)"']:
            m = re.search(pat, text, re.DOTALL)
            if m:
                ppft = m.group(1)
                break
        url_post = None
        for pat in [r'"urlPost":"([^"]+)"', r"urlPost:'([^']+)'"]:
            m = re.search(pat, text, re.DOTALL)
            if m:
                url_post = m.group(1)
                break
        return url_post, ppft
    except Exception:
        return None, None


def _fetch_login(session, email, password, url_post, ppft):
    try:
        data = {"login": email, "loginfmt": email, "passwd": password, "PPFT": ppft}
        r = session.post(url_post, data=data,
                         headers={"Content-Type": "application/x-www-form-urlencoded"},
                         allow_redirects=True, timeout=15)

        final_url = str(r.url)
        if "#" in final_url:
            fragment = final_url.split("#", 1)[1]
            params = urllib.parse.parse_qs(fragment)
            token = params.get("access_token", [None])[0]
            if token and token != "None":
                return token

        text = r.text
        if "cancel?mkt=" in text:
            ipt = re.search(r'"ipt" value="([^"]+)"', text)
            pprid = re.search(r'"pprid" value="([^"]+)"', text)
            uaid = re.search(r'"uaid" value="([^"]+)"', text)
            action = re.search(r'id="fmHF" action="([^"]+)"', text)
            if ipt and pprid and uaid and action:
                form_data = {"ipt": ipt.group(1), "pprid": pprid.group(1), "uaid": uaid.group(1)}
                r2 = session.post(action.group(1), data=form_data,
                                  headers={"Content-Type": "application/x-www-form-urlencoded"},
                                  allow_redirects=True, timeout=15)
                ret_url = re.search(r'"recoveryCancel":\{"returnUrl":"([^"]+)"', r2.text)
                if ret_url:
                    r3 = session.get(ret_url.group(1), allow_redirects=True, timeout=15)
                    final_url2 = str(r3.url)
                    if "#" in final_url2:
                        fragment = final_url2.split("#", 1)[1]
                        params = urllib.parse.parse_qs(fragment)
                        token = params.get("access_token", [None])[0]
                        if token and token != "None":
                            return token
        return None
    except Exception:
        return None


def _get_xbox_tokens(rps_token):
    try:
        r = requests.post("https://user.auth.xboxlive.com/user/authenticate",
                          json={"RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT",
                                "Properties": {"AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": rps_token}},
                          headers={"Content-Type": "application/json"}, timeout=15)
        if r.status_code != 200:
            return None, None
        user_token = r.json()["Token"]

        r2 = requests.post("https://xsts.auth.xboxlive.com/xsts/authorize",
                           json={"RelyingParty": "http://xboxlive.com", "TokenType": "JWT",
                                 "Properties": {"UserTokens": [user_token], "SandboxId": "RETAIL"}},
                           headers={"Content-Type": "application/json"}, timeout=15)
        if r2.status_code != 200:
            return None, None
        xsts = r2.json()
        uhs = xsts.get("DisplayClaims", {}).get("xui", [{}])[0].get("uhs")
        return uhs, xsts["Token"]
    except Exception:
        return None, None


def _is_link(resource):
    return resource and (resource.startswith("http://") or resource.startswith("https://"))


def _fetch_codes_from_xbox(uhs, xsts_token):
    try:
        auth = f"XBL3.0 x={uhs};{xsts_token}"
        r = requests.get("https://profile.gamepass.com/v2/offers",
                         headers={"Authorization": auth, "Content-Type": "application/json", "User-Agent": "okhttp/4.12.0"},
                         timeout=15)
        if r.status_code != 200:
            return [], []

        data = r.json()
        codes, links = [], []
        import random
        import string
        for offer in data.get("offers", []):
            if offer.get("resource"):
                if _is_link(offer["resource"]):
                    links.append(offer["resource"])
                else:
                    codes.append(offer["resource"])
            elif offer.get("offerStatus") == "available":
                chars = string.ascii_letters + string.digits
                cv = "".join(random.choice(chars) for _ in range(22)) + ".0"
                try:
                    cr = requests.post(f"https://profile.gamepass.com/v2/offers/{offer['offerId']}",
                                       headers={"Authorization": auth, "Content-Type": "application/json",
                                                 "User-Agent": "okhttp/4.12.0", "ms-cv": cv, "Content-Length": "0"},
                                       data="", timeout=15)
                    if cr.status_code == 200:
                        cd = cr.json()
                        if cd.get("resource"):
                            if _is_link(cd["resource"]):
                                links.append(cd["resource"])
                            else:
                                codes.append(cd["resource"])
                except Exception:
                    pass
        return codes, links
    except Exception:
        return [], []


# ── Store Login + PrepareRedeem ──

def _login_microsoft_store(email, password):
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    try:
        bk = int(time.time())
        login_url = (
            f"https://login.live.com/ppsecure/post.srf?username={urllib.parse.quote(email)}"
            f"&client_id=81feaced-5ddd-41e7-8bef-3e20a2689bb7&contextid=833A37B454306173"
            f"&opid=81A1AC2B0BEB4ABA&bk={bk}&uaid=f8aac2614ca54994b0bb9621af361fe6&pid=15216&prompt=none"
        )
        data = urllib.parse.urlencode({
            "login": email, "loginfmt": email, "passwd": password,
            "PPFT": "-DmNqKIwViyNLVW!ndu48B52hWo3*dmmh3IYETDXnVvQdWK!9sxjI48z4IX*vHf5Gl*FYol2kesrvhsuunUYDLekZOg8UW8V4cugeNYzI1wLpI7wHWnu9CLiqRiISqQ2jS1kLHkeekbWTFtKb2l0J7k3nmQ3u811SxsV1e4l8WfyX8Pt8!pgnQ1bNLoptSPmVE45tyzHdttjDZeiMvu6aV0NrFLHYroFsVS581ZI*C8z27!K5I8nESfTU!YxntGN1RQ$$",
        })
        r = s.post(login_url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}, allow_redirects=True, timeout=20)
        cleaned = r.text.replace("\\", "")
        reurl_m = re.search(r'replace\("([^"]+)"', cleaned)
        if not reurl_m:
            return None
        r = s.get(reurl_m.group(1), allow_redirects=True, timeout=20)
        action_m = re.search(r'<form.*?action="(.*?)".*?>', r.text)
        if not action_m:
            return None
        inputs = re.findall(r'<input.*?name="(.*?)".*?value="(.*?)".*?>', r.text)
        form_data = {n: v for n, v in inputs}
        s.post(action_m.group(1), data=form_data, headers={"Content-Type": "application/x-www-form-urlencoded"}, allow_redirects=True, timeout=20)
        return s
    except Exception:
        return None


def _generate_reference_id():
    ts = int(time.time() / 30)
    n = format(ts, "08X")
    o = (uuid.uuid4().hex + uuid.uuid4().hex).upper()
    result = []
    for e in range(64):
        if e % 8 == 1:
            idx = (e - 1) // 8
            result.append(n[idx] if idx < len(n) else "0")
        else:
            result.append(o[e] if e < len(o) else "0")
    return "".join(result)


def _get_store_auth_token(session):
    try:
        session.get("https://buynowui.production.store-web.dynamics.com/akam/13/79883e11", timeout=10)
    except Exception:
        pass
    try:
        r = session.get(
            "https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL",
            headers={"Accept": "application/json", "Content-Type": "application/json",
                     "X-Requested-With": "XMLHttpRequest", "Cache-Control": "no-cache",
                     "Pragma": "no-cache", "Referer": "https://account.microsoft.com/billing/redeem"},
            timeout=20,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        if not data or not data[0].get("token"):
            return None
        return data[0]["token"]
    except Exception:
        return None


def _get_store_cart_state(session, token):
    try:
        ms_cv = "xddT7qMNbECeJpTq.6.2"
        payload = urllib.parse.urlencode({
            "data": '{"usePurchaseSdk":true}', "market": "US", "cV": ms_cv,
            "locale": "en-GB", "msaTicket": token, "pageFormat": "full",
            "urlRef": "https://account.microsoft.com/billing/redeem",
            "isRedeem": "true", "clientType": "AccountMicrosoftCom",
            "layout": "Inline", "cssOverride": "AMC", "scenario": "redeem",
            "timeToInvokeIframe": "4977", "sdkVersion": "VERSION_PLACEHOLDER",
        })
        r = session.post(
            f"https://www.microsoft.com/store/purchase/buynowui/redeemnow?ms-cv={ms_cv}&market=US&locale=en-GB&clientName=AccountMicrosoftCom",
            data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=20,
        )
        m = re.search(r'window\.__STORE_CART_STATE__=({.*?});', r.text, re.DOTALL)
        if not m:
            return None
        import json
        state = json.loads(m.group(1))
        ctx = state.get("appContext", {})
        return {
            "ms_cv": ctx.get("cv", ""),
            "correlation_id": ctx.get("correlationId", ""),
            "tracking_id": ctx.get("trackingId", ""),
            "vector_id": ctx.get("muid", ""),
            "muid": ctx.get("alternativeMuid", ""),
        }
    except Exception:
        return None


def _validate_code_prepare_redeem(code, token, store_state, session):
    if _is_invalid_code_format(code):
        return {"code": code, "status": "INVALID", "message": f"{code} | INVALID"}

    hdrs = {
        "x-ms-tracking-id": store_state["tracking_id"],
        "authorization": f"WLID1.0=t={token}",
        "x-ms-client-type": "AccountMicrosoftCom",
        "x-ms-market": "US",
        "ms-cv": store_state["ms_cv"],
        "x-ms-reference-id": _generate_reference_id(),
        "x-ms-vector-id": store_state["vector_id"],
        "x-ms-correlation-id": store_state["correlation_id"],
        "content-type": "application/json",
        "x-authorization-muid": store_state["muid"],
        "accept": "*/*",
    }

    try:
        import json
        r = session.post(
            "https://buynow.production.store-web.dynamics.com/v1.0/Redeem/PrepareRedeem/?appId=RedeemNow&context=LookupToken",
            headers=hdrs, data=json.dumps({}), timeout=20,
        )
        if r.status_code == 429:
            return {"code": code, "status": "RATE_LIMITED", "message": f"{code} | RATE_LIMITED"}
        if r.status_code != 200:
            return {"code": code, "status": "ERROR", "message": f"{code} | HTTP {r.status_code}"}

        data = r.json()

        if data.get("tokenType") == "CSV":
            return {"code": code, "status": "BALANCE_CODE", "message": f"{code} | {data.get('value')} {data.get('currency')}"}
        if data.get("errorCode") == "TooManyRequests":
            return {"code": code, "status": "RATE_LIMITED", "message": f"{code} | RATE_LIMITED"}

        cart = (data.get("events", {}).get("cart") or [None])[0]
        if cart and cart.get("type") == "error":
            reason = (cart.get("data") or {}).get("reason", "")
            if "TooManyRequests" in str(cart) or "RateLimit" in reason:
                return {"code": code, "status": "RATE_LIMITED", "message": f"{code} | RATE_LIMITED"}
            if reason == "RedeemTokenAlreadyRedeemed":
                return {"code": code, "status": "REDEEMED", "message": f"{code} | REDEEMED"}
            if reason in ("RedeemTokenExpired", "LegacyTokenAuthenticationNotProvided", "RedeemTokenNoMatchingOrEligibleProductsFound"):
                return {"code": code, "status": "EXPIRED", "message": f"{code} | EXPIRED"}
            if reason == "RedeemTokenStateDeactivated":
                return {"code": code, "status": "DEACTIVATED", "message": f"{code} | DEACTIVATED"}
            if reason == "RedeemTokenGeoFencingError":
                return {"code": code, "status": "REGION_LOCKED", "message": f"{code} | REGION_LOCKED"}
            return {"code": code, "status": "INVALID", "message": f"{code} | INVALID"}

        if data.get("products") and len(data["products"]) > 0:
            pi = (data.get("productInfos") or [{}])[0]
            pid = pi.get("productId")
            for product in data["products"]:
                if product.get("id") == pid:
                    title = product.get("sku", {}).get("title") or product.get("title", "Unknown Title")
                    is_pi = pi.get("isPIRequired", False)
                    status = "VALID_REQUIRES_CARD" if is_pi else "VALID"
                    return {"code": code, "status": status, "title": title, "message": f"{code} | {title}"}

        return {"code": code, "status": "UNKNOWN", "message": f"{code} | UNKNOWN"}
    except Exception as ex:
        return {"code": code, "status": "ERROR", "message": f"{code} | {ex}"}


def fetch_from_account(email, password):
    """Fetch codes and links from a single Xbox account."""
    s = requests.Session()
    s.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
    try:
        url_post, ppft = _fetch_oauth_tokens(s)
        if not url_post:
            return {"email": email, "codes": [], "links": [], "error": "OAuth failed"}
        rps = _fetch_login(s, email, password, url_post, ppft)
        if not rps:
            return {"email": email, "codes": [], "links": [], "error": "Login failed"}
        uhs, xsts = _get_xbox_tokens(rps)
        if not uhs:
            return {"email": email, "codes": [], "links": [], "error": "Xbox tokens failed"}
        codes, links = _fetch_codes_from_xbox(uhs, xsts)
        return {"email": email, "codes": codes, "links": links}
    except Exception as ex:
        return {"email": email, "codes": [], "links": [], "error": str(ex)}


def pull_codes(accounts, on_progress=None, stop_event=None):
    """Full pull pipeline: fetch codes from accounts, then validate with WLIDs."""
    parsed = []
    for a in accounts:
        i = a.find(":")
        if i == -1:
            parsed.append((a, ""))
        else:
            parsed.append((a[:i], a[i+1:]))

    # Phase 1: Fetch codes
    all_codes = []
    fetch_results = []
    lock = threading.Lock()
    fetch_idx = [0]

    def fetch_worker():
        while True:
            if stop_event and stop_event.is_set():
                break
            with lock:
                idx = fetch_idx[0]
                fetch_idx[0] += 1
            if idx >= len(parsed):
                break
            email, password = parsed[idx]
            result = fetch_from_account(email, password)
            with lock:
                fetch_results.append(result)
                all_codes.extend(result["codes"])
            if on_progress:
                on_progress("fetch", {
                    "email": email, "codes": len(result["codes"]),
                    "error": result.get("error"), "done": len(fetch_results), "total": len(parsed),
                })

    threads = min(len(parsed), 10)
    workers = []
    for _ in range(threads):
        t = threading.Thread(target=fetch_worker)
        t.start()
        workers.append(t)
    for t in workers:
        t.join()

    if (stop_event and stop_event.is_set()) or not all_codes:
        return {"fetch_results": fetch_results, "validate_results": []}

    # Phase 2: Validate with WLIDs
    wlids = get_wlids()
    if not wlids:
        validate_results = [{"code": c, "status": "error", "message": f"{c} | No WLIDs stored"} for c in all_codes]
        return {"fetch_results": fetch_results, "validate_results": validate_results}

    if on_progress:
        on_progress("validate_start", {"total": len(all_codes), "fetch_results": fetch_results})

    validate_results = check_codes(wlids, all_codes, 10, lambda done, total, last: (
        on_progress("validate", {"done": done, "total": total, "status": last.get("status") if last else None}) if on_progress else None
    ), stop_event)

    return {"fetch_results": fetch_results, "validate_results": validate_results}


def pull_links(accounts, on_progress=None, stop_event=None):
    """Pull promo links only (no validation)."""
    parsed = []
    for a in accounts:
        i = a.find(":")
        if i == -1:
            parsed.append((a, ""))
        else:
            parsed.append((a[:i], a[i+1:]))

    all_links = []
    fetch_results = []
    lock = threading.Lock()
    fetch_idx = [0]

    def fetch_worker():
        while True:
            if stop_event and stop_event.is_set():
                break
            with lock:
                idx = fetch_idx[0]
                fetch_idx[0] += 1
            if idx >= len(parsed):
                break
            email, password = parsed[idx]
            result = fetch_from_account(email, password)
            with lock:
                fetch_results.append(result)
                all_links.extend(result.get("links", []))
            if on_progress:
                on_progress("fetch", {
                    "email": email, "links": len(result.get("links", [])),
                    "error": result.get("error"), "done": len(fetch_results), "total": len(parsed),
                })

    threads = min(len(parsed), 10)
    workers = []
    for _ in range(threads):
        t = threading.Thread(target=fetch_worker)
        t.start()
        workers.append(t)
    for t in workers:
        t.join()

    return {"fetch_results": fetch_results, "all_links": all_links}
