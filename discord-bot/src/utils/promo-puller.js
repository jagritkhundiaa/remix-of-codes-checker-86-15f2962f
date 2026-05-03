// ============================================================
//  Promo Puller — pulls Discord promo links from Game Pass and
//  validates each via discord.com/api/v9/entitlements/gift-codes
//  (1:1 port of the upstream Python `check_promo`).
//
//  Pipeline:
//    1) Auth + /offers via microsoft-puller.fetchFromAccount
//    2) Filter links containing "discord"
//    3) Per-link gift-code check against Discord API using
//       config.DISCORD_TOKEN. If token missing, skip validation
//       (still returns links).
// ============================================================

const fs = require("fs");
const path = require("path");
const { logger } = require("./logger");
const { fetchFromAccount } = require("./microsoft-puller");
const { runQueue } = require("./account-queue");
const config = require("../config");

const log = logger.child("promopuller");

const MAX_THREADS = 30;
const PROMOS_FILE = path.join(__dirname, "..", "..", "promos.txt");

// Mutex for promos.txt
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

function filterPromoLinks(links) {
  if (!Array.isArray(links)) return [];
  return links.filter((l) => typeof l === "string" && l.toLowerCase().includes("discord"));
}

function discordTokenConfigured() {
  const t = config && config.DISCORD_TOKEN;
  return typeof t === "string" && t && t !== "YOUR_DISCORD_TOKEN_HERE";
}

// ── Discord gift-code validator (1:1 port of Python check_promo) ──
// Returns: { ok, status, info? }
//   status ∈ "VALID" | "MAX_USES" | "REDEEMED" | "INVALID" | "ERROR" | "NO_TOKEN"
async function checkPromo(promoLink, signal) {
  if (!discordTokenConfigured()) {
    return { ok: false, status: "NO_TOKEN", message: "No Token Provided" };
  }
  try {
    const code = String(promoLink).split("/").pop();
    const url = `https://discord.com/api/v9/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`;
    const ctrl = new AbortController();
    const userSignal = signal;
    if (userSignal) {
      if (userSignal.aborted) ctrl.abort();
      else userSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
    const t = setTimeout(() => { try { ctrl.abort(); } catch {} }, 15000);
    let r;
    try {
      r = await fetch(url, {
        method: "GET",
        headers: { Authorization: config.DISCORD_TOKEN },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    if (r.status === 200) {
      const data = await r.json().catch(() => ({}));
      if (typeof data.uses === "number" && typeof data.max_uses === "number" && data.uses >= data.max_uses) {
        return { ok: false, status: "MAX_USES", message: "Max Uses Reached" };
      }
      if (data.redeemed) {
        return { ok: false, status: "REDEEMED", message: "Already Redeemed" };
      }
      return {
        ok: true,
        status: "VALID",
        message: "Valid",
        info: {
          uses: data.uses,
          max_uses: data.max_uses,
          expires_at: data.expires_at,
        },
      };
    }
    if (r.status === 404) return { ok: false, status: "INVALID", message: "Invalid Code (404)" };
    return { ok: false, status: "ERROR", message: `Check Failed (${r.status})` };
  } catch (e) {
    return { ok: false, status: "ERROR", message: `Error: ${e.message || e}` };
  }
}

async function pullPromos(accounts, onProgress, signal) {
  try { fs.writeFileSync(PROMOS_FILE, ""); } catch {}

  const parsed = accounts.map((a) => {
    if (a && typeof a === "object" && !Array.isArray(a)) {
      return { email: a.email || "", password: a.password || "" };
    }
    if (Array.isArray(a)) return { email: a[0] || "", password: a[1] || "" };
    const s = String(a || "");
    const i = s.indexOf(":");
    return i === -1 ? { email: s, password: "" } : { email: s.slice(0, i), password: s.slice(i + 1) };
  });

  const total = parsed.length;
  const fetchResults = [];
  const allLinks = [];
  const counters = { checked: 0, promosFound: 0, validPromos: 0 };

  if (!discordTokenConfigured()) {
    log.warn("DISCORD_TOKEN not set — promo links will be pulled but NOT validated.");
  }
  log.info(`starting promo puller: ${total} accounts (puller pipeline + gift-code check)`);

  await runQueue({
    items: parsed,
    concurrency: MAX_THREADS,
    maxRetries: 2,
    signal,
    runner: async ({ email, password }, attempt) => {
      const result = await fetchFromAccount(email, password);

      const transient =
        result.error === "OAuth failed" ||
        result.error === "Xbox tokens failed";
      if (transient && attempt < 2) return { retry: true };

      const promoLinks = filterPromoLinks(result.links || []);

      // Validate each pulled link via Discord gift-codes API
      const validatedLinks = [];
      for (const link of promoLinks) {
        if (signal && signal.aborted) break;
        const v = await checkPromo(link, signal);
        validatedLinks.push({ link, ...v });
      }

      counters.checked += 1;
      if (promoLinks.length > 0) {
        counters.promosFound += promoLinks.length;
        counters.validPromos += validatedLinks.filter((v) => v.ok).length;
        await withSaveLock(async () => {
          try {
            for (const v of validatedLinks) {
              const tag = v.ok ? "VALID" : v.status;
              fs.appendFileSync(PROMOS_FILE, `${email}:${password} | ${v.link} | ${tag}\n`);
            }
          } catch (e) {
            log.warn(`promos.txt write failed: ${e.message}`);
          }
        });
      }

      fetchResults.push({
        email,
        password,
        links: promoLinks,            // raw links (UI compatibility)
        validatedLinks,               // [{ link, ok, status, message, info? }]
        error: result.error || null,
      });

      for (const v of validatedLinks) {
        allLinks.push({ link: v.link, sourceEmail: email, status: v.status, ok: v.ok });
      }

      if (typeof onProgress === "function") {
        try {
          onProgress("fetch", {
            done: counters.checked,
            total,
            email,
            links: promoLinks.length,
            validLinks: validatedLinks.filter((v) => v.ok).length,
            error: result.error || null,
          });
        } catch {}
      }

      return { result };
    },
  });

  log.info(`done. checked=${counters.checked}/${total} promos=${counters.promosFound} valid=${counters.validPromos}`);
  return { fetchResults, allLinks };
}

module.exports = { pullPromos, checkPromo };
