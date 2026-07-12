import { REST, Routes } from "discord.js";
import { commandData } from "./commands.js";
import { loadConfig } from "./config.js";

async function main() {
  const config = loadConfig();
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  const route = config.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID)
    : Routes.applicationCommands(config.DISCORD_CLIENT_ID);
  await rest.put(route, { body: commandData });
  console.log(`Registered ${commandData.length} AxionRide commands ${config.DISCORD_GUILD_ID ? "for the configured guild" : "globally"}.`);
}

main().catch((error) => { console.error("Command registration failed", error instanceof Error ? error.message : "unknown error"); process.exitCode = 1; });

