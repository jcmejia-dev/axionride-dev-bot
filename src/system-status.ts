import { ChannelType, Client, type Message, type TextChannel } from "discord.js";
import type { Config } from "./config.js";
import type { LocalCodexRunner } from "./codex-runner.js";
import { buildAxionEmbed, safeText } from "./embeds.js";

export type Reachability = "operational" | "unknown" | "unreachable";
export interface SystemSnapshot {
  discord: Reachability;
  runner: string;
  githubActions: string;
  supabase: Reachability;
  expo: Reachability;
  railway: Reachability | "not configured";
  refreshedAt: Date;
}

export function enforceStatusInterval(seconds: number): number {
  return Math.max(30, seconds);
}

export function indicator(status: Reachability): string {
  if (status === "operational") return "🟢 Operational";
  if (status === "unreachable") return "🔴 Unreachable";
  return "🟡 Degraded / unknown";
}

export function buildSystemStatusEmbed(snapshot: SystemSnapshot) {
  return buildAxionEmbed("AxionRide Control Room", [
    { name: "Discord Bot", value: `${indicator(snapshot.discord)} — online while this message is being refreshed` },
    { name: "Local Codex Runner", value: safeText(snapshot.runner) },
    { name: "GitHub Actions", value: safeText(snapshot.githubActions) },
    { name: "Supabase provider status", value: indicator(snapshot.supabase) },
    { name: "Expo/EAS provider status", value: indicator(snapshot.expo) },
    { name: "Railway endpoint", value: snapshot.railway === "not configured" ? "🟡 Degraded / unknown — not configured" : indicator(snapshot.railway) },
    { name: "Last refresh", value: snapshot.refreshedAt.toISOString() },
  ]).setFooter({ text: "Provider checks do not prove that AxionRide itself is functioning. This bot cannot detect its own downtime." });
}

export async function checkPublicUrl(url?: string): Promise<Reachability> {
  if (!url) return "unknown";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    return response.ok ? "operational" : "unreachable";
  } catch { return "unreachable"; }
  finally { clearTimeout(timer); }
}

export async function getLastPreviewOutcome(config: Config): Promise<string> {
  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(config.GITHUB_OWNER)}/${encodeURIComponent(config.GITHUB_REPO)}/actions/workflows/${encodeURIComponent(config.GITHUB_WORKFLOW_FILE)}/runs?per_page=1`;
    const response = await fetch(url, { headers: {
      Accept: "application/vnd.github+json", Authorization: `Bearer ${config.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "axionride-dev-bot",
    } });
    if (!response.ok) return "🟡 Degraded / unknown — token may not have Actions read access";
    const data = await response.json() as { workflow_runs?: Array<{ status?: string; conclusion?: string | null }> };
    const run = data.workflow_runs?.[0];
    if (!run) return "🟡 Degraded / unknown — no preview OTA runs found";
    if (run.status !== "completed") return "🟡 Degraded / unknown — preview OTA run in progress";
    return run.conclusion === "success" ? "🟢 Operational — last preview OTA workflow succeeded" : "🔴 Unreachable — last preview OTA workflow failed";
  } catch { return "🟡 Degraded / unknown — status lookup unavailable"; }
}

export async function collectSystemSnapshot(config: Config, runner: LocalCodexRunner): Promise<SystemSnapshot> {
  const [githubActions, supabase, expo, railway] = await Promise.all([
    getLastPreviewOutcome(config), checkPublicUrl(config.SUPABASE_HEALTH_URL), checkPublicUrl(config.EXPO_STATUS_URL),
    config.RAILWAY_HEALTH_URL ? checkPublicUrl(config.RAILWAY_HEALTH_URL) : Promise.resolve("not configured" as const),
  ]);
  const runnerState = !runner.enabled ? "🟡 Degraded / unknown — disabled"
    : !runner.isAvailable ? "🔴 Unreachable — enabled but unavailable"
      : runner.isWorking ? "🟡 Degraded / unknown — enabled, working" : "🟢 Operational — enabled, idle";
  return { discord: "operational", runner: runnerState, githubActions, supabase, expo, railway, refreshedAt: new Date() };
}

export interface StatusMessageStore {
  findExisting(): Promise<{ edit(payload: unknown): Promise<unknown> } | undefined>;
  send(payload: unknown): Promise<{ edit(payload: unknown): Promise<unknown> }>;
}

export async function upsertStatusMessage(store: StatusMessageStore, payload: unknown, existing?: { edit(payload: unknown): Promise<unknown> }) {
  const message = existing ?? await store.findExisting();
  if (message) { await message.edit(payload); return message; }
  return store.send(payload);
}

export class SystemStatusManager {
  private message?: Message;
  private timer?: NodeJS.Timeout;
  constructor(private readonly client: Client, private readonly config: Config, private readonly runner: LocalCodexRunner) {}

  async refresh(): Promise<SystemSnapshot> {
    const snapshot = await collectSystemSnapshot(this.config, this.runner);
    if (!this.config.DISCORD_SYSTEM_STATUS_CHANNEL_ID) return snapshot;
    const channel = await this.client.channels.fetch(this.config.DISCORD_SYSTEM_STATUS_CHANNEL_ID);
    if (channel?.type !== ChannelType.GuildText) return snapshot;
    const store = discordStore(channel, this.client.user?.id);
    this.message = await upsertStatusMessage(store, { embeds: [buildSystemStatusEmbed(snapshot)] }, this.message) as Message;
    return snapshot;
  }

  start() {
    void this.refresh().catch(() => console.error("System status refresh failed"));
    this.timer = setInterval(() => void this.refresh().catch(() => console.error("System status refresh failed")), enforceStatusInterval(this.config.SYSTEM_STATUS_INTERVAL_SECONDS) * 1000);
  }

  stop() { if (this.timer) clearInterval(this.timer); }
}

function discordStore(channel: TextChannel, botId?: string): StatusMessageStore {
  return {
    async findExisting() {
      const messages = await channel.messages.fetch({ limit: 50 });
      return messages.find((message) => message.author.id === botId && message.embeds[0]?.title === "AxionRide Control Room");
    },
    async send(payload) { return channel.send(payload as Parameters<TextChannel["send"]>[0]); },
  };
}
