import { randomUUID } from "node:crypto";
import type { AIDataStore, AIOperationsAlert, AISubscription } from "./AIDataStore.js";
import { sanitizeMonitoringText, validatePaymentNote } from "./AIDataStore.js";

export type SubscriptionInput = Pick<AISubscription, "provider" | "toolName" | "planName"> & Partial<Omit<AISubscription, "id" | "provider" | "toolName" | "planName" | "createdAt" | "updatedAt">>;

export class AISubscriptionService {
  constructor(private readonly store: AIDataStore) {}
  list() { return this.store.snapshot().subscriptions; }
  async add(input: SubscriptionInput) {
    const now = new Date().toISOString();
    const subscription: AISubscription = {
      id: randomUUID().slice(0, 8), agentId: input.agentId, provider: sanitizeMonitoringText(input.provider, 80), toolName: sanitizeMonitoringText(input.toolName, 100), planName: sanitizeMonitoringText(input.planName, 80),
      trialStart: date(input.trialStart), trialEnd: date(input.trialEnd), renewalDate: date(input.renewalDate), autoRenew: input.autoRenew ?? false,
      expectedCharge: charge(input.expectedCharge), currency: sanitizeMonitoringText(input.currency ?? "USD", 10).toUpperCase(), paymentMethodNote: input.paymentMethodNote ? validatePaymentNote(input.paymentMethodNote) : undefined,
      monitoringEnabled: input.monitoringEnabled ?? true, reminderDays: input.reminderDays ?? [7, 1], notes: input.notes ? sanitizeMonitoringText(input.notes) : undefined,
      state: input.state ?? "active", createdAt: now, updatedAt: now,
    };
    await this.store.update((data) => data.subscriptions.push(subscription)); return subscription;
  }
  async edit(id: string, input: Partial<SubscriptionInput>) {
    let result: AISubscription | undefined;
    await this.store.update((data) => {
      const item = data.subscriptions.find((sub) => sub.id === id); if (!item) throw new Error("AI subscription was not found.");
      if (input.provider !== undefined) item.provider = sanitizeMonitoringText(input.provider, 80);
      if (input.toolName !== undefined) item.toolName = sanitizeMonitoringText(input.toolName, 100);
      if (input.planName !== undefined) item.planName = sanitizeMonitoringText(input.planName, 80);
      if (input.trialStart !== undefined) item.trialStart = date(input.trialStart);
      if (input.trialEnd !== undefined) item.trialEnd = date(input.trialEnd);
      if (input.renewalDate !== undefined) item.renewalDate = date(input.renewalDate);
      if (input.autoRenew !== undefined) item.autoRenew = input.autoRenew;
      if (input.expectedCharge !== undefined) item.expectedCharge = charge(input.expectedCharge);
      if (input.paymentMethodNote !== undefined) item.paymentMethodNote = validatePaymentNote(input.paymentMethodNote);
      if (input.notes !== undefined) item.notes = sanitizeMonitoringText(input.notes);
      if (input.monitoringEnabled !== undefined) item.monitoringEnabled = input.monitoringEnabled;
      if (input.state !== undefined) item.state = input.state;
      if (input.reminderDays !== undefined) item.reminderDays = reminders(input.reminderDays);
      item.updatedAt = new Date().toISOString(); result = { ...item };
    }); return result!;
  }
  async remove(id: string, confirmed: boolean) { if (!confirmed) throw new Error("Deletion requires explicit confirmation."); await this.store.update((data) => { const before = data.subscriptions.length; data.subscriptions = data.subscriptions.filter((item) => item.id !== id); if (before === data.subscriptions.length) throw new Error("AI subscription was not found."); }); }

  async dueAlerts(now = new Date()): Promise<AIOperationsAlert[]> {
    const created: AIOperationsAlert[] = [];
    await this.store.update((data) => {
      for (const subscription of data.subscriptions.filter((item) => item.monitoringEnabled)) {
        if (subscription.state === "expired") {
          const key = `subscription:${subscription.id}:expired:state`;
          if (!data.alerts.some((alert) => alert.key === key)) { const alert: AIOperationsAlert = { key, type: "expired", entityId: subscription.id, message: `Subscription expired: ${subscription.provider} / ${subscription.toolName}`, active: true, createdAt: now.toISOString() }; data.alerts.push(alert); created.push(alert); }
          continue;
        }
        if (subscription.state !== "active") continue;
        const events: Array<{ type: "trial" | "renewal" | "expired"; date?: string }> = [
          { type: "trial", date: subscription.trialEnd }, { type: "renewal", date: subscription.renewalDate },
        ];
        for (const event of events) {
          if (!event.date) continue; const days = Math.ceil((new Date(event.date).getTime() - now.getTime()) / 86_400_000);
          const due = days < 0 ? (event.type === "trial" ? "expired" : undefined) : subscription.reminderDays.includes(days) ? event.type : undefined;
          if (!due) continue;
          const key = `subscription:${subscription.id}:${due}:${event.date}:${Math.max(days, -1)}`;
          if (data.alerts.some((alert) => alert.key === key)) continue;
          const label = due === "trial" ? "Trial ending" : due === "renewal" ? "Renewal due" : "Subscription expired";
          const chargeNote = due === "renewal" && subscription.expectedCharge !== undefined ? `; expected estimated charge ${subscription.currency} ${subscription.expectedCharge.toFixed(2)}` : "";
          const alert: AIOperationsAlert = { key, type: due, entityId: subscription.id, message: `${label}: ${subscription.provider} / ${subscription.toolName} (${event.date})${chargeNote}`, active: true, createdAt: now.toISOString() };
          data.alerts.push(alert); created.push(alert);
        }
      }
    }); return created;
  }
  async markDelivered(key: string) { await this.store.update((data) => { const alert = data.alerts.find((item) => item.key === key); if (alert && !alert.deliveredAt) alert.deliveredAt = new Date().toISOString(); }); }
}
function date(value?: string) { if (!value) return undefined; const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value); if (Number.isNaN(parsed.getTime())) throw new Error("Subscription date is invalid."); return parsed.toISOString(); }
function charge(value?: number) { if (value === undefined) return undefined; if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error("Expected charge is invalid."); return value; }
function reminders(value: number[]) { const unique = [...new Set(value)]; if (unique.some((day) => !Number.isInteger(day) || day < 0 || day > 365)) throw new Error("Reminder days are invalid."); return unique; }
