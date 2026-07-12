import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIDataStore, sanitizeMonitoringText, validatePaymentNote } from "../src/services/AIDataStore.js";
import { AIAgentRegistryService } from "../src/services/AIAgentRegistryService.js";
import { AIUsageService } from "../src/services/AIUsageService.js";
import { AISubscriptionService } from "../src/services/AISubscriptionService.js";
import { AICostMonitorService } from "../src/services/AICostMonitorService.js";
import { ManualProviderAdapter, UnconfiguredApiAdapter } from "../src/services/AIProviderAdapter.js";
import { isAuthorized } from "../src/security.js";

describe("generic AI operations monitoring", () => {
  let directory: string; let store: AIDataStore; let registry: AIAgentRegistryService; let usage: AIUsageService;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "axion-ai-ops-")); store = new AIDataStore(join(directory, "ai-operations.json")); await store.init(); registry = new AIAgentRegistryService(store); usage = new AIUsageService(store); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("registers arbitrary providers and agents without provider dependencies", async () => {
    const agent = await registry.add({ provider: "User Defined Labs", name: "Personal Automation Agent", agentType: "Automation", dataMode: "manual" });
    expect(registry.get(agent.id)).toMatchObject({ provider: "User Defined Labs", name: "Personal Automation Agent" });
    const serviceSource = await readFile(new URL("../src/services/AIAgentRegistryService.ts", import.meta.url), "utf8");
    expect(serviceSource).not.toMatch(/OpenAI|Claude|Copilot|Gemini|Cursor|Anthropic/);
  });

  it("persists and reloads validated data", async () => {
    const agent = await registry.add({ provider: "Generic", name: "Agent A", agentType: "Assistant", dataMode: "manual" });
    const reloaded = new AIDataStore(store.path); await reloaded.init();
    expect(reloaded.snapshot().agents[0].id).toBe(agent.id);
  });

  it("tracks only supplied manual usage and generates no fake data", async () => {
    const agent = await registry.add({ provider: "Generic", name: "Agent A", agentType: "Assistant", dataMode: "manual" });
    expect(usage.query()).toEqual([]);
    await usage.log({ agentId: agent.id, requests: 3, inputTokens: 20, estimatedCost: 1.25, currency: "USD" });
    expect(usage.totals()).toEqual({ requests: 3, inputTokens: 20, outputTokens: 0, cost: 1.25 });
    expect(usage.query()[0]).toMatchObject({ source: "manual", exactBilling: false });
  });

  it("labels manual and unconfigured API adapters honestly", async () => {
    const agent = await registry.add({ provider: "Generic", name: "Agent A", agentType: "Assistant", dataMode: "api" });
    expect((await new ManualProviderAdapter().getUsage(agent)).status).toBe("manual");
    expect((await new UnconfiguredApiAdapter().getUsage(agent)).status).toBe("unknown");
    expect(await new UnconfiguredApiAdapter().isConfigured(agent)).toBe(false);
  });

  it("creates trial, renewal, and expiration warnings once", async () => {
    const subscriptions = new AISubscriptionService(store); const now = new Date("2026-01-01T00:00:00Z");
    await subscriptions.add({ provider: "Generic", toolName: "Tool", planName: "Trial", trialEnd: "2026-01-02", renewalDate: "2026-01-08", reminderDays: [7, 1] });
    const first = await subscriptions.dueAlerts(now); const duplicate = await subscriptions.dueAlerts(now);
    expect(first.map((alert) => alert.type).sort()).toEqual(["renewal", "trial"]);
    expect(duplicate).toEqual([]);
    await subscriptions.add({ provider: "Other", toolName: "Expired Tool", planName: "Trial", trialEnd: "2025-12-31" });
    expect((await subscriptions.dueAlerts(now)).some((alert) => alert.type === "expired")).toBe(true);
  });

  it("creates cost threshold, spike, and burst alerts once and resolves stale breaches", async () => {
    const agent = await registry.add({ provider: "Generic", name: "Busy Agent", agentType: "Automation", dataMode: "manual", dailySpendLimit: 5 });
    await usage.log({ agentId: agent.id, requests: 168, occurredAt: "2025-12-28T00:00:00Z" });
    await usage.log({ agentId: agent.id, requests: 100, estimatedCost: 6, occurredAt: "2026-01-01T12:00:00Z" });
    const costs = new AICostMonitorService(store); const now = new Date("2026-01-01T12:30:00Z");
    const alerts = await costs.evaluate(now);
    expect(alerts.some((alert) => alert.type === "cost")).toBe(true);
    expect(alerts.some((alert) => alert.type === "spike")).toBe(true);
    expect(alerts.some((alert) => alert.type === "burst")).toBe(true);
    expect(await costs.evaluate(now)).toEqual([]);
    expect(costs.status().reliability).toBe("Manual");
  });

  it("reuses authorization and rejects invalid or sensitive payment/input data", async () => {
    expect(isAuthorized("attacker", [], new Set(["owner"]), new Set())).toBe(false);
    expect(() => validatePaymentNote("Card 4111 1111 1111 1111 CVV 123")).toThrow();
    expect(validatePaymentNote("GCash Visa ending 1234")).toBe("GCash Visa ending 1234");
    expect(sanitizeMonitoringText("token=supersecret note")).not.toContain("supersecret");
    await expect(registry.add({ provider: "", name: "Agent", agentType: "Tool", dataMode: "manual" })).rejects.toThrow();
  });
});
