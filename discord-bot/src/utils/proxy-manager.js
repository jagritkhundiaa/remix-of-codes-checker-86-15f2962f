// ============================================================
//  Proxy Manager — supports ALL proxy formats
//  HTTP, HTTPS, SOCKS4, SOCKS5, with/without auth
//  Formats: protocol://user:pass@host:port, host:port,
//           user:pass@host:port, host:port:user:pass, etc.
// ============================================================

const fs = require("fs");
const path = require("path");
const { Agent: UndiciAgent } = require("undici");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const config = require("../config");

let proxies = [];
let currentIndex = 0;
let proxyStats = { total: 0, success: 0, failed: 0 };

function resetProxyStats() {
  proxyStats = { total: 0, success: 0, failed: 0 };
}

function getProxyStats() {
  const rate = proxyStats.total > 0 ? Math.round((proxyStats.success / proxyStats.total) * 100) : 0;
  return { ...proxyStats, successRate: rate };
}

/**
 * Parse any proxy format into a normalized { protocol, host, port, username, password } object.
 * Supports:
 *   - http://host:port
 *   - https://host:port
 *   - socks4://host:port
 *   - socks5://host:port
 *   - http://user:pass@host:port
 *   - socks5://user:pass@host:port
 *   - host:port (defaults to http)
 *   - host:port:user:pass
 *   - user:pass@host:port
 *   - user:pass:host:port
 *   - ip:port (defaults to http)
 */
function parseProxy(raw) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;

  // Has protocol prefix
  const protocolMatch = line.match(/^(https?|socks[45]?|socks5h?):\/\/(.+)$/i);
  if (protocolMatch) {
    const protocol = protocolMatch[1].toLowerCase();
    const rest = protocolMatch[2];
    return parseHostPart(rest, protocol);
  }

  // No protocol — try to detect format
  return parseHostPart(line, "http");
}

function parseHostPart(rest, protocol) {
  // user:pass@host:port
  const atMatch = rest.match(/^([^@]+)@(.+)$/);
  if (atMatch) {
    const authPart = atMatch[1];
    const hostPart = atMatch[2];
    const [host, port] = splitHostPort(hostPart);
    const colonIdx = authPart.indexOf(":");
    if (colonIdx > -1) {
      return {
        protocol,
        host,
        port: parseInt(port) || 80,
        username: authPart.substring(0, colonIdx),
        password: authPart.substring(colonIdx + 1),
      };
    }
    return { protocol, host, port: parseInt(port) || 80, username: authPart, password: "" };
  }

  // Count colons to determine format
  const parts = rest.split(":");
  
  if (parts.length === 2) {
    // host:port
    return { protocol, host: parts[0], port: parseInt(parts[1]) || 80, username: null, password: null };
  }

  if (parts.length === 4) {
    // Could be host:port:user:pass OR user:pass:host:port
    // Heuristic: if second part is a valid port number, it's host:port:user:pass
    const secondNum = parseInt(parts[1]);
    const fourthNum = parseInt(parts[3]);

    if (!isNaN(secondNum) && secondNum > 0 && secondNum <= 65535) {
      // host:port:user:pass
      return { protocol, host: parts[0], port: secondNum, username: parts[2], password: parts[3] };
    }
    if (!isNaN(fourthNum) && fourthNum > 0 && fourthNum <= 65535) {
      // user:pass:host:port
      return { protocol, host: parts[2], port: fourthNum, username: parts[0], password: parts[1] };
    }
    // Default: host:port:user:pass
    return { protocol, host: parts[0], port: parseInt(parts[1]) || 80, username: parts[2], password: parts[3] };
  }

  if (parts.length === 3) {
    // host:port:user (rare) — treat as host:port with partial auth
    return { protocol, host: parts[0], port: parseInt(parts[1]) || 80, username: parts[2], password: null };
  }

  // Fallback: treat whole thing as host with default port
  return { protocol, host: rest, port: 80, username: null, password: null };
}

function splitHostPort(str) {
  // Handle IPv6 [::1]:port
  const ipv6Match = str.match(/^\[(.+)\]:(\d+)$/);
  if (ipv6Match) return [ipv6Match[1], ipv6Match[2]];
  
  const lastColon = str.lastIndexOf(":");
  if (lastColon === -1) return [str, "80"];
  return [str.substring(0, lastColon), str.substring(lastColon + 1)];
}

/**
 * Build a proxy URL string from parsed proxy object.
 */
function buildProxyUrl(proxy) {
  const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || "")}@` : "";
  return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;
}

/**
 * Create a Node.js agent for the given proxy.
 */
function createAgent(proxy) {
  const url = buildProxyUrl(proxy);

  if (proxy.protocol.startsWith("socks")) {
    return new SocksProxyAgent(url);
  }
  // For HTTP/HTTPS targets through HTTP/HTTPS proxies
  return new HttpsProxyAgent(url);
}

/**
 * Load proxies from proxies.txt file.
 * Call this on bot startup.
 */
function loadProxies() {
  const filePath = path.join(__dirname, "..", "..", "proxies.txt");
  
  if (!fs.existsSync(filePath)) {
    console.log("[Proxy] No proxies.txt found. Proxy support disabled.");
    proxies = [];
    return 0;
  }

  const lines = fs.readFileSync(filePath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  proxies = lines.map(parseProxy).filter(Boolean);
  currentIndex = 0;

  console.log(`[Proxy] Loaded ${proxies.length} proxies from proxies.txt`);
  return proxies.length;
}

/**
 * Get the next proxy in round-robin rotation.
 */
function getNextProxy() {
  if (proxies.length === 0) return null;
  const proxy = proxies[currentIndex % proxies.length];
  currentIndex++;
  return proxy;
}

/**
 * Get a random proxy.
 */
function getRandomProxy() {
  if (proxies.length === 0) return null;
  return proxies[Math.floor(Math.random() * proxies.length)];
}

/**
 * Check if proxies are enabled and available.
 */
function isProxyEnabled() {
  return config.USE_PROXIES === true && proxies.length > 0;
}

/**
 * Get proxy count.
 */
function getProxyCount() {
  return proxies.length;
}

/**
 * Direct fetch with retry + IPv4 fallback.
 */
const ipv4Dispatcher = new UndiciAgent({ connect: { family: 4 } });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function directFetchWithFallback(url, options = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      if (attempt < 2) await sleep(250 * attempt);
    }
  }

  try {
    return await fetch(url, { ...options, dispatcher: ipv4Dispatcher });
  } catch (ipv4Err) {
    const first = lastError?.message || "unknown";
    throw new Error(`direct fetch failed (${first}); ipv4 fallback failed (${ipv4Err.message})`);
  }
}

/**
 * Proxied fetch — drop-in replacement for global fetch.
 * Uses a rotating proxy when proxies are enabled.
 * Falls back to direct fetch with retries when proxy fails.
 */
async function proxiedFetch(url, options = {}) {
  if (!isProxyEnabled()) {
    return directFetchWithFallback(url, options);
  }

  const proxy = getNextProxy();
  if (!proxy) {
    return directFetchWithFallback(url, options);
  }

  const agent = createAgent(proxy);
  proxyStats.total++;

  try {
    const response = await fetch(url, {
      ...options,
      agent,
      dispatcher: agent,
    });
    proxyStats.success++;
    return response;
  } catch (proxyErr) {
    proxyStats.failed++;
    console.warn(`[Proxy] Failed via ${proxy.host}:${proxy.port}: ${proxyErr.message}`);

    try {
      return await directFetchWithFallback(url, options);
    } catch (directErr) {
      throw new Error(`proxy fetch failed (${proxyErr.message}); direct fallback failed (${directErr.message})`);
    }
  }
}

/**
 * Reload proxies from file (can be called at runtime).
 */
function reloadProxies() {
  return loadProxies();
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
};
