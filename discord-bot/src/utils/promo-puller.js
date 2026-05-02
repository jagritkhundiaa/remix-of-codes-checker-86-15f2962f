// ============================================================
//  Promo Puller — pulls Discord promo links from Game Pass.
//  Now delegates the entire auth + offers pipeline to the main
//  puller (microsoft-puller.fetchFromAccount), which already
//  separates `codes` and `links` from the same /v2|/v3/offers
//  response. We just keep the links that contain "discord".
//  Public API + progress shape are unchanged so the UI stays
//  100% identical.
// ============================================================

const fs = require("fs");
const path = require("path");
const { logger } = require("./logger");
const { fetchFromAccount } = require("./microsoft-puller");
const { runQueue } = require("./account-queue");

const log = logger.child("promopuller");

const MAX_THREADS = 30;
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

// Keep only promo links — same semantic as the previous module
// (upstream Python promo flow filtered offers whose resource contained "discord").
function filterPromoLinks(links) {
  if (!Array.isArray(links)) return [];
  return links.filter((l) => typeof l === "string" && l.toLowerCase().includes("discord"));
}

async function pullPromos(accounts, onProgress, signal) {
  try { fs.writeFileSync(PROMOS_FILE, ""); } catch {}

  // Normalise input: accept [{email,password}] or ["email:pass"] or [["email","pass"]]
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
  const counters = { checked: 0, promosFound: 0 };

  log.info(`starting promo puller: ${total} accounts (using puller pipeline)`);

  await runQueue({
    items: parsed,
    concurrency: MAX_THREADS,
    maxRetries: 2,
    signal,
    runner: async ({ email, password }, attempt) => {
      // Same auth + offers pipeline as .puller
      const result = await fetchFromAccount(email, password);

      // Retry transient pipeline failures (mirrors .puller behaviour)
      const transient =
        result.error === "OAuth failed" ||
        result.error === "Xbox tokens failed";
      if (transient && attempt < 2) return { retry: true };

      // Keep only promo (discord) links — promo-specific filter
      const promoLinks = filterPromoLinks(result.links || []);

      counters.checked += 1;
      if (promoLinks.length > 0) {
        await withSaveLock(async () => {
          counters.promosFound += promoLinks.length;
          try {
            for (const promo of promoLinks) {
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
        links: promoLinks,
        error: result.error || null,
      });

      for (const link of promoLinks) {
        allLinks.push({ link, sourceEmail: email });
      }

      if (typeof onProgress === "function") {
        try {
          onProgress("fetch", {
            done: counters.checked,
            total,
            email,
            links: promoLinks.length,
            error: result.error || null,
          });
        } catch {}
      }

      return { result };
    },
  });

  log.info(`done. checked=${counters.checked}/${total} promos=${counters.promosFound}`);
  return { fetchResults, allLinks };
}

module.exports = { pullPromos };
