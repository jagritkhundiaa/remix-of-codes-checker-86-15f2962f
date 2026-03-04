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
    if (!this.config.categories) this.config.categories = [];
    if (!this.config.premium_users) this.config.premium_users = {};
    if (!this.config.free_limit) this.config.free_limit = 20;
    if (!this.config.premium_limit) this.config.premium_limit = 50;
  }

  save() {
    saveJSON(USERS_FILE, this.users);
    saveJSON(CONFIG_FILE, this.config);
  }

  getCategories() { return [...this.config.categories]; }

  addCategory(name) {
    const key = name.toLowerCase().trim();
    if (this.config.categories.includes(key)) return false;
    this.config.categories.push(key);
    const f = path.join(STOCK_DIR, `${key}.txt`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, "");
    this.save();
    return true;
  }

  removeCategory(name) {
    const key = name.toLowerCase().trim();
    const idx = this.config.categories.indexOf(key);
    if (idx === -1) return false;
    this.config.categories.splice(idx, 1);
    const f = path.join(STOCK_DIR, `${key}.txt`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    this.save();
    return true;
  }

  categoryExists(name) {
    return this.config.categories.includes(name.toLowerCase().trim());
  }

  getStock(category) {
    const f = path.join(STOCK_DIR, `${category.toLowerCase().trim()}.txt`);
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, "utf-8").split(/\r?\n/).filter((l) => l.trim());
  }

  getStockCount(cat) { return this.getStock(cat).length; }

  getAllStockCounts() {
    const out = {};
    for (const c of this.config.categories) out[c] = this.getStockCount(c);
    return out;
  }

  addStock(category, lines) {
    const key = category.toLowerCase().trim();
    if (!this.categoryExists(key)) return 0;
    const f = path.join(STOCK_DIR, `${key}.txt`);
    const existing = this.getStock(key);
    const clean = lines.filter((l) => l.trim());
    fs.writeFileSync(f, [...existing, ...clean].join("\n"));
    return clean.length;
  }

  pullOne(category) {
    const key = category.toLowerCase().trim();
    const f = path.join(STOCK_DIR, `${key}.txt`);
    const lines = this.getStock(key);
    if (!lines.length) return null;
    const item = lines.shift();
    fs.writeFileSync(f, lines.join("\n"));
    return item;
  }

  clearStock(category) {
    const f = path.join(STOCK_DIR, `${category.toLowerCase().trim()}.txt`);
    if (fs.existsSync(f)) fs.writeFileSync(f, "");
  }

  isPremium(uid) { return !!this.config.premium_users[String(uid)]; }

  addPremium(uid) {
    this.config.premium_users[String(uid)] = { addedAt: Date.now() };
    this.save();
  }

  removePremium(uid) {
    delete this.config.premium_users[String(uid)];
    this.save();
  }

  getPremiumUsers() { return Object.keys(this.config.premium_users); }

  getFreeLimit() { return this.config.free_limit; }
  getPremiumLimit() { return this.config.premium_limit; }

  setFreeLimit(n) { this.config.free_limit = n; this.save(); }
  setPremiumLimit(n) { this.config.premium_limit = n; this.save(); }

  getDailyLimit(uid) {
    return this.isPremium(uid) ? this.config.premium_limit : this.config.free_limit;
  }

  _ensureUser(uid) {
    const id = String(uid);
    if (!this.users[id]) {
      this.users[id] = { total_generated: 0, daily_generated: 0, daily_reset: this._today(), history: {} };
    }
    if (this.users[id].daily_reset !== this._today()) {
      this.users[id].daily_generated = 0;
      this.users[id].daily_reset = this._today();
    }
    return this.users[id];
  }

  _today() { return new Date().toISOString().slice(0, 10); }

  canGenerate(uid) {
    const u = this._ensureUser(uid);
    return u.daily_generated < this.getDailyLimit(uid);
  }

  getRemainingGens(uid) {
    const u = this._ensureUser(uid);
    return Math.max(0, this.getDailyLimit(uid) - u.daily_generated);
  }

  recordGen(uid, category) {
    const u = this._ensureUser(uid);
    u.total_generated++;
    u.daily_generated++;
    if (!u.history[category]) u.history[category] = 0;
    u.history[category]++;
    this.save();
  }

  getUserStats(uid) {
    const u = this._ensureUser(uid);
    return {
      total: u.total_generated,
      today: u.daily_generated,
      remaining: this.getRemainingGens(uid),
      limit: this.getDailyLimit(uid),
      premium: this.isPremium(uid),
      history: { ...u.history },
    };
  }

  generate(uid, category) {
    if (!this.categoryExists(category)) return { error: "category_not_found" };
    if (!this.canGenerate(uid)) return { error: "limit_reached" };
    const item = this.pullOne(category);
    if (!item) return { error: "out_of_stock" };
    this.recordGen(uid, category);
    return { success: true, item, remaining: this.getRemainingGens(uid) };
  }
}

module.exports = { GenManager };
