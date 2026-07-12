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
  new SlashCommandBuilder().setName("ai-status").setDescription("Show private AI operations status"),
  new SlashCommandBuilder().setName("ai-agent-add").setDescription("Register an AI agent or tool")
    .addStringOption((o) => o.setName("provider").setDescription("User-defined provider name").setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName("name").setDescription("Agent or tool name").setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName("agent_type").setDescription("Agent type").setRequired(true).setMaxLength(60))
    .addStringOption((o) => o.setName("data_mode").setDescription("Usage data mode").setRequired(true).addChoices({ name: "Manual", value: "manual" }, { name: "API (future adapter)", value: "api" }))
    .addStringOption((o) => o.setName("notes").setDescription("Safe notes only").setMaxLength(500))
    .addNumberOption((o) => o.setName("daily_limit").setDescription("Optional estimated daily spend alert threshold").setMinValue(0))
    .addNumberOption((o) => o.setName("monthly_limit").setDescription("Optional estimated monthly spend alert threshold").setMinValue(0))
    .addNumberOption((o) => o.setName("provider_monthly_limit").setDescription("Optional provider monthly threshold").setMinValue(0)),
  new SlashCommandBuilder().setName("ai-agent-list").setDescription("List monitored AI agents and tools"),
  new SlashCommandBuilder().setName("ai-agent-edit").setDescription("Edit a monitored AI agent or tool")
    .addStringOption((o) => o.setName("id").setDescription("Agent ID").setRequired(true))
    .addStringOption((o) => o.setName("provider").setDescription("Provider name").setMaxLength(80))
    .addStringOption((o) => o.setName("name").setDescription("Agent or tool name").setMaxLength(100))
    .addStringOption((o) => o.setName("agent_type").setDescription("Agent type").setMaxLength(60))
    .addStringOption((o) => o.setName("current_task").setDescription("Safe current task summary").setMaxLength(200))
    .addStringOption((o) => o.setName("notes").setDescription("Safe notes only").setMaxLength(500))
    .addNumberOption((o) => o.setName("daily_limit").setDescription("Daily estimated spend threshold").setMinValue(0))
    .addNumberOption((o) => o.setName("monthly_limit").setDescription("Monthly estimated spend threshold").setMinValue(0))
    .addNumberOption((o) => o.setName("provider_monthly_limit").setDescription("Provider monthly threshold").setMinValue(0)),
  ...["disable", "enable"].map((action) => new SlashCommandBuilder().setName(`ai-agent-${action}`).setDescription(`${action} monitoring for an AI agent/tool`).addStringOption((o) => o.setName("id").setDescription("Agent ID").setRequired(true))),
  new SlashCommandBuilder().setName("ai-agent-remove").setDescription("Delete an AI agent monitoring record")
    .addStringOption((o) => o.setName("id").setDescription("Agent ID").setRequired(true)).addBooleanOption((o) => o.setName("confirm").setDescription("Confirm permanent monitoring-record deletion").setRequired(true)),
  new SlashCommandBuilder().setName("ai-usage").setDescription("View recorded AI usage")
    .addStringOption((o) => o.setName("agent_id").setDescription("Optional agent ID")).addStringOption((o) => o.setName("provider").setDescription("Optional provider name").setMaxLength(80))
    .addStringOption((o) => o.setName("from").setDescription("Start date YYYY-MM-DD")).addStringOption((o) => o.setName("to").setDescription("End date YYYY-MM-DD")),
  new SlashCommandBuilder().setName("ai-usage-log").setDescription("Record known manual AI usage")
    .addStringOption((o) => o.setName("agent_id").setDescription("Agent ID").setRequired(true)).addIntegerOption((o) => o.setName("requests").setDescription("Known request count").setRequired(true).setMinValue(0))
    .addIntegerOption((o) => o.setName("input_tokens").setDescription("Known input tokens").setMinValue(0)).addIntegerOption((o) => o.setName("output_tokens").setDescription("Known output tokens").setMinValue(0))
    .addNumberOption((o) => o.setName("estimated_cost").setDescription("Known manual estimated cost").setMinValue(0)).addStringOption((o) => o.setName("currency").setDescription("Currency code").setMaxLength(10))
    .addStringOption((o) => o.setName("task").setDescription("Safe task summary").setMaxLength(200)),
  new SlashCommandBuilder().setName("ai-subscription-add").setDescription("Add a manual AI subscription or trial record")
    .addStringOption((o) => o.setName("provider").setDescription("Provider name").setRequired(true).setMaxLength(80)).addStringOption((o) => o.setName("tool").setDescription("Tool or agent name").setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName("plan").setDescription("Plan name").setRequired(true).setMaxLength(80)).addStringOption((o) => o.setName("trial_end").setDescription("Trial end YYYY-MM-DD"))
    .addStringOption((o) => o.setName("trial_start").setDescription("Trial start YYYY-MM-DD"))
    .addStringOption((o) => o.setName("renewal_date").setDescription("Renewal YYYY-MM-DD")).addBooleanOption((o) => o.setName("auto_renew").setDescription("Recorded auto-renew state only"))
    .addNumberOption((o) => o.setName("expected_charge").setDescription("Expected charge estimate").setMinValue(0)).addStringOption((o) => o.setName("currency").setDescription("Currency code").setMaxLength(10))
    .addStringOption((o) => o.setName("payment_note").setDescription("Harmless note, e.g. wallet ending 1234").setMaxLength(80)).addStringOption((o) => o.setName("reminder_days").setDescription("Comma-separated days, default 7,1"))
    .addBooleanOption((o) => o.setName("monitoring_enabled").setDescription("Enable private reminders"))
    .addStringOption((o) => o.setName("notes").setDescription("Safe notes").setMaxLength(500)),
  new SlashCommandBuilder().setName("ai-subscription-list").setDescription("List monitored AI subscriptions and trials"),
  new SlashCommandBuilder().setName("ai-subscription-edit").setDescription("Edit an AI subscription monitoring record")
    .addStringOption((o) => o.setName("id").setDescription("Subscription ID").setRequired(true)).addStringOption((o) => o.setName("trial_end").setDescription("Trial end YYYY-MM-DD"))
    .addStringOption((o) => o.setName("trial_start").setDescription("Trial start YYYY-MM-DD"))
    .addStringOption((o) => o.setName("renewal_date").setDescription("Renewal YYYY-MM-DD")).addBooleanOption((o) => o.setName("auto_renew").setDescription("Recorded state only"))
    .addNumberOption((o) => o.setName("expected_charge").setDescription("Expected charge estimate").setMinValue(0)).addStringOption((o) => o.setName("payment_note").setDescription("Harmless payment note").setMaxLength(80))
    .addStringOption((o) => o.setName("reminder_days").setDescription("Comma-separated days")).addStringOption((o) => o.setName("state").setDescription("Monitoring state").addChoices({ name: "Active", value: "active" }, { name: "Cancelled", value: "cancelled" }, { name: "Expired", value: "expired" }))
    .addBooleanOption((o) => o.setName("monitoring_enabled").setDescription("Enable private reminders"))
    .addStringOption((o) => o.setName("notes").setDescription("Safe notes").setMaxLength(500)),
  new SlashCommandBuilder().setName("ai-subscription-remove").setDescription("Delete a subscription monitoring record")
    .addStringOption((o) => o.setName("id").setDescription("Subscription ID").setRequired(true)).addBooleanOption((o) => o.setName("confirm").setDescription("Confirm record deletion; does not cancel service").setRequired(true)),
  new SlashCommandBuilder().setName("ai-cost-status").setDescription("Show known AI spend estimates and active alerts"),
].map((command) => command.toJSON());
