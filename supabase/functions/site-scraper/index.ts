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

      // Extract URLs from AI response
      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        try {
          const urls = JSON.parse(jsonMatch[0]);
          if (Array.isArray(urls)) {
            allUrls.push(...urls.filter((u: unknown) => typeof u === 'string' && u.startsWith('http')));
          }
        } catch { /* ignore parse errors */ }
      }

      // Also extract any URLs from text
      const urlRegex = /https?:\/\/[^\s"',\]]+/g;
      const textUrls = content.match(urlRegex) || [];
      allUrls.push(...textUrls);
    } catch (e) {
      console.error(`Discovery error for "${query}":`, e);
    }
  }

  // Deduplicate by domain
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
}> {
  const result = {
    gateway: 'unknown' as string,
    stripePk: null as string | null,
    requiresLogin: false,
    requiresPhone: false,
    domain: '',
    notes: '',
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
      // Try common checkout/pricing pages
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
  } catch (e) {
    result.notes = `Fetch error: ${e instanceof Error ? e.message : 'unknown'}`;
  }

  return result;
}

// ── Send Telegram notification ─────────────────────────────
async function notifyTelegram(sites: Array<{ url: string; domain: string; gateway: string; category: string }>) {
  const botToken = Deno.env.get('TG_BOT_TOKEN');
  const chatId = Deno.env.get('TG_CHAT_ID');
  if (!botToken || !chatId || sites.length === 0) return;

  let msg = `🔍 <b>New Sites Found!</b>\n\n`;
  for (const s of sites) {
    const gw = s.gateway === 'stripe' ? '💳 Stripe' : s.gateway === 'adyen' ? '💳 Adyen' : `🔄 ${s.gateway}`;
    msg += `${gw} — <b>${s.domain}</b>\n<code>${s.url}</code>\n📂 ${s.category}\n\n`;
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

    // Get body for manual triggers (category filter, etc.)
    let body: any = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { /* empty body ok for cron */ }
    }

    // Fetch active categories
    const { data: categories } = await supabase
      .from('scraper_categories')
      .select('*')
      .eq('is_active', true);

    if (!categories || categories.length === 0) {
      return new Response(JSON.stringify({ message: 'No active categories. Add categories first.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = { discovered: 0, analyzed: 0, confirmed: 0, skipped: 0, errors: 0 };
    const confirmedSites: Array<{ url: string; domain: string; gateway: string; category: string }> = [];

    for (const cat of categories) {
      // If specific category requested, skip others
      if (body.category_id && cat.id !== body.category_id) continue;

      console.log(`[Scraper] Searching category: ${cat.name}`);
      const urls = await discoverSites(cat.name, cat.search_queries, apiKey);
      results.discovered += urls.length;

      for (const url of urls) {
        // Check if already exists
        const { data: existing } = await supabase
          .from('scraped_sites')
          .select('id')
          .eq('url', url)
          .maybeSingle();

        if (existing) continue;

        // Analyze the site
        const analysis = await analyzeSite(url);
        results.analyzed++;

        // Determine status
        let status = 'analyzed';
        if (analysis.requiresPhone) {
          status = 'skipped';
          results.skipped++;
        } else if (analysis.gateway === 'stripe' || analysis.gateway === 'adyen') {
          status = 'confirmed';
          results.confirmed++;
          confirmedSites.push({ url, domain: analysis.domain, gateway: analysis.gateway, category: cat.name });
        }

        // Insert into DB
        const { error: insertErr } = await supabase.from('scraped_sites').upsert({
          url,
          domain: analysis.domain,
          category_id: cat.id,
          payment_gateway: analysis.gateway,
          gateway_details: { stripePk: analysis.stripePk },
          stripe_pk: analysis.stripePk,
          requires_login: analysis.requiresLogin,
          requires_phone: analysis.requiresPhone,
          status,
          last_checked: new Date().toISOString(),
          notes: analysis.notes,
        }, { onConflict: 'url' });

        if (insertErr) {
          console.error('Insert error:', insertErr);
          results.errors++;
        }
      }
    }

    // Notify Telegram about confirmed sites
    if (confirmedSites.length > 0) {
      await notifyTelegram(confirmedSites);

      // Mark as notified
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
