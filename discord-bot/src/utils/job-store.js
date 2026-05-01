// ============================================================
//  job-store — persists in-progress command jobs to disk so the
//  bot can resume from the last checkpoint after a crash/restart.
//
//  Storage: discord-bot/data/jobs.json   (atomic writes)
//  Schema per job:
//    {
//      id: "<userId>:<command>",         // 1 active job per user per command
//      userId, channelId, command,
//      input: string[],                  // remaining lines OR full input (see cursor)
//      cursor: number,                   // index of next line to process
//      total: number,                    // total lines in original input
//      results: { hits: [], fails: [], ... },
//      meta: { ... command-specific },
//      startedAt, updatedAt,
//    }
//
//  All writes are debounced (250ms) + atomic (write-tmp+rename).
// ============================================================

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE = path.join(DATA_DIR, "jobs.json");
const TMP = FILE + ".tmp";

let cache = null;
let pendingFlush = null;
const FLUSH_MS = 250;

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function loadSync() {
  if (cache) return cache;
  ensureDir();
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    cache = JSON.parse(raw);
    if (!cache || typeof cache !== "object") cache = { jobs: {} };
    if (!cache.jobs) cache.jobs = {};
  } catch {
    cache = { jobs: {} };
  }
  return cache;
}

function flushNow() {
  if (!cache) return;
  ensureDir();
  try {
    fs.writeFileSync(TMP, JSON.stringify(cache));
    fs.renameSync(TMP, FILE);
  } catch (e) {
    // disk full / permission — best-effort; never throw out of save
  }
}

function scheduleFlush() {
  if (pendingFlush) return;
  pendingFlush = setTimeout(() => {
    pendingFlush = null;
    flushNow();
  }, FLUSH_MS);
}

// Flush synchronously on exit so crash-during-save can't corrupt
process.on("exit", () => { if (cache) flushNow(); });
process.on("SIGINT", () => { if (cache) flushNow(); process.exit(0); });
process.on("SIGTERM", () => { if (cache) flushNow(); process.exit(0); });

function jobId(userId, command) { return `${userId}:${command}`; }

function startJob({ userId, channelId, command, input, meta = {} }) {
  const c = loadSync();
  const id = jobId(userId, command);
  c.jobs[id] = {
    id,
    userId,
    channelId,
    command,
    input: Array.isArray(input) ? input : [],
    cursor: 0,
    total: Array.isArray(input) ? input.length : 0,
    results: { hits: [], fails: [], free: [], invalid: [], custom: [] },
    meta,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  scheduleFlush();
  return c.jobs[id];
}

function getJob(userId, command) {
  const c = loadSync();
  return c.jobs[jobId(userId, command)] || null;
}

function listActiveJobs() {
  const c = loadSync();
  return Object.values(c.jobs);
}

function checkpoint(userId, command, patch) {
  const c = loadSync();
  const id = jobId(userId, command);
  const j = c.jobs[id];
  if (!j) return null;
  if (typeof patch.cursor === "number") j.cursor = patch.cursor;
  if (patch.results) {
    for (const k of Object.keys(patch.results)) {
      if (!j.results[k]) j.results[k] = [];
      if (Array.isArray(patch.results[k])) j.results[k] = patch.results[k];
    }
  }
  if (patch.meta) j.meta = { ...j.meta, ...patch.meta };
  j.updatedAt = Date.now();
  scheduleFlush();
  return j;
}

function pushResult(userId, command, bucket, value) {
  const c = loadSync();
  const j = c.jobs[jobId(userId, command)];
  if (!j) return;
  if (!j.results[bucket]) j.results[bucket] = [];
  j.results[bucket].push(value);
  j.updatedAt = Date.now();
  scheduleFlush();
}

function finishJob(userId, command) {
  const c = loadSync();
  const id = jobId(userId, command);
  if (c.jobs[id]) {
    delete c.jobs[id];
    scheduleFlush();
  }
}

function clearAll() {
  cache = { jobs: {} };
  flushNow();
}

module.exports = {
  startJob,
  getJob,
  listActiveJobs,
  checkpoint,
  pushResult,
  finishJob,
  clearAll,
};
