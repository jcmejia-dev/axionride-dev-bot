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

