import type { AIAgent, AIUsageRecord, DataSource } from "./AIDataStore.js";

export interface AIProviderUsageResult {
  source: DataSource;
  records: AIUsageRecord[];
  status: "available" | "manual" | "unknown";
}

export interface AIProviderAdapter {
  readonly mode: "manual" | "api";
  isConfigured(agent: AIAgent): Promise<boolean>;
  getUsage(agent: AIAgent, from?: Date, to?: Date): Promise<AIProviderUsageResult>;
}

export class ManualProviderAdapter implements AIProviderAdapter {
  readonly mode = "manual" as const;
  async isConfigured() { return true; }
  async getUsage(): Promise<AIProviderUsageResult> { return { source: "manual", records: [], status: "manual" }; }
}

export class UnconfiguredApiAdapter implements AIProviderAdapter {
  readonly mode = "api" as const;
  async isConfigured() { return false; }
  async getUsage(): Promise<AIProviderUsageResult> { return { source: "unknown", records: [], status: "unknown" }; }
}
