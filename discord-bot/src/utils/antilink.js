// ============================================================
//  Anti-Link System — deletes link messages from non-admins in
//  configured channels. Owner-managed whitelist persists to JSON.
// ============================================================

const fs = require("fs");
const path = require("path");
const config = require("../config");

const FILE = path.join(__dirname, "..", "..", "data", "antilink-whitelist.json");

// URL pattern: matches http(s)://, www., and common invite/shortener forms
const LINK_RE = /(https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[a-z0-9]+|discord\.com\/invite\/[a-z0-9]+)/i;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return Array.isArray(data) ? data.map(String) : [];
  } catch {
    return [];
  }
}

function save(arr) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(arr, null, 2));
}

class AntiLink {
  constructor() {
    this.whitelist = new Set(load());
  }

  isProtectedChannel(channelId) {
    const channels = config.ANTILINK_CHANNELS || [];
    return channels.includes(channelId);
  }

  containsLink(content) {
    if (!content) return false;
    return LINK_RE.test(content);
  }

  isWhitelisted(userId) {
    return this.whitelist.has(String(userId));
  }

  addWhitelist(userId) {
    const id = String(userId);
    if (this.whitelist.has(id)) return false;
    this.whitelist.add(id);
    save([...this.whitelist]);
    return true;
  }

  removeWhitelist(userId) {
    const id = String(userId);
    if (!this.whitelist.has(id)) return false;
    this.whitelist.delete(id);
    save([...this.whitelist]);
    return true;
  }

  list() {
    return [...this.whitelist];
  }
}

module.exports = { AntiLink };
