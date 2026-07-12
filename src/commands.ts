import { SlashCommandBuilder } from "discord.js";

export const commandData = [
  new SlashCommandBuilder().setName("ota-preview").setDescription("Queue an Android preview OTA update")
    .addStringOption((option) => option.setName("message").setDescription("Safe update message (maximum 120 characters)").setRequired(true).setMaxLength(120)),
  new SlashCommandBuilder().setName("status").setDescription("Show safe bot and workflow status"),
  new SlashCommandBuilder().setName("links").setDescription("Show AxionRide project links"),
  new SlashCommandBuilder().setName("help").setDescription("Show AxionRide bot help"),
].map((command) => command.toJSON());

