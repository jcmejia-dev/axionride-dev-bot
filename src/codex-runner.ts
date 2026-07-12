import { EventEmitter } from "node:events";
import { access, appendFile, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { safeText } from "./embeds.js";
import { validateBranch, validateCodexPrompt } from "./security.js";

export type CodexTaskState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface CodexTask {
  id: string;
  state: CodexTaskState;
  requestedBy: string;
  requestedById: string;
  branch: string;
  summary: string;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface RunnerConfig {
  enabled: boolean;
  executable: string;
  repoPath: string;
  timeoutMinutes: number;
  cooldownSeconds: number;
}

export type CodexTaskMode = "read-only" | "workspace-write";

export const FINAL_SAFETY_INSTRUCTION = "Do not commit, push, publish OTA, alter secrets, or run destructive Git commands. Implement only the requested scoped change, validate it, and report results.";

export function classifyCodexTask(prompt: string): CodexTaskMode {
  const inspection = /^(inspect|review|analy[sz]e|explain|audit|investigate|find|read|check|summari[sz]e|trace)\b/i;
  const mutation = /\b(implement|fix|change|update|add|create|write|edit|modify|remove|rename|refactor|install)\b/i;
  return inspection.test(prompt.trim()) && !mutation.test(prompt) ? "read-only" : "workspace-write";
}

export function buildCodexInvocation(executable: string, mode: CodexTaskMode = "workspace-write") {
  return {
    command: executable,
    args: ["exec", "--sandbox", mode, "--color", "never", "--json", "-"],
    shell: false as const,
  };
}

export function buildSafeChildEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "CODEX_HOME"];
  return Object.fromEntries(allowed.flatMap((key) => env[key] === undefined ? [] : [[key, env[key]]]));
}

export class LocalCodexRunner extends EventEmitter {
  private task?: CodexTask;
  private child?: ChildProcessWithoutNullStreams;
  private timer?: NodeJS.Timeout;
  private readonly cooldowns = new Map<string, number>();
  private available = false;
  private availabilityError = "Local runner has not completed its startup check.";

  constructor(
    private readonly config: RunnerConfig,
    private readonly spawnProcess: typeof spawn = spawn,
    private readonly probe: (command: string, args: string[]) => Promise<string> = runProbe,
    private readonly writeDiagnostic: (entry: string) => Promise<void> = writeLocalDiagnostic,
  ) { super(); }

  get enabled() { return this.config.enabled; }
  get isAvailable() { return this.available; }
  get unavailableReason() { return this.availabilityError; }
  get currentTask(): CodexTask | undefined { return this.task ? { ...this.task } : undefined; }
  get isWorking() { return this.task?.state === "queued" || this.task?.state === "running"; }

  async checkStartup(): Promise<void> {
    if (!this.config.enabled) {
      this.available = false;
      this.availabilityError = "Local Codex runner is disabled.";
      return;
    }
    if (!/^codex\.exe$/i.test(basename(this.config.executable))) {
      this.available = false;
      this.availabilityError = "CODEX_EXECUTABLE must point to the native codex.exe; Windows command wrappers are not allowed.";
      return;
    }
    try {
      await access(this.config.repoPath);
      await this.probe("git", ["-C", this.config.repoPath, "rev-parse", "--is-inside-work-tree"]);
      await this.probe(this.config.executable, ["--version"]);
      this.available = true;
      this.availabilityError = "";
    } catch {
      this.available = false;
      this.availabilityError = "Codex CLI or the configured local Git repository is unavailable.";
    }
  }

  async getCurrentBranch(): Promise<string> {
    return (await this.probe("git", ["-C", this.config.repoPath, "branch", "--show-current"])).trim();
  }

  async enqueue(input: { prompt: string; branch?: string; requestedBy: string; requestedById: string }, now = Date.now()): Promise<CodexTask> {
    if (!this.config.enabled) throw new Error("Local Codex runner is disabled.");
    if (!this.available) throw new Error(this.availabilityError);
    if (this.isWorking) throw new Error("A local Codex task is already queued or running.");
    const last = this.cooldowns.get(input.requestedById);
    if (last !== undefined && now - last < this.config.cooldownSeconds * 1000) {
      throw new Error(`Please wait ${Math.ceil((this.config.cooldownSeconds * 1000 - (now - last)) / 1000)} seconds before queuing another Codex task.`);
    }
    const prompt = validateCodexPrompt(input.prompt);
    const currentBranch = validateBranch(await this.getCurrentBranch());
    const branch = input.branch ? validateBranch(input.branch) : currentBranch;
    if (branch !== currentBranch) throw new Error(`Branch must match the current local branch (${currentBranch}).`);
    this.cooldowns.set(input.requestedById, now);
    this.task = {
      id: randomUUID().slice(0, 8), state: "queued", requestedBy: safeText(input.requestedBy),
      requestedById: input.requestedById, branch, summary: "Scoped development task requested", queuedAt: new Date(now),
    };
    const snapshot = this.currentTask!;
    this.emit("queued", snapshot);
    setImmediate(() => this.run(prompt));
    return snapshot;
  }

  cancel(): boolean {
    if (this.task?.state !== "running" || !this.child) return false;
    this.task.state = "cancelled";
    this.task.completedAt = new Date();
    this.task.summary = "Task cancelled by the authorized owner";
    if (this.timer) clearTimeout(this.timer);
    const child = this.child;
    this.child = undefined;
    child.kill();
    this.emit("cancelled", this.currentTask);
    return true;
  }

  private run(prompt: string) {
    if (!this.task || this.task.state !== "queued") return;
    this.task.state = "running";
    this.task.startedAt = new Date();
    this.emit("running", this.currentTask);
    const mode = classifyCodexTask(prompt);
    const invocation = buildCodexInvocation(this.config.executable, mode);
    let output = "";
    let stderr = "";
    const child = this.spawnProcess(invocation.command, invocation.args, {
      cwd: this.config.repoPath, shell: invocation.shell, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"], env: buildSafeChildEnvironment(),
    }) as ChildProcessWithoutNullStreams;
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { if (output.length < 2_000_000) output += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { if (stderr.length < 65_536) stderr += chunk; });
    child.stdin.end(`${prompt}\n\n${FINAL_SAFETY_INSTRUCTION}\n`);
    this.timer = setTimeout(() => {
      if (this.task?.state === "running") {
        this.task.error = "Task exceeded its configured maximum duration.";
        child.kill();
      }
    }, this.config.timeoutMinutes * 60_000);
    child.on("error", (error) => {
      void this.recordDiagnostic(mode, null, error.message);
      this.finish("failed", "Codex CLI could not be started. Check CODEX_EXECUTABLE and the ignored local diagnostic log.");
    });
    child.on("close", (code) => {
      if (this.task?.state === "cancelled" || this.task?.state === "failed") return;
      const summary = extractSafeFinalSummary(output);
      if (code !== 0) void this.recordDiagnostic(mode, code, stderr);
      this.finish(code === 0 ? "completed" : "failed", code === 0 ? summary : (this.task?.error ?? actionableFailure(stderr, code)));
    });
  }

  private async recordDiagnostic(mode: CodexTaskMode, exitCode: number | null, reason: string) {
    const taskId = this.task?.id ?? "unknown";
    const entry = `${new Date().toISOString()} task=${taskId} mode=${mode} exit=${exitCode ?? "spawn-error"} reason=${redactDiagnostic(reason)}\n`;
    try { await this.writeDiagnostic(entry); } catch { /* Diagnostics must never crash the bot or reveal paths. */ }
  }

  private finish(state: "completed" | "failed", summary: string) {
    if (!this.task || this.task.state === "cancelled" || this.task.state === "completed" || this.task.state === "failed") return;
    if (this.timer) clearTimeout(this.timer);
    this.child = undefined;
    this.task.state = state;
    this.task.completedAt = new Date();
    this.task.summary = safeText(summary || (state === "completed" ? "Task completed; review local changes." : "Task failed.")).slice(0, 300);
    this.emit(state, this.currentTask);
  }
}

export function redactDiagnostic(value: string): string {
  return safeText(value)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:gh[opsu]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/g, "[redacted]")
    .replace(/https:\/\/[^\s?#]+[?#][^\s]+/gi, "[redacted-url]")
    .replace(/[\r\n]+/g, " ")
    .trim().slice(0, 500) || "no stderr details";
}

function actionableFailure(stderr: string, code: number | null): string {
  if (/(unexpected argument|unexpected option|unknown (argument|option)|wasn't expected)/i.test(stderr)) {
    return "Codex CLI rejected a configured argument. Verify the installed CLI version and see logs/codex-runner.log for the redacted reason.";
  }
  return `Codex exited with code ${code ?? "unknown"}. See logs/codex-runner.log for the redacted local reason.`;
}

async function writeLocalDiagnostic(entry: string): Promise<void> {
  const path = resolve(process.cwd(), "logs", "codex-runner.log");
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, entry, { encoding: "utf8" });
}

function extractSafeFinalSummary(jsonLines: string): string {
  let completionReported = false;
  for (const line of jsonLines.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (event.type === "item.completed" && event.item?.type === "agent_message") completionReported = true;
    } catch { /* Raw terminal output is intentionally ignored. */ }
  }
  return completionReported
    ? "Codex reported completion; review the local changes and local Codex session for details."
    : "Task completed; review local changes and the local Codex session.";
}

function runProbe(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, env: buildSafeChildEnvironment(), stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { if (output.length < 4096) output += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(output) : reject(new Error("probe failed")));
  });
}

export function taskDuration(task: CodexTask, now = new Date()): string {
  if (!task.startedAt) return "not started";
  const end = task.completedAt ?? now;
  return `${Math.max(0, Math.round((end.getTime() - task.startedAt.getTime()) / 1000))} seconds`;
}
