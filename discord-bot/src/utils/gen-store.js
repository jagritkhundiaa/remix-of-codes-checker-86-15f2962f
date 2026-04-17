// ============================================================
//  Gen Store — stock-based generator
//  - Products live in data/gen/<product>.txt (one item per line)
//  - Cooldown: 200s for users; admins bypass
//  - User cap per call: 1; admin cap per call: 50
// ============================================================

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "..", "data", "gen");

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

const COOLDOWN_MS = 200 * 1000;
const USER_MAX = 1;
const ADMIN_MAX = 50;
const cooldowns = new Map(); // userId+product -> ts

const SAFE = /^[A-Za-z0-9_\-]+$/;

function safeName(name) {
  return String(name || "").trim();
}

function productFile(name) {
  return path.join(DIR, `${name}.txt`);
}

function listProducts() {
  ensureDir();
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => {
      const name = f.replace(/\.txt$/, "");
      const lines = readLines(name);
      return { name, count: lines.length };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readLines(name) {
  const file = productFile(name);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8").split(/\r?\n/).filter(Boolean);
}

function writeLines(name, lines) {
  ensureDir();
  fs.writeFileSync(productFile(name), lines.join("\n"), "utf-8");
}

function exists(name) {
  return fs.existsSync(productFile(name));
}

function addStock(name, lines) {
  ensureDir();
  if (!SAFE.test(name)) throw new Error("Invalid product name (use letters/numbers/_/- only)");
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  const existing = readLines(name);
  writeLines(name, existing.concat(cleaned));
  return cleaned.length;
}

function replaceStock(name, lines) {
  if (!SAFE.test(name)) throw new Error("Invalid product name (use letters/numbers/_/- only)");
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  writeLines(name, cleaned);
  return cleaned.length;
}

function deleteProduct(name) {
  const f = productFile(name);
  if (fs.existsSync(f)) { fs.unlinkSync(f); return true; }
  return false;
}

function clearStock(name) {
  if (!exists(name)) return false;
  writeLines(name, []);
  return true;
}

function pull(name, amount) {
  const lines = readLines(name);
  if (lines.length === 0) return { items: [], remaining: 0 };
  const take = Math.min(amount, lines.length);
  const items = lines.slice(0, take);
  const rest = lines.slice(take);
  writeLines(name, rest);
  return { items, remaining: rest.length };
}

function getCooldown(userId, name) {
  const key = `${userId}::${name}`;
  const last = cooldowns.get(key) || 0;
  const remain = COOLDOWN_MS - (Date.now() - last);
  return remain > 0 ? Math.ceil(remain / 1000) : 0;
}

function setCooldown(userId, name) {
  cooldowns.set(`${userId}::${name}`, Date.now());
}

module.exports = {
  listProducts, exists, addStock, replaceStock, deleteProduct, clearStock,
  pull, readLines, getCooldown, setCooldown,
  COOLDOWN_MS, USER_MAX, ADMIN_MAX,
};
