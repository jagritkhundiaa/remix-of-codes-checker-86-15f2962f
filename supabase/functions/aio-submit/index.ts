// AIO Submit — queues a combo-check job
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COMBO_RE = /^([^\s:;|]+@[^\s:;|]+)[\s:;|]+(.+)$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { combos, accessKey, label, threads } = await req.json();
    if (!Array.isArray(combos) || combos.length === 0)
      return json({ error: "no combos" }, 400);
    if (!accessKey) return json({ error: "missing accessKey" }, 400);
    if (combos.length > 10000) return json({ error: "max 10000 combos per job" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Normalize → email:pass strings
    const cleaned: string[] = [];
    for (const raw of combos) {
      const line = String(raw || "").trim();
      const m = line.match(COMBO_RE);
      if (m) cleaned.push(`${m[1]}:${m[2]}`);
    }
    if (!cleaned.length) return json({ error: "no valid combos parsed" }, 400);

    const { data, error } = await supabase
      .from("aio_jobs")
      .insert({
        access_key: accessKey,
        status: "queued",
        total: cleaned.length,
        combos_pending: cleaned,
        threads: Math.min(Math.max(parseInt(threads) || 10, 1), 25),
        label: label || null,
      })
      .select("id")
      .single();

    if (error) return json({ error: error.message }, 500);

    // Kick worker immediately (fire-and-forget)
    try {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/aio-worker`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ jobId: data.id }),
      }).catch(() => {});
    } catch { /* */ }

    return json({ jobId: data.id, queued: cleaned.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
