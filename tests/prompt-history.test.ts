import { describe, expect, it, vi } from "vitest";
import { PromptHistoryManager, buildPromptHistoryEmbed, redactPromptSecrets } from "../src/prompt-history.js";
import { isAuthorized } from "../src/security.js";
import type { CodexTask } from "../src/codex-runner.js";

const queuedTask: CodexTask = {
  id: "task1234", state: "queued", requestedBy: "Owner (1)", requestedById: "1", branch: "develop",
  summary: "Scoped development task requested", queuedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("private prompt history", () => {
  it("posts an accepted task to the configured prompt channel", async () => {
    const message = { edit: vi.fn(async () => undefined) };
    const channel = { send: vi.fn(async () => message) };
    const history = new PromptHistoryManager(async () => channel, "build-channel");
    await history.record(queuedTask, "Implement the safe settings screen");
    expect(channel.send).toHaveBeenCalledOnce();
    expect(JSON.stringify(channel.send.mock.calls[0])).toContain("Implement the safe settings screen");
  });

  it("edits the prompt history message through task lifecycle updates", async () => {
    const message = { edit: vi.fn(async () => undefined) };
    const history = new PromptHistoryManager(async () => ({ send: vi.fn(async () => message) }));
    await history.record(queuedTask, "Implement the safe settings screen");
    await history.update({ ...queuedTask, state: "running", startedAt: new Date("2026-01-01T00:00:01Z") });
    await history.update({ ...queuedTask, state: "completed", startedAt: new Date("2026-01-01T00:00:01Z"), completedAt: new Date("2026-01-01T00:00:11Z"), summary: "Completed safely" });
    expect(message.edit).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(message.edit.mock.calls[1])).toContain("Completed");
    expect(JSON.stringify(message.edit.mock.calls[1])).toContain("10 seconds");
  });

  it("redacts likely service and environment secrets", () => {
    const prompt = "Use GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz and API_KEY=sk-abcdefghijklmnopqrstuvwxyz then SMTP_PASSWORD=hunter2";
    const rendered = JSON.stringify(buildPromptHistoryEmbed(queuedTask, prompt).toJSON());
    expect(rendered).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(rendered).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(rendered).not.toContain("hunter2");
    expect(redactPromptSecrets(prompt)).toContain("[REDACTED]");
  });

  it("does not post an unauthorized prompt attempt", async () => {
    const channel = { send: vi.fn() };
    const history = new PromptHistoryManager(async () => channel);
    const authorized = isAuthorized("attacker", [], new Set(["owner"]), new Set());
    if (authorized) await history.record(queuedTask, "Implement an unauthorized request");
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("handles a missing prompts channel safely", async () => {
    const history = new PromptHistoryManager(async () => undefined);
    await expect(history.record(queuedTask, "Implement the safe settings screen")).resolves.toBeUndefined();
    await expect(history.update({ ...queuedTask, state: "running" })).resolves.toBeUndefined();
  });
});
