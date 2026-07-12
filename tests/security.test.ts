import { describe, expect, it } from "vitest";
import { isAuthorized, OtaRequestGuard, validateOtaMessage, validateReleaseNotes } from "../src/security.js";
import { createDispatchPayload } from "../src/github.js";
import { buildAxionEmbed, formatSafeStatus } from "../src/embeds.js";

describe("authorization", () => {
  it("rejects an unauthorized user", () => expect(isAuthorized("1", ["2"], new Set(["3"]), new Set(["4"]))).toBe(false));
  it("accepts an allowed user or role", () => {
    expect(isAuthorized("3", [], new Set(["3"]), new Set())).toBe(true);
    expect(isAuthorized("1", ["4"], new Set(), new Set(["4"]))).toBe(true);
  });
});

describe("OTA protections", () => {
  it.each(["", "a".repeat(121), "bad\nmessage", "https://evil.test", "release; whoami", "$(whoami)"])("rejects invalid message %j", (message) => {
    expect(() => validateOtaMessage(message)).toThrow();
  });
  it("enforces cooldown", () => {
    const guard = new OtaRequestGuard(60_000); const release = guard.acquire("user", 1000); release();
    expect(() => guard.acquire("user", 2000)).toThrow(/wait 59 seconds/);
  });
  it("blocks concurrent dispatches", () => {
    const guard = new OtaRequestGuard(); const release = guard.acquire("one", 1000);
    expect(() => guard.acquire("two", 1000)).toThrow(/already being queued/); release();
  });
  it("dispatch payload exposes only a message input and configured ref", () => {
    expect(createDispatchPayload("Safe release", "develop")).toEqual({ ref: "develop", inputs: { message: "Safe release" } });
    expect(JSON.stringify(createDispatchPayload("Safe release"))).not.toMatch(/channel|environment|platform|production/);
  });
  it("validates optional release notes and includes no deployment controls", () => {
    expect(validateReleaseNotes("Improved rider settings and map behavior.")).toBe("Improved rider settings and map behavior.");
    expect(() => validateReleaseNotes("See https://example.com")).toThrow();
    expect(() => validateReleaseNotes("bad\nnotes")).toThrow();
    expect(() => validateReleaseNotes("release; eas update")).toThrow();
    const payload = createDispatchPayload("Preview update", "develop", "Improved settings");
    expect(payload).toEqual({ ref: "develop", inputs: { message: "Preview update", release_notes: "Improved settings" } });
    expect(JSON.stringify(payload)).not.toMatch(/channel|environment|platform|production/);
  });
});

it("redacts secrets from safe status and embed output", () => {
  const status = formatSafeStatus(true, true, "token=supersecret");
  const embed = buildAxionEmbed("Status", [{ name: "Data", value: "password: hunter2" }]).toJSON();
  expect(JSON.stringify({ status, embed })).not.toContain("supersecret");
  expect(JSON.stringify({ status, embed })).not.toContain("hunter2");
});
