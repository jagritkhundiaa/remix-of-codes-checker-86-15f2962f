// ============================================================
//  resume-registry — dispatch-level crash resume.
//
//  We DO NOT modify any checker's internal loop (1:1 logic parity is sacred).
//  Instead, when a command starts, we snapshot its full invocation:
//    { userId, channelId, command, args }
//  to data/active-runs.json. When the command finishes (success or hard error),
//  we delete the snapshot. On bot startup we read whatever is left and
//  re-fire each snapshot by calling the original handler with the same args.
//
//  Because we cannot serialize Discord.js Attachment objects, attachments
//  are pre-read into raw text BEFORE startRun() is called and stored as
//  `accountsRaw`. The re-fire therefore passes accountsRaw + null attachment.
//
//  Storage: discord-bot/data/active-runs.json (atomic write-tmp+rename).
// ============================================================

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE = path.join(DATA_DIR, "active-runs.json");
const TMP = FILE + ".tmp";

function ensureDir() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {} }

function loadAll() {
  ensureDir();
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && obj.runs && typeof obj.runs === "object") return obj;
  } catch {}
  return { runs: {} };
}

function saveAll(state) {
  ensureDir();
  try {
    fs.writeFileSync(TMP, JSON.stringify(state));
    fs.renameSync(TMP, FILE);
  } catch {}
}

function key(userId, command) { return `${userId}:${command}`; }

function startRun({ userId, channelId, command, args }) {
  const state = loadAll();
  state.runs[key(userId, command)] = {
    userId,
    channelId,
    command,
    args: args || {},
    startedAt: Date.now(),
  };
  saveAll(state);
}

function finishRun(userId, command) {
  const state = loadAll();
  if (state.runs[key(userId, command)]) {
    delete state.runs[key(userId, command)];
    saveAll(state);
  }
}

function listRuns() {
  return Object.values(loadAll().runs);
}

function clearAll() { saveAll({ runs: {} }); }

// Read a Discord attachment to text up-front so we can persist it.
async function attachmentToText(attachment) {
  if (!attachment || !attachment.url) return "";
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

module.exports = { startRun, finishRun, listRuns, clearAll, attachmentToText };
