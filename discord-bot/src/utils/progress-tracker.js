// ============================================================
//  progress-tracker — line-level crash resume via chunked execution.
//
//  Strategy (preserves 1:1 checker logic — checkers are NOT modified):
//    1. Split combos into chunks of CHUNK_SIZE.
//    2. Run the checker on one chunk at a time.
//    3. After each chunk completes, persist its results + done-index range.
//    4. On crash, the next start-up filters out already-done chunks and
//       only re-processes from the first incomplete chunk onwards.
//
//  Worst-case re-work on crash: <= CHUNK_SIZE lines.
//
//  Storage:  data/progress/<userId>_<command>_<hash>.json  (atomic writes).
// ============================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "..", "data", "progress");
const CHUNK_SIZE = 50;

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
    return JSON.parse(raw);
  } catch { return null; }
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
 * Run a checker on `combos` chunk-by-chunk, persisting results between chunks.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.command
 * @param {string[]} opts.combos                   - full input list
 * @param {(chunk: string[], onChunkProgress: (doneInChunk:number, totalInChunk:number) => void, signal: AbortSignal) => Promise<any[]>} opts.runChunk
 *        - called once per chunk; must return one result per combo in the chunk, in order
 * @param {(done:number, total:number) => void} [opts.onProgress] - aggregate progress callback
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ results: any[], runId: string, resumed: boolean, prevDone: number }>}
 */
async function runChunked({ userId, command, combos, runChunk, onProgress, signal }) {
  const runId = fingerprint(userId, command, combos);
  let state = load(runId);
  const resumed = !!(state && Array.isArray(state.results) && state.results.length > 0 && state.total === combos.length);

  if (!resumed) {
    state = { runId, userId, command, total: combos.length, results: [], chunkSize: CHUNK_SIZE, startedAt: Date.now(), updatedAt: Date.now() };
    saveAtomic(runId, state);
  }

  const prevDone = state.results.length;
  const results = state.results.slice(); // copy of already-collected

  // Process remaining combos chunk-by-chunk
  for (let start = prevDone; start < combos.length; start += CHUNK_SIZE) {
    if (signal?.aborted) break;
    const end = Math.min(start + CHUNK_SIZE, combos.length);
    const chunk = combos.slice(start, end);

    const chunkResults = await runChunk(chunk, (doneInChunk) => {
      try { onProgress?.(start + doneInChunk, combos.length); } catch {}
    }, signal);

    // Merge — even if the chunk was aborted partway, push whatever the checker produced.
    for (const r of (chunkResults || [])) results.push(r);

    state.results = results;
    state.updatedAt = Date.now();
    saveAtomic(runId, state);

    try { onProgress?.(results.length, combos.length); } catch {}
    if (signal?.aborted) break;
  }

  return { results, runId, resumed, prevDone };
}

module.exports = { runChunked, fingerprint, load, clear, CHUNK_SIZE };
