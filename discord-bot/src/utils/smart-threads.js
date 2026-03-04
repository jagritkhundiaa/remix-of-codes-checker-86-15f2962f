// ============================================================
//  Smart Thread Scaling — auto-adjusts concurrency based on
//  rate limits and proxy health
// ============================================================

const { getProxyStats, isProxyEnabled } = require("./proxy-manager");

class SmartThreadManager {
  constructor(initialThreads = 10) {
    this.baseThreads = initialThreads;
    this.currentThreads = initialThreads;
    this.rateLimitHits = 0;
    this.successStreak = 0;
    this.minThreads = 1;
    this.maxThreads = 100;
    this.lastAdjustment = Date.now();
    this.adjustInterval = 10000; // Check every 10s
  }

  /**
   * Record a rate limit hit — decreases threads
   */
  onRateLimit() {
    this.rateLimitHits++;
    this.successStreak = 0;
    
    const now = Date.now();
    if (now - this.lastAdjustment < 5000) return this.currentThreads;
    
    // Halve threads on rate limit
    this.currentThreads = Math.max(this.minThreads, Math.floor(this.currentThreads / 2));
    this.lastAdjustment = now;
    console.log(`[SmartThreads] Rate limit detected, reducing to ${this.currentThreads} threads`);
    return this.currentThreads;
  }

  /**
   * Record a success — may increase threads
   */
  onSuccess() {
    this.successStreak++;
    
    const now = Date.now();
    if (now - this.lastAdjustment < this.adjustInterval) return this.currentThreads;
    
    // After 20 consecutive successes, try scaling up
    if (this.successStreak >= 20) {
      const proxyHealth = this._getProxyHealth();
      const scaleFactor = proxyHealth > 80 ? 1.5 : proxyHealth > 50 ? 1.2 : 1.0;
      
      this.currentThreads = Math.min(
        this.maxThreads,
        Math.ceil(this.currentThreads * scaleFactor)
      );
      this.successStreak = 0;
      this.lastAdjustment = now;
      console.log(`[SmartThreads] Scaling up to ${this.currentThreads} threads (proxy health: ${proxyHealth}%)`);
    }
    
    return this.currentThreads;
  }

  /**
   * Get current recommended thread count
   */
  getThreads() {
    return this.currentThreads;
  }

  /**
   * Get proxy health percentage
   */
  _getProxyHealth() {
    if (!isProxyEnabled()) return 100;
    const stats = getProxyStats();
    return stats.successRate || 100;
  }

  /**
   * Get a summary of the thread manager state
   */
  getSummary() {
    return {
      base: this.baseThreads,
      current: this.currentThreads,
      rateLimitHits: this.rateLimitHits,
      successStreak: this.successStreak,
    };
  }
}

module.exports = { SmartThreadManager };
