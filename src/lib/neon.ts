// ============= NEON TYPES & UTILITIES =============

export interface UrlAnalysis {
  url: string;
  provider: string;
  merchant: string;
  product: string;
  amount: string | null;
  currency: string;
  stripePk: string | null;
  clientSecret: string | null;
  success: boolean;
  error?: string;
}

export interface CardData {
  number: string;
  month: string;
  year: string;
  cvv: string;
}

export interface CheckResult {
  card: string;
  status: 'live' | 'charged' | 'declined' | '3ds' | 'error';
  code: string;
  message: string;
  responseTime: number;
  bin: string;
  brand: string;
}

export interface HitStats {
  total: number;
  hits: number;
  declines: number;
  errors: number;
  avgTime: number;
}

// ============= CARD GENERATOR =============

function luhnCheck(num: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = parseInt(num[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function getCardBrand(num: string): string {
  if (/^3[47]/.test(num)) return 'amex';
  if (/^5[1-5]/.test(num) || /^2[2-7]/.test(num)) return 'mastercard';
  if (/^4/.test(num)) return 'visa';
  if (/^6(?:011|5)/.test(num)) return 'discover';
  return 'unknown';
}

export function generateCard(binInput: string): CardData | null {
  if (!binInput || binInput.length < 4) return null;

  const parts = binInput.split('|');
  const binPattern = parts[0].replace(/[^0-9xX]/g, '');
  const testBin = binPattern.replace(/[xX]/g, '0');
  const brand = getCardBrand(testBin);
  const targetLen = brand === 'amex' ? 15 : 16;
  const cvvLen = brand === 'amex' ? 4 : 3;

  // Build card number
  let card = '';
  for (const c of binPattern) {
    card += /[xX]/.test(c) ? String(Math.floor(Math.random() * 10)) : c;
  }

  const remaining = targetLen - card.length - 1;
  for (let i = 0; i < remaining; i++) {
    card += String(Math.floor(Math.random() * 10));
  }

  // Luhn check digit
  for (let i = 0; i <= 9; i++) {
    if (luhnCheck(card + String(i))) {
      card += String(i);
      break;
    }
  }

  if (card.length < targetLen) card += '0';

  // Month
  let month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  if (parts[1] && parts[1].toLowerCase() !== 'xx') {
    month = parts[1].padStart(2, '0');
  }

  // Year
  const currentYear = new Date().getFullYear();
  let year = String(currentYear + Math.floor(Math.random() * 5) + 1).slice(-2);
  if (parts[2] && parts[2].toLowerCase() !== 'xx') {
    year = parts[2].padStart(2, '0');
  }

  // CVV
  let cvv = Array.from({ length: cvvLen }, () => String(Math.floor(Math.random() * 10))).join('');
  if (parts[3] && !/^x+$/i.test(parts[3])) {
    cvv = parts[3].padStart(cvvLen, '0');
  }

  return { number: card, month, year, cvv };
}

export function generateCards(binInput: string, count: number): CardData[] {
  const cards: CardData[] = [];
  for (let i = 0; i < count; i++) {
    const card = generateCard(binInput);
    if (card) cards.push(card);
  }
  return cards;
}

export function parseCardLine(line: string): CardData | null {
  const parts = line.trim().split('|');
  if (parts.length < 4) return null;
  const [number, month, year, cvv] = parts;
  if (!number || number.length < 13 || !month || !year || !cvv) return null;
  return {
    number: number.replace(/\s/g, ''),
    month: month.padStart(2, '0'),
    year: year.padStart(2, '0'),
    cvv,
  };
}

export const PROVIDER_LABELS: Record<string, string> = {
  stripe: 'Stripe',
  checkoutcom: 'Checkout.com',
  shopify: 'Shopify',
  paypal: 'PayPal',
  braintree: 'Braintree',
  adyen: 'Adyen',
  square: 'Square',
  mollie: 'Mollie',
  klarna: 'Klarna',
  authorizenet: 'Authorize.Net',
  woocommerce: 'WooCommerce',
  bigcommerce: 'BigCommerce',
  wix: 'Wix',
  ecwid: 'Ecwid',
  unknown: 'Unknown',
};
