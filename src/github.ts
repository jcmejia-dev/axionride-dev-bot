export interface DispatchConfig {
  token: string;
  owner: string;
  repo: string;
  workflowFile: string;
  branch: string;
}

export function createDispatchPayload(message: string, branch = "develop") {
  return { ref: branch, inputs: { message } } as const;
}

export async function dispatchPreviewOta(config: DispatchConfig, message: string): Promise<void> {
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
    body: JSON.stringify(createDispatchPayload(message, config.branch)),
  });
  if (!response.ok) throw new Error(`GitHub workflow dispatch failed with status ${response.status}`);
}

