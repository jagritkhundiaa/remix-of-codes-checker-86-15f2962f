// ============================================================
//  Global Worker Pool — single shared semaphore across the bot
//  HARD CAP: 30 concurrent workers, application-wide.
//
//  Every checker submits its tasks here. No matter how many
//  callers run at once, total in-flight workers never exceed 30.
// ============================================================

const { logger } = require("./logger");

const GLOBAL_MAX = 30;

let active = 0;
let workerSeq = 0;
const waiters = []; // { resolve }

function acquire() {
  if (active < GLOBAL_MAX) {
    active++;
    return Promise.resolve(++workerSeq);
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active++;
      resolve(++workerSeq);
    });
  });
}

function release() {
  active--;
  const next = waiters.shift();
  if (next) next();
}

function getActive() { return active; }
function getWaiting() { return waiters.length; }
function getMax() { return GLOBAL_MAX; }

/**
 * Run an array of items through the GLOBAL pool with per-task isolation.
 * - `runner(item, ctx)` where ctx = { workerId, attempt, signal }
 * - Per-task try/catch — one failure NEVER kills the run.
 * - Built-in retry: if runner returns { retry: true } it's requeued (up to maxRetries).
 * - Honors signal: waiting tasks are skipped, in-flight tasks see ctx.signal.
 *
 * Returns: results array (same length as items), preserving order.
 *
 * NOTE: `concurrency` is informational only — the GLOBAL cap of 30 always wins.
 */
async function runPool({
  items,
  concurrency = 30,
  maxRetries = 0,
  signal,
  runner,
  onResult,
  scope = "pool",
}) {
  const total = items.length;
  if (total === 0) return [];

  const log = logger.child(scope);
  const results = new Array(total);
  let completed = 0;

  // Each item gets one task; the GLOBAL pool decides when it actually runs.
  const tasks = items.map((item, index) => async () => {
    let attempt = 0;
    while (true) {
      if (signal?.aborted) {
        const r = { status: "skipped", detail: "aborted", __index: index };
        results[index] = r;
        completed++;
        try { onResult?.(r, completed, total); } catch {}
        return;
      }

      const workerId = await acquire();
      let res;
      try {
        res = await runner(item, { workerId, attempt, signal });
      } catch (err) {
        log.error(`worker ${workerId} crash`, { err: err?.message || String(err) });
        res = { status: "fail", detail: `crash: ${err?.message || err}`.slice(0, 120) };
      } finally {
        release();
      }

      // Retry handling
      if (res && res.retry === true && attempt < maxRetries && !signal?.aborted) {
        attempt++;
        // small backoff between retries
        await new Promise(r => setTimeout(r, 400 + Math.random() * 600));
        continue;
      }

      const final = res && res.result !== undefined ? res.result : res;
      if (final && typeof final === "object") final.__index = index;
      results[index] = final;
      completed++;
      try { onResult?.(final, completed, total); } catch (e) {
        log.warn("onResult callback threw", { err: e?.message });
      }
      return;
    }
  });

  // Fire all tasks — pool gates them. We do NOT cap here; the semaphore does.
  log.info(`run start`, { items: total, globalMax: GLOBAL_MAX });
  await Promise.all(tasks.map(fn => fn()));
  log.info(`run done`, { completed, total });
  return results;
}

module.exports = {
  runPool,
  acquire,
  release,
  getActive,
  getWaiting,
  getMax,
  GLOBAL_MAX,
};
