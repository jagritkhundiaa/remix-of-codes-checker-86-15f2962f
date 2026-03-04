// ============================================================
//  OTP / Session Manager — Auto-authentication
//  - Authorized users are auto-authenticated on first command
//  - Sessions last 24 hours, then auto-renew silently
//  - No manual OTP flow needed
// ============================================================

class OTPManager {
  constructor() {
    this.sessions = new Map(); // userId → { authenticatedAt }
    this.SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Auto-authenticate a user. Called internally before any command.
   * If session is valid, returns true. If expired or missing, creates a new one.
   * This is fully automatic — no user interaction needed.
   */
  ensureAuthenticated(userId) {
    const session = this.sessions.get(userId);
    if (session && Date.now() - session.authenticatedAt < this.SESSION_DURATION) {
      return true; // Already has a valid session
    }
    // Auto-create/renew session
    this.sessions.set(userId, { authenticatedAt: Date.now() });
    console.log(`[Session] Auto-authenticated user ${userId}`);
    return true;
  }

  isAuthenticated(userId) {
    const session = this.sessions.get(userId);
    if (!session) return false;
    if (Date.now() - session.authenticatedAt > this.SESSION_DURATION) {
      this.sessions.delete(userId);
      return false;
    }
    return true;
  }

  logout(userId) {
    this.sessions.delete(userId);
  }

  getActiveSessionCount() {
    const now = Date.now();
    let count = 0;
    for (const [userId, session] of this.sessions) {
      if (now - session.authenticatedAt > this.SESSION_DURATION) {
        this.sessions.delete(userId);
      } else {
        count++;
      }
    }
    return count;
  }
}

module.exports = { OTPManager };
