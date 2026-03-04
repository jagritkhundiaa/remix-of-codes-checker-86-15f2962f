const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const config = require("./config");

const commands = [
  // ── Xbox ────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("xboxcheck")
    .setDescription("Check Xbox/Microsoft accounts for subscriptions and captures")
    .addStringOption((o) => o.setName("accounts").setDescription("email:pass combos (one per line or comma-separated)").setRequired(false))
    .addAttachmentOption((o) => o.setName("file").setDescription("Upload a .txt file with email:pass combos").setRequired(false))
    .addIntegerOption((o) => o.setName("threads").setDescription("Number of threads (default 15, max 50)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("xboxhelp")
    .setDescription("Show Xbox checker help"),

  // ── Gen ─────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("gen")
    .setDescription("Generate an item from a category (sent via DM)")
    .addStringOption((o) => o.setName("category").setDescription("Category name").setRequired(false)),

  new SlashCommandBuilder()
    .setName("stock")
    .setDescription("View stock counts for all categories"),

  new SlashCommandBuilder()
    .setName("restock")
    .setDescription("Add stock to a category from a .txt file (admin)")
    .addStringOption((o) => o.setName("category").setDescription("Category name").setRequired(true))
    .addAttachmentOption((o) => o.setName("file").setDescription("Upload a .txt file with stock lines").setRequired(true)),

  new SlashCommandBuilder()
    .setName("addcategory")
    .setDescription("Create a new stock category (admin)")
    .addStringOption((o) => o.setName("name").setDescription("Category name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("removecategory")
    .setDescription("Remove a stock category (admin)")
    .addStringOption((o) => o.setName("name").setDescription("Category name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("clearstock")
    .setDescription("Clear all stock in a category (admin)")
    .addStringOption((o) => o.setName("category").setDescription("Category name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("genstats")
    .setDescription("View gen stats for a user")
    .addUserOption((o) => o.setName("user").setDescription("User to check (defaults to yourself)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("addpremium")
    .setDescription("Grant premium tier to a user (admin)")
    .addUserOption((o) => o.setName("user").setDescription("User to grant premium").setRequired(true)),

  new SlashCommandBuilder()
    .setName("removepremium")
    .setDescription("Revoke premium tier from a user (admin)")
    .addUserOption((o) => o.setName("user").setDescription("User to remove premium").setRequired(true)),

  new SlashCommandBuilder()
    .setName("premiumlist")
    .setDescription("List all premium users (admin)"),

  new SlashCommandBuilder()
    .setName("setfree")
    .setDescription("Set the daily gen limit for free tier (admin)")
    .addIntegerOption((o) => o.setName("limit").setDescription("Daily limit").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setpremium")
    .setDescription("Set the daily gen limit for premium tier (admin)")
    .addIntegerOption((o) => o.setName("limit").setDescription("Daily limit").setRequired(true)),

  new SlashCommandBuilder()
    .setName("genhelp")
    .setDescription("Show all commands"),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.BOT_TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(config.CLIENT_ID), { body: commands });
    console.log("Commands registered successfully.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
})();
