import { SlashCommandBuilder } from "discord.js";

export const commandData = [
  new SlashCommandBuilder().setName("ota-preview").setDescription("Queue an Android preview OTA update")
    .addStringOption((option) => option.setName("message").setDescription("Safe update message (maximum 120 characters)").setRequired(true).setMaxLength(120))
    .addStringOption((option) => option.setName("release_notes").setDescription("Optional safe changelog notes (maximum 1000 characters)").setRequired(false).setMaxLength(1000)),
  new SlashCommandBuilder().setName("status").setDescription("Show safe bot and workflow status"),
  new SlashCommandBuilder().setName("links").setDescription("Show AxionRide project links"),
  new SlashCommandBuilder().setName("help").setDescription("Show AxionRide bot help"),
  new SlashCommandBuilder().setName("codex-task").setDescription("Queue one safe local Codex development task")
    .addStringOption((option) => option.setName("prompt").setDescription("Scoped development task (10–4000 characters)").setRequired(true).setMinLength(10).setMaxLength(4000))
    .addStringOption((option) => option.setName("branch").setDescription("Must match the current local branch").setRequired(false).setMaxLength(100)),
  new SlashCommandBuilder().setName("codex-status").setDescription("Show the current or most recent local Codex task"),
  new SlashCommandBuilder().setName("codex-cancel").setDescription("Cancel the currently running local Codex task"),
  new SlashCommandBuilder().setName("system-status").setDescription("Show detailed AxionRide control-room status"),
].map((command) => command.toJSON());
