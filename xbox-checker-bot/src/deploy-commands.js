const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const config = require("./config");

const commands = [
  new SlashCommandBuilder().setName("xboxcheck").setDescription("Check Xbox/Microsoft accounts")
    .addStringOption((o) => o.setName("accounts").setDescription("email:pass combos").setRequired(false))
    .addAttachmentOption((o) => o.setName("file").setDescription(".txt with combos").setRequired(false))
    .addIntegerOption((o) => o.setName("threads").setDescription("Thread count (max 50)").setRequired(false)),
  new SlashCommandBuilder().setName("xboxhelp").setDescription("Checker help"),
  new SlashCommandBuilder().setName("gen").setDescription("Generate an item")
    .addStringOption((o) => o.setName("category").setDescription("Category").setRequired(false)),
  new SlashCommandBuilder().setName("stock").setDescription("View stock"),
  new SlashCommandBuilder().setName("restock").setDescription("Add stock (admin)")
    .addStringOption((o) => o.setName("category").setDescription("Category").setRequired(true))
    .addAttachmentOption((o) => o.setName("file").setDescription(".txt with lines").setRequired(true)),
  new SlashCommandBuilder().setName("addcategory").setDescription("New category (admin)")
    .addStringOption((o) => o.setName("name").setDescription("Name").setRequired(true)),
  new SlashCommandBuilder().setName("removecategory").setDescription("Delete category (admin)")
    .addStringOption((o) => o.setName("name").setDescription("Name").setRequired(true)),
  new SlashCommandBuilder().setName("clearstock").setDescription("Wipe stock (admin)")
    .addStringOption((o) => o.setName("category").setDescription("Category").setRequired(true)),
  new SlashCommandBuilder().setName("genstats").setDescription("User stats")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(false)),
  new SlashCommandBuilder().setName("addpremium").setDescription("Grant premium (admin)")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
  new SlashCommandBuilder().setName("removepremium").setDescription("Revoke premium (admin)")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
  new SlashCommandBuilder().setName("premiumlist").setDescription("Premium users (admin)"),
  new SlashCommandBuilder().setName("setfree").setDescription("Set free limit (admin)")
    .addIntegerOption((o) => o.setName("limit").setDescription("Daily cap").setRequired(true)),
  new SlashCommandBuilder().setName("setpremium").setDescription("Set premium limit (admin)")
    .addIntegerOption((o) => o.setName("limit").setDescription("Daily cap").setRequired(true)),
  new SlashCommandBuilder().setName("genhelp").setDescription("All commands"),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.BOT_TOKEN);

(async () => {
  try {
    console.log("Registering commands...");
    await rest.put(Routes.applicationCommands(config.CLIENT_ID), { body: commands });
    console.log("Done.");
  } catch (err) {
    console.error(err);
  }
})();
