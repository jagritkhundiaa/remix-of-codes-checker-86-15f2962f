// ============================================================
//  Embed builders — clean, professional, no emojis
// ============================================================

const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { COLORS } = require("../config");

function header() {
  return new EmbedBuilder()
    .setAuthor({ name: "MS Code Checker" })
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

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setTitle("Check Results")
    .addFields(
      { name: "Valid", value: `\`${valid.length}\``, inline: true },
      { name: "Used", value: `\`${used.length}\``, inline: true },
      { name: "Expired", value: `\`${expired.length}\``, inline: true },
      { name: "Invalid", value: `\`${invalid.length}\``, inline: true },
      { name: "Total", value: `\`${results.length}\``, inline: true }
    );

  return embed;
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
      ? `${details.lastAccount} - Failed`
      : `${details.lastAccount} - ${details.lastCodes} codes`;
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

  const valid = validateResults.filter((r) => r.status === "VALID");
  const validCard = validateResults.filter((r) => r.status === "VALID_REQUIRES_CARD");
  const balance = validateResults.filter((r) => r.status === "BALANCE_CODE");
  const redeemed = validateResults.filter((r) => r.status === "REDEEMED");
  const expired = validateResults.filter((r) => r.status === "EXPIRED");
  const deactivated = validateResults.filter((r) => r.status === "DEACTIVATED");
  const regionLocked = validateResults.filter((r) => r.status === "REGION_LOCKED");
  const invalid = validateResults.filter((r) => r.status === "INVALID");
  const unknown = validateResults.filter((r) => r.status === "UNKNOWN");
  const errors = validateResults.filter((r) => ["ERROR", "RATE_LIMITED", "SKIPPED"].includes(r.status));

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setTitle("Pull Results")
    .addFields(
      { name: "Accounts", value: `\`${accountsSuccess} ok / ${accountsFailed} failed\``, inline: true },
      { name: "Codes Fetched", value: `\`${totalFetched}\``, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Valid", value: `\`${valid.length}\``, inline: true },
      { name: "Valid (Card)", value: `\`${validCard.length}\``, inline: true },
      { name: "Balance", value: `\`${balance.length}\``, inline: true },
      { name: "Redeemed", value: `\`${redeemed.length}\``, inline: true },
      { name: "Expired", value: `\`${expired.length}\``, inline: true },
      { name: "Deactivated", value: `\`${deactivated.length}\``, inline: true },
      { name: "Region Locked", value: `\`${regionLocked.length}\``, inline: true },
      { name: "Invalid", value: `\`${invalid.length}\``, inline: true },
      { name: "Unknown/Error", value: `\`${unknown.length + errors.length}\``, inline: true }
    );

  return embed;
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
  errorEmbed,
  successEmbed,
  infoEmbed,
  authListEmbed,
  textAttachment,
};
