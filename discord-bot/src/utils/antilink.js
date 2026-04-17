// ============================================================
//  Anti-link config — channel(s) protected, whitelist of users
// ============================================================

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "data", "antilink.json");

let state = {
  channels: [],   // channel IDs to protect
  whitelist: [],  // user IDs allowed to post links
};

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  try {
    ensureDir();
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
      if (data && typeof data === "object") {
        state.channels = Array.isArray(data.channels) ? data.channels : [];
        state.whitelist = Array.isArray(data.whitelist) ? data.whitelist : [];
      }
    }
  } catch {}
}

function save() {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

function addChannel(id) { if (!state.channels.includes(id)) { state.channels.push(id); save(); } }
function removeChannel(id) { state.channels = state.channels.filter((c) => c !== id); save(); }
function getChannels() { return [...state.channels]; }
function isProtected(id) { return state.channels.includes(id); }

function addUser(id) { if (!state.whitelist.includes(id)) { state.whitelist.push(id); save(); } }
function removeUser(id) { state.whitelist = state.whitelist.filter((u) => u !== id); save(); }
function getWhitelist() { return [...state.whitelist]; }
function isWhitelisted(id) { return state.whitelist.includes(id); }

const LINK_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?/i;
function containsLink(text) { return LINK_RE.test(String(text || "")); }

load();

module.exports = {
  addChannel, removeChannel, getChannels, isProtected,
  addUser, removeUser, getWhitelist, isWhitelisted,
  containsLink,
};
