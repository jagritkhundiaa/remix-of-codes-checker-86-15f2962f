// ============================================================
//  Embed builders — monochrome, clean, no emojis
// ============================================================

const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { COLORS } = require("../config");

const FOOTER_TEXT = "AutizMens | TalkNeon";

function header() {
  return new EmbedBuilder()
    .setAuthor({ name: "AutizMens" })
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp();
}

function progressEmbed(completed, total, label = "Processing") {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);

  return header()
    .setColor(COLORS.INFO)
    .setTitle(label)
    .setDescription(`\`${bar}\` ${pct}%\n${completed.toLocaleString()} / ${total.toLocaleString()}`);
}

function checkResultsEmbed(results) {
  const valid = results.filter((r) => r.status === "valid");
  const used = results.filter((r) => r.status === "used");
  const expired = results.filter((r) => r.status === "expired");
  const invalid = results.filter((r) => r.status === "invalid" || r.status === "error");

  return header()
    .setColor(COLORS.PRIMARY)
    .setTitle("Check Results")
    .addFields(
      { name: "Valid", value: `\`${valid.length}\``, inline: true },
      { name: "Used", value: `\`${used.length}\``, inline: true },
      { name: "Expired", value: `\`${expired.length}\``, inline: true },
      { name: "Invalid", value: `\`${invalid.length}\``, inline: true },
      { name: "Total", value: `\`${results.length}\``, inline: true }
    );
}

function claimResultsEmbed(results) {
  const success = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  return header()
    .setColor(COLORS.PRIMARY)
    .setTitle("Claim Results")
    .addFields(
      { name: "Success", value: `\`${success.length}\``, inline: true },
      { name: "Failed", value: `\`${failed.length}\``, inline: true },
      { name: "Total", value: `\`${results.length}\``, inline: true }
    );
}

function pullFetchProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);

  const lines = [`\`${bar}\` ${pct}%`, `${details.done} / ${details.total} accounts`];
  if (details.lastAccount) {
    const status = details.lastError
      ? `${details.lastAccount} — Failed`
      : `${details.lastAccount} — ${details.lastCodes} codes`;
    lines.push(`\nLatest: \`${status}\``);
  }
  if (details.totalCodes !== undefined) {
    lines.push(`Total codes found: \`${details.totalCodes}\``);
  }

  return header()
    .setColor(COLORS.INFO)
    .setTitle("Fetching Codes")
    .setDescription(lines.join("\n"));
}

function pullResultsEmbed(fetchResults, validateResults) {
  const totalFetched = fetchResults.reduce((sum, r) => sum + r.codes.length, 0);
  const accountsSuccess = fetchResults.filter((r) => r.codes.length > 0).length;
  const accountsFailed = fetchResults.filter((r) => r.error).length;

  const valid = validateResults.filter((r) => r.status === "valid");
  const used = validateResults.filter((r) => r.status === "used");
  const expired = validateResults.filter((r) => r.status === "expired");
  const invalid = validateResults.filter((r) => r.status === "invalid");
  const errors = validateResults.filter((r) => r.status === "error");

  return header()
    .setColor(COLORS.PRIMARY)
    .setTitle("Pull Results")
    .addFields(
      { name: "Accounts", value: `\`${accountsSuccess} ok / ${accountsFailed} failed\``, inline: true },
      { name: "Codes Fetched", value: `\`${totalFetched}\``, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Valid", value: `\`${valid.length}\``, inline: true },
      { name: "Used", value: `\`${used.length}\``, inline: true },
      { name: "Expired", value: `\`${expired.length}\``, inline: true },
      { name: "Invalid", value: `\`${invalid.length}\``, inline: true },
      { name: "Errors", value: `\`${errors.length}\``, inline: true },
      { name: "\u200b", value: "\u200b", inline: true }
    );
}

function purchaseProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);

  return header()
    .setColor(COLORS.INFO)
    .setTitle("Purchasing")
    .setDescription([
      `Product: \`${details.product}\``,
      `Price: \`${details.price}\``,
      "",
      `\`${bar}\` ${pct}%`,
      `${details.done} / ${details.total} accounts`,
      details.status ? `\nStatus: \`${details.status}\`` : "",
    ].join("\n"));
}

function purchaseResultsEmbed(results, productTitle, price) {
  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  return header()
    .setColor(COLORS.PRIMARY)
    .setTitle("Purchase Results")
    .addFields(
      { name: "Product", value: `\`${productTitle}\``, inline: false },
      { name: "Price", value: `\`${price}\``, inline: true },
      { name: "Purchased", value: `\`${success.length}\``, inline: true },
      { name: "Failed", value: `\`${failed.length}\``, inline: true },
      { name: "Total", value: `\`${results.length}\``, inline: true }
    );
}

function productSearchEmbed(results) {
  const lines = results.map((r, i) =>
    `\`${i + 1}.\` **${r.title}**\n    ID: \`${r.productId || "N/A"}\` | Type: ${r.type || "N/A"}`
  );

  return header()
    .setColor(COLORS.INFO)
    .setTitle("Search Results")
    .setDescription(lines.join("\n\n") || "No results found.");
}

function changerResultsEmbed(results) {
  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  return header()
    .setColor(COLORS.PRIMARY)
    .setTitle("Changer Results")
    .addFields(
      { name: "Changed", value: `\`${success.length}\``, inline: true },
      { name: "Failed", value: `\`${failed.length}\``, inline: true },
      { name: "Total", value: `\`${results.length}\``, inline: true }
    );
}

function accountCheckerResultsEmbed(results) {
  const valid = results.filter((r) => r.status === "valid").length;
  const locked = results.filter((r) => r.status === "locked").length;
  const invalid = results.filter((r) => r.status === "invalid").length;
  const rateLimited = results.filter((r) => r.status === "rate_limited").length;
  const errors = results.filter((r) => r.status === "error").length;

  return header()
    .setColor(COLORS.PRIMARY)
    .setTitle("Account Checker Results")
    .addFields(
      { name: "Valid", value: `\`${valid}\``, inline: true },
      { name: "Locked", value: `\`${locked}\``, inline: true },
      { name: "Invalid", value: `\`${invalid}\``, inline: true },
      { name: "Rate Limited", value: `\`${rateLimited}\``, inline: true },
      { name: "Errors", value: `\`${errors}\``, inline: true },
      { name: "Total", value: `\`${results.length}\``, inline: true }
    );
}

function errorEmbed(message) {
  return header().setColor(COLORS.ERROR).setTitle("Error").setDescription(message);
}

function successEmbed(message) {
  return header().setColor(COLORS.SUCCESS).setTitle("Success").setDescription(message);
}

function infoEmbed(title, description) {
  return header().setColor(COLORS.INFO).setTitle(title).setDescription(description);
}

function authListEmbed(entries) {
  if (entries.length === 0) {
    return header().setColor(COLORS.MUTED).setTitle("Authorized Users").setDescription("No authorized users.");
  }

  const lines = entries.map((e, i) => {
    const expiry = e.expiresAt === "Infinity" ? "Permanent" : `<t:${Math.floor(e.expiresAt / 1000)}:R>`;
    return `\`${i + 1}.\` <@${e.userId}> — Expires: ${expiry}`;
  });

  return header()
    .setColor(COLORS.INFO)
    .setTitle("Authorized Users")
    .setDescription(lines.join("\n"));
}

function helpEmbed(prefix) {
  const sections = [
    "```",
    "CHECKER",
    `  ${prefix}check [wlids] + attach codes.txt [--dm]`,
    "  Check codes against WLID tokens.",
    "  Uses stored WLIDs if none provided.",
    "",
    "CLAIMER",
    `  ${prefix}claim <email:pass> or attach .txt [--dm]`,
    "  Claim WLID tokens from Microsoft accounts.",
    "",
    "PULLER",
    `  ${prefix}pull <email:pass> or attach .txt [--dm]`,
    "  Fetch codes from Game Pass accounts,",
    "  then validate them automatically.",
    "",
    "PURCHASER",
    `  ${prefix}purchase <email:pass> <product_id> [--dm]`,
    "  Buy items from the Microsoft Store.",
    "  Attach .txt for multiple accounts.",
    `  ${prefix}search <query>`,
    "  Search for products on the Microsoft Store.",
    "",
    "CHANGER",
    `  ${prefix}changer <email:pass> <new_password> [--dm]`,
    "  Change password on Microsoft accounts.",
    "  Attach .txt for multiple accounts.",
    `  ${prefix}checker <email:pass> or attach .txt [--dm]`,
    "  Validate account credentials (valid/locked/invalid).",
    "",
    "  Add --dm to receive results in DMs.",
    "",
    "",
    "WLID STORAGE  [Owner]",
    `  ${prefix}wlidset <tokens> or attach .txt`,
    "  Replace all stored WLID tokens.",
    "",
    "AUTHORIZATION  [Owner]",
    `  ${prefix}auth <@user> <duration>`,
    "  Authorize a user. Duration: 1h, 7d, 1mo, forever",
    `  ${prefix}deauth <@user>`,
    "  Remove authorization.",
    `  ${prefix}authlist`,
    "  List all authorized users.",
    "",
    "BLACKLIST  [Owner]",
    `  ${prefix}blacklist <@user> [reason]`,
    "  Permanently block a user.",
    `  ${prefix}unblacklist <@user>`,
    "  Remove from blacklist.",
    `  ${prefix}blacklistshow`,
    "  Show all blacklisted users.",
    "",
    "ADMIN  [Owner]",
    `  ${prefix}admin  — Admin control panel`,
    `  ${prefix}setwebhook <url>  — Set webhook for results`,
    `  ${prefix}botstats  — Detailed statistics`,
    `  ${prefix}autopull <interval> + accounts  — Auto-pull`,
    `  ${prefix}autopull stop  — Cancel auto-pull`,
    `  ${prefix}autopull list  — View scheduled jobs`,
    "",
    "INFO",
    `  ${prefix}stats   — Bot status and metrics`,
    `  ${prefix}help    — This message`,
    "```",
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setTitle("Command Reference")
    .setDescription(sections.join("\n"));
}

function adminPanelEmbed(stats, authCount, activeOtpSessions, activeProcesses, webhookSet) {
  return header()
    .setColor(COLORS.PRIMARY)
    .setTitle("Admin Control Panel")
    .addFields(
      { name: "Stats", value: `Users: \`${authCount}\`\nOTP Sessions: \`${activeOtpSessions}\`\nActive: \`${activeProcesses}\``, inline: true },
      { name: "Processing", value: `Total: \`${stats.total_processed}\`\nSuccess: \`${stats.total_success}\`\nFailed: \`${stats.total_failed}\``, inline: true },
      { name: "Status", value: `Bot: Online\nWebhook: ${webhookSet ? "Set" : "Not Set"}`, inline: true },
    );
}

function detailedStatsEmbed(stats, topUsers) {
  const rate = stats.total_processed > 0
    ? Math.round((stats.total_success / stats.total_processed) * 100)
    : 0;

  const topText = topUsers.length > 0
    ? topUsers.map(([uid, d]) => `<@${uid}>: ${d.processed} processed (${d.success} success)`).join("\n")
    : "No data";

  return header()
    .setColor(COLORS.PRIMARY)
    .setTitle("Detailed Statistics")
    .addFields(
      { name: "Processing", value: `Processed: \`${stats.total_processed}\`\nSuccess: \`${stats.total_success}\`\nFailed: \`${stats.total_failed}\``, inline: true },
      { name: "Success Rate", value: `\`${rate}%\``, inline: true },
      { name: "Top Users", value: topText, inline: false },
    );
}

/**
 * Create a .txt file attachment from an array of strings.
 */
function textAttachment(lines, filename) {
  const buffer = Buffer.from(lines.join("\n"), "utf-8");
  return new AttachmentBuilder(buffer, { name: filename });
}

module.exports = {
  progressEmbed,
  checkResultsEmbed,
  claimResultsEmbed,
  pullFetchProgressEmbed,
  pullResultsEmbed,
  purchaseProgressEmbed,
  purchaseResultsEmbed,
  productSearchEmbed,
  changerResultsEmbed,
  accountCheckerResultsEmbed,
  errorEmbed,
  successEmbed,
  infoEmbed,
  authListEmbed,
  helpEmbed,
  adminPanelEmbed,
  detailedStatsEmbed,
  textAttachment,
};
