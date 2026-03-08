// ============================================================
//  Embed builders — premium aesthetic, ANSI colors, ASCII branding
//  No emojis. Cross-platform (PC + mobile Discord).
// ============================================================

const { EmbedBuilder, AttachmentBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
const { COLORS, THUMBNAIL_URL, BANNER_URL } = require("../config");

const FOOTER_TEXT = "AutizMens | TalkNeon";

// ── ANSI color codes for Discord code blocks ─────────────────
// Usage: ```ansi\n\u001b[0;32mGreen text\u001b[0m\n```
const C = {
  reset:   "\u001b[0m",
  bold:    "\u001b[1m",
  dim:     "\u001b[2m",
  green:   "\u001b[0;32m",
  red:     "\u001b[0;31m",
  yellow:  "\u001b[0;33m",
  cyan:    "\u001b[0;36m",
  white:   "\u001b[0;37m",
  gray:    "\u001b[0;30m",
  bGreen:  "\u001b[1;32m",
  bRed:    "\u001b[1;31m",
  bYellow: "\u001b[1;33m",
  bCyan:   "\u001b[1;36m",
  bWhite:  "\u001b[1;37m",
};

// ── ASCII Logo ───────────────────────────────────────────────
const ASCII_LOGO = [
  `${C.bCyan}    _   _   _ _____ ___ ____`,
  `   / \\ | | | |_   _|_ _|__  /`,
  `  / _ \\| | | | | |  | |  / / `,
  ` / ___ \\ |_| | | |  | | / /_ `,
  `/_/   \\_\\___/  |_| |___|/____|${C.reset}`,
].join("\n");

const ASCII_LOGO_SMALL = `${C.bCyan}AUTIZ${C.reset}`;

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

function ansi(lines) {
  return `\`\`\`ansi\n${lines.join("\n")}\n\`\`\``;
}

function pad(label, width = 18) {
  return label.padEnd(width);
}

function genSessionId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Progress ─────────────────────────────────────────────────

function progressEmbed(completed, total, label = "Processing") {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "#".repeat(filled) + "-".repeat(barLen - filled);

  const color = pct < 50 ? C.yellow : pct < 100 ? C.bCyan : C.bGreen;

  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(ansi([
      `${C.bWhite}${label}${C.reset}`,
      ``,
      `  ${color}[${bar}] ${pct}%${C.reset}`,
      `  ${C.white}${completed.toLocaleString()} / ${total.toLocaleString()}${C.reset}`,
    ]));
}

// ── Check Results ────────────────────────────────────────────

function checkResultsEmbed(results) {
  const valid = results.filter((r) => r.status === "valid").length;
  const used = results.filter((r) => r.status === "used").length;
  const expired = results.filter((r) => r.status === "expired").length;
  const invalid = results.filter((r) => r.status === "invalid" || r.status === "error").length;

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi([
      `${C.bWhite}Check Results${C.reset}`,
      ``,
      `  ${C.bGreen}${pad("Valid")}${valid}${C.reset}`,
      `  ${C.yellow}${pad("Used")}${used}${C.reset}`,
      `  ${C.red}${pad("Expired")}${expired}${C.reset}`,
      `  ${C.dim}${pad("Invalid")}${invalid}${C.reset}`,
    ]));

  embed.addFields(
    { name: "\u200b", value: `\`Total: ${results.length}\` | \`Session: ${genSessionId()}\``, inline: false }
  );

  return embed;
}

// ── Claim Results ────────────────────────────────────────────

function claimResultsEmbed(results) {
  const success = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi([
      `${C.bWhite}Claim Results${C.reset}`,
      ``,
      `  ${C.bGreen}${pad("Success")}${success}${C.reset}`,
      `  ${C.bRed}${pad("Failed")}${failed}${C.reset}`,
    ]));

  embed.addFields(
    { name: "\u200b", value: `\`Total: ${results.length}\` | \`Session: ${genSessionId()}\``, inline: false }
  );

  return embed;
}

// ── Pull Progress (Fetch Phase) ──────────────────────────────

function pullFetchProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "#".repeat(filled) + "-".repeat(barLen - filled);

  const lines = [
    `${C.bWhite}Fetching Codes${C.reset}`,
    ``,
    `  ${C.bCyan}[${bar}] ${pct}%${C.reset}`,
    `  ${C.white}${details.done} / ${details.total} accounts${C.reset}`,
  ];

  if (details.lastAccount) {
    const status = details.lastError
      ? `${C.bRed}${details.lastAccount} -- Failed${C.reset}`
      : `${C.bGreen}${details.lastAccount} -- ${details.lastCodes} codes${C.reset}`;
    lines.push(``, `  ${C.dim}Latest:${C.reset} ${status}`);
  }
  if (details.totalCodes !== undefined) {
    lines.push(`  ${C.white}Codes found: ${C.bCyan}${details.totalCodes}${C.reset}`);
  }

  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(ansi(lines));
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

  const elapsed = startTime ? ((Date.now() - startTime) / 1000) : 0;
  const elapsedStr = elapsed.toFixed(1);
  const speed = elapsed > 0 && validateProgress.done > 0
    ? (validateProgress.done / elapsed).toFixed(1)
    : "...";

  const lines = [
    `${C.bWhite}Validating Codes${C.reset}`,
    `  ${C.bCyan}[${bar}] ${pct}%${C.reset}`,
    ``,
    `  ${C.bWhite}Account Analysis${C.reset}`,
    `  ${C.white}${pad("Total Accounts")}${totalAccounts}${C.reset}`,
    `  ${C.bGreen}${pad("Working")}${workingAccounts.length}${C.reset}`,
    `    ${C.green}${pad("> With Codes", 18)}${withCodes.length}${C.reset}`,
    `    ${C.dim}${pad("> No Codes", 18)}${noCodes.length}${C.reset}`,
    `  ${C.bRed}${pad("Failed")}${failedAccounts.length}${C.reset}`,
    ``,
    `  ${C.bWhite}Codes Found        ${C.bCyan}${totalCodesFetched}${C.reset}`,
    `    ${C.bGreen}${pad("> Working", 18)}${valid}${C.reset}`,
    `    ${C.yellow}${pad("> Claimed", 18)}${used}${C.reset}`,
    `    ${C.bCyan}${pad("> Balance", 18)}${balance}${C.reset}`,
  ];

  if (expired > 0) lines.push(`    ${C.red}${pad("> Expired", 18)}${expired}${C.reset}`);
  if (regionLocked > 0) lines.push(`    ${C.yellow}${pad("> Region Locked", 18)}${regionLocked}${C.reset}`);
  if (invalid > 0) lines.push(`    ${C.dim}${pad("> Invalid", 18)}${invalid}${C.reset}`);

  lines.push(
    ``,
    `  ${C.dim}Time: ${elapsedStr}s | Speed: ${speed} codes/s${C.reset}`,
  );

  const embed = header({ thumbnail: false }).setColor(COLORS.INFO).setDescription(ansi(lines));

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

  const speed = elapsed && parseFloat(elapsed) > 0 && validateResults.length > 0
    ? (validateResults.length / parseFloat(elapsed)).toFixed(1)
    : "N/A";
  const sid = genSessionId();

  const lines = [
    `${C.bGreen}Fetching Complete!${C.reset}`,
    ``,
    `  ${C.bWhite}Account Analysis${C.reset}`,
    `  ${C.white}${pad("Total Accounts")}${totalAccounts}${C.reset}`,
    `  ${C.bGreen}${pad("Working")}${workingAccounts.length}${C.reset}`,
    `    ${C.green}${pad("> With Codes", 18)}${withCodes.length}${C.reset}`,
    `    ${C.dim}${pad("> No Codes", 18)}${noCodes.length}${C.reset}`,
    `  ${C.bRed}${pad("Failed")}${failedAccounts.length}${C.reset}`,
    ``,
    `  ${C.bWhite}Codes Found        ${C.bCyan}${totalCodesFetched}${C.reset}`,
    `    ${C.bGreen}${pad("> Working", 18)}${valid.length}${C.reset}`,
    `    ${C.yellow}${pad("> Claimed", 18)}${used.length}${C.reset}`,
    `    ${C.bCyan}${pad("> Balance", 18)}${balance.length}${C.reset}`,
  ];

  if (expired.length > 0) lines.push(`    ${C.red}${pad("> Expired", 18)}${expired.length}${C.reset}`);
  if (regionLocked.length > 0) lines.push(`    ${C.yellow}${pad("> Region Locked", 18)}${regionLocked.length}${C.reset}`);
  if (invalid.length > 0) lines.push(`    ${C.dim}${pad("> Invalid", 18)}${invalid.length}${C.reset}`);

  lines.push(
    ``,
    `  ${C.white}${pad("Links Found")}${totalCodesFetched}${C.reset}`,
  );

  if (elapsed) {
    lines.push(``, `  ${C.dim}Time: ${elapsed}s | Speed: ${speed} codes/s | ID: ${sid}${C.reset}`);
  }

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi(lines));

  if (dmSent) {
    embed.addFields({ name: "\u200b", value: "```\n>> Results sent to your DMs\n```", inline: false });
  }

  if (username) {
    embed.setFooter({ text: `Pulled by ${username} | ${new Date().toLocaleDateString("en-GB")} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` });
  }

  return embed;
}

// ── Purchase ─────────────────────────────────────────────────

function purchaseProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "#".repeat(filled) + "-".repeat(barLen - filled);

  const lines = [
    `${C.bWhite}Purchasing${C.reset}`,
    ``,
    `  ${C.white}Product: ${C.bCyan}${details.product}${C.reset}`,
    `  ${C.white}Price:   ${C.bGreen}${details.price}${C.reset}`,
    ``,
    `  ${C.bCyan}[${bar}] ${pct}%${C.reset}`,
    `  ${C.white}${details.done} / ${details.total} accounts${C.reset}`,
  ];
  if (details.status) lines.push(``, `  ${C.dim}Status: ${details.status}${C.reset}`);

  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(ansi(lines));
}

function purchaseResultsEmbed(results, productTitle, price) {
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi([
      `${C.bWhite}Purchase Results${C.reset}`,
      ``,
      `  ${C.white}Product: ${C.bCyan}${productTitle}${C.reset}`,
      `  ${C.white}Price:   ${C.bGreen}${price}${C.reset}`,
      ``,
      `  ${C.bGreen}${pad("Purchased")}${success}${C.reset}`,
      `  ${C.bRed}${pad("Failed")}${failed}${C.reset}`,
    ]));

  embed.addFields(
    { name: "\u200b", value: `\`Total: ${results.length}\` | \`Session: ${genSessionId()}\``, inline: false }
  );

  return embed;
}

function productSearchEmbed(results) {
  const lines = [
    `${C.bWhite}Search Results${C.reset}`,
    ``,
  ];

  results.forEach((r, i) => {
    lines.push(
      `  ${C.bCyan}${i + 1}.${C.reset} ${C.bWhite}${r.title}${C.reset}`,
      `     ${C.dim}${r.productId || "N/A"} | ${r.type || "N/A"}${C.reset}`,
    );
  });

  return header()
    .setColor(COLORS.INFO)
    .setDescription(ansi(lines) || "No results found.");
}

// ── Changer / Checker ────────────────────────────────────────

function changerResultsEmbed(results) {
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi([
      `${C.bWhite}Changer Results${C.reset}`,
      ``,
      `  ${C.bGreen}${pad("Changed")}${success}${C.reset}`,
      `  ${C.bRed}${pad("Failed")}${failed}${C.reset}`,
    ]));

  embed.addFields(
    { name: "\u200b", value: `\`Total: ${results.length}\` | \`Session: ${genSessionId()}\``, inline: false }
  );

  return embed;
}

function accountCheckerResultsEmbed(results) {
  const valid = results.filter((r) => r.status === "valid").length;
  const locked = results.filter((r) => r.status === "locked").length;
  const invalid = results.filter((r) => r.status === "invalid").length;
  const rateLimited = results.filter((r) => r.status === "rate_limited").length;
  const errors = results.filter((r) => r.status === "error").length;

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi([
      `${C.bWhite}Account Checker${C.reset}`,
      ``,
      `  ${C.bGreen}${pad("Valid")}${valid}${C.reset}`,
      `  ${C.bYellow}${pad("Locked")}${locked}${C.reset}`,
      `  ${C.bRed}${pad("Invalid")}${invalid}${C.reset}`,
      `  ${C.yellow}${pad("Rate Limited")}${rateLimited}${C.reset}`,
      `  ${C.dim}${pad("Errors")}${errors}${C.reset}`,
    ]));

  embed.addFields(
    { name: "\u200b", value: `\`Total: ${results.length}\` | \`Session: ${genSessionId()}\``, inline: false }
  );

  return embed;
}

// ── Rewards ──────────────────────────────────────────────────

function rewardsResultsEmbed(results) {
  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const totalPoints = success.reduce((sum, r) => sum + r.balance, 0);
  const avg = success.length > 0 ? Math.round(totalPoints / success.length).toLocaleString() : "0";

  const lines = [
    `${C.bWhite}Rewards Balance${C.reset}`,
    ``,
    `  ${C.bGreen}${pad("Successful")}${success.length}${C.reset}`,
    `  ${C.bRed}${pad("Failed")}${failed.length}${C.reset}`,
    ``,
    `  ${C.bWhite}Points${C.reset}`,
    `  ${C.bCyan}${pad("Total")}${totalPoints.toLocaleString()}${C.reset}`,
    `  ${C.white}${pad("Average")}${avg}${C.reset}`,
  ];

  if (success.length > 0) {
    const highest = success.reduce((max, r) => r.balance > max.balance ? r : max);
    lines.push(`  ${C.bGreen}${pad("Highest")}${highest.balance.toLocaleString()} ${C.dim}(${highest.email.split("@")[0]}...)${C.reset}`);
  }

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi(lines));

  embed.addFields(
    { name: "\u200b", value: `\`Checked: ${results.length}\` | \`Session: ${genSessionId()}\``, inline: false }
  );

  return embed;
}

// ── Generic ──────────────────────────────────────────────────

function errorEmbed(message) {
  return header({ thumbnail: false })
    .setColor(COLORS.ERROR)
    .setDescription(ansi([
      `${C.bRed}Error${C.reset}`,
      ``,
      `  ${C.white}${message}${C.reset}`,
    ]));
}

function successEmbed(message) {
  return header({ thumbnail: false })
    .setColor(COLORS.SUCCESS)
    .setDescription(ansi([
      `${C.bGreen}Success${C.reset}`,
      ``,
      `  ${C.white}${message}${C.reset}`,
    ]));
}

function infoEmbed(title, description) {
  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(ansi([
      `${C.bCyan}${title}${C.reset}`,
      ``,
      `  ${C.white}${description}${C.reset}`,
    ]));
}

function ownerOnlyEmbed(featureName) {
  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi([
      `${C.bYellow}${featureName}${C.reset}`,
      ``,
      `  ${C.white}Currently in a closed development phase.${C.reset}`,
      `  ${C.white}Exclusively available to ${C.bCyan}TalkNeon${C.white} during testing.${C.reset}`,
      ``,
      `  ${C.dim}Access will be rolled out once the module${C.reset}`,
      `  ${C.dim}has been fully validated and stabilized.${C.reset}`,
    ]));
}

function authListEmbed(entries) {
  if (entries.length === 0) {
    return header().setColor(COLORS.MUTED).setDescription(ansi([
      `${C.bWhite}Authorized Users${C.reset}`,
      ``,
      `  ${C.dim}No authorized users.${C.reset}`,
    ]));
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
      `${C.bWhite}Checker${C.reset}`,
      ``,
      `  ${C.bCyan}${p}check [wlids]${C.reset} ${C.dim}+ attach codes.txt${C.reset}`,
      `  ${C.white}Check codes against WLID tokens.${C.reset}`,
      `  ${C.dim}Uses stored WLIDs if none provided.${C.reset}`,
      ``,
      `  ${C.green}All results sent to your DMs.${C.reset}`,
    ],
  },
  claimer: {
    label: "Claimer",
    description: "Claim WLID tokens from accounts",
    content: (p) => [
      `${C.bWhite}Claimer${C.reset}`,
      ``,
      `  ${C.bCyan}${p}claim <email:pass>${C.reset} ${C.dim}or attach .txt${C.reset}`,
      `  ${C.white}Extract WLID tokens from MS accounts.${C.reset}`,
      ``,
      `  ${C.green}All results sent to your DMs.${C.reset}`,
    ],
  },
  puller: {
    label: "Puller",
    description: "Fetch & validate Game Pass codes",
    content: (p) => [
      `${C.bWhite}Puller${C.reset}`,
      ``,
      `  ${C.bCyan}${p}pull <email:pass>${C.reset} ${C.dim}or attach .txt${C.reset}`,
      `  ${C.white}Fetches codes from Game Pass accounts,${C.reset}`,
      `  ${C.white}then validates them automatically.${C.reset}`,
      ``,
      `  ${C.green}All results sent to your DMs.${C.reset}`,
    ],
  },
  rewards: {
    label: "Rewards",
    description: "Check Microsoft Rewards balances",
    content: (p) => [
      `${C.bWhite}Rewards${C.reset}`,
      ``,
      `  ${C.bCyan}${p}rewards <email:pass>${C.reset} ${C.dim}or attach .txt${C.reset}`,
      `  ${C.white}Check Rewards point balances.${C.reset}`,
      `  ${C.white}Shows balance, lifetime points, level.${C.reset}`,
      ``,
      `  ${C.green}All results sent to your DMs.${C.reset}`,
    ],
  },
  purchaser: {
    label: "Purchaser",
    description: "Buy from Microsoft Store [Owner]",
    content: (p) => [
      `${C.bWhite}Purchaser${C.reset}  ${C.dim}[Owner Only]${C.reset}`,
      ``,
      `  ${C.bCyan}${p}purchase <email:pass> <product_id>${C.reset}`,
      `  ${C.white}Buy items from the Microsoft Store.${C.reset}`,
      ``,
      `  ${C.bCyan}${p}search <query>${C.reset}`,
      `  ${C.white}Search for products.${C.reset}`,
      ``,
      `  ${C.green}All results sent to your DMs.${C.reset}`,
    ],
  },
  changer: {
    label: "Changer",
    description: "Change passwords & check accounts [Owner]",
    content: (p) => [
      `${C.bWhite}Changer${C.reset}  ${C.dim}[Owner Only]${C.reset}`,
      ``,
      `  ${C.bCyan}${p}changer <email:pass> <new_password>${C.reset}`,
      `  ${C.white}Change password on MS accounts.${C.reset}`,
      ``,
      `  ${C.bCyan}${p}checker <email:pass>${C.reset} ${C.dim}or attach .txt${C.reset}`,
      `  ${C.white}Validate account credentials.${C.reset}`,
      ``,
      `  ${C.green}All results sent to your DMs.${C.reset}`,
    ],
  },
  recovery: {
    label: "Recovery",
    description: "Recover accounts via ACSR",
    content: (p) => [
      `${C.bWhite}Recovery${C.reset}`,
      ``,
      `  ${C.bCyan}${p}recover <email(s)> <new_password>${C.reset}`,
      `  ${C.white}Recover account(s) via ACSR.${C.reset}`,
      ``,
      `  ${C.bCyan}${p}captcha <solution>${C.reset}`,
      `  ${C.white}Submit CAPTCHA for active recovery.${C.reset}`,
      ``,
      `  ${C.green}All results sent to your DMs.${C.reset}`,
    ],
  },
  admin: {
    label: "Admin",
    description: "Authorization, blacklist & settings [Owner]",
    content: (p) => [
      `${C.bWhite}Admin${C.reset}  ${C.dim}[Owner Only]${C.reset}`,
      ``,
      `  ${C.bYellow}WLID Storage${C.reset}`,
      `    ${C.bCyan}${p}wlidset <tokens>${C.reset} ${C.dim}or attach .txt${C.reset}`,
      ``,
      `  ${C.bYellow}Authorization${C.reset}`,
      `    ${C.bCyan}${p}auth <@user> <duration>${C.reset}`,
      `    ${C.bCyan}${p}deauth <@user>${C.reset}`,
      `    ${C.bCyan}${p}authlist${C.reset}`,
      ``,
      `  ${C.bYellow}Blacklist${C.reset}`,
      `    ${C.bCyan}${p}blacklist <@user> [reason]${C.reset}`,
      `    ${C.bCyan}${p}unblacklist <@user>${C.reset}`,
      `    ${C.bCyan}${p}blacklistshow${C.reset}`,
      ``,
      `  ${C.bYellow}Tools${C.reset}`,
      `    ${C.bCyan}${p}admin${C.reset} | ${C.bCyan}${p}setwebhook <url>${C.reset}`,
      `    ${C.bCyan}${p}botstats${C.reset} | ${C.bCyan}${p}stats${C.reset}`,
    ],
  },
};

function helpOverviewEmbed(prefix) {
  const catLines = Object.entries(HELP_CATEGORIES).map(([, cat]) =>
    `  ${C.bCyan}-${C.reset} ${C.bWhite}${cat.label}${C.reset} ${C.dim}-- ${cat.description}${C.reset}`
  );

  const lines = [
    ASCII_LOGO,
    ``,
    `  ${C.white}Select a category below to view commands.${C.reset}`,
    `  ${C.green}All results are sent to your DMs.${C.reset}`,
    ``,
    ...catLines,
  ];

  return header({ banner: true })
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi(lines));
}

function helpCategoryEmbed(categoryKey, prefix) {
  const cat = HELP_CATEGORIES[categoryKey];
  if (!cat) return errorEmbed("Unknown category.");

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi(cat.content(prefix)));
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
    ASCII_LOGO,
    ``,
    `  ${C.bWhite}Welcome, ${username}${C.reset}`,
    `  ${C.white}You now have access to AutizMens.${C.reset}`,
    ``,
    `  ${C.bYellow}Quick Start${C.reset}`,
    `    ${C.bCyan}.help${C.reset}      ${C.white}View all commands${C.reset}`,
    `    ${C.bCyan}.pull${C.reset}      ${C.white}Fetch & validate codes${C.reset}`,
    `    ${C.bCyan}.check${C.reset}     ${C.white}Check codes${C.reset}`,
    `    ${C.bCyan}.rewards${C.reset}   ${C.white}Check point balances${C.reset}`,
    ``,
    `  ${C.green}All results are sent to your DMs.${C.reset}`,
    `  ${C.dim}Attach a .txt file for bulk operations.${C.reset}`,
    ``,
    `  ${C.white}Type ${C.bCyan}.help${C.white} to get started.${C.reset}`,
  ];

  return header({ banner: true })
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi(lines));
}

// ── Admin Panels ─────────────────────────────────────────────

function adminPanelEmbed(stats, authCount, activeOtpSessions, activeProcesses, webhookSet) {
  const lines = [
    `${C.bWhite}Admin Control Panel${C.reset}`,
    ``,
    `  ${C.bYellow}Users${C.reset}`,
    `  ${C.white}${pad("Authorized")}${C.bCyan}${authCount}${C.reset}`,
    `  ${C.white}${pad("OTP Sessions")}${C.bCyan}${activeOtpSessions}${C.reset}`,
    `  ${C.white}${pad("Active")}${C.bCyan}${activeProcesses}${C.reset}`,
    ``,
    `  ${C.bYellow}Processing${C.reset}`,
    `  ${C.white}${pad("Total")}${stats.total_processed}${C.reset}`,
    `  ${C.bGreen}${pad("Success")}${stats.total_success}${C.reset}`,
    `  ${C.bRed}${pad("Failed")}${stats.total_failed}${C.reset}`,
    ``,
    `  ${C.bYellow}Status${C.reset}`,
    `  ${C.bGreen}${pad("Bot")}Online${C.reset}`,
    `  ${C.white}${pad("Webhook")}${webhookSet ? `${C.bGreen}Set` : `${C.bRed}Not Set`}${C.reset}`,
  ];

  return header()
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi(lines));
}

function detailedStatsEmbed(stats, topUsers) {
  const rate = stats.total_processed > 0
    ? Math.round((stats.total_success / stats.total_processed) * 100)
    : 0;

  const lines = [
    `${C.bWhite}Detailed Statistics${C.reset}`,
    ``,
    `  ${C.white}${pad("Processed")}${stats.total_processed}${C.reset}`,
    `  ${C.bGreen}${pad("Success")}${stats.total_success}${C.reset}`,
    `  ${C.bRed}${pad("Failed")}${stats.total_failed}${C.reset}`,
    `  ${C.bCyan}${pad("Rate")}${rate}%${C.reset}`,
  ];

  const embed = header()
    .setColor(COLORS.PRIMARY)
    .setDescription(ansi(lines));

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
  return header({ thumbnail: false })
    .setColor(COLORS.INFO)
    .setDescription(ansi([
      `${C.bWhite}Account Recovery${C.reset}`,
      ``,
      `  ${C.white}Account: ${C.bCyan}${email}${C.reset}`,
    ]) + `\n${status}`);
}

function recoverResultEmbed(email, success, message) {
  const title = success ? `${C.bGreen}Recovery Successful` : `${C.bRed}Recovery Failed`;

  return header()
    .setColor(success ? COLORS.SUCCESS : COLORS.ERROR)
    .setDescription(ansi([
      `${title}${C.reset}`,
      ``,
      `  ${C.white}Account: ${C.bCyan}${email}${C.reset}`,
    ]) + `\n${message || (success ? "Password has been reset." : "Recovery failed.")}`);
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
