import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/preview-ota.yml", import.meta.url), "utf8");

describe("preview OTA changelog workflow", () => {
  it("keeps all preview-only restrictions hardcoded", () => {
    expect(workflow).toContain("ref: ${{ inputs.target_branch }}");
    expect(workflow).toContain("--channel preview --environment preview --platform android");
    expect(workflow).not.toMatch(/inputs:\s*[\s\S]*?\b(channel|environment|platform):/);
    expect(workflow).not.toMatch(/--channel\s+production|--environment\s+production|\bproduction:\s*/);
    expect(workflow).toContain("^(design|feature|fix)/[a-z0-9._/-]+$");
    expect(workflow).toContain('if [ "$TARGET_BRANCH" = "develop" ]');
  });

  it("posts the changelog only after successful workflow steps", () => {
    expect(workflow).toMatch(/name: Post successful preview changelog\s+if: success\(\)/);
    expect(workflow).toContain("DISCORD_CHANGELOG_WEBHOOK_URL");
    expect(workflow).toContain("AxionRide Preview Update");
    expect(workflow).toContain("AxionRide Branch Preview");
    expect(workflow).toContain("Preview Branch OTA");
  });

  it("skips a missing changelog webhook without failing OTA", () => {
    expect(workflow).toMatch(/if \[ -z \"\$DISCORD_CHANGELOG_WEBHOOK_URL\" \]; then[\s\S]*?exit 0/);
  });
});
