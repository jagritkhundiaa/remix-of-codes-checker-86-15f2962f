// ============================================================
//  Embed builders — Puller-style, monochrome, classy
//  Every embed renders as the AutizMens "Puller" UI:
//    - AutizMens author header (outside the box)
//    - Code-block body with Title === sections === Commands/Output
//    - Footer: "AutizMens | <username> | Today at HH:MM"
//  Only approved custom emojis allowed (PULLER_EMOJI). Unicode
//  symbols (•, └, ✅, ❌, ⚠️, ⏱️) are used as plain markers.
// ============================================================

const { EmbedBuilder, AttachmentBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
const { COLORS, THUMBNAIL_URL, BANNER_URL } = require("../config");

// ── Puller-specific animated emojis (only approved custom IDs) ──
const PULLER_EMOJI = {
  loading:   "<a:Loading:1473740101367500918>",
  working:   "<a:Working:1473738927251914919>",
  failed:    "<a:Failed:1473739301291561021>",
  codes:     "<a:Codes:1473739526861226248>",
  money:     "<a:Money2:1473744817270952161>",
  claimed:   "<:Claimed:1473747602708107525>",
  upload:    "<a:upload:1477644848638197784>",
  xbox:      "<:xbox:1475397643671830550>",
  minecraft: "<:Minecraft:1475397784801640500>",
  redExcl:   "<a:red_excl:1477645134932738212>",
  error:     "<:Error:1467644306272686238>",
};

// Plain unicode symbols (no custom Discord emojis)
const UI = {
  ok: "✅", fail: "❌", warn: "⚠️", info: "•",
  bullet: "•", sub: "└",
};

// Author / thumbnail rendered outside the code block, like the screenshot
const AUTHOR_NAME = "AutizMens";

function _todayTime() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `Today at ${h}:${m}`;
}

function _footer(username) {
  return `${AUTHOR_NAME} | ${username || "TalkNeon"} | ${_todayTime()}`;
}

/**
 * Core puller-style embed.
 *  title     — header line (e.g. "Puller", "Checker", "Admin")
 *  sections  — [{ heading, lines: [] }, ...]
 *  username  — footer username
 *  color     — embed color
 *  thumbnail — show right-side thumb (default true)
 */
function pullerStyle({ title, sections = [], username, color = COLORS.PRIMARY, thumbnail = true }) {
  const eq = "=".repeat(28);
  const dash = "-".repeat(28);

  const body = [];
  body.push(title);
  body.push(eq);
  for (const sec of sections) {
    body.push("");
    body.push(`  ${sec.heading}`);
    body.push(`  ${dash}`);
    for (const ln of sec.lines) {
      body.push(`  ${ln}`);
    }
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: AUTHOR_NAME })
    .setColor(color)
    .setDescription("```\n" + body.join("\n") + "\n```")
    .setFooter({ text: _footer(username) });

  if (thumbnail && THUMBNAIL_URL) embed.setThumbnail(THUMBNAIL_URL);
  return embed;
}

/**
 * Animated/live puller embed: same shape but uses real markdown so
 * custom puller emojis render. Keeps the title === eq and -- dash
 * dividers as in the screenshot.
 */
function pullerLive({ title, sections = [], username, color = COLORS.INFO, thumbnail = false }) {
  const eq = "═".repeat(28);
  const dash = "─".repeat(28);

  const body = [`**${title}**`, eq];
  for (const sec of sections) {
    body.push("");
    body.push(`**${sec.heading}**`);
    body.push(dash);
    for (const ln of sec.lines) body.push(ln);
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: AUTHOR_NAME })
    .setColor(color)
    .setDescription(body.join("\n"))
    .setFooter({ text: _footer(username) });

  if (thumbnail && THUMBNAIL_URL) embed.setThumbnail(THUMBNAIL_URL);
  return embed;
}

function _bar(pct, len = 18) {
  const filled = Math.round((pct / 100) * len);
  return "█".repeat(filled) + "░".repeat(len - filled);
}

// ============================================================
//  Generic progress / result embeds
// ============================================================

function progressEmbed(completed, total, label = "Processing", username) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return pullerStyle({
    title: label,
    username,
    color: COLORS.INFO,
    thumbnail: false,
    sections: [{
      heading: "Progress",
      lines: [
        `[${_bar(pct)}] ${pct}%`,
        `${completed.toLocaleString()} / ${total.toLocaleString()}`,
      ],
    }],
  });
}

function checkResultsEmbed(results, username) {
  const valid = results.filter((r) => r.status === "valid").length;
  const used = results.filter((r) => r.status === "used").length;
  const expired = results.filter((r) => r.status === "expired").length;
  const invalid = results.filter((r) => r.status === "invalid" || r.status === "error").length;

  return pullerStyle({
    title: "Checker",
    username,
    sections: [{
      heading: "Results",
      lines: [
        `Valid    : ${valid}`,
        `Claimed  : ${used}`,
        `Expired  : ${expired}`,
        `Invalid  : ${invalid}`,
        ``,
        `Total    : ${results.length}`,
      ],
    }],
  });
}

function claimResultsEmbed(results, username) {
  const success = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  return pullerStyle({
    title: "Claimer",
    username,
    sections: [{
      heading: "Results",
      lines: [
        `Success  : ${success}`,
        `Failed   : ${failed}`,
        ``,
        `Total    : ${results.length}`,
      ],
    }],
  });
}

// ============================================================
//  Puller-specific embeds (use animated emojis — markdown form)
// ============================================================

function pullFetchProgressEmbed(details) {
  const E = PULLER_EMOJI;
  const elapsed = details.startTime ? ((Date.now() - details.startTime) / 1000).toFixed(1) : "0.0";
  return pullerLive({
    title: "Fetching Codes...",
    username: details.username,
    color: COLORS.INFO,
    sections: [{
      heading: `${E.loading} Account Analysis`,
      lines: [
        `• Total Accounts: ${details.total || 0}`,
        `• ${E.working} Working: ${details.working || 0}`,
        `  └ With Codes: ${details.withCodes || 0}`,
        `  └ No Codes: ${details.noCodes || 0}`,
        `• ${E.failed} Failed: ${details.failed || 0}`,
        `• ${E.codes} Codes Found: ${details.totalCodes || 0}`,
        ``,
        `⏱️ Time: ${elapsed}s`,
      ],
    }],
  });
}

function pullLiveProgressEmbed(fetchResults, validateProgress, { username, startTime } = {}) {
  const E = PULLER_EMOJI;
  const totalAccounts = fetchResults.length;
  const working = fetchResults.filter((r) => !r.error);
  const failed = fetchResults.filter((r) => r.error);
  const withCodes = working.filter((r) => r.codes.length > 0);
  const noCodes = working.filter((r) => r.codes.length === 0);
  const totalCodesFetched = fetchResults.reduce((s, r) => s + r.codes.length, 0);
  const valid = validateProgress.valid || 0;
  const used = validateProgress.used || 0;
  const balance = validateProgress.balance || 0;
  const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "0.0";

  return pullerLive({
    title: "Validating Codes...",
    username,
    color: COLORS.INFO,
    sections: [{
      heading: `${E.loading} Account Analysis`,
      lines: [
        `• Total Accounts: ${totalAccounts}`,
        `• ${E.working} Working: ${working.length}`,
        `  └ With Codes: ${withCodes.length}`,
        `  └ No Codes: ${noCodes.length}`,
        `• ${E.failed} Failed: ${failed.length}`,
        `• ${E.codes} Codes Found: ${totalCodesFetched}`,
        `  └ Working: ${valid}`,
        `  └ ${E.claimed} Claimed: ${used}`,
        `  └ ${E.money} Balance: ${balance}`,
        ``,
        `⏱️ Time: ${elapsed}s`,
      ],
    }],
  });
}

function pullResultsEmbed(fetchResults, validateResults, { elapsed, dmSent, username } = {}) {
  const E = PULLER_EMOJI;
  const totalAccounts = fetchResults.length;
  const working = fetchResults.filter((r) => !r.error);
  const failed = fetchResults.filter((r) => r.error);
  const withCodes = working.filter((r) => r.codes.length > 0);
  const noCodes = working.filter((r) => r.codes.length === 0);
  const totalCodesFetched = fetchResults.reduce((s, r) => s + r.codes.length, 0);
  const valid = validateResults.filter((r) => r.status === "valid").length;
  const used = validateResults.filter((r) => r.status === "used" || r.status === "REDEEMED").length;
  const balance = validateResults.filter((r) => r.status === "BALANCE_CODE").length;

  const lines = [
    `• Total Accounts: ${totalAccounts}`,
    `• ${E.working} Working: ${working.length}`,
    `  └ With Codes: ${withCodes.length}`,
    `  └ No Codes: ${noCodes.length}`,
    `• ${E.failed} Failed: ${failed.length}`,
    `• ${E.codes} Codes Found: ${totalCodesFetched}`,
    `  └ Working: ${valid}`,
    `  └ ${E.claimed} Claimed: ${used}`,
    `  └ ${E.money} Balance: ${balance}`,
    ``,
    `⏱️ Time: ${elapsed || "0.0"}s`,
  ];
  if (dmSent) lines.push("", "» Codes sent to your DMs");

  return pullerLive({
    title: "Fetching Complete!",
    username,
    color: COLORS.PRIMARY,
    sections: [{ heading: `${E.loading} Account Analysis`, lines }],
  });
}

function promoPullerFetchProgressEmbed(details) {
  const E = PULLER_EMOJI;
  const elapsed = details.startTime ? ((Date.now() - details.startTime) / 1000).toFixed(1) : "0.0";
  return pullerLive({
    title: "Fetching Promo Links...",
    username: details.username,
    color: COLORS.INFO,
    sections: [{
      heading: `${E.loading} Account Analysis`,
      lines: [
        `• Total Accounts: ${details.total || 0}`,
        `• ${E.working} Working: ${details.working || 0}`,
        `  └ With Links: ${details.withLinks || 0}`,
        `  └ No Links: ${details.noLinks || 0}`,
        `• ${E.failed} Failed: ${details.failed || 0}`,
        `• ${E.codes} Links Found: ${details.totalLinks || 0}`,
        ``,
        `⏱️ Time: ${elapsed}s`,
      ],
    }],
  });
}

function promoPullerResultsEmbed(fetchResults, allLinks, { elapsed, dmSent, username, statusCounts } = {}) {
  const E = PULLER_EMOJI;
  const totalAccounts = fetchResults.length;
  const working = fetchResults.filter((r) => !r.error);
  const failed = fetchResults.filter((r) => r.error);
  const withLinks = working.filter((r) => r.links.length > 0);
  const noLinks = working.filter((r) => r.links.length === 0);
  const unique = [...new Set(allLinks)];
  const sc = statusCounts || {};

  const lines = [
    `• Total Accounts: ${totalAccounts}`,
    `• ${E.working} Working: ${working.length}`,
    `  └ With Links: ${withLinks.length}`,
    `  └ No Links: ${noLinks.length}`,
    `• ${E.failed} Failed: ${failed.length}`,
    `• ${E.codes} Links Found: ${allLinks.length}`,
    `  └ Unique: ${unique.length}`,
    `  └ ✅ Valid: ${sc.VALID || 0}`,
    `  └ ♻️ Redeemed: ${sc.REDEEMED || 0}`,
    `  └ 🚫 Max Uses: ${sc.MAX_USES || 0}`,
    `  └ ❌ Invalid: ${sc.INVALID || 0}`,
    ((sc.ERROR || 0) + (sc.NO_TOKEN || 0) > 0) ? `  └ ⚠️ Errors: ${(sc.ERROR || 0) + (sc.NO_TOKEN || 0)}` : null,
    ``,
    `⏱️ Time: ${elapsed || "0.0"}s`,
  ].filter(Boolean);
  if (dmSent) lines.push("", "» Links sent to your DMs");

  return pullerLive({
    title: "Promo Puller Complete!",
    username,
    color: COLORS.PRIMARY,
    sections: [{ heading: `${E.loading} Account Analysis`, lines }],
  });
}

// ============================================================
//  Purchase / Changer / Account / Rewards / Refund / AIO
//  All rendered in pure puller-style code block
// ============================================================

function purchaseProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const lines = [
    `Product  : ${details.product}`,
    `Price    : ${details.price}`,
    ``,
    `[${_bar(pct)}] ${pct}%`,
    `${details.done} / ${details.total} accounts`,
  ];
  if (details.purchased > 0 || details.failed > 0) {
    lines.push("", `Purchased: ${details.purchased || 0}`, `Failed   : ${details.failed || 0}`);
  }
  if (details.lastResult) {
    const tag = details.lastResult.success ? "OK" : "ERR";
    const msg = details.lastResult.success
      ? `Order ${details.lastResult.orderId || "OK"}`
      : details.lastResult.error || "Failed";
    lines.push("", `[${tag}] ${details.lastResult.email}`, `  -> ${msg}`);
  }
  return pullerStyle({
    title: "Purchaser",
    username: details.username,
    color: COLORS.INFO,
    thumbnail: false,
    sections: [{ heading: "Progress", lines }],
  });
}

function purchaseResultsEmbed(results, productTitle, price, username) {
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  return pullerStyle({
    title: "Purchaser",
    username,
    sections: [{
      heading: "Results",
      lines: [
        `Product  : ${productTitle}`,
        `Price    : ${price}`,
        ``,
        `Purchased: ${success}`,
        `Failed   : ${failed}`,
        ``,
        `Total    : ${results.length}`,
      ],
    }],
  });
}

function productSearchEmbed(results, username) {
  if (!results || results.length === 0) {
    return pullerStyle({
      title: "Product Search",
      username,
      color: COLORS.INFO,
      sections: [{ heading: "Results", lines: ["No results found."] }],
    });
  }
  const lines = [];
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ID: ${r.productId || "N/A"}  Type: ${r.type || "N/A"}`);
  });
  return pullerStyle({
    title: "Product Search",
    username,
    color: COLORS.INFO,
    sections: [{ heading: "Results", lines }],
  });
}

function changerResultsEmbed(results, username) {
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  return pullerStyle({
    title: "Changer",
    username,
    sections: [{
      heading: "Results",
      lines: [
        `Changed  : ${success}`,
        `Failed   : ${failed}`,
        ``,
        `Total    : ${results.length}`,
      ],
    }],
  });
}

function changerProgressEmbed({ completed, total, changed, failed, elapsed, latestAccount, latestStatus, username }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((completed / elSec) * 60) : 0;
  const lines = [
    `[${_bar(pct)}] ${pct}%`,
    `Processed : ${completed} / ${total}`,
    `Changed   : ${changed}`,
    `Failed    : ${failed}`,
    `Speed     : ${cpm} c/min`,
    `Elapsed   : ${elSec}s`,
  ];
  if (latestAccount) {
    const masked = latestAccount.replace(/(.{3}).*(@.*)/, "$1***$2");
    lines.push(`Latest    : ${masked} (${latestStatus || "..."})`);
  }
  return pullerStyle({ title: "Password Changer", username, color: COLORS.PRIMARY, thumbnail: false, sections: [{ heading: "Progress", lines }] });
}

function changerFinalEmbed({ total, changed, failed, twoFA, locked, captcha, elapsed, dmSent, username }) {
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((total / elSec) * 60) : 0;
  const lines = [
    `Total     : ${total}`,
    `Changed   : ${changed}`,
    `Failed    : ${failed}`,
    `2FA       : ${twoFA || 0}`,
    `Locked    : ${locked || 0}`,
    `Captcha   : ${captcha || 0}`,
    `Speed     : ${cpm} c/min`,
    `Elapsed   : ${elSec}s`,
  ];
  if (dmSent) lines.push("", "Results sent to your DMs.");
  return pullerStyle({
    title: "Password Changer",
    username,
    color: changed > 0 ? COLORS.SUCCESS : COLORS.ERROR,
    sections: [{ heading: "Results", lines }],
  });
}

// ── Chaturbate Bruter ────────────────────────────────────────

function bruterProgressEmbed({ completed, total, hits, bad, banned, retries, elapsed, latestUser, latestStatus, username }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((completed / elSec) * 60) : 0;
  const lines = [
    `[${_bar(pct)}] ${pct}%`,
    `Processed : ${completed} / ${total}`,
    `Hits      : ${hits}`,
    `Bad       : ${bad}`,
    `Banned    : ${banned}`,
    `Retries   : ${retries}`,
    `Speed     : ${cpm} c/min`,
    `Elapsed   : ${elSec}s`,
  ];
  if (latestUser) lines.push(`Latest    : ${latestUser} (${latestStatus || "..."})`);
  return pullerStyle({ title: "Chaturbate Bruter", username, color: COLORS.PRIMARY, thumbnail: false, sections: [{ heading: "Progress", lines }] });
}

function bruterFinalEmbed({ total, hits, bad, banned, retries, balanced, elapsed, username }) {
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((total / elSec) * 60) : 0;
  const lines = [
    `Total     : ${total}`,
    `Hits      : ${hits}`,
    `Bad       : ${bad}`,
    `Banned    : ${banned}`,
    `Retries   : ${retries}`,
    `Balanced  : ${balanced} (tokens > 0)`,
    `Speed     : ${cpm} c/min`,
    `Elapsed   : ${elSec}s`,
  ];
  return pullerStyle({
    title: "Chaturbate Bruter",
    username,
    color: hits > 0 ? COLORS.SUCCESS : COLORS.ERROR,
    sections: [{ heading: "Results", lines }],
  });
}

function accountCheckerResultsEmbed(results, username) {
  const valid = results.filter((r) => r.status === "valid").length;
  const locked = results.filter((r) => r.status === "locked").length;
  const invalid = results.filter((r) => r.status === "invalid").length;
  const rateLimited = results.filter((r) => r.status === "rate_limited").length;
  const errors = results.filter((r) => r.status === "error").length;
  return pullerStyle({
    title: "Account Checker",
    username,
    sections: [{
      heading: "Results",
      lines: [
        `Valid       : ${valid}`,
        `Locked      : ${locked}`,
        `Invalid     : ${invalid}`,
        `Rate Limited: ${rateLimited}`,
        `Errors      : ${errors}`,
        ``,
        `Total       : ${results.length}`,
      ],
    }],
  });
}

function rewardsResultsEmbed(results, username) {
  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const totalPoints = success.reduce((s, r) => s + r.balance, 0);
  const avg = success.length > 0 ? Math.round(totalPoints / success.length) : 0;
  const lines = [
    `Checked     : ${results.length}`,
    `Successful  : ${success.length}`,
    `Failed      : ${failed.length}`,
    ``,
    `Total Points: ${totalPoints.toLocaleString()}`,
    `Average     : ${avg.toLocaleString()}`,
  ];
  if (success.length > 0) {
    const highest = success.reduce((m, r) => r.balance > m.balance ? r : m);
    lines.push(`Highest     : ${highest.balance.toLocaleString()}`);
  }
  return pullerStyle({
    title: "Rewards",
    username,
    sections: [{ heading: "Results", lines }],
  });
}

// ============================================================
//  Generic helpers
// ============================================================

function errorEmbed(message, username) {
  const E = PULLER_EMOJI;
  return pullerLive({
    title: `${E.error} Error`,
    username,
    color: COLORS.ERROR,
    thumbnail: false,
    sections: [{
      heading: `${E.redExcl} Details`,
      lines: String(message).split("\n"),
    }],
  });
}

function successEmbed(message, username) {
  return pullerStyle({
    title: "Success",
    username,
    color: COLORS.SUCCESS,
    thumbnail: false,
    sections: [{ heading: "Details", lines: String(message).split("\n") }],
  });
}

function infoEmbed(title, description, username) {
  return pullerStyle({
    title: title || "Info",
    username,
    color: COLORS.INFO,
    thumbnail: false,
    sections: [{ heading: "Details", lines: String(description).split("\n") }],
  });
}

function ownerOnlyEmbed(featureName, username) {
  return pullerStyle({
    title: featureName,
    username,
    sections: [{
      heading: "Locked",
      lines: [
        "Currently in a closed development phase.",
        "Exclusively available to TalkNeon during testing.",
        "",
        "Access will roll out once the module has",
        "been fully validated and stabilized.",
      ],
    }],
  });
}

function authListEmbed(entries, username) {
  if (entries.length === 0) {
    return pullerStyle({
      title: "Authorized Users",
      username,
      color: COLORS.MUTED,
      sections: [{ heading: "Users", lines: ["No authorized users."] }],
    });
  }
  const lines = entries.map((e, i) => {
    const expiry = e.expiresAt === "Infinity" ? "Permanent" : `<t:${Math.floor(e.expiresAt / 1000)}:R>`;
    return `${i + 1}. <@${e.userId}> -- ${expiry}`;
  });
  // markdown form so user mentions render
  return pullerLive({
    title: "Authorized Users",
    username,
    color: COLORS.INFO,
    sections: [{ heading: "Users", lines }],
  });
}

// ============================================================
//  Help System (puller-style code block + select dropdown)
// ============================================================

const HELP_SECTIONS = {
  pullers:  { label: "-- Pullers --",     title: "Pullers",  categories: ["puller", "promopuller", "claimer"] },
  checkers: { label: "-- Checkers --",    title: "Checkers", categories: ["aio", "inbox", "countrysort", "checker", "refund", "change", "bruv1"] },
  owner:    { label: "-- Owner Only --",  title: "Owner",    categories: ["admin"] },
};

const HELP_CATEGORIES = {
  puller: {
    label: "Puller", description: "Fetch & validate Game Pass codes", section: "pullers",
    commands: (p) => [`${p}pull <email:pass> or attach .txt`, "  Fetches codes from Game Pass accounts,", "  then validates them automatically."],
  },
  promopuller: {
    label: "Promo Puller", description: "Pull & validate Discord promo links", section: "pullers",
    commands: (p) => [`${p}promopuller <email:pass> or attach .txt`, "  Pulls Discord promo links from Game Pass", "  perks and validates each gift code."],
  },
  claimer: {
    label: "Claimer", description: "Claim WLID tokens from accounts", section: "pullers",
    commands: (p) => [`${p}claim <email:pass> or attach .txt`, "  Extract WLID tokens from MS accounts."],
  },
  aio: {
    label: "AIO", description: "Full Microsoft account analysis", section: "checkers",
    commands: (p) => [`${p}aio <email:pass> or attach .txt`, "  Full Microsoft account analysis:", "  XGP, cards, MFA, bans, Minecraft,", "  rewards, and more."],
  },
  inbox: {
    label: "Inbox AIO", description: "Scan inboxes for 50+ services", section: "checkers",
    commands: (p) => [`${p}inboxaio <email:pass> or attach .txt`, "  Scans Hotmail/Outlook for 50+ services", "  (Netflix, Spotify, PayPal, ...)."],
  },
  countrysort: {
    label: "Country Sort", description: "Sort accounts by country (top 20)", section: "checkers",
    commands: (p) => [`${p}countrysort <email:pass> or attach .txt`, "  Sorts Microsoft accounts by country.", "  Shows the top 20 countries on UI."],
  },
  checker: {
    label: "Code Checker", description: "Check codes against WLID tokens", section: "checkers",
    commands: (p) => [`${p}check [wlids] + attach codes.txt`, "  Check codes against WLID tokens.", "  Uses stored WLIDs if none provided."],
  },
  refund: {
    label: "Refund", description: "Check refund eligibility (14-day)", section: "checkers",
    commands: (p) => [`${p}refund <email:pass> or attach .txt`, "  Checks if purchases are within the", "  14-day refund window."],
  },
  change: {
    label: "Password Changer", description: "Bulk change Microsoft account passwords", section: "checkers",
    commands: (p) => [
      `${p}change <newpass> <email:pass> or attach .txt`,
      "  Bulk-changes Microsoft account passwords",
      "  via account.live.com. Outputs split files:",
      "  changed.txt / failed.txt / 2fa.txt / locked.txt.",
    ],
  },
  bruv1: {
    label: "Chaturbate Bruter", description: "Bulk brute Chaturbate accounts", section: "checkers",
    commands: (p) => [
      `${p}bruv1 <user:pass> or attach .txt`,
      "  Brute-forces Chaturbate logins.",
      "  Outputs: hits.txt / banned.txt /",
      "  balancedhits.txt (tokens > 0).",
    ],
  },
  admin: {
    label: "Admin", description: "Authorization, blacklist & settings", section: "owner",
    commands: (p) => [
      `${p}wlidset <tokens> or attach .txt`,
      `${p}auth <@user> <duration>`,
      `${p}deauth <@user>`,
      `${p}authlist`,
      `${p}blacklist <@user> [reason]`,
      `${p}unblacklist <@user>`,
      `${p}blacklistshow`,
      `${p}admin | ${p}setwebhook <url>`,
      `${p}botstats | ${p}stats`,
    ],
  },
};

function helpOverviewEmbed(prefix, username) {
  return pullerStyle({
    title: "AutizMens",
    username,
    sections: [
      {
        heading: "Commands",
        lines: [
          `${prefix}help`,
          "  Browse every category via the menu below.",
          "",
          "Use the dropdown to view command groups:",
          "  -- Pullers --",
          "  • Puller       • Promo Puller",
          "  • Claimer",
          "  -- Checkers --",
          "  • AIO          • Inbox AIO",
          "  • Country Sort • Code Checker",
          "  • Refund",
        ],
      },
      {
        heading: "Output",
        lines: ["All results sent to your DMs."],
      },
    ],
  });
}

function helpCategoryEmbed(categoryKey, prefix, username) {
  // "home" returns to the overview
  if (categoryKey === "home") return helpOverviewEmbed(prefix, username);

  // Section-level views: render every command in that section
  if (HELP_SECTIONS[categoryKey]) {
    const section = HELP_SECTIONS[categoryKey];
    const sections = [];
    for (const catKey of section.categories) {
      const cat = HELP_CATEGORIES[catKey];
      if (!cat) continue;
      sections.push({ heading: cat.label, lines: cat.commands(prefix) });
    }
    sections.push({ heading: "Output", lines: ["All results sent to your DMs."] });
    return pullerStyle({
      title: section.title || section.label.replace(/-/g, "").trim(),
      username,
      sections,
    });
  }

  // Fallback: single-command view (legacy)
  const cat = HELP_CATEGORIES[categoryKey];
  if (!cat) return errorEmbed("Unknown category.", username);
  return pullerStyle({
    title: cat.label,
    username,
    sections: [
      { heading: "Commands", lines: cat.commands(prefix) },
      { heading: "Output", lines: ["All results sent to your DMs."] },
    ],
  });
}

function helpSelectMenu() {
  const options = [
    { label: "Home",     description: "Back to the help overview",       value: "home",     emoji: "🏠" },
    { label: "Pullers",  description: "Puller, Promo Puller, Claimer",   value: "pullers",  emoji: "📥" },
    { label: "Checkers", description: "AIO, Inbox, Country Sort, Code, Refund", value: "checkers", emoji: "✅" },
    { label: "Owner",    description: "Admin, auth & settings",          value: "owner",    emoji: "👑" },
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("help_category")
      .setPlaceholder("Select a category...")
      .addOptions(options)
  );
}

// ============================================================
//  Welcome — DISABLED (DMs are results+errors only)
// ============================================================
function welcomeEmbed(username) {
  // Intentionally returns null; index.js no-ops the welcome path.
  return null;
}

// ============================================================
//  Admin / Stats
// ============================================================

function adminPanelEmbed(stats, authCount, activeOtpSessions, activeProcesses, webhookSet, username) {
  return pullerStyle({
    title: "Admin Panel",
    username,
    sections: [
      {
        heading: "Users",
        lines: [
          `Authorized   : ${authCount}`,
          `OTP Sessions : ${activeOtpSessions}`,
          `Active Tasks : ${activeProcesses}`,
        ],
      },
      {
        heading: "Processing",
        lines: [
          `Total   : ${stats.total_processed}`,
          `Success : ${stats.total_success}`,
          `Failed  : ${stats.total_failed}`,
        ],
      },
      {
        heading: "Status",
        lines: [
          `Bot     : Online`,
          `Webhook : ${webhookSet ? "Set" : "Not Set"}`,
        ],
      },
    ],
  });
}

function detailedStatsEmbed(stats, topUsers, username) {
  const rate = stats.total_processed > 0
    ? Math.round((stats.total_success / stats.total_processed) * 100)
    : 0;
  const sections = [{
    heading: "Statistics",
    lines: [
      `Processed : ${stats.total_processed}`,
      `Success   : ${stats.total_success}`,
      `Failed    : ${stats.total_failed}`,
      `Rate      : ${rate}%`,
    ],
  }];
  if (topUsers.length > 0) {
    sections.push({
      heading: "Top Users",
      lines: topUsers.map(([uid, d]) => `<@${uid}> -- ${d.processed} (${d.success} ok)`),
    });
  }
  // Use live-style so user mentions render
  return pullerLive({ title: "Detailed Stats", username, sections, color: COLORS.PRIMARY });
}

// ============================================================
//  Recovery
// ============================================================

function recoverProgressEmbed(email, status, username) {
  return pullerStyle({
    title: "Account Recovery",
    username,
    color: COLORS.INFO,
    thumbnail: false,
    sections: [{ heading: "Progress", lines: [`Account: ${email}`, ``, status] }],
  });
}

function recoverResultEmbed(email, success, message, username) {
  return pullerStyle({
    title: success ? "Recovery Successful" : "Recovery Failed",
    username,
    color: success ? COLORS.SUCCESS : COLORS.ERROR,
    sections: [{
      heading: "Result",
      lines: [
        `Account: ${email}`,
        ``,
        message || (success ? "Password has been reset." : "Recovery failed."),
      ],
    }],
  });
}

// ============================================================
//  Inbox AIO
// ============================================================

function _serviceLines(serviceBreakdown, max = 30) {
  if (!serviceBreakdown || Object.keys(serviceBreakdown).length === 0) return ["No services detected."];
  const sorted = Object.entries(serviceBreakdown).sort((a, b) => b[1] - a[1]).slice(0, max);
  return sorted.map(([svc, count]) => `${svc.padEnd(18)} : ${count}`);
}

function inboxAioProgressEmbed({ completed, total, hits, fails, elapsed, latestAccount, latestStatus, serviceBreakdown, username }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((completed / elSec) * 60) : 0;
  const lines = [
    `[${_bar(pct)}] ${pct}%`,
    `Processed : ${completed} / ${total}`,
    `Hits      : ${hits}`,
    `Failed    : ${fails}`,
    `Speed     : ${cpm} c/min`,
    `Elapsed   : ${elSec}s`,
  ];
  if (latestAccount) {
    const masked = latestAccount.replace(/(.{3}).*(@.*)/, "$1***$2");
    lines.push(`Latest    : ${masked} (${latestStatus || "..."})`);
  }
  const sections = [{ heading: "Progress", lines }];
  if (serviceBreakdown && Object.keys(serviceBreakdown).length > 0) {
    sections.push({ heading: "Services", lines: _serviceLines(serviceBreakdown) });
  }
  return pullerStyle({ title: "Inbox AIO", username, color: COLORS.PRIMARY, thumbnail: false, sections });
}

function inboxAioResultsEmbed({ total, hits, fails, locked, twoFA, elapsed, serviceBreakdown, dmSent, username }) {
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((total / elSec) * 60) : 0;
  const lines = [
    `Checked  : ${total}`,
    `Valid    : ${hits}`,
    `Invalid  : ${fails}`,
    `Locked   : ${locked || 0}`,
    `2FA      : ${twoFA || 0}`,
    `Speed    : ${cpm} c/min`,
    `Elapsed  : ${elSec}s`,
  ];
  if (dmSent) lines.push("", "Results sent to your DMs.");
  const sections = [{ heading: "Results", lines }];
  sections.push({ heading: "Services", lines: _serviceLines(serviceBreakdown) });
  return pullerStyle({
    title: "Inbox AIO",
    username,
    color: hits > 0 ? COLORS.SUCCESS : COLORS.ERROR,
    sections,
  });
}

// ============================================================
//  Country Sort — top countries breakdown (Inbox AIO style UI)
// ============================================================

const COUNTRY_FLAGS = {
  US: "🇺🇸", GB: "🇬🇧", UK: "🇬🇧", CA: "🇨🇦", AU: "🇦🇺", NZ: "🇳🇿",
  DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", PT: "🇵🇹", NL: "🇳🇱",
  BE: "🇧🇪", SE: "🇸🇪", NO: "🇳🇴", DK: "🇩🇰", FI: "🇫🇮", IE: "🇮🇪",
  CH: "🇨🇭", AT: "🇦🇹", PL: "🇵🇱", CZ: "🇨🇿", GR: "🇬🇷", RO: "🇷🇴",
  HU: "🇭🇺", RU: "🇷🇺", UA: "🇺🇦", TR: "🇹🇷", IL: "🇮🇱", SA: "🇸🇦",
  AE: "🇦🇪", EG: "🇪🇬", ZA: "🇿🇦", NG: "🇳🇬", KE: "🇰🇪", MA: "🇲🇦",
  BR: "🇧🇷", AR: "🇦🇷", MX: "🇲🇽", CL: "🇨🇱", CO: "🇨🇴", PE: "🇵🇪",
  VE: "🇻🇪", CN: "🇨🇳", JP: "🇯🇵", KR: "🇰🇷", IN: "🇮🇳", PK: "🇵🇰",
  BD: "🇧🇩", ID: "🇮🇩", TH: "🇹🇭", VN: "🇻🇳", PH: "🇵🇭", MY: "🇲🇾",
  SG: "🇸🇬", HK: "🇭🇰", TW: "🇹🇼",
};

function _countryLines(countryBreakdown, max = 20) {
  if (!countryBreakdown || Object.keys(countryBreakdown).length === 0) return ["No countries detected."];
  const sorted = Object.entries(countryBreakdown).sort((a, b) => b[1] - a[1]).slice(0, max);
  const total = sorted.reduce((acc, [, c]) => acc + c, 0) || 1;
  return sorted.map(([code, count], i) => {
    const flag = COUNTRY_FLAGS[String(code).toUpperCase()] || "🏳️";
    const pct = Math.round((count / total) * 100);
    const rank = String(i + 1).padStart(2, " ");
    return `${rank}. ${flag} ${String(code).padEnd(8)} : ${String(count).padStart(4)}  (${pct}%)`;
  });
}

function countrySortProgressEmbed({ completed, total, hits, fails, elapsed, latestAccount, latestStatus, countryBreakdown, username }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((completed / elSec) * 60) : 0;
  const lines = [
    `[${_bar(pct)}] ${pct}%`,
    `Processed : ${completed} / ${total}`,
    `Hits      : ${hits}`,
    `Failed    : ${fails}`,
    `Speed     : ${cpm} c/min`,
    `Elapsed   : ${elSec}s`,
  ];
  if (latestAccount) {
    const masked = latestAccount.replace(/(.{3}).*(@.*)/, "$1***$2");
    lines.push(`Latest    : ${masked} (${latestStatus || "..."})`);
  }
  const sections = [{ heading: "Progress", lines }];
  if (countryBreakdown && Object.keys(countryBreakdown).length > 0) {
    sections.push({ heading: "Top Countries", lines: _countryLines(countryBreakdown, 20) });
  }
  return pullerStyle({ title: "Country Sort", username, color: COLORS.PRIMARY, thumbnail: false, sections });
}

function countrySortResultsEmbed({ total, hits, fails, locked, twoFA, elapsed, countryBreakdown, dmSent, username }) {
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((total / elSec) * 60) : 0;
  const uniqueCountries = countryBreakdown ? Object.keys(countryBreakdown).length : 0;
  const lines = [
    `Checked   : ${total}`,
    `Valid     : ${hits}`,
    `Invalid   : ${fails}`,
    `Locked    : ${locked || 0}`,
    `2FA       : ${twoFA || 0}`,
    `Countries : ${uniqueCountries}`,
    `Speed     : ${cpm} c/min`,
    `Elapsed   : ${elSec}s`,
  ];
  if (dmSent) lines.push("", "Results sent to your DMs.");
  const sections = [{ heading: "Results", lines }];
  sections.push({ heading: "Top 20 Countries", lines: _countryLines(countryBreakdown, 20) });
  return pullerStyle({
    title: "Country Sort",
    username,
    color: hits > 0 ? COLORS.SUCCESS : COLORS.ERROR,
    sections,
  });
}


// ============================================================

function prsProgressEmbed({ done, total, codesFound, category, working, failed, elapsed, latestAccount, username }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((done / elSec) * 60) : 0;
  const lines = [
    `[${_bar(pct)}] ${pct}%`,
    `Processed   : ${done} / ${total}`,
    `Codes Found : ${codesFound || 0}`,
    `Working     : ${working || 0}`,
    `Failed      : ${failed || 0}`,
    `Speed       : ${cpm} accts/min`,
    `Elapsed     : ${elSec}s`,
  ];
  if (latestAccount) {
    const masked = latestAccount.replace(/(.{3}).*(@.*)/, "$1***$2");
    lines.push(`Latest      : ${masked}`);
  }
  return pullerStyle({
    title: `PRS - ${(category || "All").toUpperCase()}`,
    username,
    color: COLORS.INFO,
    thumbnail: false,
    sections: [{ heading: "Progress", lines }],
  });
}

function prsResultsEmbed({ total, hits, valid, failed, twoFA, codesFound, category, elapsed, categoryBreakdown, username, dmSent }) {
  const elSec = elapsed ? Math.round(elapsed / 1000) : 0;
  const cpm = elSec > 0 ? Math.round((total / elSec) * 60) : 0;
  const lines = [
    `Checked      : ${total}`,
    `With Codes   : ${hits}`,
    `Valid Empty  : ${valid}`,
    `Failed       : ${failed}`,
  ];
  if (twoFA > 0) lines.push(`2FA          : ${twoFA}`);
  lines.push(``, `Total Codes  : ${codesFound}`, `Speed        : ${cpm} accts/min`, `Elapsed      : ${elSec}s`);
  if (dmSent) lines.push(``, `Results sent to your DMs.`);
  const sections = [{ heading: "Results", lines }];
  if (categoryBreakdown && Object.keys(categoryBreakdown).length > 0) {
    const sorted = Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]);
    sections.push({
      heading: "Categories",
      lines: sorted.map(([cat, c]) => `${cat.padEnd(18)} : ${c}`),
    });
  }
  return pullerStyle({
    title: `PRS - ${(category || "All").toUpperCase()}`,
    username,
    color: codesFound > 0 ? COLORS.SUCCESS : COLORS.ERROR,
    sections,
  });
}

// ============================================================
//  Refund
// ============================================================

function refundProgressEmbed(details) {
  const pct = details.total === 0 ? 0 : Math.round((details.done / details.total) * 100);
  const elapsed = details.startTime ? ((Date.now() - details.startTime) / 1000).toFixed(1) : "0.0";
  const lines = [
    `[${_bar(pct)}] ${pct}%`,
    `Processed    : ${details.done} / ${details.total}`,
    `Eligible     : ${details.hits || 0}`,
    `Not Eligible : ${details.noRefund || 0}`,
    `Locked / 2FA : ${details.locked || 0}`,
    `Failed       : ${details.failed || 0}`,
  ];
  if (details.lastAccount) {
    const masked = details.lastAccount.replace(/(.{3}).*(@.*)/, "$1***$2");
    lines.push(`Latest       : ${masked}`);
  }
  lines.push(``, `Time         : ${elapsed}s`);
  return pullerStyle({
    title: "Refund Checker",
    username: details.username,
    color: COLORS.INFO,
    thumbnail: false,
    sections: [{ heading: "Progress", lines }],
  });
}

function refundResultsEmbed(results, { elapsed, dmSent, username } = {}) {
  const hits = results.filter(r => r.status === "hit");
  const noRefund = results.filter(r => r.status === "free");
  const locked = results.filter(r => r.status === "locked");
  const failed = results.filter(r => r.status === "fail");
  const totalRefundable = hits.reduce((s, r) => s + (r.refundable?.length || 0), 0);
  const lines = [
    `Total Accounts  : ${results.length}`,
    `With Refundable : ${hits.length}`,
    `No Refundable   : ${noRefund.length}`,
    `Locked / 2FA    : ${locked.length}`,
    `Failed          : ${failed.length}`,
    ``,
    `Total Items     : ${totalRefundable}`,
  ];
  if (elapsed) lines.push(`Time            : ${elapsed}s`);
  if (dmSent) lines.push(``, `Results sent to your DMs.`);
  return pullerStyle({
    title: "Refund Checker",
    username,
    sections: [{ heading: "Results", lines }],
  });
}

// ============================================================
//  AIO
// ============================================================

function aioProgressEmbed(done, total, live = {}, username) {
  const E = PULLER_EMOJI;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return pullerLive({
    title: `${E.loading} AIO Checker`,
    username,
    color: COLORS.PRIMARY,
    thumbnail: false,
    sections: [
      {
        heading: "Progress",
        lines: [
          "```",
          `[${_bar(pct)}] ${pct}%`,
          `Checked : ${done} / ${total}`,
          "```",
        ],
      },
      {
        heading: `${E.working} Live Stats`,
        lines: [
          "```",
          `Hits        : ${live.hits || 0}`,
          `  XGP       : ${live.xgp || 0}`,
          `  XGPU      : ${live.xgpu || 0}`,
          `  Cards     : ${live.payment_methods || 0}`,
          `2FA         : ${live.twofa || 0}`,
          `Valid Mail  : ${live.valid_mail || 0}`,
          `Bad         : ${live.bad || 0}`,
          "```",
        ],
      },
      {
        heading: `${E.xbox} Microsoft`,
        lines: [
          "```",
          `Balance : ${live.ms_balance || 0}`,
          `Points  : ${live.ms_points || 0}`,
          "```",
        ],
      },
      {
        heading: "Security",
        lines: [
          "```",
          `MFA      : ${live.mfa || 0}`,
          `SFA      : ${live.sfa || 0}`,
          `Banned   : ${live.banned || 0}`,
          `Unbanned : ${live.unbanned || 0}`,
          "```",
        ],
      },
      {
        heading: "Performance",
        lines: [
          "```",
          `CPM    : ${live.cpm || 0}`,
          `Errors : ${live.errors || 0}`,
          "```",
        ],
      },
    ],
  });
}

function aioResultsEmbed(s, { dmSent, username } = {}) {
  const E = PULLER_EMOJI;
  const sections = [
    { heading: `${E.working} Account Analysis`, lines: [
      "```",
      `Total Checked : ${s.checked || 0}`,
      `Hits          : ${s.hits || 0}`,
      `  XGP         : ${s.xgp || 0}`,
      `  XGPU        : ${s.xgpu || 0}`,
      `  Cards       : ${s.payment_methods || 0}`,
      `2FA           : ${s.twofa || 0}`,
      `Valid Mail    : ${s.valid_mail || 0}`,
      `Bad           : ${s.bad || 0}`,
      "```",
    ]},
    { heading: `${E.xbox} Microsoft`, lines: [
      "```",
      `Balance : ${s.ms_balance || 0}`,
      `Points  : ${s.ms_points || 0}`,
      "```",
    ]},
    { heading: "Security", lines: [
      "```",
      `MFA      : ${s.mfa || 0}`,
      `SFA      : ${s.sfa || 0}`,
      `Banned   : ${s.banned || 0}`,
      `Unbanned : ${s.unbanned || 0}`,
      "```",
    ]},
    { heading: "Performance", lines: [
      "```",
      `CPM   : ${s.cpm || 0}`,
      `Time  : ${s.elapsed || "?"}`,
      "```",
    ]},
  ];
  if (dmSent) sections.push({ heading: `${E.upload} Output`, lines: ["Results sent to your DMs."] });
  return pullerLive({
    title: "AIO Checker",
    username,
    color: s.hits > 0 ? COLORS.SUCCESS : COLORS.ERROR,
    sections,
  });
}

// ============================================================
//  Gen / Stock / Misc
// ============================================================

function genHelpEmbed(prefix, username) {
  return pullerStyle({
    title: "Gen System",
    username,
    sections: [
      {
        heading: "User",
        lines: [
          `${prefix}gen <product> <amount>`,
          "  Pull stock items.",
          "  Users: 1/req, 200s cooldown. Admins: 50.",
          `${prefix}stock`,
          "  List all products and stock counts.",
        ],
      },
      {
        heading: "Stock Management",
        lines: [
          `${prefix}addstock <product> + attach .txt`,
          `${prefix}replacegenstock <product> + attach .txt`,
          `${prefix}downloadgenstock`,
        ],
      },
      { heading: "Output", lines: ["Items delivered via DM."] },
    ],
  });
}

function stockListEmbed(entries, username) {
  if (entries.length === 0) {
    return pullerStyle({
      title: "Stock",
      username,
      color: COLORS.MUTED,
      sections: [{ heading: "Products", lines: ["No products yet. Use .addstock to add some."] }],
    });
  }
  const lines = entries.map(e => `${e.name.padEnd(20)} : ${e.count}`);
  lines.push(``, `Total products : ${entries.length}`);
  return pullerStyle({
    title: "Stock",
    username,
    color: COLORS.INFO,
    sections: [{ heading: "Products", lines }],
  });
}

function unauthorisedEmbed(username) {
  return pullerStyle({
    title: "Unauthorised",
    username,
    color: COLORS.WARNING,
    sections: [{
      heading: "Access",
      lines: [
        "Reply 'milk' to this chat to gain auto access",
        "-- otherwise wait for the owner.",
      ],
    }],
  });
}

// ============================================================
//  Utility
// ============================================================

function textAttachment(lines, filename) {
  const buffer = Buffer.from(lines.join("\n"), "utf-8");
  return new AttachmentBuilder(buffer, { name: filename });
}

module.exports = {
  // core
  progressEmbed,
  checkResultsEmbed,
  claimResultsEmbed,
  // puller
  pullFetchProgressEmbed,
  pullLiveProgressEmbed,
  pullResultsEmbed,
  promoPullerFetchProgressEmbed,
  promoPullerResultsEmbed,
  // purchase
  purchaseProgressEmbed,
  purchaseResultsEmbed,
  productSearchEmbed,
  // checkers
  changerResultsEmbed,
  changerProgressEmbed,
  changerFinalEmbed,
  bruterProgressEmbed,
  bruterFinalEmbed,
  accountCheckerResultsEmbed,
  rewardsResultsEmbed,
  // generic
  errorEmbed,
  successEmbed,
  infoEmbed,
  ownerOnlyEmbed,
  authListEmbed,
  // help
  helpOverviewEmbed,
  helpCategoryEmbed,
  helpSelectMenu,
  // welcome (no-op)
  welcomeEmbed,
  // admin / stats
  adminPanelEmbed,
  detailedStatsEmbed,
  // utils
  textAttachment,
  // recovery
  recoverProgressEmbed,
  recoverResultEmbed,
  // inbox
  inboxAioProgressEmbed,
  inboxAioResultsEmbed,
  // country sort
  countrySortProgressEmbed,
  countrySortResultsEmbed,
  // PRS
  prsProgressEmbed,
  prsResultsEmbed,
  // refund
  refundProgressEmbed,
  refundResultsEmbed,
  // gen
  genHelpEmbed,
  stockListEmbed,
  unauthorisedEmbed,
  // aio
  aioProgressEmbed,
  aioResultsEmbed,
};
