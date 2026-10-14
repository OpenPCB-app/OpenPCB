import { ValidationError } from "../../../../core/contracts/errors";

/** Kinds that existing user databases may still hold but no runtime executes. */
export const RETIRED_PROVIDER_KINDS: ReadonlySet<string> = new Set(["openpcb-cloud"]);

export type ProviderSelectionReason =
  | "provider_unsupported"
  | "provider_disabled"
  | "provider_missing_key"
  | "provider_retired"
  | "provider_not_selected"
  | "provider_offline"
  | "model_not_available";

/** A run never falls back to another provider; each refusal names its own cause. */
export class ProviderSelectionError extends ValidationError {
  constructor(readonly reason: ProviderSelectionReason, message: string) {
    super(message, { reason });
    this.name = "ProviderSelectionError";
  }
}

export function retiredProviderError(label: string): ProviderSelectionError {
  return new ProviderSelectionError("provider_retired",
    `Provider '${label}' has been retired. Choose another provider in Assistant settings.`);
}

/** Undici reports a refused socket as `fetch failed` with the errno on a nested cause. */
export function isConnectionRefused(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 4) return false;
  if ("code" in error && error.code === "ECONNREFUSED") return true;
  if ("errors" in error && Array.isArray(error.errors)
    && error.errors.some((inner: unknown) => isConnectionRefused(inner, depth + 1))) return true;
  return "cause" in error && isConnectionRefused(error.cause, depth + 1);
}
