import express from "express";
import dotenv from "dotenv";
import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";

dotenv.config();

async function main() {
  console.log("🚀 Starting AxionRide Dev Bot...");

  // 🌐 EXPRESS SERVER (for Render + UptimeRobot)
  const app = express();

  app.get("/", (req, res) => {
    res.send("AxionRide Bot is alive 🚀");
  });

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
    });
  });

  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
  });

  // ⚙️ LOAD CONFIG
  const config = loadConfig();
  console.log("✅ Config loaded");

  // 🔑 DEBUG TOKEN (safe preview)
  console.log(
    "🔐 DISCORD_TOKEN:",
    config.DISCORD_TOKEN ? config.DISCORD_TOKEN.slice(0, 10) + "..." : "❌ MISSING"
  );

  if (!config.DISCORD_TOKEN) {
    throw new Error("❌ DISCORD_TOKEN is missing!");
  }

  // 🤖 CREATE BOT
  const client = createBot(config);

  // ✅ READY EVENT
  client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user?.tag}`);
  });

  // ❌ ERROR HANDLING
  client.on("error", (err) => {
    console.error("❌ Discord client error:", err);
  });

  // 🔌 LOGIN
  console.log("🔐 Logging into Discord...");
  await client.login(config.DISCORD_TOKEN);
}

main().catch((error) => {
  console.error(
    "❌ AxionRide Dev Bot failed to start:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});