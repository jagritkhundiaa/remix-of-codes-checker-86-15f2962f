// ============================================================
//  Autopilot Access — "reply milk to gain auto access"
//  - Owner toggles globally (.autopilotoff / .autopiloton)
//  - Grants 10-day access via AuthManager when user replies "milk"
// ============================================================

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "data", "autopilot.json");

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let state = {
  enabled: true,
  promptedUsers: {}, // userId -> { promptedAt, channelId }
};

function load() {
  try {
    ensureDir();
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
      if (data && typeof data === "object") state = { ...state, ...data };
    }
  } catch {}
}

function save() {
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch {}
}

function isEnabled() { return !!state.enabled; }
function setEnabled(v) { state.enabled = !!v; save(); }

function markPrompted(userId, channelId) {
  state.promptedUsers[userId] = { promptedAt: Date.now(), channelId };
  save();
}

function wasPrompted(userId) {
  return !!state.promptedUsers[userId];
}

function clearPrompted(userId) {
  delete state.promptedUsers[userId];
  save();
}

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

load();

module.exports = { isEnabled, setEnabled, markPrompted, wasPrompted, clearPrompted, TEN_DAYS_MS };
