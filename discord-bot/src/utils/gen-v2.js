// ============================================================
//  Gen System v2 — items, tiers, cooldowns, daily limits,
//  whitelist access, audit logs, admin UI.
//  Codes are stored as plain text files at:
//      data/gen/codes/<item>.txt
//  One code per line. Pulls splice from the top. Manual edits
//  to the file are picked up automatically (file = truth).
//
//  Logic ported 1:1 from the standalone "Study Code" bot.
// ============================================================

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const {
  PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle,
  EmbedBuilder, AttachmentBuilder,
  SlashCommandBuilder,
} = require("discord.js");

// ── Storage paths ───────────────────────────────────────────

const DATA_DIR  = path.join(__dirname, "..", "..", "data", "gen");
const CODES_DIR = path.join(DATA_DIR, "codes");
const DB_FILE   = path.join(DATA_DIR, "gen.sqlite");

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CODES_DIR, { recursive: true });
}
ensureDirs();

// ── DB ──────────────────────────────────────────────────────

const db = new sqlite3.Database(DB_FILE);

function dbGet(sql, params = []) {
  return new Promise((res, rej) => db.get(sql, params, (e, row) => e ? rej(e) : res(row)));
}
function dbAll(sql, params = []) {
  return new Promise((res, rej) => db.all(sql, params, (e, rows) => e ? rej(e) : res(rows)));
}
function dbRun(sql, params = []) {
  return new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
}

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS item_settings (
    item_name TEXT PRIMARY KEY,
    min_tier TEXT DEFAULT 'FREE',
    cooldown_free INTEGER DEFAULT NULL,
    cooldown_prem INTEGER DEFAULT NULL,
    cooldown_vip  INTEGER DEFAULT NULL,
    stock_alert_threshold INTEGER DEFAULT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS access (
    user_id TEXT PRIMARY KEY,
    expires_at INTEGER,
    note TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS cooldowns (
    user_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    last_used_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, item_name)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS daily_usage (
    user_id TEXT NOT NULL,
    day_key TEXT NOT NULL,
    used_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, day_key)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    details TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS blacklist (
    user_id TEXT PRIMARY KEY
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS autodelete_channels (
    channel_id TEXT PRIMARY KEY,
    seconds INTEGER NOT NULL
  )`);
});

// ── Codes file storage (per-item .txt) ──────────────────────

function codesPath(item) {
  return path.join(CODES_DIR, `${item}.txt`);
}

function ensureCodesFile(item) {
  const p = codesPath(item);
  if (!fs.existsSync(p)) fs.writeFileSync(p, "");
  return p;
}

function readCodes(item) {
  const p = codesPath(item);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf-8")
    .split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

function writeCodes(item, lines) {
  ensureCodesFile(item);
  fs.writeFileSync(codesPath(item), lines.join("\n") + (lines.length ? "\n" : ""));
}

function appendCodes(item, lines) {
  ensureCodesFile(item);
  const existing = new Set(readCodes(item));
  const fresh = [];
  for (const raw of lines) {
    const c = String(raw || "").trim();
    if (!c || existing.has(c)) continue;
    existing.add(c);
    fresh.push(c);
  }
  if (fresh.length) {
    fs.appendFileSync(codesPath(item), fresh.join("\n") + "\n");
  }
  return fresh.length;
}

function stockCount(item) {
  return readCodes(item).length;
}

// Pop `n` codes from the top; return what was taken.
function popCodes(item, n) {
  const all = readCodes(item);
  if (!all.length) return [];
  const taken = all.splice(0, n);
  writeCodes(item, all);
  return taken;
}

// Push a code back to the top (used when DM fails — must restore order).
function unshiftCodes(item, lines) {
  const all = readCodes(item);
  writeCodes(item, [...lines, ...all]);
}

// ── Helpers ─────────────────────────────────────────────────

function now() { return Math.floor(Date.now() / 1000); }
function dayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function normItem(s) { return String(s || "").trim().toLowerCase(); }
function tierRank(t) { return t === "VIP" ? 3 : t === "PREM" ? 2 : 1; }

function applyTemplate(tpl, vars) {
  return String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

function parseDurationToSeconds(s) {
  const t = String(s || "").trim().toLowerCase();
  if (t === "perm" || t === "permanent") return null;
  const m = t.match(/^(\d+)\s*([mhd])$/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  return unit === "m" ? n * 60 : unit === "h" ? n * 3600 : n * 86400;
}

function formatExpires(expiresAt) {
  if (expiresAt === null) return "Never";
  return new Date(expiresAt * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function resolveCooldownForTier(s, tier, fallback) {
  if (tier === "VIP"  && s.cooldown_vip  != null) return s.cooldown_vip;
  if (tier === "PREM" && s.cooldown_prem != null) return s.cooldown_prem;
  if (tier === "FREE" && s.cooldown_free != null) return s.cooldown_free;
  return fallback;
}

function minTierAllowed(s, userTier) {
  return tierRank(userTier) >= tierRank(s.min_tier || "FREE");
}

// ── Module factory: wires gen-v2 into the existing client ──

function register(client, config) {
  const G = {
    adminRoleId:   config.GEN_ADMIN_ROLE_ID   || "",
    premiumRoleId: config.GEN_PREMIUM_ROLE_ID || "",
    vipRoleId:     config.GEN_VIP_ROLE_ID     || "",
    freeRoleId:    config.GEN_FREE_ROLE_ID    || "",
    logChannelId:  config.GEN_LOG_CHANNEL_ID  || "",
    genChannelIds: config.GEN_CHANNEL_IDS     || [],
    proofLink:     config.GEN_PROOF_LINK      || "",
    tiers:         config.GEN_TIERS           || {},
    whitelistOnly: !!config.GEN_WHITELIST_ONLY,
    antiSpam:      config.GEN_ANTISPAM        || { minAccountAgeDays: 0, minServerJoinAgeHours: 0 },
    ownerId:       config.OWNER_ID            || "",
    dmTemplates: {
      accessGranted: "✅ You got access to **{guild}**!\nPlan: **{plan}**\nExpires: **{expires}**\nMessage: {note}",
    },
  };

  // ── permissions ─────────────────────────────────────────

  function hasAdmin(member) {
    if (!member) return false;
    if (G.ownerId && String(member.id) === String(G.ownerId)) return true;
    if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
    if (G.adminRoleId && member.roles?.cache?.has?.(G.adminRoleId)) return true;
    return false;
  }
  function hasMod(member) {
    if (hasAdmin(member)) return true;
    return !!member.permissions?.has?.(PermissionFlagsBits.ManageMessages);
  }
  function getTier(member) {
    if (G.vipRoleId     && member.roles.cache.has(G.vipRoleId))     return "VIP";
    if (G.premiumRoleId && member.roles.cache.has(G.premiumRoleId)) return "PREM";
    return "FREE";
  }

  // ── audit ──────────────────────────────────────────────

  async function audit(guild, actorId, action, details = "") {
    await dbRun(
      "INSERT INTO audit_logs (ts, actor_id, action, details) VALUES (?, ?, ?, ?)",
      [now(), actorId ?? null, action, details]
    );
    try {
      if (!G.logChannelId || !guild) return;
      const ch = await guild.channels.fetch(G.logChannelId).catch(() => null);
      if (ch) {
        const who = actorId ? ` • by <@${actorId}>` : "";
        ch.send({ content: `🧾 **${action}** ${details}${who}` }).catch(() => {});
      }
    } catch {}
  }

  // ── blacklist (gen-only, separate from auth blacklist) ─

  async function isUserBlacklisted(userId) {
    const row = await dbGet("SELECT user_id FROM blacklist WHERE user_id = ?", [userId]);
    return !!row;
  }

  // ── access / antispam / limits ─────────────────────────

  async function checkAccess(userId) {
    if (!G.whitelistOnly) return { ok: true };
    const row = await dbGet("SELECT expires_at FROM access WHERE user_id = ?", [userId]);
    if (!row) return { ok: false, reason: "You are not whitelisted." };
    if (row.expires_at === null) return { ok: true };
    if (row.expires_at > now())  return { ok: true };
    return { ok: false, reason: "Your access has expired." };
  }

  async function antiSpamCheck(member) {
    if (!G.antiSpam) return { ok: true };
    if (hasAdmin(member)) return { ok: true };
    const minAcctDays  = G.antiSpam.minAccountAgeDays   ?? 0;
    const minJoinHours = G.antiSpam.minServerJoinAgeHours ?? 0;
    const acctAge = (Date.now() - member.user.createdAt.getTime()) / 1000;
    const joinAge = member.joinedAt ? (Date.now() - member.joinedAt.getTime()) / 1000 : Infinity;
    if (acctAge < minAcctDays * 86400) return { ok: false, reason: `Account too new. Need ${minAcctDays}+ days.` };
    if (joinAge < minJoinHours * 3600) return { ok: false, reason: `You must be in the server for ${minJoinHours}+ hours.` };
    return { ok: true };
  }

  async function checkDailyLimit(userId, limit) {
    if (!limit || limit <= 0) return { ok: true, used: 0 }; // 0 = unlimited
    const row = await dbGet("SELECT used_count FROM daily_usage WHERE user_id = ? AND day_key = ?", [userId, dayKey()]);
    const used = row ? row.used_count : 0;
    if (used < limit) return { ok: true, used };
    return { ok: false, used };
  }
  async function incrementDaily(userId) {
    await dbRun(`INSERT INTO daily_usage (user_id, day_key, used_count) VALUES (?, ?, 1)
      ON CONFLICT(user_id, day_key) DO UPDATE SET used_count = used_count + 1`, [userId, dayKey()]);
  }
  async function checkCooldown(userId, item, cdSec) {
    if (!cdSec || cdSec <= 0) return { ok: true };
    const row = await dbGet("SELECT last_used_at FROM cooldowns WHERE user_id = ? AND item_name = ?", [userId, item]);
    if (!row) return { ok: true };
    const delta = now() - row.last_used_at;
    if (delta >= cdSec) return { ok: true };
    return { ok: false, wait: cdSec - delta };
  }
  async function setCooldown(userId, item) {
    await dbRun(`INSERT INTO cooldowns (user_id, item_name, last_used_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id, item_name) DO UPDATE SET last_used_at = excluded.last_used_at`,
      [userId, item, now()]);
  }

  // ── item settings ──────────────────────────────────────

  async function getItemSettings(item) {
    await dbRun("INSERT OR IGNORE INTO item_settings (item_name) VALUES (?)", [item]);
    return dbGet("SELECT * FROM item_settings WHERE item_name = ?", [item]);
  }

  async function maybeAlertLowStock(guild, item) {
    const s = await getItemSettings(item);
    if (s.stock_alert_threshold == null) return;
    const c = stockCount(item);
    if (c < s.stock_alert_threshold) {
      const ping = G.adminRoleId ? ` <@&${G.adminRoleId}>` : "";
      await audit(guild, null, "LOW_STOCK", `• **${item}** remaining=${c} threshold=${s.stock_alert_threshold}${ping}`);
    }
  }

  // ── autodelete (mod) ───────────────────────────────────

  async function getAutoDeleteSeconds(channelId) {
    const r = await dbGet("SELECT seconds FROM autodelete_channels WHERE channel_id = ?", [channelId]);
    return r?.seconds ?? null;
  }
  async function setAutoDeleteSeconds(channelId, seconds) {
    await dbRun("INSERT INTO autodelete_channels (channel_id, seconds) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET seconds = excluded.seconds",
      [channelId, seconds]);
  }
  async function clearAutoDelete(channelId) {
    await dbRun("DELETE FROM autodelete_channels WHERE channel_id = ?", [channelId]);
  }

  // ── embeds ─────────────────────────────────────────────

  function adminHomeEmbed() {
    return new EmbedBuilder()
      .setTitle("Admin Menu")
      .setDescription(
        "Manage items, rules, codes, and access.\n\n" +
        "• Items & Rules: create/toggle, min tier, per-tier cooldowns, stock alerts\n" +
        "• Codes: add single/bulk, view stock\n" +
        "• Access: whitelist grant/revoke (DMs user)\n" +
        "• Export: export audit logs\n\n" +
        "_Codes are saved to `data/gen/codes/<item>.txt` — you can edit those files directly._"
      );
  }
  function adminHomeComponents() {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("genv2_adm_items").setLabel("Items & Rules").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("genv2_adm_codes").setLabel("Codes").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("genv2_adm_access").setLabel("Access").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("genv2_adm_export_hint").setLabel("Export Logs").setStyle(ButtonStyle.Secondary),
    )];
  }
  function helpEmbed(section = "general") {
    const e = new EmbedBuilder().setTitle("Bot Help Menu");
    if (section === "general") {
      e.setDescription("**General**\n• `/help` or `.help` → this menu\n• `/me` → your tier/access\n");
    } else if (section === "gen") {
      e.setDescription(
        "**Generation**\n" +
        "• `/gen item:<name>` → DM you a code\n" +
        "• `.gen <item> <amount>` → admins can pull multiple\n\n" +
        "_Codes live in `data/gen/codes/<item>.txt` — admins can drop lines there to bulk-add._"
      );
    } else if (section === "mod") {
      e.setDescription(
        "**Moderation (staff)**\n" +
        "• `/mod purge amount:10`\n• `/mod lock` / `/mod unlock`\n• `/mod nuke`\n" +
        "• `/mod autodelete seconds:30` / `/mod autodeleteoff`"
      );
    } else if (section === "admin") {
      e.setDescription("**Admin**\n• `/admin` → admin panel\n• `/exportlogs hours:24` → export audit logs");
    }
    return e;
  }
  function helpComponents(active = "general") {
    return [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("genv2_help_menu").setPlaceholder("Choose section").addOptions(
        { label: "General",    value: "general", default: active === "general" },
        { label: "Generation", value: "gen",     default: active === "gen" },
        { label: "Moderation", value: "mod",     default: active === "mod" },
        { label: "Admin",      value: "admin",   default: active === "admin" },
      )
    )];
  }
  function nukeConfirmComponents(channelId, userId) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`genv2_nuke_confirm:${channelId}:${userId}`).setLabel("✅ Confirm Nuke").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`genv2_nuke_cancel:${channelId}:${userId}`).setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary),
    )];
  }
  function genHelpEmbed() {
    return new EmbedBuilder()
      .setTitle("🎟️ Generation Help")
      .setDescription(
        "**How to gen**\n" +
        "• `/gen item:<name>` (slash, 1 code, DM)\n" +
        "• `.gen <item> <amount>` (dot, admins multi)\n\n" +
        "**Rules** • access/tier required • blacklist blocks • cooldowns + daily limits apply\n\n" +
        "**Tips** • `.stock` to see counts • out of stock? admins must restock"
      );
  }

  // ── DM gen action (shared by slash + dot) ──────────────

  async function performGen({ guild, member, user, item, amount, replySuccess, replyError }) {
    if (await isUserBlacklisted(user.id))
      return replyError("⛔ You are blacklisted and cannot use this command.");

    if (G.genChannelIds.length && guild) {
      // channel check happens in caller (we don't have channelId here directly)
    }

    const spam = await antiSpamCheck(member);
    if (!spam.ok) return replyError(`⛔ ${spam.reason}`);

    const access = await checkAccess(user.id);
    if (!access.ok) return replyError(`❌ ${access.reason}`);

    const itemRow = await dbGet("SELECT enabled FROM items WHERE name = ?", [item]);
    if (!itemRow)            return replyError("❌ Item not found.");
    if (itemRow.enabled !== 1) return replyError("⚠️ This item is disabled.");

    const userTier = getTier(member);
    const tierCfg  = G.tiers[userTier] || { cooldownSeconds: 3600, dailyLimit: 5 };
    const settings = await getItemSettings(item);

    if (!minTierAllowed(settings, userTier))
      return replyError(`🔒 **${item}** requires tier **${settings.min_tier}** or higher.`);

    // amount limits — 1 for non-admin, up to 10 for admin
    const isAdmin = hasAdmin(member);
    if (!isAdmin && amount > 1) return replyError("❌ Non-admin users can generate only **1** code.");
    if (isAdmin && amount > 10) return replyError("❌ Admins can generate max **10** codes.");
    if (!Number.isFinite(amount) || amount < 1) amount = 1;

    const daily = await checkDailyLimit(user.id, tierCfg.dailyLimit);
    const remaining = tierCfg.dailyLimit > 0 ? tierCfg.dailyLimit - (daily.used || 0) : Infinity;
    if (tierCfg.dailyLimit > 0 && remaining <= 0)
      return replyError(`⛔ Daily limit reached (${tierCfg.dailyLimit}/day).`);
    if (amount > remaining)
      return replyError(`⛔ You only have **${remaining}** left today (daily limit ${tierCfg.dailyLimit}).`);

    const cdSec = resolveCooldownForTier(settings, userTier, tierCfg.cooldownSeconds);
    const cd = await checkCooldown(user.id, item, cdSec);
    if (!cd.ok) return replyError(`⏳ Cooldown: wait **${cd.wait}s**.`);

    const codes = popCodes(item, amount);
    if (!codes.length)         return replyError("⚠️ Out of stock.");
    if (codes.length < amount) {
      // restore what we took (atomicity)
      unshiftCodes(item, codes);
      return replyError(`⚠️ Only **${codes.length}** in stock for **${item}**.`);
    }

    // mark usage
    for (let i = 0; i < codes.length; i++) await incrementDaily(user.id);
    await setCooldown(user.id, item);

    // DM
    const codeText = codes.join("\n");
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`genv2_recopy:${user.id}`).setLabel("Resend Code").setStyle(ButtonStyle.Primary)
    );
    const warn = G.proofLink
      ? `\n\n⚠️ **IMPORTANT**: Send HITs screenshot in:\n${G.proofLink}\n` +
        `Otherwise you may be **auto blacklisted for 2 days** and your plan resumes afterwards.`
      : "";
    try {
      const dm = await user.send({
        content:
          `✅ Your **${item}** code(s):\n\`\`\`\n${codeText}\n\`\`\`\n` +
          `Tier: ${userTier} • Cooldown: ${cdSec}s • Amount: ${codes.length}` +
          warn,
        components: [row],
      });
      // remember last sent code per user for the "Resend" button
      lastSent.set(user.id, codeText);
      // fire & forget audit + low-stock check
      await audit(guild, user.id, "GEN", `• item=${item} tier=${userTier} amount=${codes.length}`);
      await maybeAlertLowStock(guild, item);
      return replySuccess(`📩 Sent **${codes.length}** **${item}** code(s) to your DMs.`, dm);
    } catch {
      // revert: push codes back to top of stock
      unshiftCodes(item, codes);
      return replyError("❌ I couldn't DM you. Enable DMs and try again.");
    }
  }

  const lastSent = new Map(); // userId -> last code text

  // ── interactions: slash commands, buttons, modals ──────

  client.on("interactionCreate", async (interaction) => {
    try {
      // ── Slash commands ──
      if (interaction.isChatInputCommand()) {
        const name = interaction.commandName;

        if (name === "gen") {
          const allowed = G.genChannelIds;
          if (allowed.length && !allowed.includes(interaction.channelId))
            return interaction.reply({ content: "❌ Use /gen only in the gen channel.", ephemeral: true });

          const item = normItem(interaction.options.getString("item", true));
          const member = await interaction.guild.members.fetch(interaction.user.id);
          await interaction.deferReply({ ephemeral: true });
          return performGen({
            guild: interaction.guild, member, user: interaction.user, item, amount: 1,
            replySuccess: (msg) => interaction.editReply({ content: msg }),
            replyError:   (msg) => interaction.editReply({ content: msg }),
          });
        }

        if (name === "genadmin") {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          if (!hasAdmin(member)) return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
          return interaction.reply({ embeds: [adminHomeEmbed()], components: adminHomeComponents(), ephemeral: true });
        }

        if (name === "me") {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          const tier = getTier(member);
          const acc = await dbGet("SELECT expires_at, note FROM access WHERE user_id = ?", [interaction.user.id]);
          return interaction.reply({
            ephemeral: true,
            embeds: [new EmbedBuilder().setTitle("Your Status").setDescription(
              `**Tier:** ${tier}\n**Whitelisted:** ${acc ? "Yes" : "No"}\n` +
              `**Access Expires:** ${acc ? formatExpires(acc.expires_at) : "-"}\n` +
              (acc?.note ? `**Note:** ${acc.note}\n` : "")
            )]
          });
        }

        if (name === "genhelp") return interaction.reply({ ephemeral: true, embeds: [genHelpEmbed()] });

        if (name === "exportlogs") {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          if (!hasAdmin(member)) return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
          const hours = interaction.options.getInteger("hours") ?? 24;
          const since = now() - (hours * 3600);
          const rows = await dbAll("SELECT ts, actor_id, action, details FROM audit_logs WHERE ts >= ? ORDER BY ts ASC", [since]);
          const lines = rows.map(r => `[${new Date(r.ts*1000).toISOString()}] actor=${r.actor_id ?? "system"} action=${r.action} details=${r.details ?? ""}`);
          const buf = Buffer.from(lines.join("\n") || "No logs in range.", "utf-8");
          const file = new AttachmentBuilder(buf, { name: `audit_export_${Date.now()}.txt` });
          return interaction.reply({ content: `✅ Exported logs for last ${hours}h.`, files: [file], ephemeral: true });
        }

        if (name === "mod") {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          if (!hasMod(member)) return interaction.reply({ content: "❌ Staff only.", ephemeral: true });
          const sub = interaction.options.getSubcommand();
          if (sub === "purge") {
            const n = Math.max(1, Math.min(100, interaction.options.getInteger("amount", true)));
            await interaction.deferReply({ ephemeral: true });
            const msgs = await interaction.channel.messages.fetch({ limit: n });
            await interaction.channel.bulkDelete(msgs, true);
            return interaction.editReply(`✅ Deleted **${msgs.size}** messages.`);
          }
          if (sub === "lock" || sub === "unlock") {
            await interaction.deferReply({ ephemeral: true });
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: sub === "unlock" });
            return interaction.editReply(sub === "unlock" ? "✅ Unlocked." : "✅ Locked.");
          }
          if (sub === "nuke") {
            return interaction.reply({ ephemeral: true, content: "⚠️ **CONFIRM NUKE?**", components: nukeConfirmComponents(interaction.channel.id, interaction.user.id) });
          }
          if (sub === "autodelete") {
            const sec = Math.max(5, Math.min(86400, interaction.options.getInteger("seconds", true)));
            await setAutoDeleteSeconds(interaction.channel.id, sec);
            return interaction.reply({ content: `✅ Auto-delete: messages deleted after **${sec}s**.`, ephemeral: true });
          }
          if (sub === "autodeleteoff") {
            await clearAutoDelete(interaction.channel.id);
            return interaction.reply({ content: "✅ Auto-delete disabled.", ephemeral: true });
          }
        }

        if (name === "help") {
          return interaction.reply({ ephemeral: true, embeds: [helpEmbed("general")], components: helpComponents("general") });
        }
      }

      // ── Help dropdown ──
      if (interaction.isStringSelectMenu() && interaction.customId === "genv2_help_menu") {
        const v = interaction.values?.[0] || "general";
        return interaction.update({ embeds: [helpEmbed(v)], components: helpComponents(v) });
      }

      // ── Buttons ──
      if (interaction.isButton()) {
        const id = interaction.customId || "";

        // Resend code
        if (id.startsWith("genv2_recopy:")) {
          const ownerId = id.split(":")[1];
          if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ Not yours.", ephemeral: true });
          const text = lastSent.get(ownerId);
          if (!text) return interaction.reply({ content: "❌ No recent code stored.", ephemeral: true });
          return interaction.reply({ content: `Your code(s):\n\`\`\`\n${text}\n\`\`\``, ephemeral: true });
        }

        // Nuke confirm
        if (id.startsWith("genv2_nuke_confirm:") || id.startsWith("genv2_nuke_cancel:")) {
          const [action, channelId, userId] = id.split(":");
          if (interaction.user.id !== userId) return interaction.reply({ content: "❌ Only the command user can confirm.", ephemeral: true });
          const member = await interaction.guild.members.fetch(interaction.user.id);
          if (!hasMod(member)) return interaction.reply({ content: "❌ Staff only.", ephemeral: true });
          if (action === "genv2_nuke_cancel") return interaction.update({ content: "✅ Cancelled.", components: [] });
          await interaction.update({ content: "💣 Nuking...", components: [] });
          const old = await interaction.guild.channels.fetch(channelId).catch(() => null);
          if (!old) return;
          const cloned = await old.clone();
          await cloned.setPosition(old.position);
          await old.delete("Nuked with confirmation");
          await cloned.send(`✅ Channel nuked by <@${interaction.user.id}>.`);
          return;
        }

        // Admin nav buttons
        if (!id.startsWith("genv2_")) return;
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!hasAdmin(member)) return interaction.reply({ content: "❌ Admins only.", ephemeral: true });

        if (id === "genv2_adm_items") {
          const items = await dbAll("SELECT name, enabled FROM items ORDER BY name ASC");
          const opts = items.slice(0, 25).map(i => ({ label: `${i.name} ${i.enabled ? "✅" : "⛔"}`, value: i.name }));
          const select = new StringSelectMenuBuilder()
            .setCustomId("genv2_sel_item_rules")
            .setPlaceholder("Select item to view/edit rules")
            .addOptions(opts.length ? opts : [{ label: "No items yet", value: "__none__" }]);
          return interaction.update({
            embeds: [new EmbedBuilder().setTitle("Items & Rules").setDescription("Select an item to edit, or create one.")],
            components: [
              new ActionRowBuilder().addComponents(select),
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("genv2_item_create").setLabel("Create Item").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId("genv2_back_home").setLabel("Back").setStyle(ButtonStyle.Secondary),
              )
            ]
          });
        }
        if (id === "genv2_adm_codes") {
          return interaction.update({
            embeds: [new EmbedBuilder().setTitle("Codes").setDescription("Add stock or view stock.\n_File-backed: `data/gen/codes/<item>.txt`_")],
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId("genv2_code_add_one").setLabel("Add One").setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId("genv2_code_add_bulk").setLabel("Bulk Add").setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId("genv2_code_stock").setLabel("View Stock").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId("genv2_back_home").setLabel("Back").setStyle(ButtonStyle.Secondary),
            )]
          });
        }
        if (id === "genv2_adm_access") {
          return interaction.update({
            embeds: [new EmbedBuilder().setTitle("Access").setDescription("Grant/revoke whitelist access (DMs user).")],
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId("genv2_access_grant").setLabel("Grant/Extend").setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId("genv2_access_revoke").setLabel("Revoke").setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId("genv2_back_home").setLabel("Back").setStyle(ButtonStyle.Secondary),
            )]
          });
        }
        if (id === "genv2_adm_export_hint") return interaction.reply({ content: "Use `/exportlogs hours:<N>`.", ephemeral: true });
        if (id === "genv2_back_home")       return interaction.update({ embeds: [adminHomeEmbed()], components: adminHomeComponents() });

        if (id === "genv2_item_create") {
          const m = new ModalBuilder().setCustomId("genv2_modal_item_create").setTitle("Create Item");
          m.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("item_name").setLabel("Item name").setStyle(TextInputStyle.Short).setRequired(true)
          ));
          return interaction.showModal(m);
        }
        if (id === "genv2_item_rules_edit") {
          const m = new ModalBuilder().setCustomId("genv2_modal_item_rules").setTitle("Edit Item Rules");
          m.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("item").setLabel("Item").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("min_tier").setLabel("Min tier (FREE/PREM/VIP)").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("cooldowns").setLabel("Cooldowns free,prem,vip (seconds)").setStyle(TextInputStyle.Short).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("stock_threshold").setLabel("Stock alert threshold").setStyle(TextInputStyle.Short).setRequired(false)),
          );
          return interaction.showModal(m);
        }
        if (id === "genv2_code_add_one") {
          const m = new ModalBuilder().setCustomId("genv2_modal_code_add_one").setTitle("Add One Code");
          m.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("item").setLabel("Item").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("code").setLabel("Code").setStyle(TextInputStyle.Short).setRequired(true)),
          );
          return interaction.showModal(m);
        }
        if (id === "genv2_code_add_bulk") {
          const m = new ModalBuilder().setCustomId("genv2_modal_code_add_bulk").setTitle("Bulk Add Codes");
          m.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("item").setLabel("Item").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("codes").setLabel("Codes (one per line)").setStyle(TextInputStyle.Paragraph).setRequired(true)),
          );
          return interaction.showModal(m);
        }
        if (id === "genv2_code_stock") {
          const items = await dbAll("SELECT name, enabled FROM items ORDER BY name ASC");
          const lines = [];
          for (const it of items) {
            const c = stockCount(it.name);
            const s = await getItemSettings(it.name);
            lines.push(`• **${it.name}**: ${c} ${it.enabled ? "✅" : "⛔"} minTier=${s.min_tier} alert=${s.stock_alert_threshold ?? "off"}`);
          }
          return interaction.reply({ content: lines.length ? lines.join("\n") : "No items yet.", ephemeral: true });
        }
        if (id === "genv2_access_grant") {
          const m = new ModalBuilder().setCustomId("genv2_modal_access_grant").setTitle("Grant/Extend Access");
          m.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("user").setLabel("User ID").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("duration").setLabel("Duration (30m/12h/7d/perm)").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("note").setLabel("Note (optional)").setStyle(TextInputStyle.Short).setRequired(false)),
          );
          return interaction.showModal(m);
        }
        if (id === "genv2_access_revoke") {
          const m = new ModalBuilder().setCustomId("genv2_modal_access_revoke").setTitle("Revoke Access");
          m.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("user").setLabel("User ID").setStyle(TextInputStyle.Short).setRequired(true)
          ));
          return interaction.showModal(m);
        }
        if (id.startsWith("genv2_toggle_item_")) {
          const item = id.replace("genv2_toggle_item_", "");
          const r = await dbGet("SELECT enabled FROM items WHERE name = ?", [item]);
          const next = r?.enabled ? 0 : 1;
          await dbRun("UPDATE items SET enabled = ? WHERE name = ?", [next, item]);
          await audit(interaction.guild, interaction.user.id, "ITEM_TOGGLE", `• item=${item} enabled=${next}`);
          return interaction.reply({ content: `✅ **${item}** is now ${next ? "enabled" : "disabled"}.`, ephemeral: true });
        }
      }

      // ── Select item rules ──
      if (interaction.isStringSelectMenu() && interaction.customId === "genv2_sel_item_rules") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!hasAdmin(member)) return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
        const item = interaction.values[0];
        if (item === "__none__") return interaction.reply({ content: "Create an item first.", ephemeral: true });
        const s = await getItemSettings(item);
        const r = await dbGet("SELECT enabled FROM items WHERE name = ?", [item]);
        return interaction.reply({
          ephemeral: true,
          embeds: [new EmbedBuilder().setTitle(`Rules: ${item}`).setDescription(
            `enabled: **${r.enabled ? "yes" : "no"}**\n` +
            `min_tier: **${s.min_tier}**\n` +
            `cooldowns free/prem/vip: **${s.cooldown_free ?? "default"} / ${s.cooldown_prem ?? "default"} / ${s.cooldown_vip ?? "default"}**\n` +
            `stock alert threshold: **${s.stock_alert_threshold ?? "off"}**\n` +
            `stock count: **${stockCount(item)}**`
          )],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`genv2_toggle_item_${item}`).setLabel("Toggle Enable").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("genv2_item_rules_edit").setLabel("Edit Rules").setStyle(ButtonStyle.Success),
          )]
        });
      }

      // ── Modals ──
      if (interaction.isModalSubmit() && interaction.customId.startsWith("genv2_modal_")) {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!hasAdmin(member)) return interaction.reply({ content: "❌ Admins only.", ephemeral: true });

        if (interaction.customId === "genv2_modal_item_create") {
          const name = normItem(interaction.fields.getTextInputValue("item_name"));
          await dbRun("INSERT OR IGNORE INTO items (name, enabled) VALUES (?, 1)", [name]);
          await dbRun("INSERT OR IGNORE INTO item_settings (item_name) VALUES (?)", [name]);
          ensureCodesFile(name);
          await audit(interaction.guild, interaction.user.id, "ITEM_CREATE", `• item=${name}`);
          return interaction.reply({ content: `✅ Created **${name}**. Stock file: \`data/gen/codes/${name}.txt\``, ephemeral: true });
        }

        if (interaction.customId === "genv2_modal_item_rules") {
          const item = normItem(interaction.fields.getTextInputValue("item"));
          const minTier = String(interaction.fields.getTextInputValue("min_tier")).trim().toUpperCase();
          const cooldowns = (interaction.fields.getTextInputValue("cooldowns") || "").trim();
          const thresh = (interaction.fields.getTextInputValue("stock_threshold") || "").trim();
          if (!["FREE", "PREM", "VIP"].includes(minTier))
            return interaction.reply({ content: "❌ min tier must be FREE/PREM/VIP.", ephemeral: true });
          let cf = null, cp = null, cv = null;
          if (cooldowns) {
            const parts = cooldowns.split(",").map(x => x.trim());
            if (parts.length !== 3) return interaction.reply({ content: "❌ cooldowns: free,prem,vip (3 values).", ephemeral: true });
            const nums = parts.map(p => p === "" ? null : Number(p));
            if (nums.some(n => n !== null && (!Number.isFinite(n) || n < 0)))
              return interaction.reply({ content: "❌ cooldowns must be numbers ≥ 0.", ephemeral: true });
            [cf, cp, cv] = nums;
          }
          let st = null;
          if (thresh) { const n = Number(thresh); if (!Number.isFinite(n) || n < 0) return interaction.reply({ content: "❌ threshold must be ≥ 0.", ephemeral: true }); st = Math.floor(n); }
          await dbRun("INSERT OR IGNORE INTO items (name, enabled) VALUES (?, 1)", [item]);
          await dbRun(`INSERT INTO item_settings (item_name, min_tier, cooldown_free, cooldown_prem, cooldown_vip, stock_alert_threshold)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(item_name) DO UPDATE SET min_tier=excluded.min_tier, cooldown_free=excluded.cooldown_free,
              cooldown_prem=excluded.cooldown_prem, cooldown_vip=excluded.cooldown_vip, stock_alert_threshold=excluded.stock_alert_threshold`,
            [item, minTier, cf, cp, cv, st]);
          ensureCodesFile(item);
          await audit(interaction.guild, interaction.user.id, "ITEM_RULES_SET",
            `• item=${item} minTier=${minTier} cd=[${cf ?? "def"},${cp ?? "def"},${cv ?? "def"}] alert=${st ?? "off"}`);
          return interaction.reply({ content: `✅ Updated rules for **${item}**.`, ephemeral: true });
        }

        if (interaction.customId === "genv2_modal_code_add_one") {
          const item = normItem(interaction.fields.getTextInputValue("item"));
          const code = String(interaction.fields.getTextInputValue("code")).trim();
          await dbRun("INSERT OR IGNORE INTO items (name, enabled) VALUES (?, 1)", [item]);
          await dbRun("INSERT OR IGNORE INTO item_settings (item_name) VALUES (?)", [item]);
          const added = appendCodes(item, [code]);
          await audit(interaction.guild, interaction.user.id, "CODE_ADD_ONE", `• item=${item} added=${added}`);
          await maybeAlertLowStock(interaction.guild, item);
          return interaction.reply({ content: added ? `✅ Added code to **${item}**.` : "⚠️ Duplicate skipped.", ephemeral: true });
        }

        if (interaction.customId === "genv2_modal_code_add_bulk") {
          const item = normItem(interaction.fields.getTextInputValue("item"));
          const raw = String(interaction.fields.getTextInputValue("codes"));
          const codes = raw.split("\n").map(s => s.trim()).filter(Boolean);
          await dbRun("INSERT OR IGNORE INTO items (name, enabled) VALUES (?, 1)", [item]);
          await dbRun("INSERT OR IGNORE INTO item_settings (item_name) VALUES (?)", [item]);
          const added = appendCodes(item, codes);
          await audit(interaction.guild, interaction.user.id, "CODE_ADD_BULK", `• item=${item} added=${added}/${codes.length}`);
          await maybeAlertLowStock(interaction.guild, item);
          return interaction.reply({ content: `✅ Added **${added}** new codes to **${item}** (duplicates skipped).`, ephemeral: true });
        }

        if (interaction.customId === "genv2_modal_access_grant") {
          const userId = String(interaction.fields.getTextInputValue("user")).trim();
          const duration = String(interaction.fields.getTextInputValue("duration")).trim();
          const note = (interaction.fields.getTextInputValue("note") || "").trim();
          const durSec = parseDurationToSeconds(duration);
          if (durSec === undefined) return interaction.reply({ content: "❌ Bad duration.", ephemeral: true });
          const expires = durSec === null ? null : (now() + durSec);
          await dbRun(`INSERT INTO access (user_id, expires_at, note) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at, note=excluded.note`, [userId, expires, note]);
          await audit(interaction.guild, interaction.user.id, "ACCESS_GRANT", `• user=${userId} duration=${duration}`);
          try {
            const u = await client.users.fetch(userId);
            await u.send(applyTemplate(G.dmTemplates.accessGranted, {
              guild: interaction.guild.name, plan: "ACCESS", expires: formatExpires(expires), note: note || "-"
            }));
          } catch {}
          return interaction.reply({ content: `✅ Granted access to **${userId}** (${duration}).`, ephemeral: true });
        }

        if (interaction.customId === "genv2_modal_access_revoke") {
          const userId = String(interaction.fields.getTextInputValue("user")).trim();
          await dbRun("DELETE FROM access WHERE user_id = ?", [userId]);
          await audit(interaction.guild, interaction.user.id, "ACCESS_REVOKE", `• user=${userId}`);
          return interaction.reply({ content: `✅ Revoked access for **${userId}**.`, ephemeral: true });
        }
      }
    } catch (e) {
      console.error("[gen-v2] interaction error:", e);
      try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "⚠️ Something went wrong.", ephemeral: true }); } catch {}
    }
  });

  // ── Message commands (.gen, .stock, .bl, .ubl, .rlimit, .status, .mod, .help, .genhelp) ──

  client.on("messageCreate", async (message) => {
    try {
      if (!message.guild || message.author.bot) return;
      const content = (message.content || "").trim();

      // auto-delete (mod) — only non-command messages
      if (!content.startsWith(".")) {
        const sec = await getAutoDeleteSeconds(message.channel.id);
        if (sec && sec >= 5) setTimeout(() => message.delete().catch(() => {}), sec * 1000);
        return;
      }

      const lc = content.toLowerCase();

      if (lc === ".genhelp") return message.reply({ embeds: [genHelpEmbed()] });

      // .help [section] — only respond if user explicitly typed .help (don't clash with main bot's .help)
      if (lc === ".genmenu" || lc.startsWith(".genmenu ")) {
        const parts = content.split(/\s+/);
        const section = (parts[1] || "general").toLowerCase();
        const pick = ["general","gen","mod","admin"].includes(section) ? section : "general";
        return message.reply({ embeds: [helpEmbed(pick)] });
      }

      // .gen <item> [amount]
      if (lc.startsWith(".gen ")) {
        const allowed = G.genChannelIds;
        if (allowed.length && !allowed.includes(message.channel.id))
          return message.reply("❌ Use .gen only in the gen channel.");
        const args = content.split(/\s+/);
        const item = normItem(args[1]);
        let amount = Number(args[2] || 1);
        if (!item) return message.reply("Usage: `.gen <item> [amount]`");
        if (!Number.isFinite(amount) || amount < 1) amount = 1;

        return performGen({
          guild: message.guild, member: message.member, user: message.author, item, amount,
          replySuccess: (msg) => message.reply(msg),
          replyError:   (msg) => message.reply(msg),
        });
      }

      // .stock
      if (lc === ".stock") {
        const items = await dbAll("SELECT name, enabled FROM items ORDER BY name ASC");
        if (!items.length) return message.reply("No items yet.");
        const lines = items.map(it => `• **${it.name}**: ${stockCount(it.name)} remaining ${it.enabled ? "✅" : "⛔"}`);
        return message.reply(lines.join("\n"));
      }

      // .bl / .ubl (admin) — gen-only blacklist
      if (lc.startsWith(".bl ")) {
        if (!hasAdmin(message.member)) return message.reply("❌ Admin only.");
        const userId = content.split(/\s+/)[1];
        if (!userId) return message.reply("Usage: `.bl USERID`");
        await dbRun("INSERT OR IGNORE INTO blacklist (user_id) VALUES (?)", [userId]);
        return message.reply(`⛔ User **${userId}** blacklisted from gen.`);
      }
      if (lc.startsWith(".ubl ")) {
        if (!hasAdmin(message.member)) return message.reply("❌ Admin only.");
        const userId = content.split(/\s+/)[1];
        if (!userId) return message.reply("Usage: `.ubl USERID`");
        await dbRun("DELETE FROM blacklist WHERE user_id = ?", [userId]);
        return message.reply(`✅ User **${userId}** unblacklisted from gen.`);
      }

      // .rlimit USERID
      if (lc.startsWith(".rlimit ")) {
        if (!hasAdmin(message.member)) return message.reply("❌ Admin only.");
        const userId = content.split(/\s+/)[1];
        if (!userId) return message.reply("Usage: `.rlimit USERID`");
        await dbRun("DELETE FROM daily_usage WHERE user_id = ?", [userId]);
        await dbRun("DELETE FROM cooldowns   WHERE user_id = ?", [userId]);
        return message.reply(`✅ Daily + cooldowns reset for **${userId}**.`);
      }

      // .status USERID
      if (lc.startsWith(".status ")) {
        if (!hasAdmin(message.member)) return message.reply("❌ Admin only.");
        const userId = content.split(/\s+/)[1];
        if (!userId) return message.reply("Usage: `.status USERID`");
        const targetMember = await message.guild.members.fetch(userId).catch(() => null);
        const tier = targetMember ? getTier(targetMember) : "FREE";
        const tierCfg = G.tiers[tier] || { cooldownSeconds: 3600, dailyLimit: 5 };
        const drow = await dbGet("SELECT used_count FROM daily_usage WHERE user_id = ? AND day_key = ?", [userId, dayKey()]);
        const usedToday = drow ? drow.used_count : 0;
        const leftToday = Math.max(0, tierCfg.dailyLimit - usedToday);
        const crows = await dbAll("SELECT item_name, last_used_at FROM cooldowns WHERE user_id = ?", [userId]);
        const active = [];
        for (const r of crows) {
          const s = await getItemSettings(r.item_name);
          const cdSec = resolveCooldownForTier(s, tier, tierCfg.cooldownSeconds);
          const remain = cdSec - (now() - r.last_used_at);
          if (remain > 0) active.push(`• **${r.item_name}**: ${Math.ceil(remain)}s left (cd ${cdSec}s)`);
        }
        const lines = [
          `👤 User: **${userId}**`,
          `⭐ Tier: **${tier}**`,
          `📅 Daily: **${usedToday}/${tierCfg.dailyLimit}** • **${leftToday}** left`,
          `⏳ Cooldowns:`,
          active.length ? active.join("\n") : "• None ✅",
        ];
        return message.reply(lines.join("\n"));
      }

      // .mod <sub> ...
      if (lc.startsWith(".mod ")) {
        if (!hasMod(message.member)) return message.reply("❌ Staff only.");
        const args = content.split(/\s+/);
        const sub = (args[1] || "").toLowerCase();
        if (sub === "purge") {
          const n = Math.max(1, Math.min(100, Number(args[2] || 0) || 0));
          if (!n) return message.reply("Usage: `.mod purge 10`");
          const msgs = await message.channel.messages.fetch({ limit: n });
          await message.channel.bulkDelete(msgs, true);
          return message.reply(`✅ Deleted **${msgs.size}** messages.`);
        }
        if (sub === "lock" || sub === "unlock") {
          await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: sub === "unlock" });
          return message.reply(sub === "unlock" ? "✅ Unlocked." : "✅ Locked.");
        }
        if (sub === "nuke") {
          const old = message.channel;
          const cloned = await old.clone();
          await cloned.setPosition(old.position);
          await old.delete("Nuked");
          return cloned.send(`✅ Nuked by <@${message.author.id}>.`);
        }
        if (sub === "autodelete") {
          const sec = Math.max(5, Math.min(86400, Number(args[2] || 0) || 0));
          if (!sec) return message.reply("Usage: `.mod autodelete 30`");
          await setAutoDeleteSeconds(message.channel.id, sec);
          return message.reply(`✅ Auto-delete: **${sec}s**.`);
        }
        if (sub === "autodeleteoff") {
          await clearAutoDelete(message.channel.id);
          return message.reply("✅ Auto-delete disabled.");
        }
        return; // unknown sub — let other handlers take it
      }
    } catch (e) {
      console.error("[gen-v2] message error:", e);
    }
  });
}

// ── Slash command builders (for deploy-commands.js) ────────

function buildSlashCommands() {
  return [
    new SlashCommandBuilder().setName("gen").setDescription("DM you one code from an item.")
      .addStringOption(o => o.setName("item").setDescription("Item name").setRequired(true)),
    new SlashCommandBuilder().setName("genadmin").setDescription("Open the gen admin menu (admins only)."),
    new SlashCommandBuilder().setName("me").setDescription("Check your tier and access status."),
    new SlashCommandBuilder().setName("genhelp").setDescription("How generation works."),
    new SlashCommandBuilder().setName("exportlogs").setDescription("Export gen audit logs (admins).")
      .addIntegerOption(o => o.setName("hours").setDescription("Hours back (default 24)").setRequired(false)),
    new SlashCommandBuilder().setName("mod").setDescription("Moderation tools (staff only).")
      .addSubcommand(s => s.setName("purge").setDescription("Delete recent messages.")
        .addIntegerOption(o => o.setName("amount").setDescription("1-100").setRequired(true)))
      .addSubcommand(s => s.setName("lock").setDescription("Lock channel."))
      .addSubcommand(s => s.setName("unlock").setDescription("Unlock channel."))
      .addSubcommand(s => s.setName("nuke").setDescription("Clone + delete channel."))
      .addSubcommand(s => s.setName("autodelete").setDescription("Auto-delete after X seconds.")
        .addIntegerOption(o => o.setName("seconds").setDescription("5-86400").setRequired(true)))
      .addSubcommand(s => s.setName("autodeleteoff").setDescription("Disable auto-delete.")),
  ];
}

module.exports = { register, buildSlashCommands };
