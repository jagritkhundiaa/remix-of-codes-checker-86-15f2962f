// ============= NEON TYPES & UTILITIES =============

export interface UrlAnalysis {
  url: string;
  provider: string;
  merchant: string;
  product: string;
  productUrl: string | null;
  amount: string | null;
  currency: string;
  stripePk: string | null;
  clientSecret: string | null;
  status?: string;
  success: boolean;
  error?: string;
  logs?: string[];
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
  mode?: string;
  logs?: string[];
}

export interface HitStats {
  total: number;
  hits: number;
  declines: number;
  errors: number;
  avgTime: number;
}

export interface NeonSettings {
  hitterEnabled: boolean;
  bypasserEnabled: boolean;
  autoTelegram: boolean;
  delayMs: number;
}

export const DEFAULT_SETTINGS: NeonSettings = {
  hitterEnabled: true,
  bypasserEnabled: false,
  autoTelegram: true,
  delayMs: 800,
};

export function loadSettings(): NeonSettings {
  try {
    const saved = localStorage.getItem('neon_settings');
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: NeonSettings) {
  localStorage.setItem('neon_settings', JSON.stringify(settings));
}

export interface AccessKeyData {
  id: string;
  key: string;
  label: string | null;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
  expires_at: string | null;
  usage_count: number;
}

export interface ProxyData {
  id: string;
  proxy: string;
  protocol: string;
  is_active: boolean;
  last_checked: string | null;
  last_status: string | null;
  success_count: number;
  fail_count: number;
  created_at: string;
}

export interface LogEntry {
  id: string;
  created_at: string;
  access_key: string;
  card_masked: string;
  bin: string;
  brand: string;
  status: string;
  code: string;
  message: string;
  merchant: string;
  amount: string | null;
  response_time: number;
  mode: string;
  provider: string;
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

  let card = '';
  for (const c of binPattern) {
    card += /[xX]/.test(c) ? String(Math.floor(Math.random() * 10)) : c;
  }

  const remaining = targetLen - card.length - 1;
  for (let i = 0; i < remaining; i++) {
    card += String(Math.floor(Math.random() * 10));
  }

  for (let i = 0; i <= 9; i++) {
    if (luhnCheck(card + String(i))) {
      card += String(i);
      break;
    }
  }

  if (card.length < targetLen) card += '0';

  let month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  if (parts[1] && parts[1].toLowerCase() !== 'xx') {
    month = parts[1].padStart(2, '0');
  }

  const currentYear = new Date().getFullYear();
  let year = String(currentYear + Math.floor(Math.random() * 5) + 1).slice(-2);
  if (parts[2] && parts[2].toLowerCase() !== 'xx') {
    year = parts[2].padStart(2, '0');
  }

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
