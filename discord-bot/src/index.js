// ============================================================
//  MS Code Checker & WLID Claimer & Puller — Discord Bot
//  Supports both slash commands and dot-prefix commands
// ============================================================

const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const config = require("./config");
const { AuthManager, parseDuration, formatDuration } = require("./utils/auth-manager");
const { ConcurrencyLimiter } = require("./utils/concurrency");
const { OTPManager } = require("./utils/otp-manager");
const { StatsManager } = require("./utils/stats-manager");
const { checkCodes } = require("./utils/microsoft-checker");
const { claimWlids } = require("./utils/microsoft-claimer");
const { pullCodes, pullLinks } = require("./utils/microsoft-puller");
const { checkRefundAccounts } = require("./utils/microsoft-refund");
const { checkInboxAccounts, getServiceCount } = require("./utils/microsoft-inbox");
const { loadProxies, isProxyEnabled, getProxyCount, getProxyStats } = require("./utils/proxy-manager");
const blacklist = require("./utils/blacklist");
const { setWlids, getWlids, getWlidCount } = require("./utils/wlid-store");
const { WelcomeStore } = require("./utils/welcome-store");
const { AutopilotManager, TEN_DAYS_MS } = require("./utils/autopilot");
const { AntiLink } = require("./utils/antilink");
const { GenManager } = require("./utils/gen-manager");
const { extractCombos } = require("./utils/combo-extract");
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
  rewardsResultsEmbed,
  refundProgressEmbed,
  refundResultsEmbed,
  netflixProgressEmbed,
  netflixResultsEmbed,
  steamProgressEmbed,
  steamResultsEmbed,
  xboxChkProgressEmbed,
  xboxChkResultsEmbed,
  aioProgressEmbed,
  aioResultsEmbed,
  errorEmbed,
  successEmbed,
  infoEmbed,
  authListEmbed,
  helpOverviewEmbed,
  helpCategoryEmbed,
  helpSelectMenu,
  welcomeEmbed,
  adminPanelEmbed,
  detailedStatsEmbed,
  textAttachment,
  genHelpEmbed,
  stockListEmbed,
  unauthorisedEmbed,
} = require("./utils/embeds");
const { checkRewardsBalances } = require("./utils/microsoft-rewards");
const { checkNetflixAccounts } = require("./utils/netflix-checker");
const { checkSteamAccounts, shortenGames } = require("./utils/steam-checker");
const { checkXboxAccounts } = require("./utils/xbox-full-checker");
const { runAioCheck } = require("./utils/meowmal-aio");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel],
});

const auth = new AuthManager();
const limiter = new ConcurrencyLimiter(config.MAX_CONCURRENT_USERS);
const otpManager = new OTPManager();
const statsManager = new StatsManager();
const welcomeStore = new WelcomeStore();
const autopilot = new AutopilotManager();
const antilink = new AntiLink();
const gen = new GenManager();

let webhookUrl = "";
const activeAborts = new Map();

const MAX_COMBO_LINES = 4000;

// ── Helpers ──────────────────────────────────────────────────

function isOwner(userId) {
  return userId === config.OWNER_ID;
}

// ── Channel enforcement ──────────────────────────────────────

const PULLER_CHECKER_CMDS = new Set(["pull", "promopuller", "check", "checker", "claim"]);
const INBOX_NORMAL_CMDS = new Set(["inboxaio", "rewards", "help", "stats", "wlidset", "refund", "netflix", "steam", "xboxchk", "aio"]);

function getRequiredChannel(cmd) {
  if (PULLER_CHECKER_CMDS.has(cmd)) return config.ALLOWED_CHANNEL_PULLER;
  if (INBOX_NORMAL_CMDS.has(cmd)) return config.ALLOWED_CHANNEL_INBOX;
  return null;
}

function checkChannelAccess(channelId, cmd) {
  const required = getRequiredChannel(cmd);
  if (!required) return { allowed: true };
  if (channelId === required) return { allowed: true };
  return { allowed: false, requiredChannel: required };
}

function canUse(userId) {
  if (blacklist.isBlacklisted(userId)) return false;
  const allowed = isOwner(userId) || auth.isAuthorized(userId);
  if (allowed) otpManager.ensureAuthenticated(userId);
  return allowed;
}

/**
 * First-time welcome DM. Persisted across restarts via WelcomeStore.
 */
async function sendWelcomeIfNeeded(userId, username, userObj) {
  if (welcomeStore.has(userId)) return;
  welcomeStore.mark(userId);
  try { await userObj.send({ embeds: [welcomeEmbed(username)] }); } catch {}
}

function splitInput(raw) {
  if (!raw) return [];
  return raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

async function fetchAttachmentLines(attachment) {
  if (!attachment) return "";
  const res = await fetch(attachment.url);
  return await res.text();
}

/**
 * Combine raw inline text + optional attachment, then extract clean email:password
 * pairs. Caps at MAX_COMBO_LINES to prevent runaway jobs.
 */
async function gatherCombos(rawText, attachment) {
  let buf = rawText || "";
  if (attachment) {
    const fileText = await fetchAttachmentLines(attachment);
    buf += "\n" + fileText;
  }
  return extractCombos(buf, MAX_COMBO_LINES);
}

function stopButton(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stop_${userId}`).setLabel("Stop").setStyle(ButtonStyle.Secondary)
  );
}

async function updateProgress(msg, embed, userId) {
  try { await msg.edit({ embeds: [embed], components: [stopButton(userId)] }); } catch {}
}

// ── WLID Set ─────────────────────────────────────────────────

async function handleWlidSet(respond, userId, wlidsRaw, wlidsFile) {
  if (!isOwner(userId)) return respond({ embeds: [errorEmbed("Only the bot owner can set WLIDs.")] });
  let wlids = splitInput(wlidsRaw);
  if (wlidsFile) {
    const text = await fetchAttachmentLines(wlidsFile);
    wlids = wlids.concat(text.split("\n").map((l) => l.trim()).filter(Boolean));
  }
  if (wlids.length === 0) return respond({ embeds: [errorEmbed("No WLID tokens provided.")] });
  setWlids(wlids);
  return respond({ embeds: [successEmbed(`WLID tokens updated. **${wlids.length}** stored.`)] });
}

// ── Check ────────────────────────────────────────────────────

async function handleCheck(respond, userId, wlidsRaw, codesRaw, codesFile, threads = 10, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "check");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "You already have a command running." : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached.`)] });

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    let wlids = splitInput(wlidsRaw);
    if (wlids.length === 0) wlids = getWlids();

    let codes = splitInput(codesRaw);
    if (codesFile) {
      const text = await fetchAttachmentLines(codesFile);
      codes = codes.concat(text.split("\n").map((l) => l.trim()).filter(Boolean));
    }

    if (wlids.length === 0) return respond({ embeds: [errorEmbed("No WLID tokens. Use `.wlidset` first.")] });
    if (codes.length === 0) return respond({ embeds: [errorEmbed("No codes provided.")] });
    if (codes.length > MAX_COMBO_LINES) codes = codes.slice(0, MAX_COMBO_LINES);

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

    if (valid.length > 0) files.push(textAttachment(valid.map((r) => (r.title ? `${r.code} | ${r.title}` : r.code)), "valid.txt"));
    if (used.length > 0) files.push(textAttachment(used.map((r) => r.code), "used.txt"));
    if (expired.length > 0) files.push(textAttachment(expired.map((r) => (r.title ? `${r.code} | ${r.title}` : r.code)), "expired.txt"));
    if (invalid.length > 0) files.push(textAttachment(invalid.map((r) => r.code), "invalid.txt"));

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

// ── Claim ────────────────────────────────────────────────────

async function handleClaim(respond, userId, accountsRaw, accountsFile, threads = 5, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "claim");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "You already have a command running." : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached.`)] });

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    const accounts = await gatherCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });

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

    if (success.length > 0) files.push(textAttachment(success.map((r) => r.token), "tokens.txt"));
    if (failed.length > 0) files.push(textAttachment(failed.map((r) => `${r.email}: ${r.error || "Unknown"}`), "failed.txt"));

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

// ── Pull ─────────────────────────────────────────────────────

async function handlePull(respond, userId, accountsRaw, accountsFile, dmUser = null, username = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "pull");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "You already have a command running." : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached.`)] });

  const ac = new AbortController();
  activeAborts.set(userId, ac);
  const startTime = Date.now();

  try {
    const accounts = await gatherCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });

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
    let fetchWorking = 0, fetchFailed = 0, fetchWithCodes = 0, fetchNoCodes = 0;
    let fetchResultsRef = [];
    let validateCounts = {};

    const { fetchResults, validateResults } = await pullCodes(accounts, (phase, detail) => {
      const now = Date.now();
      if (phase === "fetch") {
        totalCodesSoFar += detail.codes;
        lastAccount = detail.email;
        lastCodes = detail.codes;
        lastError = detail.error;
        if (detail.error) fetchFailed++;
        else { fetchWorking++; if (detail.codes > 0) fetchWithCodes++; else fetchNoCodes++; }
        if (now - lastUpdate > 2000) {
          lastUpdate = now;
          updateProgress(msg, pullFetchProgressEmbed({
            done: detail.done, total: detail.total, totalCodes: totalCodesSoFar,
            working: fetchWorking, failed: fetchFailed, withCodes: fetchWithCodes, noCodes: fetchNoCodes,
            lastAccount, lastCodes, lastError, startTime, username,
          }), userId);
        }
      } else if (phase === "validate_start") {
        if (detail.fetchResults) fetchResultsRef = detail.fetchResults;
        totalCodesSoFar = fetchResultsRef.reduce((sum, r) => sum + r.codes.length, 0);
        validateCounts = { done: 0, total: detail.total, valid: 0, used: 0, balance: 0, expired: 0, regionLocked: 0, invalid: 0 };
        updateProgress(msg, pullLiveProgressEmbed(fetchResultsRef, validateCounts, { username, startTime }), userId);
      } else if (phase === "validate") {
        validateCounts.done = detail.done;
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

    // Format codes WITH source account so user knows where each came from
    const fmt = (r) => {
      const base = r.title ? `${r.code} | ${r.title}` : r.code;
      return r.sourceEmail ? `${base} | from ${r.sourceEmail}` : base;
    };

    if (valid.length > 0) files.push(textAttachment(valid.map(fmt), "valid.txt"));
    if (used.length > 0) files.push(textAttachment(used.map(fmt), "used.txt"));
    if (expired.length > 0) files.push(textAttachment(expired.map(fmt), "expired.txt"));
    if (invalid.length > 0) files.push(textAttachment(invalid.map(fmt), "invalid.txt"));

    const embed = pullResultsEmbed(fetchResults, validateResults, { elapsed, dmSent: !!dmUser, username: username || undefined });
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

// ── PromoPuller ──────────────────────────────────────────────

async function handlePromoPuller(respond, userId, accountsRaw, accountsFile, dmUser = null, username = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "promopuller");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "You already have a command running." : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached.`)] });

  const ac = new AbortController();
  activeAborts.set(userId, ac);
  const startTime = Date.now();

  try {
    const accounts = await gatherCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });

    const msg = await respond({
      embeds: [promoPullerFetchProgressEmbed({ done: 0, total: accounts.length, totalLinks: 0, working: 0, failed: 0, withLinks: 0, noLinks: 0, startTime, username })],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    let totalLinksSoFar = 0;
    let lastAccount = "", lastLinks = 0, lastError = null;
    let fetchWorking = 0, fetchFailed = 0, fetchWithLinks = 0, fetchNoLinks = 0;

    const { fetchResults, allLinks } = await pullLinks(accounts, (phase, detail) => {
      const now = Date.now();
      if (phase === "fetch") {
        totalLinksSoFar += detail.links;
        lastAccount = detail.email; lastLinks = detail.links; lastError = detail.error;
        if (detail.error) fetchFailed++;
        else { fetchWorking++; if (detail.links > 0) fetchWithLinks++; else fetchNoLinks++; }
        if (now - lastUpdate > 2000) {
          lastUpdate = now;
          updateProgress(msg, promoPullerFetchProgressEmbed({
            done: detail.done, total: detail.total, totalLinks: totalLinksSoFar,
            working: fetchWorking, failed: fetchFailed, withLinks: fetchWithLinks, noLinks: fetchNoLinks,
            lastAccount, lastLinks, lastError, startTime, username,
          }), userId);
        }
      }
    }, ac.signal);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const stopped = ac.signal.aborted;
    const files = [];
    // allLinks is now [{ link, sourceEmail }] — keep raw + per-account breakdown
    const flatLinks = allLinks.map((l) => typeof l === "string" ? l : l.link);
    const uniqueLinks = [...new Set(flatLinks)];

    if (allLinks.length > 0) {
      files.push(textAttachment(allLinks.map((l) => typeof l === "string" ? l : `${l.link} | from ${l.sourceEmail}`), "links_all.txt"));
    }
    if (uniqueLinks.length > 0 && uniqueLinks.length !== flatLinks.length) {
      files.push(textAttachment(uniqueLinks, "links_unique.txt"));
    }
    const perAccount = fetchResults
      .filter((r) => !r.error && r.links.length > 0)
      .map((r) => `${r.email}\n${r.links.join("\n")}`);
    if (perAccount.length > 0) files.push(textAttachment(perAccount, "links_by_account.txt"));

    const embed = promoPullerResultsEmbed(fetchResults, flatLinks, { elapsed, dmSent: !!dmUser, username: username || undefined });
    if (stopped) embed.setDescription(embed.data.description + "\n\n*Stopped -- partial results*");

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [promoPullerResultsEmbed(fetchResults, flatLinks, { elapsed, dmSent: true, username: username || undefined })], components: [] });
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

// ── Refund ───────────────────────────────────────────────────

async function handleRefund(respond, userId, accountsRaw, accountsFile, threads = 5, dmUser = null, username = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "refund");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "You already have a command running." : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached.`)] });

  const ac = new AbortController();
  activeAborts.set(userId, ac);
  const startTime = Date.now();

  try {
    const accounts = await gatherCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided.")] });

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
        updateProgress(msg, refundProgressEmbed({ done, total, hits, noRefund, locked, failed, lastAccount: lastEmail, startTime, username }), userId);
      }
    }, ac.signal);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const stopped = ac.signal.aborted;
    const files = [];
    const hitResults = results.filter((r) => r.status === "hit");
    const noRefundResults = results.filter((r) => r.status === "free");
    const lockedResults = results.filter((r) => r.status === "locked");
    const failedResults = results.filter((r) => r.status === "fail");

    if (hitResults.length > 0) {
      const lines = hitResults.map((r) => {
        const items = (r.refundable || []).map((i) => `  ${i.title} | ${i.date} | ${i.days_ago}d ago | ${i.amount}`).join("\n");
        return `${r.user}:${r.password}\n${items}`;
      });
      files.push(textAttachment(lines, "Refundable.txt"));
    }
    if (noRefundResults.length > 0) files.push(textAttachment(noRefundResults.map((r) => `${r.user}:${r.password}`), "No_Refund.txt"));
    if (lockedResults.length > 0) files.push(textAttachment(lockedResults.map((r) => `${r.user}:${r.password} | ${r.detail}`), "Locked.txt"));
    if (failedResults.length > 0) files.push(textAttachment(failedResults.map((r) => `${r.user}:${r.password} | ${r.detail}`), "Failed.txt"));

    for (const r of results) statsManager.record(userId, "refund", r.status === "hit" || r.status === "free");

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

// ── Auth + Blacklist + Stats ─────────────────────────────────

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
  return respond({ embeds: [authListEmbed(auth.getAllAuthorized())] });
}

async function handleStats(respond) {
  const proxyStatus = isProxyEnabled() ? `Enabled (${getProxyCount()} loaded)` : "Disabled";
  const ps = getProxyStats();
  const proxyLine = isProxyEnabled()
    ? `Proxies: \`${proxyStatus}\`\nProxy requests: \`${ps.total}\` (${ps.successRate}% success)`
    : `Proxies: \`${proxyStatus}\``;
  return respond({
    embeds: [
      infoEmbed("Bot Status", [
        `Active sessions: \`${limiter.getActiveCount()}/${config.MAX_CONCURRENT_USERS}\``,
        `Authorized users: \`${auth.getAllAuthorized().length}\``,
        `Blacklisted users: \`${blacklist.getCount()}\``,
        `Stored WLIDs: \`${getWlidCount()}\``,
        proxyLine,
        `Uptime: \`${formatUptime(process.uptime())}\``,
        `Ping: \`${client.ws.ping}ms\``,
        `Autopilot: \`${autopilot.isEnabled() ? "ON" : "OFF"}\``,
      ].join("\n")),
    ],
  });
}

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
  if (entries.length === 0) return respond({ embeds: [infoEmbed("Blacklist", "No blacklisted users.")] });
  const lines = entries.map((e, i) => `\`${i + 1}.\` <@${e.userId}> — ${e.reason} (<t:${Math.floor(e.addedAt / 1000)}:R>)`);
  return respond({ embeds: [infoEmbed("Blacklist", lines.join("\n"))] });
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

// ── Account Checker (basic credential validity) ──────────────

const { checkMicrosoftAccounts } = (() => {
  try { return require("./utils/microsoft-checker-creds"); } catch { return {}; }
})();

// ── Rewards ──────────────────────────────────────────────────

async function handleRewards(respond, userId, accountsRaw, accountsFile, threads = 3, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "rewards");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "You already have a command running." : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached.`)] });

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    const accounts = await gatherCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided.")] });

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
    const success = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (success.length > 0) {
      files.push(textAttachment(
        success.map((r) => `${r.email} | ${r.balance.toLocaleString()} pts | Level: ${r.levelName} | Lifetime: ${r.lifetimePoints.toLocaleString()} | Streak: ${r.streak}`),
        "rewards_balances.txt"
      ));
    }
    if (failed.length > 0) files.push(textAttachment(failed.map((r) => `${r.email} | ${r.error}`), "rewards_failed.txt"));

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

// ── Inbox AIO ────────────────────────────────────────────────

async function handleInboxAio(respond, userId, accountsRaw, accountsFile, threads = 3, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "inboxaio");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "You already have a command running." : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached.`)] });

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    const accounts = await gatherCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided.")] });

    const startTime = Date.now();
    const liveServiceBreakdown = {};

    const msg = await respond({
      embeds: [inboxAioProgressEmbed({ completed: 0, total: accounts.length, hits: 0, fails: 0, elapsed: 0, serviceBreakdown: {} })],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    let totalHits = 0, totalFails = 0;
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
          completed: done, total, hits: totalHits, fails: totalFails,
          elapsed: Date.now() - startTime,
          latestAccount: lastResult?.user || "", latestStatus: status || "",
          serviceBreakdown: { ...liveServiceBreakdown },
        }), userId);
      }
    }, ac.signal);

    const stopped = ac.signal.aborted;
    const elapsed = Date.now() - startTime;

    const hitResults = results.filter((r) => r.status === "hit");
    const failResults = results.filter((r) => r.status === "fail");
    const lockedResults = results.filter((r) => r.status === "locked" || r.status === "custom");
    const twoFAResults = results.filter((r) => r.status === "2fa");

    const serviceBreakdown = {};
    for (const r of hitResults) {
      for (const [svcName] of Object.entries(r.services || {})) {
        serviceBreakdown[svcName] = (serviceBreakdown[svcName] || 0) + 1;
      }
    }

    const zipEntries = [];
    const serviceFiles = {};
    for (const r of hitResults) {
      for (const [svcName, svcData] of Object.entries(r.services || {})) {
        if (!serviceFiles[svcName]) serviceFiles[svcName] = [];
        let line = `${r.user}:${r.password}`;
        if (r.name) line += ` | ${r.name}`;
        if (r.country) line += ` | ${r.country}`;
        if (svcData.count) line += ` | Found: ${svcData.count}`;
        if (svcData.subjects?.length > 0) line += ` | Subjects: ${svcData.subjects.slice(0, 5).join(", ")}`;
        serviceFiles[svcName].push(line);
      }
    }

    for (const [svcName, lines] of Object.entries(serviceFiles)) {
      if (lines.length > 0) {
        const safeName = svcName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        zipEntries.push({ name: `${safeName}_hits.txt`, content: lines.join("\n") });
      }
    }

    if (hitResults.length > 0) {
      const allHitLines = hitResults.map((r) => {
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
    if (failResults.length > 0) zipEntries.push({ name: "failed.txt", content: failResults.map((r) => `${r.user}:${r.password} | ${r.detail || "failed"}`).join("\n") });
    if (lockedResults.length > 0) zipEntries.push({ name: "locked.txt", content: lockedResults.map((r) => `${r.user}:${r.password}`).join("\n") });
    if (twoFAResults.length > 0) zipEntries.push({ name: "2fa.txt", content: twoFAResults.map((r) => `${r.user}:${r.password}`).join("\n") });

    const embed = inboxAioResultsEmbed({
      total: results.length, hits: hitResults.length, fails: failResults.length,
      locked: lockedResults.length, twoFA: twoFAResults.length,
      elapsed, serviceBreakdown, username: dmUser?.username,
    });
    if (stopped) embed.setDescription(embed.data.description + "\n\n*Stopped -- partial results*");

    const { buildZipBuffer } = require("./utils/zip-builder");
    const zipBuffer = buildZipBuffer(zipEntries);
    const zipFile = new AttachmentBuilder(zipBuffer, { name: "inboxaio_results.zip" });

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files: [zipFile] });
        await msg.edit({ embeds: [infoEmbed("Inbox AIO Complete", `Scanned ${results.length} accounts across ${getServiceCount()} services. Results sent to your DMs.`)], components: [] });
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

// ── Netflix ─────────────────────────────────────────────────

async function handleNetflix(respond, userId, accountsRaw, accountsFile, threads = 10, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });
  const acquire = limiter.acquire(userId, "netflix");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "You already have a command running." : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached.`)] });

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    const accounts = await gatherCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided.")] });

    const nfxStats = { premium: 0, standard: 0, basic: 0, free: 0, cancelled: 0, invalid: 0, blocked: 0, timeout: 0, errors: 0 };
    let hits = [];
    const msg = await respond({ embeds: [netflixProgressEmbed(0, accounts.length, nfxStats)], components: [stopButton(userId)], fetchReply: true });
    const start = Date.now();
    let lastUpdate = 0;

    await checkNetflixAccounts(accounts, Math.min(threads, 10), (checked, total, result) => {
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
    const files = [];
    if (hits.length > 0) {
      const allHits = hits.map((h) =>
        `Email: ${h.email}\nPassword: ${h.password}\nPlan: ${h.plan}\nStatus: ${h.accountStatus}\nPayment: ${h.payment}\nNext Billing: ${h.nextBilling}\nProfiles: ${h.profiles}\nCountry: ${h.country}\nCreated: ${h.created}\n${"=".repeat(30)}`
      ).join("\n\n");
      files.push(new AttachmentBuilder(Buffer.from(allHits, "utf-8"), { name: "netflix_hits.txt" }));
    }

    const embed = netflixResultsEmbed({
      total: accounts.length, hits: hits.length,
      invalid: nfxStats.invalid, blocked: nfxStats.blocked, timeout: nfxStats.timeout, errors: nfxStats.errors,
      premium: nfxStats.premium, standard: nfxStats.standard, basic: nfxStats.basic, free: nfxStats.free, cancelled: nfxStats.cancelled,
      elapsed, username: dmUser?.username,
    });

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [infoEmbed("Netflix Checker Complete", `Checked ${accounts.length}. ${hits.length} hits. Sent to DMs.`)], components: [] });
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

// ── Steam ───────────────────────────────────────────────────

async function handleSteam(respond, userId, accountsRaw, accountsFile, threads = 15, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });
  const acquire = limiter.acquire(userId, "steam");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "You already have a command running." : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached.`)] });

  const ac = new AbortController();
  activeAborts.set(userId, ac);

  try {
    const accounts = await gatherCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided.")] });

    const stStats = { valid: 0, invalid: 0 };
    let hits = [];
    const msg = await respond({ embeds: [steamProgressEmbed(0, accounts.length, stStats)], components: [stopButton(userId)], fetchReply: true });
    const start = Date.now();
    let lastUpdate = 0;

    await checkSteamAccounts(accounts, Math.min(threads, 15), (checked, total, result) => {
      if (result) { stStats.valid++; hits.push(result); } else stStats.invalid++;
      const now = Date.now();
      if (now - lastUpdate > 3000) {
        lastUpdate = now;
        updateProgress(msg, steamProgressEmbed(checked, total, stStats), userId).catch(() => {});
      }
    }, ac.signal);

    const elapsed = Math.round((Date.now() - start) / 1000);
    const files = [];
    if (hits.length > 0) {
      const allHits = hits.map((h) => {
        const gamesList = shortenGames(h.games, 10);
        return `Username: ${h.username}\nPassword: ${h.password}\nEmail: ${h.email}\nBalance: ${h.balance}\nCountry: ${h.country}\nTotal Games: ${h.totalGames}\nGames: ${gamesList}\nLevel: ${h.level}\nLimited: ${h.limited}\nVAC Bans: ${h.vacBans}\nGame Bans: ${h.gameBans}\nCommunity Ban: ${h.communityBan}\n${"=".repeat(30)}`;
      }).join("\n\n");
      files.push(new AttachmentBuilder(Buffer.from(allHits, "utf-8"), { name: "steam_hits.txt" }));
      const withEmail = hits.filter((h) => h.email && h.email !== "Unknown");
      const withoutEmail = hits.filter((h) => !h.email || h.email === "Unknown");
      if (withEmail.length > 0) files.push(new AttachmentBuilder(Buffer.from(withEmail.map((h) => `${h.username}:${h.password}\n${h.email}:${h.password}`).join("\n"), "utf-8"), { name: "valid_with_email.txt" }));
      if (withoutEmail.length > 0) files.push(new AttachmentBuilder(Buffer.from(withoutEmail.map((h) => `${h.username}:${h.password}`).join("\n"), "utf-8"), { name: "valid_without_email.txt" }));
    }

    const embed = steamResultsEmbed({ total: accounts.length, valid: stStats.valid, invalid: stStats.invalid, elapsed, username: dmUser?.username });
    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [infoEmbed("Steam Checker Complete", `Checked ${accounts.length}. ${stStats.valid} valid. Sent to DMs.`)], components: [] });
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

// ── Admin Panel ─────────────────────────────────────────────

async function handleAdminPanel(respond, callerId) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Only the bot owner can view the admin panel.")] });
  return respond({ embeds: [adminPanelEmbed({
    webhookSet: !!webhookUrl,
    proxyEnabled: isProxyEnabled(),
    proxyCount: getProxyCount(),
    autopilot: autopilot.isEnabled(),
    antilinkChannels: (config.ANTILINK_CHANNELS || []).length,
    whitelistCount: antilink.list().length,
  })] });
}

async function handleSetWebhook(respond, callerId, url) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Only the bot owner can set the webhook.")] });
  if (!url || !/^https?:\/\//.test(url)) return respond({ embeds: [errorEmbed("Invalid URL.")] });
  webhookUrl = url;
  return respond({ embeds: [successEmbed("Webhook URL updated.")] });
}

async function handleBotStats(respond, callerId) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Only the bot owner can view detailed stats.")] });
  return respond({ embeds: [detailedStatsEmbed(statsManager.getSummary())] });
}

// ── Gen System ──────────────────────────────────────────────

async function handleGen(respond, userId, args, attachment) {
  // .gen help
  if (args[0]?.toLowerCase() === "help") {
    try { await respond({ embeds: [genHelpEmbed(config.PREFIX)] }); } catch {}
    return;
  }

  const product = args[0];
  const amount = parseInt(args[1] || "1", 10);
  if (!product || isNaN(amount)) {
    return respond({ embeds: [errorEmbed(`Usage: \`${config.PREFIX}gen <product> <amount>\` — see \`${config.PREFIX}gen help\``)] });
  }

  if (!canUse(userId)) return respond({ embeds: [errorEmbed("You are not authorized to use this bot.")] });

  const result = gen.generate(userId, product, amount, isOwner(userId));
  if (!result.ok) return respond({ embeds: [errorEmbed(result.reason)] });

  const file = textAttachment(result.items, `${product}_${result.items.length}.txt`);
  try {
    const userObj = await client.users.fetch(userId);
    await userObj.send({
      embeds: [successEmbed(`Generated **${result.delivered}** × \`${product}\` (requested ${result.requested}).\nRemaining stock: \`${gen.count(product)}\``)],
      files: [file],
    });
    return respond({ embeds: [infoEmbed("Gen Sent", `Sent **${result.delivered}** × \`${product}\` to your DMs.`)] });
  } catch {
    return respond({ embeds: [errorEmbed("Couldn't DM you. Enable DMs from server members.")] });
  }
}

async function handleStock(respond) {
  return respond({ embeds: [stockListEmbed(gen.list())] });
}

async function handleAddStock(respond, userId, product, attachment, inlineText) {
  if (!product) return respond({ embeds: [errorEmbed(`Usage: \`${config.PREFIX}addstock <product>\` + attach .txt OR inline lines.`)] });
  let text = inlineText || "";
  if (attachment) text += "\n" + (await fetchAttachmentLines(attachment));
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return respond({ embeds: [errorEmbed("No lines found.")] });
  const added = gen.addStock(product, lines);
  return respond({ embeds: [successEmbed(`Added **${added}** new line(s) to \`${product.toLowerCase()}\`.\nTotal stock: \`${gen.count(product)}\``)] });
}

async function handleReplaceStock(respond, userId, product, attachment, inlineText) {
  if (!isOwner(userId)) return respond({ embeds: [errorEmbed("Only the bot owner can replace stock.")] });
  if (!product) return respond({ embeds: [errorEmbed(`Usage: \`${config.PREFIX}replacegenstock <product>\` + attach .txt`)] });
  let text = inlineText || "";
  if (attachment) text += "\n" + (await fetchAttachmentLines(attachment));
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return respond({ embeds: [errorEmbed("No lines found.")] });
  const total = gen.replaceStock(product, lines);
  return respond({ embeds: [successEmbed(`Replaced \`${product.toLowerCase()}\` stock — now **${total}** lines.`)] });
}

async function handleDownloadStock(respond, userId) {
  if (!isOwner(userId)) return respond({ embeds: [errorEmbed("Only the bot owner can download stock.")] });
  const dump = gen.dump();
  if (!dump.trim()) return respond({ embeds: [infoEmbed("Gen Stock", "Stock is empty.")] });
  const file = new AttachmentBuilder(Buffer.from(dump, "utf-8"), { name: "gen_stock.txt" });
  try {
    const userObj = await client.users.fetch(userId);
    await userObj.send({ content: "Current gen stock:", files: [file] });
    return respond({ embeds: [infoEmbed("Sent", "Stock dump sent to your DMs.")] });
  } catch {
    return respond({ files: [file] });
  }
}

// ── Anti-Link + Autopilot helpers ───────────────────────────

async function maybeHandleAntiLink(message) {
  if (!antilink.isProtectedChannel(message.channelId)) return false;
  if (!antilink.containsLink(message.content)) return false;
  if (isOwner(message.author.id)) return false;
  if (antilink.isWhitelisted(message.author.id)) return false;
  try { await message.delete(); } catch {}
  try { await message.channel.send({ content: `<@${message.author.id}> nice try diddy.. no links allowed` }); } catch {}
  return true;
}

async function maybeSendUnauthorisedWarning(message) {
  if (!autopilot.isEnabled()) return false;
  try {
    const sent = await message.reply({ embeds: [unauthorisedEmbed()] });
    autopilot.registerWarning(message.author.id, message.channelId, sent.id);
  } catch {}
  return true;
}

async function maybeHandleMilkReply(message) {
  if (!autopilot.isMilkReply(message)) return false;
  autopilot.consume(message.author.id);
  auth.authorize(message.author.id, TEN_DAYS_MS, "autopilot");
  try {
    await message.reply({ embeds: [successEmbed(`Auto access granted for **10 days**. Welcome <@${message.author.id}>.`)] });
  } catch {}
  return true;
}

// ── Xbox Full Capture Check ──────────────────────────────────

async function handleXboxChk(respond, userId, accountsRaw, accountsFile, threads = 30, dmUser = null) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("You are not authorized.")] });
  if (!limiter.acquire(userId)) return respond({ embeds: [errorEmbed("You already have an active process.")] });

  try {
    const combos = await gatherCombos(accountsRaw, accountsFile);
    if (!combos || !combos.length) return respond({ embeds: [errorEmbed("No valid email:pass combos found.")] });
    if (combos.length > MAX_COMBO_LINES) return respond({ embeds: [errorEmbed(`Max ${MAX_COMBO_LINES} lines.`)] });

    const tc = Math.min(Math.max(threads, 1), 50);
    const msg = await respond({ embeds: [xboxChkProgressEmbed(0, combos.length)] });
    const ac = new AbortController();
    activeAborts.set(userId, ac);

    const t0 = Date.now();
    let lastEdit = 0;
    const live = { hits: 0, free: 0, locked: 0, fails: 0 };

    const results = await checkXboxAccounts(combos, tc, (done, total, r) => {
      // Count every result into the correct bucket — never skip
      const st = r && r.status;
      if (st === "hit") live.hits++;
      else if (st === "free") live.free++;
      else if (st === "locked") live.locked++;
      else live.fails++; // fail, skipped, retry-exhausted, null — all count as fails

      const now = Date.now();
      if (now - lastEdit < 1500) return; // update every 1.5s for snappier UI
      lastEdit = now;
      const sec = (now - t0) / 1000;
      const cpm = sec > 0 ? Math.round(done / (sec / 60)) : 0;
      updateProgress(msg, xboxChkProgressEmbed(done, total, { ...live, cpm }), userId).catch(() => {});
    }, ac.signal);

    activeAborts.delete(userId);

    const stats = { checked: results.length, hits: 0, free: 0, locked: 0, fails: 0 };
    const hitLines = [], freeLines = [], lockedLines = [];

    for (const r of results) {
      if (r.status === "hit") {
        stats.hits++;
        const caps = Object.entries(r.captures || {}).map(([k, v]) => `${k}: ${v}`).join(" | ");
        hitLines.push(`${r.user}:${r.password} | ${caps}`);
      } else if (r.status === "free") {
        stats.free++;
        const caps = Object.entries(r.captures || {}).map(([k, v]) => `${k}: ${v}`).join(" | ");
        freeLines.push(`${r.user}:${r.password} | ${caps}`);
      } else if (r.status === "locked") {
        stats.locked++;
        lockedLines.push(`${r.user}:${r.password} -> ${r.detail || ""}`);
      } else {
        stats.fails++;
      }
    }

    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    stats.cpm = sec > 0 ? Math.round(stats.checked / (sec / 60)) : 0;
    stats.elapsed = `${sec}s`;

    const files = [];
    if (hitLines.length) files.push(textAttachment(hitLines, "Hits.txt"));
    if (freeLines.length) files.push(textAttachment(freeLines, "Free.txt"));
    if (lockedLines.length) files.push(textAttachment(lockedLines, "Locked.txt"));

    statsManager.record("xboxchk", stats);

    const target = dmUser || null;
    if (target) {
      try {
        const dm = await target.createDM();
        await dm.send({ embeds: [xboxChkResultsEmbed(stats)], files });
        await msg.edit({ embeds: [successEmbed(`Done — ${stats.checked} checked. Results sent to DMs.`)], components: [] });
      } catch {
        await msg.edit({ embeds: [xboxChkResultsEmbed(stats)], files, components: [] });
      }
    } else {
      await msg.edit({ embeds: [xboxChkResultsEmbed(stats)], files, components: [] });
    }
  } finally {
    limiter.release(userId);
  }
}

// ── Slash Commands ───────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith("stop_")) {
    const targetUserId = interaction.customId.replace("stop_", "");
    if (interaction.user.id !== targetUserId && !isOwner(interaction.user.id)) {
      return interaction.reply({ content: "Only the command author can stop this.", ephemeral: true });
    }
    const ac = activeAborts.get(targetUserId);
    if (ac) {
      ac.abort();
      await interaction.reply({ embeds: [infoEmbed("Stopped", "Process is stopping.")], ephemeral: true });
    } else {
      await interaction.reply({ content: "No active process found.", ephemeral: true });
    }
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "help_category") {
    const category = interaction.values[0];
    await interaction.update({ embeds: [helpCategoryEmbed(category, config.PREFIX)], components: [helpSelectMenu()] });
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction;

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

  await sendWelcomeIfNeeded(user.id, user.username, user);

  try {
    if (commandName === "check") {
      await interaction.deferReply();
      await handleCheck(respond, user.id,
        interaction.options.getString("wlids"),
        interaction.options.getString("codes"),
        interaction.options.getAttachment("codes_file"),
        interaction.options.getInteger("threads") || 10,
        user);
    } else if (commandName === "claim") {
      await interaction.deferReply();
      await handleClaim(respond, user.id,
        interaction.options.getString("accounts"),
        interaction.options.getAttachment("accounts_file"),
        interaction.options.getInteger("threads") || 5,
        user);
    } else if (commandName === "pull") {
      await interaction.deferReply();
      await handlePull(respond, user.id,
        interaction.options.getString("accounts"),
        interaction.options.getAttachment("accounts_file"),
        user, user.username);
    } else if (commandName === "promopuller") {
      await interaction.deferReply();
      await handlePromoPuller(respond, user.id,
        interaction.options.getString("accounts"),
        interaction.options.getAttachment("accounts_file"),
        user, user.username);
    } else if (commandName === "inboxaio") {
      await interaction.deferReply();
      await handleInboxAio(respond, user.id,
        interaction.options.getString("accounts"),
        interaction.options.getAttachment("accounts_file"),
        interaction.options.getInteger("threads") || 3,
        user);
    } else if (commandName === "wlidset") {
      await handleWlidSet(respond, user.id,
        interaction.options.getString("wlids"),
        interaction.options.getAttachment("wlids_file"));
    } else if (commandName === "auth") {
      await handleAuth(respond, user.id, interaction.options.getUser("user").id, interaction.options.getString("duration"));
    } else if (commandName === "deauth") {
      await handleDeauth(respond, user.id, interaction.options.getUser("user").id);
    } else if (commandName === "authlist") {
      await handleAuthList(respond);
    } else if (commandName === "blacklist") {
      await handleBlacklist(respond, user.id, interaction.options.getUser("user").id, interaction.options.getString("reason"));
    } else if (commandName === "unblacklist") {
      await handleUnblacklist(respond, user.id, interaction.options.getUser("user").id);
    } else if (commandName === "blacklistshow") {
      await handleBlacklistShow(respond);
    } else if (commandName === "stats") {
      await handleStats(respond);
    } else if (commandName === "refund") {
      await interaction.deferReply();
      await handleRefund(respond, user.id,
        interaction.options.getString("accounts"),
        interaction.options.getAttachment("accounts_file"),
        interaction.options.getInteger("threads") || 5,
        user, user.username);
    } else if (commandName === "netflix") {
      await interaction.deferReply();
      await handleNetflix(respond, user.id,
        interaction.options.getString("accounts"),
        interaction.options.getAttachment("accounts_file"),
        interaction.options.getInteger("threads") || 10,
        user);
    } else if (commandName === "steam") {
      await interaction.deferReply();
      await handleSteam(respond, user.id,
        interaction.options.getString("accounts"),
        interaction.options.getAttachment("accounts_file"),
        interaction.options.getInteger("threads") || 15,
        user);
    } else if (commandName === "xboxchk") {
      await interaction.deferReply();
      await handleXboxChk(respond, user.id,
        interaction.options.getString("accounts"),
        interaction.options.getAttachment("accounts_file"),
        interaction.options.getInteger("threads") || 30,
        user);
    } else if (commandName === "help") {
      await respond({ embeds: [helpOverviewEmbed("/")], components: [helpSelectMenu()] });
    } else if (commandName === "rewards") {
      await interaction.deferReply();
      await handleRewards(respond, user.id,
        interaction.options.getString("accounts"),
        interaction.options.getAttachment("accounts_file"),
        interaction.options.getInteger("threads") || 3,
        user);
    } else if (commandName === "admin") {
      await handleAdminPanel(respond, user.id);
    } else if (commandName === "setwebhook") {
      await handleSetWebhook(respond, user.id, interaction.options.getString("url"));
    } else if (commandName === "botstats") {
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

  // 1) Anti-link enforcement (fires regardless of prefix)
  if (await maybeHandleAntiLink(message)) return;

  // 2) Autopilot "milk" reply — even without prefix
  if (await maybeHandleMilkReply(message)) return;

  if (!message.content.startsWith(config.PREFIX)) return;

  const args = message.content.slice(config.PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  if (!cmd) return;

  // ── Owner-only utility commands first (always allowed in any channel) ──
  if (cmd === "say") {
    if (!isOwner(message.author.id)) return;
    const text = args.join(" ");
    if (!text) return;
    try { await message.delete(); } catch {}
    try { await message.channel.send(text); } catch {}
    return;
  }

  if (cmd === "dm") {
    if (!isOwner(message.author.id)) return;
    const targetRaw = args.shift();
    const text = args.join(" ");
    if (!targetRaw || !text) return message.reply({ embeds: [errorEmbed(`Usage: \`${config.PREFIX}dm <user|id> <message>\``)] });
    const targetId = targetRaw.replace(/[<@!>]/g, "");
    try {
      const u = await client.users.fetch(targetId);
      await u.send(text);
      return message.reply({ embeds: [successEmbed(`DM sent to <@${targetId}>.`)] });
    } catch {
      return message.reply({ embeds: [errorEmbed("Couldn't DM that user.")] });
    }
  }

  if (cmd === "autopilotoff") {
    if (!isOwner(message.author.id)) return;
    autopilot.setEnabled(false);
    return message.reply({ embeds: [successEmbed("Autopilot access system **disabled**.")] });
  }

  if (cmd === "autopiloton") {
    if (!isOwner(message.author.id)) return;
    autopilot.setEnabled(true);
    return message.reply({ embeds: [successEmbed("Autopilot access system **enabled**.")] });
  }

  if (cmd === "whitelist" || cmd === "antilinkwl") {
    if (!isOwner(message.author.id)) return;
    const targetRaw = args.shift();
    if (!targetRaw) return message.reply({ embeds: [errorEmbed(`Usage: \`${config.PREFIX}whitelist <user|id>\``)] });
    const targetId = targetRaw.replace(/[<@!>]/g, "");
    const added = antilink.addWhitelist(targetId);
    return message.reply({ embeds: [successEmbed(added ? `<@${targetId}> whitelisted from anti-link.` : `<@${targetId}> already whitelisted.`)] });
  }

  if (cmd === "unwhitelist" || cmd === "antilinkunwl") {
    if (!isOwner(message.author.id)) return;
    const targetRaw = args.shift();
    if (!targetRaw) return message.reply({ embeds: [errorEmbed(`Usage: \`${config.PREFIX}unwhitelist <user|id>\``)] });
    const targetId = targetRaw.replace(/[<@!>]/g, "");
    const removed = antilink.removeWhitelist(targetId);
    return message.reply({ embeds: [removed ? successEmbed(`<@${targetId}> removed from anti-link whitelist.`) : errorEmbed("That user wasn't whitelisted.")] });
  }

  // ── Gen system (hidden — works in any channel) ──
  if (cmd === "gen") return handleGen((opts) => message.reply(opts), message.author.id, args, message.attachments.first());
  if (cmd === "stock") return handleStock((opts) => message.reply(opts));
  if (cmd === "addstock") {
    const product = args.shift();
    return handleAddStock((opts) => message.reply(opts), message.author.id, product, message.attachments.first(), args.join("\n"));
  }
  if (cmd === "replacegenstock") {
    const product = args.shift();
    return handleReplaceStock((opts) => message.reply(opts), message.author.id, product, message.attachments.first(), args.join("\n"));
  }
  if (cmd === "downloadgenstock") {
    return handleDownloadStock((opts) => message.reply(opts), message.author.id);
  }

  // ── Channel enforcement for normal commands ──
  const channelCheck = checkChannelAccess(message.channelId, cmd);
  if (!channelCheck.allowed) {
    return message.reply({ embeds: [errorEmbed(`This command can only be used in <#${channelCheck.requiredChannel}>.`)] });
  }

  const respond = (opts) => message.reply(opts);

  // First-use welcome DM
  await sendWelcomeIfNeeded(message.author.id, message.author.username, message.author);

  // Unauthorised → autopilot warning (only for known commands attempted by non-auth users)
  if (!canUse(message.author.id) && !isOwner(message.author.id)) {
    if (autopilot.isEnabled()) {
      await maybeSendUnauthorisedWarning(message);
      return;
    }
    return message.reply({ embeds: [errorEmbed("You are not authorized to use this bot.")] });
  }

  try {
    if (cmd === "check") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        const storedCount = getWlidCount();
        return respond({ embeds: [infoEmbed("Usage", `\`.check [wlids]\` + attach codes.txt\nStored WLIDs: **${storedCount}**`)] });
      }
      await handleCheck(respond, message.author.id, accountsRaw, null, attachment, 10, message.author);
    } else if (cmd === "claim") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) return respond({ embeds: [infoEmbed("Usage", "`.claim <accounts>` or attach a `.txt` file.")] });
      await handleClaim(respond, message.author.id, accountsRaw, attachment, 5, message.author);
    } else if (cmd === "pull") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) return respond({ embeds: [infoEmbed("Usage", "`.pull <accounts>` or attach a `.txt` file.")] });
      await handlePull(respond, message.author.id, accountsRaw, attachment, message.author, message.author.username);
    } else if (cmd === "promopuller") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) return respond({ embeds: [infoEmbed("Usage", "`.promopuller <accounts>` or attach a `.txt` file.")] });
      await handlePromoPuller(respond, message.author.id, accountsRaw, attachment, message.author, message.author.username);
    } else if (cmd === "inboxaio") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) return respond({ embeds: [infoEmbed("Usage", `\`.inboxaio <accounts>\` or attach .txt — scans ${getServiceCount()}+ services.`)] });
      await handleInboxAio(respond, message.author.id, accountsRaw, attachment, 3, message.author);
    } else if (cmd === "wlidset") {
      const wlidsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!wlidsRaw && !attachment) return respond({ embeds: [infoEmbed("Usage", `\`.wlidset <wlids>\` or attach .txt\nStored: **${getWlidCount()}**`)] });
      await handleWlidSet(respond, message.author.id, wlidsRaw, attachment);
    } else if (cmd === "auth") {
      if (args.length < 2) return respond({ embeds: [infoEmbed("Usage", "`.auth <@user|id> <duration>` (1h, 7d, 30d, 1mo, forever)")] });
      const targetId = args[0].replace(/[<@!>]/g, "");
      await handleAuth(respond, message.author.id, targetId, args.slice(1).join(" "));
    } else if (cmd === "deauth") {
      if (args.length < 1) return respond({ embeds: [infoEmbed("Usage", "`.deauth <@user|id>`")] });
      await handleDeauth(respond, message.author.id, args[0].replace(/[<@!>]/g, ""));
    } else if (cmd === "authlist") {
      await handleAuthList(respond);
    } else if (cmd === "blacklist") {
      if (args.length < 1) return respond({ embeds: [infoEmbed("Usage", "`.blacklist <@user|id> [reason]`")] });
      await handleBlacklist(respond, message.author.id, args[0].replace(/[<@!>]/g, ""), args.slice(1).join(" ") || "No reason");
    } else if (cmd === "unblacklist") {
      if (args.length < 1) return respond({ embeds: [infoEmbed("Usage", "`.unblacklist <@user|id>`")] });
      await handleUnblacklist(respond, message.author.id, args[0].replace(/[<@!>]/g, ""));
    } else if (cmd === "blacklistshow") {
      await handleBlacklistShow(respond);
    } else if (cmd === "stats") {
      await handleStats(respond);
    } else if (cmd === "netflix") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) return respond({ embeds: [infoEmbed("Usage", "`.netflix <accounts>` or attach .txt")] });
      await handleNetflix(respond, message.author.id, accountsRaw, attachment, 10, message.author);
    } else if (cmd === "steam") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) return respond({ embeds: [infoEmbed("Usage", "`.steam <accounts>` or attach .txt")] });
      await handleSteam(respond, message.author.id, accountsRaw, attachment, 15, message.author);
    } else if (cmd === "xboxchk") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) return respond({ embeds: [infoEmbed("Usage", "`.xboxchk <accounts>` or attach .txt — Full capture Xbox checker.")] });
      await handleXboxChk(respond, message.author.id, accountsRaw, attachment, 30, message.author);
    } else if (cmd === "help") {
      return respond({ embeds: [helpOverviewEmbed(config.PREFIX)], components: [helpSelectMenu()] });
    } else if (cmd === "refund") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) return respond({ embeds: [infoEmbed("Usage", "`.refund <accounts>` or attach .txt")] });
      await handleRefund(respond, message.author.id, accountsRaw, attachment, 5, message.author, message.author.username);
    } else if (cmd === "rewards") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) return respond({ embeds: [infoEmbed("Usage", "`.rewards <accounts>` or attach .txt")] });
      await handleRewards(respond, message.author.id, accountsRaw, attachment, 3, message.author);
    } else if (cmd === "admin") {
      await handleAdminPanel(respond, message.author.id);
    } else if (cmd === "setwebhook") {
      const url = args[0];
      if (!url) return respond({ embeds: [errorEmbed("Usage: `.setwebhook <url>`")] });
      await handleSetWebhook(respond, message.author.id, url);
    } else if (cmd === "botstats") {
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
  console.log(`Autopilot: ${autopilot.isEnabled() ? "ON" : "OFF"}`);
  console.log(`Anti-link channels: ${(config.ANTILINK_CHANNELS || []).length}`);

  const proxyCount = loadProxies();
  console.log(`Proxies: ${config.USE_PROXIES ? `Enabled (${proxyCount} loaded)` : "Disabled"}`);

  const { GLOBAL_MAX } = require("./utils/worker-pool");
  const { logger } = require("./utils/logger");
  console.log(`Worker pool: hard cap ${GLOBAL_MAX} concurrent (global)`);
  logger.event("bot", `online as ${client.user.tag} | pool=${GLOBAL_MAX} | proxies=${config.USE_PROXIES ? proxyCount : "off"}`);

  const presenceMessages = [
    () => ({ name: ".gg/autizmens", type: 3 }),
    () => ({ name: `${getWlidCount()} WLIDs stored`, type: 3 }),
    () => ({ name: `${auth.getAllAuthorized().length} users authorized`, type: 3 }),
    () => ({ name: `${limiter.getActiveCount()} active sessions`, type: 3 }),
    () => ({ name: ".help | .pull | .check", type: 2 }),
  ];

  let presenceIndex = 0;
  function cyclePresence() {
    const activity = presenceMessages[presenceIndex % presenceMessages.length]();
    client.user.setPresence({ status: "online", activities: [activity] });
    presenceIndex++;
  }
  cyclePresence();
  setInterval(cyclePresence, 15000);
});

client.login(config.BOT_TOKEN);
