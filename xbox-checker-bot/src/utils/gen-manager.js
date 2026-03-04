// ============================================================
//  Gen Manager — stock, categories, tiers, user tracking
// ============================================================

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data", "gen");
const STOCK_DIR = path.join(DATA_DIR, "stock");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STOCK_DIR)) fs.mkdirSync(STOCK_DIR, { recursive: true });
}

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function saveJSON(file, data) {
  ensureDirs();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

class GenManager {
  constructor() {
    ensureDirs();
    this.users = loadJSON(USERS_FILE, {});
    this.config = loadJSON(CONFIG_FILE, {
      free_limit: 20,
      premium_limit: 50,
      categories: [],
      premium_users: {},
    });
    // migrate old configs
    if (!this.config.categories) this.config.categories = [];
    if (!this.config.premium_users) this.config.premium_users = {};
    if (!this.config.free_limit) this.config.free_limit = 20;
    if (!this.config.premium_limit) this.config.premium_limit = 50;
  }

  save() {
    saveJSON(USERS_FILE, this.users);
    saveJSON(CONFIG_FILE, this.config);
  }

  // ── Categories ───────────────────────────────────────────

  getCategories() {
    return [...this.config.categories];
  }

  addCategory(name) {
    const key = name.toLowerCase().trim();
    if (this.config.categories.includes(key)) return false;
    this.config.categories.push(key);
    // create empty stock file
    const stockFile = path.join(STOCK_DIR, `${key}.txt`);
    if (!fs.existsSync(stockFile)) fs.writeFileSync(stockFile, "");
    this.save();
    return true;
  }

  removeCategory(name) {
    const key = name.toLowerCase().trim();
    const idx = this.config.categories.indexOf(key);
    if (idx === -1) return false;
    this.config.categories.splice(idx, 1);
    const stockFile = path.join(STOCK_DIR, `${key}.txt`);
    if (fs.existsSync(stockFile)) fs.unlinkSync(stockFile);
    this.save();
    return true;
  }

  categoryExists(name) {
    return this.config.categories.includes(name.toLowerCase().trim());
  }

  // ── Stock ────────────────────────────────────────────────

  getStock(category) {
    const key = category.toLowerCase().trim();
    const file = path.join(STOCK_DIR, `${key}.txt`);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf-8").split(/\r?\n/).filter((l) => l.trim());
  }

  getStockCount(category) {
    return this.getStock(category).length;
  }

  getAllStockCounts() {
    const counts = {};
    for (const cat of this.config.categories) {
      counts[cat] = this.getStockCount(cat);
    }
    return counts;
  }

  addStock(category, lines) {
    const key = category.toLowerCase().trim();
    if (!this.categoryExists(key)) return 0;
    const file = path.join(STOCK_DIR, `${key}.txt`);
    const existing = this.getStock(key);
    const newLines = lines.filter((l) => l.trim());
    const combined = [...existing, ...newLines];
    fs.writeFileSync(file, combined.join("\n"));
    return newLines.length;
  }

  pullOne(category) {
    const key = category.toLowerCase().trim();
    const file = path.join(STOCK_DIR, `${key}.txt`);
    const lines = this.getStock(key);
    if (lines.length === 0) return null;
    const item = lines.shift();
    fs.writeFileSync(file, lines.join("\n"));
    return item;
  }

  clearStock(category) {
    const key = category.toLowerCase().trim();
    const file = path.join(STOCK_DIR, `${key}.txt`);
    if (fs.existsSync(file)) fs.writeFileSync(file, "");
  }

  // ── Premium ──────────────────────────────────────────────

  isPremium(userId) {
    return !!this.config.premium_users[String(userId)];
  }

  addPremium(userId) {
    this.config.premium_users[String(userId)] = { addedAt: Date.now() };
    this.save();
  }

  removePremium(userId) {
    delete this.config.premium_users[String(userId)];
    this.save();
  }

  getPremiumUsers() {
    return Object.keys(this.config.premium_users);
  }

  // ── Limits ───────────────────────────────────────────────

  getFreeLimit() {
    return this.config.free_limit;
  }

  getPremiumLimit() {
    return this.config.premium_limit;
  }

  setFreeLimit(n) {
    this.config.free_limit = n;
    this.save();
  }

  setPremiumLimit(n) {
    this.config.premium_limit = n;
    this.save();
  }

  getDailyLimit(userId) {
    return this.isPremium(userId) ? this.config.premium_limit : this.config.free_limit;
  }

  // ── User tracking ────────────────────────────────────────

  _ensureUser(userId) {
    const uid = String(userId);
    if (!this.users[uid]) {
      this.users[uid] = {
        total_generated: 0,
        daily_generated: 0,
        daily_reset: this._todayKey(),
        history: {},
      };
    }
    // reset daily if new day
    if (this.users[uid].daily_reset !== this._todayKey()) {
      this.users[uid].daily_generated = 0;
      this.users[uid].daily_reset = this._todayKey();
    }
    return this.users[uid];
  }

  _todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  canGenerate(userId) {
    const user = this._ensureUser(userId);
    const limit = this.getDailyLimit(userId);
    return user.daily_generated < limit;
  }

  getRemainingGens(userId) {
    const user = this._ensureUser(userId);
    const limit = this.getDailyLimit(userId);
    return Math.max(0, limit - user.daily_generated);
  }

  recordGen(userId, category) {
    const user = this._ensureUser(userId);
    user.total_generated++;
    user.daily_generated++;
    if (!user.history[category]) user.history[category] = 0;
    user.history[category]++;
    this.save();
  }

  getUserStats(userId) {
    const user = this._ensureUser(userId);
    return {
      total: user.total_generated,
      today: user.daily_generated,
      remaining: this.getRemainingGens(userId),
      limit: this.getDailyLimit(userId),
      premium: this.isPremium(userId),
      history: { ...user.history },
    };
  }

  generate(userId, category) {
    if (!this.categoryExists(category)) return { error: "category_not_found" };
    if (!this.canGenerate(userId)) return { error: "limit_reached" };
    const item = this.pullOne(category);
    if (!item) return { error: "out_of_stock" };
    this.recordGen(userId, category);
    return { success: true, item, remaining: this.getRemainingGens(userId) };
  }
}

module.exports = { GenManager };
