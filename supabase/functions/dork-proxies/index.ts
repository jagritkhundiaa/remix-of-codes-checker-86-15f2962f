// Dork Proxies — CRUD + connectivity probe for the dork engine pool
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseProxyLine(raw: string): { proxy: string; protocol: string } | null {
  let line = String(raw || "").trim();
  if (!line) return null;
  let protocol = "http";
  const m = line.match(/^(https?|socks4|socks5):\/\/(.+)$/i);
  if (m) { protocol = m[1].toLowerCase(); line = m[2]; }
  // forms: ip:port, ip:port:user:pass, user:pass@ip:port
  if (/@/.test(line)) {
    const [auth, host] = line.split("@");
    if (!auth || !host) return null;
    const [u, p] = auth.split(":");
    const [h, port] = host.split(":");
    if (!u || !p || !h || !port) return null;
    return { proxy: `${u}:${p}@${h}:${port}`, protocol };
  }
  const parts = line.split(":");
  if (parts.length === 2) return { proxy: `${parts[0]}:${parts[1]}`, protocol };
  if (parts.length === 4) return { proxy: `${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`, protocol };
  return null;
}

async function probe(proxy: string, timeoutMs = 6000): Promise<boolean> {
  // Just verify host:port is reachable (TCP connect)
  const hostPort = proxy.includes("@") ? proxy.split("@")[1] : proxy;
  const [host, portStr] = hostPort.split(":");
  const port = parseInt(portStr);
  if (!host || !port) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const conn = await Deno.connect({ hostname: host, port });
    conn.close();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { action, accessKey } = body;
    if (!accessKey) return json({ error: "missing accessKey" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (action === "list") {
      const { data, error } = await supabase
        .from("dork_proxies")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) return json({ error: error.message }, 500);
      return json({ proxies: data || [] });
    }

    if (action === "add") {
      const lines = String(body.proxies || "").split(/\r?\n/);
      const parsed = lines.map(parseProxyLine).filter(Boolean) as { proxy: string; protocol: string }[];
      if (!parsed.length) return json({ error: "no valid proxies" }, 400);

      // Probe in parallel (cap 30)
      const results: { proxy: string; protocol: string; ok: boolean }[] = [];
      const queue = [...parsed];
      const workers = Array.from({ length: 30 }, async () => {
        while (queue.length) {
          const item = queue.shift()!;
          const ok = await probe(item.proxy);
          results.push({ ...item, ok });
        }
      });
      await Promise.all(workers);

      const valid = results.filter(r => r.ok);
      if (!valid.length) return json({ error: "all proxies failed connectivity probe", added: 0, tested: results.length }, 200);

      const rows = valid.map(v => ({
        proxy: v.proxy,
        protocol: v.protocol,
        is_active: true,
        last_status: "ok",
        last_checked: new Date().toISOString(),
      }));
      const { error } = await supabase.from("dork_proxies").upsert(rows, { onConflict: "proxy" });
      if (error) return json({ error: error.message }, 500);
      return json({ added: valid.length, tested: results.length, failed: results.length - valid.length });
    }

    if (action === "delete") {
      const { error } = await supabase.from("dork_proxies").delete().eq("id", body.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "delete_all") {
      const { error } = await supabase.from("dork_proxies").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "toggle") {
      const { error } = await supabase.from("dork_proxies").update({ is_active: body.is_active }).eq("id", body.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
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
