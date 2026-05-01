// ============================================================
//  progress-tracker — line-level crash resume.
//
//  Lives at the HANDLER layer (handle*() in index.js), NOT inside
//  individual checkers. We:
//    1. Capture full combo list once, hash it as the run fingerprint.
//    2. Persist done-indices + per-line results to data/progress/<runId>.json
//    3. On resume, filter combos to skip already-done indices and re-fire
//       the handler with the remaining list. Already-collected results are
//       merged back at the end.
//
//  Atomic: write-tmp + rename. Debounced flush every 300ms or 25 lines.
// ============================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "..", "data", "progress");

function ensureDir() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {} }

function fileFor(runId) { return path.join(DATA_DIR, `${runId}.json`); }

function fingerprint(userId, command, combos) {
  const h = crypto.createHash("sha1");
  h.update(userId + ":" + command + ":");
  for (const c of combos) h.update(c + "\n");
  return `${userId}_${command}_${h.digest("hex").slice(0, 12)}`;
}

function load(runId) {
  ensureDir();
  try {
    const raw = fs.readFileSync(fileFor(runId), "utf8");
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.combos)) return obj;
  } catch {}
  return null;
}

function saveAtomic(runId, state) {
  ensureDir();
  const f = fileFor(runId);
  const tmp = f + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, f);
  } catch {}
}

function clear(runId) {
  try { fs.unlinkSync(fileFor(runId)); } catch {}
}

/**
 * Create or load a tracker for this run.
 *  - If a prior state exists with the same fingerprint, returns it (resume).
 *  - Otherwise creates a fresh one.
 */
function open({ userId, command, combos }) {
  const runId = fingerprint(userId, command, combos);
  let state = load(runId);
  if (!state) {
    state = {
      runId,
      userId,
      command,
      total: combos.length,
      combos,                  // full original list (so we can hash on resume)
      done: [],                // indices completed
      results: { hits: [], free: [], fails: [], invalid: [], custom: [] },
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveAtomic(runId, state);
  }

  let pending = null;
  let dirtyCount = 0;

  function flush() {
    if (pending) { clearTimeout(pending); pending = null; }
    state.updatedAt = Date.now();
    saveAtomic(runId, state);
    dirtyCount = 0;
  }
  function scheduleFlush() {
    dirtyCount++;
    if (dirtyCount >= 25) return flush();
    if (pending) return;
    pending = setTimeout(flush, 300);
  }

  return {
    runId,
    state,
    /** Return only the combos that haven't been processed yet. */
    remaining() {
      const doneSet = new Set(state.done);
      const out = [];
      for (let i = 0; i < combos.length; i++) {
        if (!doneSet.has(i)) out.push({ index: i, value: combos[i] });
      }
      return out;
    },
    /** Mark a combo (by its ORIGINAL index) as done, optionally bucketing a result line. */
    markDone(originalIndex, bucket, line) {
      if (!state.done.includes(originalIndex)) state.done.push(originalIndex);
      if (bucket && line != null) {
        if (!state.results[bucket]) state.results[bucket] = [];
        state.results[bucket].push(line);
      }
      scheduleFlush();
    },
    /** Add a result without indexing (e.g. summary text). */
    addResult(bucket, line) {
      if (!state.results[bucket]) state.results[bucket] = [];
      state.results[bucket].push(line);
      scheduleFlush();
    },
    flush,
    finish() { flush(); clear(runId); },
    isResumed() {
      return state.done.length > 0;
    },
    progress() {
      return { done: state.done.length, total: state.total };
    },
  };
}

/** Look up a tracker on disk by user+command (used by the dispatcher to detect resumes). */
function findExistingForUserCommand(userId, command) {
  ensureDir();
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith(`${userId}_${command}_`) && f.endsWith(".json"));
    if (files.length === 0) return null;
    const raw = fs.readFileSync(path.join(DATA_DIR, files[0]), "utf8");
    return JSON.parse(raw);
  } catch { return null; }
}

module.exports = { open, load, clear, fingerprint, findExistingForUserCommand };
