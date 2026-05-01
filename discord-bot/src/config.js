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

  // Channel for Inbox AIO & normal commands (inboxaio, rewards, help, stats, etc.)
  ALLOWED_CHANNEL_INBOX: "1468623303731183813",

  // ── Anti-Link System ───────────────────────────────────────
  // Channel IDs where links from non-admin/non-whitelisted users are deleted.
  // Leave [] to disable.
  ANTILINK_CHANNELS: [
    // "1468623303731183813",
  ],

  // Discord webhook for logging valid codes / tokens (optional, leave "" to disable)
  DISCORD_WEBHOOK: "",

  // ── PromoPuller ────────────────────────────────────────────
  // Discord user/bot token used by /promopuller to validate gift-codes
  // via discord.com/api/v9/entitlements/gift-codes. Leave the placeholder
  // to disable validation (links will still be pulled).
  DISCORD_TOKEN: "YOUR_DISCORD_TOKEN_HERE",

  // ── Branding ───────────────────────────────────────────────
  // Bot thumbnail URL — appears on major embeds (set to your logo/avatar URL)
  // Use a direct image URL (PNG/JPG). Leave "" to disable.
  THUMBNAIL_URL: "",

  // Bot banner URL — wide image at bottom of welcome/help embeds
  // Recommended: 600x100 or similar wide format. Leave "" to disable.
  BANNER_URL: "",

  // ── Proxy Settings ──────────────────────────────────────────
  // Set to true to route requests through proxies loaded from proxies.txt
  // Set to false for direct connections
  USE_PROXIES: false,

  // ── Gen System (v2) ────────────────────────────────────────
  // Guild ID where /gen, /admin, /me, etc. are registered.
  GEN_GUILD_ID: "",
  // Channels where .gen / /gen is allowed (empty = any channel).
  GEN_CHANNEL_IDS: [],
  // Channel for audit log messages (low stock alerts, grants, etc.) — leave "" to disable.
  GEN_LOG_CHANNEL_ID: "",
  // Roles for per-tier gating.
  GEN_ADMIN_ROLE_ID: "",
  GEN_PREMIUM_ROLE_ID: "",
  GEN_VIP_ROLE_ID: "",
  GEN_FREE_ROLE_ID: "",
  // Public proof channel link inserted into DM warning. Leave "" to disable warning.
  GEN_PROOF_LINK: "",
  // Per-tier defaults (cooldown in seconds, daily limit).
  GEN_TIERS: {
    ADMIN: { cooldownSeconds: 0,    dailyLimit: 0   },
    FREE:  { cooldownSeconds: 300,  dailyLimit: 30  },
    PREM:  { cooldownSeconds: 900,  dailyLimit: 100 },
    VIP:   { cooldownSeconds: 120,  dailyLimit: 200 },
  },
  // Whitelist-only mode: if true, only .access-granted users can /gen.
  GEN_WHITELIST_ONLY: false,
  // Anti-spam thresholds (admins always bypass).
  GEN_ANTISPAM: { minAccountAgeDays: 0, minServerJoinAgeHours: 0 },

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
