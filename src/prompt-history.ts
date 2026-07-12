import { ChannelType, type Client, type Message, type TextChannel } from "discord.js";
import type { CodexTask } from "./codex-runner.js";
import { buildAxionEmbed, safeText } from "./embeds.js";

export interface PromptHistoryMessage { edit(payload: unknown): Promise<unknown> }
export interface PromptHistoryChannel { send(payload: unknown): Promise<PromptHistoryMessage> }

export function redactPromptSecrets(value: string): string {
  return value
    .replace(/\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,})\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/\b[A-Z][A-Z0-9_]{1,}\s*[:=]\s*([^\s,;]+)/g, (match) => `${match.split(/[:=]/, 1)[0]}=[REDACTED]`)
    .replace(/\b((?:DISCORD|GITHUB|EXPO|SUPABASE|SMTP|API)[A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASS)?|[A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASS))\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/\b(token|secret|password|api[ _-]?key|smtp[ _-]?password)\s*(?:[:=]|\bis\b)\s*([^\s,;]+)/gi, "$1=[REDACTED]");
}

export function buildPromptHistoryEmbed(task: CodexTask, prompt: string, buildStatusChannelId?: string) {
  const final = task.state === "completed" || task.state === "failed" || task.state === "cancelled";
  const fields = [
    { name: "Task ID", value: task.id, inline: true }, { name: "State", value: titleCase(task.state), inline: true },
    { name: "Branch", value: task.branch, inline: true }, { name: "Requested by", value: task.requestedBy },
    { name: "Requested", value: task.queuedAt.toISOString() },
  ];
  if (final) {
    fields.push({ name: "Duration", value: duration(task) }, { name: "Safe completion summary", value: safeText(task.summary) });
  }
  if (buildStatusChannelId) fields.push({ name: "Build status", value: `<#${buildStatusChannelId}>` });
  return buildAxionEmbed("AxionRide Codex Prompt History", fields)
    .setDescription(redactPromptSecrets(prompt).slice(0, 4096))
    .setFooter({ text: "Private prompt history. Never share this channel beyond the owner and bot." });
}

export class PromptHistoryManager {
  private readonly prompts = new Map<string, string>();
  private readonly messages = new Map<string, Promise<PromptHistoryMessage | undefined>>();

  constructor(private readonly getChannel: () => Promise<PromptHistoryChannel | undefined>, private readonly buildStatusChannelId?: string) {}

  record(task: CodexTask, prompt: string): Promise<void> {
    this.prompts.set(task.id, prompt);
    const pending = this.getChannel()
      .then((channel) => channel?.send({ embeds: [buildPromptHistoryEmbed(task, prompt, this.buildStatusChannelId)] }))
      .catch(() => undefined);
    this.messages.set(task.id, pending);
    return pending.then(() => undefined);
  }

  async update(task: CodexTask): Promise<void> {
    const prompt = this.prompts.get(task.id);
    const pending = this.messages.get(task.id);
    if (!prompt || !pending) return;
    const message = await pending;
    if (!message) return;
    await message.edit({ embeds: [buildPromptHistoryEmbed(task, prompt, this.buildStatusChannelId)] });
  }
}

export function createDiscordPromptHistory(client: Client, channelId: string | undefined, buildStatusChannelId?: string) {
  return new PromptHistoryManager(async () => {
    if (!channelId) return undefined;
    const channel = await client.channels.fetch(channelId);
    if (channel?.type !== ChannelType.GuildText) return undefined;
    return discordChannel(channel);
  }, buildStatusChannelId);
}

function discordChannel(channel: TextChannel): PromptHistoryChannel {
  return { async send(payload) { return channel.send(payload as Parameters<TextChannel["send"]>[0]) as Promise<Message>; } };
}

function titleCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function duration(task: CodexTask) {
  if (!task.startedAt) return "not started";
  return `${Math.max(0, Math.round(((task.completedAt ?? new Date()).getTime() - task.startedAt.getTime()) / 1000))} seconds`;
}
