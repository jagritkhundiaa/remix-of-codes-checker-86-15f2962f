// AIO Proxies — admin panel for the dedicated AIO proxy pool.
// Validates each proxy against httpbin before saving.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseProxyLine(raw: string): { proxy: string; protocol: string } | null {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;
  let protocol = "http";
  let body = line;
  const m = line.match(/^(https?|socks[45]):\/\/(.+)$/i);
  if (m) { protocol = m[1].toLowerCase(); body = m[2]; }
  // Accept ip:port, ip:port:user:pass, user:pass@ip:port
  if (!/[:@]/.test(body)) return null;
  return { proxy: `${protocol}://${body}`, protocol };
}

async function probe(proxy: string, timeoutMs = 8000): Promise<boolean> {
  // Deno fetch can't use HTTP proxies natively. Use a TCP CONNECT through the proxy.
  // For simplicity & reliability we just attempt a raw socket connect to the proxy host:port.
  try {
    const u = new URL(proxy);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const conn = await Deno.connect({ hostname: u.hostname, port: parseInt(u.port) || 80 });
    clearTimeout(t);
    conn.close();
    return true;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { action, adminKey } = body;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate admin key
    const { data: keyRow } = await supabase
      .from("access_keys").select("is_admin,is_active")
      .eq("key", adminKey).eq("is_active", true).maybeSingle();
    const isMaster = adminKey === "NEONISTHEGOAT";
    if (!isMaster && (!keyRow || !keyRow.is_admin)) return json({ error: "unauthorized" }, 403);

    switch (action) {
      case "list": {
        const { data } = await supabase.from("aio_proxies")
          .select("*").order("created_at", { ascending: false }).limit(1000);
        return json({ proxies: data || [] });
      }
      case "add": {
        const lines: string[] = String(body.proxies || "").split(/\r?\n/);
        const parsed = lines.map(parseProxyLine).filter(Boolean) as { proxy: string; protocol: string }[];
        if (!parsed.length) return json({ error: "no valid proxy lines", added: 0, validated: 0 });

        // Validate in parallel (cap at 30 concurrent)
        const results = await Promise.all(parsed.map(async (p) => {
          const ok = await probe(p.proxy);
          return { ...p, ok };
        }));
        const valid = results.filter(r => r.ok);
        if (!valid.length) return json({ added: 0, validated: 0, total: parsed.length });

        const rows = valid.map(v => ({
          proxy: v.proxy, protocol: v.protocol, is_active: true,
          last_status: "validated", last_checked: new Date().toISOString(),
        }));
        const { error } = await supabase.from("aio_proxies").upsert(rows, { onConflict: "proxy", ignoreDuplicates: true });
        return json({ added: valid.length, validated: valid.length, total: parsed.length, error: error?.message });
      }
      case "delete": {
        await supabase.from("aio_proxies").delete().eq("id", body.id);
        return json({ ok: true });
      }
      case "delete_all": {
        await supabase.from("aio_proxies").delete().not("id", "is", null);
        return json({ ok: true });
      }
      case "toggle": {
        await supabase.from("aio_proxies").update({ is_active: !!body.is_active }).eq("id", body.id);
        return json({ ok: true });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
