import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

// ── Payment gateway detection ──────────────────────────────
function detectProvider(url: string, html: string): string {
  const u = url.toLowerCase();
  const h = html.toLowerCase();
  if (u.includes('stripe.com') || h.includes('js.stripe.com') || h.includes('stripe.js') || h.includes('pk_live_') || h.includes('pk_test_')) return 'stripe';
  if (h.includes('adyen') || u.includes('adyen') || h.includes('adyencheckout') || h.includes('adyen-checkout')) return 'adyen';
  if (h.includes('braintree') || h.includes('braintreegateway')) return 'braintree';
  if (h.includes('checkout.com') || h.includes('frames.checkout.com')) return 'checkout';
  if (h.includes('paypal') || u.includes('paypal')) return 'paypal';
  if (h.includes('square') || h.includes('squareup')) return 'square';
  return 'unknown';
}

function extractStripePk(html: string): string | null {
  const patterns = [
    /pk_live_[A-Za-z0-9]{20,}/,
    /pk_test_[A-Za-z0-9]{20,}/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[0];
  }
  return null;
}

function requiresPhone(html: string): boolean {
  const h = html.toLowerCase();
  return (h.includes('phone number') || h.includes('mobile number') || h.includes('sms verification') || h.includes('type="tel"')) &&
    (h.includes('required') || h.includes('verify'));
}

function requiresLogin(html: string, url: string): boolean {
  const h = html.toLowerCase();
  return h.includes('sign in') || h.includes('log in') || h.includes('login') || h.includes('create account') || h.includes('register') || url.includes('/login') || url.includes('/signin');
}

// ── 2D/3D Stripe gate check ───────────────────────────────
// Creates a test payment method with a known test card to determine
// if the Stripe integration requires 3D Secure or is 2D (no 3DS).
async function checkStripeGateType(stripePk: string): Promise<{ gateType: '2d' | '3d' | 'unknown'; details: string }> {
  try {
    // Generate fingerprint
    const guid = crypto.randomUUID().replace(/-/g, '');
    const muid = crypto.randomUUID().replace(/-/g, '');
    const sid = crypto.randomUUID().replace(/-/g, '');

    // Create a payment method with a test card
    const pmBody = new URLSearchParams({
      'type': 'card',
      'card[number]': '4242424242424242',
      'card[exp_month]': '12',
      'card[exp_year]': '28',
      'card[cvc]': '123',
      'billing_details[address][country]': 'US',
      'billing_details[address][postal_code]': '10001',
      'guid': guid,
      'muid': muid,
      'sid': sid,
      'payment_user_agent': 'stripe.js/v3',
      'time_on_page': String(30000 + Math.floor(Math.random() * 20000)),
      'key': stripePk,
    });

    const pmResp = await fetch('https://api.stripe.com/v1/payment_methods', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://js.stripe.com',
        'Referer': 'https://js.stripe.com/',
      },
      body: pmBody.toString(),
    });

    const pmData = await pmResp.json();

    if (pmData.error) {
      // If key is invalid or restricted, we can't determine
      return { gateType: 'unknown', details: `PM error: ${pmData.error.code || pmData.error.message}` };
    }

    // Check if the card's checks indicate 3DS
    const checks = pmData.card?.checks || {};
    const threeDSecure = pmData.card?.three_d_secure_usage?.supported;

    if (threeDSecure === false) {
      return { gateType: '2d', details: '3DS not supported by merchant — 2D gate ✅' };
    }

    // Now try to create a token to see how the merchant handles it
    const tokenBody = new URLSearchParams({
      'card[number]': '4000000000003220', // 3DS required test card
      'card[exp_month]': '12',
      'card[exp_year]': '28',
      'card[cvc]': '123',
      'key': stripePk,
    });

    const tokenResp = await fetch('https://api.stripe.com/v1/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://js.stripe.com',
        'Referer': 'https://js.stripe.com/',
      },
      body: tokenBody.toString(),
    });

    const tokenData = await tokenResp.json();

    if (tokenData.error) {
      // Token creation failed — check error for hints
      if (tokenData.error.code === 'card_declined') {
        return { gateType: '2d', details: 'Token declined without 3DS challenge — likely 2D ✅' };
      }
      return { gateType: 'unknown', details: `Token error: ${tokenData.error.code}` };
    }

    // If token created successfully, the 3DS status depends on merchant Radar rules
    // We check if three_d_secure_usage is supported on the card object
    if (threeDSecure === true) {
      return { gateType: '3d', details: '3D Secure supported/required by merchant — 3D gate 🔐' };
    }

    // Default: if PM created fine and 3DS is neutral, likely 2D
    return { gateType: '2d', details: 'No 3DS enforcement detected — likely 2D ✅' };
  } catch (e) {
    return { gateType: 'unknown', details: `Check error: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

// ── AI-powered site discovery ──────────────────────────────
async function discoverSites(category: string, queries: string[], apiKey: string): Promise<string[]> {
  const allUrls: string[] = [];

  for (const query of queries.slice(0, 3)) {
    try {
      const resp = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            {
              role: 'system',
              content: `You are a web research assistant. Find real, working websites that match the search criteria. Return ONLY a JSON array of URLs (strings). No explanation, no markdown, just the JSON array. Find 10-15 diverse websites. Only include sites that:
- Are legitimate businesses with actual checkout/payment pages
- Accept online payments (credit/debit cards)
- Are accessible without VPN
- Have English language option`
            },
            {
              role: 'user',
              content: `Find websites for: "${query}" in category "${category}". I need sites that have online payment/checkout pages where I can buy products or services with a credit card. Focus on finding sites that use Stripe or Adyen payment processing. Return only the JSON array of full URLs.`
            }
          ],
        }),
      });

      if (!resp.ok) {
        console.error(`AI search failed for "${query}": ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';

      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        try {
          const urls = JSON.parse(jsonMatch[0]);
          if (Array.isArray(urls)) {
            allUrls.push(...urls.filter((u: unknown) => typeof u === 'string' && u.startsWith('http')));
          }
        } catch { /* ignore parse errors */ }
      }

      const urlRegex = /https?:\/\/[^\s"',\]]+/g;
      const textUrls = content.match(urlRegex) || [];
      allUrls.push(...textUrls);
    } catch (e) {
      console.error(`Discovery error for "${query}":`, e);
    }
  }

  const seen = new Set<string>();
  return allUrls.filter(u => {
    try {
      const domain = new URL(u).hostname;
      if (seen.has(domain)) return false;
      seen.add(domain);
      return true;
    } catch { return false; }
  });
}

// ── Analyze a single site ──────────────────────────────────
async function analyzeSite(url: string): Promise<{
  gateway: string;
  stripePk: string | null;
  requiresLogin: boolean;
  requiresPhone: boolean;
  domain: string;
  notes: string;
  gateType: '2d' | '3d' | 'unknown';
  gateDetails: string;
}> {
  const result = {
    gateway: 'unknown' as string,
    stripePk: null as string | null,
    requiresLogin: false,
    requiresPhone: false,
    domain: '',
    notes: '',
    gateType: 'unknown' as '2d' | '3d' | 'unknown',
    gateDetails: '',
  };

  try {
    const parsedUrl = new URL(url);
    result.domain = parsedUrl.hostname;

    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      result.notes = `HTTP ${resp.status}`;
      return result;
    }

    const html = await resp.text();
    result.gateway = detectProvider(url, html);
    result.stripePk = extractStripePk(html);
    result.requiresLogin = requiresLogin(html, url);
    result.requiresPhone = requiresPhone(html);

    if (result.gateway === 'unknown') {
      for (const path of ['/pricing', '/checkout', '/payment', '/subscribe', '/plans']) {
        try {
          const checkUrl = `${parsedUrl.origin}${path}`;
          const r2 = await fetch(checkUrl, {
            headers: { 'User-Agent': USER_AGENTS[0] },
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
          });
          if (r2.ok) {
            const h2 = await r2.text();
            const provider = detectProvider(checkUrl, h2);
            if (provider !== 'unknown') {
              result.gateway = provider;
              result.stripePk = result.stripePk || extractStripePk(h2);
              result.notes = `Found on ${path}`;
              break;
            }
          }
        } catch { /* skip */ }
      }
    }

    // If Stripe detected with a pk key, check 2D/3D
    if (result.gateway === 'stripe' && result.stripePk) {
      const gateCheck = await checkStripeGateType(result.stripePk);
      result.gateType = gateCheck.gateType;
      result.gateDetails = gateCheck.details;
    }
  } catch (e) {
    result.notes = `Fetch error: ${e instanceof Error ? e.message : 'unknown'}`;
  }

  return result;
}

// ── Send Telegram notification ─────────────────────────────
async function notifyTelegram(sites: Array<{ url: string; domain: string; gateway: string; category: string; gateType?: string; gateDetails?: string; stripePk?: string | null }>) {
  const botToken = Deno.env.get('SCRAPER_TG_BOT_TOKEN');
  const chatId = Deno.env.get('SCRAPER_TG_CHAT_ID');
  if (!botToken || !chatId || sites.length === 0) return;

  let msg = `🔍 <b>New Sites Found!</b>\n\n`;
  for (const s of sites) {
    const gw = s.gateway === 'stripe' ? '💳 Stripe' : s.gateway === 'adyen' ? '💳 Adyen' : `🔄 ${s.gateway}`;
    const gateLabel = s.gateType === '2d' ? '✅ 2D' : s.gateType === '3d' ? '🔐 3D' : '❓ Unknown';
    msg += `${gw} | ${gateLabel}\n`;
    msg += `<b>${s.domain}</b>\n`;
    msg += `<code>${s.url}</code>\n`;
    if (s.stripePk) msg += `🔑 <code>${s.stripePk.slice(0, 25)}...</code>\n`;
    if (s.gateDetails) msg += `📋 ${s.gateDetails}\n`;
    msg += `📂 ${s.category}\n\n`;
  }

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error('Telegram notification failed:', e);
  }
}

// ── Main handler ───────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body: any = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { /* empty body ok for cron */ }
    }

    const { data: categories } = await supabase
      .from('scraper_categories')
      .select('*')
      .eq('is_active', true);

    if (!categories || categories.length === 0) {
      return new Response(JSON.stringify({ message: 'No active categories. Add categories first.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = { discovered: 0, analyzed: 0, confirmed: 0, skipped: 0, errors: 0, gates_2d: 0, gates_3d: 0 };
    const confirmedSites: Array<{ url: string; domain: string; gateway: string; category: string; gateType?: string; gateDetails?: string; stripePk?: string | null }> = [];

    for (const cat of categories) {
      if (body.category_id && cat.id !== body.category_id) continue;

      console.log(`[Scraper] Searching category: ${cat.name}`);
      const urls = await discoverSites(cat.name, cat.search_queries, apiKey);
      results.discovered += urls.length;

      for (const url of urls) {
        const { data: existing } = await supabase
          .from('scraped_sites')
          .select('id')
          .eq('url', url)
          .maybeSingle();

        if (existing) continue;

        const analysis = await analyzeSite(url);
        results.analyzed++;

        let status = 'analyzed';
        if (analysis.requiresPhone) {
          status = 'skipped';
          results.skipped++;
        } else if (analysis.gateway === 'stripe' || analysis.gateway === 'adyen') {
          status = 'confirmed';
          results.confirmed++;
          if (analysis.gateType === '2d') results.gates_2d++;
          if (analysis.gateType === '3d') results.gates_3d++;
          confirmedSites.push({
            url, domain: analysis.domain, gateway: analysis.gateway, category: cat.name,
            gateType: analysis.gateType, gateDetails: analysis.gateDetails, stripePk: analysis.stripePk,
          });
        }

        const { error: insertErr } = await supabase.from('scraped_sites').upsert({
          url,
          domain: analysis.domain,
          category_id: cat.id,
          payment_gateway: analysis.gateway,
          gateway_details: {
            stripePk: analysis.stripePk,
            gateType: analysis.gateType,
            gateDetails: analysis.gateDetails,
          },
          stripe_pk: analysis.stripePk,
          requires_login: analysis.requiresLogin,
          requires_phone: analysis.requiresPhone,
          status,
          last_checked: new Date().toISOString(),
          notes: analysis.gateType !== 'unknown'
            ? `${analysis.notes ? analysis.notes + ' | ' : ''}Gate: ${analysis.gateType.toUpperCase()} — ${analysis.gateDetails}`
            : analysis.notes,
        }, { onConflict: 'url' });

        if (insertErr) {
          console.error('Insert error:', insertErr);
          results.errors++;
        }
      }
    }

    if (confirmedSites.length > 0) {
      await notifyTelegram(confirmedSites);

      for (const s of confirmedSites) {
        await supabase.from('scraped_sites')
          .update({ telegram_notified: true })
          .eq('url', s.url);
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Scraper error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
