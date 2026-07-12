import { randomUUID } from "node:crypto";
import type { AIDataStore, AIUsageRecord, DataSource } from "./AIDataStore.js";
import { sanitizeMonitoringText } from "./AIDataStore.js";

export interface UsageInput { agentId: string; requests: number; inputTokens?: number; outputTokens?: number; estimatedCost?: number; currency?: string; source?: DataSource; exactBilling?: boolean; taskSummary?: string; occurredAt?: string }

export class AIUsageService {
  constructor(private readonly store: AIDataStore) {}
  async log(input: UsageInput) {
    const data = this.store.snapshot();
    if (!data.agents.some((agent) => agent.id === input.agentId)) throw new Error("AI agent/tool was not found.");
    const record: AIUsageRecord = {
      id: randomUUID().slice(0, 8), agentId: input.agentId, occurredAt: validDate(input.occurredAt ?? new Date().toISOString()),
      requests: integer(input.requests, "Request count"), inputTokens: optionalInteger(input.inputTokens, "Input token count"), outputTokens: optionalInteger(input.outputTokens, "Output token count"),
      estimatedCost: optionalAmount(input.estimatedCost), currency: sanitizeMonitoringText(input.currency ?? "USD", 10).toUpperCase(),
      source: input.source ?? "manual", exactBilling: input.exactBilling ?? false, taskSummary: input.taskSummary ? sanitizeMonitoringText(input.taskSummary, 200) : undefined,
    };
    await this.store.update((state) => {
      state.usage.push(record);
      const agent = state.agents.find((item) => item.id === input.agentId)!;
      agent.lastActivityAt = record.occurredAt; if (record.taskSummary) agent.currentTask = record.taskSummary; agent.updatedAt = new Date().toISOString();
    }); return record;
  }
  query(filter: { agentId?: string; provider?: string; from?: Date; to?: Date } = {}) {
    const data = this.store.snapshot();
    const ids = new Set(data.agents.filter((agent) => !filter.provider || agent.provider.toLowerCase() === filter.provider.toLowerCase()).map((agent) => agent.id));
    return data.usage.filter((record) => (!filter.agentId || record.agentId === filter.agentId) && ids.has(record.agentId)
      && (!filter.from || new Date(record.occurredAt) >= filter.from) && (!filter.to || new Date(record.occurredAt) <= filter.to));
  }
  totals(records = this.query()) {
    return records.reduce((total, record) => ({ requests: total.requests + record.requests, inputTokens: total.inputTokens + (record.inputTokens ?? 0), outputTokens: total.outputTokens + (record.outputTokens ?? 0), cost: total.cost + (record.estimatedCost ?? 0) }), { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 });
  }
}
function integer(value: number, label: string) { if (!Number.isInteger(value) || value < 0 || value > 1_000_000_000) throw new Error(`${label} is invalid.`); return value; }
function optionalInteger(value: number | undefined, label: string) { return value === undefined ? undefined : integer(value, label); }
function optionalAmount(value?: number) { if (value === undefined) return undefined; if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error("Estimated cost is invalid."); return value; }
function validDate(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new Error("Usage date is invalid."); return date.toISOString(); }
