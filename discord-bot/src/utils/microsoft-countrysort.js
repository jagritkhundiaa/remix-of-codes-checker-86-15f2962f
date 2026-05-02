// ============================================================
//  Country Sort — extracts and ranks account countries.
//
//  Login flow: identical to the puller / inbox AIO (Outlook Lite
//  flow) — we delegate to checkInboxAccounts() so the validation
//  pipeline stays in lock-step with everything else. We just
//  aggregate the `country` field from each result.
// ============================================================

const { checkInboxAccounts } = require("./microsoft-inbox");

function normalizeCountry(c) {
  if (!c) return "";
  const s = String(c).trim();
  if (!s) return "";
  // 2-letter codes preferred; otherwise keep as-is (uppercased, trimmed to 24)
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return s.length > 24 ? s.slice(0, 24) : s;
}

/**
 * Run a country-sort check.
 *
 * @param {string[]} accounts            email:password lines
 * @param {number}   threads             worker hint (1-10)
 * @param {function} onProgress          (done, total, status, hits, fails, lastResult, liveCountries)
 * @param {AbortSignal} signal
 * @returns {Promise<{ results, countryBreakdown }>}
 */
async function runCountrySort(accounts, threads = 3, onProgress, signal) {
  const liveCountries = {};

  const results = await checkInboxAccounts(
    accounts,
    threads,
    (done, total, status, hits, fails, lastResult) => {
      if (lastResult && lastResult.status === "hit") {
        const c = normalizeCountry(lastResult.country);
        if (c) liveCountries[c] = (liveCountries[c] || 0) + 1;
      }
      try { onProgress?.(done, total, status, hits, fails, lastResult, liveCountries); } catch {}
    },
    signal
  );

  const countryBreakdown = {};
  for (const r of results) {
    if (r?.status !== "hit") continue;
    const c = normalizeCountry(r.country);
    if (!c) continue;
    countryBreakdown[c] = (countryBreakdown[c] || 0) + 1;
  }

  return { results, countryBreakdown };
}

module.exports = { runCountrySort, normalizeCountry };
