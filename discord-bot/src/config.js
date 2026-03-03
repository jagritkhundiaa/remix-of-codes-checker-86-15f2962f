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

  // Discord webhook for logging valid codes / tokens (optional, leave "" to disable)
  DISCORD_WEBHOOK: "",

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
