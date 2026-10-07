import type { LocalApiBootstrap } from "../../../src/core/contracts/security/local-api.js";
import { requireTrustedCredentialSender, type CredentialIpcRegistrar, type CredentialSender, type CredentialTrust } from "./credential-ipc.js";

export function handleLocalApiBootstrap(
  event: CredentialSender,
  arguments_: unknown[],
  trust: CredentialTrust,
  getBootstrap: () => LocalApiBootstrap | null,
): LocalApiBootstrap | null {
  try {
    requireTrustedCredentialSender(event, trust);
    if (arguments_.length !== 0) return null;
    const bootstrap = getBootstrap();
    return bootstrap ? { url: bootstrap.url, token: bootstrap.token } : null;
  } catch { return null; }
}

export function registerLocalApiIpc(
  ipc: CredentialIpcRegistrar,
  trust: CredentialTrust,
  getBootstrap: () => LocalApiBootstrap | null,
): void {
  ipc.handle("local-api:bootstrap", (event, ...arguments_) =>
    handleLocalApiBootstrap(event, arguments_, trust, getBootstrap));
}
