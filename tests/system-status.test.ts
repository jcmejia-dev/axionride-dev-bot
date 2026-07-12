import { describe, expect, it, vi } from "vitest";
import { buildSystemStatusEmbed, checkPublicUrl, enforceStatusInterval, upsertStatusMessage } from "../src/system-status.js";

describe("system status", () => {
  it("enforces a 30 second minimum", () => {
    expect(enforceStatusInterval(1)).toBe(30);
    expect(enforceStatusInterval(60)).toBe(60);
  });
  it("edits the existing status message instead of duplicating it", async () => {
    const existing = { edit: vi.fn(async () => undefined) };
    const store = { findExisting: vi.fn(async () => existing), send: vi.fn(async () => existing) };
    await upsertStatusMessage(store, { embeds: [] });
    expect(existing.edit).toHaveBeenCalledOnce();
    expect(store.send).not.toHaveBeenCalled();
  });
  it("safely treats missing provider configuration as unknown", async () => {
    expect(await checkPublicUrl(undefined)).toBe("unknown");
  });
  it("does not expose secrets in the control-room embed", () => {
    const embed = buildSystemStatusEmbed({
      discord: "operational", runner: "token=topsecret", githubActions: "password:hunter2",
      supabase: "unknown", expo: "unknown", railway: "not configured", refreshedAt: new Date(0),
    }).toJSON();
    const rendered = JSON.stringify(embed);
    expect(rendered).not.toContain("topsecret");
    expect(rendered).not.toContain("hunter2");
  });
});
