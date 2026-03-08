// ============================================================
//  Embed builders — monochrome, premium, no emojis
//  Uses code blocks for cross-platform consistency (PC + mobile)
// ============================================================

const { EmbedBuilder, AttachmentBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
const { COLORS, THUMBNAIL_URL, BANNER_URL } = require("../config");

const FOOTER_TEXT = "AutizMens | TalkNeon";

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
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "#".repeat(filled) + "-".repeat(barLen - filled);

  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setTitle(label)
    .setDescription(`\`\`\`\n[${bar}] ${pct}%\n${completed.toLocaleString()} / ${total.toLocaleString()}\n\`\`\``);
}

// ── Check Results ────────────────────────────────────────────

function checkResultsEmbed(results) {
  const valid = results.filter((r) => r.status === "valid").length;
  const used = results.filter((r) => r.status === "used").length;
  const expired = results.filter((r) => r.status === "expired").length;
  const invalid = results.filter((r) => r.status === "invalid" || r.status === "error").length;

  const block = [
    "Check Results",
    "----------------------------",
    "",
    `  ${pad("Valid")}${valid}`,
    `  ${pad("Used")}${used}`,
    `  ${pad("Expired")}${expired}`,
    `  ${pad("Invalid")}${invalid}`,
    "",
    "----------------------------",
    `  ${pad("Total")}${results.length}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);
}

// ── Claim Results ────────────────────────────────────────────

function claimResultsEmbed(results) {
  const success = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  const block = [
    "Claim Results",
    "----------------------------",
    "",
    `  ${pad("Success")}${success}`,
    `  ${pad("Failed")}${failed}`,
    "",
    "----------------------------",
    `  ${pad("Total")}${results.length}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);
}

// ── Pull Progress (Fetch Phase) ──────────────────────────────

function pullFetchProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "#".repeat(filled) + "-".repeat(barLen - filled);

  const working = details.working || 0;
  const failed = details.failed || 0;
  const withCodes = details.withCodes || 0;
  const noCodes = details.noCodes || 0;
  const totalCodes = details.totalCodes || 0;
  const elapsed = details.startTime ? ((Date.now() - details.startTime) / 1000).toFixed(1) : "...";

  const lines = [
    "Fetching Codes",
    `  [${bar}] ${pct}%`,
    "----------------------------",
    "",
    "  Account Analysis",
    "",
    `  ${pad("Total Accounts")}${details.total}`,
    `  ${pad("Processed")}${details.done}`,
    `  ${pad("Working")}${working}`,
    `    > With Codes       ${withCodes}`,
    `    > No Codes         ${noCodes}`,
    `  ${pad("Failed")}${failed}`,
    "",
    `  ${pad("Codes Found")}${totalCodes}`,
  ];

  if (details.lastAccount) {
    const status = details.lastError
      ? `Failed`
      : `${details.lastCodes || 0} codes`;
    lines.push("", `  ${pad("Latest")}${details.lastAccount}`, `  ${pad("Status")}${status}`);
  }

  lines.push("", "----------------------------", `  Time: ${elapsed}s`);

  const embed = header({ thumbnail: false }).setColor(COLORS.INFO).setDescription(`\`\`\`\n${lines.join("\n")}\n\`\`\``);

  if (details.username) {
    embed.setFooter({ text: `Pulled by ${details.username} | ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
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
  const bar = "#".repeat(filled) + "-".repeat(barLen - filled);

  const valid = validateProgress.valid || 0;
  const used = validateProgress.used || 0;
  const balance = validateProgress.balance || 0;
  const expired = validateProgress.expired || 0;
  const regionLocked = validateProgress.regionLocked || 0;
  const invalid = validateProgress.invalid || 0;

  const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "...";

  const lines = [
    "Validating Codes",
    `  [${bar}] ${pct}%`,
    "----------------------------",
    "",
    "  Account Analysis",
    "",
    `  ${pad("Total Accounts")}${totalAccounts}`,
    `  ${pad("Working")}${workingAccounts.length}`,
    `    > With Codes       ${withCodes.length}`,
    `    > No Codes         ${noCodes.length}`,
    `  ${pad("Failed")}${failedAccounts.length}`,
    "",
    `  ${pad("Codes Found")}${totalCodesFetched}`,
    `    > Working           ${valid}`,
    `    > Claimed           ${used}`,
    `    > Balance           ${balance}`,
  ];

  if (expired > 0) lines.push(`    > Expired          ${expired}`);
  if (regionLocked > 0) lines.push(`    > Region Locked    ${regionLocked}`);
  if (invalid > 0) lines.push(`    > Invalid          ${invalid}`);

  lines.push("", "----------------------------", `  Time: ${elapsed}s`);

  const embed = header({ thumbnail: false }).setColor(COLORS.INFO).setDescription(`\`\`\`\n${lines.join("\n")}\n\`\`\``);

  if (username) {
    embed.setFooter({ text: `Pulled by ${username} | ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
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
    "Fetching Complete!",
    "----------------------------",
    "",
    "  Account Analysis",
    "",
    `  ${pad("Total Accounts")}${totalAccounts}`,
    `  ${pad("Working")}${workingAccounts.length}`,
    `    > With Codes       ${withCodes.length}`,
    `    > No Codes         ${noCodes.length}`,
    `  ${pad("Failed")}${failedAccounts.length}`,
    "",
    `  ${pad("Codes Found")}${totalCodesFetched}`,
    `    > Working           ${valid.length}`,
    `    > Claimed           ${used.length}`,
    `    > Balance           ${balance.length}`,
  ];

  if (expired.length > 0) lines.push(`    > Expired          ${expired.length}`);
  if (regionLocked.length > 0) lines.push(`    > Region Locked    ${regionLocked.length}`);
  if (invalid.length > 0) lines.push(`    > Invalid          ${invalid.length}`);

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
    embed.setFooter({ text: `Pulled by ${username} | ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
}

// ── PromoPuller Embeds ───────────────────────────────────────

function promoPullerFetchProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "#".repeat(filled) + "-".repeat(barLen - filled);

  const working = details.working || 0;
  const failed = details.failed || 0;
  const withLinks = details.withLinks || 0;
  const noLinks = details.noLinks || 0;
  const totalLinks = details.totalLinks || 0;
  const elapsed = details.startTime ? ((Date.now() - details.startTime) / 1000).toFixed(1) : "...";

  const lines = [
    "Fetching Links",
    `  [${bar}] ${pct}%`,
    "----------------------------",
    "",
    "  Account Analysis",
    "",
    `  ${pad("Total Accounts")}${details.total}`,
    `  ${pad("Processed")}${details.done}`,
    `  ${pad("Working")}${working}`,
    `    > With Links       ${withLinks}`,
    `    > No Links         ${noLinks}`,
    `  ${pad("Failed")}${failed}`,
    "",
    `  ${pad("Links Found")}${totalLinks}`,
  ];

  if (details.lastAccount) {
    const status = details.lastError
      ? `Failed`
      : `${details.lastLinks || 0} links`;
    lines.push("", `  ${pad("Latest")}${details.lastAccount}`, `  ${pad("Status")}${status}`);
  }

  lines.push("", "----------------------------", `  Time: ${elapsed}s`);

  const embed = header({ thumbnail: false }).setColor(COLORS.INFO).setDescription(`\`\`\`\n${lines.join("\n")}\n\`\`\``);

  if (details.username) {
    embed.setFooter({ text: `Pulled by ${details.username} | ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
}

function promoPullerResultsEmbed(fetchResults, allLinks, { elapsed, dmSent, username } = {}) {
  const totalAccounts = fetchResults.length;
  const workingAccounts = fetchResults.filter((r) => !r.error);
  const failedAccounts = fetchResults.filter((r) => r.error);
  const withLinks = workingAccounts.filter((r) => r.links.length > 0);
  const noLinks = workingAccounts.filter((r) => r.links.length === 0);
  const totalLinkCount = allLinks.length;
  const uniqueLinks = [...new Set(allLinks)];

  const lines = [
    "Promo Puller Complete!",
    "----------------------------",
    "",
    "  Account Analysis",
    "",
    `  ${pad("Total Accounts")}${totalAccounts}`,
    `  ${pad("Working")}${workingAccounts.length}`,
    `    > With Links       ${withLinks.length}`,
    `    > No Links         ${noLinks.length}`,
    `  ${pad("Failed")}${failedAccounts.length}`,
    "",
    `  ${pad("Links Found")}${totalLinkCount}`,
    `  ${pad("Unique Links")}${uniqueLinks.length}`,
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
    embed.setFooter({ text: `Pulled by ${username} | ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
}


function purchaseProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "#".repeat(filled) + "-".repeat(barLen - filled);

  const lines = [
    "Purchasing",
    "----------------------------",
    "",
    `  Product: ${details.product}`,
    `  Price:   ${details.price}`,
    "",
    `  [${bar}] ${pct}%`,
    `  ${details.done} / ${details.total} accounts`,
  ];
  if (details.status) lines.push("", `  Status: ${details.status}`);

  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(`\`\`\`\n${lines.join("\n")}\n\`\`\``);
}

function purchaseResultsEmbed(results, productTitle, price) {
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  const block = [
    "Purchase Results",
    "----------------------------",
    "",
    `  ${pad("Product")}${productTitle}`,
    `  ${pad("Price")}${price}`,
    "",
    `  ${pad("Purchased")}${success}`,
    `  ${pad("Failed")}${failed}`,
    "",
    "----------------------------",
    `  ${pad("Total")}${results.length}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);
}

function productSearchEmbed(results) {
  const lines = results.map((r, i) =>
    `  ${i + 1}. ${r.title}\n     ${r.productId || "N/A"} | ${r.type || "N/A"}`
  );

  const block = [
    "Search Results",
    "----------------------------",
    "",
    ...lines,
  ];

  return header()
    .setColor(COLORS.INFO)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\`` || "No results found.");
}

// ── Changer / Checker ────────────────────────────────────────

function changerResultsEmbed(results) {
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  const block = [
    "Changer Results",
    "----------------------------",
    "",
    `  ${pad("Changed")}${success}`,
    `  ${pad("Failed")}${failed}`,
    "",
    "----------------------------",
    `  ${pad("Total")}${results.length}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);
}

function accountCheckerResultsEmbed(results) {
  const valid = results.filter((r) => r.status === "valid").length;
  const locked = results.filter((r) => r.status === "locked").length;
  const invalid = results.filter((r) => r.status === "invalid").length;
  const rateLimited = results.filter((r) => r.status === "rate_limited").length;
  const errors = results.filter((r) => r.status === "error").length;

  const block = [
    "Account Checker",
    "----------------------------",
    "",
    `  ${pad("Valid")}${valid}`,
    `  ${pad("Locked")}${locked}`,
    `  ${pad("Invalid")}${invalid}`,
    `  ${pad("Rate Limited")}${rateLimited}`,
    `  ${pad("Errors")}${errors}`,
    "",
    "----------------------------",
    `  ${pad("Total")}${results.length}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);
}

// ── Rewards ──────────────────────────────────────────────────

function rewardsResultsEmbed(results) {
  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const totalPoints = success.reduce((sum, r) => sum + r.balance, 0);
  const avg = success.length > 0 ? Math.round(totalPoints / success.length).toLocaleString() : "0";

  const block = [
    "Rewards Balance",
    "----------------------------",
    "",
    `  ${pad("Checked")}${results.length}`,
    `  ${pad("Successful")}${success.length}`,
    `  ${pad("Failed")}${failed.length}`,
    "",
    "  Points",
    `  ${pad("Total")}${totalPoints.toLocaleString()}`,
    `  ${pad("Average")}${avg}`,
  ];

  if (success.length > 0) {
    const highest = success.reduce((max, r) => r.balance > max.balance ? r : max);
    block.push(`  ${pad("Highest")}${highest.balance.toLocaleString()} (${highest.email.split("@")[0]}...)`);
  }

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);
}

// ── Generic ──────────────────────────────────────────────────

function errorEmbed(message) {
  return header({ thumbnail: false })
    .setColor(COLORS.ERROR)
    .setDescription(`\`\`\`\nError\n----------------------------\n\n${message}\n\`\`\``);
}

function successEmbed(message) {
  return header({ thumbnail: false })
    .setColor(COLORS.SUCCESS)
    .setDescription(`\`\`\`\nSuccess\n----------------------------\n\n${message}\n\`\`\``);
}

function infoEmbed(title, description) {
  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(`\`\`\`\n${title}\n----------------------------\n\n${description}\n\`\`\``);
}

function ownerOnlyEmbed(featureName) {
  const block = [
    `${featureName}`,
    "----------------------------",
    "",
    "Currently in a closed development phase.",
    "Exclusively available to TalkNeon during testing.",
    "",
    "Access will be rolled out once the module has",
    "been fully validated and stabilized.",
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(`\`\`\`\n${block.join("\n")}\n\`\`\``);
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

const HELP_CATEGORIES = {
  checker: {
    label: "Checker",
    description: "Check codes against WLID tokens",
    content: (p) => [
      "Checker",
      "----------------------------",
      "",
      `  ${p}check [wlids] + attach codes.txt`,
      "  Check codes against WLID tokens.",
      "  Uses stored WLIDs if none provided.",
      "",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  claimer: {
    label: "Claimer",
    description: "Claim WLID tokens from accounts",
    content: (p) => [
      "Claimer",
      "----------------------------",
      "",
      `  ${p}claim <email:pass> or attach .txt`,
      "  Extract WLID tokens from MS accounts.",
      "",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  puller: {
    label: "Puller",
    description: "Fetch & validate Game Pass codes",
    content: (p) => [
      "Puller",
      "----------------------------",
      "",
      `  ${p}pull <email:pass> or attach .txt`,
      "  Fetches codes from Game Pass accounts,",
      "  then validates them automatically.",
      "",
      `  ${p}promopuller <email:pass> or attach .txt`,
      "  Fetches promo links from Game Pass perks.",
      "  Speed-optimized, no validation phase.",
      "",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  rewards: {
    label: "Rewards",
    description: "Check Microsoft Rewards balances",
    content: (p) => [
      "Rewards",
      "----------------------------",
      "",
      `  ${p}rewards <email:pass> or attach .txt`,
      "  Check Rewards point balances.",
      "  Shows balance, lifetime points, level.",
      "",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  prs: {
    label: "PRS Scraper",
    description: "Scrape Rewards order history for codes",
    content: (p) => [
      "PRS - Rewards Scraper",
      "----------------------------",
      "",
      `  ${p}prs [category] <email:pass>`,
      "  or attach a .txt file",
      "",
      "  Scrapes Microsoft Rewards order history",
      "  for redeemable codes across categories:",
      "",
      "  Categories",
      "    Minecraft, Roblox, League of Legends,",
      "    Overwatch, Sea of Thieves, Game Pass,",
      "    Gift Cards, All (default)",
      "",
      "  Results delivered as ZIP with per-",
      "  category files in your DMs.",
      "",
      "  Options",
      `    category  Select specific category`,
      `    threads   1-100 (default 10)`,
    ].join("\n"),
  },
  purchaser: {
    label: "Purchaser",
    description: "Buy from Microsoft Store [Owner]",
    content: (p) => [
      "Purchaser  [Owner Only]",
      "----------------------------",
      "",
      `  ${p}purchase <email:pass> <product_id>`,
      "  Buy items from the Microsoft Store.",
      "",
      `  ${p}search <query>`,
      "  Search for products.",
      "",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  changer: {
    label: "Changer",
    description: "Change passwords & check accounts [Owner]",
    content: (p) => [
      "Changer  [Owner Only]",
      "----------------------------",
      "",
      `  ${p}changer <email:pass> <new_password>`,
      "  Change password on MS accounts.",
      "",
      `  ${p}checker <email:pass> or attach .txt`,
      "  Validate account credentials.",
      "",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  inbox: {
    label: "Inbox AIO",
    description: "Scan inboxes for 50+ services",
    content: (p) => [
      "Inbox AIO Scanner",
      "----------------------------",
      "",
      `  ${p}inboxaio <email:pass> or attach .txt`,
      "  Scans Hotmail/Outlook inboxes for 50+",
      "  services (Netflix, Spotify, PayPal...)",
      "",
      "  Results delivered as ZIP with per-",
      "  service folders in your DMs.",
      "",
      "  Options",
      `    threads  1-50 (default 5)`,
    ].join("\n"),
  },
  recovery: {
    label: "Recovery",
    description: "Recover accounts via ACSR",
    content: (p) => [
      "Recovery",
      "----------------------------",
      "",
      `  ${p}recover <email(s)> <new_password>`,
      "  Recover account(s) via ACSR.",
      "",
      `  ${p}captcha <solution>`,
      "  Submit CAPTCHA for active recovery.",
      "",
      "  All results sent to your DMs.",
    ].join("\n"),
  },
  admin: {
    label: "Admin",
    description: "Authorization, blacklist & settings [Owner]",
    content: (p) => [
      "Admin  [Owner Only]",
      "----------------------------",
      "",
      "  WLID Storage",
      `    ${p}wlidset <tokens> or attach .txt`,
      "",
      "  Authorization",
      `    ${p}auth <@user> <duration>`,
      `    ${p}deauth <@user>`,
      `    ${p}authlist`,
      "",
      "  Blacklist",
      `    ${p}blacklist <@user> [reason]`,
      `    ${p}unblacklist <@user>`,
      `    ${p}blacklistshow`,
      "",
      "  Tools",
      `    ${p}admin | ${p}setwebhook <url>`,
      `    ${p}botstats | ${p}stats`,
    ].join("\n"),
  },
};

function helpOverviewEmbed(prefix) {
  const catList = Object.entries(HELP_CATEGORIES).map(([, cat]) =>
    `  - **${cat.label}** -- ${cat.description}`
  );

  return header({ banner: true })
    .setColor(COLORS.PRIMARY)
    .setTitle("Command Reference")
    .setDescription([
      `Select a category below to view commands.`,
      `All results are sent to your DMs automatically.`,
      ``,
      ...catList,
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
    const lines = page.map(([svc, count]) => `◈ **${svc}**: ${count}`);
    const title = pages.length > 1
      ? `┃ ${labelPrefix} (${idx + 1})`
      : `┃ ${labelPrefix}`;
    return { name: title, value: lines.join("\n"), inline: false };
  });
}

function inboxAioProgressEmbed({ completed, total, hits, fails, elapsed, latestAccount, latestStatus, servicesFound, serviceBreakdown }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const barW = 20;
  const filled = Math.round((pct / 100) * barW);
  const bar = "█".repeat(filled) + "░".repeat(barW - filled);
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
    embed.addFields({ name: "┃ Services", value: "No services detected.", inline: false });
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
    const catLines = sorted.map(([cat, count]) => `◈ **${cat}**: ${count} codes`);
    embed.addFields({ name: "┃ Categories", value: catLines.join("\n"), inline: false });
  }

  if (dmSent) embed.addFields({ name: "\u200b", value: "Results sent to your DMs.", inline: false });

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
};
