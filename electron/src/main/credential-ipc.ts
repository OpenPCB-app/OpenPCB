import { Buffer } from "node:buffer";
import { CredentialError, isProviderId, publicCredentialError } from "../../../src/core/contracts/credentials/secret-store.js";
import type { CredentialResult, ProviderCredentialAccess, ProviderCredentialStatus } from "../../../src/core/contracts/credentials/renderer.js";
import { isCloudStorageKey } from "./credential-cloud-storage.js";

interface CredentialFrame { url: string }
interface CredentialContents {
  mainFrame: CredentialFrame;
  isDestroyed(): boolean;
}

export interface CredentialSender {
  sender: CredentialContents;
  senderFrame: CredentialFrame | null;
}

export interface CredentialTrust {
  mainContents(): CredentialContents | null;
  rendererOrigin(): string | null;
}

export interface CredentialIpcRegistrar {
  handle(channel: string, listener: (event: CredentialSender, ...arguments_: unknown[]) => unknown): void;
}

interface CloudStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function requireTrustedCredentialSender(event: CredentialSender, trust: CredentialTrust): void {
  const contents = trust.mainContents();
  const allowedOrigin = trust.rendererOrigin();
  if (!contents || contents.isDestroyed() || event.sender !== contents
    || !event.senderFrame || event.senderFrame !== contents.mainFrame || !allowedOrigin) {
    throw new CredentialError("FORBIDDEN");
  }
  try {
    if (new URL(event.senderFrame.url).origin === new URL(allowedOrigin).origin) return;
  } catch { /* Reject malformed URLs without exposing their content. */ }
  throw new CredentialError("FORBIDDEN");
}

function parseRequest(value: unknown, set: boolean): { providerId: string; apiKey?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CredentialError("INVALID_REQUEST");
  const request = value as Record<string, unknown>;
  const expected = set ? "apiKey,providerId" : "providerId";
  if (Object.keys(request).sort().join() !== expected || !isProviderId(request.providerId)) {
    throw new CredentialError("INVALID_REQUEST");
  }
  if (set && (typeof request.apiKey !== "string" || request.apiKey.length > 16 * 1024
    || !request.apiKey.trim() || Buffer.byteLength(request.apiKey) > 16 * 1024
    || /[\u0000-\u001f\u007f]/.test(request.apiKey))) {
    throw new CredentialError("INVALID_REQUEST");
  }
  return { providerId: request.providerId, ...(set ? { apiKey: request.apiKey as string } : {}) };
}

export async function handleCredentialRequest(
  operation: "set" | "clear" | "status",
  event: CredentialSender,
  arguments_: unknown[],
  trust: CredentialTrust,
  access: ProviderCredentialAccess | null,
): Promise<CredentialResult<ProviderCredentialStatus>> {
  try {
    requireTrustedCredentialSender(event, trust);
    if (arguments_.length !== 1) throw new CredentialError("INVALID_REQUEST");
    const request = parseRequest(arguments_[0], operation === "set");
    if (!access) throw new CredentialError("NOT_READY");
    const value = operation === "set"
      ? await access.set(request.providerId, request.apiKey!)
      : await access[operation](request.providerId);
    if (typeof value?.configured !== "boolean") throw new CredentialError("NOT_READY");
    return { ok: true, value: { configured: value.configured } };
  } catch (error) {
    const safe = publicCredentialError(error);
    return { ok: false, error: { code: safe.code, message: safe.message } };
  }
}

async function handleCloudRequest(
  operation: "get" | "set" | "remove",
  event: CredentialSender,
  arguments_: unknown[],
  trust: CredentialTrust,
  storage: CloudStorage,
): Promise<string | null | void> {
  try {
    requireTrustedCredentialSender(event, trust);
    if (arguments_.length !== (operation === "set" ? 2 : 1) || !isCloudStorageKey(arguments_[0])) {
      throw new CredentialError("INVALID_REQUEST");
    }
    const key = arguments_[0];
    if (operation === "set") {
      const value = arguments_[1];
      if (typeof value !== "string" || !value || value.length > 256 * 1024 || Buffer.byteLength(value) > 256 * 1024) {
        throw new CredentialError("INVALID_REQUEST");
      }
      return await storage.set(key, value);
    }
    return await storage[operation](key);
  } catch (error) {
    throw publicCredentialError(error);
  }
}

export function registerCredentialIpc(
  ipc: CredentialIpcRegistrar,
  trust: CredentialTrust,
  getAccess: () => ProviderCredentialAccess | null,
  cloud: CloudStorage,
): void {
  for (const operation of ["set", "clear", "status"] as const) {
    ipc.handle(`credentials:${operation}`, (event, ...arguments_) =>
      handleCredentialRequest(operation, event, arguments_, trust, getAccess()));
  }
  for (const operation of ["get", "set", "remove"] as const) {
    ipc.handle(`secure-storage:${operation}`, (event, ...arguments_) =>
      handleCloudRequest(operation, event, arguments_, trust, cloud));
  }
}
