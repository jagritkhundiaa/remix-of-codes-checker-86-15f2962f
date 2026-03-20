"""
Microsoft Store Purchaser -- Python terminal version
Uses the SAME login flow as ms_puller.py.
Two purchase flows:
  1. WLID Store Checkout (primary)
  2. XBL3.0 Xbox Live API (fallback)
Supports accepting an external session to avoid duplicate logins.
"""
import re
import uuid
import time
import json
import threading
import urllib.parse
import requests

# ── Session helpers (same pattern as puller) ──────────────────

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0"

DEFAULT_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class CookieSession:
    """Simple cookie-preserving session mirroring the JS sessionFetch."""
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)

    def get(self, url, **kwargs):
        return self.session.get(url, allow_redirects=True, timeout=20, **kwargs)

    def post(self, url, data=None, **kwargs):
        return self.session.post(url, data=data, allow_redirects=True, timeout=20, **kwargs)


# ── PPFT / urlPost extraction (same as puller) ────────────────

def _extract_ppft_urlpost(page_text):
    ppft = ""
    url_post = ""

    m = re.search(r'"sFTTag":"[^"]*value=\\"([^"\\]+)\\"', page_text)
    if m:
        ppft = m.group(1)
    if not ppft:
        m = re.search(r'name="PPFT"[^>]*value="([^"]+)"', page_text)
        if m:
            ppft = m.group(1)
    if not ppft:
        try:
            ppft = page_text.split('name="PPFT" id="i0327" value="')[1].split('"')[0]
        except (IndexError, ValueError):
            pass

    m = re.search(r'"urlPost":"([^"]+)"', page_text)
    if m:
        url_post = m.group(1)
    if not url_post:
        try:
            url_post = page_text.split("urlPost:'")[1].split("'")[0]
        except (IndexError, ValueError):
            pass

    return ppft, url_post


# ── Retry helper ──────────────────────────────────────────────

def _with_retry(fn, max_attempts=3):
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            result = fn(attempt)
            return result
        except Exception as ex:
            last_err = ex
            if attempt < max_attempts:
                time.sleep(1.5 * attempt)
    raise last_err


# ═══════════════════════════════════════════════════════════════
#  WLID Store Login (same flow as Puller)
# ═══════════════════════════════════════════════════════════════

def login_to_store(email, password):
    """Login to Microsoft Store and get WLID token."""
    cs = CookieSession()
    try:
        bk = int(time.time())
        init_url = (
            f"https://login.live.com/login.srf?wa=wsignin1.0&rpsnv=19&ct={bk}"
            f"&rver=7.0.6738.0&wp=MBI_SSL"
            f"&wreply=https://account.microsoft.com/auth/complete-signin"
            f"&lc=1033&id=292666&username={urllib.parse.quote(email)}"
        )
        r = cs.get(init_url)
        ppft, url_post = _extract_ppft_urlpost(r.text)
        if not ppft or not url_post:
            return None, "Failed to extract PPFT/urlPost"

        # Submit credentials
        login_data = {
            "i13": "1", "login": email, "loginfmt": email,
            "type": "11", "LoginOptions": "1", "passwd": password,
            "ps": "2", "PPFT": ppft, "PPSX": "PassportR",
            "NewUser": "1", "FoundMSAs": "", "fspost": "0",
            "i21": "0", "CookieDisclosure": "0", "IsFidoSupported": "0",
            "isSignupPost": "0", "isRecoveryAttemptPost": "0", "i19": "9960",
        }
        r = cs.post(url_post, data=login_data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"})

        cleaned = r.text.replace("\\", "")
        if "sErrTxt" in cleaned or "account or password is incorrect" in cleaned:
            return None, "LOGIN_FAILED"
        if "identity/confirm" in cleaned or "Abuse" in cleaned:
            return None, "LOGIN_FAILED"

        # Follow redirect chain
        reurl_m = re.search(r'replace\("([^"]+)"', cleaned)
        if reurl_m:
            r = cs.get(reurl_m.group(1))
            action_m = re.search(r'<form.*?action="(.*?)".*?>', r.text)
            if action_m:
                inputs = re.findall(r'<input.*?name="(.*?)".*?value="(.*?)".*?>', r.text)
                form_data = {n: v for n, v in inputs}
                cs.post(action_m.group(1), data=form_data,
                        headers={"Content-Type": "application/x-www-form-urlencoded"})

        # Warmup: visit store pages to stabilize session
        try:
            cs.get("https://account.microsoft.com/billing/redeem")
        except Exception:
            pass

        try:
            cs.get("https://buynowui.production.store-web.dynamics.com/akam/13/79883e11")
        except Exception:
            pass

        # Acquire store auth token
        token_r = cs.session.get(
            "https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Referer": "https://account.microsoft.com/billing/redeem",
            },
            timeout=20,
        )
        if token_r.status_code != 200:
            return None, f"SESSION_INVALID"

        token_data = token_r.json()
        if not token_data or not token_data[0].get("token"):
            return None, "SESSION_INVALID"

        return {
            "method": "wlid",
            "token": token_data[0]["token"],
            "session": cs,
            "email": email,
        }, None

    except Exception as ex:
        return None, str(ex)


# ── Session validation ────────────────────────────────────────

def validate_session(session):
    """Check if an existing session is still valid. Returns (valid, refreshed_session)."""
    if not session:
        return False
    if session.get("method") == "wlid":
        cs = session.get("session")
        if not cs or not session.get("token"):
            return False
        try:
            r = cs.session.get(
                "https://account.microsoft.com/auth/acquire-onbehalf-of-token?scopes=MSComServiceMBISSL",
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                    "Referer": "https://account.microsoft.com/billing/redeem",
                },
                timeout=15,
            )
            if r.status_code == 200:
                data = r.json()
                if data and data[0].get("token"):
                    session["token"] = data[0]["token"]
                    return True
        except Exception:
            pass
        return False
    if session.get("method") == "xbl":
        return bool(session.get("xbl_auth"))
    return False


# ═══════════════════════════════════════════════════════════════
#  XBL3.0 Fallback Login
# ═══════════════════════════════════════════════════════════════

XBOX_OAUTH_URL = (
    "https://login.live.com/oauth20_authorize.srf"
    "?client_id=00000000402B5328"
    "&redirect_uri=https://login.live.com/oauth20_desktop.srf"
    "&scope=service::user.auth.xboxlive.com::MBI_SSL"
    "&display=touch&response_type=token&locale=en"
)


def login_xbox_live(email, password):
    """XBL OAuth login -- returns xblAuth string or None."""
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    try:
        r = s.get(XBOX_OAUTH_URL, allow_redirects=True, timeout=15)
        ppft, url_post = _extract_ppft_urlpost(r.text)
        if not ppft or not url_post:
            return None, "LOGIN_FAILED"

        r = s.post(url_post, data={
            "login": email, "loginfmt": email,
            "passwd": password, "PPFT": ppft,
        }, headers={"Content-Type": "application/x-www-form-urlencoded"},
            allow_redirects=True, timeout=15)

        final_url = str(r.url)
        access_token = ""
        if "access_token=" in final_url:
            access_token = final_url.split("access_token=")[1].split("&")[0]
        if not access_token and "#" in final_url:
            fragment = final_url.split("#", 1)[1]
            params = urllib.parse.parse_qs(fragment)
            access_token = params.get("access_token", [""])[0]

        if not access_token:
            return None, "LOGIN_FAILED"

        # XBL User Token
        xbl_r = requests.post("https://user.auth.xboxlive.com/user/authenticate",
                              json={
                                  "RelyingParty": "http://auth.xboxlive.com",
                                  "TokenType": "JWT",
                                  "Properties": {
                                      "AuthMethod": "RPS",
                                      "SiteName": "user.auth.xboxlive.com",
                                      "RpsTicket": access_token,
                                  },
                              }, timeout=15)
        if xbl_r.status_code != 200:
            return None, f"LOGIN_FAILED"

        user_token = xbl_r.json()["Token"]

        # XSTS Token
        xsts_r = requests.post("https://xsts.auth.xboxlive.com/xsts/authorize",
                               json={
                                   "RelyingParty": "http://xboxlive.com",
                                   "TokenType": "JWT",
                                   "Properties": {
                                       "UserTokens": [user_token],
                                       "SandboxId": "RETAIL",
                                   },
                               }, timeout=15)
        if xsts_r.status_code != 200:
            return None, f"LOGIN_FAILED"

        xsts_data = xsts_r.json()
        uhs = xsts_data.get("DisplayClaims", {}).get("xui", [{}])[0].get("uhs", "")
        xsts_token = xsts_data["Token"]

        return {
            "method": "xbl",
            "xbl_auth": f"XBL3.0 x={uhs};{xsts_token}",
            "email": email,
        }, None

    except Exception as ex:
        return None, str(ex)


# ── Product Search & Details ──────────────────────────────────

def search_products(query, market="US"):
    """Search Microsoft Store for products."""
    try:
        r = requests.get(
            f"https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest"
            f"?market={market}&languages=en-US&query={urllib.parse.quote(query)}&mediaType=games,apps",
            headers={"User-Agent": UA, "Accept": "application/json"},
            timeout=15,
        )
        if r.status_code == 200:
            data = r.json()
            results = []
            for family in data.get("ResultSets", []):
                for suggest in family.get("Suggests", []):
                    pid = suggest.get("ProductId") or ""
                    if not pid:
                        for meta in suggest.get("Metas", []):
                            if meta.get("Key") == "BigCatId":
                                pid = meta.get("Value", "")
                                break
                    if pid:
                        results.append({
                            "title": suggest.get("Title", "Unknown"),
                            "productId": pid,
                            "type": suggest.get("Type") or family.get("Type", ""),
                        })
            if results:
                return results

        # Fallback: search API
        r2 = requests.get(
            f"https://displaycatalog.mp.microsoft.com/v7.0/products/search"
            f"?market={market}&languages=en-US&query={urllib.parse.quote(query)}&mediaType=games,apps&count=10",
            headers={"User-Agent": UA, "Accept": "application/json"},
            timeout=15,
        )
        if r2.status_code == 200:
            data2 = r2.json()
            return [
                {
                    "title": p.get("LocalizedProperties", [{}])[0].get("ProductTitle", "Unknown"),
                    "productId": p.get("ProductId", ""),
                    "type": p.get("ProductType", ""),
                }
                for p in data2.get("Products", [])
                if p.get("ProductId")
            ]
        return []
    except Exception:
        return []


def get_product_details(product_id, market="US"):
    """Get product details including SKUs."""
    try:
        r = requests.get(
            f"https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds={product_id}&market={market}&languages=en-US",
            headers={"User-Agent": UA, "Accept": "application/json"},
            timeout=15,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        if not data.get("Products"):
            return None

        product = data["Products"][0]
        title = product.get("LocalizedProperties", [{}])[0].get("ProductTitle", "Unknown")

        skus = []
        for dsa in product.get("DisplaySkuAvailabilities", []):
            sku = dsa.get("Sku", {})
            sku_id = sku.get("SkuId")
            sku_title = sku.get("LocalizedProperties", [{}])[0].get("SkuTitle", title)
            for avail in dsa.get("Availabilities", []):
                price = avail.get("OrderManagementData", {}).get("Price", {})
                if price:
                    skus.append({
                        "skuId": sku_id,
                        "availabilityId": avail.get("AvailabilityId"),
                        "title": sku_title,
                        "price": price.get("ListPrice", 0),
                        "currency": price.get("CurrencyCode", "USD"),
                    })

        return {"productId": product_id, "title": title, "skus": skus}
    except Exception:
        return None


# ── Reference ID (same as JS) ────────────────────────────────

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


# ── Payment instrument selection ─────────────────────────────

def _select_payment_instrument(instruments):
    if not instruments:
        return None

    # Priority 1: balance
    for pi in instruments:
        if pi.get("type") in ("balance",) or pi.get("paymentMethodFamily") == "balance":
            return pi

    # Priority 2: stored value
    for pi in instruments:
        if pi.get("type") in ("storedValue",) or pi.get("paymentMethodFamily") == "storedValue":
            return pi

    # Priority 3: first valid (skip expired/invalid)
    for pi in instruments:
        if pi.get("isExpired") or pi.get("isInvalid") or pi.get("isDisabled"):
            continue
        return pi

    return instruments[0] if instruments else None


# ── WLID Purchase (with retry) ───────────────────────────────

def _get_store_cart_state(wlid_session):
    try:
        ms_cv = "xddT7qMNbECeJpTq.6.2"
        token = wlid_session["token"]
        cs = wlid_session["session"]

        payload = urllib.parse.urlencode({
            "data": '{"usePurchaseSdk":true}',
            "market": "US", "cV": ms_cv, "locale": "en-GB",
            "msaTicket": token, "pageFormat": "full",
            "urlRef": "https://account.microsoft.com/billing/redeem",
            "isRedeem": "true", "clientType": "AccountMicrosoftCom",
            "layout": "Inline", "cssOverride": "AMC", "scenario": "redeem",
            "timeToInvokeIframe": "4977", "sdkVersion": "VERSION_PLACEHOLDER",
        })
        r = cs.post(
            f"https://www.microsoft.com/store/purchase/buynowui/redeemnow?ms-cv={ms_cv}&market=US&locale=en-GB&clientName=AccountMicrosoftCom",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        m = re.search(r'window\.__STORE_CART_STATE__=({.*?});', r.text, re.DOTALL)
        if not m:
            return None
        state = json.loads(m.group(1))
        ctx = state.get("appContext", {})
        return {
            "ms_cv": ctx.get("cv", ms_cv),
            "correlation_id": ctx.get("correlationId", ""),
            "tracking_id": ctx.get("trackingId", ""),
            "vector_id": ctx.get("muid", ""),
            "muid": ctx.get("alternativeMuid", ""),
        }
    except Exception:
        return None


def _purchase_via_wlid(wlid_session, product_id, sku_id, availability_id, store_state):
    cs = wlid_session["session"]
    token = wlid_session["token"]

    hdrs = {
        "x-ms-tracking-id": store_state["tracking_id"],
        "authorization": f"WLID1.0=t={token}",
        "x-ms-client-type": "MicrosoftCom",
        "x-ms-market": "US",
        "ms-cv": store_state["ms_cv"],
        "x-ms-vector-id": store_state["vector_id"],
        "x-ms-correlation-id": store_state["correlation_id"],
        "content-type": "application/json",
        "x-authorization-muid": store_state["muid"],
        "accept": "*/*",
    }

    # Step 1: Add to cart (with retry)
    try:
        def add_to_cart(attempt):
            hdrs["x-ms-reference-id"] = _generate_reference_id()
            r = cs.session.post(
                "https://buynow.production.store-web.dynamics.com/v1.0/Cart/AddToCart",
                headers=hdrs,
                json={"productId": product_id, "skuId": sku_id,
                      "availabilityId": availability_id, "quantity": 1},
                timeout=20,
            )
            if r.status_code == 429:
                raise Exception("RATE_LIMITED")
            data = r.json()
            cart_err = (data.get("events", {}).get("cart") or [{}])[0]
            if cart_err.get("type") == "error":
                reason = (cart_err.get("data") or {}).get("reason", "Cart error")
                if reason == "AlreadyOwned":
                    return {"__terminal": True, "success": False, "error": "ALREADY_OWNED"}
                if reason == "NotAvailableInMarket":
                    return {"__terminal": True, "success": False, "error": "REGION_RESTRICTED"}
                if attempt >= 3:
                    return {"__terminal": True, "success": False, "error": reason}
                raise Exception(reason)
            return data

        add_data = _with_retry(add_to_cart, 3)
    except Exception as ex:
        return {"success": False, "error": f"AddToCart: {ex}"}

    if add_data.get("__terminal"):
        return add_data

    # Step 2: Prepare purchase (with retry)
    try:
        def prepare(attempt):
            hdrs["x-ms-reference-id"] = _generate_reference_id()
            r = cs.session.post(
                "https://buynow.production.store-web.dynamics.com/v1.0/Purchase/PreparePurchase",
                headers=hdrs, json={}, timeout=20,
            )
            if r.status_code == 429:
                raise Exception("RATE_LIMITED")
            data = r.json()
            prep_err = (data.get("events", {}).get("cart") or [{}])[0]
            if prep_err.get("type") == "error":
                reason = (prep_err.get("data") or {}).get("reason", "Prepare error")
                if attempt >= 3:
                    return {"__terminal": True, "success": False, "error": reason}
                raise Exception(reason)
            return data

        prep_data = _with_retry(prepare, 3)
    except Exception as ex:
        return {"success": False, "error": f"Prepare: {ex}"}

    if prep_data.get("__terminal"):
        return prep_data

    pis = prep_data.get("paymentInstruments", [])
    total = prep_data.get("legalTextInfo", {}).get("orderTotal") or prep_data.get("orderTotal", "N/A")

    # Step 3: Select best payment method
    selected_pi = _select_payment_instrument(pis)
    if not selected_pi:
        return {"success": False, "error": "INSUFFICIENT_BALANCE"}

    # Step 4: Complete purchase (max 2 retries to avoid double-charge)
    try:
        def complete(attempt):
            hdrs["x-ms-reference-id"] = _generate_reference_id()
            r = cs.session.post(
                "https://buynow.production.store-web.dynamics.com/v1.0/Purchase/CompletePurchase",
                headers=hdrs, json={"paymentInstrumentId": selected_pi["id"]}, timeout=20,
            )
            if r.status_code == 429:
                raise Exception("RATE_LIMITED")
            data = r.json()
            comp_err = (data.get("events", {}).get("cart") or [{}])[0]
            if comp_err.get("type") == "error":
                reason = (comp_err.get("data") or {}).get("reason", "Purchase failed")
                if reason == "InsufficientFunds":
                    return {"__terminal": True, "success": False, "error": "INSUFFICIENT_BALANCE"}
                if reason == "PaymentDeclined":
                    return {"__terminal": True, "success": False, "error": "PAYMENT_FAILED"}
                if reason == "AlreadyOwned":
                    return {"__terminal": True, "success": False, "error": "ALREADY_OWNED"}
                return {"__terminal": True, "success": False, "error": reason}

            # Strict success: require orderId or purchase event
            order_id = data.get("orderId")
            if order_id:
                return {"success": True, "orderId": order_id, "total": total, "method": "WLID Store"}
            if data.get("events", {}).get("purchase"):
                return {"success": True, "orderId": "Completed", "total": total, "method": "WLID Store"}

            if attempt >= 2:
                return {"__terminal": True, "success": False, "error": "No order confirmation received"}
            raise Exception("Ambiguous response")

        comp_data = _with_retry(complete, 2)
    except Exception as ex:
        return {"success": False, "error": f"Complete: {ex}"}

    return comp_data


# ── XBL3.0 Purchase (with retry) ─────────────────────────────

def _purchase_via_xbl(xbl_session, product_id, sku_id):
    try:
        def attempt_purchase(attempt):
            r = requests.post(
                "https://purchase.xboxlive.com/v7.0/purchases",
                headers={
                    "Authorization": xbl_session["xbl_auth"],
                    "Content-Type": "application/json",
                    "x-xbl-contract-version": "1",
                    "User-Agent": UA,
                },
                json={"purchaseRequest": {"productId": product_id, "skuId": sku_id, "quantity": 1}},
                timeout=15,
            )
            if 200 <= r.status_code < 300:
                data = r.json() if r.text else {}
                order_id = data.get("orderId", "XBL-Completed")
                return {"success": True, "orderId": order_id, "total": "N/A", "method": "XBL3.0"}

            err_data = {}
            try:
                err_data = r.json()
            except Exception:
                pass

            code = err_data.get("code", "")
            desc = err_data.get("description", err_data.get("message", ""))

            if code == "AlreadyOwned" or "already own" in desc:
                return {"__terminal": True, "success": False, "error": "ALREADY_OWNED", "method": "XBL3.0"}
            if code == "InsufficientFunds":
                return {"__terminal": True, "success": False, "error": "INSUFFICIENT_BALANCE", "method": "XBL3.0"}
            if r.status_code == 429:
                raise Exception("RATE_LIMITED")

            if attempt >= 2:
                return {"__terminal": True, "success": False,
                        "error": f"{code or r.status_code} - {desc}".strip(), "method": "XBL3.0"}
            raise Exception(f"HTTP {r.status_code}")

        result = _with_retry(attempt_purchase, 2)
        return result
    except Exception as ex:
        return {"success": False, "error": str(ex), "method": "XBL3.0"}


# ═══════════════════════════════════════════════════════════════
#  Main Pipeline
#  Accepts optional external_session to reuse an existing login.
# ═══════════════════════════════════════════════════════════════

def purchase_items(accounts, product_id, sku_id, availability_id,
                   on_progress=None, stop_event=None, external_session=None):
    """Purchase a product using multiple accounts. WLID first, XBL3.0 fallback."""
    parsed = []
    for a in accounts:
        i = a.find(":")
        if i == -1:
            parsed.append((a, ""))
        else:
            parsed.append((a[:i], a[i + 1:]))

    results = []

    for idx, (email, password) in enumerate(parsed):
        if stop_event and stop_event.is_set():
            break

        if on_progress:
            on_progress("login", {"email": email, "done": idx, "total": len(parsed)})

        # Try to reuse external session if provided and matches this email
        session = None
        purchase_result = None

        if external_session and external_session.get("email") == email:
            if validate_session(external_session):
                session = external_session
            else:
                session = None  # Will fall through to login

        # Login if no valid session
        if not session:
            session, err = login_to_store(email, password)

        if session:
            if on_progress:
                on_progress("cart", {"email": email, "done": idx, "total": len(parsed)})

            store_state = _get_store_cart_state(session)
            if store_state:
                if on_progress:
                    on_progress("purchase", {"email": email, "done": idx, "total": len(parsed)})
                purchase_result = _purchase_via_wlid(session, product_id, sku_id, availability_id, store_state)

        # Fallback to XBL3.0
        if not purchase_result or not purchase_result.get("success"):
            wlid_error = (purchase_result or {}).get("error", "SESSION_INVALID")

            xbl_session, xbl_err = login_xbox_live(email, password)
            if xbl_session:
                if on_progress:
                    on_progress("purchase", {"email": email, "done": idx, "total": len(parsed), "method": "XBL3.0"})
                purchase_result = _purchase_via_xbl(xbl_session, product_id, sku_id)
                if not purchase_result.get("success"):
                    purchase_result["error"] = f"WLID: {wlid_error} | XBL: {purchase_result['error']}"
            else:
                purchase_result = {"success": False, "error": f"WLID: {wlid_error} | XBL: LOGIN_FAILED"}

        # Clean up terminal marker
        if purchase_result and "__terminal" in purchase_result:
            del purchase_result["__terminal"]

        results.append({"email": email, **purchase_result})

        if on_progress:
            on_progress("result", {"email": email, **purchase_result, "done": idx + 1, "total": len(parsed)})

        if idx < len(parsed) - 1:
            time.sleep(2)

    return results


# ═══════════════════════════════════════════════════════════════
#  CLI entry point
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys
    import os

    print("=" * 60)
    print("  Microsoft Store Purchaser")
    print("  made by talkneon")
    print("=" * 60)
    print()

    # Load accounts
    accounts_file = input("Accounts file path (email:pass): ").strip()
    if not os.path.exists(accounts_file):
        print(f"[ERROR] File not found: {accounts_file}")
        sys.exit(1)

    with open(accounts_file, "r") as f:
        accounts = [l.strip() for l in f if ":" in l.strip()]

    if not accounts:
        print("[ERROR] No valid accounts found")
        sys.exit(1)

    print(f"[INFO] Loaded {len(accounts)} accounts")

    # Product input
    product_input = input("Product ID, URL, or search query: ").strip()
    if not product_input:
        print("[ERROR] No product specified")
        sys.exit(1)

    # Resolve product ID
    product_id = product_input
    url_match = re.search(r'/store/[^/]+/([a-zA-Z0-9]{12})', product_input) or re.search(r'/p/([a-zA-Z0-9]{12})', product_input)
    if url_match:
        product_id = url_match.group(1)

    if len(product_id) > 12 or " " in product_id:
        print(f"\n[SEARCH] Searching for: {product_id}")
        results = search_products(product_id)
        if not results:
            print("[ERROR] No products found")
            sys.exit(1)
        print()
        for i, r in enumerate(results[:10]):
            print(f"  {i + 1}. {r['title']}")
            print(f"     ID: {r['productId']}  Type: {r['type']}")
        print()
        choice = input("Enter product number or ID: ").strip()
        if choice.isdigit() and 1 <= int(choice) <= len(results):
            product_id = results[int(choice) - 1]["productId"]
        else:
            product_id = choice

    # Get product details
    print(f"\n[INFO] Fetching product details for: {product_id}")
    product = get_product_details(product_id)
    if not product:
        print("[ERROR] Product not found -- PRODUCT_INVALID")
        sys.exit(1)
    if not product.get("skus"):
        print("[ERROR] No purchasable SKUs found -- PRODUCT_INVALID")
        sys.exit(1)

    sku = product["skus"][0]
    print(f"  Product: {product['title']}")
    print(f"  Price:   {sku['price']} {sku['currency']}")
    print(f"  SKU:     {sku['skuId']}")
    print()

    confirm = input("Proceed with purchase? (y/n): ").strip().lower()
    if confirm != "y":
        print("[INFO] Cancelled")
        sys.exit(0)

    print()
    purchased = 0
    failed = 0

    def progress_cb(phase, detail):
        nonlocal purchased, failed
        email = detail.get("email", "")
        done = detail.get("done", 0)
        total = detail.get("total", len(accounts))

        if phase == "login":
            print(f"  [{done + 1}/{total}] Logging in: {email}")
        elif phase == "cart":
            print(f"           Loading cart...")
        elif phase == "purchase":
            method = detail.get("method", "WLID")
            print(f"           Purchasing via {method}...")
        elif phase == "result":
            if detail.get("success"):
                purchased += 1
                order_id = detail.get("orderId", "OK")
                print(f"           [+] Success -- Order: {order_id}")
            else:
                failed += 1
                error = detail.get("error", "Unknown error")
                print(f"           [x] Failed -- {error}")

    results = purchase_items(
        accounts, product_id, sku["skuId"], sku.get("availabilityId", ""),
        on_progress=progress_cb,
    )

    # Save results
    os.makedirs("results", exist_ok=True)
    success_results = [r for r in results if r.get("success")]
    failed_results = [r for r in results if not r.get("success")]

    if success_results:
        with open("results/purchased.txt", "w") as f:
            for r in success_results:
                f.write(f"{r['email']} | {r.get('orderId', 'OK')} | {r.get('total', 'N/A')}\n")

    if failed_results:
        with open("results/purchase_failed.txt", "w") as f:
            for r in failed_results:
                f.write(f"{r['email']} | {r.get('error', 'Failed')}\n")

    print()
    print("=" * 60)
    print(f"  Purchase Complete")
    print(f"  Product:    {product['title']}")
    print(f"  Purchased:  {purchased}")
    print(f"  Failed:     {failed}")
    print(f"  Total:      {len(results)}")
    print("=" * 60)
