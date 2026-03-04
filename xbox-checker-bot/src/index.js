const {
  Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require("discord.js");

const config = require("./config");
const { checkAccounts } = require("./utils/xbox-checker");
const { GenManager } = require("./utils/gen-manager");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const gen = new GenManager();
const activeAborts = new Map();

function isOwner(id) { return id === config.OWNER_ID; }

function splitInput(raw) {
  if (!raw) return [];
  return raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

async function fetchLines(att) {
  try {
    const r = await fetch(att.url);
    return (await r.text()).split(/\r?\n/).filter((l) => l.trim());
  } catch { return []; }
}

function stopBtn(uid) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stop_${uid}`).setLabel("Stop").setStyle(ButtonStyle.Danger)
  );
}

function e(color) {
  return new EmbedBuilder().setColor(color || config.COLORS.PRIMARY).setFooter({ text: config.FOOTER }).setTimestamp();
}

function bar(cur, tot, w = 20) {
  const pct = tot > 0 ? cur / tot : 0;
  const f = Math.round(pct * w);
  return "\u2588".repeat(f) + "\u2591".repeat(w - f) + ` ${cur}/${tot}`;
}

function txtFile(lines, name) {
  return new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf-8"), { name });
}

function parseUid(s) {
  if (!s) return null;
  const m = s.match(/^<@!?(\d+)>$/);
  if (m) return m[1];
  return /^\d{17,20}$/.test(s) ? s : null;
}

// xbox check

async function handleXboxCheck(uid, raw, file, threads, respond, dm) {
  let accs = splitInput(raw).filter((a) => a.includes(":"));
  if (file) accs = accs.concat((await fetchLines(file)).filter((l) => l.includes(":")));
  accs = [...new Set(accs)];

  if (!accs.length) return respond({ embeds: [e().setDescription("No valid email:pass combos provided.")] });

  const tc = Math.min(Math.max(threads || config.MAX_THREADS, 1), 50);
  const msg = await respond({
    embeds: [e().setDescription(`Starting check on ${accs.length} accounts (${tc} threads)...\n\n\`${bar(0, accs.length)}\``)],
    components: [stopBtn(uid)], fetchReply: true,
  });

  const ac = new AbortController();
  activeAborts.set(uid, ac);
  const t0 = Date.now();
  let lastUp = 0;

  const results = await checkAccounts(accs, tc, (done, total) => {
    const now = Date.now();
    if (now - lastUp < 3000) return;
    lastUp = now;
    const sec = ((now - t0) / 1000).toFixed(1);
    const cpm = sec > 0 ? Math.round(done / (sec / 60)) : 0;
    msg.edit({ embeds: [e().setDescription(`Checking...\n\n\`${bar(done, total)}\`\n\nCPM: ${cpm} | ${sec}s`)], components: [stopBtn(uid)] }).catch(() => {});
  }, ac.signal);

  activeAborts.delete(uid);

  const s = { checked: results.length, hits: 0, free: 0, locked: 0, fails: 0 };
  const hitL = [], freeL = [], lockL = [];

  for (const r of results) {
    if (r.status === "hit") {
      s.hits++;
      hitL.push(`${r.user}:${r.password} | ${Object.entries(r.captures || {}).map(([k, v]) => `${k}: ${v}`).join(" | ")}`);
    } else if (r.status === "free") {
      s.free++;
      freeL.push(`${r.user}:${r.password} | ${Object.entries(r.captures || {}).map(([k, v]) => `${k}: ${v}`).join(" | ")}`);
    } else if (r.status === "locked") {
      s.locked++;
      lockL.push(`${r.user}:${r.password} -> ${r.detail}`);
    } else { s.fails++; }
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  s.cpm = sec > 0 ? Math.round(s.checked / (sec / 60)) : 0;

  const files = [];
  if (hitL.length) files.push(txtFile(hitL, "Hits.txt"));
  if (freeL.length) files.push(txtFile(freeL, "Free.txt"));
  if (lockL.length) files.push(txtFile(lockL, "Locked.txt"));

  const re = e().setTitle("Check Results").addFields(
    { name: "Checked", value: `\`${s.checked}\``, inline: true },
    { name: "Hits", value: `\`${s.hits}\``, inline: true },
    { name: "Free", value: `\`${s.free}\``, inline: true },
    { name: "Locked", value: `\`${s.locked}\``, inline: true },
    { name: "Fails", value: `\`${s.fails}\``, inline: true },
    { name: "CPM", value: `\`${s.cpm}\``, inline: true },
  );

  if (dm) {
    try {
      const u = await client.users.fetch(uid);
      await (await u.createDM()).send({ embeds: [re], files });
      await msg.edit({ embeds: [e().setDescription("Done. Results sent to DMs.")], components: [] });
    } catch { await msg.edit({ embeds: [re], files, components: [] }); }
  } else {
    await msg.edit({ embeds: [re], files, components: [] });
  }
}

// gen

async function handleGen(uid, cat, respond) {
  if (!cat) {
    const cats = gen.getCategories();
    if (!cats.length) return respond({ embeds: [e().setDescription("No categories available.")] });
    const st = gen.getAllStockCounts();
    return respond({ embeds: [e().setTitle("Categories").setDescription(
      cats.map((c) => `\`${c}\` — ${st[c]} in stock`).join("\n") + `\n\nUsage: \`${config.PREFIX}gen <category>\``
    )] });
  }

  const res = gen.generate(uid, cat.toLowerCase());

  if (res.error === "category_not_found") return respond({ embeds: [e(config.COLORS.ERROR).setDescription(`Category \`${cat}\` not found.`)] });
  if (res.error === "limit_reached") {
    const st = gen.getUserStats(uid);
    return respond({ embeds: [e(config.COLORS.ERROR).setDescription(`Limit reached. ${st.today}/${st.limit} used.\nResets midnight UTC.`)] });
  }
  if (res.error === "out_of_stock") return respond({ embeds: [e(config.COLORS.WARNING).setDescription(`\`${cat}\` out of stock.`)] });

  try {
    const u = await client.users.fetch(uid);
    await (await u.createDM()).send({ embeds: [
      e(config.COLORS.SUCCESS).setTitle("Generated")
        .addFields({ name: "Category", value: `\`${cat}\``, inline: true }, { name: "Remaining", value: `\`${res.remaining}\``, inline: true })
        .setDescription(`\`\`\`\n${res.item}\n\`\`\``)
    ] });
    return respond({ embeds: [e(config.COLORS.SUCCESS).setDescription(`Sent to DMs. ${res.remaining} left today.`)] });
  } catch {
    return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Could not DM you. Check your privacy settings.")] });
  }
}

async function handleStock(respond) {
  const cats = gen.getCategories();
  if (!cats.length) return respond({ embeds: [e().setDescription("No categories.")] });
  const st = gen.getAllStockCounts();
  const total = Object.values(st).reduce((a, b) => a + b, 0);
  const lines = cats.map((c) => `\`${c}\` — \`${st[c]}\``);
  lines.push(`\nTotal: \`${total}\``);
  return respond({ embeds: [e().setTitle("Stock").setDescription(lines.join("\n"))] });
}

async function handleRestock(uid, cat, att, respond) {
  if (!isOwner(uid)) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Owner only.")] });
  if (!cat) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Specify a category.")] });
  if (!gen.categoryExists(cat)) return respond({ embeds: [e(config.COLORS.ERROR).setDescription(`\`${cat}\` doesn't exist.`)] });
  if (!att) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Attach a .txt file.")] });
  const lines = await fetchLines(att);
  if (!lines.length) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Empty file.")] });
  const added = gen.addStock(cat, lines);
  return respond({ embeds: [e(config.COLORS.SUCCESS).setDescription(`+${added} to \`${cat}\`. Total: \`${gen.getStockCount(cat)}\``)] });
}

async function handleAddCat(uid, name, respond) {
  if (!isOwner(uid)) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Owner only.")] });
  if (!name) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Specify a name.")] });
  if (gen.addCategory(name)) return respond({ embeds: [e(config.COLORS.SUCCESS).setDescription(`\`${name.toLowerCase()}\` created.`)] });
  return respond({ embeds: [e(config.COLORS.ERROR).setDescription(`\`${name.toLowerCase()}\` already exists.`)] });
}

async function handleRemoveCat(uid, name, respond) {
  if (!isOwner(uid)) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Owner only.")] });
  if (!name) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Specify a name.")] });
  if (gen.removeCategory(name)) return respond({ embeds: [e(config.COLORS.SUCCESS).setDescription(`\`${name.toLowerCase()}\` removed.`)] });
  return respond({ embeds: [e(config.COLORS.ERROR).setDescription(`\`${name.toLowerCase()}\` not found.`)] });
}

async function handleClearStock(uid, cat, respond) {
  if (!isOwner(uid)) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Owner only.")] });
  if (!cat || !gen.categoryExists(cat)) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Invalid category.")] });
  gen.clearStock(cat);
  return respond({ embeds: [e(config.COLORS.SUCCESS).setDescription(`Cleared \`${cat}\`.`)] });
}

async function handleStats(uid, target, respond) {
  const id = target || uid;
  const st = gen.getUserStats(id);
  const hist = Object.entries(st.history).map(([k, v]) => `  ${k}: ${v}`);
  return respond({ embeds: [
    e().setTitle("Stats")
      .addFields(
        { name: "User", value: `<@${id}>`, inline: true },
        { name: "Tier", value: `\`${st.premium ? "Premium" : "Free"}\``, inline: true },
        { name: "Daily", value: `\`${st.today}/${st.limit}\``, inline: true },
        { name: "Left", value: `\`${st.remaining}\``, inline: true },
        { name: "All Time", value: `\`${st.total}\``, inline: true },
      )
      .setDescription(hist.length ? "```\n" + hist.join("\n") + "\n```" : ""),
  ] });
}

async function handleAddPremium(uid, target, respond) {
  if (!isOwner(uid)) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Owner only.")] });
  if (!target) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Mention a user.")] });
  gen.addPremium(target);
  return respond({ embeds: [e(config.COLORS.SUCCESS).setDescription(`<@${target}> added to premium.`)] });
}

async function handleRemovePremium(uid, target, respond) {
  if (!isOwner(uid)) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Owner only.")] });
  if (!target) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Mention a user.")] });
  gen.removePremium(target);
  return respond({ embeds: [e(config.COLORS.SUCCESS).setDescription(`<@${target}> removed from premium.`)] });
}

async function handlePremiumList(uid, respond) {
  if (!isOwner(uid)) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Owner only.")] });
  const list = gen.getPremiumUsers();
  if (!list.length) return respond({ embeds: [e().setDescription("None.")] });
  return respond({ embeds: [e().setTitle("Premium Users").setDescription(list.map((u, i) => `\`${i + 1}.\` <@${u}>`).join("\n"))] });
}

async function handleSetLimit(uid, type, val, respond) {
  if (!isOwner(uid)) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Owner only.")] });
  const n = parseInt(val);
  if (isNaN(n) || n < 1) return respond({ embeds: [e(config.COLORS.ERROR).setDescription("Invalid number.")] });
  if (type === "free") { gen.setFreeLimit(n); return respond({ embeds: [e(config.COLORS.SUCCESS).setDescription(`Free limit: \`${n}/day\``)] }); }
  gen.setPremiumLimit(n);
  return respond({ embeds: [e(config.COLORS.SUCCESS).setDescription(`Premium limit: \`${n}/day\``)] });
}

async function handleHelp(respond) {
  const p = config.PREFIX;
  const lines = [
    "```",
    "GENERATOR",
    `  ${p}gen <category>        Generate (DM)`,
    `  ${p}gen                   List categories`,
    `  ${p}stock                 Stock counts`,
    `  ${p}stats [@user|id]      User stats`,
    "",
    "ADMIN",
    `  ${p}addcategory <name>    New category`,
    `  ${p}removecategory <name> Delete category`,
    `  ${p}restock <cat> + .txt  Add stock`,
    `  ${p}clearstock <cat>      Wipe stock`,
    `  ${p}addpremium <@user>    Grant premium`,
    `  ${p}removepremium <@user> Revoke premium`,
    `  ${p}premiumlist           Premium users`,
    `  ${p}setfree <n>           Free daily cap`,
    `  ${p}setpremium <n>        Premium daily cap`,
    "",
    "XBOX",
    `  ${p}xboxcheck + .txt      Check accounts`,
    `  ${p}xboxhelp              Checker help`,
    "",
    `Free: ${gen.getFreeLimit()}/day  |  Premium: ${gen.getPremiumLimit()}/day`,
    "Resets midnight UTC",
    "```",
  ];
  return respond({ embeds: [e().setTitle("Commands").setDescription(lines.join("\n"))] });
}

// slash commands

client.on("interactionCreate", async (ix) => {
  if (ix.isButton() && ix.customId.startsWith("stop_")) {
    const t = ix.customId.split("_")[1];
    if (ix.user.id !== t && !isOwner(ix.user.id)) return ix.reply({ content: "Not yours.", ephemeral: true });
    const c = activeAborts.get(t);
    if (c) { c.abort(); activeAborts.delete(t); }
    return ix.reply({ content: "Stopped.", ephemeral: true });
  }

  if (!ix.isChatInputCommand()) return;
  const uid = ix.user.id;
  const rp = (o) => (ix.deferred || ix.replied) ? ix.editReply(o) : ix.reply(o);

  switch (ix.commandName) {
    case "xboxcheck":
      await ix.deferReply();
      return handleXboxCheck(uid, ix.options.getString("accounts"), ix.options.getAttachment("file"), ix.options.getInteger("threads"), (o) => ix.editReply(o), true);
    case "xboxhelp":
      return rp({ embeds: [e().setTitle("Xbox Checker").setDescription(`\`${config.PREFIX}xboxcheck\` or \`/xboxcheck\` with email:pass combos.\nAttach .txt for bulk. Results via DM.`)] });
    case "gen":
      return handleGen(uid, ix.options.getString("category"), rp);
    case "stock":
      return handleStock(rp);
    case "restock":
      await ix.deferReply();
      return handleRestock(uid, ix.options.getString("category"), ix.options.getAttachment("file"), (o) => ix.editReply(o));
    case "addcategory":
      return handleAddCat(uid, ix.options.getString("name"), rp);
    case "removecategory":
      return handleRemoveCat(uid, ix.options.getString("name"), rp);
    case "clearstock":
      return handleClearStock(uid, ix.options.getString("category"), rp);
    case "genstats":
      return handleStats(uid, ix.options.getUser("user")?.id, rp);
    case "addpremium":
      return handleAddPremium(uid, ix.options.getUser("user")?.id, rp);
    case "removepremium":
      return handleRemovePremium(uid, ix.options.getUser("user")?.id, rp);
    case "premiumlist":
      return handlePremiumList(uid, rp);
    case "setfree":
      return handleSetLimit(uid, "free", String(ix.options.getInteger("limit")), rp);
    case "setpremium":
      return handleSetLimit(uid, "premium", String(ix.options.getInteger("limit")), rp);
    case "genhelp":
      return handleHelp(rp);
  }
});

// prefix commands

client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.content.startsWith(config.PREFIX)) return;
  const args = msg.content.slice(config.PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  const uid = msg.author.id;
  const rp = (o) => msg.reply(o);

  switch (cmd) {
    case "xboxcheck":
      return handleXboxCheck(uid, args.join("\n"), msg.attachments.first(), parseInt(args.find((a) => /^\d+$/.test(a))) || null, rp, true);
    case "xboxhelp":
      return rp({ embeds: [e().setTitle("Xbox Checker").setDescription(`\`${config.PREFIX}xboxcheck\` with email:pass combos.\nAttach .txt for bulk. Results via DM.`)] });
    case "gen":
      return handleGen(uid, args[0], rp);
    case "stock":
      return handleStock(rp);
    case "restock":
      return handleRestock(uid, args[0], msg.attachments.first(), rp);
    case "addcategory":
      return handleAddCat(uid, args[0], rp);
    case "removecategory":
      return handleRemoveCat(uid, args[0], rp);
    case "clearstock":
      return handleClearStock(uid, args[0], rp);
    case "stats":
      return handleStats(uid, parseUid(args[0]), rp);
    case "addpremium":
      return handleAddPremium(uid, parseUid(args[0]), rp);
    case "removepremium":
      return handleRemovePremium(uid, parseUid(args[0]), rp);
    case "premiumlist":
      return handlePremiumList(uid, rp);
    case "setfree":
      return handleSetLimit(uid, "free", args[0], rp);
    case "setpremium":
      return handleSetLimit(uid, "premium", args[0], rp);
    case "genhelp": case "help":
      return handleHelp(rp);
  }
});

client.on("ready", () => {
  console.log(`${client.user.tag} online | ${client.guilds.cache.size} guilds`);
  client.user.setActivity(`${config.PREFIX}help`, { type: 3 });
});

client.login(config.BOT_TOKEN);
