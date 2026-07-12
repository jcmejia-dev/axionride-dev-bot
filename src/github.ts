export interface DispatchConfig {
  token: string;
  owner: string;
  repo: string;
  workflowFile: string;
  branch: string;
}

export const TRUSTED_WORKFLOW_REF = "main";

export function createDispatchPayload(message: string, targetBranch = "develop", releaseNotes?: string) {
  return { ref: TRUSTED_WORKFLOW_REF, inputs: { message, ...(releaseNotes ? { release_notes: releaseNotes } : {}), target_branch: targetBranch } } as const;
}

export async function dispatchPreviewOta(config: DispatchConfig, message: string, releaseNotes?: string): Promise<void> {
  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/${encodeURIComponent(config.workflowFile)}/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "axionride-dev-bot",
    },
    body: JSON.stringify(createDispatchPayload(message, "develop", releaseNotes)),
  });
  if (!response.ok) throw new Error(`GitHub workflow dispatch failed with status ${response.status}`);
}

export async function remoteBranchExists(config: Pick<DispatchConfig, "token" | "owner" | "repo">, branch: string): Promise<boolean> {
  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/branches/${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers: {
    Accept: "application/vnd.github+json", Authorization: `Bearer ${config.token}`,
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "axionride-dev-bot",
  } });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`GitHub remote branch check failed with status ${response.status}`);
  return true;
}

export async function dispatchBranchPreviewOta(config: DispatchConfig, branch: string, message: string, releaseNotes?: string): Promise<void> {
  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/${encodeURIComponent(config.workflowFile)}/dispatches`;
  const response = await fetch(url, { method: "POST", headers: {
    Accept: "application/vnd.github+json", Authorization: `Bearer ${config.token}`, "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "axionride-dev-bot",
  }, body: JSON.stringify(createDispatchPayload(message, branch, releaseNotes)) });
  if (!response.ok) throw new Error(`GitHub branch preview dispatch failed with status ${response.status}`);
}
