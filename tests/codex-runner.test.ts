import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { buildCodexInvocation, buildSafeChildEnvironment, classifyCodexTask, LocalCodexRunner } from "../src/codex-runner.js";
import { isAuthorized, validateCodexPrompt } from "../src/security.js";

const base = { enabled: true, executable: "codex.exe", repoPath: process.cwd(), timeoutMinutes: 1, cooldownSeconds: 60 };
const probe = async (_command: string, args: string[]) => args.includes("--show-current") ? "feature/test\n" : "ok\n";

function fakeSpawn(mode: "complete" | "fail" | "wait", calls: Array<{ command: string; args: readonly string[]; shell: unknown }> = [], stderrText = "") {
  return ((command: string, args: readonly string[], options: { shell?: unknown }) => {
    calls.push({ command, args, shell: options.shell });
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    child.kill = vi.fn(() => { queueMicrotask(() => child.emit("close", null)); return true; });
    if (mode !== "wait") queueMicrotask(() => {
      if (mode === "complete") child.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"Implemented safely. token=hidden"}}\n');
      if (stderrText) child.stderr.write(stderrText);
      child.stdout.end(); child.emit("close", mode === "complete" ? 0 : 1);
    });
    return child;
  }) as unknown as typeof spawn;
}

describe("local Codex security", () => {
  it("rejects an unauthorized Codex requester through the shared guard", () => {
    expect(isAuthorized("attacker", [], new Set(["owner"]), new Set(["maintainer"]))).toBe(false);
  });
  it("rejects tasks when the runner is disabled", async () => {
    const runner = new LocalCodexRunner({ ...base, enabled: false }, fakeSpawn("wait"), probe);
    await runner.checkStartup();
    await expect(runner.enqueue({ prompt: "Implement a safe UI test", requestedBy: "Owner", requestedById: "1" })).rejects.toThrow(/disabled/);
  });
  it.each(["short", "git push origin main", "Please run git reset --hard now", "Run eas update for release", "Delete the .env secret file"])("rejects dangerous or invalid prompt %j", (prompt) => {
    expect(() => validateCodexPrompt(prompt)).toThrow();
  });
  it("uses a fixed argument array with no shell interpolation and strips secrets", () => {
    const invocation = buildCodexInvocation("codex.exe");
    expect(invocation).toEqual(expect.objectContaining({ command: "codex.exe", shell: false }));
    expect(invocation.args).toEqual(["exec", "--sandbox", "workspace-write", "--color", "never", "--json", "-"]);
    expect(invocation.args).not.toContain("--ask-for-approval");
    expect(invocation.args).toContain("-");
    expect(invocation.args.join(" ")).not.toContain("discord prompt");
    const env = buildSafeChildEnvironment({ PATH: "safe", DISCORD_TOKEN: "secret", GITHUB_TOKEN: "secret2" });
    expect(env).toEqual({ PATH: "safe" });
  });
  it("uses the compatible read-only invocation only for inspection tasks", () => {
    expect(classifyCodexTask("Inspect the authentication flow and report findings")).toBe("read-only");
    expect(buildCodexInvocation("codex.exe", "read-only").args).toEqual(["exec", "--sandbox", "read-only", "--color", "never", "--json", "-"]);
    expect(classifyCodexTask("Inspect and fix the authentication flow")).toBe("workspace-write");
  });
  it("enforces one task at a time and completes with redacted summary", async () => {
    const calls: Array<{ command: string; args: readonly string[]; shell: unknown }> = [];
    const runner = new LocalCodexRunner(base, fakeSpawn("complete", calls), probe);
    await runner.checkStartup();
    await runner.enqueue({ prompt: "Implement the requested safe component", requestedBy: "Owner", requestedById: "1" });
    await expect(runner.enqueue({ prompt: "Implement another safe component", requestedBy: "Other", requestedById: "2" })).rejects.toThrow(/already/);
    await once(runner, "completed");
    expect(runner.currentTask?.state).toBe("completed");
    expect(runner.currentTask?.summary).not.toContain("hidden");
    expect(calls[0]).toEqual(expect.objectContaining({ command: "codex.exe", shell: false }));
  });
  it("records failure lifecycle with an actionable redacted CLI argument diagnostic", async () => {
    const diagnostics: string[] = [];
    const runner = new LocalCodexRunner(base, fakeSpawn("fail", [], "error: unexpected argument '--obsolete' found token=secret"), probe, async (entry) => { diagnostics.push(entry); }); await runner.checkStartup();
    await runner.enqueue({ prompt: "Implement the requested safe component", requestedBy: "Owner", requestedById: "1" });
    await once(runner, "failed");
    expect(runner.currentTask?.state).toBe("failed");
    expect(runner.currentTask?.summary).toMatch(/rejected a configured argument/);
    await vi.waitFor(() => expect(diagnostics).toHaveLength(1));
    expect(diagnostics[0]).toContain("exit=1");
    expect(diagnostics[0]).not.toContain("secret");
  });
  it("cancels only its retained running child", async () => {
    const runner = new LocalCodexRunner(base, fakeSpawn("wait"), probe); await runner.checkStartup();
    await runner.enqueue({ prompt: "Implement the requested safe component", requestedBy: "Owner", requestedById: "1" });
    await once(runner, "running");
    expect(runner.cancel()).toBe(true);
    expect(runner.currentTask?.state).toBe("cancelled");
    expect(runner.cancel()).toBe(false);
  });
});
