// ============================================================
//  Autopilot Access — unauthorized users can reply "milk" to the
//  bot's warning to get 10-day temporary access. Owner can
//  toggle the whole system off with .autopilotoff.
// ============================================================

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "data", "autopilot.json");
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
const REPLY_WINDOW_MS = 5 * 60 * 1000; // 5 min to reply "milk"

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(FILE)) return { enabled: true, pending: {} };
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return {
      enabled: data.enabled !== false,
      pending: data.pending || {},
    };
  } catch {
    return { enabled: true, pending: {} };
  }
}

function save(state) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

class AutopilotManager {
  constructor() {
    this.state = load();
  }

  isEnabled() {
    return this.state.enabled;
  }

  setEnabled(value) {
    this.state.enabled = !!value;
    save(this.state);
  }

  /**
   * Mark that the bot just sent the "unauthorised" warning to a user.
   * Stores the warning message ID so we can verify the reply targets it.
   */
  registerWarning(userId, channelId, warningMessageId) {
    this.state.pending[String(userId)] = {
      channelId,
      warningMessageId,
      ts: Date.now(),
    };
    save(this.state);
  }

  /**
   * Returns true if this message is a valid "milk" reply to the warning.
   * Caller passes the discord.js Message object.
   */
  isMilkReply(message) {
    if (!this.state.enabled) return false;
    if (!message?.reference?.messageId) return false;
    const content = (message.content || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (content !== "milk me daddy") return false;

    const entry = this.state.pending[message.author.id];
    if (!entry) return false;
    if (Date.now() - entry.ts > REPLY_WINDOW_MS) {
      delete this.state.pending[message.author.id];
      save(this.state);
      return false;
    }
    if (entry.warningMessageId !== message.reference.messageId) return false;
    return true;
  }

  consume(userId) {
    delete this.state.pending[String(userId)];
    save(this.state);
  }

  grantDuration() {
    return TEN_DAYS_MS;
  }
}

module.exports = { AutopilotManager, TEN_DAYS_MS };
