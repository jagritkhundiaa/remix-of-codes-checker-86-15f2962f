// ============================================================
//  Bruv1 per-user line-limit store
//  - Default limit: 400 lines per run
//  - Owner: no limit (handled in caller)
//  - Persisted to data/bruv1-limits.json
// ============================================================

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "data", "bruv1-limits.json");
const DEFAULT_LIMIT = 400;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE, "utf-8")); } catch { return {}; }
}

function save(data) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

let cache = load();

function getLimit(userId) {
  const v = cache[userId];
  return typeof v === "number" && v > 0 ? v : DEFAULT_LIMIT;
}

function setLimit(userId, n) {
  cache[userId] = n;
  save(cache);
}

function resetLimit(userId) {
  delete cache[userId];
  save(cache);
}

module.exports = { getLimit, setLimit, resetLimit, DEFAULT_LIMIT };
