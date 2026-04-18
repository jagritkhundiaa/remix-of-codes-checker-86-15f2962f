// ============================================================
//  Proxy Manager — supports ALL proxy formats
//  HTTP, HTTPS, SOCKS4, SOCKS5, with/without auth
//  Round-robin rotation, persistent JSON storage, validation,
//  health checks, mass add/clear, full stats.
//
//  Supported formats (any of these):
//    host:port
//    host:port:user:pass            ← purevpn-style (must work)
//    user:pass@host:port
//    user:pass:host:port
//    http(s)://host:port
//    http(s)://user:pass@host:port
//    socks4://host:port
//    socks5://host:port
//    socks5://user:pass@host:port
//    socks5h://...
// ============================================================

const fs = require("fs");
const path = require("path");
const { Agent: UndiciAgent, ProxyAgent } = require("undici");
const { SocksProxyAgent } = require("socks-proxy-agent");
const config = require("../config");

const STORE_FILE = path.join(__dirname, "..", "..", "data", "proxies.json");
const TXT_FILE = path.join(__dirname, "..", "..", "proxies.txt");

let proxies = [];        // [{ raw, protocol, host, port, username, password, fail, ok }]
let currentIndex = 0;
let proxyStats = { total: 0, success: 0, failed: 0 };

// ── Persistence ──────────────────────────────────────────────

function ensureDir() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function persist() {
  ensureDir();
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(proxies, null, 2));
  } catch {}
}

function loadFromStore() {
  ensureDir();
  if (!fs.existsSync(STORE_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ── Stats ────────────────────────────────────────────────────

function resetProxyStats() {
  proxyStats = { total: 0, success: 0, failed: 0 };
}

function getProxyStats() {
  const rate = proxyStats.total > 0 ? Math.round((proxyStats.success / proxyStats.total) * 100) : 0;
  return { ...proxyStats, successRate: rate };
}

// ── Parsing ──────────────────────────────────────────────────

function parseProxy(raw) {
  const line = String(raw || "").trim();
  if (!line || line.startsWith("#")) return null;

  const protoMatch = line.match(/^(https?|socks[45]?h?|socks4a?):\/\/(.+)$/i);
  if (protoMatch) {
    const protocol = protoMatch[1].toLowerCase().replace(/h$|a$/, m => m === "h" ? "h" : "");
    return parseHostPart(protoMatch[2], protoMatch[1].toLowerCase(), line);
  }
  return parseHostPart(line, "http", line);
}

function parseHostPart(rest, protocol, raw) {
  // user:pass@host:port
  const at = rest.indexOf("@");
  if (at !== -1) {
    const authPart = rest.substring(0, at);
    const hostPart = rest.substring(at + 1);
    const [host, port] = splitHostPort(hostPart);
    const colon = authPart.indexOf(":");
    const username = colon > -1 ? authPart.substring(0, colon) : authPart;
    const password = colon > -1 ? authPart.substring(colon + 1) : "";
    if (!host || !isValidPort(port)) return null;
    return { raw, protocol, host, port: +port, username, password, fail: 0, ok: 0 };
  }

  const parts = rest.split(":");
  if (parts.length === 2) {
    if (!parts[0] || !isValidPort(parts[1])) return null;
    return { raw, protocol, host: parts[0], port: +parts[1], username: "", password: "", fail: 0, ok: 0 };
  }
  if (parts.length === 4) {
    // host:port:user:pass  OR  user:pass:host:port
    if (isValidPort(parts[1])) {
      return { raw, protocol, host: parts[0], port: +parts[1], username: parts[2], password: parts[3], fail: 0, ok: 0 };
    }
    if (isValidPort(parts[3])) {
      return { raw, protocol, host: parts[2], port: +parts[3], username: parts[0], password: parts[1], fail: 0, ok: 0 };
    }
    return null;
  }
  if (parts.length === 3) {
    if (!isValidPort(parts[1])) return null;
    return { raw, protocol, host: parts[0], port: +parts[1], username: parts[2], password: "", fail: 0, ok: 0 };
  }
  return null;
}

function splitHostPort(str) {
  const ipv6 = str.match(/^\[(.+)\]:(\d+)$/);
  if (ipv6) return [ipv6[1], ipv6[2]];
  const last = str.lastIndexOf(":");
  if (last === -1) return [str, ""];
  return [str.substring(0, last), str.substring(last + 1)];
}

function isValidPort(p) {
  const n = parseInt(p, 10);
  return !isNaN(n) && n > 0 && n <= 65535;
}

function buildProxyUrl(p, { withAuth = true } = {}) {
  const auth = withAuth && p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || "")}@`
    : "";
  return `${p.protocol}://${auth}${p.host}:${p.port}`;
}

// Build a real Undici Dispatcher.
//   • HTTP/HTTPS proxies → undici ProxyAgent (the only dispatcher
//     Node's built-in fetch() actually honors).
//   • SOCKS proxies     → wrap socks-proxy-agent inside an Undici
//     Agent via the `connect` factory so fetch() can use it.
function createAgent(p) {
  if (p.protocol.startsWith("socks")) {
    const socks = new SocksProxyAgent(buildProxyUrl(p));
    return new UndiciAgent({
      connect: (opts, cb) => {
        try { socks.callback(opts, opts, cb); }
        catch (e) { cb(e); }
      },
    });
  }
  // HTTP / HTTPS proxy — auth goes in the URL.
  const proto = p.protocol === "https" ? "https" : "http";
  const uri = `${proto}://${p.host}:${p.port}`;
  const token = p.username
    ? `Basic ${Buffer.from(`${p.username}:${p.password || ""}`).toString("base64")}`
    : undefined;
  return new ProxyAgent(token ? { uri, token } : { uri });
}

function displayProxy(p) {
  const auth = p.username ? `${p.username}:***@` : "";
  return `${p.protocol}://${auth}${p.host}:${p.port}`;
}

// ── Validation (live test) ───────────────────────────────────
//
// Python-style philosophy (mirrors xbox-checker-bot-py):
// don't pre-validate aggressively — trust the proxy, let the real
// flow filter dead ones via runtime fallback. Many premium proxies
// (PureVPN, residential pools) reject raw TCP probes and only honor
// CONNECT from authenticated requests, so a TCP-reach test produces
// massive false negatives.
//
// Strategy:
//  • Skip TCP probe entirely.
//  • Race 5 HTTP probes through the proxy.
//  • Accept on ANY tunnel response except hard-fail 407 (bad auth).
//  • Retry once on transient/network noise before declaring dead.

const PROBE_URLS = [
  "http://www.gstatic.com/generate_204",     // plain HTTP, hardest to block
  "https://www.gstatic.com/generate_204",
  "https://cp.cloudflare.com/",
  "https://www.google.com/generate_204",
  "https://login.live.com/",
];

const TRANSIENT_RX = /ECONNRESET|socket hang up|ETIMEDOUT|EAI_AGAIN|other side closed|terminated|aborted|network|fetch failed/i;

async function httpProbe(p, url, timeoutMs) {
  const agent = createAgent(p);
  try {
    const res = await fetch(url, {
      method: "GET",
      dispatcher: agent,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "*/*",
        Connection: "close",
      },
    });
    res.body?.cancel?.().catch(() => {});
    // 407 = proxy auth failure → genuinely unusable.
    if (res.status === 407) return { ok: false, reason: "auth_407" };
    // Any other status (200, 204, 301, 403, 404, 503, …) means
    // the tunnel was established and the proxy forwarded our request.
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

async function testProxy(p, timeoutMs = 12000) {
  // Race all probes — first tunnel success wins.
  const settled = await Promise.allSettled(PROBE_URLS.map((u) => httpProbe(p, u, timeoutMs)));
  if (settled.some((s) => s.status === "fulfilled" && s.value?.ok)) return { ok: true };

  const reasons = settled.map((s) =>
    s.status === "fulfilled" ? s.value?.reason : (s.reason?.message || String(s.reason))
  ).filter(Boolean);

  // Hard fail only on real auth rejection.
  if (reasons.every((r) => /auth_407|407/.test(String(r)))) {
    return { ok: false, error: "auth_failed_407" };
  }

  // Retry once on transient noise — premium proxies often need a warm-up.
  if (reasons.some((r) => TRANSIENT_RX.test(String(r)) || /timeout|aborted/i.test(String(r)))) {
    for (const url of [PROBE_URLS[0], PROBE_URLS[2]]) {
      const retry = await httpProbe(p, url, timeoutMs + 3000);
      if (retry.ok) return { ok: true };
      if (retry.reason && /auth_407|407/.test(retry.reason)) {
        return { ok: false, error: "auth_failed_407" };
      }
    }
  }

  return { ok: false, error: reasons[0] || "no_probe_response" };
}

// ── Public CRUD ──────────────────────────────────────────────

function loadProxies() {
  // Load from JSON store first; if empty, fall back to legacy proxies.txt
  proxies = loadFromStore();
  if (proxies.length === 0 && fs.existsSync(TXT_FILE)) {
    const lines = fs.readFileSync(TXT_FILE, "utf-8")
      .split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    for (const l of lines) {
      const p = parseProxy(l);
      if (p) proxies.push(p);
    }
    if (proxies.length) persist();
  }
  currentIndex = 0;
  console.log(`[Proxy] Loaded ${proxies.length} proxies`);
  return proxies.length;
}

function reloadProxies() { return loadProxies(); }

function clearProxies() {
  const n = proxies.length;
  proxies = [];
  currentIndex = 0;
  persist();
  return n;
}

function getProxyCount() { return proxies.length; }

function isProxyEnabled() {
  return config.USE_PROXIES === true && proxies.length > 0;
}

function listProxies() {
  return proxies.map((p, i) => ({
    i,
    display: displayProxy(p),
    protocol: p.protocol,
    fail: p.fail || 0,
    ok: p.ok || 0,
  }));
}

/**
 * Validate and add a batch of raw proxy lines.
 * Returns { added, invalid, dead, total }.
 */
async function addAndValidate(rawLines, { concurrency = 20, timeoutMs = 8000 } = {}) {
  const lines = rawLines.map(l => String(l || "").trim()).filter(Boolean);
  const parsed = [];
  let invalid = 0;
  for (const l of lines) {
    const p = parseProxy(l);
    if (!p) { invalid++; continue; }
    parsed.push(p);
  }

  // Dedupe against existing
  const existing = new Set(proxies.map(p => `${p.protocol}://${p.host}:${p.port}`));
  const fresh = [];
  for (const p of parsed) {
    const key = `${p.protocol}://${p.host}:${p.port}`;
    if (existing.has(key)) continue;
    existing.add(key);
    fresh.push(p);
  }

  // Test in parallel batches
  const alive = [];
  let dead = 0;
  let i = 0;
  async function worker() {
    while (i < fresh.length) {
      const idx = i++;
      const p = fresh[idx];
      const r = await testProxy(p, timeoutMs);
      if (r.ok) alive.push(p);
      else dead++;
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, fresh.length)) }, worker);
  await Promise.all(workers);

  for (const p of alive) proxies.push(p);
  if (alive.length) persist();

  return { added: alive.length, invalid, dead, total: lines.length };
}

/**
 * Remove a proxy by index (matches listProxies() ordering).
 */
function removeProxy(idx) {
  if (idx < 0 || idx >= proxies.length) return false;
  proxies.splice(idx, 1);
  if (currentIndex >= proxies.length) currentIndex = 0;
  persist();
  return true;
}

/**
 * Re-test all stored proxies and drop the dead ones.
 * Returns { kept, removed }.
 */
async function healthCheck({ concurrency = 20, timeoutMs = 8000 } = {}) {
  const snapshot = proxies.slice();
  const alive = [];
  let i = 0;
  async function worker() {
    while (i < snapshot.length) {
      const idx = i++;
      const p = snapshot[idx];
      const r = await testProxy(p, timeoutMs);
      if (r.ok) { p.ok = (p.ok || 0) + 1; p.fail = 0; alive.push(p); }
      else { p.fail = (p.fail || 0) + 1; }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, snapshot.length)) }, worker);
  await Promise.all(workers);

  const removed = proxies.length - alive.length;
  proxies = alive;
  currentIndex = 0;
  persist();
  return { kept: alive.length, removed };
}

// ── Rotation ─────────────────────────────────────────────────

function getNextProxy() {
  if (proxies.length === 0) return null;
  const p = proxies[currentIndex % proxies.length];
  currentIndex++;
  return p;
}

function getRandomProxy() {
  if (proxies.length === 0) return null;
  return proxies[Math.floor(Math.random() * proxies.length)];
}

// ── Fetch with fallback ──────────────────────────────────────

const ipv4Dispatcher = new UndiciAgent({ connect: { family: 4 } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function directFetchWithFallback(url, options = {}) {
  let lastErr = null;
  for (let a = 1; a <= 2; a++) {
    try { return await fetch(url, options); }
    catch (e) { lastErr = e; if (a < 2) await sleep(250 * a); }
  }
  try { return await fetch(url, { ...options, dispatcher: ipv4Dispatcher }); }
  catch (e) { throw new Error(`direct fetch failed (${lastErr?.message || "?"}); ipv4 (${e.message})`); }
}

async function proxiedFetch(url, options = {}) {
  if (!isProxyEnabled()) return directFetchWithFallback(url, options);

  // Try up to 3 different proxies before falling back to direct
  let lastProxyErr = null;
  for (let attempt = 0; attempt < Math.min(3, proxies.length); attempt++) {
    const p = getNextProxy();
    if (!p) break;
    const agent = createAgent(p);
    proxyStats.total++;
    try {
      const res = await fetch(url, { ...options, dispatcher: agent });
      proxyStats.success++;
      p.ok = (p.ok || 0) + 1;
      return res;
    } catch (e) {
      proxyStats.failed++;
      p.fail = (p.fail || 0) + 1;
      lastProxyErr = e;
      // If a proxy fails repeatedly, drop it silently
      if ((p.fail || 0) >= 10) {
        const idx = proxies.indexOf(p);
        if (idx !== -1) proxies.splice(idx, 1);
      }
    }
  }

  try { return await directFetchWithFallback(url, options); }
  catch (e) { throw new Error(`all proxies failed (${lastProxyErr?.message || "?"}); direct (${e.message})`); }
}

module.exports = {
  loadProxies,
  reloadProxies,
  clearProxies,
  getProxyCount,
  isProxyEnabled,
  getNextProxy,
  getRandomProxy,
  getProxyStats,
  resetProxyStats,
  proxiedFetch,
  parseProxy,
  addAndValidate,
  removeProxy,
  healthCheck,
  listProxies,
  testProxy,
  displayProxy,
};
