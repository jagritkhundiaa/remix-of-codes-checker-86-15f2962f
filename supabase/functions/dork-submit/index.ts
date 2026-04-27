// Dork Submit — queues a dorking job
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { dorks, accessKey, label, engine, resultsPerDork, preset } = await req.json();
    if (!Array.isArray(dorks) || dorks.length === 0)
      return json({ error: "no dorks" }, 400);
    if (!accessKey) return json({ error: "missing accessKey" }, 400);
    if (dorks.length > 2000) return json({ error: "max 2000 dorks per job" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Dedupe + clean
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of dorks) {
      const line = String(raw || "").trim();
      if (!line || line.length > 500) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      cleaned.push(line);
    }
    if (!cleaned.length) return json({ error: "no valid dorks" }, 400);

    const eng = ["duckduckgo", "bing"].includes(engine) ? engine : "duckduckgo";
    const rpd = Math.min(Math.max(parseInt(resultsPerDork) || 20, 5), 50);

    const { data, error } = await supabase
      .from("dork_jobs")
      .insert({
        access_key: accessKey,
        status: "queued",
        total_dorks: cleaned.length,
        dorks_pending: cleaned,
        engine: eng,
        results_per_dork: rpd,
        preset: preset || null,
        label: label || null,
      })
      .select("id")
      .single();

    if (error) return json({ error: error.message }, 500);

    // Kick worker (fire-and-forget)
    try {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/dork-worker`, {
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
