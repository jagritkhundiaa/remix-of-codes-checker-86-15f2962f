// ============================================================
//  MS Code Checker & WLID Claimer & Puller — Discord Bot
//  Supports both slash commands and dot-prefix commands
// ============================================================

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const config = require("./config");
const { AuthManager, parseDuration, formatDuration, formatExpiry } = require("./utils/auth-manager");
const { ConcurrencyLimiter } = require("./utils/concurrency");
const { checkCodes } = require("./utils/microsoft-checker");
const { claimWlids } = require("./utils/microsoft-claimer");
const { pullCodes } = require("./utils/microsoft-puller");
const { loadProxies, isProxyEnabled, getProxyCount, reloadProxies } = require("./utils/proxy-manager");
const { setWlids, getWlids, getWlidCount } = require("./utils/wlid-store");
const {
  progressEmbed,
  checkResultsEmbed,
  claimResultsEmbed,
  pullFetchProgressEmbed,
  pullResultsEmbed,
  errorEmbed,
  successEmbed,
  infoEmbed,
  authListEmbed,
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

// ── Helpers ──────────────────────────────────────────────────

function isOwner(userId) {
  return userId === config.OWNER_ID;
}

function canUse(userId) {
  return isOwner(userId) || auth.isAuthorized(userId);
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

async function updateProgress(msg, embed) {
  try {
    await msg.edit({ embeds: [embed] });
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

async function handleCheck(respond, userId, wlidsRaw, codesRaw, codesFile, threads = 10) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "check");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  try {
    // Use provided WLIDs or fall back to stored WLIDs
    let wlids = splitInput(wlidsRaw);
    if (wlids.length === 0) {
      wlids = getWlids();
    }
    
    let codes = splitInput(codesRaw);
    if (codesFile) codes = codes.concat(await fetchAttachmentLines(codesFile));

    if (wlids.length === 0) return respond({ embeds: [errorEmbed("No WLID tokens provided and none stored.\nUse `/wlidset` or `.wlidset` to set WLIDs first, or provide them directly.")] });
    if (codes.length === 0) return respond({ embeds: [errorEmbed("No codes provided. Use the `codes` option or attach a `.txt` file.")] });

    const msg = await respond({
      embeds: [progressEmbed(0, codes.length, `Checking codes (${wlids.length} WLIDs)`)],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    const results = await checkCodes(wlids, codes, threads, (done, total) => {
      const now = Date.now();
      if (now - lastUpdate > 2000) {
        lastUpdate = now;
        updateProgress(msg, progressEmbed(done, total, "Checking codes"));
      }
    });

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

    await msg.edit({ embeds: [checkResultsEmbed(results)], files });
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    limiter.release(userId);
  }
}

// ── Claim handler ────────────────────────────────────────────

async function handleClaim(respond, userId, accountsRaw, accountsFile, threads = 5) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "claim");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  try {
    let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
    if (accountsFile) {
      const lines = await fetchAttachmentLines(accountsFile);
      accounts = accounts.concat(lines.filter((l) => l.includes(":")));
    }

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });

    const msg = await respond({
      embeds: [progressEmbed(0, accounts.length, "Claiming WLIDs")],
      fetchReply: true,
    });

    let lastUpdate = Date.now();
    const results = await claimWlids(accounts, threads, (done, total) => {
      const now = Date.now();
      if (now - lastUpdate > 2000) {
        lastUpdate = now;
        updateProgress(msg, progressEmbed(done, total, "Claiming WLIDs"));
      }
    });

    const files = [];
    const success = results.filter((r) => r.success && r.token);
    const failed = results.filter((r) => !r.success);

    if (success.length > 0)
      files.push(textAttachment(success.map((r) => r.token), "tokens.txt"));
    if (failed.length > 0)
      files.push(textAttachment(failed.map((r) => `${r.email}: ${r.error || "Unknown error"}`), "failed.txt"));

    await msg.edit({ embeds: [claimResultsEmbed(results)], files });
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
    limiter.release(userId);
  }
}

// ── Pull handler ─────────────────────────────────────────────

async function handlePull(respond, userId, accountsRaw, accountsFile) {
  if (!canUse(userId)) return respond({ embeds: [errorEmbed("You are not authorized to use this bot.")] });

  const acquire = limiter.acquire(userId, "pull");
  if (!acquire.ok) {
    const reason = acquire.reason === "busy"
      ? "You already have a command running. Wait for it to finish."
      : `Max concurrent users (${config.MAX_CONCURRENT_USERS}) reached. Try again later.`;
    return respond({ embeds: [errorEmbed(reason)] });
  }

  try {
    let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
    if (accountsFile) {
      const lines = await fetchAttachmentLines(accountsFile);
      accounts = accounts.concat(lines.filter((l) => l.includes(":")));
    }

    if (accounts.length === 0) return respond({ embeds: [errorEmbed("No valid accounts provided (email:password format).")] });

    const msg = await respond({
      embeds: [pullFetchProgressEmbed({ done: 0, total: accounts.length, totalCodes: 0 })],
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
          }));
        }
      } else if (phase === "validate_start") {
        updateProgress(msg, progressEmbed(0, detail.total, "Validating codes"));
      } else if (phase === "validate") {
        if (now - lastUpdate > 2000) {
          lastUpdate = now;
          updateProgress(msg, progressEmbed(detail.done, detail.total, "Validating codes"));
        }
      }
    });

    // Build result files — checker returns lowercase statuses: valid, used, expired, invalid, error
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

    await msg.edit({ embeds: [pullResultsEmbed(fetchResults, validateResults)], files });
  } catch (err) {
    await respond({ embeds: [errorEmbed(`Unexpected error: ${err.message}`)] });
  } finally {
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
  const proxyStatus = isProxyEnabled() ? `Enabled (${getProxyCount()} loaded)` : "Disabled";
  return respond({
    embeds: [
      infoEmbed(
        "Bot Status",
        [
          `Active sessions: \`${activeCount}/${config.MAX_CONCURRENT_USERS}\``,
          `Authorized users: \`${authCount}\``,
          `Stored WLIDs: \`${wlidCount}\``,
          `Proxies: \`${proxyStatus}\``,
          `Uptime: \`${formatUptime(process.uptime())}\``,
          `Ping: \`${client.ws.ping}ms\``,
        ].join("\n")
      ),
    ],
  });
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

// ── Slash Commands ───────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
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
      await handleCheck(respond, user.id, wlids, codes, codesFile, threads);
    }

    else if (commandName === "claim") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      const threads = interaction.options.getInteger("threads") || 5;
      await handleClaim(respond, user.id, accounts, accountsFile, threads);
    }

    else if (commandName === "pull") {
      await interaction.deferReply();
      const accounts = interaction.options.getString("accounts");
      const accountsFile = interaction.options.getAttachment("accounts_file");
      await handlePull(respond, user.id, accounts, accountsFile);
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

    else if (commandName === "stats") {
      await handleStats(respond);
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
      // .check — uses stored WLIDs if no WLIDs provided inline
      // attach codes.txt for codes
      const wlidsRaw = args.join(" ");
      const attachment = message.attachments.first();
      // If no args and no attachment, show usage
      if (!wlidsRaw && !attachment) {
        const storedCount = getWlidCount();
        const storedInfo = storedCount > 0 ? `\n\n**${storedCount} WLIDs stored** — just attach codes.txt to use them.` : "\n\nNo WLIDs stored. Use `.wlidset` first or provide WLIDs inline.";
        return respond({ embeds: [infoEmbed("Usage", "`.check [wlid_tokens]` + attach codes.txt\n\nIf WLIDs are stored via `.wlidset`, just attach codes.\nOr provide WLIDs directly." + storedInfo)] });
      }
      await handleCheck(respond, message.author.id, wlidsRaw, null, attachment, 10);
    }

    else if (cmd === "claim") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.claim <accounts>`\nProvide email:password comma-separated or attach a `.txt` file.\n\nExample:\n`.claim email@test.com:pass123`")] });
      }
      await handleClaim(respond, message.author.id, accountsRaw, attachment, 5);
    }

    else if (cmd === "pull") {
      const accountsRaw = args.join(" ");
      const attachment = message.attachments.first();
      if (!accountsRaw && !attachment) {
        return respond({ embeds: [infoEmbed("Usage", "`.pull <accounts>`\nProvide email:password comma-separated or attach a `.txt` file.\n\nFetches codes from Game Pass accounts and validates them.\n\nExample:\n`.pull email@test.com:pass123`")] });
      }
      await handlePull(respond, message.author.id, accountsRaw, attachment);
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

    else if (cmd === "stats") {
      await handleStats(respond);
    }

    else if (cmd === "help") {
      return respond({
        embeds: [
          infoEmbed(
            "Commands",
            [
              "**Checker**",
              "`.check [wlids]` + attach codes.txt",
              "Uses stored WLIDs if none provided",
              "",
              "**WLID Management (Owner)**",
              "`.wlidset <tokens>` or attach .txt — replaces stored WLIDs",
              "",
              "**Claimer**",
              "`.claim <accounts>` + attach accounts.txt",
              "",
              "**Puller**",
              "`.pull <accounts>` + attach accounts.txt",
              "Fetches codes from Game Pass + validates them",
              "",
              "**Authorization (Owner)**",
              "`.auth <@user> <duration>` — Authorize a user",
              "`.deauth <@user>` — Remove authorization",
              "`.authlist` — List authorized users",
              "",
              "**Info**",
              "`.stats` — Bot status + stored WLID count",
              "`.help` — This message",
            ].join("\n")
          ),
        ],
      });
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
    activities: [{ name: "Code Checker", type: 3 }],
  });
});

client.login(config.BOT_TOKEN);
