// Gen system — mirrors the Python xbox-checker-bot-py/gen_manager.py layout.
//   - Per-category stock files at data/gen/stock/<category>.txt
//   - Config + user state at data/gen/{config.json,users.json}
//   - Free vs Premium daily limits, daily reset.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "data", "gen");
const STOCK_DIR = path.join(ROOT, "stock");
const USERS_FILE = path.join(ROOT, "users.json");
const CONFIG_FILE = path.join(ROOT, "config.json");

const DEFAULT_CONFIG = {
  free_limit: 20,
  premium_limit: 50,
  categories: [],
  premium_users: {},
};

function ensure() {
  if (!fs.existsSync(STOCK_DIR)) fs.mkdirSync(STOCK_DIR, { recursive: true });
}

function safeKey(name) {
  return String(name || "").toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_");
}

function load(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch { return fallback; }
}

function save(file, data) {
  ensure();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let config = { ...DEFAULT_CONFIG, ...load(CONFIG_FILE, {}) };
config.categories = config.categories || [];
config.premium_users = config.premium_users || {};
let users = load(USERS_FILE, {});

function persistConfig() { save(CONFIG_FILE, config); }
function persistUsers() { save(USERS_FILE, users); }

ensure();

// ── Categories ───────────────────────────────────────────────

function getCategories() { return [...config.categories]; }

function categoryExists(name) {
  return config.categories.includes(safeKey(name));
}

function addCategory(name) {
  const key = safeKey(name);
  if (!key || config.categories.includes(key)) return false;
  config.categories.push(key);
  persistConfig();
  const file = path.join(STOCK_DIR, `${key}.txt`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
  return true;
}

function removeCategory(name) {
  const key = safeKey(name);
  const i = config.categories.indexOf(key);
  if (i === -1) return false;
  config.categories.splice(i, 1);
  persistConfig();
  return true;
}

// ── Stock ────────────────────────────────────────────────────

function _stockFile(name) {
  return path.join(STOCK_DIR, `${safeKey(name)}.txt`);
}

function _readStock(name) {
  const file = _stockFile(name);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function _writeStock(name, lines) {
  fs.writeFileSync(_stockFile(name), lines.join("\n") + (lines.length ? "\n" : ""));
}

function stockCount(name) { return _readStock(name).length; }

function allStockCounts() {
  const out = {};
  for (const c of config.categories) out[c] = stockCount(c);
  return out;
}

function addStock(name, lines) {
  if (!categoryExists(name)) return 0;
  const clean = (lines || []).map((l) => String(l).trim()).filter(Boolean);
  if (clean.length === 0) return 0;
  const existing = _readStock(name);
  _writeStock(name, existing.concat(clean));
  return clean.length;
}

function clearStock(name) {
  if (!categoryExists(name)) return false;
  _writeStock(name, []);
  return true;
}

function pullOne(name) {
  const lines = _readStock(name);
  if (lines.length === 0) return null;
  const item = lines.shift();
  _writeStock(name, lines);
  return item;
}

// ── Premium ──────────────────────────────────────────────────

function isPremium(uid) { return !!config.premium_users[String(uid)]; }
function addPremium(uid) { config.premium_users[String(uid)] = Date.now(); persistConfig(); }
function removePremium(uid) {
  if (config.premium_users[String(uid)]) {
    delete config.premium_users[String(uid)];
    persistConfig();
  }
}
function premiumList() { return Object.keys(config.premium_users); }

// ── Limits ───────────────────────────────────────────────────

function setFreeLimit(n) { config.free_limit = Math.max(0, n | 0); persistConfig(); }
function setPremiumLimit(n) { config.premium_limit = Math.max(0, n | 0); persistConfig(); }

function dailyLimit(uid) {
  return isPremium(uid) ? config.premium_limit : config.free_limit;
}

// ── User quota / generate ────────────────────────────────────

function _today() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function _user(uid) {
  const k = String(uid);
  const today = _today();
  if (!users[k] || users[k].day !== today) {
    users[k] = { day: today, used: 0, total: (users[k] && users[k].total) || 0 };
  }
  return users[k];
}

function remaining(uid) {
  const u = _user(uid);
  return Math.max(0, dailyLimit(uid) - u.used);
}

function record(uid) {
  const u = _user(uid);
  u.used += 1;
  u.total += 1;
  persistUsers();
}

function stats(uid) {
  const u = _user(uid);
  return { used: u.used, total: u.total || 0, limit: dailyLimit(uid), remaining: remaining(uid) };
}

function generate(uid, category) {
  if (!categoryExists(category)) return { error: "no_category" };
  if (remaining(uid) <= 0) {
    const u = _user(uid);
    return { error: "limit", limit: dailyLimit(uid), used: u.used };
  }
  const item = pullOne(category);
  if (!item) return { error: "empty" };
  record(uid);
  return { ok: true, item, left: remaining(uid) };
}

module.exports = {
  // categories
  getCategories, categoryExists, addCategory, removeCategory,
  // stock
  stockCount, allStockCounts, addStock, clearStock, pullOne,
  // premium
  isPremium, addPremium, removePremium, premiumList,
  // limits
  setFreeLimit, setPremiumLimit, dailyLimit,
  get freeLimit() { return config.free_limit; },
  get premiumLimit() { return config.premium_limit; },
  // user
  remaining, record, stats, generate,
};

