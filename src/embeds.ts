import { EmbedBuilder } from "discord.js";

export const AXION_ORANGE = 0xff7a00;

export function buildAxionEmbed(title: string, fields: Array<{ name: string; value: string; inline?: boolean }>) {
  return new EmbedBuilder()
    .setColor(AXION_ORANGE)
    .setTitle(title)
    .addFields(fields.map((field) => ({ ...field, value: safeText(field.value) })))
    .setTimestamp();
}

export function safeText(value: string): string {
  return value.replace(/(token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 1024);
}

export function formatSafeStatus(repositoryConfigured: boolean, workflowConfigured: boolean, lastMessage?: string) {
  return [
    "Bot online: yes",
    `GitHub repository configured: ${repositoryConfigured ? "yes" : "no"}`,
    `Preview OTA workflow configured: ${workflowConfigured ? "yes" : "no"}`,
    `Last known requested update message: ${lastMessage ? safeText(lastMessage) : "none"}`,
  ].join("\n");
}

