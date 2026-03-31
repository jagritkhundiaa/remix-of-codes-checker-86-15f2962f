import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
];

// ============= DEEP SCRIPT EXTRACTION (from real DLX hitter) =============
function extractFromScripts(html: string): { amount: number | null; product: string | null; merchant: string | null; productUrl: string | null } {
  const result: { amount: number | null; product: string | null; merchant: string | null; productUrl: string | null } = {
    amount: null, product: null, merchant: null, productUrl: null,
  };

  const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptPattern.exec(html)) !== null) {
    const script = scriptMatch[1];

    const patterns: [RegExp, string][] = [
      [/window\.__STRIPE__\s*=\s*(\{[\s\S]*?\});/, 'json'],
      [/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/, 'json'],
      [/var\s+stripePaymentData\s*=\s*(\{[\s\S]*?\});/, 'json'],
      [/"paymentIntent":(\{[\s\S]*?\})/, 'json'],
      [/"paymentMethod":(\{[\s\S]*?\})/, 'json'],
      [/"amount":\s*(\d+)/, 'amount'],
      [/"name":\s*"([^"]+)"/, 'name'],
      [/"business_name":\s*"([^"]+)"/, 'business'],
      [/"product_url":\s*"([^"]+)"/, 'product_url'],
    ];

    for (const [pat, key] of patterns) {
      const m = pat.exec(script);
      if (!m) continue;
      try {
        if (key === 'json') {
          const data = JSON.parse(m[1]);
          deepExtract(data, result);
        } else if (key === 'amount') {
          if (!result.amount) result.amount = parseInt(m[1]);
        } else if (key === 'name') {
          if (!result.product) result.product = m[1];
        } else if (key === 'business') {
          if (!result.merchant) result.merchant = m[1];
        } else if (key === 'product_url') {
          if (!result.productUrl) result.productUrl = m[1];
        }
      } catch { /* skip parse errors */ }
    }
  }

  return result;
}

function deepExtract(obj: unknown, result: { amount: number | null; product: string | null; merchant: string | null; productUrl: string | null }): void {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>;
    if ('amount' in o && typeof o.amount === 'number') {
      if (!result.amount) result.amount = o.amount;
    }
    if ('name' in o && typeof o.name === 'string' && o.name.length > 2) {
      if (!result.product) result.product = o.name;
    }
    if ('business_name' in o && typeof o.business_name === 'string') {
      if (!result.merchant) result.merchant = o.business_name;
    }
    if ('display_name' in o && typeof o.display_name === 'string') {
      if (!result.merchant) result.merchant = o.display_name;
    }
    if ('product_url' in o && typeof o.product_url === 'string') {
      if (!result.productUrl) result.productUrl = o.product_url;
    }
    if ('merchant_name' in o && typeof o.merchant_name === 'string') {
      if (!result.merchant) result.merchant = o.merchant_name;
    }
    if ('statement_descriptor' in o && typeof o.statement_descriptor === 'string') {
      if (!result.merchant) result.merchant = o.statement_descriptor;
    }
    for (const v of Object.values(o)) {
      deepExtract(v, result);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      deepExtract(item, result);
    }
  }
}

// ============= PROVIDER DETECTION (exact match from real script) =============
function detectProvider(url: string, html: string): string {
  // URL-based checks first
  if (url.includes('stripe.com')) return 'stripe';
  if (url.includes('checkout.com')) return 'checkoutcom';
  if (url.includes('shopify.com') || url.includes('myshopify.com')) return 'shopify';
  if (url.includes('paypal.com')) return 'paypal';
  if (url.includes('braintree') || url.includes('braintreegateway.com')) return 'braintree';
  if (url.includes('adyen.com') || url.includes('adyen')) return 'adyen';
  if (url.includes('squareup.com') || url.includes('square')) return 'square';
  if (url.includes('mollie.com')) return 'mollie';
  if (url.includes('klarna.com')) return 'klarna';
  if (url.includes('authorize.net') || url.includes('authorizenet')) return 'authorizenet';

  // HTML content checks
  if (html) {
    if (html.includes('stripe.com') || html.includes('pk_live_') || html.includes('pk_test_')) return 'stripe';
    if (html.includes('checkout.com') || html.includes('Frames')) return 'checkoutcom';
    if (html.includes('Shopify') || html.includes('window.Shopify')) return 'shopify';
    if (html.includes('paypal') || html.includes('window.paypal')) return 'paypal';
    if (html.includes('braintree') || html.includes('Braintree') || html.includes('braintreegateway')) return 'braintree';
    if (html.includes('adyen') || html.includes('Adyen') || html.includes('checkoutshopper')) return 'adyen';
    if (html.includes('squareup') || html.includes('Square')) return 'square';
    if (html.includes('mollie') || html.includes('Mollie')) return 'mollie';
    if (html.includes('klarna') || html.includes('Klarna')) return 'klarna';
    if (html.includes('authorize.net') || html.includes('Authorize.Net')) return 'authorizenet';
    if (html.includes('woocommerce') || html.includes('wc-')) return 'woocommerce';
    if (html.includes('bigcommerce')) return 'bigcommerce';
    if (html.includes('wix.com')) return 'wix';
    if (html.includes('ecwid')) return 'ecwid';
  }

  return 'unknown';
}

// ============= EXTRACTION FUNCTIONS (enhanced from real script) =============
function extractStripePk(html: string): string | null {
  const match = html.match(/pk_(live|test)_[a-zA-Z0-9]+/);
  return match ? match[0] : null;
}

function extractClientSecret(html: string): string | null {
  // Payment intent secrets
  const piMatch = html.match(/pi_[a-zA-Z0-9]+_secret_[a-zA-Z0-9]+/);
  if (piMatch) return piMatch[0];
  // Setup intent secrets
  const siMatch = html.match(/seti_[a-zA-Z0-9]+_secret_[a-zA-Z0-9]+/);
  if (siMatch) return siMatch[0];
  return null;
}

function extractMerchant(html: string): string {
  // First try deep script extraction
  const scriptData = extractFromScripts(html);
  if (scriptData.merchant) return scriptData.merchant;

  const patterns = [
    /"business_name":"([^"]+)"/,
    /"display_name":"([^"]+)"/,
    /"merchant_name":"([^"]+)"/,
    /"statement_descriptor":"([^"]+)"/,
    /<meta property="og:site_name" content="([^"]+)"/i,
    /<title>(.*?)\s*[|–-]\s*(Stripe|Checkout|Shopify|PayPal|Braintree|Adyen|Square|Mollie|Klarna|Authorize\.Net|WooCommerce|BigCommerce|Wix|Ecwid)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (name && name.length > 1 && !['Stripe Checkout', 'Checkout', 'Shopify Checkout', 'PayPal'].includes(name)) {
        return name;
      }
    }
  }
  return 'Unknown';
}

function extractProduct(html: string): string | null {
  const scriptData = extractFromScripts(html);
  if (scriptData.product) {
    const cleaned = scriptData.product.replace(/\s*[|–-]\s*(Stripe|Checkout|Shopify|PayPal).*$/i, '');
    if (cleaned.length > 3) return cleaned.slice(0, 100);
  }

  const patterns = [
    /"name":"([^"]{4,100})"/,
    /<meta property="og:title" content="([^"]+)"/i,
    /"product_name":"([^"]+)"/,
    /"description":"([^"]{4,100})"/,
    /<h1[^>]*>(.*?)<\/h1>/i,
    /<title>(.*?)<\/title>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      let name = match[1].trim();
      name = name.replace(/\s*[|–-]\s*(Stripe|Checkout|Shopify|PayPal).*$/i, '');
      name = name.replace(/<[^>]*>/g, ''); // strip HTML tags
      if (name.length > 3 && !['Stripe Checkout', 'Checkout', 'Shopify Checkout'].includes(name)) {
        return name.slice(0, 100);
      }
    }
  }
  return null;
}

function extractProductUrl(html: string): string | null {
  const scriptData = extractFromScripts(html);
  if (scriptData.productUrl) return scriptData.productUrl;

  const patterns = [
    /<meta property="og:url" content="([^"]+)"/i,
    /<link rel="canonical" href="([^"]+)"/i,
    /"product_url":"([^"]+)"/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const url = match[1].trim();
      if (url.startsWith('http')) return url;
    }
  }
  return null;
}

function extractAmount(html: string): string | null {
  // First try deep script extraction
  const scriptData = extractFromScripts(html);
  if (scriptData.amount !== null) {
    const amountCents = scriptData.amount;
    if (typeof amountCents === 'number' && amountCents > 0) {
      return `$${(amountCents / 100).toFixed(2)}`;
    }
  }

  const patterns = [
    /"amount":(\d+)/,
    /"amount_display":"([^"]+)"/,
    /data-amount="(\d+)"/,
    /<span[^>]*class="[^"]*amount[^"]*"[^>]*>\s*[$€£]?\s*([\d,]+\.?\d*)\s*<\/span>/i,
    /Total:?\s*[$€£]?\s*([\d,]+\.?\d*)/i,
    /price['"]\s*:\s*['"]?\$?([\d,]+\.?\d*)/i,
    /"line_items":\[.*?"amount":(\d+).*?\]/,
    /"amount_subtotal":(\d+)/,
    /"total":(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const amount = match[1].replace(',', '');
      if (/^\d+$/.test(amount) && amount.length > 2) {
        return `$${(parseInt(amount) / 100).toFixed(2)}`;
      } else if (/^[\d.]+$/.test(amount)) {
        return `$${amount}`;
      }
    }
  }
  const priceMatch = html.match(/\$(\d+(?:\.\d{2})?)/);
  if (priceMatch) return `$${priceMatch[1]}`;
  return null;
}

function extractCurrency(html: string): string {
  const patterns = [
    /"currency":"([^"]+)"/i,
    /data-currency="([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return 'USD';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { url, accessKey } = await req.json();

    if (!url || !accessKey) {
      return new Response(JSON.stringify({ error: 'Missing url or accessKey' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: keyData } = await supabase
      .from('access_keys')
      .select('*')
      .eq('key', accessKey)
      .eq('is_active', true)
      .single();

    if (!keyData) {
      return new Response(JSON.stringify({ error: 'Invalid access key' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    // Fetch with full browser-like headers (matching real script)
    const response = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `HTTP ${response.status}`, success: false }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const html = await response.text();
    const provider = detectProvider(url, html);
    const stripePk = extractStripePk(html);
    const clientSecret = extractClientSecret(html);
    const merchant = extractMerchant(html);
    const product = extractProduct(html);
    const productUrl = extractProductUrl(html);
    const amount = extractAmount(html);
    const currency = extractCurrency(html);

    return new Response(JSON.stringify({
      url,
      provider,
      merchant,
      product: product || 'Unknown',
      productUrl,
      amount,
      currency,
      stripePk,
      clientSecret,
      success: true,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg, success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
