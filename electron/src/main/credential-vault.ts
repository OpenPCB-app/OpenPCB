import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { CredentialError, isSecretReference, type SecretStore } from "../../../src/core/contracts/credentials/secret-store.js";
import { credentialFiles, MAX_CREDENTIAL_FILE_BYTES, type CredentialFileSystem } from "./credential-files.js";

export interface CredentialEncryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface VaultDocument {
  format: "openpcb-credential-vault";
  version: 1;
  entries: Record<string, string | null>;
}

const MAX_SECRET_BYTES = 256 * 1024;

export function createSecretReference(namespace: "provider" | "session" = "provider"): string {
  return `${namespace}/${randomUUID()}`;
}

export function requireEncryption(encryption: CredentialEncryption): void {
  try {
    if (encryption.isEncryptionAvailable()
      && encryption.getSelectedStorageBackend?.() !== "basic_text") return;
  } catch {
    throw new CredentialError("UNAVAILABLE");
  }
  throw new CredentialError("UNAVAILABLE");
}

export function decodeEncryptedSecret(encryption: CredentialEncryption, value: string): string {
  requireEncryption(encryption);
  if (!value || Buffer.from(value, "base64").toString("base64") !== value) {
    throw new CredentialError("CORRUPT");
  }
  try {
    return encryption.decryptString(Buffer.from(value, "base64"));
  } catch {
    throw new CredentialError("LOCKED");
  }
}

function parseDocument(content: string, validReference: (value: unknown) => boolean): VaultDocument {
  if (Buffer.byteLength(content) > MAX_CREDENTIAL_FILE_BYTES) throw new CredentialError("CORRUPT");
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { throw new CredentialError("CORRUPT"); }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new CredentialError("CORRUPT");
  const value = raw as Record<string, unknown>;
  if (value.format !== "openpcb-credential-vault") throw new CredentialError("CORRUPT");
  if (typeof value.version === "number" && value.version > 1) throw new CredentialError("UNSUPPORTED_FORMAT");
  if (value.version !== 1 || Object.keys(value).sort().join() !== "entries,format,version"
    || typeof value.entries !== "object" || value.entries === null || Array.isArray(value.entries)) {
    throw new CredentialError("CORRUPT");
  }
  const entries = value.entries as Record<string, unknown>;
  if (Object.keys(entries).length > 4096 || Object.entries(entries).some(
    ([key, entry]) => !validReference(key) || (entry !== null && typeof entry !== "string"),
  )) throw new CredentialError("CORRUPT");
  return value as unknown as VaultDocument;
}

function decodeVaultEntry(encryption: CredentialEncryption, reference: string, encrypted: string): string {
  const plaintext = decodeEncryptedSecret(encryption, encrypted);
  let decoded: unknown;
  try { decoded = JSON.parse(plaintext); } catch { throw new CredentialError("CORRUPT"); }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw new CredentialError("CORRUPT");
  const entry = decoded as Record<string, unknown>;
  if (typeof entry.version === "number" && entry.version > 1) throw new CredentialError("UNSUPPORTED_FORMAT");
  if (entry.version !== 1 || entry.reference !== reference || typeof entry.secret !== "string"
    || !entry.secret || Buffer.byteLength(entry.secret) > MAX_SECRET_BYTES
    || Object.keys(entry).sort().join() !== "reference,secret,version") throw new CredentialError("CORRUPT");
  return entry.secret;
}

/** No decrypted cache: failed publication and keychain locks remain observable on each operation. */
export class CredentialVault implements SecretStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly encryption: CredentialEncryption,
    private readonly files: CredentialFileSystem = credentialFiles,
    private readonly validReference: (value: unknown) => boolean = isSecretReference,
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async load(): Promise<VaultDocument> {
    requireEncryption(this.encryption);
    let content: string | null;
    try { content = await this.files.read(this.path); }
    catch { throw new CredentialError("CORRUPT"); }
    if (content === null) return { format: "openpcb-credential-vault", version: 1, entries: {} };
    const document = parseDocument(content, this.validReference);
    for (const [reference, encrypted] of Object.entries(document.entries)) {
      if (encrypted !== null) decodeVaultEntry(this.encryption, reference, encrypted);
    }
    return document;
  }

  lookup(reference: string): Promise<{ present: boolean; value: string | null }> {
    return this.serialize(async () => {
      this.validateReference(reference);
      const document = await this.load();
      const entry = document.entries[reference];
      return {
        present: Object.hasOwn(document.entries, reference),
        value: entry == null ? null : decodeVaultEntry(this.encryption, reference, entry),
      };
    });
  }

  async get(reference: string): Promise<string | null> {
    return (await this.lookup(reference)).value;
  }

  set(reference: string, secret: string): Promise<void> {
    return this.serialize(async () => {
      this.validateReference(reference);
      if (typeof secret !== "string" || !secret || secret.length > MAX_SECRET_BYTES || Buffer.byteLength(secret) > MAX_SECRET_BYTES) {
        throw new CredentialError("INVALID_REQUEST");
      }
      const document = await this.load();
      let encrypted: string;
      try {
        encrypted = this.encryption.encryptString(JSON.stringify({ version: 1, reference, secret })).toString("base64");
        if (decodeVaultEntry(this.encryption, reference, encrypted) !== secret) throw new Error();
      } catch { throw new CredentialError("LOCKED"); }
      document.entries[reference] = encrypted;
      await this.publish(document);
      if ((await this.load()).entries[reference] !== encrypted) throw new CredentialError("WRITE_FAILED");
    });
  }

  delete(reference: string): Promise<void> {
    return this.serialize(async () => {
      this.validateReference(reference);
      const document = await this.load();
      // Tombstones prevent deleted legacy cloud credentials from being resurrected on restart.
      document.entries[reference] = null;
      await this.publish(document);
      if ((await this.load()).entries[reference] !== null) throw new CredentialError("WRITE_FAILED");
    });
  }

  private validateReference(reference: string): void {
    if (!this.validReference(reference)) throw new CredentialError("INVALID_REQUEST");
  }

  listRefs(): Promise<string[]> {
    return this.serialize(async () => Object.entries((await this.load()).entries)
      .filter(([, encrypted]) => encrypted !== null).map(([reference]) => reference));
  }

  private async publish(document: VaultDocument): Promise<void> {
    const content = JSON.stringify(document);
    if (Object.keys(document.entries).length > 4096 || Buffer.byteLength(content) > MAX_CREDENTIAL_FILE_BYTES) {
      throw new CredentialError("WRITE_FAILED");
    }
    try { await this.files.publish(this.path, content); }
    catch { throw new CredentialError("WRITE_FAILED"); }
  }
}
