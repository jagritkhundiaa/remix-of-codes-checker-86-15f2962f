// ============================================================
//  Welcome Store — persists which users have already received
//  the welcome DM so it only fires the first time.
// ============================================================

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "data", "welcomed.json");

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function save(arr) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(arr, null, 2));
}

class WelcomeStore {
  constructor() {
    this.set = new Set(load());
  }

  has(userId) {
    return this.set.has(String(userId));
  }

  mark(userId) {
    const id = String(userId);
    if (this.set.has(id)) return;
    this.set.add(id);
    save([...this.set]);
  }
}

module.exports = { WelcomeStore };
