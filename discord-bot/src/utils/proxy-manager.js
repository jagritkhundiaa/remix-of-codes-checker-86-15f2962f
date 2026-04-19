// ============================================================
//  Proxy Manager — round-robin rotation + parallel-safe
//  Supports HTTP/HTTPS/SOCKS4/SOCKS5 with auth.
//  Formats:
//    ip:port          host:port
//    ip:port:user:pass
//    user:pass@host:port
//    http(s)://user:pass@host:port
//    socks5://user:pass@host:port
// ============================================================

const fs = require("fs");
const path = require("path");
const { Agent: UndiciAgent, ProxyAgent } = require("undici");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
const config = require("../config");

let proxies = [];
let rrIndex = 0;
let proxyStats = { total: 0, success: 0, failed: 0 };
const deadProxies = new Set(); // host:port keys with too many fails
const failCounts = new Map();

// Timeouts (ms)
const CONNECT_TIMEOUT = 8000;
const REQUEST_TIMEOUT = 20000;
const MAX_PROXY_RETRIES = 3; // try N different proxies before giving up
const MAX_FAILS_BEFORE_DEAD = 5;

function resetProxyStats() {
  proxyStats = { total: 0, success: 0, failed: 0 };
  deadProxies.clear();
  failCounts.clear();
}

function getProxyStats() {
  const rate = proxyStats.total > 0 ? Math.round((proxyStats.success / proxyStats.total) * 100) : 0;
  return { ...proxyStats, successRate: rate, dead: deadProxies.size, alive: proxies.length - deadProxies.size };
}

// ── Parsing ──────────────────────────────────────────────
function parseProxy(raw) {
  const line = (raw || "").trim();
  if (!line || line.startsWith("#")) return null;

  const protoMatch = line.match(/^(https?|socks[45]h?):\/\/(.+)$/i);
  if (protoMatch) return parseHostPart(protoMatch[2], protoMatch[1].toLowerCase());
  return parseHostPart(line, "http");
}

function parseHostPart(rest, protocol) {
  const at = rest.indexOf("@");
  if (at > -1) {
    const authPart = rest.substring(0, at);
    const hostPart = rest.substring(at + 1);
    const [host, port] = splitHostPort(hostPart);
    const c = authPart.indexOf(":");
    return {
      protocol,
      host,
      port: parseInt(port) || 80,
      username: c > -1 ? authPart.substring(0, c) : authPart,
      password: c > -1 ? authPart.substring(c + 1) : "",
    };
  }

  const parts = rest.split(":");
  if (parts.length === 2) {
    return { protocol, host: parts[0], port: parseInt(parts[1]) || 80, username: null, password: null };
  }
  if (parts.length === 4) {
    const second = parseInt(parts[1]);
    const fourth = parseInt(parts[3]);
    if (!isNaN(second) && second > 0 && second <= 65535) {
      // host:port:user:pass  ← most common
      return { protocol, host: parts[0], port: second, username: parts[2], password: parts[3] };
    }
    if (!isNaN(fourth) && fourth > 0 && fourth <= 65535) {
      return { protocol, host: parts[2], port: fourth, username: parts[0], password: parts[1] };
    }
    return { protocol, host: parts[0], port: parseInt(parts[1]) || 80, username: parts[2], password: parts[3] };
  }
  if (parts.length === 3) {
    return { protocol, host: parts[0], port: parseInt(parts[1]) || 80, username: parts[2], password: null };
  }
  return { protocol, host: rest, port: 80, username: null, password: null };
}

function splitHostPort(str) {
  const ipv6 = str.match(/^\[(.+)\]:(\d+)$/);
  if (ipv6) return [ipv6[1], ipv6[2]];
  const last = str.lastIndexOf(":");
  if (last === -1) return [str, "80"];
  return [str.substring(0, last), str.substring(last + 1)];
}

function buildProxyUrl(proxy) {
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || "")}@`
    : "";
  return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;
}

function proxyKey(p) {
  return `${p.host}:${p.port}`;
}

// ── Agent factory (cached per proxy) ─────────────────────
const agentCache = new Map();
function createAgent(proxy) {
  const key = `${proxy.protocol}://${proxy.username || ""}:${proxy.password || ""}@${proxy.host}:${proxy.port}`;
  if (agentCache.has(key)) return agentCache.get(key);

  const url = buildProxyUrl(proxy);
  let agent;
  if (proxy.protocol.startsWith("socks")) {
    agent = new SocksProxyAgent(url, { timeout: CONNECT_TIMEOUT });
  } else {
    agent = new HttpsProxyAgent(url, { timeout: CONNECT_TIMEOUT, keepAlive: true });
  }
  agentCache.set(key, agent);
  return agent;
}

// Undici dispatcher (for native fetch on Node 18+)
const dispatcherCache = new Map();
function createDispatcher(proxy) {
  if (proxy.protocol.startsWith("socks")) return null; // undici has no socks support
  const url = buildProxyUrl(proxy);
  if (dispatcherCache.has(url)) return dispatcherCache.get(url);
  const d = new ProxyAgent({
    uri: url,
    connectTimeout: CONNECT_TIMEOUT,
    bodyTimeout: REQUEST_TIMEOUT,
    headersTimeout: REQUEST_TIMEOUT,
  });
  dispatcherCache.set(url, d);
  return d;
}

// ── Loading ──────────────────────────────────────────────
function loadProxies() {
  const filePath = path.join(__dirname, "..", "..", "proxies.txt");
  if (!fs.existsSync(filePath)) {
    console.log("[Proxy] No proxies.txt found. Proxy support disabled.");
    proxies = [];
    return 0;
  }
  const lines = fs.readFileSync(filePath, "utf-8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  proxies = lines.map(parseProxy).filter(Boolean);
  rrIndex = 0;
  deadProxies.clear();
  failCounts.clear();
  agentCache.clear();
  dispatcherCache.clear();
  console.log(`[Proxy] Loaded ${proxies.length} proxies (round-robin enabled)`);
  return proxies.length;
}

function reloadProxies() { return loadProxies(); }

// ── Round-robin selection (atomic) ───────────────────────
function getNextProxy() {
  if (proxies.length === 0) return null;
  const start = rrIndex;
  for (let i = 0; i < proxies.length; i++) {
    const idx = (start + i) % proxies.length;
    const p = proxies[idx];
    if (!deadProxies.has(proxyKey(p))) {
      rrIndex = (idx + 1) % proxies.length;
      return p;
    }
  }
  // All dead — reset and try again
  deadProxies.clear();
  failCounts.clear();
  rrIndex = (rrIndex + 1) % proxies.length;
  return proxies[rrIndex];
}

function getRandomProxy() {
  if (proxies.length === 0) return null;
  const alive = proxies.filter((p) => !deadProxies.has(proxyKey(p)));
  const pool = alive.length ? alive : proxies;
  return pool[Math.floor(Math.random() * pool.length)];
}

function isProxyEnabled() {
  return config.USE_PROXIES === true && proxies.length > 0;
}

function getProxyCount() {
  return proxies.length;
}

function markFail(proxy) {
  const k = proxyKey(proxy);
  const n = (failCounts.get(k) || 0) + 1;
  failCounts.set(k, n);
  if (n >= MAX_FAILS_BEFORE_DEAD) deadProxies.add(k);
}

function markSuccess(proxy) {
  failCounts.delete(proxyKey(proxy));
}

// ── Fetch with timeout ───────────────────────────────────
function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  const opts = { ...options, signal: options.signal || ctrl.signal };
  return fetch(url, opts).finally(() => clearTimeout(timer));
}

const ipv4Dispatcher = new UndiciAgent({
  connect: { family: 4, timeout: CONNECT_TIMEOUT },
  bodyTimeout: REQUEST_TIMEOUT,
  headersTimeout: REQUEST_TIMEOUT,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function directFetchWithFallback(url, options = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetchWithTimeout(url, options, REQUEST_TIMEOUT);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(200);
    }
  }
  try {
    return await fetchWithTimeout(url, { ...options, dispatcher: ipv4Dispatcher }, REQUEST_TIMEOUT);
  } catch (err) {
    throw new Error(`direct failed (${lastErr?.message}); ipv4 failed (${err.message})`);
  }
}

/**
 * Proxied fetch with auto-rotation on failure.
 * Tries up to MAX_PROXY_RETRIES different proxies before falling back to direct.
 */
async function proxiedFetch(url, options = {}) {
  if (!isProxyEnabled()) return directFetchWithFallback(url, options);

  const tried = new Set();
  let lastErr;

  for (let attempt = 0; attempt < MAX_PROXY_RETRIES; attempt++) {
    const proxy = getNextProxy();
    if (!proxy) break;
    const key = proxyKey(proxy);
    if (tried.has(key)) continue;
    tried.add(key);

    proxyStats.total++;
    try {
      const agent = createAgent(proxy);
      const dispatcher = createDispatcher(proxy);
      const opts = { ...options, agent };
      if (dispatcher) opts.dispatcher = dispatcher;

      const res = await fetchWithTimeout(url, opts, REQUEST_TIMEOUT);
      proxyStats.success++;
      markSuccess(proxy);
      return res;
    } catch (err) {
      proxyStats.failed++;
      markFail(proxy);
      lastErr = err;
      // Quick rotation, no sleep — keeps parallel workers moving
    }
  }

  // All proxy attempts failed — try direct as last resort
  try {
    return await directFetchWithFallback(url, options);
  } catch (directErr) {
    throw new Error(`all proxies failed (${lastErr?.message || "n/a"}); direct failed (${directErr.message})`);
  }
}

module.exports = {
  loadProxies,
  reloadProxies,
  getNextProxy,
  getRandomProxy,
  isProxyEnabled,
  getProxyCount,
  getProxyStats,
  resetProxyStats,
  proxiedFetch,
  parseProxy,
  buildProxyUrl,
};
