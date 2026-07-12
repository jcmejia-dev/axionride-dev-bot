import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ChatInputCommandInteraction,
  Client, Events, GatewayIntentBits,
} from "discord.js";
import type { Config } from "./config.js";
import { LocalCodexRunner, taskDuration, type CodexTask } from "./codex-runner.js";
import { buildAxionEmbed, formatSafeStatus } from "./embeds.js";
import { dispatchPreviewOta } from "./github.js";
import { createDiscordPromptHistory, type PromptHistoryManager } from "./prompt-history.js";
import { isAuthorized, OtaRequestGuard, validateCodexPrompt, validateOtaMessage, validateReleaseNotes } from "./security.js";
import { buildSystemStatusEmbed, SystemStatusManager } from "./system-status.js";
import { AIOperationsController } from "./ai-operations.js";

const unauthorized = "You are not allowed to use AxionRide deployment commands.";

export function createBot(config: Config): Client {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const guard = new OtaRequestGuard();
  const runner = new LocalCodexRunner({
    enabled: config.LOCAL_CODEX_RUNNER_ENABLED, executable: config.CODEX_EXECUTABLE, repoPath: config.AXIONRIDE_REPO_PATH,
    timeoutMinutes: config.CODEX_TASK_TIMEOUT_MINUTES, cooldownSeconds: config.CODEX_TASK_COOLDOWN_SECONDS,
  });
  const systemStatus = new SystemStatusManager(client, config, runner);
  const promptHistory = createDiscordPromptHistory(client, config.DISCORD_PROMPTS_CHANNEL_ID, config.DISCORD_BUILD_STATUS_CHANNEL_ID);
  const aiOperations = new AIOperationsController(client, config);
  let lastMessage: string | undefined;

  for (const event of ["queued", "running", "completed", "failed", "cancelled"] as const) {
    runner.on(event, (task: CodexTask) => {
      void postTaskUpdate(client, config, task).catch(() => console.error("Codex status announcement failed"));
      if (event !== "queued") void promptHistory.update(task).catch(() => console.error("Prompt history update failed"));
    });
  }
  client.once(Events.ClientReady, async (ready) => {
    await aiOperations.init();
    await runner.checkStartup();
    console.log(`AxionRide Dev Bot online as ${ready.user.tag}; local runner ${runner.enabled ? (runner.isAvailable ? "available" : "unavailable") : "disabled"}`);
    systemStatus.start();
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      const roles = interaction.member && "roles" in interaction.member
        ? (Array.isArray(interaction.member.roles) ? interaction.member.roles : [...interaction.member.roles.cache.keys()]) : [];
      if (!isAuthorized(interaction.user.id, roles, config.ALLOWED_DISCORD_USER_IDS, config.ALLOWED_DISCORD_ROLE_IDS)) {
        await interaction.reply({ content: unauthorized, ephemeral: true });
        return;
      }
      if (await aiOperations.handle(interaction)) return;
      await handleCommand(interaction, config, guard, runner, systemStatus, promptHistory, () => lastMessage, (value) => { lastMessage = value; });
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
  interaction: ChatInputCommandInteraction, config: Config, guard: OtaRequestGuard, runner: LocalCodexRunner, systemStatus: SystemStatusManager,
  promptHistory: PromptHistoryManager,
  getLast: () => string | undefined, setLast: (message: string) => void,
) {
  if (interaction.commandName === "ota-preview") {
    let message: string;
    let releaseNotes: string | undefined;
    try { message = validateOtaMessage(interaction.options.getString("message", true)); }
    catch (error) { await interaction.reply({ content: error instanceof Error ? error.message : "Invalid message.", ephemeral: true }); return; }
    try {
      const supplied = interaction.options.getString("release_notes");
      releaseNotes = supplied ? validateReleaseNotes(supplied) : undefined;
    } catch (error) { await interaction.reply({ content: error instanceof Error ? error.message : "Invalid release notes.", ephemeral: true }); return; }
    let release: () => void;
    try { release = guard.acquire(interaction.user.id); }
    catch (error) { await interaction.reply({ content: error instanceof Error ? error.message : "Request blocked.", ephemeral: true }); return; }
    await interaction.deferReply({ ephemeral: true });
    try {
      await dispatchPreviewOta({ token: config.GITHUB_TOKEN, owner: config.GITHUB_OWNER, repo: config.GITHUB_REPO, workflowFile: config.GITHUB_WORKFLOW_FILE, branch: config.GITHUB_BRANCH }, message, releaseNotes);
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
        { name: "Release notes", value: releaseNotes ?? message },
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
  if (interaction.commandName === "codex-task") {
    if (!runner.enabled) { await interaction.reply({ content: "The local Codex runner is disabled. Enable it explicitly on the local PC to queue tasks.", ephemeral: true }); return; }
    let prompt: string;
    try { prompt = validateCodexPrompt(interaction.options.getString("prompt", true)); }
    catch (error) { await interaction.reply({ content: error instanceof Error ? error.message : "Invalid task prompt.", ephemeral: true }); return; }
    await interaction.deferReply({ ephemeral: true });
    const task = await runner.enqueue({ prompt, branch: interaction.options.getString("branch") ?? undefined, requestedBy: `${interaction.user.tag} (${interaction.user.id})`, requestedById: interaction.user.id });
    void promptHistory.record(task, prompt).catch(() => console.error("Prompt history post failed"));
    await interaction.editReply(`Task ${task.id}: Queued for local Codex.`);
    return;
  }
  if (interaction.commandName === "codex-status") {
    await interaction.reply({ content: formatTaskStatus(runner.currentTask), ephemeral: true }); return;
  }
  if (interaction.commandName === "codex-cancel") {
    if (!config.ALLOWED_DISCORD_USER_IDS.has(interaction.user.id)) {
      await interaction.reply({ content: "Only an explicitly allowed owner user can cancel a local Codex task.", ephemeral: true }); return;
    }
    const cancelled = runner.cancel();
    await interaction.reply({ content: cancelled ? "The currently running local Codex task was cancelled." : "No running local Codex task could be cancelled.", ephemeral: true }); return;
  }
  if (interaction.commandName === "system-status") {
    await interaction.deferReply({ ephemeral: true });
    const snapshot = await systemStatus.refresh();
    await interaction.editReply({ embeds: [buildSystemStatusEmbed(snapshot)] }); return;
  }
  await interaction.reply({ content: "AxionRide Dev Bot supports preview OTA, local Codex, system status, and developer-only `/ai-*` monitoring commands. AI monitoring records data only; it cannot purchase, renew, cancel, or charge anything. Production deployment remains disabled.", ephemeral: true });
}

function formatTaskStatus(task?: CodexTask): string {
  if (!task) return "No local Codex task has been queued since this bot started.";
  return [
    `State: ${task.state}`, `Task ID: ${task.id}`, `Requested by: ${task.requestedBy}`,
    `Queued: ${task.queuedAt.toISOString()}`, `Started: ${task.startedAt?.toISOString() ?? "not started"}`,
    `Completed: ${task.completedAt?.toISOString() ?? "not completed"}`, `Current branch: ${task.branch}`,
    `Safe summary: ${task.summary}`,
  ].join("\n");
}

async function postTaskUpdate(client: Client, config: Config, task: CodexTask) {
  const channel = await client.channels.fetch(config.DISCORD_BUILD_STATUS_CHANNEL_ID);
  if (channel?.type !== ChannelType.GuildText) return;
  const title = task.state === "queued" ? "🤖 Codex task queued"
    : task.state === "running" ? "🛠️ Codex working"
      : task.state === "completed" ? "✅ Codex task completed — review and commit required"
        : task.state === "cancelled" ? "🟡 Codex task cancelled" : "❌ Codex task failed";
  await channel.send({ embeds: [buildAxionEmbed(title, [
    { name: "Task ID", value: task.id, inline: true }, { name: "Branch", value: task.branch, inline: true },
    { name: "State", value: task.state, inline: true }, { name: "Duration", value: taskDuration(task), inline: true },
    { name: "Requested by", value: task.requestedBy }, { name: "Safe summary", value: task.summary },
  ]).setFooter({ text: "Local changes only. Review required; nothing was committed, pushed, built, published, or deployed." })] });
}
