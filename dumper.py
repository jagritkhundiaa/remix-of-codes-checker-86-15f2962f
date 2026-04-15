#!/usr/bin/env python3
# ═══════════════════════════════════════════════
#  Hijra Dumper — CC Generator + Paste Scraper
# ═══════════════════════════════════════════════
#
#  Usage:
#    python dumper.py --bin 411111          # Generate from single BIN
#    python dumper.py --bin 411111,540133   # Multi-BIN
#    python dumper.py --bin 411111 -n 500   # Generate 500 cards
#    python dumper.py --scrape              # Scrape paste sites only
#    python dumper.py --bin 411111 --scrape # Both: generate + scrape
#    python dumper.py --bin-file bins.txt   # Load BINs from file (one per line)
#    python dumper.py --bin 411111 -o dump.txt  # Custom output file
#
# ═══════════════════════════════════════════════

import argparse
import hashlib
import os
import random
import re
import sys
import time
from datetime import datetime

try:
    import requests
except ImportError:
    print("[!] Installing requests...")
    os.system(f"{sys.executable} -m pip install requests -q")
    import requests

# ── CC Pattern ──
CC_PATTERN = re.compile(
    r'\b(\d{15,16})\s*[|/\\]\s*(\d{1,2})\s*[|/\\]\s*(\d{2,4})\s*[|/\\]\s*(\d{3,4})\b'
)
# Loose pattern for raw numbers
CC_LOOSE = re.compile(
    r'\b(4\d{15}|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12})\b'
)

# ── Luhn Algorithm ──

def luhn_checksum(card: str) -> int:
    digits = [int(d) for d in card]
    odd = digits[-1::-2]
    even = digits[-2::-2]
    total = sum(odd)
    for d in even:
        d *= 2
        if d > 9:
            d -= 9
        total += d
    return total % 10


def luhn_generate(prefix: str, length: int = 16) -> str:
    """Generate a valid card number from BIN prefix using Luhn."""
    num = prefix
    while len(num) < length - 1:
        num += str(random.randint(0, 9))
    # Calculate check digit
    for check in range(10):
        candidate = num + str(check)
        if luhn_checksum(candidate) == 0:
            return candidate
    return num + "0"


def get_card_brand(card: str) -> str:
    if card.startswith("4"):
        return "VISA"
    elif card[:2] in ("51", "52", "53", "54", "55"):
        return "MASTERCARD"
    elif card[:2] in ("34", "37"):
        return "AMEX"
    elif card.startswith("6011") or card.startswith("65"):
        return "DISCOVER"
    return "UNKNOWN"


def parse_bin_input(bin_str: str) -> dict:
    """
    Parse BIN with optional fixed fields.
    Supports: 411111, 411111xxxx, 411111|MM|YY|CVV
    """
    parts = bin_str.strip().replace(" ", "").split("|")
    bin_num = re.sub(r'[xX]', '', parts[0])[:8]  # Up to 8-digit BIN
    
    result = {"bin": bin_num, "month": None, "year": None, "cvv": None}
    
    if len(parts) >= 2 and parts[1].strip():
        result["month"] = parts[1].strip()
    if len(parts) >= 3 and parts[2].strip():
        result["year"] = parts[2].strip()
    if len(parts) >= 4 and parts[3].strip():
        result["cvv"] = parts[3].strip()
    
    return result


def generate_cards(bin_info: dict, count: int = 10) -> list:
    """Generate valid CC lines from BIN info."""
    cards = []
    seen = set()
    attempts = 0
    max_attempts = count * 10
    
    # Determine card length
    length = 16
    if get_card_brand(bin_info["bin"]) == "AMEX":
        length = 15
    
    while len(cards) < count and attempts < max_attempts:
        attempts += 1
        cc = luhn_generate(bin_info["bin"], length)
        
        if cc in seen:
            continue
        seen.add(cc)
        
        # Month
        if bin_info["month"]:
            month = bin_info["month"]
        else:
            month = f"{random.randint(1, 12):02d}"
        
        # Year
        if bin_info["year"]:
            year = bin_info["year"]
        else:
            year = str(random.randint(2025, 2030))
        
        # Normalize year
        if len(year) == 4:
            year = year[2:]
        
        # CVV
        if bin_info["cvv"]:
            cvv = bin_info["cvv"]
        else:
            cvv_len = 4 if get_card_brand(cc) == "AMEX" else 3
            cvv = "".join([str(random.randint(0, 9)) for _ in range(cvv_len)])
        
        cards.append(f"{cc}|{month}|{year}|{cvv}")
    
    return cards


# ── Paste Site Scraper ──

PASTE_SOURCES = [
    # Public paste APIs / raw endpoints
    "https://rentry.co/raw/{}",
    "https://pastebin.com/raw/{}",
    "https://dpaste.org/raw/{}",
]

# Known paste listing / trending endpoints
PASTE_SEARCH_URLS = [
    "https://psbdmp.ws/api/v3/search/{}",
    "https://psbdmp.ws/api/v3/dump/{}",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/json,text/plain",
}


def scrape_paste_url(url: str, timeout: int = 10) -> list:
    """Scrape a single URL for CC patterns."""
    found = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout, verify=False)
        if resp.status_code != 200:
            return found
        
        text = resp.text
        
        # Full CC lines (cc|mm|yy|cvv)
        for match in CC_PATTERN.finditer(text):
            cc, mm, yy, cvv = match.groups()
            if luhn_checksum(cc) == 0:
                if len(yy) == 4:
                    yy = yy[2:]
                found.append(f"{cc}|{mm.zfill(2)}|{yy}|{cvv}")
        
    except Exception:
        pass
    return found


def scrape_psbdmp(keywords: list = None, max_pages: int = 3) -> list:
    """Scrape psbdmp.ws for CC dumps."""
    if keywords is None:
        keywords = ["cc", "cvv", "card", "bin", "fullz", "live"]
    
    found = []
    dump_ids = set()
    
    for kw in keywords:
        try:
            url = f"https://psbdmp.ws/api/v3/search/{kw}"
            resp = requests.get(url, headers=HEADERS, timeout=15, verify=False)
            if resp.status_code != 200:
                continue
            
            data = resp.json()
            if isinstance(data, list):
                for item in data[:20]:  # Limit per keyword
                    dump_id = item.get("id", "")
                    if dump_id and dump_id not in dump_ids:
                        dump_ids.add(dump_id)
        except Exception:
            continue
    
    # Fetch each dump
    for did in list(dump_ids)[:50]:  # Cap at 50 dumps
        try:
            url = f"https://psbdmp.ws/api/v3/dump/{did}"
            resp = requests.get(url, headers=HEADERS, timeout=10, verify=False)
            if resp.status_code == 200:
                data = resp.json()
                content = data.get("content", "")
                for match in CC_PATTERN.finditer(content):
                    cc, mm, yy, cvv = match.groups()
                    if luhn_checksum(cc) == 0:
                        if len(yy) == 4:
                            yy = yy[2:]
                        found.append(f"{cc}|{mm.zfill(2)}|{yy}|{cvv}")
            time.sleep(0.5)
        except Exception:
            continue
    
    return found


def scrape_rentry(slugs: list = None) -> list:
    """Scrape rentry.co for CC patterns."""
    if slugs is None:
        slugs = ["cc", "cards", "bins", "cvv", "dump", "live", "ccs", "fullz"]
    
    found = []
    for slug in slugs:
        try:
            url = f"https://rentry.co/raw/{slug}"
            resp = requests.get(url, headers=HEADERS, timeout=10, verify=False)
            if resp.status_code == 200:
                for match in CC_PATTERN.finditer(resp.text):
                    cc, mm, yy, cvv = match.groups()
                    if luhn_checksum(cc) == 0:
                        if len(yy) == 4:
                            yy = yy[2:]
                        found.append(f"{cc}|{mm.zfill(2)}|{yy}|{cvv}")
            time.sleep(0.3)
        except Exception:
            continue
    
    return found


def scrape_all() -> list:
    """Run all scrapers and return combined results."""
    all_ccs = []
    
    print("[*] Scraping psbdmp.ws...")
    all_ccs.extend(scrape_psbdmp())
    
    print("[*] Scraping rentry.co...")
    all_ccs.extend(scrape_rentry())
    
    return all_ccs


# ── Deduplication ──

def deduplicate(cc_list: list) -> list:
    """Remove duplicate CCs based on card number."""
    seen = set()
    unique = []
    for line in cc_list:
        cc_num = line.split("|")[0]
        if cc_num not in seen:
            seen.add(cc_num)
            unique.append(line)
    return unique


# ── BIN Lookup ──

def bin_lookup(bin6: str) -> dict:
    """Quick BIN lookup for info display."""
    try:
        resp = requests.get(
            f"https://api.voidex.dev/api/bin?bin={bin6[:6]}",
            timeout=5, verify=False
        )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "brand": data.get("brand", "?"),
                "type": data.get("type", "?"),
                "bank": data.get("bank", "?"),
                "country": data.get("country", "?"),
                "emoji": data.get("emoji", ""),
            }
    except Exception:
        pass
    return {}


# ── Main ──

def main():
    parser = argparse.ArgumentParser(
        description="Hijra Dumper — BIN Generator + Paste Scraper",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python dumper.py --bin 411111 -n 100
  python dumper.py --bin 411111,540133 -n 50
  python dumper.py --bin "411111|05|28|123" -n 200
  python dumper.py --bin-file bins.txt -n 100
  python dumper.py --scrape
  python dumper.py --bin 411111 --scrape -n 200
        """
    )
    
    parser.add_argument("--bin", "-b", help="BIN(s) comma-separated. Supports: 411111 or 411111|MM|YY|CVV")
    parser.add_argument("--bin-file", "-bf", help="File with BINs (one per line)")
    parser.add_argument("--scrape", "-s", action="store_true", help="Scrape paste sites for CCs")
    parser.add_argument("-n", "--count", type=int, default=100, help="Cards to generate per BIN (default: 100)")
    parser.add_argument("-o", "--output", default=None, help="Output file (default: dump_TIMESTAMP.txt)")
    parser.add_argument("--no-lookup", action="store_true", help="Skip BIN lookup info")
    
    args = parser.parse_args()
    
    if not args.bin and not args.bin_file and not args.scrape:
        parser.print_help()
        print("\n[!] Provide --bin, --bin-file, or --scrape")
        sys.exit(1)
    
    all_cards = []
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = args.output or f"dump_{timestamp}.txt"
    
    print("═" * 50)
    print("  [ϟ] Hijra Dumper [ϟ]")
    print("═" * 50)
    
    # ── Collect BINs ──
    bins = []
    
    if args.bin:
        for b in args.bin.split(","):
            b = b.strip()
            if b:
                bins.append(b)
    
    if args.bin_file:
        try:
            with open(args.bin_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        bins.append(line)
            print(f"[+] Loaded {len(bins)} BINs from {args.bin_file}")
        except FileNotFoundError:
            print(f"[!] File not found: {args.bin_file}")
            sys.exit(1)
    
    # ── Generate from BINs ──
    if bins:
        for raw_bin in bins:
            bin_info = parse_bin_input(raw_bin)
            
            # Show BIN info
            if not args.no_lookup:
                info = bin_lookup(bin_info["bin"])
                if info:
                    print(f"\n[ϟ] BIN: {bin_info['bin']}")
                    print(f"    Brand: {info['brand']} | Type: {info['type']}")
                    print(f"    Bank: {info['bank']}")
                    print(f"    Country: {info['country']} {info['emoji']}")
                else:
                    print(f"\n[ϟ] BIN: {bin_info['bin']} (lookup failed)")
            
            print(f"[*] Generating {args.count} cards from {bin_info['bin']}...")
            cards = generate_cards(bin_info, args.count)
            all_cards.extend(cards)
            print(f"[+] Generated {len(cards)} valid cards")
    
    # ── Scrape paste sites ──
    if args.scrape:
        print(f"\n[*] Starting paste site scraper...")
        scraped = scrape_all()
        print(f"[+] Scraped {len(scraped)} raw CCs from paste sites")
        all_cards.extend(scraped)
    
    # ── Deduplicate ──
    before = len(all_cards)
    all_cards = deduplicate(all_cards)
    dupes = before - len(all_cards)
    
    if not all_cards:
        print("\n[!] No cards found/generated")
        sys.exit(0)
    
    # ── Write output ──
    with open(output_file, "w") as f:
        for card in all_cards:
            f.write(card + "\n")
    
    print(f"\n{'═' * 50}")
    print(f"  [ϟ] Dump Complete [ϟ]")
    print(f"{'═' * 50}")
    print(f"  Total: {len(all_cards)} unique CCs")
    if dupes:
        print(f"  Dupes removed: {dupes}")
    print(f"  Output: {output_file}")
    print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'═' * 50}")


if __name__ == "__main__":
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    main()
