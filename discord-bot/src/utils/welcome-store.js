// ============================================================
//  Welcome Store — persists which users have ever seen welcome DM
// ============================================================

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "data", "welcomed.json");

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let welcomed = new Set();

function load() {
  try {
    ensureDir();
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
      if (Array.isArray(data)) welcomed = new Set(data);
    }
  } catch {}
}

function save() {
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify([...welcomed], null, 2));
  } catch {}
}

function hasWelcomed(userId) {
  return welcomed.has(userId);
}

function markWelcomed(userId) {
  if (welcomed.has(userId)) return false;
  welcomed.add(userId);
  save();
  return true;
}

load();

module.exports = { hasWelcomed, markWelcomed };
