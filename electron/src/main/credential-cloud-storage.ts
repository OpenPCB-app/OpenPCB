import { Buffer } from "node:buffer";
import { CredentialError } from "../../../src/core/contracts/credentials/secret-store.js";
import { credentialFiles, type CredentialFileSystem } from "./credential-files.js";
import { CredentialVault, decodeEncryptedSecret, requireEncryption, type CredentialEncryption } from "./credential-vault.js";

// Supabase uses only this app's configured session, PKCE and optional user keys.
const CLOUD_KEYS = new Set(["openpcb.auth", "openpcb.auth-code-verifier", "openpcb.auth-user"]);

export function isCloudStorageKey(value: unknown): value is string {
  return typeof value === "string" && CLOUD_KEYS.has(value);
}

/** Legacy cloud sessions remain renderer-readable; provider/session vault refs never do. */
export class CloudCredentialStorage {
  private readonly vault: CredentialVault;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    path: string,
    private readonly legacyPath: string,
    private readonly encryption: CredentialEncryption,
    private readonly files: CredentialFileSystem = credentialFiles,
  ) {
    this.vault = new CredentialVault(path, encryption, files, isCloudStorageKey);
  }

  get(key: string): Promise<string | null> {
    return this.serialize(async () => {
      this.validate(key);
      const current = await this.vault.lookup(key);
      if (current.present) return current.value;
      const legacy = await this.readLegacy(key);
      if (legacy !== null) {
        await this.vault.set(key, legacy);
        return this.vault.get(key);
      }
      return null;
    });
  }

  set(key: string, value: string): Promise<void> {
    return this.serialize(async () => {
      this.validate(key);
      await this.vault.set(key, value);
    });
  }

  remove(key: string): Promise<void> {
    return this.serialize(async () => {
      this.validate(key);
      await this.vault.delete(key);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private validate(key: string): void {
    if (!isCloudStorageKey(key)) throw new CredentialError("INVALID_REQUEST");
  }

  private async readLegacy(key: string): Promise<string | null> {
    requireEncryption(this.encryption);
    const content = await this.files.read(this.legacyPath);
    if (content === null) return null;
    if (Buffer.byteLength(content) > 4 * 1024 * 1024) throw new CredentialError("RECONNECT_REQUIRED");
    let entries: unknown;
    try { entries = JSON.parse(content); } catch { throw new CredentialError("RECONNECT_REQUIRED"); }
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
      throw new CredentialError("RECONNECT_REQUIRED");
    }
    const value = (entries as Record<string, unknown>)[key];
    if (value === undefined) return null;
    if (typeof value !== "string") throw new CredentialError("RECONNECT_REQUIRED");
    try { return decodeEncryptedSecret(this.encryption, value); }
    catch { throw new CredentialError("RECONNECT_REQUIRED"); }
  }
}
