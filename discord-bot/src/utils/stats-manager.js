// ============================================================
//  Stats Manager — persistent JSON-based stats tracking
// ============================================================

const fs = require("fs");
const path = require("path");

const STATS_FILE = path.join(__dirname, "..", "..", "data", "stats.json");

function ensureDataDir() {
  const dir = path.dirname(STATS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStats() {
  ensureDataDir();
  if (!fs.existsSync(STATS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveStats(data) {
  ensureDataDir();
  fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
}

class StatsManager {
  constructor() {
    const saved = loadStats();
    this.data = saved || {
      total_processed: 0,
      total_success: 0,
      total_failed: 0,
      users_served: {},
      commands_used: {},
    };
  }

  record(userId, command, success) {
    this.data.total_processed++;
    if (success) this.data.total_success++;
    else this.data.total_failed++;

    const uid = String(userId);
    if (!this.data.users_served[uid]) {
      this.data.users_served[uid] = { processed: 0, success: 0 };
    }
    this.data.users_served[uid].processed++;
    if (success) this.data.users_served[uid].success++;

    if (!this.data.commands_used[command]) {
      this.data.commands_used[command] = 0;
    }
    this.data.commands_used[command]++;

    saveStats(this.data);
  }

  getSuccessRate() {
    if (this.data.total_processed === 0) return 0;
    return Math.round((this.data.total_success / this.data.total_processed) * 100);
  }

  getTopUsers(limit = 5) {
    return Object.entries(this.data.users_served)
      .sort((a, b) => b[1].processed - a[1].processed)
      .slice(0, limit);
  }

  getSummary() {
    return { ...this.data };
  }
}

module.exports = { StatsManager };
