import { afterEach, describe, expect, it, vi } from "vitest";
import { createDispatchPayload, dispatchBranchPreviewOta, dispatchPreviewOta, remoteBranchExists } from "../src/github.js";

const config = { token: "test-token", owner: "owner", repo: "repo", workflowFile: "preview-ota.yml", branch: "develop" };
afterEach(() => vi.unstubAllGlobals());

describe("remote branch preview dispatch", () => {
  it("checks remote branch existence and handles missing branches", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(remoteBranchExists(config, "feature/safe")).resolves.toBe(true);
    await expect(remoteBranchExists(config, "feature/missing")).resolves.toBe(false);
    expect(fetchMock.mock.calls[0][0]).toContain("branches/feature%2Fsafe");
  });

  it("always dispatches the trusted main workflow with safe target_branch input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetchMock);
    await dispatchBranchPreviewOta(config, "feature/safe", "Test branch", "Safe notes");
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({ ref: "main", inputs: { message: "Test branch", release_notes: "Safe notes", target_branch: "feature/safe" } });
    expect(createDispatchPayload("Standard preview")).toEqual({ ref: "main", inputs: { message: "Standard preview", target_branch: "develop" } });
  });
  it("keeps the existing preview command locked to develop regardless of configuration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetchMock);
    await dispatchPreviewOta({ ...config, branch: "production" }, "Standard preview");
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({ ref: "main", inputs: { message: "Standard preview", target_branch: "develop" } });
  });
});
