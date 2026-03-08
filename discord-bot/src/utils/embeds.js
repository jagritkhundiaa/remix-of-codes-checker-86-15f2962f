// ============================================================
//  Embed builders — monochrome, premium, no emojis
//  Clean visual hierarchy with Unicode separators
// ============================================================

const { EmbedBuilder, AttachmentBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
const { COLORS, THUMBNAIL_URL, BANNER_URL } = require("../config");

const FOOTER_TEXT = "AutizMens | TalkNeon";
const SEP = "\u2500".repeat(28);
const SEP_THIN = "\u2508".repeat(28);

function header(options = {}) {
  const embed = new EmbedBuilder()
    .setAuthor({ name: "AutizMens" })
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp();

  if (options.thumbnail !== false && THUMBNAIL_URL) {
    embed.setThumbnail(THUMBNAIL_URL);
  }
  if (options.banner && BANNER_URL) {
    embed.setImage(BANNER_URL);
  }

  return embed;
}

// ── Progress ─────────────────────────────────────────────────

function progressEmbed(completed, total, label = "Processing") {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);

  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setTitle(label)
    .setDescription([
      `\`${bar}\` **${pct}%**`,
      `\`${completed.toLocaleString()}\` / \`${total.toLocaleString()}\``,
    ].join("\n"));
}

// ── Check Results ────────────────────────────────────────────

function checkResultsEmbed(results) {
  const valid = results.filter((r) => r.status === "valid");
  const used = results.filter((r) => r.status === "used");
  const expired = results.filter((r) => r.status === "expired");
  const invalid = results.filter((r) => r.status === "invalid" || r.status === "error");

  const lines = [
    `${SEP}`,
    `**Check Results**`,
    `${SEP_THIN}`,
    ``,
    `\u2502 Valid        \`${valid.length}\``,
    `\u2502 Used         \`${used.length}\``,
    `\u2502 Expired      \`${expired.length}\``,
    `\u2502 Invalid      \`${invalid.length}\``,
    ``,
    `${SEP_THIN}`,
    `\u2502 Total        \`${results.length}\``,
    `${SEP}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));
}

// ── Claim Results ────────────────────────────────────────────

function claimResultsEmbed(results) {
  const success = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  const lines = [
    `${SEP}`,
    `**Claim Results**`,
    `${SEP_THIN}`,
    ``,
    `\u2502 Success      \`${success.length}\``,
    `\u2502 Failed       \`${failed.length}\``,
    ``,
    `${SEP_THIN}`,
    `\u2502 Total        \`${results.length}\``,
    `${SEP}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));
}

// ── Pull Progress (Fetch Phase) ──────────────────────────────

function pullFetchProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);

  const lines = [
    `${SEP}`,
    `**Fetching Codes**`,
    `${SEP_THIN}`,
    ``,
    `\`${bar}\` **${pct}%**`,
    `\`${details.done}\` / \`${details.total}\` accounts`,
  ];

  if (details.lastAccount) {
    const status = details.lastError
      ? `${details.lastAccount} \u2014 Failed`
      : `${details.lastAccount} \u2014 ${details.lastCodes} codes`;
    lines.push(``, `Latest: \`${status}\``);
  }
  if (details.totalCodes !== undefined) {
    lines.push(`Codes found: \`${details.totalCodes}\``);
  }
  lines.push(`${SEP}`);

  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(lines.join("\n"));
}

// ── Pull Live Progress (Validate Phase) ──────────────────────

function pullLiveProgressEmbed(fetchResults, validateProgress, { username, startTime } = {}) {
  const totalAccounts = fetchResults.length;
  const workingAccounts = fetchResults.filter((r) => !r.error);
  const failedAccounts = fetchResults.filter((r) => r.error);
  const withCodes = workingAccounts.filter((r) => r.codes.length > 0);
  const noCodes = workingAccounts.filter((r) => r.codes.length === 0);
  const totalCodesFetched = fetchResults.reduce((sum, r) => sum + r.codes.length, 0);

  const pct = validateProgress.total === 0 ? 0 : Math.round((validateProgress.done / validateProgress.total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);

  const valid = validateProgress.valid || 0;
  const used = validateProgress.used || 0;
  const balance = validateProgress.balance || 0;
  const expired = validateProgress.expired || 0;
  const regionLocked = validateProgress.regionLocked || 0;
  const invalid = validateProgress.invalid || 0;

  const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "...";

  const lines = [
    `${SEP}`,
    `**Validating Codes**`,
    `\`${bar}\` **${pct}%**`,
    `${SEP_THIN}`,
    ``,
    `\u2502 **Account Analysis**`,
    `\u2502`,
    `\u2502 Total Accounts     \`${totalAccounts}\``,
    `\u2502 Working            \`${workingAccounts.length}\``,
    `\u2502   \u2514 With Codes     \`${withCodes.length}\``,
    `\u2502   \u2514 No Codes       \`${noCodes.length}\``,
    `\u2502 Failed             \`${failedAccounts.length}\``,
    `\u2502`,
    `\u2502 **Codes Found**    \`${totalCodesFetched}\``,
    `\u2502   \u2514 Working        \`${valid}\``,
    `\u2502   \u2514 Claimed        \`${used}\``,
    `\u2502   \u2514 Balance        \`${balance}\``,
  ];

  if (expired > 0) lines.push(`\u2502   \u2514 Expired        \`${expired}\``);
  if (regionLocked > 0) lines.push(`\u2502   \u2514 Region Locked  \`${regionLocked}\``);
  if (invalid > 0) lines.push(`\u2502   \u2514 Invalid        \`${invalid}\``);

  lines.push(``, `${SEP_THIN}`, `**Time:** ${elapsed}s`, `${SEP}`);

  const embed = header({ thumbnail: false }).setColor(COLORS.INFO).setDescription(lines.join("\n"));

  if (username) {
    embed.setFooter({ text: `Pulled by ${username} \u2502 ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
}

// ── Pull Results (Final) ─────────────────────────────────────

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
    `${SEP}`,
    `**Fetching Complete!**`,
    `${SEP_THIN}`,
    ``,
    `\u2502 **Account Analysis**`,
    `\u2502`,
    `\u2502 Total Accounts     \`${totalAccounts}\``,
    `\u2502 Working            \`${workingAccounts.length}\``,
    `\u2502   \u2514 With Codes     \`${withCodes.length}\``,
    `\u2502   \u2514 No Codes       \`${noCodes.length}\``,
    `\u2502 Failed             \`${failedAccounts.length}\``,
    `\u2502`,
    `\u2502 **Codes Found**    \`${totalCodesFetched}\``,
    `\u2502   \u2514 Working        \`${valid.length}\``,
    `\u2502   \u2514 Claimed        \`${used.length}\``,
    `\u2502   \u2514 Balance        \`${balance.length}\``,
  ];

  if (expired.length > 0) lines.push(`\u2502   \u2514 Expired        \`${expired.length}\``);
  if (regionLocked.length > 0) lines.push(`\u2502   \u2514 Region Locked  \`${regionLocked.length}\``);
  if (invalid.length > 0) lines.push(`\u2502   \u2514 Invalid        \`${invalid.length}\``);

  lines.push(`\u2502`, `\u2502 Links Found        \`${totalCodesFetched}\``);

  if (elapsed) {
    lines.push(``, `${SEP_THIN}`, `**Time:** ${elapsed}s`);
  }
  lines.push(`${SEP}`);

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));

  if (dmSent) {
    embed.addFields({ name: "\u200b", value: "```\n>> Results sent to your DMs\n```", inline: false });
  }

  if (username) {
    embed.setFooter({ text: `Pulled by ${username} \u2502 ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
}

// ── Purchase ─────────────────────────────────────────────────

function purchaseProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);

  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription([
      `${SEP}`,
      `**Purchasing**`,
      `${SEP_THIN}`,
      ``,
      `Product: \`${details.product}\``,
      `Price: \`${details.price}\``,
      ``,
      `\`${bar}\` **${pct}%**`,
      `\`${details.done}\` / \`${details.total}\` accounts`,
      details.status ? `\nStatus: \`${details.status}\`` : "",
      `${SEP}`,
    ].join("\n"));
}

function purchaseResultsEmbed(results, productTitle, price) {
  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  const lines = [
    `${SEP}`,
    `**Purchase Results**`,
    `${SEP_THIN}`,
    ``,
    `\u2502 Product      \`${productTitle}\``,
    `\u2502 Price        \`${price}\``,
    `\u2502`,
    `\u2502 Purchased    \`${success.length}\``,
    `\u2502 Failed       \`${failed.length}\``,
    ``,
    `${SEP_THIN}`,
    `\u2502 Total        \`${results.length}\``,
    `${SEP}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));
}

function productSearchEmbed(results) {
  const lines = [
    `${SEP}`,
    `**Search Results**`,
    `${SEP_THIN}`,
    ``,
    ...results.map((r, i) =>
      `\`${i + 1}.\` **${r.title}**\n    \`${r.productId || "N/A"}\` \u2502 ${r.type || "N/A"}`
    ),
    ``,
    `${SEP}`,
  ];

  return header()
    .setColor(COLORS.INFO)
    .setDescription(lines.join("\n") || "No results found.");
}

// ── Changer / Checker ────────────────────────────────────────

function changerResultsEmbed(results) {
  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  const lines = [
    `${SEP}`,
    `**Changer Results**`,
    `${SEP_THIN}`,
    ``,
    `\u2502 Changed      \`${success.length}\``,
    `\u2502 Failed       \`${failed.length}\``,
    ``,
    `${SEP_THIN}`,
    `\u2502 Total        \`${results.length}\``,
    `${SEP}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));
}

function accountCheckerResultsEmbed(results) {
  const valid = results.filter((r) => r.status === "valid").length;
  const locked = results.filter((r) => r.status === "locked").length;
  const invalid = results.filter((r) => r.status === "invalid").length;
  const rateLimited = results.filter((r) => r.status === "rate_limited").length;
  const errors = results.filter((r) => r.status === "error").length;

  const lines = [
    `${SEP}`,
    `**Account Checker**`,
    `${SEP_THIN}`,
    ``,
    `\u2502 Valid        \`${valid}\``,
    `\u2502 Locked       \`${locked}\``,
    `\u2502 Invalid      \`${invalid}\``,
    `\u2502 Rate Limited \`${rateLimited}\``,
    `\u2502 Errors       \`${errors}\``,
    ``,
    `${SEP_THIN}`,
    `\u2502 Total        \`${results.length}\``,
    `${SEP}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));
}

// ── Rewards ──────────────────────────────────────────────────

function rewardsResultsEmbed(results) {
  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const totalPoints = success.reduce((sum, r) => sum + r.balance, 0);

  const lines = [
    `${SEP}`,
    `**Rewards Balance**`,
    `${SEP_THIN}`,
    ``,
    `\u2502 Checked      \`${results.length}\``,
    `\u2502 Successful   \`${success.length}\``,
    `\u2502 Failed       \`${failed.length}\``,
    `\u2502`,
    `\u2502 **Points**`,
    `\u2502 Total        \`${totalPoints.toLocaleString()}\``,
    `\u2502 Average      \`${success.length > 0 ? Math.round(totalPoints / success.length).toLocaleString() : 0}\``,
  ];

  if (success.length > 0) {
    const highest = success.reduce((max, r) => r.balance > max.balance ? r : max);
    lines.push(`\u2502 Highest      \`${highest.balance.toLocaleString()}\` (${highest.email.split("@")[0]}...)`);
  }

  lines.push(``, `${SEP}`);

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));
}

// ── Generic ──────────────────────────────────────────────────

function errorEmbed(message) {
  return header({ thumbnail: false }).setColor(COLORS.ERROR).setDescription(`${SEP}\n**Error**\n${SEP_THIN}\n\n${message}\n\n${SEP}`);
}

function successEmbed(message) {
  return header({ thumbnail: false }).setColor(COLORS.SUCCESS).setDescription(`${SEP}\n**Success**\n${SEP_THIN}\n\n${message}\n\n${SEP}`);
}

function infoEmbed(title, description) {
  return header({ thumbnail: false }).setColor(COLORS.INFO).setDescription(`${SEP}\n**${title}**\n${SEP_THIN}\n\n${description}\n\n${SEP}`);
}

function ownerOnlyEmbed(featureName) {
  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription([
      `${SEP}`,
      `**${featureName}**`,
      `${SEP_THIN}`,
      ``,
      `Currently in a closed development phase.`,
      `Exclusively available to **TalkNeon** during testing.`,
      ``,
      `Access will be rolled out once the module has been`,
      `fully validated and stabilized.`,
      ``,
      `${SEP}`,
    ].join("\n"));
}

function authListEmbed(entries) {
  if (entries.length === 0) {
    return header().setColor(COLORS.MUTED).setDescription(`${SEP}\n**Authorized Users**\n${SEP_THIN}\n\nNo authorized users.\n\n${SEP}`);
  }

  const lines = entries.map((e, i) => {
    const expiry = e.expiresAt === "Infinity" ? "Permanent" : `<t:${Math.floor(e.expiresAt / 1000)}:R>`;
    return `\`${i + 1}.\` <@${e.userId}> \u2014 ${expiry}`;
  });

  return header()
    .setColor(COLORS.INFO)
    .setDescription([`${SEP}`, `**Authorized Users**`, `${SEP_THIN}`, ``, ...lines, ``, `${SEP}`].join("\n"));
}

// ── Help System — Category Select Menu ──────────────────────

const HELP_CATEGORIES = {
  checker: {
    label: "Checker",
    description: "Check codes against WLID tokens",
    content: (p) => [
      `${SEP}`,
      `**Checker**`,
      `${SEP_THIN}`,
      ``,
      `\`${p}check [wlids]\` + attach codes.txt`,
      `Check codes against WLID tokens.`,
      `Uses stored WLIDs if none provided.`,
      ``,
      `All results sent to your DMs.`,
      ``,
      `${SEP}`,
    ].join("\n"),
  },
  claimer: {
    label: "Claimer",
    description: "Claim WLID tokens from accounts",
    content: (p) => [
      `${SEP}`,
      `**Claimer**`,
      `${SEP_THIN}`,
      ``,
      `\`${p}claim <email:pass>\` or attach .txt`,
      `Extract WLID tokens from Microsoft accounts.`,
      ``,
      `All results sent to your DMs.`,
      ``,
      `${SEP}`,
    ].join("\n"),
  },
  puller: {
    label: "Puller",
    description: "Fetch & validate Game Pass codes",
    content: (p) => [
      `${SEP}`,
      `**Puller**`,
      `${SEP_THIN}`,
      ``,
      `\`${p}pull <email:pass>\` or attach .txt`,
      `Fetches codes from Game Pass accounts,`,
      `then validates them automatically.`,
      ``,
      `All results sent to your DMs.`,
      ``,
      `${SEP}`,
    ].join("\n"),
  },
  rewards: {
    label: "Rewards",
    description: "Check Microsoft Rewards balances",
    content: (p) => [
      `${SEP}`,
      `**Rewards**`,
      `${SEP_THIN}`,
      ``,
      `\`${p}rewards <email:pass>\` or attach .txt`,
      `Check Rewards point balances for accounts.`,
      `Shows balance, lifetime points, and level.`,
      ``,
      `All results sent to your DMs.`,
      ``,
      `${SEP}`,
    ].join("\n"),
  },
  purchaser: {
    label: "Purchaser",
    description: "Buy from Microsoft Store [Owner]",
    content: (p) => [
      `${SEP}`,
      `**Purchaser** \u2502 Owner Only`,
      `${SEP_THIN}`,
      ``,
      `\`${p}purchase <email:pass> <product_id>\``,
      `Buy items from the Microsoft Store.`,
      ``,
      `\`${p}search <query>\``,
      `Search for products.`,
      ``,
      `All results sent to your DMs.`,
      ``,
      `${SEP}`,
    ].join("\n"),
  },
  changer: {
    label: "Changer",
    description: "Change passwords & check accounts [Owner]",
    content: (p) => [
      `${SEP}`,
      `**Changer** \u2502 Owner Only`,
      `${SEP_THIN}`,
      ``,
      `\`${p}changer <email:pass> <new_password>\``,
      `Change password on Microsoft accounts.`,
      ``,
      `\`${p}checker <email:pass>\` or attach .txt`,
      `Validate account credentials.`,
      ``,
      `All results sent to your DMs.`,
      ``,
      `${SEP}`,
    ].join("\n"),
  },
  recovery: {
    label: "Recovery",
    description: "Recover accounts via ACSR",
    content: (p) => [
      `${SEP}`,
      `**Recovery**`,
      `${SEP_THIN}`,
      ``,
      `\`${p}recover <email(s)> <new_password>\``,
      `Recover account(s) via ACSR.`,
      ``,
      `\`${p}captcha <solution>\``,
      `Submit CAPTCHA solution for active recovery.`,
      ``,
      `All results sent to your DMs.`,
      ``,
      `${SEP}`,
    ].join("\n"),
  },
  admin: {
    label: "Admin",
    description: "Authorization, blacklist & settings [Owner]",
    content: (p) => [
      `${SEP}`,
      `**Admin** \u2502 Owner Only`,
      `${SEP_THIN}`,
      ``,
      `**WLID Storage**`,
      `\`${p}wlidset <tokens>\` or attach .txt`,
      ``,
      `**Authorization**`,
      `\`${p}auth <@user> <duration>\``,
      `\`${p}deauth <@user>\``,
      `\`${p}authlist\``,
      ``,
      `**Blacklist**`,
      `\`${p}blacklist <@user> [reason]\``,
      `\`${p}unblacklist <@user>\``,
      `\`${p}blacklistshow\``,
      ``,
      `**Tools**`,
      `\`${p}admin\` \u2502 \`${p}setwebhook <url>\` \u2502 \`${p}botstats\``,
      `\`${p}stats\``,
      ``,
      `${SEP}`,
    ].join("\n"),
  },
};

function helpOverviewEmbed(prefix) {
  const catList = Object.entries(HELP_CATEGORIES).map(([, cat]) =>
    `\u2502 **${cat.label}** \u2014 ${cat.description}`
  );

  const lines = [
    `${SEP}`,
    `**Command Reference**`,
    `${SEP_THIN}`,
    ``,
    `Select a category below to view commands.`,
    `All results are sent to your DMs automatically.`,
    ``,
    ...catList,
    ``,
    `${SEP}`,
  ];

  return header({ banner: true })
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));
}

function helpCategoryEmbed(categoryKey, prefix) {
  const cat = HELP_CATEGORIES[categoryKey];
  if (!cat) return errorEmbed("Unknown category.");

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(cat.content(prefix));
}

function helpSelectMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("help_category")
      .setPlaceholder("Select a category...")
      .addOptions(
        Object.entries(HELP_CATEGORIES).map(([key, cat]) => ({
          label: cat.label,
          description: cat.description,
          value: key,
        }))
      )
  );
}

// ── Welcome Embed ────────────────────────────────────────────

function welcomeEmbed(username) {
  const lines = [
    `${SEP}`,
    `**Welcome, ${username}**`,
    `${SEP_THIN}`,
    ``,
    `You now have access to AutizMens.`,
    ``,
    `\u2502 **Quick Start**`,
    `\u2502`,
    `\u2502 \`.help\` \u2014 View all commands`,
    `\u2502 \`.pull\` \u2014 Fetch & validate codes`,
    `\u2502 \`.check\` \u2014 Check codes`,
    `\u2502 \`.rewards\` \u2014 Check point balances`,
    `\u2502`,
    `\u2502 All results are sent to your DMs.`,
    `\u2502 Attach a \`.txt\` file for bulk operations.`,
    ``,
    `${SEP_THIN}`,
    `Type \`.help\` to get started.`,
    `${SEP}`,
  ];

  return header({ banner: true })
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));
}

// ── Admin Panels ─────────────────────────────────────────────

function adminPanelEmbed(stats, authCount, activeOtpSessions, activeProcesses, webhookSet) {
  const lines = [
    `${SEP}`,
    `**Admin Control Panel**`,
    `${SEP_THIN}`,
    ``,
    `\u2502 **Users**`,
    `\u2502 Authorized   \`${authCount}\``,
    `\u2502 OTP Sessions \`${activeOtpSessions}\``,
    `\u2502 Active       \`${activeProcesses}\``,
    `\u2502`,
    `\u2502 **Processing**`,
    `\u2502 Total        \`${stats.total_processed}\``,
    `\u2502 Success      \`${stats.total_success}\``,
    `\u2502 Failed       \`${stats.total_failed}\``,
    `\u2502`,
    `\u2502 **Status**`,
    `\u2502 Bot          \`Online\``,
    `\u2502 Webhook      \`${webhookSet ? "Set" : "Not Set"}\``,
    ``,
    `${SEP}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));
}

function detailedStatsEmbed(stats, topUsers) {
  const rate = stats.total_processed > 0
    ? Math.round((stats.total_success / stats.total_processed) * 100)
    : 0;

  const topText = topUsers.length > 0
    ? topUsers.map(([uid, d]) => `\u2502 <@${uid}> \u2014 ${d.processed} (${d.success} success)`).join("\n")
    : "\u2502 No data";

  const lines = [
    `${SEP}`,
    `**Detailed Statistics**`,
    `${SEP_THIN}`,
    ``,
    `\u2502 Processed    \`${stats.total_processed}\``,
    `\u2502 Success      \`${stats.total_success}\``,
    `\u2502 Failed       \`${stats.total_failed}\``,
    `\u2502 Rate         \`${rate}%\``,
    ``,
    `${SEP_THIN}`,
    `\u2502 **Top Users**`,
    topText,
    ``,
    `${SEP}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));
}

// ── Utilities ────────────────────────────────────────────────

function textAttachment(lines, filename) {
  const buffer = Buffer.from(lines.join("\n"), "utf-8");
  return new AttachmentBuilder(buffer, { name: filename });
}

function recoverProgressEmbed(email, status) {
  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription([
      `${SEP}`,
      `**Account Recovery**`,
      `${SEP_THIN}`,
      ``,
      `Account: \`${email}\``,
      ``,
      status,
      ``,
      `${SEP}`,
    ].join("\n"));
}

function recoverResultEmbed(email, success, message) {
  return header()
    .setColor(success ? COLORS.SUCCESS : COLORS.ERROR)
    .setDescription([
      `${SEP}`,
      `**${success ? "Recovery Successful" : "Recovery Failed"}**`,
      `${SEP_THIN}`,
      ``,
      `Account: \`${email}\``,
      ``,
      message || (success ? "Password has been reset." : "Recovery failed."),
      ``,
      `${SEP}`,
    ].join("\n"));
}

module.exports = {
  progressEmbed,
  checkResultsEmbed,
  claimResultsEmbed,
  pullFetchProgressEmbed,
  pullLiveProgressEmbed,
  pullResultsEmbed,
  purchaseProgressEmbed,
  purchaseResultsEmbed,
  productSearchEmbed,
  changerResultsEmbed,
  accountCheckerResultsEmbed,
  rewardsResultsEmbed,
  errorEmbed,
  successEmbed,
  infoEmbed,
  ownerOnlyEmbed,
  authListEmbed,
  helpOverviewEmbed,
  helpCategoryEmbed,
  helpSelectMenu,
  welcomeEmbed,
  adminPanelEmbed,
  detailedStatsEmbed,
  textAttachment,
  recoverProgressEmbed,
  recoverResultEmbed,
};
