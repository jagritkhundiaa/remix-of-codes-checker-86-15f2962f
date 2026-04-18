// ============================================================
//  MS Code Checker & WLID Claimer & Puller — Discord Bot
//  Supports both slash commands and dot-prefix commands
// ============================================================

const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require("discord.js");
const config = require("./config");
const { AuthManager, parseDuration, formatDuration, formatExpiry } = require("./utils/auth-manager");
const { ConcurrencyLimiter } = require("./utils/concurrency");
const { OTPManager } = require("./utils/otp-manager");
const { StatsManager } = require("./utils/stats-manager");
const { sendToWebhook } = require("./utils/webhook");
const { checkCodes } = require("./utils/microsoft-checker");
const { claimWlids } = require("./utils/microsoft-claimer");
const { pullCodes, pullLinks } = require("./utils/microsoft-puller");
const { checkRefundAccounts } = require("./utils/microsoft-refund");

const { checkInboxAccounts, getServiceCount } = require("./utils/microsoft-inbox");
const { searchProducts, getProductDetails, purchaseItems } = require("./utils/microsoft-purchaser");
// changer + recover modules removed per request
const { loadProxies, isProxyEnabled, getProxyCount, getProxyStats, reloadProxies } = require("./utils/proxy-manager");
const blacklist = require("./utils/blacklist");
const { setWlids, getWlids, getWlidCount } = require("./utils/wlid-store");
const welcomedStore = require("./utils/welcomed-store");
const autopilot = require("./utils/autopilot");
const antilink = require("./utils/antilink");
const gen = require("./utils/gen-manager");
const { extractCombos } = require("./utils/combo-extractor");
const {
  progressEmbed,
  checkResultsEmbed,
  claimResultsEmbed,
  pullFetchProgressEmbed,
  pullLiveProgressEmbed,
  pullResultsEmbed,
  promoPullerFetchProgressEmbed,
  promoPullerResultsEmbed,
  inboxAioProgressEmbed,
  inboxAioResultsEmbed,
  purchaseResultsEmbed,
  purchaseProgressEmbed,
  productSearchEmbed,
  accountCheckerResultsEmbed,
  rewardsResultsEmbed,
  refundProgressEmbed,
  refundResultsEmbed,
  netflixProgressEmbed,
  netflixResultsEmbed,
  netflixHitEmbed,
  steamProgressEmbed,
  steamResultsEmbed,
  steamHitEmbed,
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
} = require("./utils/embeds");
const { checkRewardsBalances } = require("./utils/microsoft-rewards");
const { checkNetflixAccounts } = require("./utils/netflix-checker");
const { checkSteamAccounts, shortenGames } = require("./utils/steam-checker");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

const auth = new AuthManager();
const limiter = new ConcurrencyLimiter(config.MAX_CONCURRENT_USERS);
const otpManager = new OTPManager();
const statsManager = new StatsManager();

// Webhook URL stored in memory (owner sets via /setwebhook)
let webhookUrl = "";

// Active abort controllers per user
const activeAborts = new Map();

// (recovery sessions removed)

// Welcome state is now persisted on disk (welcomedStore)

// ── Helpers ──────────────────────────────────────────────────

function isOwner(userId) {
  return userId === config.OWNER_ID;
}

// ── Channel enforcement ──────────────────────────────────────

const PULLER_CHECKER_CMDS = new Set(["pull", "promopuller", "check", "checker", "claim"]);
const INBOX_NORMAL_CMDS = new Set(["inboxaio", "rewards", "help", "stats", "search", "purchase", "wlidset", "refund", "netflix", "steam"]);

function getRequiredChannel(cmd) {
  if (PULLER_CHECKER_CMDS.has(cmd)) return config.ALLOWED_CHANNEL_PULLER;
  if (INBOX_NORMAL_CMDS.has(cmd)) return config.ALLOWED_CHANNEL_INBOX;
  return null; // admin commands work anywhere
}

function checkChannelAccess(channelId, cmd) {
  const required = getRequiredChannel(cmd);
  if (!required) return { allowed: true };
  if (channelId === required) return { allowed: true };
  return { allowed: false, requiredChannel: required };
}

function isAuthorizedAny(userId) {
  return isOwner(userId) || auth.isAuthorized(userId) || autopilot.isGranted(userId);
}

function canUse(userId) {
  if (blacklist.isBlacklisted(userId)) return false;
  const allowed = isAuthorizedAny(userId);
  if (allowed) otpManager.ensureAuthenticated(userId);
  return allowed;
}

/**
 * First-ever-DM welcome (persisted across restarts).
 * Accepts a Discord User object directly.
 */
async function sendWelcomeIfNeeded(user) {
  if (!user || welcomedStore.has(user.id)) return;
  welcomedStore.add(user.id);
  try {
    await user.send({ embeds: [welcomeEmbed(user.username)] });
  } catch {}
}

const MAX_COMBO_LINES = 4000;

// Smart combo input: extracts email:pass from raw or "dirty" lines.
// Falls back to plain split for non-combo data (codes, WLIDs).
function splitInput(raw) {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractCombosFromText(text) {
  return extractCombos(text, { max: MAX_COMBO_LINES });
}

async function fetchAttachmentLines(attachment) {
  if (!attachment) return [];
  const res = await fetch(attachment.url);
  const text = await res.text();
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

async function fetchAttachmentText(attachment) {
  if (!attachment) return "";
  const res = await fetch(attachment.url);
  return await res.text();
}

function stopButton(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stop_${userId}`)
      .setLabel("Stop")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function updateProgress(msg, embed, userId) {
  try {
    await msg.edit({ embeds: [embed], components: [stopButton(userId)] });
  } catch { /* ignore rate limits */ }
}

// ── WLID Set handler ────────────────────────────────────────

async function handleWlidSet(respond, userId, wlidsRaw, wlidsFile) {
  if (!isOwner(userId)) return respond({ embeds: [errorEmbed("Only the bot owner can set WLIDs.")] });

  let wlids = splitInput(wlidsRaw);
  if (wlidsFile) {
    const lines = await fetchAttachmentLines(wlidsFile);
    wlids = wlids.concat(lines);
  }

  if (wlids.length === 0) return respond({ embeds: [errorEmbed("No WLID tokens provided. Paste them or attach a `.txt` file.")] });

  setWlids(wlids);
  return respond({ embeds: [successEmbed(`WLID tokens updated. **${wlids.length}** tokens stored.\n\nPrevious tokens have been replaced.`)] });
}

// ── Check handler ────────────────────────────────────────────

async function handleCheck(respond, userId, wlidsRaw, codesRaw, codesFile, threads = 10, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "check");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    let wlids = splitInput(wlidsRaw);
    if (wlids.length === 0) wlids = getWlids();
    
    let codes = splitInput(codesRaw);
    if (codesFile) codes = codes.concat(await fetchAttachmentLines(codesFile));

    if (wlids.length === 0) return respond({ embeds: [errorEmbed("No WLID tokens provided and none stored.\nUse `/wlidset` or `.wlidset` to set WLIDs first, or provide them directly.")] });
    if (codes.length === 0) return respond({ embeds: [errorEmbed("No codes provided. Use the `codes` option or attach a `.txt` file.")] });
    if (codes.length > MAX_COMBO_LINES) return respond({ embeds: [errorEmbed(`Too many codes. Max ${MAX_COMBO_LINES} lines allowed.`)] });

    const msg = await respond({
      embeds: [progressEmbed(0, codes.length, `Checking codes (${wlids.length} WLIDs)`)],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    const results = await checkCodes(wlids, codes, threads, (done, total) => {
      const now = Date.now();
      if (now - lastUpdate > 2000) {
        lastUpdate = now;
        updateProgress(msg, progressEmbed(done, total, "Checking codes"), userId);
      }
    }, ac.signal);

    const stopped = ac.signal.aborted;
    const files = [];
    const valid = results.filter((r) => r.status === "valid");
    const used = results.filter((r) => r.status === "used");
    const expired = results.filter((r) => r.status === "expired");
    const invalid = results.filter((r) => r.status === "invalid" || r.status === "error");

    if (valid.length > 0)
      files.push(textAttachment(valid.map((r) => (r.title ? `${r.code} | ${r.title}` : r.code)), "valid.txt"));
    if (used.length > 0)
      files.push(textAttachment(used.map((r) => r.code), "used.txt"));
    if (expired.length > 0)
      files.push(textAttachment(expired.map((r) => (r.title ? `${r.code} | ${r.title}` : r.code)), "expired.txt"));
    if (invalid.length > 0)
      files.push(textAttachment(invalid.map((r) => r.code), "invalid.txt"));

    const embed = checkResultsEmbed(results);
    if (stopped) embed.setTitle("Check Results (Stopped)");

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [infoEmbed("Check Complete", "Results sent to your DMs.")], components: [] });
      } catch {
        await msg.edit({ embeds: [embed], files, components: [] });
      }
    } else {
      await msg.edit({ embeds: [embed], files, components: [] });
    }
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    activeAborts.delete(userId);
    limiter.release(userId);
  }
}

// ── Claim handler ────────────────────────────────────────────

async function handleClaim(respond, userId, accountsRaw, accountsFile, threads = 5, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "claim");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    const inlineText = accountsRaw || "";
    const fileText = accountsFile ? await fetchAttachmentText(accountsFile) : "";
    let accounts = extractCombosFromText(inlineText + "\n" + fileText);

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid email:password pairs found in your input.")] });
    if (accounts.length > MAX_COMBO_LINES) accounts = accounts.slice(0, MAX_COMBO_LINES);

    const msg = await respond({
      embeds: [progressEmbed(0, accounts.length, "Claiming WLIDs")],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    const results = await claimWlids(accounts, threads, (done, total) => {
      const now = Date.now();
      if (now - lastUpdate > 2000) {
        lastUpdate = now;
        updateProgress(msg, progressEmbed(done, total, "Claiming WLIDs"), userId);
      }
    }, ac.signal);

    const stopped = ac.signal.aborted;
    const files = [];
    const success = results.filter((r) => r.success && r.token);
    const failed = results.filter((r) => !r.success);

    if (success.length > 0)
      files.push(textAttachment(success.map((r) => r.token), "tokens.txt"));
    if (failed.length > 0)
      files.push(textAttachment(failed.map((r) => `${r.email}: ${r.error || "Unknown error"}`), "failed.txt"));

    const embed = claimResultsEmbed(results);
    if (stopped) embed.setTitle("Claim Results (Stopped)");

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [infoEmbed("Claim Complete", "Results sent to your DMs.")], components: [] });
      } catch {
        await msg.edit({ embeds: [embed], files, components: [] });
      }
    } else {
      await msg.edit({ embeds: [embed], files, components: [] });
    }
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    activeAborts.delete(userId);
    limiter.release(userId);
  }
}

// ── Pull handler ─────────────────────────────────────────────

async function handlePull(respond, userId, accountsRaw, accountsFile, dmUser = null, username = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "pull");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  const ac = new AbortController();
  activeAborts.set(userId, ac);
  const startTime = Date.now();

  try {
    const inlineText = accountsRaw || "";
    const fileText = accountsFile ? await fetchAttachmentText(accountsFile) : "";
    let accounts = extractCombosFromText(inlineText + "\n" + fileText);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid email:password pairs found in your input.")] });
    if (accounts.length > MAX_COMBO_LINES) accounts = accounts.slice(0, MAX_COMBO_LINES);

    const msg = await respond({
      embeds: [pullFetchProgressEmbed({ done: 0, total: accounts.length, totalCodes: 0, working: 0, failed: 0, withCodes: 0, noCodes: 0, startTime, username })],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    let totalCodesSoFar = 0;
    let lastAccount = "";
    let lastCodes = 0;
    let lastError = null;
    let fetchWorking = 0;
    let fetchFailed = 0;
    let fetchWithCodes = 0;
    let fetchNoCodes = 0;
    let fetchResultsRef = [];
    let validateCounts = {};

    const { fetchResults, validateResults } = await pullCodes(accounts, (phase, detail) => {
      const now = Date.now();

      if (phase === "fetch") {
        totalCodesSoFar += detail.codes;
        lastAccount = detail.email;
        lastCodes = detail.codes;
        lastError = detail.error;

        if (detail.error) {
          fetchFailed++;
        } else {
          fetchWorking++;
          if (detail.codes > 0) fetchWithCodes++;
          else fetchNoCodes++;
        }

        if (now - lastUpdate > 2000) {
          lastUpdate = now;
          updateProgress(msg, pullFetchProgressEmbed({
            done: detail.done,
            total: detail.total,
            totalCodes: totalCodesSoFar,
            working: fetchWorking,
            failed: fetchFailed,
            withCodes: fetchWithCodes,
            noCodes: fetchNoCodes,
            lastAccount,
            lastCodes,
            lastError,
            startTime,
            username,
          }), userId);
        }
      } else if (phase === "recheck_start") {
        // PRS second phase — UI shows recheck message
        updateProgress(msg, progressEmbed(0, detail.total, "Checking if no code is left..."), userId);
      } else if (phase === "recheck") {
        if (now - lastUpdate > 2000) {
          lastUpdate = now;
          updateProgress(msg, progressEmbed(detail.done, detail.total, "Checking if no code is left..."), userId);
        }
      } else if (phase === "validate_start") {
        // Capture fetch results for live display
        if (detail.fetchResults) fetchResultsRef = detail.fetchResults;
        // Recount totalCodes from fetchResults after PRS merge
        totalCodesSoFar = fetchResultsRef.reduce((sum, r) => sum + r.codes.length, 0);
        validateCounts = { done: 0, total: detail.total, valid: 0, used: 0, balance: 0, expired: 0, regionLocked: 0, invalid: 0 };
        updateProgress(msg, pullLiveProgressEmbed(fetchResultsRef, validateCounts, { username, startTime }), userId);
      } else if (phase === "validate") {
        validateCounts.done = detail.done;
        // Update counts from detail if available
        if (detail.status) {
          if (detail.status === "valid") validateCounts.valid++;
          else if (detail.status === "used" || detail.status === "REDEEMED") validateCounts.used++;
          else if (detail.status === "BALANCE_CODE") validateCounts.balance++;
          else if (detail.status === "expired" || detail.status === "EXPIRED") validateCounts.expired++;
          else if (detail.status === "REGION_LOCKED") validateCounts.regionLocked++;
          else if (detail.status === "invalid" || detail.status === "error" || detail.status === "INVALID") validateCounts.invalid++;
        }
        if (now - lastUpdate > 2000) {
          lastUpdate = now;
          updateProgress(msg, pullLiveProgressEmbed(fetchResultsRef, validateCounts, { username, startTime }), userId);
        }
      }
    }, ac.signal);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const stopped = ac.signal.aborted;
    const files = [];
    const valid = validateResults.filter((r) => r.status === "valid");
    const used = validateResults.filter((r) => r.status === "used");
    const expired = validateResults.filter((r) => r.status === "expired");
    const invalid = validateResults.filter((r) => r.status === "invalid" || r.status === "error");

    if (valid.length > 0)
      files.push(textAttachment(valid.map((r) => (r.title ? `${r.code} | ${r.title}` : r.code)), "valid.txt"));
    if (used.length > 0)
      files.push(textAttachment(used.map((r) => r.code), "used.txt"));
    if (expired.length > 0)
      files.push(textAttachment(expired.map((r) => (r.title ? `${r.code} | ${r.title}` : r.code)), "expired.txt"));
    if (invalid.length > 0)
      files.push(textAttachment(invalid.map((r) => r.code), "invalid.txt"));

    const embed = pullResultsEmbed(fetchResults, validateResults, {
      elapsed,
      dmSent: !!dmUser,
      username: username || undefined,
    });
    if (stopped) embed.setDescription(embed.data.description + "\n\n*Stopped -- partial results*");

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [pullResultsEmbed(fetchResults, validateResults, { elapsed, dmSent: true, username: username || undefined })], components: [] });
      } catch {
        await msg.edit({ embeds: [embed], files, components: [] });
      }
    } else {
      await msg.edit({ embeds: [embed], files, components: [] });
    }
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    activeAborts.delete(userId);
    limiter.release(userId);
  }
}

// ── PromoPuller handler ──────────────────────────────────────

async function handlePromoPuller(respond, userId, accountsRaw, accountsFile, dmUser = null, username = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "promopuller");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  const ac = new AbortController();
  activeAborts.set(userId, ac);
  const startTime = Date.now();

  try {
    let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
    if (accountsFile) {
      const lines = await fetchAttachmentLines(accountsFile);
      accounts = accounts.concat(lines.filter((l) => l.includes(":")));
    }

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });
    if (accounts.length > MAX_COMBO_LINES) return respond({ embeds: [errorEmbed(`Too many accounts. Max ${MAX_COMBO_LINES} lines allowed.`)] });

    const msg = await respond({
      embeds: [promoPullerFetchProgressEmbed({ done: 0, total: accounts.length, totalLinks: 0, working: 0, failed: 0, withLinks: 0, noLinks: 0, startTime, username })],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    let totalLinksSoFar = 0;
    let lastAccount = "";
    let lastLinks = 0;
    let lastError = null;
    let fetchWorking = 0;
    let fetchFailed = 0;
    let fetchWithLinks = 0;
    let fetchNoLinks = 0;

    const { fetchResults, allLinks } = await pullLinks(accounts, (phase, detail) => {
      const now = Date.now();

      if (phase === "fetch") {
        totalLinksSoFar += detail.links;
        lastAccount = detail.email;
        lastLinks = detail.links;
        lastError = detail.error;

        if (detail.error) {
          fetchFailed++;
        } else {
          fetchWorking++;
          if (detail.links > 0) fetchWithLinks++;
          else fetchNoLinks++;
        }

        if (now - lastUpdate > 2000) {
          lastUpdate = now;
          updateProgress(msg, promoPullerFetchProgressEmbed({
            done: detail.done,
            total: detail.total,
            totalLinks: totalLinksSoFar,
            working: fetchWorking,
            failed: fetchFailed,
            withLinks: fetchWithLinks,
            noLinks: fetchNoLinks,
            lastAccount,
            lastLinks,
            lastError,
            startTime,
            username,
          }), userId);
        }
      }
    }, ac.signal);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const stopped = ac.signal.aborted;
    const files = [];
    const uniqueLinks = [...new Set(allLinks)];

    if (allLinks.length > 0)
      files.push(textAttachment(allLinks, "links_all.txt"));
    if (uniqueLinks.length > 0 && uniqueLinks.length !== allLinks.length)
      files.push(textAttachment(uniqueLinks, "links_unique.txt"));

    // Per-account breakdown
    const perAccount = fetchResults
      .filter((r) => !r.error && r.links.length > 0)
      .map((r) => `${r.email}\n${r.links.join("\n")}`);
    if (perAccount.length > 0)
      files.push(textAttachment(perAccount, "links_by_account.txt"));

    const embed = promoPullerResultsEmbed(fetchResults, allLinks, {
      elapsed,
      dmSent: !!dmUser,
      username: username || undefined,
    });
    if (stopped) embed.setDescription(embed.data.description + "\n\n*Stopped -- partial results*");

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [promoPullerResultsEmbed(fetchResults, allLinks, { elapsed, dmSent: true, username: username || undefined })], components: [] });
      } catch {
        await msg.edit({ embeds: [embed], files, components: [] });
      }
    } else {
      await msg.edit({ embeds: [embed], files, components: [] });
    }
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    activeAborts.delete(userId);
    limiter.release(userId);
  }
}

// ── Refund handler ───────────────────────────────────────────

async function handleRefund(respond, userId, accountsRaw, accountsFile, threads = 5, dmUser = null, username = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "refund");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  const ac = new AbortController();
  activeAborts.set(userId, ac);
  const startTime = Date.now();

  try {
    let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
    if (accountsFile) {
      const lines = await fetchAttachmentLines(accountsFile);
      accounts = accounts.concat(lines.filter((l) => l.includes(":")));
    }

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });
    if (accounts.length > MAX_COMBO_LINES) return respond({ embeds: [errorEmbed(`Too many accounts. Max ${MAX_COMBO_LINES} lines allowed.`)] });

    const msg = await respond({
      embeds: [refundProgressEmbed({ done: 0, total: accounts.length, hits: 0, noRefund: 0, locked: 0, failed: 0, startTime, username })],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    let hits = 0, noRefund = 0, locked = 0, failed = 0;

    const results = await checkRefundAccounts(accounts, threads, (done, total, status) => {
      if (status === "hit") hits++;
      else if (status === "free") noRefund++;
      else if (status === "locked") locked++;
      else failed++;

      const now = Date.now();
      if (now - lastUpdate > 2000) {
        lastUpdate = now;
        const lastEmail = results.length > 0 ? results[results.length - 1]?.user : "";
        updateProgress(msg, refundProgressEmbed({
          done, total, hits, noRefund, locked, failed,
          lastAccount: lastEmail, startTime, username,
        }), userId);
      }
    }, ac.signal);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const stopped = ac.signal.aborted;
    const files = [];

    const hitResults = results.filter(r => r.status === "hit");
    const noRefundResults = results.filter(r => r.status === "free");
    const lockedResults = results.filter(r => r.status === "locked");
    const failedResults = results.filter(r => r.status === "fail");

    if (hitResults.length > 0) {
      const lines = hitResults.map(r => {
        const items = (r.refundable || []).map(i => `  ${i.title} | ${i.date} | ${i.days_ago}d ago | ${i.amount}`).join("\n");
        return `${r.user}:${r.password}\n${items}`;
      });
      files.push(textAttachment(lines, "Refundable.txt"));
    }
    if (noRefundResults.length > 0)
      files.push(textAttachment(noRefundResults.map(r => `${r.user}:${r.password}`), "No_Refund.txt"));
    if (lockedResults.length > 0)
      files.push(textAttachment(lockedResults.map(r => `${r.user}:${r.password} | ${r.detail}`), "Locked.txt"));
    if (failedResults.length > 0)
      files.push(textAttachment(failedResults.map(r => `${r.user}:${r.password} | ${r.detail}`), "Failed.txt"));

    // Log every refund check
    for (const r of results) {
      console.log(`[REFUND] User=${userId} Account=${r.user} Status=${r.status} Items=${r.refundable?.length || 0} Time=${new Date().toISOString()}`);
      statsManager.record(userId, "refund", r.status === "hit" || r.status === "free");
    }

    const embed = refundResultsEmbed(results, { elapsed, dmSent: !!dmUser, username: username || undefined });
    if (stopped) embed.setDescription(embed.data.description + "\n\n*Stopped -- partial results*");

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [refundResultsEmbed(results, { elapsed, dmSent: true, username: username || undefined })], components: [] });
      } catch {
        await msg.edit({ embeds: [embed], files, components: [] });
      }
    } else {
      await msg.edit({ embeds: [embed], files, components: [] });
    }
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    activeAborts.delete(userId);
    limiter.release(userId);
  }
}

async function handleAuth(respond, callerId, targetId, durationStr) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Only the bot owner can authorize users.")] });

  const ms = parseDuration(durationStr);
  if (ms === null) return respond({ embeds: [errorEmbed(`Invalid duration: \`${durationStr}\`\nExamples: 1h, 7d, 30d, 1mo, forever`)] });

  auth.authorize(targetId, ms, callerId);
  const durLabel = ms === Infinity ? "Permanent" : formatDuration(ms);
  return respond({ embeds: [successEmbed(`<@${targetId}> has been authorized for **${durLabel}**.`)] });
}

async function handleDeauth(respond, callerId, targetId) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Only the bot owner can deauthorize users.")] });
  auth.deauthorize(targetId);
  return respond({ embeds: [successEmbed(`<@${targetId}> has been deauthorized.`)] });
}

async function handleAuthList(respond) {
  const entries = auth.getAllAuthorized();
  return respond({ embeds: [authListEmbed(entries)] });
}

async function handleStats(respond) {
  const activeCount = limiter.getActiveCount();
  const authCount = auth.getAllAuthorized().length;
  const wlidCount = getWlidCount();
  const blCount = blacklist.getCount();
  const proxyStatus = isProxyEnabled() ? `Enabled (${getProxyCount()} loaded)` : "Disabled";
  const ps = getProxyStats();
  const proxyLine = isProxyEnabled()
    ? `Proxies: \`${proxyStatus}\`\nProxy requests: \`${ps.total}\` (${ps.successRate}% success)`
    : `Proxies: \`${proxyStatus}\``;

  return respond({
    embeds: [
      infoEmbed(
        "Bot Status",
        [
          `Active sessions: \`${activeCount}/${config.MAX_CONCURRENT_USERS}\``,
          `Authorized users: \`${authCount}\``,
          `Blacklisted users: \`${blCount}\``,
          `Stored WLIDs: \`${wlidCount}\``,
          proxyLine,
          `Uptime: \`${formatUptime(process.uptime())}\``,
          `Ping: \`${client.ws.ping}ms\``,
        ].join("\n")
      ),
    ],
  });
}

// ── Blacklist handlers ──────────────────────────────────────

async function handleBlacklist(respond, callerId, targetId, reason) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Only the bot owner can blacklist users.")] });
  if (targetId === callerId) return respond({ embeds: [errorEmbed("You cannot blacklist yourself.")] });
  blacklist.add(targetId, reason || "No reason");
  return respond({ embeds: [successEmbed(`<@${targetId}> has been blacklisted.\nReason: ${reason || "No reason"}`)] });
}

async function handleUnblacklist(respond, callerId, targetId) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Only the bot owner can unblacklist users.")] });
  const removed = blacklist.remove(targetId);
  if (!removed) return respond({ embeds: [errorEmbed("That user is not blacklisted.")] });
  return respond({ embeds: [successEmbed(`<@${targetId}> has been removed from the blacklist.`)] });
}

async function handleBlacklistShow(respond) {
  const entries = blacklist.getAll();
  if (entries.length === 0) {
    return respond({ embeds: [infoEmbed("Blacklist", "No blacklisted users.")] });
  }
  const lines = entries.map((e, i) => {
    const date = `<t:${Math.floor(e.addedAt / 1000)}:R>`;
    return `\`${i + 1}.\` <@${e.userId}> — ${e.reason} (${date})`;
  });
  return respond({ embeds: [infoEmbed("Blacklist", lines.join("\n"))] });
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

// ── Purchase handler ─────────────────────────────────────────

async function handlePurchase(respond, userId, accountsRaw, accountsFile, productUrl, dmUser = null) {
  if (!isOwner(userId)) return respond({ embeds: [ownerOnlyEmbed("Purchaser")] });

  const acquire = limiter.acquire(userId, "purchase");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
    if (accountsFile) {
      const lines = await fetchAttachmentLines(accountsFile);
      accounts = accounts.concat(lines.filter((l) => l.includes(":")));
    }

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });
    if (accounts.length > MAX_COMBO_LINES) return respond({ embeds: [errorEmbed(`Too many accounts. Max ${MAX_COMBO_LINES} lines allowed.`)] });
    if (!productUrl) return respond({ embeds: [errorEmbed("No product URL or ID provided.")] });

    // Extract product ID from URL or use directly
    let productId = productUrl.trim();
    const urlMatch = productId.match(/\/store\/[^/]+\/([a-zA-Z0-9]{12})/i) || productId.match(/\/p\/([a-zA-Z0-9]{12})/i);
    if (urlMatch) productId = urlMatch[1];

    // If it looks like a search query instead of an ID, search first
    if (productId.length > 12 || productId.includes(" ")) {
      const searchResults = await searchProducts(productId);
      if (searchResults.length === 0) return respond({ embeds: [errorEmbed(`No products found for: ${productId}`)] });
      
      const embed = productSearchEmbed(searchResults.slice(0, 5));
      return respond({ embeds: [embed, infoEmbed("Tip", "Copy the product ID and run the command again with it.")] });
    }

    // Get product details
    const product = await getProductDetails(productId);
    if (!product) return respond({ embeds: [errorEmbed(`Product not found: ${productId}`)] });
    if (!product.skus || product.skus.length === 0) return respond({ embeds: [errorEmbed(`No purchasable SKUs found for: ${product.title}`)] });

    // Use the first available SKU
    const sku = product.skus[0];

    let purchased = 0;
    let failed = 0;
    let lastResult = null;

    const msg = await respond({
      embeds: [purchaseProgressEmbed({
        product: product.title,
        price: `${sku.price} ${sku.currency}`,
        done: 0,
        total: accounts.length,
        phase: "login",
        currentAccount: accounts[0]?.split(":")[0] || "",
        purchased: 0,
        failed: 0,
      })],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    const results = await purchaseItems(
      accounts,
      productId,
      sku.skuId,
      sku.availabilityId,
      (phase, detail) => {
        if (phase === "result") {
          if (detail.success) purchased++;
          else failed++;
          lastResult = { email: detail.email, success: detail.success, orderId: detail.orderId, error: detail.error };
        }

        const now = Date.now();
        if (now - lastUpdate > 2000) {
          lastUpdate = now;
          updateProgress(msg, purchaseProgressEmbed({
            product: product.title,
            price: `${sku.price} ${sku.currency}`,
            done: detail.done || 0,
            total: detail.total || accounts.length,
            phase,
            currentAccount: detail.email,
            purchased,
            failed,
            lastResult,
          }), userId);
        }
      },
      ac.signal
    );

    const stopped = ac.signal.aborted;
    const files = [];
    const successful = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    if (successful.length > 0)
      files.push(textAttachment(successful.map(r => `${r.email} | ${r.orderId || "OK"}`), "purchased.txt"));
    if (failedResults.length > 0)
      files.push(textAttachment(failedResults.map(r => `${r.email} | ${r.error || "Failed"}`), "failed.txt"));

    const embed = purchaseResultsEmbed(results, product.title, `${sku.price} ${sku.currency}`);
    if (stopped) embed.setTitle("Purchase Results (Stopped)");

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [infoEmbed("Purchase Complete", "Results sent to your DMs.")], components: [] });
      } catch {
        await msg.edit({ embeds: [embed], files, components: [] });
      }
    } else {
      await msg.edit({ embeds: [embed], files, components: [] });
    }
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    activeAborts.delete(userId);
    limiter.release(userId);
  }
}

// ── Search handler ───────────────────────────────────────────

async function handleSearch(respond, query) {
  if (!query) return respond({ embeds: [errorEmbed("Provide a search query.")] });

  const results = await searchProducts(query);
  if (results.length === 0) return respond({ embeds: [errorEmbed(`No results for: ${query}`)] });

  return respond({ embeds: [productSearchEmbed(results.slice(0, 10))] });
}

// ── Changer handler removed ──────────────────────────────────


// ── Account checker handler ──────────────────────────────────

async function handleAccountChecker(respond, userId, accountsRaw, accountsFile, threads = 5, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "checker");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
    if (accountsFile) {
      const lines = await fetchAttachmentLines(accountsFile);
      accounts = accounts.concat(lines.filter((l) => l.includes(":")));
    }

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });
    if (accounts.length > MAX_COMBO_LINES) return respond({ embeds: [errorEmbed(`Too many accounts. Max ${MAX_COMBO_LINES} lines allowed.`)] });

    const msg = await respond({
      embeds: [progressEmbed(0, accounts.length, "Checking accounts")],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    const results = await checkAccounts(accounts, threads, (done, total) => {
      const now = Date.now();
      if (now - lastUpdate > 2000) {
        lastUpdate = now;
        updateProgress(msg, progressEmbed(done, total, "Checking accounts"), userId);
      }
    }, ac.signal);

    const stopped = ac.signal.aborted;
    const files = [];
    const valid = results.filter((r) => r.status === "valid");
    const locked = results.filter((r) => r.status === "locked");
    const invalid = results.filter((r) => r.status === "invalid");
    const failed = results.filter((r) => r.status !== "valid");

    if (valid.length > 0) files.push(textAttachment(valid.map((r) => `${r.email}`), "valid.txt"));
    if (locked.length > 0) files.push(textAttachment(locked.map((r) => `${r.email}: Account locked`), "locked.txt"));
    if (invalid.length > 0) files.push(textAttachment(invalid.map((r) => `${r.email}: Invalid credentials`), "invalid.txt"));
    if (failed.length > 0) files.push(textAttachment(failed.map((r) => `${r.email}: ${r.error || r.status || "Failed"}`), "failed.txt"));

    const embed = accountCheckerResultsEmbed(results);
    if (stopped) embed.setTitle("Account Checker Results (Stopped)");

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [infoEmbed("Checker Complete", "Results sent to your DMs.")], components: [] });
      } catch {
        await msg.edit({ embeds: [embed], files, components: [] });
      }
    } else {
      await msg.edit({ embeds: [embed], files, components: [] });
    }
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    activeAborts.delete(userId);
    limiter.release(userId);
  }
}

// ── Admin handlers ──────────────────────────────────────────

async function handleAdminPanel(respond, callerId) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Admin only.")] });

  const stats = statsManager.getSummary();
  const authCount = auth.getAllAuthorized().length;
  const otpSessions = otpManager.getActiveSessionCount();
  const activeProcesses = limiter.getActiveCount();
  const hasWebhook = !!webhookUrl;

  return respond({ embeds: [adminPanelEmbed(stats, authCount, otpSessions, activeProcesses, hasWebhook)] });
}

async function handleSetWebhook(respond, callerId, url) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Admin only.")] });

  if (!url.startsWith("https://discord.com/api/webhooks/")) {
    return respond({ embeds: [errorEmbed("Invalid webhook URL format.")] });
  }

  webhookUrl = url;
  return respond({ embeds: [successEmbed("Webhook URL configured successfully!")] });
}

async function handleBotStats(respond, callerId) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Admin only.")] });

  const stats = statsManager.getSummary();
  const topUsers = statsManager.getTopUsers(5);
  return respond({ embeds: [detailedStatsEmbed(stats, topUsers)] });
}

// ── Recovery / Captcha handlers removed ──────────────────────


// ── Rewards handler ─────────────────────────────────────────

async function handleRewards(respond, userId, accountsRaw, accountsFile, threads = 3, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "rewards");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
    if (accountsFile) {
      const lines = await fetchAttachmentLines(accountsFile);
      accounts = accounts.concat(lines.filter((l) => l.includes(":")));
    }

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });
    if (accounts.length > MAX_COMBO_LINES) return respond({ embeds: [errorEmbed(`Too many accounts. Max ${MAX_COMBO_LINES} lines allowed.`)] });

    const msg = await respond({
      embeds: [progressEmbed(0, accounts.length, "Checking Rewards Balances")],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    const results = await checkRewardsBalances(accounts, threads, (done, total) => {
      const now = Date.now();
      if (now - lastUpdate > 2000) {
        lastUpdate = now;
        updateProgress(msg, progressEmbed(done, total, "Checking Rewards Balances"), userId);
      }
    }, ac.signal);

    const stopped = ac.signal.aborted;
    const files = [];
    const success = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (success.length > 0) {
      files.push(textAttachment(
        success.map(r => `${r.email} | ${r.balance.toLocaleString()} pts | Level: ${r.levelName} | Lifetime: ${r.lifetimePoints.toLocaleString()} | Streak: ${r.streak}`),
        "rewards_balances.txt"
      ));
    }
    if (failed.length > 0) {
      files.push(textAttachment(failed.map(r => `${r.email} | ${r.error}`), "rewards_failed.txt"));
    }

    const embed = rewardsResultsEmbed(results);
    if (stopped) embed.setDescription(embed.data.description + "\n\n*Stopped -- partial results*");

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [infoEmbed("Rewards Check Complete", "Results sent to your DMs.")], components: [] });
      } catch {
        await msg.edit({ embeds: [embed], files, components: [] });
      }
    } else {
      await msg.edit({ embeds: [embed], files, components: [] });
    }
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    activeAborts.delete(userId);
    limiter.release(userId);
  }
}

// ── Inbox AIO handler ────────────────────────────────────────

async function handleInboxAio(respond, userId, accountsRaw, accountsFile, threads = 5, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "inboxaio");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
    if (accountsFile) {
      const lines = await fetchAttachmentLines(accountsFile);
      accounts = accounts.concat(lines.filter((l) => l.includes(":")));
    }

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });
    if (accounts.length > MAX_COMBO_LINES) return respond({ embeds: [errorEmbed(`Too many accounts. Max ${MAX_COMBO_LINES} lines allowed.`)] });

    const startTime = Date.now();
    const liveServiceBreakdown = {};

    const msg = await respond({
      embeds: [inboxAioProgressEmbed({ completed: 0, total: accounts.length, hits: 0, fails: 0, elapsed: 0, serviceBreakdown: {} })],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    let totalHits = 0;
    let totalFails = 0;
    const results = await checkInboxAccounts(accounts, threads, (done, total, status, hits, fails, lastResult) => {
      totalHits = hits || 0;
      totalFails = fails || 0;
      if (lastResult && lastResult.services) {
        for (const svcName of Object.keys(lastResult.services)) {
          liveServiceBreakdown[svcName] = (liveServiceBreakdown[svcName] || 0) + 1;
        }
      }
      const now = Date.now();
      if (now - lastUpdate > 2500) {
        lastUpdate = now;
        updateProgress(msg, inboxAioProgressEmbed({
          completed: done,
          total,
          hits: totalHits,
          fails: totalFails,
          elapsed: Date.now() - startTime,
          latestAccount: lastResult?.user || "",
          latestStatus: status || "",
          serviceBreakdown: { ...liveServiceBreakdown },
        }), userId);
      }
    }, ac.signal);

    const stopped = ac.signal.aborted;
    const elapsed = Date.now() - startTime;

    // Categorize results
    const hitResults = results.filter(r => r.status === "hit");
    const failResults = results.filter(r => r.status === "fail");
    const lockedResults = results.filter(r => r.status === "locked" || r.status === "custom");
    const twoFAResults = results.filter(r => r.status === "2fa");

    // Build service breakdown (how many accounts have each service)
    const serviceBreakdown = {};
    for (const r of hitResults) {
      for (const [svcName] of Object.entries(r.services || {})) {
        serviceBreakdown[svcName] = (serviceBreakdown[svcName] || 0) + 1;
      }
    }

    // Build per-service file content (new format: services = { Name: { count, subjects } })
    const zipEntries = [];
    const serviceFiles = {};
    for (const r of hitResults) {
      for (const [svcName, svcData] of Object.entries(r.services || {})) {
        if (!serviceFiles[svcName]) serviceFiles[svcName] = [];
        let line = `${r.user}:${r.password}`;
        if (r.name) line += ` | ${r.name}`;
        if (r.country) line += ` | ${r.country}`;
        if (svcData.count) line += ` | Found: ${svcData.count}`;
        if (svcData.subjects && svcData.subjects.length > 0) {
          line += ` | Subjects: ${svcData.subjects.slice(0, 5).join(", ")}`;
        }
        serviceFiles[svcName].push(line);
      }
    }

    // Per-service files
    for (const [svcName, lines] of Object.entries(serviceFiles)) {
      if (lines.length > 0) {
        const safeName = svcName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        zipEntries.push({ name: `${safeName}_hits.txt`, content: lines.join("\n") });
      }
    }

    // All hits combined
    if (hitResults.length > 0) {
      const allHitLines = hitResults.map(r => {
        const svcs = Object.entries(r.services || {}).map(([n, d]) => `${n}(${d.count})`).join(", ");
        let line = `${r.user}:${r.password}`;
        if (r.name) line += ` | ${r.name}`;
        if (r.country) line += ` | ${r.country}`;
        if (r.birthdate && r.birthdate !== "--") line += ` | ${r.birthdate}`;
        if (svcs) line += ` | ${svcs}`;
        return line;
      });
      zipEntries.push({ name: "all_hits.txt", content: allHitLines.join("\n") });
    }

    // Failed
    if (failResults.length > 0) {
      zipEntries.push({ name: "failed.txt", content: failResults.map(r => `${r.user}:${r.password} | ${r.detail || "failed"}`).join("\n") });
    }

    // Locked / 2FA
    if (lockedResults.length > 0) {
      zipEntries.push({ name: "locked.txt", content: lockedResults.map(r => `${r.user}:${r.password}`).join("\n") });
    }
    if (twoFAResults.length > 0) {
      zipEntries.push({ name: "2fa.txt", content: twoFAResults.map(r => `${r.user}:${r.password}`).join("\n") });
    }

    const embed = inboxAioResultsEmbed({
      total: results.length,
      hits: hitResults.length,
      fails: failResults.length,
      locked: lockedResults.length,
      twoFA: twoFAResults.length,
      elapsed,
      serviceBreakdown,
      username: dmUser?.username,
    });
    if (stopped) embed.setDescription(embed.data.description + "\n\n*Stopped -- partial results*");

    // Bundle all results into a single ZIP file
    const { AttachmentBuilder } = require("discord.js");
    const { buildZipBuffer } = require("./utils/zip-builder");
    const zipBuffer = buildZipBuffer(zipEntries);
    const zipFile = new AttachmentBuilder(zipBuffer, { name: "inboxaio_results.zip" });

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files: [zipFile] });
        await msg.edit({ embeds: [infoEmbed("Inbox AIO Complete", `Scanned ${results.length} accounts across ${getServiceCount()} services. Results sent to your DMs as a ZIP file.`)], components: [] });
      } catch {
        await msg.edit({ embeds: [embed], files: [zipFile], components: [] });
      }
    } else {
      await msg.edit({ embeds: [embed], files: [zipFile], components: [] });
    }

    statsManager.record(userId, "inboxaio", hitResults.length);

  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    activeAborts.delete(userId);
    limiter.release(userId);
  }
}

// ── Netflix Checker handler ─────────────────────────────────

async function handleNetflix(respond, userId, accountsRaw, accountsFile, threads = 10, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "netflix");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    let accounts = splitInput(accountsRaw);
    if (accountsFile) accounts = accounts.concat(await fetchAttachmentLines(accountsFile));
    accounts = accounts.filter((a) => a.includes(":"));

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided. Use email:password format.")] });
    if (accounts.length > MAX_COMBO_LINES) return respond({ embeds: [errorEmbed(`Too many accounts (max ${MAX_COMBO_LINES}).`)] });

    const nfxStats = { premium: 0, standard: 0, basic: 0, free: 0, cancelled: 0, invalid: 0, blocked: 0, timeout: 0, errors: 0 };
    let hits = [];

    const msg = await respond({ embeds: [netflixProgressEmbed(0, accounts.length, nfxStats)], components: [stopButton(userId)], fetchReply: true });
    const start = Date.now();
    let lastUpdate = 0;

    const results = await checkNetflixAccounts(accounts, Math.min(threads, 10), (checked, total, result) => {
      if (result) {
        if (result.status === "hit") {
          hits.push(result);
          const plan = (result.plan || "").toLowerCase();
          const status = (result.accountStatus || "").toLowerCase();
          if (plan.includes("premium")) nfxStats.premium++;
          else if (plan.includes("standard")) nfxStats.standard++;
          else if (plan.includes("basic")) nfxStats.basic++;
          if (status.includes("free") || status.includes("trial")) nfxStats.free++;
          else if (status.includes("cancel")) nfxStats.cancelled++;
        } else if (result.status === "invalid") nfxStats.invalid++;
        else if (result.status === "blocked") nfxStats.blocked++;
        else if (result.status === "timeout") nfxStats.timeout++;
        else nfxStats.errors++;
      }

      const now = Date.now();
      if (now - lastUpdate > 3000) {
        lastUpdate = now;
        updateProgress(msg, netflixProgressEmbed(checked, total, nfxStats), userId).catch(() => {});
      }
    }, ac.signal);

    const elapsed = Math.round((Date.now() - start) / 1000);

    // Build result files
    const { AttachmentBuilder } = require("discord.js");
    const files = [];

    if (hits.length > 0) {
      const allHits = hits.map((h) =>
        `Email: ${h.email}\nPassword: ${h.password}\nPlan: ${h.plan}\nStatus: ${h.accountStatus}\nPayment: ${h.payment}\nNext Billing: ${h.nextBilling}\nProfiles: ${h.profiles}\nCountry: ${h.country}\nCreated: ${h.created}\n${"=".repeat(30)}`
      ).join("\n\n");
      files.push(new AttachmentBuilder(Buffer.from(allHits, "utf-8"), { name: "netflix_hits.txt" }));
    }

    const embed = netflixResultsEmbed({
      total: accounts.length,
      hits: hits.length,
      invalid: nfxStats.invalid,
      blocked: nfxStats.blocked,
      timeout: nfxStats.timeout,
      errors: nfxStats.errors,
      premium: nfxStats.premium,
      standard: nfxStats.standard,
      basic: nfxStats.basic,
      free: nfxStats.free,
      cancelled: nfxStats.cancelled,
      elapsed,
      username: dmUser?.username,
    });

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [infoEmbed("Netflix Checker Complete", `Checked ${accounts.length} accounts. ${hits.length} hits found. Results sent to your DMs.`)], components: [] });
      } catch {
        await msg.edit({ embeds: [embed], files, components: [] });
      }
    } else {
      await msg.edit({ embeds: [embed], files, components: [] });
    }

    statsManager.record(userId, "netflix", hits.length);
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    activeAborts.delete(userId);
    limiter.release(userId);
  }
}

// ── Steam Checker handler ───────────────────────────────────

async function handleSteam(respond, userId, accountsRaw, accountsFile, threads = 15, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "steam");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    let accounts = splitInput(accountsRaw);
    if (accountsFile) accounts = accounts.concat(await fetchAttachmentLines(accountsFile));
    accounts = accounts.filter((a) => a.includes(":"));

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided. Use user:password format.")] });
    if (accounts.length > MAX_COMBO_LINES) return respond({ embeds: [errorEmbed(`Too many accounts (max ${MAX_COMBO_LINES}).`)] });

    const stStats = { valid: 0, invalid: 0 };
    let hits = [];

    const msg = await respond({ embeds: [steamProgressEmbed(0, accounts.length, stStats)], components: [stopButton(userId)], fetchReply: true });
    const start = Date.now();
    let lastUpdate = 0;

    const results = await checkSteamAccounts(accounts, Math.min(threads, 15), (checked, total, result) => {
      if (result) {
        stStats.valid++;
        hits.push(result);
      } else {
        stStats.invalid++;
      }

      const now = Date.now();
      if (now - lastUpdate > 3000) {
        lastUpdate = now;
        updateProgress(msg, steamProgressEmbed(checked, total, stStats), userId).catch(() => {});
      }
    }, ac.signal);

    const elapsed = Math.round((Date.now() - start) / 1000);

    // Build result files
    const { AttachmentBuilder } = require("discord.js");
    const files = [];

    if (hits.length > 0) {
      const allHits = hits.map((h) => {
        const gamesList = shortenGames(h.games, 10);
        return `Username: ${h.username}\nPassword: ${h.password}\nEmail: ${h.email}\nBalance: ${h.balance}\nCountry: ${h.country}\nTotal Games: ${h.totalGames}\nGames: ${gamesList}\nLevel: ${h.level}\nLimited: ${h.limited}\nVAC Bans: ${h.vacBans}\nGame Bans: ${h.gameBans}\nCommunity Ban: ${h.communityBan}\n${"=".repeat(30)}`;
      }).join("\n\n");
      files.push(new AttachmentBuilder(Buffer.from(allHits, "utf-8"), { name: "steam_hits.txt" }));

      // Separate with/without email
      const withEmail = hits.filter((h) => h.email && h.email !== "Unknown");
      const withoutEmail = hits.filter((h) => !h.email || h.email === "Unknown");

      if (withEmail.length > 0) {
        const data = withEmail.map((h) => `${h.username}:${h.password}\n${h.email}:${h.password}`).join("\n");
        files.push(new AttachmentBuilder(Buffer.from(data, "utf-8"), { name: "valid_with_email.txt" }));
      }
      if (withoutEmail.length > 0) {
        const data = withoutEmail.map((h) => `${h.username}:${h.password}`).join("\n");
        files.push(new AttachmentBuilder(Buffer.from(data, "utf-8"), { name: "valid_without_email.txt" }));
      }
    }

    const embed = steamResultsEmbed({
      total: accounts.length,
      valid: stStats.valid,
      invalid: stStats.invalid,
      elapsed,
      username: dmUser?.username,
    });

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [infoEmbed("Steam Checker Complete", `Checked ${accounts.length} accounts. ${stStats.valid} valid found. Results sent to your DMs.`)], components: [] });
      } catch {
        await msg.edit({ embeds: [embed], files, components: [] });
      }
    } else {
      await msg.edit({ embeds: [embed], files, components: [] });
    }

    statsManager.record(userId, "steam", stStats.valid);
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    activeAborts.delete(userId);
    limiter.release(userId);
  }
}

// ── Slash Commands ───────────────────────────────────────────


client.on("interactionCreate", async (interaction) => {
  // Handle stop button clicks
  if (interaction.isButton() && interaction.customId.startsWith("stop_")) {
    const targetUserId = interaction.customId.replace("stop_", "");
    if (interaction.user.id !== targetUserId && !isOwner(interaction.user.id)) {
      return interaction.reply({ content: "Only the command author can stop this.", ephemeral: true });
    }
    const ac = activeAborts.get(targetUserId);
    if (ac) {
      ac.abort();
      await interaction.reply({ embeds: [infoEmbed("Stopped", "Process is stopping. Partial results will be shown.")], ephemeral: true });
    } else {
      await interaction.reply({ content: "No active process found.", ephemeral: true });
    }
    return;
  }

  // Handle help category select menu
  if (interaction.isStringSelectMenu() && interaction.customId === "help_category") {
    const category = interaction.values[0];
    const prefix = config.PREFIX;
    await interaction.update({ embeds: [helpCategoryEmbed(category, prefix)], components: [helpSelectMenu()] });
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction;

  // Per-command channel enforcement
  const channelCheck = checkChannelAccess(interaction.channelId, commandName);
  if (!channelCheck.allowed) {
    return interaction.reply({
      embeds: [errorEmbed(`This command can only be used in <#${channelCheck.requiredChannel}>.`)],
      ephemeral: true,
    });
  }

  const respond = (opts) => {
    if (interaction.deferred || interaction.replied) return interaction.editReply(opts);
    return interaction.reply(opts);
  };

  // Send welcome on first use (to DMs)
  await sendWelcomeIfNeeded(async (opts) => {
    try { await user.send(opts); } catch {}
  }, user.id, user.username);

  try {
    if (commandName === "check") {
      await interaction.deferReply();
      const wlids = interaction.options.getString("wlids");
      const codes = interaction.options.getString("codes");
      const codesFile = interaction.options.getAttachment("codes_file");
      const threads = interaction.options.getInteger("threads") || 10;
      await handleCheck(respond, user.id, wlids, codes, codesFile, threads, user);
    }

    else if (commandName === "claim") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const threads = interaction.options.getInteger("threads") || 5;
      await handleClaim(respond, user.id, accounts, accountsFile, threads, user);
    }

    else if (commandName === "pull") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      await handlePull(respond, user.id, accounts, accountsFile, user, user.username);
    }

    else if (commandName === "promopuller") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      await handlePromoPuller(respond, user.id, accounts, accountsFile, user, user.username);
    }

    else if (commandName === "inboxaio") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const threads = interaction.options.getInteger("threads") || 5;
      await handleInboxAio(respond, user.id, accounts, accountsFile, threads, user);
    }

    else if (commandName === "wlidset") {
      const wlids = interaction.options.getString("wlids");
      const wlidsFile = interaction.options.getAttachment("wlids_file");
      await handleWlidSet(respond, user.id, wlids, wlidsFile);
    }

    else if (commandName === "auth") {
      const target = interaction.options.getUser("user");
      const duration = interaction.options.getString("duration");
      await handleAuth(respond, user.id, target.id, duration);
    }

    else if (commandName === "deauth") {
      const target = interaction.options.getUser("user");
      await handleDeauth(respond, user.id, target.id);
    }

    else if (commandName === "authlist") {
      await handleAuthList(respond);
    }

    else if (commandName === "blacklist") {
      const target = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason");
      await handleBlacklist(respond, user.id, target.id, reason);
    }

    else if (commandName === "unblacklist") {
      const target = interaction.options.getUser("user");
      await handleUnblacklist(respond, user.id, target.id);
    }

    else if (commandName === "blacklistshow") {
      await handleBlacklistShow(respond);
    }

    else if (commandName === "stats") {
      await handleStats(respond);
    }

    else if (commandName === "purchase") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const product = interaction.options.getString("product");
      await handlePurchase(respond, user.id, accounts, accountsFile, product, user);
    }

    else if (commandName === "search") {
      await interaction.deferReply();
      const query = interaction.options.getString("query");
      await handleSearch(respond, query);
    }

    // changer command removed


    else if (commandName === "checker") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const threads = interaction.options.getInteger("threads") || 5;
      await handleAccountChecker(respond, user.id, accounts, accountsFile, threads, user);
    }

    else if (commandName === "refund") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const threads = interaction.options.getInteger("threads") || 5;
      await handleRefund(respond, user.id, accounts, accountsFile, threads, user, user.username);
    }

    else if (commandName === "netflix") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const threads = interaction.options.getInteger("threads") || 10;
      await handleNetflix(respond, user.id, accounts, accountsFile, threads, user);
    }

    else if (commandName === "steam") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const threads = interaction.options.getInteger("threads") || 15;
      await handleSteam(respond, user.id, accounts, accountsFile, threads, user);
    }

    else if (commandName === "help") {
      await respond({ embeds: [helpOverviewEmbed("/")], components: [helpSelectMenu()] });
    }

    else if (commandName === "rewards") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const threads = interaction.options.getInteger("threads") || 3;
      await handleRewards(respond, user.id, accounts, accountsFile, threads, user);
    }


    // recover + captcha commands removed


    // ── Admin commands ──
    else if (commandName === "admin") {
      await handleAdminPanel(respond, user.id);
    }

    else if (commandName === "setwebhook") {
      const url = interaction.options.getString("url");
      await handleSetWebhook(respond, user.id, url);
    }

    else if (commandName === "botstats") {
      await handleBotStats(respond, user.id);
    }
  } catch (err) {
    console.error(`Slash command error [${commandName}]:`, err);
    try { await respond({ embeds: [errorEmbed(err.message)] }); } catch {}
  }
});

// ── Dot Prefix Commands ──────────────────────────────────────

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(config.PREFIX)) return;


  const args = message.content.slice(config.PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  if (!cmd) return;

  // Per-command channel enforcement
  const channelCheck = checkChannelAccess(message.channelId, cmd);
  if (!channelCheck.allowed) {
    return message.reply({
      embeds: [errorEmbed(`This command can only be used in <#${channelCheck.requiredChannel}>.`)],
    });
  }

  const respond = (opts) => message.reply(opts);
  // Send welcome on first use
  await sendWelcomeIfNeeded(async (opts) => {
    try { await message.author.send(opts); } catch {}
  }, message.author.id, message.author.username);

  try {
    if (cmd === "check") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        const storedCount = getWlidCount();
        const storedInfo = storedCount > 0 ? `\n\n**${storedCount} WLIDs stored** — just attach codes.txt to use them.` : "\n\nNo WLIDs stored. Use `.wlidset` first or provide WLIDs inline.";
        return respond({ embeds: [infoEmbed("Usage", "`.check [wlid_tokens]` + attach codes.txt\n\nIf WLIDs are stored via `.wlidset`, just attach codes.\nResults are always sent to your DMs." + storedInfo)] });
      }
      await handleCheck(respond, message.author.id, accountsRaw, null, attachment, 10, message.author);
    }

    else if (cmd === "claim") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.claim <accounts>`\nProvide email:password comma-separated or attach a `.txt` file.\nResults are always sent to your DMs.")] });
      }
      await handleClaim(respond, message.author.id, accountsRaw, attachment, 5, message.author);
    }

    else if (cmd === "pull") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.pull <accounts>`\nProvide email:password comma-separated or attach a `.txt` file.\nResults are always sent to your DMs.")] });
      }
      await handlePull(respond, message.author.id, accountsRaw, attachment, message.author, message.author.username);
    }

    else if (cmd === "promopuller") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.promopuller <accounts>`\nProvide email:password comma-separated or attach a `.txt` file.\nPulls promo links only. Results sent to your DMs.")] });
      }
      await handlePromoPuller(respond, message.author.id, accountsRaw, attachment, message.author, message.author.username);
    }

    else if (cmd === "inboxaio") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", `\`.inboxaio <accounts>\` or attach a .txt file\n\nScans Hotmail/Outlook inboxes for ${getServiceCount()}+ services.\nResults sent to your DMs as organized files.`)] });
      }
      await handleInboxAio(respond, message.author.id, accountsRaw, attachment, 5, message.author);
    }

    else if (cmd === "wlidset") {
      const wlidsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!wlidsRaw && !attachment) {
        const storedCount = getWlidCount();
        return respond({ embeds: [infoEmbed("Usage", `\`.wlidset <wlid_tokens>\` or attach a .txt file\n\nReplaces all previously stored WLIDs.\n\nCurrently stored: **${storedCount}** WLIDs`)] });
      }
      await handleWlidSet(respond, message.author.id, wlidsRaw, attachment);
    }

    else if (cmd === "auth") {
      if (args.length < 2) {
        return respond({ embeds: [infoEmbed("Usage", "`.auth <@user or user_id> <duration>`\n\nDuration examples: `1h`, `7d`, `30d`, `1mo`, `forever`")] });
      }
      let targetId = args[0].replace(/[<@!>]/g, "");
      const duration = args.slice(1).join(" ");
      await handleAuth(respond, message.author.id, targetId, duration);
    }

    else if (cmd === "deauth") {
      if (args.length < 1) {
        return respond({ embeds: [infoEmbed("Usage", "`.deauth <@user or user_id>`")] });
      }
      let targetId = args[0].replace(/[<@!>]/g, "");
      await handleDeauth(respond, message.author.id, targetId);
    }

    else if (cmd === "authlist") {
      await handleAuthList(respond);
    }

    else if (cmd === "blacklist") {
      if (args.length < 1) {
        return respond({ embeds: [infoEmbed("Usage", "`.blacklist <@user or user_id> [reason]`")] });
      }
      let targetId = args[0].replace(/[<@!>]/g, "");
      const reason = args.slice(1).join(" ") || "No reason";
      await handleBlacklist(respond, message.author.id, targetId, reason);
    }

    else if (cmd === "unblacklist") {
      if (args.length < 1) {
        return respond({ embeds: [infoEmbed("Usage", "`.unblacklist <@user or user_id>`")] });
      }
      let targetId = args[0].replace(/[<@!>]/g, "");
      await handleUnblacklist(respond, message.author.id, targetId);
    }

    else if (cmd === "blacklistshow") {
      await handleBlacklistShow(respond);
    }

    else if (cmd === "stats") {
      await handleStats(respond);
    }

    else if (cmd === "purchase") {
      const productArg = args.pop();
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!productArg && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.purchase <accounts> <product_id_or_url>`\nProvide email:password and a product ID or Microsoft Store URL.\nResults are always sent to your DMs.")] });
      }
      await handlePurchase(respond, message.author.id, accountsRaw, attachment, productArg, message.author);
    }

    else if (cmd === "search") {
      const query = args.join(" ");
      await handleSearch(respond, query);
    }

    // .changer removed


    else if (cmd === "checker") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.checker <accounts>`\nProvide email:password accounts or attach a `.txt` file.\nResults are always sent to your DMs.")] });
      }
      await handleAccountChecker(respond, message.author.id, accountsRaw, attachment, 5, message.author);
    }

    else if (cmd === "netflix") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.netflix <accounts>`\nProvide email:password or attach a `.txt` file.\nChecks Netflix accounts. Results sent to your DMs.")] });
      }
      await handleNetflix(respond, message.author.id, accountsRaw, attachment, 10, message.author);
    }

    else if (cmd === "steam") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.steam <accounts>`\nProvide user:password or attach a `.txt` file.\nChecks Steam accounts. Results sent to your DMs.")] });
      }
      await handleSteam(respond, message.author.id, accountsRaw, attachment, 15, message.author);
    }

    else if (cmd === "help") {
      return respond({ embeds: [helpOverviewEmbed(config.PREFIX)], components: [helpSelectMenu()] });
    }

    else if (cmd === "refund") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.refund <accounts>`\nProvide email:password or attach a `.txt` file.\nChecks refund eligibility (14-day window).\nResults are always sent to your DMs.")] });
      }
      await handleRefund(respond, message.author.id, accountsRaw, attachment, 5, message.author, message.author.username);
    }

    else if (cmd === "rewards") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.rewards <accounts>`\nProvide email:password or attach a `.txt` file.\nResults are always sent to your DMs.")] });
      }
      await handleRewards(respond, message.author.id, accountsRaw, attachment, 3, message.author);
    }


    else if (cmd === "recover") {
      const newPassword = args.pop();
      const emailsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!emailsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.recover <email(s)> <new_password>`\nProvide email(s) or attach a `.txt` file.\nResults are always sent to your DMs.")] });
      }
      if (!newPassword) {
        return respond({ embeds: [errorEmbed("Provide the new password as the last argument.")] });
      }
      await handleRecover(respond, message.author.id, emailsRaw, attachment, newPassword, 1, message.author, null, message);
    }

    else if (cmd === "captcha") {
      const solution = args.join(" ");
      if (!solution) {
        return respond({ embeds: [infoEmbed("Usage", "`.captcha <solution>`\n\nSubmit the CAPTCHA solution for an active recovery session.")] });
      }
      await handleCaptchaSolve(respond, message.author.id, solution);
    }

    // ── Admin commands (prefix) ──
    else if (cmd === "admin") {
      await handleAdminPanel(respond, message.author.id);
    }

    else if (cmd === "setwebhook") {
      const url = args[0];
      if (!url) return respond({ embeds: [errorEmbed("Usage: `.setwebhook <url>`")] });
      await handleSetWebhook(respond, message.author.id, url);
    }

    else if (cmd === "botstats") {
      await handleBotStats(respond, message.author.id);
    }
  } catch (err) {
    console.error(`Prefix command error [${cmd}]:`, err);
    try { await respond({ embeds: [errorEmbed(err.message)] }); } catch {}
  }
});

// ── Ready ────────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
  console.log(`Owner: ${config.OWNER_ID}`);
  console.log(`Max concurrent users: ${config.MAX_CONCURRENT_USERS}`);
  console.log(`Stored WLIDs: ${getWlidCount()}`);
  
  // Load proxies on startup
  const proxyCount = loadProxies();
  console.log(`Proxies: ${config.USE_PROXIES ? `Enabled (${proxyCount} loaded)` : "Disabled"}`);
  
  // Dynamic rich presence — cycles through stats
  const presenceMessages = [
    () => ({ name: ".gg/autizmens", type: 3 }),
    () => ({ name: `${getWlidCount()} WLIDs stored`, type: 3 }),
    () => ({ name: `${auth.getAllAuthorized().length} users authorized`, type: 3 }),
    () => ({ name: `${limiter.getActiveCount()} active sessions`, type: 3 }),
    () => {
      const s = statsManager.getSummary();
      return { name: `${s.total_processed} processed`, type: 3 };
    },
    () => ({ name: ".help | .pull | .check", type: 2 }),
  ];

  let presenceIndex = 0;
  function cyclePresence() {
    const activity = presenceMessages[presenceIndex % presenceMessages.length]();
    client.user.setPresence({
      status: "online",
      activities: [activity],
    });
    presenceIndex++;
  }

  cyclePresence();
  setInterval(cyclePresence, 15000); // cycle every 15 seconds
});

client.login(config.BOT_TOKEN);
