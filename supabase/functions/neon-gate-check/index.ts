import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Gate API: accepts gate_id + cc line, loads gate config, forwards to neon-check
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { gate_id, cc, access_key, mode } = body;

    if (!gate_id || !cc || !access_key) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: gate_id, cc (number|mm|yy|cvv), access_key',
        example: { gate_id: 'uuid', cc: '4111111111111111|01|28|123', access_key: 'YOUR_KEY', mode: 'hitter' },
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Parse cc line
    const parts = cc.split('|');
    if (parts.length < 4) {
      return new Response(JSON.stringify({ error: 'Invalid cc format. Use: number|mm|yy|cvv' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const [number, month, year, cvv] = parts;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Validate access key
    const { data: keyData } = await supabase
      .from('access_keys')
      .select('*')
      .eq('key', access_key)
      .eq('is_active', true)
      .single();

    if (!keyData) {
      return new Response(JSON.stringify({ error: 'Invalid access key' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load gate
    const { data: gate } = await supabase
      .from('custom_gates')
      .select('*')
      .eq('id', gate_id)
      .eq('is_active', true)
      .single();

    if (!gate) {
      return new Response(JSON.stringify({ error: 'Gate not found or inactive' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Forward to neon-check internally
    const checkPayload = {
      card: { number: number.trim(), month: month.trim(), year: year.trim(), cvv: cvv.trim() },
      provider: gate.provider,
      stripePk: gate.stripe_pk,
      clientSecret: gate.client_secret,
      merchant: gate.merchant || gate.name,
      amount: gate.amount,
      accessKey: access_key,
      mode: mode || 'hitter',
    };

    const fnUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/neon-check`;
    const resp = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
      },
      body: JSON.stringify(checkPayload),
    });

    const result = await resp.json();

    return new Response(JSON.stringify({
      gate: gate.name,
      provider: gate.provider,
      merchant: gate.merchant || gate.name,
      ...result,
    }), {
      status: resp.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
