// ============================================================
//  Controlled Async Queue — runs N workers with a retry queue
//  so failures never silently skip a job. Used by puller and
//  inbox AIO to guarantee no skipped hits.
// ============================================================

/**
 * Run `tasks` through up to `concurrency` parallel workers.
 * Each task is `(item, attempt) => Promise<{ retry: boolean, result: any }>`.
 *
 * - Items returning `{ retry: true }` are re-queued up to `maxRetries` times.
 * - After max retries, the last result is recorded.
 * - Honors AbortSignal.
 *
 * Returns array of results in completion order. The original index is on each
 * result as `__index` so callers can re-sort if they care.
 */
async function runQueue({ items, concurrency = 3, maxRetries = 2, signal, runner, onResult }) {
  const total = items.length;
  const queue = items.map((item, i) => ({ item, index: i, attempt: 0 }));
  const results = [];
  let active = 0;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));

  function next() {
    if (signal?.aborted) {
      if (active === 0) resolveDone();
      return;
    }
    while (active < concurrency && queue.length > 0) {
      const job = queue.shift();
      active++;
      Promise.resolve()
        .then(() => runner(job.item, job.attempt))
        .then((res) => {
          if (res && res.retry && job.attempt < maxRetries && !signal?.aborted) {
            queue.push({ item: job.item, index: job.index, attempt: job.attempt + 1 });
          } else {
            const finalRes = res && res.result !== undefined ? res.result : res;
            if (finalRes && typeof finalRes === "object") finalRes.__index = job.index;
            results.push(finalRes);
            if (onResult) {
              try { onResult(finalRes, results.length, total); } catch {}
            }
          }
        })
        .catch((err) => {
          const failure = { error: err?.message || String(err), __index: job.index };
          results.push(failure);
          if (onResult) {
            try { onResult(failure, results.length, total); } catch {}
          }
        })
        .finally(() => {
          active--;
          if (queue.length === 0 && active === 0) resolveDone();
          else next();
        });
    }
    if (queue.length === 0 && active === 0) resolveDone();
  }

  next();
  await done;
  return results;
}

module.exports = { runQueue };
