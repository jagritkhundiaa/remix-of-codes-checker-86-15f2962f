// ============================================================
//  Structured Logger — console + Discord webhook
//  Worker-tagged, non-blocking, batched webhook delivery.
// ============================================================

const config = require("../config");

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS.info;

// Webhook delivery queue (non-blocking, dropped on failure — never blocks workers)
const webhookQueue = [];
let webhookFlushing = false;
const WEBHOOK_BATCH_MS = 1500;
const WEBHOOK_MAX_BATCH = 8;

function ts() {
  const d = new Date();
  return d.toISOString().split("T")[1].slice(0, 12);
}

function fmt(level, scope, msg, extra) {
  const tag = scope ? `[${scope}]` : "";
  let line = `${ts()} ${level.toUpperCase().padEnd(5)} ${tag} ${msg}`;
  if (extra && Object.keys(extra).length) {
    const safe = Object.entries(extra)
      .map(([k, v]) => {
        if (v && typeof v === "object") {
          try { return `${k}=${JSON.stringify(v).slice(0, 200)}`; } catch { return `${k}=[obj]`; }
        }
        return `${k}=${v}`;
      })
      .join(" ");
    line += ` | ${safe}`;
  }
  return line;
}

function consoleOut(level, line) {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

async function flushWebhook() {
  if (webhookFlushing) return;
  if (!config.DISCORD_WEBHOOK) { webhookQueue.length = 0; return; }
  webhookFlushing = true;
  try {
    while (webhookQueue.length) {
      const batch = webhookQueue.splice(0, WEBHOOK_MAX_BATCH);
      const content = batch.map(b => "`" + b + "`").join("\n").slice(0, 1900);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      try {
        await fetch(config.DISCORD_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
          signal: ctrl.signal,
        });
      } catch { /* drop on failure — never block */ }
      finally { clearTimeout(t); }
      await new Promise(r => setTimeout(r, 200));
    }
  } finally {
    webhookFlushing = false;
  }
}

function queueWebhook(line) {
  if (!config.DISCORD_WEBHOOK) return;
  webhookQueue.push(line.slice(0, 250));
  if (webhookQueue.length === 1) {
    setTimeout(flushWebhook, WEBHOOK_BATCH_MS);
  } else if (webhookQueue.length > 50) {
    flushWebhook();
  }
}

function log(level, scope, msg, extra, opts = {}) {
  if ((LEVELS[level] || 0) < MIN_LEVEL) return;
  const line = fmt(level, scope, msg, extra);
  consoleOut(level, line);
  // Only forward warn/error or explicitly important events
  if (opts.webhook || level === "error" || level === "warn") {
    queueWebhook(line);
  }
}

const logger = {
  debug: (scope, msg, extra) => log("debug", scope, msg, extra),
  info:  (scope, msg, extra) => log("info",  scope, msg, extra),
  warn:  (scope, msg, extra) => log("warn",  scope, msg, extra),
  error: (scope, msg, extra) => log("error", scope, msg, extra),
  // Force-send to webhook (e.g. lifecycle events)
  event: (scope, msg, extra) => log("info", scope, msg, extra, { webhook: true }),
  child: (scope) => ({
    debug: (m, e) => log("debug", scope, m, e),
    info:  (m, e) => log("info",  scope, m, e),
    warn:  (m, e) => log("warn",  scope, m, e),
    error: (m, e) => log("error", scope, m, e),
    event: (m, e) => log("info",  scope, m, e, { webhook: true }),
  }),
};

module.exports = { logger };
