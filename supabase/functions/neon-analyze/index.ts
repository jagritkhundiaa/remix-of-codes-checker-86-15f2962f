import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function detectProvider(url: string, html: string): string {
  const checks: [string[], string][] = [
    [['stripe.com'], 'stripe'],
    [['checkout.com'], 'checkoutcom'],
    [['shopify.com', 'myshopify.com'], 'shopify'],
    [['paypal.com'], 'paypal'],
    [['braintree', 'braintreegateway.com'], 'braintree'],
    [['adyen.com', 'adyen'], 'adyen'],
    [['squareup.com', 'square'], 'square'],
    [['mollie.com'], 'mollie'],
    [['klarna.com'], 'klarna'],
    [['authorize.net', 'authorizenet'], 'authorizenet'],
  ];

  for (const [patterns, provider] of checks) {
    for (const pat of patterns) {
      if (url.includes(pat)) return provider;
    }
  }

  const htmlLower = html.toLowerCase();
  const htmlChecks: [string[], string][] = [
    [['stripe.com', 'pk_live_', 'pk_test_'], 'stripe'],
    [['checkout.com', 'frames'], 'checkoutcom'],
    [['shopify', 'window.shopify'], 'shopify'],
    [['paypal', 'window.paypal'], 'paypal'],
    [['braintree', 'braintreegateway'], 'braintree'],
    [['adyen', 'checkoutshopper'], 'adyen'],
    [['squareup', 'square'], 'square'],
    [['mollie'], 'mollie'],
    [['klarna'], 'klarna'],
    [['authorize.net'], 'authorizenet'],
    [['woocommerce', 'wc-'], 'woocommerce'],
    [['bigcommerce'], 'bigcommerce'],
    [['wix.com'], 'wix'],
    [['ecwid'], 'ecwid'],
  ];

  for (const [patterns, provider] of htmlChecks) {
    for (const pat of patterns) {
      if (htmlLower.includes(pat)) return provider;
    }
  }

  return 'unknown';
}

function extractStripePk(html: string): string | null {
  const match = html.match(/pk_(live|test)_[a-zA-Z0-9]+/);
  return match ? match[0] : null;
}

function extractClientSecret(html: string): string | null {
  const match = html.match(/pi_[a-zA-Z0-9]+_secret_[a-zA-Z0-9]+/);
  return match ? match[0] : null;
}

function extractMerchant(html: string): string {
  const patterns = [
    /"business_name":"([^"]+)"/,
    /<meta property="og:site_name" content="([^"]+)"/i,
    /"display_name":"([^"]+)"/,
    /<title>(.*?)\s*[|–-]\s*(Stripe|Checkout|Shopify|PayPal|Braintree|Adyen|Square|Mollie|Klarna|Authorize\.Net|WooCommerce|BigCommerce|Wix|Ecwid)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].trim();
  }
  return 'Unknown';
}

function extractProduct(html: string): string | null {
  const patterns = [
    /<meta property="og:title" content="([^"]+)"/i,
    /"name":"([^"]{4,100})"/,
    /<h1[^>]*>(.*?)<\/h1>/i,
    /<title>(.*?)<\/title>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      let name = match[1].trim();
      name = name.replace(/\s*[|–-]\s*(Stripe|Checkout|Shopify|PayPal).*$/i, '');
      if (name.length > 3) return name.slice(0, 100);
    }
  }
  return null;
}

function extractAmount(html: string): string | null {
  const patterns = [
    /"amount":(\d+)/,
    /"amount_display":"([^"]+)"/,
    /data-amount="(\d+)"/,
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
  const match = html.match(/"currency":"([^"]+)"/i);
  return match ? match[1].toUpperCase() : 'USD';
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
    const amount = extractAmount(html);
    const currency = extractCurrency(html);

    return new Response(JSON.stringify({
      url,
      provider,
      merchant,
      product: product || 'Unknown',
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
