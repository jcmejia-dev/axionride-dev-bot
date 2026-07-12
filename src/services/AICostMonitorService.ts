import type { AIDataStore, AIOperationsAlert } from "./AIDataStore.js";

export interface CostStatus { knownEstimatedSpend: Record<string, number>; activeAlerts: AIOperationsAlert[]; reliability: "Manual" | "API-backed" | "Unknown" }
export class AICostMonitorService {
  constructor(private readonly store: AIDataStore) {}
  async evaluate(now = new Date()): Promise<AIOperationsAlert[]> {
    const created: AIOperationsAlert[] = [];
    const breached = new Set<string>();
    await this.store.update((data) => {
      for (const agent of data.agents.filter((item) => item.monitoringEnabled)) {
        const records = data.usage.filter((record) => record.agentId === agent.id);
        const dailyRecords = records.filter((record) => record.estimatedCost !== undefined && sameUtcDay(new Date(record.occurredAt), now));
        const monthlyRecords = records.filter((record) => record.estimatedCost !== undefined && sameUtcMonth(new Date(record.occurredAt), now));
        const dailyCurrency = singleCurrency(dailyRecords); const monthlyCurrency = singleCurrency(monthlyRecords);
        if (dailyCurrency) addThreshold(data.alerts, created, breached, now, agent.id, `agent:${agent.id}:daily:${dayKey(now)}:${dailyCurrency}`, agent.dailySpendLimit, sum(dailyRecords), `${agent.provider} / ${agent.name} daily estimated spend (${dailyCurrency})`);
        if (monthlyCurrency) addThreshold(data.alerts, created, breached, now, agent.id, `agent:${agent.id}:monthly:${monthKey(now)}:${monthlyCurrency}`, agent.monthlySpendLimit, sum(monthlyRecords), `${agent.provider} / ${agent.name} monthly estimated spend (${monthlyCurrency})`);
        const recentRequests = records.filter((record) => now.getTime() - new Date(record.occurredAt).getTime() <= 3_600_000).reduce((n, record) => n + record.requests, 0);
        const prior = records.filter((record) => { const age = now.getTime() - new Date(record.occurredAt).getTime(); return age > 3_600_000 && age <= 7 * 86_400_000; });
        const baseline = prior.reduce((n, record) => n + record.requests, 0) / (7 * 24);
        if (baseline >= 1 && recentRequests >= Math.max(10, baseline * 3)) addSpecial(data.alerts, created, breached, now, agent.id, `spike:${agent.id}:${dayKey(now)}`, "spike", `${agent.provider} / ${agent.name} activity spike: ${recentRequests} requests versus ${baseline.toFixed(1)} hourly baseline`);
        if (recentRequests >= 100) addSpecial(data.alerts, created, breached, now, agent.id, `burst:${agent.id}:${dayKey(now)}`, "burst", `${agent.provider} / ${agent.name} repeated activity burst: ${recentRequests} requests in one hour`);
      }
      for (const provider of new Set(data.agents.map((agent) => agent.provider))) {
        const agents = data.agents.filter((agent) => agent.provider === provider); const limit = agents.map((agent) => agent.providerMonthlySpendLimit).filter((value): value is number => value !== undefined).sort((a, b) => a - b)[0];
        const ids = new Set(agents.map((agent) => agent.id)); const providerRecords = data.usage.filter((record) => ids.has(record.agentId) && record.estimatedCost !== undefined && sameUtcMonth(new Date(record.occurredAt), now)); const currency = singleCurrency(providerRecords);
        if (currency) addThreshold(data.alerts, created, breached, now, provider, `provider:${provider}:${monthKey(now)}:${currency}`, limit, sum(providerRecords), `${provider} monthly estimated spend (${currency})`);
      }
      for (const alert of data.alerts.filter((item) => item.active && ["cost", "spike", "burst"].includes(item.type) && !breached.has(item.key))) {
        alert.active = false; alert.resolvedAt = now.toISOString(); const key = `resolved:${alert.key}`;
        if (!data.alerts.some((item) => item.key === key)) { const resolved: AIOperationsAlert = { key, type: "resolved", entityId: alert.entityId, message: `Resolved: ${alert.message}`, active: false, createdAt: now.toISOString() }; data.alerts.push(resolved); created.push(resolved); }
      }
    }); return created;
  }
  status(): CostStatus {
    const data = this.store.snapshot(); const known = data.usage.filter((record) => record.estimatedCost !== undefined);
    const sources = new Set(known.map((record) => record.source));
    const spend = known.reduce<Record<string, number>>((totals, record) => { totals[record.currency] = (totals[record.currency] ?? 0) + (record.estimatedCost ?? 0); return totals; }, {});
    return { knownEstimatedSpend: spend, activeAlerts: data.alerts.filter((alert) => alert.active && ["cost", "spike", "burst"].includes(alert.type)), reliability: sources.has("api") ? "API-backed" : sources.has("manual") ? "Manual" : "Unknown" };
  }
}
function sum(records: Array<{ estimatedCost?: number }>) { return records.reduce((total, item) => total + (item.estimatedCost ?? 0), 0); }
function singleCurrency(records: Array<{ currency: string }>) { const currencies = [...new Set(records.map((record) => record.currency))]; return currencies.length === 1 ? currencies[0] : undefined; }
function sameUtcDay(a: Date, b: Date) { return dayKey(a) === dayKey(b); } function sameUtcMonth(a: Date, b: Date) { return monthKey(a) === monthKey(b); }
function dayKey(date: Date) { return date.toISOString().slice(0, 10); } function monthKey(date: Date) { return date.toISOString().slice(0, 7); }
function addThreshold(alerts: AIOperationsAlert[], created: AIOperationsAlert[], breached: Set<string>, now: Date, entityId: string, key: string, threshold: number | undefined, observed: number, label: string) { if (threshold === undefined || observed < threshold) return; addSpecial(alerts, created, breached, now, entityId, key, "cost", `Estimated cost alert: ${label}; threshold ${threshold.toFixed(2)}, observed ${observed.toFixed(2)}`); }
function addSpecial(alerts: AIOperationsAlert[], created: AIOperationsAlert[], breached: Set<string>, now: Date, entityId: string, key: string, type: "cost" | "spike" | "burst", message: string) { breached.add(key); const existing = alerts.find((alert) => alert.key === key); if (existing) { existing.active = true; return; } const alert: AIOperationsAlert = { key, type, entityId, message, active: true, createdAt: now.toISOString() }; alerts.push(alert); created.push(alert); }
