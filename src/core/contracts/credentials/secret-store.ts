/** Trusted-process contract. Never expose secret resolution through renderer IPC or HTTP. */
export interface SecretStore {
  get(reference: string): Promise<string | null>;
  set(reference: string, secret: string): Promise<void>;
  delete(reference: string): Promise<void>;
  listRefs(): Promise<string[]>;
}

export type CredentialErrorCode =
  | "UNAVAILABLE"
  | "LOCKED"
  | "CORRUPT"
  | "UNSUPPORTED_FORMAT"
  | "WRITE_FAILED"
  | "INVALID_REQUEST"
  | "RECONNECT_REQUIRED"
  | "NOT_READY"
  | "FORBIDDEN";

const MESSAGES: Record<CredentialErrorCode, string> = {
  UNAVAILABLE: "OS credential encryption is unavailable. Unlock or configure the system keychain and retry.",
  LOCKED: "The system keychain could not encrypt or unlock credentials. Unlock it and retry.",
  CORRUPT: "The credential vault could not be read safely. Restore its encrypted backup before retrying.",
  UNSUPPORTED_FORMAT: "This credential vault requires a newer OpenPCB version.",
  WRITE_FAILED: "The credential change could not be durably saved. Check disk access and retry.",
  INVALID_REQUEST: "The credential request is invalid.",
  RECONNECT_REQUIRED: "This legacy credential cannot be verified as encrypted. Reconnect the account.",
  NOT_READY: "The credential service is not ready. Restart OpenPCB and retry.",
  FORBIDDEN: "This window cannot access the credential service.",
};

/** Contains only a public code and static message; never wrap an OS error or a secret. */
export class CredentialError extends Error {
  constructor(readonly code: CredentialErrorCode) {
    super(MESSAGES[code]);
    this.name = "CredentialError";
  }
}

export function publicCredentialError(error: unknown): CredentialError {
  return new CredentialError(error instanceof CredentialError && Object.hasOwn(MESSAGES, error.code)
    ? error.code : "NOT_READY");
}

export function isProviderId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
    && !["__proto__", "prototype", "constructor"].includes(value);
}

export function isSecretReference(value: unknown): value is string {
  return typeof value === "string"
    && /^(provider|session)\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
