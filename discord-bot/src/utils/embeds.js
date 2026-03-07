// ============================================================
//  Embed builders — monochrome, clean, no emojis
// ============================================================

const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { COLORS } = require("../config");

const FOOTER_TEXT = "EliteCloud";

function header() {
  return new EmbedBuilder()
    .setAuthor({ name: "EliteCloud" })
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
      ? `${details.lastAccount} -- Failed`
      : `${details.lastAccount} -- ${details.lastCodes} codes`;
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

/**
 * Pull results embed — matches reference image layout exactly.
 * Structured account analysis with sub-categories, elapsed time, DM notice.
 */
function pullResultsEmbed(fetchResults, validateResults, { elapsed, dmSent, username } = {}) {
  const totalAccounts = fetchResults.length;
  const workingAccounts = fetchResults.filter((r) => !r.error);
  const failedAccounts = fetchResults.filter((r) => r.error);
  const withCodes = workingAccounts.filter((r) => r.codes.length > 0);
  const noCodes = workingAccounts.filter((r) => r.codes.length === 0);

  const totalCodesFetched = fetchResults.reduce((sum, r) => sum + r.codes.length, 0);

  const valid = validateResults.filter((r) => r.status === "valid");
  const used = validateResults.filter((r) => r.status === "used" || r.status === "REDEEMED");
  const expired = validateResults.filter((r) => r.status === "expired" || r.status === "EXPIRED");
  const invalid = validateResults.filter((r) => r.status === "invalid" || r.status === "error" || r.status === "INVALID");
  const balance = validateResults.filter((r) => r.status === "BALANCE_CODE");
  const regionLocked = validateResults.filter((r) => r.status === "REGION_LOCKED");

  const lines = [
    `**Fetching Complete!**`,
    ``,
    `  **Account Analysis:**`,
    `- **Total Accounts:** ${totalAccounts}`,
    `- **Working Accounts:** ${workingAccounts.length}`,
    `  \u2514 With Codes: ${withCodes.length}`,
    `  \u2514 No Codes: ${noCodes.length}`,
    `- **Failed Accounts:** ${failedAccounts.length}`,
    `- **Codes Found:** ${totalCodesFetched}`,
    `  \u2514 Working: ${valid.length}`,
    `  \u2514 Claimed: ${used.length}`,
    `  \u2514 Balance: ${balance.length}`,
  ];

  if (expired.length > 0) lines.push(`  \u2514 Expired: ${expired.length}`);
  if (regionLocked.length > 0) lines.push(`  \u2514 Region Locked: ${regionLocked.length}`);
  if (invalid.length > 0) lines.push(`  \u2514 Invalid: ${invalid.length}`);

  // Links found (unique codes count)
  lines.push(`- **Links Found:** ${totalCodesFetched}`);

  if (elapsed) {
    lines.push(`\n**Time:** ${elapsed}s`);
  }

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));

  if (dmSent) {
    embed.addFields({ name: "\u200b", value: "```\n>> Results sent to your DMs\n```", inline: false });
  }

  if (username) {
    embed.setFooter({ text: `Pulled by ${username} | ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
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

/**
 * Owner-only restriction embed for features still under development.
 */
function ownerOnlyEmbed(featureName) {
  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(
      [
        `**${featureName}** is currently in a closed development phase.`,
        ``,
        `This feature is exclusively available to **TalkNeon** during the testing period.`,
        ``,
        `Access will be rolled out once the module has been fully validated and stabilized.`,
        `Check back later or contact TalkNeon for updates.`,
      ].join("\n")
    );
}

function authListEmbed(entries) {
  if (entries.length === 0) {
    return header().setColor(COLORS.MUTED).setTitle("Authorized Users").setDescription("No authorized users.");
  }

  const lines = entries.map((e, i) => {
    const expiry = e.expiresAt === "Infinity" ? "Permanent" : `<t:${Math.floor(e.expiresAt / 1000)}:R>`;
    return `\`${i + 1}.\` <@${e.userId}> -- Expires: ${expiry}`;
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
    "PURCHASER  [Owner Only]",
    `  ${prefix}purchase <email:pass> <product_id> [--dm]`,
    "  Buy items from the Microsoft Store.",
    `  ${prefix}search <query>`,
    "  Search for products on the Microsoft Store.",
    "",
    "CHANGER  [Owner Only]",
    `  ${prefix}changer <email:pass> <new_password> [--dm]`,
    "  Change password on Microsoft accounts.",
    `  ${prefix}checker <email:pass> or attach .txt [--dm]`,
    "  Validate account credentials.",
    "",
    "RECOVERY",
    `  ${prefix}recover <email(s)> <new_password> [--dm]`,
    "  Recover account(s) via ACSR.",
    `  ${prefix}captcha <solution>`,
    "  Submit CAPTCHA solution for active recovery.",
    "",
    "",
    "WLID STORAGE  [Owner]",
    `  ${prefix}wlidset <tokens> or attach .txt`,
    "  Replace all stored WLID tokens.",
    "",
    "AUTHORIZATION  [Owner]",
    `  ${prefix}auth <@user> <duration>`,
    `  ${prefix}deauth <@user>`,
    `  ${prefix}authlist`,
    "",
    "BLACKLIST  [Owner]",
    `  ${prefix}blacklist <@user> [reason]`,
    `  ${prefix}unblacklist <@user>`,
    `  ${prefix}blacklistshow`,
    "",
    "ADMIN  [Owner]",
    `  ${prefix}admin  -- Admin control panel`,
    `  ${prefix}setwebhook <url>  -- Set webhook`,
    `  ${prefix}botstats  -- Detailed statistics`,
    "",
    "INFO",
    `  ${prefix}stats   -- Bot status`,
    `  ${prefix}help    -- This message`,
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

function recoverProgressEmbed(email, status) {
  return header()
    .setColor(COLORS.INFO)
    .setTitle("Account Recovery")
    .addFields(
      { name: "Account", value: `\`${email}\``, inline: true },
    )
    .setDescription(status);
}

function recoverResultEmbed(email, success, message) {
  return header()
    .setColor(success ? COLORS.SUCCESS : COLORS.ERROR)
    .setTitle(success ? "Recovery Successful" : "Recovery Failed")
    .addFields(
      { name: "Account", value: `\`${email}\``, inline: true },
    )
    .setDescription(message || (success ? "Password has been reset." : "Recovery failed."));
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
  ownerOnlyEmbed,
  authListEmbed,
  helpEmbed,
  adminPanelEmbed,
  detailedStatsEmbed,
  textAttachment,
  recoverProgressEmbed,
  recoverResultEmbed,
};
