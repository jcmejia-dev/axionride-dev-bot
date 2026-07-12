import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const sourceSchema = z.enum(["manual", "api", "unknown"]);
export type DataSource = z.infer<typeof sourceSchema>;

export const agentSchema = z.object({
  id: z.string(), provider: z.string(), name: z.string(), agentType: z.string(), dataMode: z.enum(["manual", "api"]),
  monitoringEnabled: z.boolean(), lastActivityAt: z.string().optional(), currentTask: z.string().optional(), notes: z.string().optional(),
  dailySpendLimit: z.number().nonnegative().optional(), monthlySpendLimit: z.number().nonnegative().optional(), providerMonthlySpendLimit: z.number().nonnegative().optional(),
  createdAt: z.string(), updatedAt: z.string(),
});
export type AIAgent = z.infer<typeof agentSchema>;

export const usageSchema = z.object({
  id: z.string(), agentId: z.string(), occurredAt: z.string(), requests: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(), estimatedCost: z.number().nonnegative().optional(), currency: z.string(), source: sourceSchema,
  exactBilling: z.boolean().default(false), taskSummary: z.string().optional(),
});
export type AIUsageRecord = z.infer<typeof usageSchema>;

export const subscriptionSchema = z.object({
  id: z.string(), agentId: z.string().optional(), provider: z.string(), toolName: z.string(), planName: z.string(),
  trialStart: z.string().optional(), trialEnd: z.string().optional(), renewalDate: z.string().optional(), autoRenew: z.boolean(),
  expectedCharge: z.number().nonnegative().optional(), currency: z.string(), paymentMethodNote: z.string().optional(),
  monitoringEnabled: z.boolean(), reminderDays: z.array(z.number().int().min(0).max(365)), notes: z.string().optional(),
  state: z.enum(["active", "cancelled", "expired"]), createdAt: z.string(), updatedAt: z.string(),
});
export type AISubscription = z.infer<typeof subscriptionSchema>;

export const alertSchema = z.object({
  key: z.string(), type: z.enum(["trial", "renewal", "expired", "cost", "spike", "burst", "resolved"]), entityId: z.string(),
  message: z.string(), deliveredAt: z.string().optional(), active: z.boolean(), createdAt: z.string(), resolvedAt: z.string().optional(),
});
export type AIOperationsAlert = z.infer<typeof alertSchema>;

const dataSchema = z.object({ version: z.literal(1), agents: z.array(agentSchema), usage: z.array(usageSchema), subscriptions: z.array(subscriptionSchema), alerts: z.array(alertSchema) });
export type AIData = z.infer<typeof dataSchema>;
const defaults = (): AIData => ({ version: 1, agents: [], usage: [], subscriptions: [], alerts: [] });

export class AIDataStore {
  private data: AIData = defaults();
  private writes: Promise<void> = Promise.resolve();
  constructor(readonly path: string) {}

  async init() {
    await mkdir(dirname(this.path), { recursive: true });
    try { this.data = dataSchema.parse(JSON.parse(await readFile(this.path, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("AI operations data is invalid and was not loaded.");
      this.data = defaults();
      await this.save();
    }
  }

  snapshot(): AIData { return structuredClone(this.data); }
  async update(mutator: (data: AIData) => void) {
    mutator(this.data);
    dataSchema.parse(this.data);
    await this.save();
  }

  private save() {
    this.writes = this.writes.then(async () => {
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: "utf8" });
      await rename(temporary, this.path);
    });
    return this.writes;
  }
}

export function sanitizeMonitoringText(value: string, max = 500): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\0\r\n]/.test(trimmed)) throw new Error(`Text must be 1–${max} characters on one line.`);
  return trimmed
    .replace(/\b(?:gh[opsu]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED]")
    .replace(/\b(token|secret|password|api[ _-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
}

export function validatePaymentNote(value: string): string {
  const note = sanitizeMonitoringText(value, 80);
  if (/\b(cvv|cvc|pin|bank account|routing)\b/i.test(note) || /(?:\d[ -]?){8,}/.test(note)) {
    throw new Error("Payment method must be a harmless note only, such as a wallet name and last four digits.");
  }
  return note;
}
