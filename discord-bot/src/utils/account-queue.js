// ============================================================
//  account-queue — backwards-compatible wrapper that now defers
//  to the GLOBAL worker pool (max 30 concurrent across the bot).
//
//  Public API is unchanged:
//    runQueue({ items, concurrency, maxRetries, signal, runner, onResult })
//
//  The `concurrency` arg is now an upper hint — the global pool's
//  hard cap of 30 always wins. Per-task retry semantics preserved.
// ============================================================

const { runPool } = require("./worker-pool");

async function runQueue({ items, concurrency = 3, maxRetries = 2, signal, runner, onResult }) {
  return runPool({
    items,
    concurrency,
    maxRetries,
    signal,
    scope: "queue",
    runner,
    onResult,
  });
}

module.exports = { runQueue };
