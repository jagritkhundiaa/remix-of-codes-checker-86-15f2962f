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

// ============= EXACT PORT OF URLAnalyzer._extract_from_scripts =============
function _extractFromScripts(html: string): { amount: number | null; product: string | null; merchant: string | null; product_url: string | null } {
  const result: { amount: number | null; product: string | null; merchant: string | null; product_url: string | null } = {
    amount: null, product: null, merchant: null, product_url: null,
  };

  const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptPattern.exec(html)) !== null) {
    const script = scriptMatch[1];

    const patterns: [RegExp, string][] = [
      [/window\.__STRIPE__\s*=\s*(\{[\s\S]*?\});/, 'stripe'],
      [/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/, 'initial'],
      [/var\s+stripePaymentData\s*=\s*(\{[\s\S]*?\});/, 'payment'],
      [/"paymentIntent":(\{[\s\S]*?\})/, 'pi'],
      [/"paymentMethod":(\{[\s\S]*?\})/, 'pm'],
      [/"amount":\s*(\d+)/, 'amount'],
      [/"name":\s*"([^"]+)"/, 'name'],
      [/"business_name":\s*"([^"]+)"/, 'business'],
      [/"product_url":\s*"([^"]+)"/, 'product_url'],
    ];

    for (const [pat, key] of patterns) {
      const m = pat.exec(script);
      if (!m) continue;
      try {
        if (['stripe', 'initial', 'payment', 'pi', 'pm'].includes(key)) {
          const data = JSON.parse(m[1]);
          function extract(obj: unknown): void {
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
              const o = obj as Record<string, unknown>;
              if ('amount' in o && typeof o.amount === 'number') {
                result.amount = o.amount as number;
              }
              if ('name' in o && typeof o.name === 'string') {
                result.product = o.name as string;
              }
              if ('business_name' in o && typeof o.business_name === 'string') {
                result.merchant = o.business_name as string;
              }
              if ('product_url' in o && typeof o.product_url === 'string') {
                result.product_url = o.product_url as string;
              }
              for (const v of Object.values(o)) {
                extract(v);
              }
            } else if (Array.isArray(obj)) {
              for (const item of obj) {
                extract(item);
              }
            }
          }
          extract(data);
        } else if (key === 'amount') {
          result.amount = parseInt(m[1]);
        } else if (key === 'name') {
          result.product = m[1];
        } else if (key === 'business') {
          result.merchant = m[1];
        } else if (key === 'product_url') {
          result.product_url = m[1];
        }
      } catch { /* skip parse errors */ }
    }
  }

  return result;
}

// ============= EXACT PORT OF URLAnalyzer.extract_amount =============
function extractAmount(html: string): string | null {
  const scriptData = _extractFromScripts(html);
  if (scriptData.amount !== null) {
    const amountCents = scriptData.amount;
    if (typeof amountCents === 'number') {
      return `$${(amountCents / 100).toFixed(2)}`;
    }
  }

  const patterns = [
    /"amount":(\d+)/,
    /"amount_display":"([^"]+)"/,
    /\$(\d+(?:\.\d{2})?)/,
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
  return null;
}

// ============= EXACT PORT OF URLAnalyzer.extract_product_name =============
function extractProductName(html: string): string | null {
  const scriptData = _extractFromScripts(html);
  if (scriptData.product) {
    return scriptData.product;
  }

  const patterns = [
    /"name":"([^"]+)"/,
    /<title>(.*?)<\/title>/i,
    /<h1[^>]*>(.*?)<\/h1>/i,
    /"description":"([^"]+)"/,
    /"product_name":"([^"]+)"/,
    /<meta property="og:title" content="([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      let name = match[1].trim();
      name = name.replace(/\s*[|–-]\s*Stripe.*$/i, '');
      name = name.replace(/\s*[|–-]\s*Checkout.*$/i, '');
      if (name && name.length > 3) {
        return name.slice(0, 100);
      }
    }
  }
  return null;
}

// ============= EXACT PORT OF URLAnalyzer.extract_product_url =============
function extractProductUrl(html: string): string | null {
  const scriptData = _extractFromScripts(html);
  if (scriptData.product_url) {
    return scriptData.product_url;
  }

  const patterns = [
    /<meta property="og:url" content="([^"]+)"/i,
    /<link rel="canonical" href="([^"]+)"/i,
    /"product_url":"([^"]+)"/,
    /<a[^>]*href="([^"]+)"[^>]*>.*?product.*?<\/a>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const url = match[1].trim();
      if (url.startsWith('http')) {
        return url;
      }
    }
  }
  return null;
}

// ============= EXACT PORT OF URLAnalyzer.extract_merchant =============
function extractMerchant(html: string): string {
  const scriptData = _extractFromScripts(html);
  if (scriptData.merchant) {
    return scriptData.merchant;
  }

  const patterns = [
    /"business_name":"([^"]+)"/,
    /<title>(.*?)\s*[|–-]\s*(Stripe|Checkout|Shopify|PayPal|Braintree|Adyen|Square|Mollie|Klarna|Authorize\.Net|WooCommerce|BigCommerce|Wix|Ecwid)/i,
    /"display_name":"([^"]+)"/,
    /<meta property="og:site_name" content="([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return 'Unknown';
}

// ============= EXACT PORT OF URLAnalyzer.extract_currency =============
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

// ============= EXACT PORT OF detect_provider =============
function detectProvider(url: string, html: string): string {
  if (url.includes('stripe.com')) return 'stripe';
  if (url.includes('checkout.com') || url.includes('checkout')) return 'checkoutcom';
  if (url.includes('shopify.com') || url.includes('myshopify.com')) return 'shopify';
  if (url.includes('paypal.com') || url.includes('paypal')) return 'paypal';
  if (url.includes('braintree') || url.includes('braintreegateway.com')) return 'braintree';
  if (url.includes('adyen.com') || url.includes('adyen')) return 'adyen';
  if (url.includes('squareup.com') || url.includes('square')) return 'square';
  if (url.includes('mollie.com') || url.includes('mollie')) return 'mollie';
  if (url.includes('klarna.com') || url.includes('klarna')) return 'klarna';
  if (url.includes('authorize.net') || url.includes('authorizenet')) return 'authorizenet';
  if (url.includes('woocommerce') || html.includes('woocommerce')) return 'woocommerce';
  if (url.includes('bigcommerce.com') || html.includes('bigcommerce')) return 'bigcommerce';
  if (url.includes('wix.com') || html.includes('wix')) return 'wix';
  if (url.includes('ecwid.com') || html.includes('ecwid')) return 'ecwid';

  if (html) {
    if (html.includes('stripe.com') || html.includes('Frames')) return html.includes('stripe.com') ? 'stripe' : 'checkoutcom';
    if (html.includes('Shopify') || html.includes('window.Shopify')) return 'shopify';
    if (html.includes('paypal') || html.includes('window.paypal')) return 'paypal';
    if (html.includes('braintree') || html.includes('Braintree')) return 'braintree';
    if (html.includes('adyen') || html.includes('Adyen')) return 'adyen';
    if (html.includes('square') || html.includes('Square')) return 'square';
    if (html.includes('mollie') || html.includes('Mollie')) return 'mollie';
    if (html.includes('klarna') || html.includes('Klarna')) return 'klarna';
    if (html.includes('authorize.net') || html.includes('Authorize.Net')) return 'authorizenet';
  }

  return 'unknown';
}

// ============= STRIPE PK + CLIENT SECRET EXTRACTION =============
function extractStripePk(html: string): string | null {
  const match = html.match(/pk_(live|test)_[a-zA-Z0-9]+/);
  return match ? match[0] : null;
}

function extractClientSecret(html: string): string | null {
  const piMatch = html.match(/pi_[a-zA-Z0-9]+_secret_[a-zA-Z0-9]+/);
  if (piMatch) return piMatch[0];
  const siMatch = html.match(/seti_[a-zA-Z0-9]+_secret_[a-zA-Z0-9]+/);
  if (siMatch) return siMatch[0];
  return null;
}

// ============= MAIN HANDLER =============
// Exact port of the script's analyze_url_with_fallback (static part only)
// Playwright deep analysis cannot run in edge functions
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { url, accessKey } = await req.json();
    const logs: string[] = [];

    if (!url || !accessKey) {
      return new Response(JSON.stringify({ error: 'Missing url or accessKey' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    logs.push(`[START] Analyzing URL: ${url.slice(0, 80)}...`);

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
    logs.push(`[AUTH] Access key validated`);

    // Exact match: headers = {'User-Agent': random.choice(USER_AGENTS), 'Accept-Language': 'en-US,en;q=0.9'}
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    logs.push(`[FETCH] Fetching URL with headers...`);
    // resp = requests.get(url, timeout=15, verify=False, headers=headers, allow_redirects=True)
    const response = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      logs.push(`[FETCH] HTTP Error: ${response.status}`);
      return new Response(JSON.stringify({
        url,
        provider: 'unknown',
        merchant: 'Not Found',
        product: 'Not Found',
        productUrl: null,
        amount: 'Not Found',
        currency: 'USD',
        stripePk: 'Not Found',
        clientSecret: null,
        status: 'Invalid',
        success: false,
        logs,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const html = await response.text();
    logs.push(`[FETCH] Got HTML response (${html.length} bytes)`);

    // Exact port of the script's static analysis flow:
    // result['merchant'] = URLAnalyzer.extract_merchant(html)
    // result['product'] = URLAnalyzer.extract_product_name(html) or 'Unknown'
    // result['product_url'] = URLAnalyzer.extract_product_url(html)
    // result['amount'] = URLAnalyzer.extract_amount(html)
    // result['currency'] = URLAnalyzer.extract_currency(html)
    const provider = detectProvider(url, html);
    const merchant = extractMerchant(html);
    const product = extractProductName(html);
    const productUrl = extractProductUrl(html);
    const amount = extractAmount(html);
    const currency = extractCurrency(html);
    const stripePk = extractStripePk(html);
    const clientSecret = extractClientSecret(html);

    logs.push(`[DETECT] Provider: ${provider}`);
    logs.push(`[EXTRACT] Merchant: ${merchant}`);
    logs.push(`[EXTRACT] Product: ${product || 'Not Found'}`);
    logs.push(`[EXTRACT] Amount: ${amount || 'Not Found'}`);
    logs.push(`[EXTRACT] Currency: ${currency}`);
    logs.push(`[EXTRACT] Stripe PK: ${stripePk ? stripePk.slice(0, 15) + '...' : 'Not Found'}`);
    logs.push(`[EXTRACT] Client Secret: ${clientSecret ? 'Found' : 'Not Found'}`);
    logs.push(`[EXTRACT] Product URL: ${productUrl || 'Not Found'}`);

    // Check if static analysis is incomplete (same logic as script)
    if (merchant === 'Unknown' || product === null || ['Stripe Checkout', 'Checkout', 'Shopify Checkout'].includes(product || '')) {
      logs.push(`[WARN] Static analysis incomplete - merchant=${merchant}, product=${product || 'null'}`);
      logs.push(`[WARN] Deep analysis with Playwright not available in edge functions`);
      logs.push(`[WARN] For JS-rendered pages, the original script would use Playwright here`);
    }

    logs.push(`[VALIDATE] URL Status: Valid`);
    logs.push(`[DONE] Analysis complete`);

    return new Response(JSON.stringify({
      url,
      provider,
      merchant: merchant || 'Not Found',
      product: product || 'Not Found',
      productUrl,
      amount: amount || 'Not Found',
      currency,
      stripePk: stripePk || 'Not Found',
      clientSecret,
      status: 'Valid',
      success: true,
      logs,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg, success: false, logs: [`[ERROR] ${msg}`] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
