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
const { Agent: UndiciAgent } = require("undici");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
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

function buildProxyUrl(p) {
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || "")}@` : "";
  return `${p.protocol}://${auth}${p.host}:${p.port}`;
}

function createAgent(p) {
  const url = buildProxyUrl(p);
  if (p.protocol.startsWith("socks")) return new SocksProxyAgent(url);
  return new HttpsProxyAgent(url);
}

function displayProxy(p) {
  const auth = p.username ? `${p.username}:***@` : "";
  return `${p.protocol}://${auth}${p.host}:${p.port}`;
}

// ── Validation (live test) ───────────────────────────────────

// Use endpoints that don't block datacenter/residential proxies.
// We accept any 2xx/3xx/4xx response — the goal is "did the TCP+TLS tunnel work",
// not "is this site reachable". Many proxies return 403/407 on hard-blocked sites
// but tunnel fine to Microsoft, which is all we care about.
const TEST_URLS = [
  "https://login.live.com/",                  // our actual target host
  "https://www.microsoft.com/robots.txt",
  "https://www.google.com/generate_204",
  "https://cp.cloudflare.com/",
];

async function testProxy(p, timeoutMs = 10000) {
  const agent = createAgent(p);
  let lastErr = "no response";
  for (const url of TEST_URLS) {
    try {
      const res = await fetch(url, {
        method: "GET",
        dispatcher: agent,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "*/*",
        },
      });
      // Any HTTP response means the proxy tunnel works.
      // 407 = proxy auth failed → proxy is dead for us.
      if (res.status === 407) {
        lastErr = "proxy auth failed (407)";
        continue;
      }
      await res.body?.cancel?.().catch(() => {});
      return { ok: true };
    } catch (err) {
      lastErr = err?.message || String(err);
    }
  }
  return { ok: false, error: lastErr };
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
