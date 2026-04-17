// ============================================================
//  CONFIGURATION — Fill these in before running
// ============================================================

module.exports = {
  // Discord Bot Token  (Developer Portal → Bot → Token)
  BOT_TOKEN: "YOUR_BOT_TOKEN_HERE",

  // Application / Client ID  (Developer Portal → General Information)
  CLIENT_ID: "YOUR_CLIENT_ID_HERE",

  // Bot owner Discord user ID (right-click yourself → Copy User ID)
  OWNER_ID: "YOUR_OWNER_ID_HERE",

  // Command prefix for message-based commands
  PREFIX: ".",

  // Max concurrent users allowed to run commands simultaneously
  MAX_CONCURRENT_USERS: 5,

  // Channel for Puller & Checkers (pull, promopuller, check, checker, claim)
  ALLOWED_CHANNEL_PULLER: "1468201723767029782",

  // Channel for Inbox AIO & normal commands (inboxaio, rewards, recover, help, stats, etc.)
  ALLOWED_CHANNEL_INBOX: "1468623303731183813",

  // Discord webhook for logging valid codes / tokens (optional, leave "" to disable)
  DISCORD_WEBHOOK: "",

  // ── Branding ───────────────────────────────────────────────
  // Bot thumbnail URL — appears on major embeds (set to your logo/avatar URL)
  // Use a direct image URL (PNG/JPG). Leave "" to disable.
  THUMBNAIL_URL: "",

  // Bot banner URL — wide image at bottom of welcome/help embeds
  // Recommended: 600x100 or similar wide format. Leave "" to disable.
  BANNER_URL: "",

  // ── Anti-link channel(s) — links auto-deleted here unless user is whitelisted/admin ──
  // Add more via .antilinkadd <#channel>. This is just an initial seed.
  ANTILINK_CHANNELS: [],

  // ── Proxy Settings ──────────────────────────────────────────
  // Set to true to route requests through proxies loaded from proxies.txt
  // Set to false for direct connections
  USE_PROXIES: false,

  // Embed color palette — monochrome
  // Invisible dark embeds — matches Discord dark theme background
  COLORS: {
    PRIMARY:  0x2b2d31,
    SUCCESS:  0x2b2d31,
    ERROR:    0x2b2d31,
    WARNING:  0x2b2d31,
    EXPIRED:  0x2b2d31,
    INFO:     0x2b2d31,
    MUTED:    0x2b2d31,
  },
};
