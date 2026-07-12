import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ChatInputCommandInteraction,
  Client, Events, GatewayIntentBits,
} from "discord.js";
import type { Config } from "./config.js";
import { buildAxionEmbed, formatSafeStatus } from "./embeds.js";
import { dispatchPreviewOta } from "./github.js";
import { isAuthorized, OtaRequestGuard, validateOtaMessage } from "./security.js";

const unauthorized = "You are not allowed to use AxionRide deployment commands.";

export function createBot(config: Config): Client {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const guard = new OtaRequestGuard();
  let lastMessage: string | undefined;

  client.once(Events.ClientReady, (ready) => console.log(`AxionRide Dev Bot online as ${ready.user.tag}`));
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      const roles = interaction.member && "roles" in interaction.member
        ? (Array.isArray(interaction.member.roles) ? interaction.member.roles : [...interaction.member.roles.cache.keys()]) : [];
      if (!isAuthorized(interaction.user.id, roles, config.ALLOWED_DISCORD_USER_IDS, config.ALLOWED_DISCORD_ROLE_IDS)) {
        await interaction.reply({ content: unauthorized, ephemeral: true });
        return;
      }
      await handleCommand(interaction, config, guard, () => lastMessage, (value) => { lastMessage = value; });
    } catch (error) {
      console.error("Command failed", error instanceof Error ? error.message : "unknown error");
      const content = "The request could not be completed safely. Please try again later.";
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content, ephemeral: true });
      else await interaction.reply({ content, ephemeral: true });
    }
  });
  return client;
}

async function handleCommand(
  interaction: ChatInputCommandInteraction, config: Config, guard: OtaRequestGuard,
  getLast: () => string | undefined, setLast: (message: string) => void,
) {
  if (interaction.commandName === "ota-preview") {
    let message: string;
    try { message = validateOtaMessage(interaction.options.getString("message", true)); }
    catch (error) { await interaction.reply({ content: error instanceof Error ? error.message : "Invalid message.", ephemeral: true }); return; }
    let release: () => void;
    try { release = guard.acquire(interaction.user.id); }
    catch (error) { await interaction.reply({ content: error instanceof Error ? error.message : "Request blocked.", ephemeral: true }); return; }
    await interaction.deferReply({ ephemeral: true });
    try {
      await dispatchPreviewOta({ token: config.GITHUB_TOKEN, owner: config.GITHUB_OWNER, repo: config.GITHUB_REPO, workflowFile: config.GITHUB_WORKFLOW_FILE, branch: config.GITHUB_BRANCH }, message);
      setLast(message);
    } finally { release(); }
    const actionsButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Actions").setURL(config.GITHUB_ACTIONS_URL),
    );
    await interaction.editReply({ content: `Preview OTA queued: ${message}`, components: [actionsButton] });
    const channel = await interaction.client.channels.fetch(config.DISCORD_BUILD_STATUS_CHANNEL_ID);
    if (channel?.type === ChannelType.GuildText) {
      await channel.send({ embeds: [buildAxionEmbed("🚀 Preview OTA requested", [
        { name: "Message", value: message }, { name: "Discord user", value: `${interaction.user.tag} (${interaction.user.id})` },
        { name: "Requested", value: new Date().toISOString() }, { name: "GitHub Actions", value: config.GITHUB_ACTIONS_URL },
      ])] });
    }
    return;
  }
  if (interaction.commandName === "status") {
    await interaction.reply({ content: formatSafeStatus(Boolean(config.GITHUB_OWNER && config.GITHUB_REPO), Boolean(config.GITHUB_WORKFLOW_FILE), getLast()), ephemeral: true }); return;
  }
  if (interaction.commandName === "links") {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open AxionRide GitHub repository").setURL(config.GITHUB_REPOSITORY_URL),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open GitHub Actions").setURL(config.GITHUB_ACTIONS_URL),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open EAS project dashboard").setURL(config.EAS_PROJECT_URL),
    );
    await interaction.reply({ components: [row], ephemeral: true }); return;
  }
  await interaction.reply({ content: "AxionRide Dev Bot supports `/ota-preview`, `/status`, `/links`, and `/help`. Only Android preview OTA updates are supported; production deployment is disabled.", ephemeral: true });
}
