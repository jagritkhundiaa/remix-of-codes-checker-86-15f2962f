// ============================================================
//  Embed builders — monochrome, premium, no emojis
//  Uses code blocks for cross-platform consistency (PC + mobile)
// ============================================================

const { EmbedBuilder, AttachmentBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
const { COLORS, THUMBNAIL_URL, BANNER_URL } = require("../config");

const FOOTER_TEXT = "AutizMens | TalkNeon";

// ── Puller-specific animated emojis (exact IDs from spec) ────
const PULLER_EMOJI = {
  loading: "<a:Loading:1473740101367500918>",
  working: "<a:Working:1473738927251914919>",
  failed:  "<a:Failed:1473739301291561021>",
  codes:   "<a:Codes:1473739526861226248>",
  money:   "<a:Money2:1473744817270952161>",
  claimed: "<:Claimed:1473747602708107525>",
};

// ── Reusable unicode glyphs for the rest of the bot ──────────
// (no random clutter — only meaningful, classy markers)
const UI = {
  // status
  ok:    "✅",
  fail:  "❌",
  warn:  "⚠️",
  info:  "🔹",
  // counters
  bullet:"•",
  sub:   "└",
  // categories
  user:  "👤",
  lock:  "🔒",
  key:   "🔑",
  star:  "⭐",
  card:  "💳",
  coin:  "🪙",
  gift:  "🎁",
  link:  "🔗",
  mail:  "📬",
  shield:"🛡️",
  shop:  "🛒",
  refund:"💸",
  // meta
  time:  "⏱️",
  bolt:  "⚡",
  flag:  "🏁",
  search:"🔍",
  spark: "✨",
};

function _fmtFooter(prefix, username) {
  const d = new Date();
  const date = d.toLocaleDateString("en-GB");
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${prefix} ${username || "user"}. | ${date}, ${time}`;
}

function _fmtPullerFooter(username) {
  return _fmtFooter("Pulled by", username);
}

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

/**
 * Pad a label to a fixed width for monospace alignment inside code blocks.
 */
function pad(label, width = 16) {
  return label.padEnd(width);
}

// ── Progress ─────────────────────────────────────────────────

function progressEmbed(completed, total, label = "Processing") {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const barLen = 18;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);

  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription([
      `**${label}...**`,
      `\`${bar}\` **${pct}%**`,
      `${UI.bullet} ${completed.toLocaleString()} / ${total.toLocaleString()}`,
    ].join("\n"));
}

// ── Check Results ────────────────────────────────────────────

function checkResultsEmbed(results) {
  const valid = results.filter((r) => r.status === "valid").length;
  const used = results.filter((r) => r.status === "used").length;
  const expired = results.filter((r) => r.status === "expired").length;
  const invalid = results.filter((r) => r.status === "invalid" || r.status === "error").length;

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription([
      `**Check Results**`,
      `${UI.bullet} ${UI.ok} **Valid:** ${valid}`,
      `${UI.bullet} ${UI.coin} **Claimed:** ${used}`,
      `${UI.bullet} ${UI.warn} **Expired:** ${expired}`,
      `${UI.bullet} ${UI.fail} **Invalid:** ${invalid}`,
      ``,
      `${UI.flag} **Total:** ${results.length}`,
    ].join("\n"));
}

// ── Claim Results ────────────────────────────────────────────

function claimResultsEmbed(results) {
  const success = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription([
      `**Claim Results**`,
      `${UI.bullet} ${UI.ok} **Success:** ${success}`,
      `${UI.bullet} ${UI.fail} **Failed:** ${failed}`,
      ``,
      `${UI.flag} **Total:** ${results.length}`,
    ].join("\n"));
}

// ── Pull Progress (Fetch Phase) — matches screenshot 1:1 ─────

function pullFetchProgressEmbed(details) {
  const E = PULLER_EMOJI;
  const total = details.total || 0;
  const working = details.working || 0;
  const failed = details.failed || 0;
  const withCodes = details.withCodes || 0;
  const noCodes = details.noCodes || 0;
  const totalCodes = details.totalCodes || 0;
  const elapsed = details.startTime ? ((Date.now() - details.startTime) / 1000).toFixed(1) : "0.0";

  const lines = [
    `**Fetching Codes...**`,
    `${E.loading} **Account Analysis:**`,
    `• **Total Accounts:** ${total}`,
    `• ${E.working} **Working Accounts:** ${working}`,
    `  └ With Codes: ${withCodes}`,
    `  └ No Codes: ${noCodes}`,
    `• ${E.failed} **Failed Accounts:** ${failed}`,
    `• ${E.codes} **Codes Found:** ${totalCodes}`,
    ``,
    `:stopwatch: **Time:** ${elapsed}s`,
  ];

  const embed = header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(lines.join("\n"));

  if (details.username) {
    embed.setFooter({ text: _fmtPullerFooter(details.username) });
  }
  return embed;
}

// ── Pull Live Progress (Validate Phase) — matches screenshot ─

function pullLiveProgressEmbed(fetchResults, validateProgress, { username, startTime } = {}) {
  const E = PULLER_EMOJI;
  const totalAccounts = fetchResults.length;
  const workingAccounts = fetchResults.filter((r) => !r.error);
  const failedAccounts = fetchResults.filter((r) => r.error);
  const withCodes = workingAccounts.filter((r) => r.codes.length > 0);
  const noCodes = workingAccounts.filter((r) => r.codes.length === 0);
  const totalCodesFetched = fetchResults.reduce((sum, r) => sum + r.codes.length, 0);

  const valid = validateProgress.valid || 0;
  const used = validateProgress.used || 0;
  const balance = validateProgress.balance || 0;

  const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "0.0";

  const lines = [
    `**Validating Codes...**`,
    `${E.loading} **Account Analysis:**`,
    `• **Total Accounts:** ${totalAccounts}`,
    `• ${E.working} **Working Accounts:** ${workingAccounts.length}`,
    `  └ With Codes: ${withCodes.length}`,
    `  └ No Codes: ${noCodes.length}`,
    `• ${E.failed} **Failed Accounts:** ${failedAccounts.length}`,
    `• ${E.codes} **Codes Found:** ${totalCodesFetched}`,
    `  └ Working: ${valid}`,
    `  └ ${E.claimed} Claimed: ${used}`,
    `  └ ${E.money} Balance: ${balance}`,
    ``,
    `:stopwatch: **Time:** ${elapsed}s`,
  ];

  const embed = header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(lines.join("\n"));

  if (username) {
    embed.setFooter({ text: _fmtPullerFooter(username) });
  }
  return embed;
}

// ── Pull Results (Final) — matches screenshot 1:1 ────────────

function pullResultsEmbed(fetchResults, validateResults, { elapsed, dmSent, username } = {}) {
  const E = PULLER_EMOJI;
  const totalAccounts = fetchResults.length;
  const workingAccounts = fetchResults.filter((r) => !r.error);
  const failedAccounts = fetchResults.filter((r) => r.error);
  const withCodes = workingAccounts.filter((r) => r.codes.length > 0);
  const noCodes = workingAccounts.filter((r) => r.codes.length === 0);
  const totalCodesFetched = fetchResults.reduce((sum, r) => sum + r.codes.length, 0);

  const valid = validateResults.filter((r) => r.status === "valid").length;
  const used = validateResults.filter((r) => r.status === "used" || r.status === "REDEEMED").length;
  const balance = validateResults.filter((r) => r.status === "BALANCE_CODE").length;

  const lines = [
    `**Fetching Complete!**`,
    `${E.loading} **Account Analysis:**`,
    `• **Total Accounts:** ${totalAccounts}`,
    `• ${E.working} **Working Accounts:** ${workingAccounts.length}`,
    `  └ With Codes: ${withCodes.length}`,
    `  └ No Codes: ${noCodes.length}`,
    `• ${E.failed} **Failed Accounts:** ${failedAccounts.length}`,
    `• ${E.codes} **Codes Found:** ${totalCodesFetched}`,
    `  └ Working: ${valid}`,
    `  └ ${E.claimed} Claimed: ${used}`,
    `  └ ${E.money} Balance: ${balance}`,
    ``,
    `:stopwatch: **Time:** ${elapsed || "0.0"}s`,
  ];

  if (dmSent) {
    lines.push("", "> » Codes sent to your DMs");
  }

  const embed = header({ thumbnail: false })
    .setColor(COLORS.PRIMARY)
    .setDescription(lines.join("\n"));

  embed.setFooter({ text: _fmtPullerFooter(username) });
  return embed;
}

function promoPullerFetchProgressEmbed(details) {
  const E = PULLER_EMOJI;
  const total = details.total || 0;
  const working = details.working || 0;
  const failed = details.failed || 0;
  const withLinks = details.withLinks || 0;
  const noLinks = details.noLinks || 0;
  const totalLinks = details.totalLinks || 0;
  const elapsed = details.startTime ? ((Date.now() - details.startTime) / 1000).toFixed(1) : "0.0";

  const lines = [
    `**Fetching Promo Links...**`,
    `${E.loading} **Account Analysis:**`,
    `${UI.bullet} **Total Accounts:** ${total}`,
    `${UI.bullet} ${E.working} **Working Accounts:** ${working}`,
    `  ${UI.sub} With Links: ${withLinks}`,
    `  ${UI.sub} No Links: ${noLinks}`,
    `${UI.bullet} ${E.failed} **Failed Accounts:** ${failed}`,
    `${UI.bullet} ${UI.link} **Links Found:** ${totalLinks}`,
    ``,
    `${UI.time} **Time:** ${elapsed}s`,
  ];

  const embed = header({ thumbnail: false }).setColor(COLORS.INFO).setDescription(lines.join("\n"));
  if (details.username) embed.setFooter({ text: _fmtPullerFooter(details.username) });
  return embed;
}

function promoPullerResultsEmbed(fetchResults, allLinks, { elapsed, dmSent, username } = {}) {
  const E = PULLER_EMOJI;
  const totalAccounts = fetchResults.length;
  const workingAccounts = fetchResults.filter((r) => !r.error);
  const failedAccounts = fetchResults.filter((r) => r.error);
  const withLinks = workingAccounts.filter((r) => r.links.length > 0);
  const noLinks = workingAccounts.filter((r) => r.links.length === 0);
  const totalLinkCount = allLinks.length;
  const uniqueLinks = [...new Set(allLinks)];

  const lines = [
    `**Promo Puller Complete!**`,
    `${E.loading} **Account Analysis:**`,
    `${UI.bullet} **Total Accounts:** ${totalAccounts}`,
    `${UI.bullet} ${E.working} **Working Accounts:** ${workingAccounts.length}`,
    `  ${UI.sub} With Links: ${withLinks.length}`,
    `  ${UI.sub} No Links: ${noLinks.length}`,
    `${UI.bullet} ${E.failed} **Failed Accounts:** ${failedAccounts.length}`,
    `${UI.bullet} ${UI.link} **Links Found:** ${totalLinkCount}`,
    `  ${UI.sub} ${UI.spark} Unique: ${uniqueLinks.length}`,
    ``,
    `${UI.time} **Time:** ${elapsed || "0.0"}s`,
  ];

  if (dmSent) lines.push("", "> » Links sent to your DMs");

  const embed = header({ thumbnail: false }).setColor(COLORS.PRIMARY).setDescription(lines.join("\n"));
  embed.setFooter({ text: _fmtPullerFooter(username) });
  return embed;
}


function purchaseProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const barLen = 18;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);

  const stepLabels = { login: "Logging in", cart: "Loading cart", purchase: "Purchasing", result: "Done" };
  const stepIdx   = { login: 1, cart: 2, purchase: 3, result: 4 };

  const lines = [
    `**Purchasing...**`,
    `${UI.shop} **Product:** ${details.product}`,
    `${UI.card} **Price:** ${details.price}`,
    ``,
    `\`${bar}\` **${pct}%**`,
    `${UI.bullet} ${details.done} / ${details.total} accounts`,
  ];

  if (details.currentAccount) {
    const idx = stepIdx[details.phase] || "-";
    const label = stepLabels[details.phase] || "Processing";
    lines.push("", `${UI.bolt} **Step ${idx}/4:** ${label}`, `${UI.user} ${details.currentAccount}`);
  }

  if (details.purchased > 0 || details.failed > 0) {
    lines.push("",
      `${UI.bullet} ${UI.ok} **Purchased:** ${details.purchased || 0}`,
      `${UI.bullet} ${UI.fail} **Failed:** ${details.failed || 0}`,
    );
  }

  if (details.lastResult) {
    const icon = details.lastResult.success ? UI.ok : UI.fail;
    const msg = details.lastResult.success
      ? `Order: \`${details.lastResult.orderId || "OK"}\``
      : details.lastResult.error || "Failed";
    lines.push("", `${icon} ${details.lastResult.email}`, `  ${UI.sub} ${msg}`);
  }

  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(lines.join("\n"));
}

function purchaseResultsEmbed(results, productTitle, price) {
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription([
      `**Purchase Results**`,
      `${UI.shop} **Product:** ${productTitle}`,
      `${UI.card} **Price:** ${price}`,
      ``,
      `${UI.bullet} ${UI.ok} **Purchased:** ${success}`,
      `${UI.bullet} ${UI.fail} **Failed:** ${failed}`,
      ``,
      `${UI.flag} **Total:** ${results.length}`,
    ].join("\n"));
}

function productSearchEmbed(results) {
  if (!results || results.length === 0) {
    return header().setColor(COLORS.INFO).setDescription(`${UI.search} **Search Results**\nNo results found.`);
  }
  const lines = [`${UI.search} **Search Results**`, ``];
  results.forEach((r, i) => {
    lines.push(`**${i + 1}.** ${r.title}`);
    lines.push(`  ${UI.sub} \`${r.productId || "N/A"}\` ${UI.bullet} ${r.type || "N/A"}`);
  });
  return header().setColor(COLORS.INFO).setDescription(lines.join("\n"));
}

// ── Changer / Checker ────────────────────────────────────────

function changerResultsEmbed(results) {
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription([
      `**Changer Results**`,
      `${UI.bullet} ${UI.ok} **Changed:** ${success}`,
      `${UI.bullet} ${UI.fail} **Failed:** ${failed}`,
      ``,
      `${UI.flag} **Total:** ${results.length}`,
    ].join("\n"));
}

function accountCheckerResultsEmbed(results) {
  const valid = results.filter((r) => r.status === "valid").length;
  const locked = results.filter((r) => r.status === "locked").length;
  const invalid = results.filter((r) => r.status === "invalid").length;
  const rateLimited = results.filter((r) => r.status === "rate_limited").length;
  const errors = results.filter((r) => r.status === "error").length;

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription([
      `**Account Checker**`,
      `${UI.bullet} ${UI.ok} **Valid:** ${valid}`,
      `${UI.bullet} ${UI.lock} **Locked:** ${locked}`,
      `${UI.bullet} ${UI.fail} **Invalid:** ${invalid}`,
      `${UI.bullet} ${UI.warn} **Rate Limited:** ${rateLimited}`,
      `${UI.bullet} ${UI.warn} **Errors:** ${errors}`,
      ``,
      `${UI.flag} **Total:** ${results.length}`,
    ].join("\n"));
}

// ── Rewards ──────────────────────────────────────────────────

function rewardsResultsEmbed(results) {
  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const totalPoints = success.reduce((sum, r) => sum + r.balance, 0);
  const avg = success.length > 0 ? Math.round(totalPoints / success.length).toLocaleString() : "0";

  const lines = [
    `**Rewards Balance**`,
    `${UI.bullet} ${UI.ok} **Checked:** ${results.length}`,
    `${UI.bullet} ${UI.star} **Successful:** ${success.length}`,
    `${UI.bullet} ${UI.fail} **Failed:** ${failed.length}`,
    ``,
    `${UI.coin} **Points**`,
    `${UI.bullet} **Total:** ${totalPoints.toLocaleString()}`,
    `${UI.bullet} **Average:** ${avg}`,
  ];

  if (success.length > 0) {
    const highest = success.reduce((max, r) => r.balance > max.balance ? r : max);
    lines.push(`${UI.bullet} ${UI.spark} **Highest:** ${highest.balance.toLocaleString()} (${highest.email.split("@")[0]}…)`);
  }

  return header().setColor(COLORS.PRIMARY).setDescription(lines.join("\n"));
}

// ── Generic ──────────────────────────────────────────────────

function errorEmbed(message) {
  return header({ thumbnail: false })
    .setColor(COLORS.ERROR)
    .setDescription(`${UI.fail} **Error**\n${message}`);
}

function successEmbed(message) {
  return header({ thumbnail: false })
    .setColor(COLORS.SUCCESS)
    .setDescription(`${UI.ok} **Success**\n${message}`);
}

function infoEmbed(title, description) {
  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(`${UI.info} **${title}**\n${description}`);
}

function ownerOnlyEmbed(featureName) {
  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription([
      `${UI.lock} **${featureName}**`,
      ``,
      `Currently in a closed development phase.`,
      `Exclusively available to **TalkNeon** during testing.`,
      ``,
      `Access will be rolled out once the module has`,
      `been fully validated and stabilized.`,
    ].join("\n"));
}

function authListEmbed(entries) {
  if (entries.length === 0) {
    return header().setColor(COLORS.MUTED).setDescription("```\nAuthorized Users\n----------------------------\n\nNo authorized users.\n```");
  }

  const lines = entries.map((e, i) => {
    const expiry = e.expiresAt === "Infinity" ? "Permanent" : `<t:${Math.floor(e.expiresAt / 1000)}:R>`;
    return `\`${i + 1}.\` <@${e.userId}> -- ${expiry}`;
  });

  return header()
    .setColor(COLORS.INFO)
    .setTitle("Authorized Users")
    .setDescription(lines.join("\n"));
}

// ── Help System -- Category Select Menu ─────────────────────

// Section groupings for the help dropdown
const HELP_SECTIONS = {
  core: { label: "-- Core Tools --", categories: ["checker", "claimer", "puller", "promopuller"] },
  account: { label: "-- Account Tools --", categories: ["inbox", "rewards", "refund"] },
  checkers: { label: "-- Checkers --", categories: ["aio"] },
  owner: { label: "-- Owner Only --", categories: ["admin"] },
};

const HELP_CATEGORIES = {
  checker: {
    label: "Checker",
    description: "Check codes against WLID tokens",
    section: "core",
    content: (p) => [
      "Checker",
      "========================================",
      "",
      "  Commands",
      "  ----------------------------------------",
      `  ${p}check [wlids] + attach codes.txt`,
      "    Check codes against WLID tokens.",
      "    Uses stored WLIDs if none provided.",
      "",
      "  Output",
      "  ----------------------------------------",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  claimer: {
    label: "Claimer",
    description: "Claim WLID tokens from accounts",
    section: "core",
    content: (p) => [
      "Claimer",
      "========================================",
      "",
      "  Commands",
      "  ----------------------------------------",
      `  ${p}claim <email:pass> or attach .txt`,
      "    Extract WLID tokens from MS accounts.",
      "",
      "  Output",
      "  ----------------------------------------",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  puller: {
    label: "Puller",
    description: "Fetch & validate Game Pass codes",
    section: "core",
    content: (p) => [
      "Puller",
      "========================================",
      "",
      "  Commands",
      "  ----------------------------------------",
      `  ${p}pull <email:pass> or attach .txt`,
      "    Fetches codes from Game Pass accounts,",
      "    then validates them automatically.",
      "",
      "  Output",
      "  ----------------------------------------",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  promopuller: {
    label: "Promo Puller",
    description: "Pull & validate Discord promo links",
    section: "core",
    content: (p) => [
      "Promo Puller",
      "========================================",
      "",
      "  Commands",
      "  ----------------------------------------",
      `  ${p}promopuller <email:pass> or attach .txt`,
      "  /promopuller <email:pass> or attach .txt",
      "    Pulls Discord promo links from Game",
      "    Pass perks and validates each gift",
      "    code via the Discord API.",
      "",
      "  Notes",
      "  ----------------------------------------",
      "    100 threads, direct connections,",
      "    isolated from the global proxy pool.",
      "    Working hits saved to promos.txt.",
      "",
      "  Output",
      "  ----------------------------------------",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  rewards: {
    label: "Rewards",
    description: "Check Microsoft Rewards balances",
    section: "account",
    content: (p) => [
      "Rewards",
      "========================================",
      "",
      "  Commands",
      "  ----------------------------------------",
      `  ${p}rewards <email:pass> or attach .txt`,
      "    Check Rewards point balances.",
      "    Shows balance, lifetime points, level.",
      "",
      "  Output",
      "  ----------------------------------------",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  refund: {
    label: "Refund",
    description: "Check refund eligibility (14-day)",
    section: "account",
    content: (p) => [
      "Refund Checker",
      "========================================",
      "",
      "  Commands",
      "  ----------------------------------------",
      `  ${p}refund <email:pass> or attach .txt`,
      "    Checks if purchases are within the",
      "    14-day refund window.",
      "",
      "  Output",
      "  ----------------------------------------",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  inbox: {
    label: "Inbox AIO",
    description: "Scan inboxes for 50+ services",
    section: "account",
    content: (p) => [
      "Inbox AIO Scanner",
      "========================================",
      "",
      "  Commands",
      "  ----------------------------------------",
      `  ${p}inboxaio <email:pass> or attach .txt`,
      "    Scans Hotmail/Outlook inboxes for 50+",
      "    services (Netflix, Spotify, PayPal...)",
      "",
      "  Output",
      "  ----------------------------------------",
      "  Results delivered as ZIP with per-",
      "  service folders in your DMs.",
      "",
      "  Notes",
      "  ----------------------------------------",
      "    Controlled concurrency, no skipped hits.",
    ].join("\n"),
  },
  aio: {
    label: "AIO",
    description: "Full Microsoft account analysis",
    section: "checkers",
    content: (p) => [
      "AIO Checker",
      "========================================",
      "",
      "  Commands",
      "  ----------------------------------------",
      `  ${p}aio <email:pass> or attach .txt`,
      "    Full Microsoft account analysis:",
      "    XGP, cards, MFA, bans, Minecraft,",
      "    rewards, and more.",
      "",
      "  Output",
      "  ----------------------------------------",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  admin: {
    label: "Admin",
    description: "Authorization, blacklist & settings [Owner]",
    section: "owner",
    content: (p) => [
      "Admin  [Owner Only]",
      "========================================",
      "",
      "  WLID Storage",
      "  ----------------------------------------",
      `    ${p}wlidset <tokens> or attach .txt`,
      "",
      "  Authorization",
      "  ----------------------------------------",
      `    ${p}auth <@user> <duration>`,
      `    ${p}deauth <@user>`,
      `    ${p}authlist`,
      "",
      "  Blacklist",
      "  ----------------------------------------",
      `    ${p}blacklist <@user> [reason]`,
      `    ${p}unblacklist <@user>`,
      `    ${p}blacklistshow`,
      "",
      "  Tools",
      "  ----------------------------------------",
      `    ${p}admin | ${p}setwebhook <url>`,
      `    ${p}botstats | ${p}stats`,
    ].join("\n"),
  },
};

// ── Gen system embeds (hidden from main help) ─────────────────

function genHelpEmbed(prefix) {
  const block = [
    "Gen System  [Hidden]",
    "========================================",
    "",
    "  User Commands",
    "  ----------------------------------------",
    `  ${prefix}gen <product> <amount>`,
    "    Pull stock items. Users: 1 per request,",
    "    200s cooldown. Admins: 50 per request.",
    "",
    `  ${prefix}stock`,
    "    List all products and stock counts.",
    "",
    "  Stock Management",
    "  ----------------------------------------",
    `  ${prefix}addstock <product> + attach .txt`,
    `  ${prefix}replacegenstock <product> + attach .txt`,
    `  ${prefix}downloadgenstock`,
    "",
    "  Output",
    "  ----------------------------------------",
    "  Items delivered via DM.",
  ];
  return header().setColor(COLORS.PRIMARY).setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);
}

function stockListEmbed(entries) {
  if (entries.length === 0) {
    return header().setColor(COLORS.MUTED).setDescription("```\nStock\n----------------------------\n\nNo products yet. Use .addstock to add some.\n```");
  }
  const lines = ["Stock", "----------------------------", ""];
  for (const e of entries) {
    lines.push(`  ${e.name.padEnd(20)}${e.count}`);
  }
  lines.push("", "----------------------------", `  Total products: ${entries.length}`);
  return header().setColor(COLORS.INFO).setDescription(`\`\`\`\n${lines.join("\n")}\n\`\`\``);
}

function unauthorisedEmbed() {
  return header().setColor(COLORS.WARNING).setDescription("hi unauthorised dude.. reply **milk** to this chat to gain auto access if not wait for owner");
}

function helpOverviewEmbed(prefix) {
  const sectionLines = [];

  for (const [, section] of Object.entries(HELP_SECTIONS)) {
    sectionLines.push(`\n**${section.label}**`);
    for (const catKey of section.categories) {
      const cat = HELP_CATEGORIES[catKey];
      if (cat) {
        sectionLines.push(`  **${cat.label}** -- ${cat.description}`);
      }
    }
  }

  return header({ banner: true })
    .setColor(COLORS.PRIMARY)
    .setTitle("Command Reference")
    .setDescription([
      `Select a category below to view commands.`,
      `All results are sent to your DMs automatically.`,
      ...sectionLines,
    ].join("\n"));
}

function helpCategoryEmbed(categoryKey, prefix) {
  const cat = HELP_CATEGORIES[categoryKey];
  if (!cat) return errorEmbed("Unknown category.");

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${cat.content(prefix)}\n\`\`\``);
}

function helpSelectMenu() {
  const options = [];

  for (const [, section] of Object.entries(HELP_SECTIONS)) {
    for (const catKey of section.categories) {
      const cat = HELP_CATEGORIES[catKey];
      if (cat) {
        options.push({
          label: `${cat.label}`,
          description: `${section.label.replace(/^-- | --$/g, '')} > ${cat.description}`,
          value: catKey,
        });
      }
    }
  }

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("help_category")
      .setPlaceholder("Select a category...")
      .addOptions(options)
  );
}

// ── Welcome Embed ────────────────────────────────────────────

function welcomeEmbed(username) {
  const block = [
    `Welcome, ${username}`,
    "----------------------------",
    "",
    "  You now have access to AutizMens.",
    "",
    "  Quick Start",
    "    .help      View all commands",
    "    .pull      Fetch & validate codes",
    "    .check     Check codes",
    "    .rewards   Check point balances",
    "",
    "  All results are sent to your DMs.",
    "  Attach a .txt file for bulk operations.",
    "",
    "----------------------------",
    "  Type .help to get started.",
  ];

  return header({ banner: true })
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);
}

// ── Admin Panels ─────────────────────────────────────────────

function adminPanelEmbed(stats, authCount, activeOtpSessions, activeProcesses, webhookSet) {
  const block = [
    "Admin Control Panel",
    "----------------------------",
    "",
    "  Users",
    `  ${pad("Authorized")}${authCount}`,
    `  ${pad("OTP Sessions")}${activeOtpSessions}`,
    `  ${pad("Active")}${activeProcesses}`,
    "",
    "  Processing",
    `  ${pad("Total")}${stats.total_processed}`,
    `  ${pad("Success")}${stats.total_success}`,
    `  ${pad("Failed")}${stats.total_failed}`,
    "",
    "  Status",
    `  ${pad("Bot")}Online`,
    `  ${pad("Webhook")}${webhookSet ? "Set" : "Not Set"}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);
}

function detailedStatsEmbed(stats, topUsers) {
  const rate = stats.total_processed > 0
    ? Math.round((stats.total_success / stats.total_processed) * 100)
    : 0;

  const block = [
    "Detailed Statistics",
    "----------------------------",
    "",
    `  ${pad("Processed")}${stats.total_processed}`,
    `  ${pad("Success")}${stats.total_success}`,
    `  ${pad("Failed")}${stats.total_failed}`,
    `  ${pad("Rate")}${rate}%`,
  ];

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);

  if (topUsers.length > 0) {
    const topText = topUsers.map(([uid, d]) => `<@${uid}> -- ${d.processed} processed (${d.success} success)`).join("\n");
    embed.addFields({ name: "Top Users", value: topText, inline: false });
  }

  return embed;
}

// ── Utilities ────────────────────────────────────────────────

function textAttachment(lines, filename) {
  const buffer = Buffer.from(lines.join("\n"), "utf-8");
  return new AttachmentBuilder(buffer, { name: filename });
}

function recoverProgressEmbed(email, status) {
  const block = [
    "Account Recovery",
    "----------------------------",
    "",
    `  Account: ${email}`,
  ];

  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\`\n${status}`);
}

function recoverResultEmbed(email, success, message) {
  const title = success ? "Recovery Successful" : "Recovery Failed";
  const block = [
    title,
    "----------------------------",
    "",
    `  Account: ${email}`,
  ];

  return header()
    .setColor(success ? COLORS.SUCCESS : COLORS.ERROR)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\`\n${message || (success ? "Password has been reset." : "Recovery failed.")}`);
}

// ── Inbox AIO Embeds ─────────────────────────────────────────

/**
 * Build paginated service fields (20 per page) with clean formatting
 */
function buildServiceFields(serviceBreakdown, labelPrefix = "Services") {
  if (!serviceBreakdown || Object.keys(serviceBreakdown).length === 0) return [];

  const sorted = Object.entries(serviceBreakdown)
    .sort((a, b) => b[1] - a[1]);

  const PAGE_SIZE = 20;
  const pages = [];
  for (let i = 0; i < sorted.length; i += PAGE_SIZE) {
    pages.push(sorted.slice(i, i + PAGE_SIZE));
  }

  return pages.map((page, idx) => {
    const lines = page.map(([svc, count]) => `> **${svc}**: ${count}`);
    const title = pages.length > 1
      ? `${labelPrefix} (${idx + 1})`
      : `${labelPrefix}`;
    return { name: title, value: lines.join("\n"), inline: false };
  });
}

function inboxAioProgressEmbed({ completed, total, hits, fails, elapsed, latestAccount, latestStatus, servicesFound, serviceBreakdown }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const barW = 20;
  const filled = Math.round((pct / 100) * barW);
  const bar = "#".repeat(filled) + "-".repeat(barW - filled);
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((completed / elSec) * 60) : 0;

  const block = [
    `  Progress    [${bar}] ${pct}%`,
    `  ${pad("Processed")}${completed} / ${total}`,
    `  ${pad("Hits")}${hits}`,
    `  ${pad("Failed")}${fails}`,
    `  ${pad("Speed")}${cpm} checks/min`,
    `  ${pad("Elapsed")}${elSec}s`,
  ];

  if (latestAccount) {
    const masked = latestAccount.replace(/(.{3}).*(@.*)/, "$1***$2");
    block.push(`  ${pad("Latest")}${masked} [${latestStatus || "..."}]`);
  }

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);

  const svcFields = buildServiceFields(serviceBreakdown, "Services");
  for (const f of svcFields) embed.addFields(f);

  return embed;
}

function inboxAioResultsEmbed({ total, hits, fails, locked, twoFA, elapsed, serviceBreakdown, dmSent, username }) {
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((total / elSec) * 60) : 0;

  const block = [
    `  ${pad("Checked")}${total}`,
    `  ${pad("Valid")}${hits}`,
    `  ${pad("Invalid")}${fails}`,
    `  ${pad("Locked")}${locked || 0}`,
    `  ${pad("2FA")}${twoFA || 0}`,
    `  ${pad("Speed")}${cpm} checks/min`,
    `  ${pad("Elapsed")}${elSec}s`,
  ];

  if (username) {
    block.push("", `  Requested by ${username}`);
  }

  const embed = header()
    .setColor(hits > 0 ? COLORS.SUCCESS : COLORS.ERROR)
    .setTitle("Inbox AIO  ─  Results")
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);

  const svcFields = buildServiceFields(serviceBreakdown, "Services");
  if (svcFields.length > 0) {
    for (const f of svcFields) embed.addFields(f);
  } else {
    embed.addFields({ name: "Services", value: "No services detected.", inline: false });
  }

  if (dmSent) embed.addFields({ name: "\u200b", value: "Results sent to your DMs.", inline: false });

  return embed;
}

// ── PRS (Rewards Scraper) Embeds ─────────────────────────────

function prsProgressEmbed({ done, total, codesFound, category, working, failed, elapsed, latestAccount, username }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const barW = 20;
  const filled = Math.round((pct / 100) * barW);
  const bar = "#".repeat(filled) + "-".repeat(barW - filled);
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((done / elSec) * 60) : 0;

  const lines = [
    `PRS - ${(category || "All").toUpperCase()} SCRAPER`,
    "----------------------------",
    "",
    `  [${bar}] ${pct}%`,
    `  ${pad("Processed")}${done} / ${total}`,
    `  ${pad("Codes Found")}${codesFound || 0}`,
    "",
    `  ${pad("Working")}${working || 0}`,
    `  ${pad("Failed")}${failed || 0}`,
    `  ${pad("Speed")}${cpm} accts/min`,
    `  ${pad("Elapsed")}${elSec}s`,
  ];

  if (latestAccount) {
    const masked = latestAccount.replace(/(.{3}).*(@.*)/, "$1***$2");
    lines.push(`  ${pad("Latest")}${masked}`);
  }

  const embed = header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(`\`\`\`\n${lines.join("\n")}\n\`\`\``);

  if (username) {
    embed.setFooter({ text: `Scraped by ${username} | ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
}

function prsResultsEmbed({ total, hits, valid, failed, twoFA, codesFound, category, elapsed, categoryBreakdown, username, dmSent }) {
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((total / elSec) * 60) : 0;

  const block = [
    `PRS - ${(category || "All").toUpperCase()} SCRAPER`,
    "----------------------------",
    "",
    `  ${pad("Checked")}${total}`,
    `  ${pad("With Codes")}${hits}`,
    `  ${pad("Valid (empty)")}${valid}`,
    `  ${pad("Failed")}${failed}`,
  ];
  if (twoFA > 0) block.push(`  ${pad("2FA")}${twoFA}`);
  block.push(
    "",
    `  ${pad("Total Codes")}${codesFound}`,
    `  ${pad("Speed")}${cpm} accts/min`,
    `  ${pad("Elapsed")}${elSec}s`,
  );

  if (username) {
    block.push("", `  Requested by ${username}`);
  }

  const embed = header()
    .setColor(codesFound > 0 ? COLORS.SUCCESS : COLORS.ERROR)
    .setTitle("PRS  ─  Results")
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);

  // Category breakdown
  if (categoryBreakdown && Object.keys(categoryBreakdown).length > 0) {
    const sorted = Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]);
    const catLines = sorted.map(([cat, count]) => `> **${cat}**: ${count} codes`);
    embed.addFields({ name: "Categories", value: catLines.join("\n"), inline: false });
  }

  if (dmSent) embed.addFields({ name: "\u200b", value: "Results sent to your DMs.", inline: false });

  return embed;
}

// ── Refund Checker Embeds ─────────────────────────────────────

function refundProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "#".repeat(filled) + "-".repeat(barLen - filled);
  const elapsed = details.startTime ? ((Date.now() - details.startTime) / 1000).toFixed(1) : "...";

  const lines = [
    "Refund Eligibility Check",
    `  [${bar}] ${pct}%`,
    "----------------------------",
    "",
    `  ${pad("Processed")}${details.done} / ${details.total}`,
    `  ${pad("Eligible")}${details.hits || 0}`,
    `  ${pad("Not Eligible")}${details.noRefund || 0}`,
    `  ${pad("Locked/2FA")}${details.locked || 0}`,
    `  ${pad("Failed")}${details.failed || 0}`,
  ];

  if (details.lastAccount) {
    const masked = details.lastAccount.replace(/(.{3}).*(@.*)/, "$1***$2");
    lines.push("", `  ${pad("Latest")}${masked}`);
  }

  lines.push("", "----------------------------", `  Time: ${elapsed}s`);

  const embed = header({ thumbnail: false }).setColor(COLORS.INFO).setDescription(`\`\`\`\n${lines.join("\n")}\n\`\`\``);

  if (details.username) {
    embed.setFooter({ text: `Checked by ${details.username} | ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
}

function refundResultsEmbed(results, { elapsed, dmSent, username } = {}) {
  const hits = results.filter(r => r.status === "hit");
  const noRefund = results.filter(r => r.status === "free");
  const locked = results.filter(r => r.status === "locked");
  const failed = results.filter(r => r.status === "fail");

  const totalRefundable = hits.reduce((sum, r) => sum + (r.refundable?.length || 0), 0);

  const lines = [
    "Refund Eligibility Results",
    "----------------------------",
    "",
    `  ${pad("Total Accounts")}${results.length}`,
    `  ${pad("With Refundable")}${hits.length}`,
    `  ${pad("No Refundable")}${noRefund.length}`,
    `  ${pad("Locked/2FA")}${locked.length}`,
    `  ${pad("Failed")}${failed.length}`,
    "",
    `  ${pad("Total Items")}${totalRefundable}`,
  ];

  if (elapsed) {
    lines.push("", "----------------------------", `  Time: ${elapsed}s`);
  }

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${lines.join("\n")}\n\`\`\``);

  if (dmSent) {
    embed.addFields({ name: "\u200b", value: "```\n>> Results sent to your DMs\n```", inline: false });
  }

  if (username) {
    embed.setFooter({ text: `Checked by ${username} | ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
}


// ── AIO Checker Embeds ───────────────────────────────────────

function aioProgressEmbed(done, total, live = {}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "#".repeat(filled) + "-".repeat(barLen - filled);

  const lines = [
    "Checking Accounts",
    `  [${bar}] ${pct}%`,
    "----------------------------",
    "",
    "  Live Stats",
    "",
    `  ${pad("Checked")}${done}/${total}`,
    `  ${pad("Hits")}${live.hits || 0}`,
    `    > XGP              ${live.xgp || 0}`,
    `    > XGPU             ${live.xgpu || 0}`,
    `    > Cards            ${live.payment_methods || 0}`,
    `  ${pad("2FA")}${live.twofa || 0}`,
    `  ${pad("Valid Mail")}${live.valid_mail || 0}`,
    `  ${pad("Bad")}${live.bad || 0}`,
    "",
    "  Microsoft",
    "",
    `  ${pad("Balance")}${live.ms_balance || 0}`,
    `  ${pad("Points")}${live.ms_points || 0}`,
    "",
    "  Security",
    "",
    `  ${pad("MFA")}${live.mfa || 0}`,
    `  ${pad("SFA")}${live.sfa || 0}`,
    `  ${pad("Banned")}${live.banned || 0}`,
    `  ${pad("Unbanned")}${live.unbanned || 0}`,
    "",
    "----------------------------",
    `  ${pad("CPM")}${live.cpm || 0}`,
    `  ${pad("Errors")}${live.errors || 0}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${lines.join("\n")}\n\`\`\``);
}

function aioResultsEmbed(s, { dmSent, username } = {}) {
  const lines = [
    "Checking Complete!",
    "----------------------------",
    "",
    "  Account Analysis",
    "",
    `  ${pad("Total Checked")}${s.checked || 0}`,
    `  ${pad("Hits")}${s.hits || 0}`,
    `    > XGP              ${s.xgp || 0}`,
    `    > XGPU             ${s.xgpu || 0}`,
    `    > Cards            ${s.payment_methods || 0}`,
    `  ${pad("2FA")}${s.twofa || 0}`,
    `  ${pad("Valid Mail")}${s.valid_mail || 0}`,
    `  ${pad("Bad")}${s.bad || 0}`,
    "",
    "  Microsoft",
    "",
    `  ${pad("Balance")}${s.ms_balance || 0}`,
    `  ${pad("Points")}${s.ms_points || 0}`,
    "",
    "  Security",
    "",
    `  ${pad("MFA")}${s.mfa || 0}`,
    `  ${pad("SFA")}${s.sfa || 0}`,
    `  ${pad("Banned")}${s.banned || 0}`,
    `  ${pad("Unbanned")}${s.unbanned || 0}`,
    "",
    "----------------------------",
    `  ${pad("CPM")}${s.cpm || 0}`,
    `  Time: ${s.elapsed || "?"}`,
  ];

  const embed = header()
    .setColor(s.hits > 0 ? COLORS.SUCCESS : COLORS.ERROR)
    .setDescription(`\`\`\`\n${lines.join("\n")}\n\`\`\``);

  if (dmSent) {
    embed.addFields({ name: "\u200b", value: "```\n>> Results sent to your DMs\n```", inline: false });
  }

  if (username) {
    embed.setFooter({ text: `Checked by ${username} | ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
}

module.exports = {
  progressEmbed,
  checkResultsEmbed,
  claimResultsEmbed,
  pullFetchProgressEmbed,
  pullLiveProgressEmbed,
  pullResultsEmbed,
  promoPullerFetchProgressEmbed,
  promoPullerResultsEmbed,
  purchaseProgressEmbed,
  purchaseResultsEmbed,
  productSearchEmbed,
  changerResultsEmbed,
  accountCheckerResultsEmbed,
  rewardsResultsEmbed,
  prsProgressEmbed,
  prsResultsEmbed,
  refundProgressEmbed,
  refundResultsEmbed,
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
  inboxAioProgressEmbed,
  inboxAioResultsEmbed,
  genHelpEmbed,
  stockListEmbed,
  unauthorisedEmbed,
  aioProgressEmbed,
  aioResultsEmbed,
};
