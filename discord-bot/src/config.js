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

  // Embed color palette  (hex → decimal)
  COLORS: {
    PRIMARY:  0x2563eb,   // blue-600
    SUCCESS:  0x16a34a,   // green-600
    ERROR:    0xdc2626,   // red-600
    WARNING:  0xf59e0b,   // amber-500
    EXPIRED:  0x9333ea,   // purple-600
    INFO:     0x0ea5e9,   // sky-500
    MUTED:    0x64748b,   // slate-500
  },
};
