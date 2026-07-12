import { ChannelType, type ChatInputCommandInteraction, type Client } from "discord.js";
import { resolve } from "node:path";
import type { Config } from "./config.js";
import { buildAxionEmbed, safeText } from "./embeds.js";
import { AIDataStore, type AIOperationsAlert } from "./services/AIDataStore.js";
import { AIAgentRegistryService } from "./services/AIAgentRegistryService.js";
import { AIUsageService } from "./services/AIUsageService.js";
import { AISubscriptionService } from "./services/AISubscriptionService.js";
import { AICostMonitorService } from "./services/AICostMonitorService.js";

export const AI_COMMANDS = new Set(["ai-status", "ai-agent-add", "ai-agent-list", "ai-agent-edit", "ai-agent-disable", "ai-agent-enable", "ai-agent-remove", "ai-usage", "ai-usage-log", "ai-subscription-add", "ai-subscription-list", "ai-subscription-edit", "ai-subscription-remove", "ai-cost-status"]);

export class AIOperationsController {
  readonly store: AIDataStore;
  readonly registry: AIAgentRegistryService;
  readonly usage: AIUsageService;
  readonly subscriptions: AISubscriptionService;
  readonly costs: AICostMonitorService;
  private timer?: NodeJS.Timeout;
  constructor(private readonly client: Client, private readonly config: Config, path = resolve(process.cwd(), "runtime-data", "ai-operations.json")) {
    this.store = new AIDataStore(path); this.registry = new AIAgentRegistryService(this.store); this.usage = new AIUsageService(this.store);
    this.subscriptions = new AISubscriptionService(this.store); this.costs = new AICostMonitorService(this.store);
  }
  async init() { await this.store.init(); await this.checkAlerts(); this.timer = setInterval(() => void this.checkAlerts(), 6 * 60 * 60 * 1000); }
  stop() { if (this.timer) clearInterval(this.timer); }
  async checkAlerts(now = new Date()) {
    await this.subscriptions.dueAlerts(now); await this.costs.evaluate(now);
    const pending = this.store.snapshot().alerts.filter((alert) => !alert.deliveredAt && (alert.active || alert.type === "resolved"));
    for (const alert of pending) await this.deliver(alert);
  }
  private async deliver(alert: AIOperationsAlert) {
    if (!this.config.DISCORD_AI_OPERATIONS_CHANNEL_ID || alert.deliveredAt) return;
    try {
      const channel = await this.client.channels.fetch(this.config.DISCORD_AI_OPERATIONS_CHANNEL_ID);
      if (channel?.type !== ChannelType.GuildText) return;
      await channel.send({ embeds: [buildAxionEmbed(alert.type === "cost" ? "💰 AxionRide AI Cost Alert" : "🤖 AxionRide AI Operations Alert", [
        { name: "Badge", value: badge(alert.type), inline: true }, { name: "Event", value: safeText(alert.message) }, { name: "Recorded", value: alert.createdAt },
      ]).setFooter({ text: "Developer-only monitoring. No purchase, renewal, cancellation, or charge was performed." })] });
      await this.store.update((data) => { const saved = data.alerts.find((item) => item.key === alert.key); if (saved) saved.deliveredAt = new Date().toISOString(); });
    } catch { console.error("AI operations alert delivery failed"); }
  }

  async handle(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!AI_COMMANDS.has(interaction.commandName)) return false;
    await interaction.deferReply({ ephemeral: true });
    const o = interaction.options;
    if (interaction.commandName === "ai-agent-add") {
      const item = await this.registry.add({ provider: o.getString("provider", true), name: o.getString("name", true), agentType: o.getString("agent_type", true), dataMode: o.getString("data_mode", true) as "manual" | "api", notes: o.getString("notes") ?? undefined, dailySpendLimit: o.getNumber("daily_limit") ?? undefined, monthlySpendLimit: o.getNumber("monthly_limit") ?? undefined, providerMonthlySpendLimit: o.getNumber("provider_monthly_limit") ?? undefined });
      await interaction.editReply({ embeds: [agentEmbed("AI agent/tool registered", item, this.usage)] }); return true;
    }
    if (interaction.commandName === "ai-agent-list" || interaction.commandName === "ai-status") {
      const agents = this.registry.list(); const ranked = agents.map((agent) => ({ agent, totals: this.usage.totals(this.usage.query({ agentId: agent.id })) })).sort((a, b) => b.totals.requests - a.totals.requests);
      const text = ranked.length ? ranked.slice(0, 15).map(({ agent, totals }) => `**${safeText(agent.provider)} / ${safeText(agent.name)}** [${sourceLabel(agent.dataMode)}] — ${agent.monitoringEnabled ? "Enabled" : "Disabled"}; ${totals.requests} requests; last ${agent.lastActivityAt ?? "Unknown"}; task ${safeText(agent.currentTask ?? "Unknown")}`).join("\n") : "No monitored AI agents/tools are registered.";
      await interaction.editReply({ embeds: [buildAxionEmbed("AxionRide AI Operations", [{ name: "Monitored agents", value: text }])] }); return true;
    }
    if (interaction.commandName === "ai-agent-edit") {
      const item = await this.registry.edit(o.getString("id", true), { provider: o.getString("provider") ?? undefined, name: o.getString("name") ?? undefined, agentType: o.getString("agent_type") ?? undefined, notes: o.getString("notes") ?? undefined, currentTask: o.getString("current_task") ?? undefined, dailySpendLimit: o.getNumber("daily_limit") ?? undefined, monthlySpendLimit: o.getNumber("monthly_limit") ?? undefined, providerMonthlySpendLimit: o.getNumber("provider_monthly_limit") ?? undefined });
      await interaction.editReply({ embeds: [agentEmbed("AI agent/tool updated", item, this.usage)] }); return true;
    }
    if (interaction.commandName === "ai-agent-disable" || interaction.commandName === "ai-agent-enable") {
      const enabled = interaction.commandName.endsWith("enable"); const item = await this.registry.setEnabled(o.getString("id", true), enabled);
      await interaction.editReply(`Monitoring ${enabled ? "enabled" : "disabled"} for ${item.provider} / ${item.name}.`); return true;
    }
    if (interaction.commandName === "ai-agent-remove") {
      await this.registry.remove(o.getString("id", true), o.getBoolean("confirm", true)); await interaction.editReply("AI agent/tool and its usage records were deleted."); return true;
    }
    if (interaction.commandName === "ai-usage-log") {
      const record = await this.usage.log({ agentId: o.getString("agent_id", true), requests: o.getInteger("requests", true), inputTokens: o.getInteger("input_tokens") ?? undefined, outputTokens: o.getInteger("output_tokens") ?? undefined, estimatedCost: o.getNumber("estimated_cost") ?? undefined, currency: o.getString("currency") ?? "USD", source: "manual", exactBilling: false, taskSummary: o.getString("task") ?? undefined });
      await this.checkAlerts(); await interaction.editReply(`Manual usage recorded (${record.requests} requests). Estimated costs remain estimates.`); return true;
    }
    if (interaction.commandName === "ai-usage") {
      const records = this.usage.query({ agentId: o.getString("agent_id") ?? undefined, provider: o.getString("provider") ?? undefined, from: parseDate(o.getString("from")), to: parseDate(o.getString("to"), true) }); const totals = this.usage.totals(records);
      const sources = records.length ? [...new Set(records.map((record) => record.source === "api" ? "API-backed" : record.source === "manual" ? "Manual" : "Unknown"))].join(", ") : "Unknown";
      const costs = records.reduce<Record<string, number>>((result, record) => { if (record.estimatedCost !== undefined) result[record.currency] = (result[record.currency] ?? 0) + record.estimatedCost; return result; }, {});
      const costText = Object.entries(costs).map(([currency, value]) => `${currency} ${value.toFixed(2)}`).join(", ") || "Unknown";
      await interaction.editReply({ embeds: [buildAxionEmbed("AxionRide AI Usage", [{ name: "Source reliability", value: sources }, { name: "Requests", value: String(totals.requests), inline: true }, { name: "Known tokens", value: String(totals.inputTokens + totals.outputTokens), inline: true }, { name: "Known estimated cost", value: costText, inline: true }])] }); return true;
    }
    if (interaction.commandName === "ai-subscription-add") {
      const item = await this.subscriptions.add({ provider: o.getString("provider", true), toolName: o.getString("tool", true), planName: o.getString("plan", true), trialStart: o.getString("trial_start") ?? undefined, trialEnd: o.getString("trial_end") ?? undefined, renewalDate: o.getString("renewal_date") ?? undefined, autoRenew: o.getBoolean("auto_renew") ?? false, expectedCharge: o.getNumber("expected_charge") ?? undefined, currency: o.getString("currency") ?? "USD", paymentMethodNote: o.getString("payment_note") ?? undefined, monitoringEnabled: o.getBoolean("monitoring_enabled") ?? true, reminderDays: parseReminders(o.getString("reminder_days")), notes: o.getString("notes") ?? undefined });
      await this.checkAlerts(); await interaction.editReply(`Subscription ${item.id} registered for monitoring. No purchase or renewal was performed.`); return true;
    }
    if (interaction.commandName === "ai-subscription-list") {
      const list = this.subscriptions.list(); const text = list.length ? list.map((item) => `**${safeText(item.provider)} / ${safeText(item.toolName)}** (${item.id}) — ${item.planName}; ${item.state}; renewal ${item.renewalDate ?? "Unknown"}; expected ${item.expectedCharge === undefined ? "Unknown" : `Estimated ${item.currency} ${item.expectedCharge.toFixed(2)}`}`).join("\n") : "No subscriptions are monitored.";
      await interaction.editReply({ embeds: [buildAxionEmbed("AxionRide AI Subscriptions", [{ name: "Manual subscription records", value: text }])] }); return true;
    }
    if (interaction.commandName === "ai-subscription-edit") {
      const item = await this.subscriptions.edit(o.getString("id", true), { renewalDate: o.getString("renewal_date") ?? undefined, trialStart: o.getString("trial_start") ?? undefined, trialEnd: o.getString("trial_end") ?? undefined, autoRenew: o.getBoolean("auto_renew") ?? undefined, expectedCharge: o.getNumber("expected_charge") ?? undefined, paymentMethodNote: o.getString("payment_note") ?? undefined, monitoringEnabled: o.getBoolean("monitoring_enabled") ?? undefined, notes: o.getString("notes") ?? undefined, state: (o.getString("state") as "active" | "cancelled" | "expired" | null) ?? undefined, reminderDays: o.getString("reminder_days") ? parseReminders(o.getString("reminder_days")) : undefined });
      await interaction.editReply(`Subscription ${item.id} updated. No provider-side change was performed.`); return true;
    }
    if (interaction.commandName === "ai-subscription-remove") { await this.subscriptions.remove(o.getString("id", true), o.getBoolean("confirm", true)); await interaction.editReply("Subscription monitoring record deleted; no provider subscription was cancelled."); return true; }
    const status = this.costs.status();
    const spend = Object.entries(status.knownEstimatedSpend).map(([currency, value]) => `${currency} ${value.toFixed(2)}`).join(", ") || "Unknown";
    await interaction.editReply({ embeds: [buildAxionEmbed("AxionRide AI Cost Protection", [{ name: "Known spend", value: `${spend} (Estimated unless API billing is exact)` }, { name: "Data source reliability", value: status.reliability }, { name: "Active alerts", value: status.activeAlerts.length ? status.activeAlerts.map((alert) => safeText(alert.message)).join("\n") : "None" }])] }); return true;
  }
}

function sourceLabel(mode: "manual" | "api") { return mode === "manual" ? "Manual" : "Unknown — API adapter not configured"; }
function badge(type: AIOperationsAlert["type"]) { return type === "trial" ? "Trial ending" : type === "renewal" ? "Renewal due" : type === "cost" ? "Cost alert (Estimated)" : type === "expired" ? "Expired" : "Usage alert"; }
function parseDate(value: string | null, end = false) { if (!value) return undefined; if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Dates must use YYYY-MM-DD."); return new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`); }
function parseReminders(value: string | null) { if (!value) return [7, 1]; const days = value.split(",").map((part) => Number(part.trim())); if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 365)) throw new Error("Reminder days must be comma-separated whole days from 0 to 365."); return [...new Set(days)]; }
function agentEmbed(title: string, agent: ReturnType<AIAgentRegistryService["get"]> extends infer T ? Exclude<T, undefined> : never, usage: AIUsageService) { const totals = usage.totals(usage.query({ agentId: agent.id })); return buildAxionEmbed(title, [{ name: "ID", value: agent.id, inline: true }, { name: "Provider", value: agent.provider, inline: true }, { name: "Agent/tool", value: agent.name }, { name: "Data badge", value: sourceLabel(agent.dataMode), inline: true }, { name: "Monitoring", value: agent.monitoringEnabled ? "Enabled" : "Disabled", inline: true }, { name: "Recorded requests", value: String(totals.requests) }]); }
