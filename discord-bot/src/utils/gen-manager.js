// ============================================================
//  Gen Manager — separate hidden gen system. Stock per product
//  in JSON, cooldowns per user, admin overrides, usage logs.
// ============================================================

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data", "gen");
const STOCK_FILE = path.join(DATA_DIR, "stock.json");
const COOLDOWN_FILE = path.join(DATA_DIR, "cooldowns.json");
const LOG_FILE = path.join(DATA_DIR, "usage.log");

const USER_COOLDOWN_MS = 200 * 1000; // 200 seconds
const USER_MAX_PER_REQ = 1;
const ADMIN_MAX_PER_REQ = 50;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStock() {
  ensureDir();
  if (!fs.existsSync(STOCK_FILE)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(STOCK_FILE, "utf-8"));
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

function saveStock(stock) {
  ensureDir();
  fs.writeFileSync(STOCK_FILE, JSON.stringify(stock, null, 2));
}

function loadCooldowns() {
  ensureDir();
  if (!fs.existsSync(COOLDOWN_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(COOLDOWN_FILE, "utf-8")) || {};
  } catch {
    return {};
  }
}

function saveCooldowns(cd) {
  ensureDir();
  fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cd, null, 2));
}

function appendLog(line) {
  ensureDir();
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

class GenManager {
  constructor() {
    this.stock = loadStock(); // { product: ["line1", "line2", ...] }
    this.cooldowns = loadCooldowns(); // { userId: lastUseTimestamp }
  }

  // ── Stock management ──

  list() {
    return Object.entries(this.stock).map(([name, lines]) => ({ name, count: lines.length }));
  }

  count(product) {
    const key = product.toLowerCase();
    return (this.stock[key] || []).length;
  }

  /**
   * Add raw lines to a product's stock.
   * Returns the number of lines actually added (after dedup against existing).
   */
  addStock(product, lines) {
    const key = product.toLowerCase();
    if (!this.stock[key]) this.stock[key] = [];
    const existing = new Set(this.stock[key]);
    let added = 0;
    for (const raw of lines) {
      const line = String(raw || "").trim();
      if (!line) continue;
      if (existing.has(line)) continue;
      this.stock[key].push(line);
      existing.add(line);
      added++;
    }
    saveStock(this.stock);
    return added;
  }

  /**
   * Replace a product's stock entirely with the given lines.
   */
  replaceStock(product, lines) {
    const key = product.toLowerCase();
    const cleaned = lines
      .map((l) => String(l || "").trim())
      .filter(Boolean);
    this.stock[key] = [...new Set(cleaned)];
    saveStock(this.stock);
    return this.stock[key].length;
  }

  /**
   * Pull `amount` items from stock; remove them; return what was pulled.
   */
  pull(product, amount) {
    const key = product.toLowerCase();
    if (!this.stock[key] || this.stock[key].length === 0) return [];
    const taken = this.stock[key].splice(0, amount);
    saveStock(this.stock);
    return taken;
  }

  exists(product) {
    return !!this.stock[product.toLowerCase()];
  }

  /**
   * Returns the entire stock as a single text dump (for .downloadgenstock).
   */
  dump() {
    const parts = [];
    for (const [name, lines] of Object.entries(this.stock)) {
      parts.push(`### ${name} (${lines.length}) ###`);
      parts.push(lines.join("\n"));
      parts.push("");
    }
    return parts.join("\n");
  }

  // ── Cooldown / limits ──

  /**
   * Returns { ok: true } or { ok: false, reason, retryIn? }
   */
  canGen(userId, amount, isAdmin) {
    const max = isAdmin ? ADMIN_MAX_PER_REQ : USER_MAX_PER_REQ;
    if (amount < 1) return { ok: false, reason: "Amount must be at least 1." };
    if (amount > max) {
      return {
        ok: false,
        reason: isAdmin
          ? `Max ${ADMIN_MAX_PER_REQ} per request.`
          : `Users are capped at ${USER_MAX_PER_REQ} per request.`,
      };
    }
    if (isAdmin) return { ok: true };

    const last = this.cooldowns[String(userId)];
    if (last && Date.now() - last < USER_COOLDOWN_MS) {
      const retryIn = Math.ceil((USER_COOLDOWN_MS - (Date.now() - last)) / 1000);
      return { ok: false, reason: `Cooldown active. Try again in ${retryIn}s.`, retryIn };
    }
    return { ok: true };
  }

  recordUse(userId, isAdmin) {
    if (isAdmin) return;
    this.cooldowns[String(userId)] = Date.now();
    saveCooldowns(this.cooldowns);
  }

  log(userId, product, amount, success) {
    appendLog(`user=${userId} product=${product} amount=${amount} ok=${success}`);
  }

  /**
   * Generate items end-to-end with limits + cooldown.
   * Returns { ok: true, items } or { ok: false, reason }
   */
  generate(userId, product, amount, isAdmin) {
    if (!this.exists(product)) {
      return { ok: false, reason: `Unknown product \`${product}\`. Use \`.stock\` to see available.` };
    }
    const check = this.canGen(userId, amount, isAdmin);
    if (!check.ok) return check;

    const have = this.count(product);
    if (have === 0) {
      return { ok: false, reason: `Product \`${product}\` is out of stock.` };
    }
    const take = Math.min(amount, have);
    const items = this.pull(product, take);
    this.recordUse(userId, isAdmin);
    this.log(userId, product, items.length, true);
    return { ok: true, items, requested: amount, delivered: items.length };
  }
}

module.exports = { GenManager, USER_COOLDOWN_MS, USER_MAX_PER_REQ, ADMIN_MAX_PER_REQ };
