// ============================================================
//  Xbox Checker + Gen Bot — Discord Bot
// ============================================================

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const config = require("./config");
const { checkAccounts } = require("./utils/xbox-checker");
const { GenManager } = require("./utils/gen-manager");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const gen = new GenManager();
const activeAborts = new Map();

// ── Helpers ──────────────────────────────────────────────────

function isOwner(userId) {
  return userId === config.OWNER_ID;
}

function splitInput(raw) {
  if (!raw) return [];
  return raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

async function fetchAttachmentLines(attachment) {
  try {
    const res = await fetch(attachment.url);
    const text = await res.text();
    return text.split(/\r?\n/).filter((l) => l.trim());
  } catch {
    return [];
  }
}

function stopButton(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`xboxstop_${userId}`)
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
  );
}

function embed(color) {
  return new EmbedBuilder()
    .setColor(color || config.COLORS.PRIMARY)
    .setFooter({ text: "Xbox Checker & Gen" })
    .setTimestamp();
}

function progressBar(current, total, width = 20) {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(pct * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled) + ` ${current}/${total}`;
}

function textAttachment(lines, filename) {
  const buffer = Buffer.from(lines.join("\n"), "utf-8");
  return new AttachmentBuilder(buffer, { name: filename });
}

// ── Xbox Check Handler ──────────────────────────────────────

async function handleXboxCheck(userId, accountsRaw, accountsFile, threads, respond, sendDM) {
  let accounts = splitInput(accountsRaw).filter((a) => a.includes(":"));
  if (accountsFile) {
    const lines = await fetchAttachmentLines(accountsFile);
    accounts = accounts.concat(lines.filter((l) => l.includes(":")));
  }
  accounts = [...new Set(accounts)];

  if (accounts.length === 0) {
    return respond({ embeds: [embed().setDescription("No valid email:pass combos provided.")] });
  }

  const threadCount = Math.min(Math.max(threads || config.MAX_THREADS, 1), 50);
  const progressEmbed = embed().setDescription(
    `Starting check on ${accounts.length} accounts (${threadCount} threads)...\n\n\`${progressBar(0, accounts.length)}\``
  );
  const msg = await respond({ embeds: [progressEmbed], components: [stopButton(userId)], fetchReply: true });

  const abortController = new AbortController();
  activeAborts.set(userId, abortController);
  const startTime = Date.now();
  let lastEdit = 0;

  const results = await checkAccounts(
    accounts, threadCount,
    (completed, total) => {
      const now = Date.now();
      if (now - lastEdit < 3000) return;
      lastEdit = now;
      const elapsed = ((now - startTime) / 1000).toFixed(1);
      const cpm = elapsed > 0 ? Math.round(completed / (elapsed / 60)) : 0;
      const e = embed().setDescription(
        `Checking...\n\n\`${progressBar(completed, total)}\`\n\nCPM: ${cpm} | Elapsed: ${elapsed}s`
      );
      msg.edit({ embeds: [e], components: [stopButton(userId)] }).catch(() => {});
    },
    abortController.signal
  );

  activeAborts.delete(userId);

  const stats = { checked: results.length, hits: 0, free: 0, locked: 0, fails: 0, retries: 0 };
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
      lockedLines.push(`${r.user}:${r.password} -> ${r.detail}`);
    } else if (r.status === "retry") {
      stats.retries++;
    } else {
      stats.fails++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  stats.cpm = elapsed > 0 ? Math.round(stats.checked / (elapsed / 60)) : 0;
  stats.elapsed = `${elapsed}s`;

  const files = [];
  if (hitLines.length > 0) files.push(textAttachment(hitLines, "Hits.txt"));
  if (freeLines.length > 0) files.push(textAttachment(freeLines, "Free_Hits.txt"));
  if (lockedLines.length > 0) files.push(textAttachment(lockedLines, "Locked.txt"));

  const resultEmbed = embed()
    .setTitle("Check Results")
    .addFields(
      { name: "Checked", value: `\`${stats.checked}\``, inline: true },
      { name: "Hits", value: `\`${stats.hits}\``, inline: true },
      { name: "Free", value: `\`${stats.free}\``, inline: true },
      { name: "Locked", value: `\`${stats.locked}\``, inline: true },
      { name: "Fails", value: `\`${stats.fails}\``, inline: true },
      { name: "CPM", value: `\`${stats.cpm}\``, inline: true },
    );

  if (sendDM) {
    try {
      const dmUser = await client.users.fetch(userId);
      const dmChannel = await dmUser.createDM();
      await dmChannel.send({ embeds: [resultEmbed], files });
      await msg.edit({ embeds: [embed().setDescription("Done. Results sent to your DMs.")], components: [] });
    } catch {
      await msg.edit({ embeds: [resultEmbed], files, components: [] });
    }
  } else {
    await msg.edit({ embeds: [resultEmbed], files, components: [] });
  }
}

// ── Gen Handlers ─────────────────────────────────────────────

async function handleGen(userId, category, respond) {
  if (!category) {
    const cats = gen.getCategories();
    if (cats.length === 0) {
      return respond({ embeds: [embed().setDescription("No categories available.")] });
    }
    const stocks = gen.getAllStockCounts();
    const lines = cats.map((c) => `\`${c}\` — ${stocks[c]} in stock`);
    return respond({
      embeds: [embed().setTitle("Available Categories").setDescription(
        lines.join("\n") + `\n\nUsage: \`${config.PREFIX}gen <category>\``
      )],
    });
  }

  const result = gen.generate(userId, category.toLowerCase());

  if (result.error === "category_not_found") {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription(`Category \`${category}\` does not exist.`)] });
  }
  if (result.error === "limit_reached") {
    const stats = gen.getUserStats(userId);
    return respond({
      embeds: [embed(config.COLORS.ERROR).setDescription(
        `Daily limit reached. ${stats.today}/${stats.limit} used.\nResets at midnight UTC.`
      )],
    });
  }
  if (result.error === "out_of_stock") {
    return respond({ embeds: [embed(config.COLORS.WARNING).setDescription(`\`${category}\` is out of stock.`)] });
  }

  // DM the item to user
  try {
    const dmUser = await client.users.fetch(userId);
    const dmChannel = await dmUser.createDM();
    await dmChannel.send({
      embeds: [
        embed(config.COLORS.SUCCESS)
          .setTitle("Generated")
          .addFields(
            { name: "Category", value: `\`${category}\``, inline: true },
            { name: "Remaining", value: `\`${result.remaining}\``, inline: true },
          )
          .setDescription(`\`\`\`\n${result.item}\n\`\`\``)
      ],
    });
    return respond({
      embeds: [embed(config.COLORS.SUCCESS).setDescription(
        `Sent to your DMs. ${result.remaining} gens remaining today.`
      )],
    });
  } catch {
    return respond({
      embeds: [embed(config.COLORS.ERROR).setDescription("Could not send DM. Enable DMs from server members.")],
    });
  }
}

async function handleStock(respond) {
  const cats = gen.getCategories();
  if (cats.length === 0) {
    return respond({ embeds: [embed().setDescription("No categories configured.")] });
  }
  const stocks = gen.getAllStockCounts();
  const total = Object.values(stocks).reduce((a, b) => a + b, 0);
  const lines = cats.map((c) => `\`${c}\` — \`${stocks[c]}\``);
  lines.push(`\nTotal: \`${total}\``);
  return respond({ embeds: [embed().setTitle("Stock Overview").setDescription(lines.join("\n"))] });
}

async function handleRestock(userId, category, attachment, respond) {
  if (!isOwner(userId)) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Owner only.")] });
  }
  if (!category) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Specify a category.")] });
  }
  if (!gen.categoryExists(category)) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription(`Category \`${category}\` does not exist.`)] });
  }
  if (!attachment) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Attach a .txt file with stock lines.")] });
  }
  const lines = await fetchAttachmentLines(attachment);
  if (lines.length === 0) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("File is empty.")] });
  }
  const added = gen.addStock(category, lines);
  return respond({
    embeds: [embed(config.COLORS.SUCCESS).setDescription(
      `Added \`${added}\` items to \`${category}\`.\nTotal: \`${gen.getStockCount(category)}\``
    )],
  });
}

async function handleAddCategory(userId, name, respond) {
  if (!isOwner(userId)) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Owner only.")] });
  }
  if (!name) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Specify a category name.")] });
  }
  if (gen.addCategory(name)) {
    return respond({ embeds: [embed(config.COLORS.SUCCESS).setDescription(`Category \`${name.toLowerCase()}\` created.`)] });
  }
  return respond({ embeds: [embed(config.COLORS.ERROR).setDescription(`Category \`${name.toLowerCase()}\` already exists.`)] });
}

async function handleRemoveCategory(userId, name, respond) {
  if (!isOwner(userId)) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Owner only.")] });
  }
  if (!name) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Specify a category name.")] });
  }
  if (gen.removeCategory(name)) {
    return respond({ embeds: [embed(config.COLORS.SUCCESS).setDescription(`Category \`${name.toLowerCase()}\` removed.`)] });
  }
  return respond({ embeds: [embed(config.COLORS.ERROR).setDescription(`Category \`${name.toLowerCase()}\` not found.`)] });
}

async function handleClearStock(userId, category, respond) {
  if (!isOwner(userId)) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Owner only.")] });
  }
  if (!category || !gen.categoryExists(category)) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Invalid category.")] });
  }
  gen.clearStock(category);
  return respond({ embeds: [embed(config.COLORS.SUCCESS).setDescription(`Stock cleared for \`${category}\`.`)] });
}

async function handleUserStats(userId, targetId, respond) {
  const uid = targetId || userId;
  const stats = gen.getUserStats(uid);
  const tier = stats.premium ? "Premium" : "Free";
  const historyLines = Object.entries(stats.history).map(([k, v]) => `  ${k}: ${v}`);

  return respond({
    embeds: [
      embed()
        .setTitle("User Stats")
        .addFields(
          { name: "User", value: `<@${uid}>`, inline: true },
          { name: "Tier", value: `\`${tier}\``, inline: true },
          { name: "Daily", value: `\`${stats.today}/${stats.limit}\``, inline: true },
          { name: "Remaining", value: `\`${stats.remaining}\``, inline: true },
          { name: "Total Generated", value: `\`${stats.total}\``, inline: true },
        )
        .setDescription(historyLines.length > 0 ? "```\n" + historyLines.join("\n") + "\n```" : "No history yet."),
    ],
  });
}

async function handleAddPremium(userId, targetId, respond) {
  if (!isOwner(userId)) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Owner only.")] });
  }
  if (!targetId) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Mention or provide a user ID.")] });
  }
  gen.addPremium(targetId);
  return respond({ embeds: [embed(config.COLORS.SUCCESS).setDescription(`<@${targetId}> is now Premium.`)] });
}

async function handleRemovePremium(userId, targetId, respond) {
  if (!isOwner(userId)) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Owner only.")] });
  }
  if (!targetId) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Mention or provide a user ID.")] });
  }
  gen.removePremium(targetId);
  return respond({ embeds: [embed(config.COLORS.SUCCESS).setDescription(`<@${targetId}> removed from Premium.`)] });
}

async function handlePremiumList(userId, respond) {
  if (!isOwner(userId)) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Owner only.")] });
  }
  const users = gen.getPremiumUsers();
  if (users.length === 0) {
    return respond({ embeds: [embed().setDescription("No premium users.")] });
  }
  const lines = users.map((u, i) => `\`${i + 1}.\` <@${u}>`);
  return respond({ embeds: [embed().setTitle("Premium Users").setDescription(lines.join("\n"))] });
}

async function handleSetLimit(userId, type, value, respond) {
  if (!isOwner(userId)) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Owner only.")] });
  }
  const n = parseInt(value);
  if (isNaN(n) || n < 1) {
    return respond({ embeds: [embed(config.COLORS.ERROR).setDescription("Provide a valid number.")] });
  }
  if (type === "free") {
    gen.setFreeLimit(n);
    return respond({ embeds: [embed(config.COLORS.SUCCESS).setDescription(`Free daily limit set to \`${n}\`.`)] });
  } else {
    gen.setPremiumLimit(n);
    return respond({ embeds: [embed(config.COLORS.SUCCESS).setDescription(`Premium daily limit set to \`${n}\`.`)] });
  }
}

async function handleGenHelp(respond) {
  const sections = [
    "```",
    "GENERATOR",
    `  ${config.PREFIX}gen <category>        Generate an item (sent via DM)`,
    `  ${config.PREFIX}gen                   List available categories`,
    `  ${config.PREFIX}stock                 View stock counts`,
    `  ${config.PREFIX}stats [@user|id]      View user gen stats`,
    "",
    "ADMIN",
    `  ${config.PREFIX}addcategory <name>    Create a new category`,
    `  ${config.PREFIX}removecategory <name> Remove a category`,
    `  ${config.PREFIX}restock <cat> + .txt  Add stock from file`,
    `  ${config.PREFIX}clearstock <cat>      Clear all stock in category`,
    `  ${config.PREFIX}addpremium <@user>    Grant premium tier`,
    `  ${config.PREFIX}removepremium <@user> Revoke premium tier`,
    `  ${config.PREFIX}premiumlist           List premium users`,
    `  ${config.PREFIX}setfree <n>           Set free daily limit`,
    `  ${config.PREFIX}setpremium <n>        Set premium daily limit`,
    "",
    "XBOX CHECKER",
    `  ${config.PREFIX}xboxcheck + .txt      Check Xbox/MS accounts`,
    `  ${config.PREFIX}xboxhelp              Xbox checker help`,
    "",
    "TIERS",
    `  Free:    ${gen.getFreeLimit()}/day`,
    `  Premium: ${gen.getPremiumLimit()}/day  (admin grant)`,
    "  Resets at midnight UTC.",
    "```",
  ];

  return respond({
    embeds: [embed().setTitle("Command Reference").setDescription(sections.join("\n"))],
  });
}

// ── Parse user ID from mention or raw ────────────────────────

function parseUserId(str) {
  if (!str) return null;
  const mention = str.match(/^<@!?(\d+)>$/);
  if (mention) return mention[1];
  if (/^\d{17,20}$/.test(str)) return str;
  return null;
}

// ── Interactions (Slash Commands) ────────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith("xboxstop_")) {
    const targetUser = interaction.customId.split("_")[1];
    if (interaction.user.id !== targetUser && !isOwner(interaction.user.id)) {
      return interaction.reply({ content: "Not your process.", ephemeral: true });
    }
    const controller = activeAborts.get(targetUser);
    if (controller) { controller.abort(); activeAborts.delete(targetUser); }
    return interaction.reply({ content: "Stopped.", ephemeral: true });
  }

  if (!interaction.isChatInputCommand()) return;
  const uid = interaction.user.id;
  const reply = (opts) => {
    if (interaction.deferred || interaction.replied) return interaction.editReply(opts);
    return interaction.reply(opts);
  };

  switch (interaction.commandName) {
    case "xboxcheck": {
      await interaction.deferReply();
      return handleXboxCheck(
        uid,
        interaction.options.getString("accounts"),
        interaction.options.getAttachment("file"),
        interaction.options.getInteger("threads"),
        (opts) => interaction.editReply(opts),
        true
      );
    }
    case "xboxhelp": {
      const e = embed().setTitle("Xbox Checker Help").setDescription(
        "Use `/xboxcheck` or `.xboxcheck` with email:pass combos.\nAttach a `.txt` for bulk.\nResults sent via DM."
      );
      return reply({ embeds: [e] });
    }
    case "gen": {
      const cat = interaction.options.getString("category");
      return handleGen(uid, cat, reply);
    }
    case "stock":
      return handleStock(reply);
    case "restock": {
      await interaction.deferReply();
      return handleRestock(uid, interaction.options.getString("category"), interaction.options.getAttachment("file"), (opts) => interaction.editReply(opts));
    }
    case "addcategory":
      return handleAddCategory(uid, interaction.options.getString("name"), reply);
    case "removecategory":
      return handleRemoveCategory(uid, interaction.options.getString("name"), reply);
    case "clearstock":
      return handleClearStock(uid, interaction.options.getString("category"), reply);
    case "genstats": {
      const target = interaction.options.getUser("user");
      return handleUserStats(uid, target?.id, reply);
    }
    case "addpremium": {
      const target = interaction.options.getUser("user");
      return handleAddPremium(uid, target?.id, reply);
    }
    case "removepremium": {
      const target = interaction.options.getUser("user");
      return handleRemovePremium(uid, target?.id, reply);
    }
    case "premiumlist":
      return handlePremiumList(uid, reply);
    case "setfree":
      return handleSetLimit(uid, "free", String(interaction.options.getInteger("limit")), reply);
    case "setpremium":
      return handleSetLimit(uid, "premium", String(interaction.options.getInteger("limit")), reply);
    case "genhelp":
      return handleGenHelp(reply);
  }
});

// ── Prefix Commands ──────────────────────────────────────────

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(config.PREFIX)) return;

  const args = message.content.slice(config.PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  const uid = message.author.id;
  const reply = (opts) => message.reply(opts);

  switch (cmd) {
    case "xboxcheck": {
      const raw = args.join("\n");
      const file = message.attachments.first();
      const threadMatch = args.find((a) => /^\d+$/.test(a));
      return handleXboxCheck(uid, raw, file, threadMatch ? parseInt(threadMatch) : null, reply, true);
    }
    case "xboxhelp": {
      return reply({
        embeds: [embed().setTitle("Xbox Checker Help").setDescription(
          "Use `/xboxcheck` or `.xboxcheck` with email:pass combos.\nAttach a `.txt` for bulk.\nResults sent via DM."
        )],
      });
    }
    case "gen":
      return handleGen(uid, args[0], reply);
    case "stock":
      return handleStock(reply);
    case "restock":
      return handleRestock(uid, args[0], message.attachments.first(), reply);
    case "addcategory":
      return handleAddCategory(uid, args[0], reply);
    case "removecategory":
      return handleRemoveCategory(uid, args[0], reply);
    case "clearstock":
      return handleClearStock(uid, args[0], reply);
    case "stats": {
      const targetId = parseUserId(args[0]);
      return handleUserStats(uid, targetId, reply);
    }
    case "addpremium":
      return handleAddPremium(uid, parseUserId(args[0]), reply);
    case "removepremium":
      return handleRemovePremium(uid, parseUserId(args[0]), reply);
    case "premiumlist":
      return handlePremiumList(uid, reply);
    case "setfree":
      return handleSetLimit(uid, "free", args[0], reply);
    case "setpremium":
      return handleSetLimit(uid, "premium", args[0], reply);
    case "genhelp":
    case "help":
      return handleGenHelp(reply);
  }
});

// ── Ready ────────────────────────────────────────────────────

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Guilds: ${client.guilds.cache.size}`);
  client.user.setActivity("Gen & Xbox | " + config.PREFIX + "help", { type: 3 });
});

client.login(config.BOT_TOKEN);
