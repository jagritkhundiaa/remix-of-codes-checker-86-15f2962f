// ============================================================
//  Auto-Pull Scheduler — runs pull at timed intervals
// ============================================================

class AutoPullScheduler {
  constructor() {
    this.jobs = new Map(); // channelId → { interval, accounts, timer, lastRun, results }
  }

  /**
   * Schedule a recurring pull job
   * @param {string} channelId - Discord channel ID for results
   * @param {string[]} accounts - email:password accounts
   * @param {number} intervalMs - Interval in milliseconds
   * @param {Function} executeFn - async function(accounts) => results
   * @param {Function} reportFn - async function(results) => void
   */
  schedule(channelId, accounts, intervalMs, executeFn, reportFn) {
    // Clear existing job for this channel
    this.cancel(channelId);
    
    const job = {
      accounts,
      intervalMs,
      executeFn,
      reportFn,
      lastRun: null,
      nextRun: Date.now() + intervalMs,
      running: false,
      runCount: 0,
      timer: null,
    };
    
    const run = async () => {
      if (job.running) {
        console.log(`[AutoPull] Skipping ${channelId} — previous run still active`);
        return;
      }
      
      job.running = true;
      job.lastRun = Date.now();
      job.runCount++;
      console.log(`[AutoPull] Running scheduled pull #${job.runCount} for channel ${channelId}`);
      
      try {
        const results = await executeFn(accounts);
        job.lastResults = results;
        await reportFn(results, job.runCount);
      } catch (err) {
        console.error(`[AutoPull] Error in scheduled pull:`, err);
      } finally {
        job.running = false;
        job.nextRun = Date.now() + intervalMs;
      }
    };
    
    job.timer = setInterval(run, intervalMs);
    this.jobs.set(channelId, job);
    
    console.log(`[AutoPull] Scheduled for channel ${channelId} every ${this.formatInterval(intervalMs)}`);
    return job;
  }

  /**
   * Cancel a scheduled job
   */
  cancel(channelId) {
    const job = this.jobs.get(channelId);
    if (job) {
      clearInterval(job.timer);
      this.jobs.delete(channelId);
      console.log(`[AutoPull] Cancelled for channel ${channelId}`);
      return true;
    }
    return false;
  }

  /**
   * Get all active jobs
   */
  getAll() {
    const result = [];
    for (const [channelId, job] of this.jobs) {
      result.push({
        channelId,
        accounts: job.accounts.length,
        interval: this.formatInterval(job.intervalMs),
        lastRun: job.lastRun,
        nextRun: job.nextRun,
        runCount: job.runCount,
        running: job.running,
      });
    }
    return result;
  }

  /**
   * Check if a channel has a job
   */
  has(channelId) {
    return this.jobs.has(channelId);
  }

  formatInterval(ms) {
    const hours = ms / (1000 * 60 * 60);
    if (hours >= 24) return `${Math.round(hours / 24)}d`;
    if (hours >= 1) return `${Math.round(hours)}h`;
    return `${Math.round(ms / (1000 * 60))}m`;
  }

  parseInterval(str) {
    const match = str.match(/^(\d+)(m|h|d)$/i);
    if (!match) return null;
    const val = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "m") return val * 60 * 1000;
    if (unit === "h") return val * 60 * 60 * 1000;
    if (unit === "d") return val * 24 * 60 * 60 * 1000;
    return null;
  }
}

module.exports = { AutoPullScheduler };
