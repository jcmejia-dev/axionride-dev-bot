export function isAuthorized(
  userId: string,
  roleIds: Iterable<string>,
  allowedUsers: ReadonlySet<string>,
  allowedRoles: ReadonlySet<string>,
): boolean {
  if (allowedUsers.has(userId)) return true;
  for (const roleId of roleIds) if (allowedRoles.has(roleId)) return true;
  return false;
}

const forbiddenMessage = /[\r\n;&|`$<>\\{}\[\]()'"!*?#%@^~:=+]|https?:\/\/|www\./i;

export function validateOtaMessage(value: string): string {
  const message = value.trim();
  if (message.length < 1 || message.length > 120) throw new Error("Message must be 1–120 characters.");
  if (forbiddenMessage.test(message)) throw new Error("Message contains a URL or unsupported command characters.");
  if (!/^[A-Za-z0-9][A-Za-z0-9 .,\-_]*$/.test(message)) throw new Error("Message contains unsupported characters.");
  return message;
}

export function validateReleaseNotes(value: string): string {
  const notes = value.trim();
  if (notes.length < 1 || notes.length > 1000) throw new Error("Release notes must be 1–1000 characters when supplied.");
  if (/[\r\n;&|`$<>\\{}\[\]]|https?:\/\/|www\./i.test(notes)) throw new Error("Release notes contain a URL or unsupported command characters.");
  if (!/^[A-Za-z0-9][A-Za-z0-9 .,\-_!?()':/]*$/.test(notes)) throw new Error("Release notes contain unsupported characters.");
  return notes;
}

export class OtaRequestGuard {
  private readonly lastRequest = new Map<string, number>();
  private dispatching = false;

  constructor(private readonly cooldownMs = 60_000) {}

  acquire(userId: string, now = Date.now()): () => void {
    if (this.dispatching) throw new Error("A preview OTA request is already being queued. Please wait.");
    const last = this.lastRequest.get(userId);
    if (last !== undefined && now - last < this.cooldownMs) {
      const seconds = Math.ceil((this.cooldownMs - (now - last)) / 1000);
      throw new Error(`Please wait ${seconds} seconds before requesting another preview OTA.`);
    }
    this.dispatching = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.lastRequest.set(userId, now);
      this.dispatching = false;
    };
  }
}

const dangerousTaskPatterns = [
  /\bgit\s+(push|reset\s+--hard|clean)\b/i,
  /\beas\s+(update|build)\b/i,
  /\bnpm\s+publish\b/i,
  /\b(deploy|deployment|publish\s+(an?\s+)?ota)\b/i,
  /\b(delete|remove|erase|overwrite|reveal|print|dump|exfiltrate)\b.{0,40}\b(secret|token|password|credential|\.env)\b/i,
  /\b(rm\s+-rf|del\s+\/s|format\s+[a-z]:|shutdown)\b/i,
];

export function validateCodexPrompt(value: string): string {
  const prompt = value.trim();
  if (prompt.length < 10 || prompt.length > 4000) throw new Error("Prompt must be 10–4000 characters.");
  if (prompt.includes("\0")) throw new Error("Prompt contains unsupported characters.");
  if (dangerousTaskPatterns.some((pattern) => pattern.test(prompt))) {
    throw new Error("Task rejected because it requests a prohibited command, deployment, destructive operation, or secret access.");
  }
  return prompt;
}

export function validateBranch(value: string): string {
  const branch = value.trim();
  if (!/^(?![./])(?!.*\.\.)(?!.*[~^:?*\[\\\s])[A-Za-z0-9._/-]{1,100}$/.test(branch)) {
    throw new Error("Branch name is invalid.");
  }
  return branch;
}
