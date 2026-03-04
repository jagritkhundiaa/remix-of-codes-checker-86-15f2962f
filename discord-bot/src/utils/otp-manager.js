// ============================================================
//  OTP Authentication Manager
//  - Users request OTP via DM, verify to get 24hr session
//  - Tracks expiration, max attempts
// ============================================================

class OTPManager {
  constructor() {
    this.otpData = new Map();      // userId → { otp, expiresAt, attempts }
    this.sessions = new Map();      // userId → { authenticatedAt }
    this.SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    this.OTP_DURATION = 5 * 60 * 1000;           // 5 minutes
    this.MAX_ATTEMPTS = 3;
  }

  generateOTP(userId) {
    const otp = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join("");
    this.otpData.set(userId, {
      otp,
      expiresAt: Date.now() + this.OTP_DURATION,
      attempts: 0,
    });
    return otp;
  }

  verifyOTP(userId, code) {
    const data = this.otpData.get(userId);
    if (!data) return { ok: false, reason: "No OTP requested. Use `/request_otp` first." };

    if (Date.now() > data.expiresAt) {
      this.otpData.delete(userId);
      return { ok: false, reason: "OTP expired. Request a new one." };
    }

    if (data.attempts >= this.MAX_ATTEMPTS) {
      this.otpData.delete(userId);
      return { ok: false, reason: "Maximum attempts exceeded." };
    }

    if (data.otp === code.trim()) {
      this.otpData.delete(userId);
      this.sessions.set(userId, { authenticatedAt: Date.now() });
      return { ok: true, reason: "Authentication successful!" };
    }

    data.attempts++;
    const remaining = this.MAX_ATTEMPTS - data.attempts;
    return { ok: false, reason: `Invalid OTP. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.` };
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
    // Clean expired sessions while counting
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
