// ============================================================
//  Blacklist Manager — persistent JSON-backed blacklist
// ============================================================

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "blacklist.json");

let blacklist = new Map();

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
      blacklist = new Map(Object.entries(data));
    }
  } catch { /* ignore */ }
}

function save() {
  const obj = Object.fromEntries(blacklist);
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2), "utf-8");
}

function add(userId, reason = "No reason") {
  blacklist.set(userId, { reason, addedAt: Date.now() });
  save();
}

function remove(userId) {
  const had = blacklist.delete(userId);
  if (had) save();
  return had;
}

function isBlacklisted(userId) {
  return blacklist.has(userId);
}

function getAll() {
  return Array.from(blacklist.entries()).map(([userId, data]) => ({
    userId,
    reason: data.reason,
    addedAt: data.addedAt,
  }));
}

function getCount() {
  return blacklist.size;
}

// Load on require
load();

module.exports = { add, remove, isBlacklisted, getAll, getCount };
