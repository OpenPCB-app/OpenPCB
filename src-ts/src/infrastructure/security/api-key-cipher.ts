/**
 * API Key Cipher
 *
 * Encrypts provider API keys before storing them in SQLite.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const CIPHER_VERSION = "v1";

function resolveAppDataDir(): string {
  return process.env.APP_DATA_DIR || path.join(process.cwd(), "data");
}

function resolveKeyPath(appDataDir: string): string {
  return path.join(appDataDir, "secrets", "api-keys.key");
}

export class ApiKeyCipher {
  private keyPromise: Promise<CryptoKey>;

  constructor(private keyPath: string = resolveKeyPath(resolveAppDataDir())) {
    this.keyPromise = this.loadOrCreateKey();
  }

  async encrypt(plain: string): Promise<string> {
    const key = await this.keyPromise;
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const data = new TextEncoder().encode(plain);

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      data,
    );

    const ivB64 = Buffer.from(iv).toString("base64");
    const cipherB64 = Buffer.from(cipherBuffer).toString("base64");
    return `${CIPHER_VERSION}:${ivB64}:${cipherB64}`;
  }

  async decrypt(payload: string): Promise<string> {
    if (!payload.startsWith(`${CIPHER_VERSION}:`)) {
      return payload;
    }

    const parts = payload.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid API key payload format");
    }

    const iv = Buffer.from(parts[1]!, "base64");
    const cipherBytes = Buffer.from(parts[2]!, "base64");

    const key = await this.keyPromise;
    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipherBytes,
    );

    return new TextDecoder().decode(plainBuffer);
  }

  private async loadOrCreateKey(): Promise<CryptoKey> {
    if (!crypto?.subtle) {
      throw new Error("WebCrypto not available for API key encryption");
    }

    let keyBytes: Uint8Array;

    try {
      const existing = await fs.readFile(this.keyPath);
      if (existing.length !== KEY_BYTES) {
        throw new Error("Invalid API key encryption key length");
      }
      keyBytes = new Uint8Array(existing);
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as any).code !== "ENOENT") {
        throw error;
      }

      const dir = path.dirname(this.keyPath);
      await fs.mkdir(dir, { recursive: true });
      const generated = randomBytes(KEY_BYTES);
      await fs.writeFile(this.keyPath, generated, { mode: 0o600 });
      if (process.platform !== "win32") {
        try {
          await fs.chmod(this.keyPath, 0o600);
        } catch {
          // Best-effort permission hardening.
        }
      }
      keyBytes = new Uint8Array(generated);
    }

    return crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }
}
