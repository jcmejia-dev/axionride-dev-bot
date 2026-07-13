import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { startHealthServer } from "./health.js";
import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("AxionRide Bot is alive 🚀");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});
async function main() {
  const config = loadConfig();
  startHealthServer(config.PORT);
  await createBot(config).login(config.DISCORD_TOKEN);
}

main().catch((error) => {
  console.error("AxionRide Dev Bot failed to start:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});

