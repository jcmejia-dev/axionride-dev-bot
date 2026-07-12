import { randomUUID } from "node:crypto";
import type { AIDataStore, AIAgent } from "./AIDataStore.js";
import { sanitizeMonitoringText } from "./AIDataStore.js";

export type AgentInput = Pick<AIAgent, "provider" | "name" | "agentType" | "dataMode"> & Partial<Pick<AIAgent, "monitoringEnabled" | "currentTask" | "notes" | "dailySpendLimit" | "monthlySpendLimit" | "providerMonthlySpendLimit">>;

export class AIAgentRegistryService {
  constructor(private readonly store: AIDataStore) {}
  list() { return this.store.snapshot().agents; }
  get(id: string) { return this.list().find((agent) => agent.id === id); }
  async add(input: AgentInput) {
    const now = new Date().toISOString();
    const agent: AIAgent = {
      id: randomUUID().slice(0, 8), provider: sanitizeMonitoringText(input.provider, 80), name: sanitizeMonitoringText(input.name, 100),
      agentType: sanitizeMonitoringText(input.agentType, 60), dataMode: input.dataMode, monitoringEnabled: input.monitoringEnabled ?? true,
      currentTask: input.currentTask ? sanitizeMonitoringText(input.currentTask, 200) : undefined, notes: input.notes ? sanitizeMonitoringText(input.notes) : undefined,
      dailySpendLimit: amount(input.dailySpendLimit), monthlySpendLimit: amount(input.monthlySpendLimit), providerMonthlySpendLimit: amount(input.providerMonthlySpendLimit),
      createdAt: now, updatedAt: now,
    };
    await this.store.update((data) => data.agents.push(agent)); return agent;
  }
  async edit(id: string, input: Partial<AgentInput>) {
    let result: AIAgent | undefined;
    await this.store.update((data) => {
      const agent = data.agents.find((item) => item.id === id); if (!agent) throw new Error("AI agent/tool was not found.");
      if (input.provider !== undefined) agent.provider = sanitizeMonitoringText(input.provider, 80);
      if (input.name !== undefined) agent.name = sanitizeMonitoringText(input.name, 100);
      if (input.agentType !== undefined) agent.agentType = sanitizeMonitoringText(input.agentType, 60);
      if (input.dataMode !== undefined) agent.dataMode = input.dataMode;
      if (input.currentTask !== undefined) agent.currentTask = sanitizeMonitoringText(input.currentTask, 200);
      if (input.notes !== undefined) agent.notes = sanitizeMonitoringText(input.notes);
      if (input.dailySpendLimit !== undefined) agent.dailySpendLimit = amount(input.dailySpendLimit);
      if (input.monthlySpendLimit !== undefined) agent.monthlySpendLimit = amount(input.monthlySpendLimit);
      if (input.providerMonthlySpendLimit !== undefined) agent.providerMonthlySpendLimit = amount(input.providerMonthlySpendLimit);
      agent.updatedAt = new Date().toISOString(); result = { ...agent };
    }); return result!;
  }
  async setEnabled(id: string, enabled: boolean) { return this.edit(id, { monitoringEnabled: enabled }); }
  async remove(id: string, confirmed: boolean) {
    if (!confirmed) throw new Error("Deletion requires explicit confirmation.");
    await this.store.update((data) => {
      if (!data.agents.some((agent) => agent.id === id)) throw new Error("AI agent/tool was not found.");
      data.agents = data.agents.filter((agent) => agent.id !== id); data.usage = data.usage.filter((record) => record.agentId !== id);
    });
  }
}
function amount(value?: number) { if (value === undefined) return undefined; if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error("Spend limit is invalid."); return value; }
