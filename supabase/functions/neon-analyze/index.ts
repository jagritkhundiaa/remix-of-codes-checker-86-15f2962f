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

    // Try to find and parse JSON objects in scripts
    const jsonPatterns: RegExp[] = [
      /window\.__STRIPE__\s*=\s*(\{[\s\S]*?\});/,
      /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/,
      /window\.__CHECKOUT_DATA__\s*=\s*(\{[\s\S]*?\});/,
      /window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\});/,
      /var\s+stripePaymentData\s*=\s*(\{[\s\S]*?\});/,
      /"paymentIntent"\s*:\s*(\{[\s\S]*?\})/,
      /"paymentMethod"\s*:\s*(\{[\s\S]*?\})/,
      /Stripe\.setPublishableKey\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    ];

    for (const pat of jsonPatterns) {
      const m = pat.exec(script);
      if (!m) continue;
      try {
        const data = JSON.parse(m[1]);
        deepExtract(data, result);
      } catch { /* not valid JSON, skip */ }
    }

    // Direct key-value patterns
    const kvPatterns: [RegExp, string][] = [
      [/"amount":\s*(\d+)/, 'amount'],
      [/"name":\s*"([^"]+)"/, 'name'],
      [/"business_name":\s*"([^"]+)"/, 'business'],
      [/"display_name":\s*"([^"]+)"/, 'display'],
      [/"merchant_name":\s*"([^"]+)"/, 'merchant_name'],
      [/"statement_descriptor":\s*"([^"]+)"/, 'statement'],
      [/"product_url":\s*"([^"]+)"/, 'product_url'],
      [/"description":\s*"([^"]{4,100})"/, 'description'],
      [/"line_items":\s*\[.*?"description":\s*"([^"]+)"/, 'line_item_desc'],
    ];

    for (const [pat, key] of kvPatterns) {
      const m = pat.exec(script);
      if (!m) continue;
      if (key === 'amount' && !result.amount) result.amount = parseInt(m[1]);
      if (key === 'name' && !result.product) result.product = m[1];
      if (key === 'description' && !result.product) result.product = m[1];
      if (key === 'line_item_desc' && !result.product) result.product = m[1];
      if ((key === 'business' || key === 'display' || key === 'merchant_name' || key === 'statement') && !result.merchant) result.merchant = m[1];
      if (key === 'product_url' && !result.productUrl) result.productUrl = m[1];
    }
  }

  return result;
}

function deepExtract(obj: unknown, result: { amount: number | null; product: string | null; merchant: string | null; productUrl: string | null }, depth = 0): void {
  if (depth > 10) return; // prevent infinite recursion
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>;
    if ('amount' in o && typeof o.amount === 'number' && o.amount > 0) {
      if (!result.amount) result.amount = o.amount;
    }
    if ('unit_amount' in o && typeof o.unit_amount === 'number' && o.unit_amount > 0) {
      if (!result.amount) result.amount = o.unit_amount;
    }
    if ('amount_total' in o && typeof o.amount_total === 'number') {
      if (!result.amount) result.amount = o.amount_total;
    }
    if ('amount_subtotal' in o && typeof o.amount_subtotal === 'number') {
      if (!result.amount) result.amount = o.amount_subtotal;
    }
    const nameKeys = ['name', 'product_name', 'item_name', 'description'];
    for (const k of nameKeys) {
      if (k in o && typeof o[k] === 'string' && (o[k] as string).length > 2) {
        if (!result.product) result.product = o[k] as string;
      }
    }
    const merchantKeys = ['business_name', 'display_name', 'merchant_name', 'statement_descriptor', 'account_name', 'company_name', 'seller_name'];
    for (const k of merchantKeys) {
      if (k in o && typeof o[k] === 'string' && (o[k] as string).length > 1) {
        if (!result.merchant) result.merchant = o[k] as string;
      }
    }
    if ('product_url' in o && typeof o.product_url === 'string') {
      if (!result.productUrl) result.productUrl = o.product_url as string;
    }
    for (const v of Object.values(o)) {
      deepExtract(v, result, depth + 1);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      deepExtract(item, result, depth + 1);
    }
  }
}

// ============= PROVIDER DETECTION (exact match from real script) =============
function detectProvider(url: string, html: string): string {
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

// ============= EXTRACTION FUNCTIONS =============
function extractStripePk(html: string): string | null {
  // Multiple patterns for different contexts
  const patterns = [
    /pk_(live|test)_[a-zA-Z0-9]{20,}/,
    /["']pk_(live|test)_[a-zA-Z0-9]+["']/,
    /data-key="(pk_(?:live|test)_[a-zA-Z0-9]+)"/,
    /Stripe\(['"]?(pk_(?:live|test)_[a-zA-Z0-9]+)['"]?\)/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const key = match[0].replace(/['"]/g, '').replace('data-key=', '').replace('Stripe(', '').replace(')', '');
      const pkMatch = key.match(/pk_(live|test)_[a-zA-Z0-9]+/);
      if (pkMatch) return pkMatch[0];
    }
  }
  return null;
}

function extractClientSecret(html: string): string | null {
  const piMatch = html.match(/pi_[a-zA-Z0-9]+_secret_[a-zA-Z0-9]+/);
  if (piMatch) return piMatch[0];
  const siMatch = html.match(/seti_[a-zA-Z0-9]+_secret_[a-zA-Z0-9]+/);
  if (siMatch) return siMatch[0];
  const csMatch = html.match(/cs_(live|test)_[a-zA-Z0-9]+/);
  if (csMatch) return csMatch[0];
  return null;
}

function extractMerchant(html: string): string {
  const scriptData = extractFromScripts(html);
  if (scriptData.merchant && scriptData.merchant !== 'Unknown') return scriptData.merchant;

  const patterns = [
    /"business_name"\s*:\s*"([^"]+)"/,
    /"display_name"\s*:\s*"([^"]+)"/,
    /"merchant_name"\s*:\s*"([^"]+)"/,
    /"statement_descriptor"\s*:\s*"([^"]+)"/,
    /"account_name"\s*:\s*"([^"]+)"/,
    /"company_name"\s*:\s*"([^"]+)"/,
    /<meta property="og:site_name" content="([^"]+)"/i,
    /<title>(.*?)\s*[|–\-]\s*(Stripe|Checkout|Shopify|PayPal|Braintree|Adyen|Square|Mollie|Klarna|Authorize\.Net|WooCommerce|BigCommerce|Wix|Ecwid)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (name && name.length > 1 && !['Stripe Checkout', 'Checkout', 'Shopify Checkout', 'PayPal', 'Payment'].includes(name)) {
        return name;
      }
    }
  }
  return 'Unknown';
}

function extractProduct(html: string): string | null {
  const scriptData = extractFromScripts(html);
  if (scriptData.product) {
    const cleaned = scriptData.product.replace(/\s*[|–\-]\s*(Stripe|Checkout|Shopify|PayPal).*$/i, '').replace(/<[^>]*>/g, '');
    if (cleaned.length > 3 && !['Stripe Checkout', 'Checkout', 'Shopify Checkout'].includes(cleaned)) return cleaned.slice(0, 100);
  }

  const patterns = [
    /"name"\s*:\s*"([^"]{4,100})"/,
    /"product_name"\s*:\s*"([^"]+)"/,
    /"item_name"\s*:\s*"([^"]+)"/,
    /<meta property="og:title" content="([^"]+)"/i,
    /"description"\s*:\s*"([^"]{4,100})"/,
    /<h1[^>]*>(.*?)<\/h1>/i,
    /<title>(.*?)<\/title>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      let name = match[1].trim();
      name = name.replace(/\s*[|–\-]\s*(Stripe|Checkout|Shopify|PayPal).*$/i, '');
      name = name.replace(/<[^>]*>/g, '');
      if (name.length > 3 && !['Stripe Checkout', 'Checkout', 'Shopify Checkout', 'Payment'].includes(name)) {
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
    /"product_url"\s*:\s*"([^"]+)"/,
    /"success_url"\s*:\s*"([^"]+)"/,
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
  const scriptData = extractFromScripts(html);
  if (scriptData.amount !== null && scriptData.amount > 0) {
    return `$${(scriptData.amount / 100).toFixed(2)}`;
  }

  const patterns = [
    /"amount"\s*:\s*(\d+)/,
    /"unit_amount"\s*:\s*(\d+)/,
    /"amount_total"\s*:\s*(\d+)/,
    /"amount_display"\s*:\s*"([^"]+)"/,
    /data-amount="(\d+)"/,
    /<span[^>]*class="[^"]*(?:amount|price|total)[^"]*"[^>]*>\s*[$€£]?\s*([\d,]+\.?\d*)\s*<\/span>/i,
    /Total:?\s*[$€£]?\s*([\d,]+\.?\d*)/i,
    /price['"]\s*:\s*['"]?\$?([\d,]+\.?\d*)/i,
    /"line_items"\s*:\s*\[.*?"amount"\s*:\s*(\d+).*?\]/,
    /"amount_subtotal"\s*:\s*(\d+)/,
    /"total"\s*:\s*(\d+)/,
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
    /"currency"\s*:\s*"([^"]+)"/i,
    /data-currency="([^"]+)"/i,
    /"presentment_currency"\s*:\s*"([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return 'USD';
}

// ============= STRIPE CHECKOUT API ENRICHMENT =============
// For checkout.stripe.com URLs, try to get details via Stripe's internal API
async function enrichStripeCheckout(url: string, stripePk: string, html: string): Promise<{
  merchant: string | null;
  product: string | null;
  amount: string | null;
  currency: string | null;
  clientSecret: string | null;
}> {
  const result: { merchant: string | null; product: string | null; amount: string | null; currency: string | null; clientSecret: string | null } = {
    merchant: null, product: null, amount: null, currency: null, clientSecret: null,
  };

  try {
    // Extract checkout session ID from URL
    const csMatch = url.match(/cs_(live|test)_[a-zA-Z0-9]+/) || html.match(/cs_(live|test)_[a-zA-Z0-9]+/);
    const ppageMatch = url.match(/ppage_[a-zA-Z0-9]+/);

    if (csMatch) {
      // Try to retrieve checkout session details
      const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${csMatch[0]}`, {
        headers: {
          'Authorization': `Bearer ${stripePk}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      if (sessionRes.ok) {
        const session = await sessionRes.json();
        if (session.amount_total) result.amount = `$${(session.amount_total / 100).toFixed(2)}`;
        if (session.currency) result.currency = session.currency.toUpperCase();
        if (session.payment_intent) {
          const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id;
          // Try to get the client secret
          const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}`, {
            headers: { 'Authorization': `Bearer ${stripePk}` },
          });
          if (piRes.ok) {
            const pi = await piRes.json();
            if (pi.client_secret) result.clientSecret = pi.client_secret;
            if (pi.description) result.product = pi.description;
            if (pi.statement_descriptor) result.merchant = pi.statement_descriptor;
          } else {
            await piRes.text(); // consume
          }
        }
        if (session.line_items?.data?.[0]?.description) {
          result.product = session.line_items.data[0].description;
        }
      } else {
        await sessionRes.text(); // consume
      }
    }

    if (ppageMatch && !result.amount) {
      // Try payment page API
      const ppRes = await fetch(`https://api.stripe.com/v1/payment_pages/${ppageMatch[0]}`, {
        headers: {
          'Authorization': `Bearer ${stripePk}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      if (ppRes.ok) {
        const pp = await ppRes.json();
        deepExtractStripe(pp, result);
      } else {
        await ppRes.text(); // consume
      }
    }
  } catch { /* Silent - enrichment is best-effort */ }

  return result;
}

function deepExtractStripe(obj: unknown, result: { merchant: string | null; product: string | null; amount: string | null; currency: string | null; clientSecret: string | null }, depth = 0): void {
  if (depth > 8 || !obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;

  if ('amount' in o && typeof o.amount === 'number' && o.amount > 0 && !result.amount) {
    result.amount = `$${(o.amount / 100).toFixed(2)}`;
  }
  if ('amount_total' in o && typeof o.amount_total === 'number' && !result.amount) {
    result.amount = `$${(o.amount_total / 100).toFixed(2)}`;
  }
  if ('currency' in o && typeof o.currency === 'string' && !result.currency) {
    result.currency = (o.currency as string).toUpperCase();
  }
  if ('client_secret' in o && typeof o.client_secret === 'string' && !result.clientSecret) {
    result.clientSecret = o.client_secret as string;
  }
  const nameKeys = ['description', 'name', 'product_name', 'item_name'];
  for (const k of nameKeys) {
    if (k in o && typeof o[k] === 'string' && (o[k] as string).length > 2 && !result.product) {
      result.product = (o[k] as string).slice(0, 100);
    }
  }
  const merchantKeys = ['business_name', 'display_name', 'statement_descriptor', 'account_name'];
  for (const k of merchantKeys) {
    if (k in o && typeof o[k] === 'string' && (o[k] as string).length > 1 && !result.merchant) {
      result.merchant = o[k] as string;
    }
  }

  if (Array.isArray(obj)) {
    for (const item of obj) deepExtractStripe(item, result, depth + 1);
  } else {
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') deepExtractStripe(v, result, depth + 1);
    }
  }
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
    let stripePk = extractStripePk(html);
    let clientSecret = extractClientSecret(html);
    let merchant = extractMerchant(html);
    let product = extractProduct(html);
    const productUrl = extractProductUrl(html);
    let amount = extractAmount(html);
    let currency = extractCurrency(html);

    // For Stripe checkout URLs, try to enrich via Stripe API
    if (stripePk && (url.includes('checkout.stripe.com') || url.includes('stripe.com'))) {
      const enriched = await enrichStripeCheckout(url, stripePk, html);
      if (enriched.merchant && merchant === 'Unknown') merchant = enriched.merchant;
      if (enriched.product && (!product || product === 'Unknown')) product = enriched.product;
      if (enriched.amount && !amount) amount = enriched.amount;
      if (enriched.currency) currency = enriched.currency;
      if (enriched.clientSecret && !clientSecret) clientSecret = enriched.clientSecret;
    }

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
