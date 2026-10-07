import { describe, expect, test } from "bun:test";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialError } from "../../src/core/contracts/credentials/secret-store";
import { CloudCredentialStorage } from "../src/main/credential-cloud-storage";
import type { CredentialFileSystem } from "../src/main/credential-files";
import { CredentialVault, createSecretReference, type CredentialEncryption } from "../src/main/credential-vault";

const CANARY = "credential-canary-never-log-this-value";
const PATH = "/test/credential-vault.json";

// This synthetic keychain avoids any access to the test machine's OS credential store.
class SyntheticKeychain implements CredentialEncryption {
  private readonly key = randomBytes(32);
  available = true;
  locked = false;
  denied = false;
  backend = "test_keychain";

  isEncryptionAvailable(): boolean { return this.available; }
  getSelectedStorageBackend(): string { return this.backend; }
  encryptString(value: string): Buffer {
    if (this.denied) throw new Error(CANARY);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  }
  decryptString(value: Buffer): string {
    if (this.locked) throw new Error(CANARY);
    const decipher = createDecipheriv("aes-256-gcm", this.key, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
  }
}

class MemoryFiles implements CredentialFileSystem {
  contents = new Map<string, string>();
  writes = 0;
  fail = false;
  failAfterPublication = false;
  readFailure = false;
  beforePublication: (() => Promise<void>) | null = null;

  async read(path: string): Promise<string | null> {
    if (this.readFailure) throw new Error(CANARY);
    return this.contents.get(path) ?? null;
  }
  async publish(path: string, content: string): Promise<void> {
    this.writes++;
    await this.beforePublication?.();
    if (this.fail) throw new Error(CANARY);
    this.contents.set(path, content);
    if (this.failAfterPublication) throw new Error(CANARY);
  }
}

function fixture(): { encryption: SyntheticKeychain; files: MemoryFiles; vault: CredentialVault; ref: string } {
  const encryption = new SyntheticKeychain();
  const files = new MemoryFiles();
  return { encryption, files, vault: new CredentialVault(PATH, encryption, files), ref: createSecretReference() };
}

describe("trusted credential vault", () => {
  test("survives restart, rotates credentials, lists refs only and deletes durably", async () => {
    const { encryption, files, vault, ref } = fixture();
    await vault.set(ref, CANARY);
    const persisted = files.contents.get(PATH)!;
    expect(persisted).not.toContain(CANARY);
    expect(persisted).not.toContain(Buffer.from(CANARY).toString("base64"));
    const restarted = new CredentialVault(PATH, encryption, files);
    expect(await restarted.get(ref)).toBe(CANARY);
    expect(await restarted.listRefs()).toEqual([ref]);
    await restarted.set(ref, "new-key");
    expect(await new CredentialVault(PATH, encryption, files).get(ref)).toBe("new-key");
    await restarted.delete(ref);
    expect(await new CredentialVault(PATH, encryption, files).get(ref)).toBeNull();
    expect(await restarted.listRefs()).toEqual([]);
  });

  test("does not acknowledge a set before durable publication completes", async () => {
    const { files, vault, ref } = fixture();
    let release = (): void => {};
    files.beforePublication = () => new Promise<void>((resolve) => { release = resolve; });
    let acknowledged = false;
    const pending = vault.set(ref, CANARY).then(() => { acknowledged = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acknowledged).toBe(false);
    expect(files.contents.has(PATH)).toBe(false);
    release();
    await pending;
    expect(acknowledged).toBe(true);
  });

  for (const backend of ["unavailable", "basic_text"]) {
    test(`rejects ${backend} without a plaintext or base64 fallback`, async () => {
      const { encryption, files, vault, ref } = fixture();
      encryption.available = backend !== "unavailable";
      encryption.backend = backend;
      await expect(vault.set(ref, CANARY)).rejects.toMatchObject({ code: "UNAVAILABLE" });
      await expect(vault.get(ref)).rejects.toMatchObject({ code: "UNAVAILABLE" });
      await expect(vault.delete(ref)).rejects.toMatchObject({ code: "UNAVAILABLE" });
      await expect(vault.listRefs()).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(files.writes).toBe(0);
      expect(files.contents.size).toBe(0);
    });
  }

  test("denied encryption and locked decrypt fail with static errors; failed operation does not poison queue", async () => {
    const { encryption, files, vault, ref } = fixture();
    encryption.denied = true;
    const error: unknown = await vault.set(ref, CANARY).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CredentialError);
    expect(String(error)).not.toContain(CANARY);
    expect(files.writes).toBe(0);
    encryption.denied = false;
    await vault.set(ref, CANARY);
    const original = files.contents.get(PATH);
    encryption.locked = true;
    await expect(vault.get(ref)).rejects.toMatchObject({ code: "LOCKED" });
    await expect(vault.set(createSecretReference(), "replacement")).rejects.toMatchObject({ code: "LOCKED" });
    expect(files.contents.get(PATH)).toBe(original);
    encryption.locked = false;
    expect(await vault.get(ref)).toBe(CANARY);
  });

  for (const content of ["{", "null", "[]", '{"format":"unknown","version":1,"entries":{}}',
    '{"format":"openpcb-credential-vault","version":1,"entries":{"__proto__":"invalid"}}',
    '{"format":"openpcb-credential-vault","version":1,"entries":{},"ignored":true}']) {
    test(`refuses corrupt document ${content.slice(0, 32)} without overwriting`, async () => {
      const { files, vault, ref } = fixture();
      files.contents.set(PATH, content);
      await expect(vault.set(ref, CANARY)).rejects.toMatchObject({ code: "CORRUPT" });
      expect(files.contents.get(PATH)).toBe(content);
      expect(files.writes).toBe(0);
    });
  }

  test("future version remains byte-for-byte unchanged", async () => {
    const { files, vault, ref } = fixture();
    const future = '{"format":"openpcb-credential-vault","version":2,"entries":{}}';
    files.contents.set(PATH, future);
    await expect(vault.set(ref, CANARY)).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
    expect(files.contents.get(PATH)).toBe(future);
    expect(files.writes).toBe(0);
  });

  test("corrupt ciphertext and a different OS key never become an empty store", async () => {
    const { encryption, files, vault, ref } = fixture();
    await vault.set(ref, CANARY);
    const original = files.contents.get(PATH)!;
    await expect(new CredentialVault(PATH, new SyntheticKeychain(), files).set(ref, "replacement"))
      .rejects.toMatchObject({ code: "LOCKED" });
    expect(files.contents.get(PATH)).toBe(original);
    const document = JSON.parse(original) as { entries: Record<string, string> };
    document.entries[ref] = Buffer.from("not OS ciphertext").toString("base64");
    const corrupt = JSON.stringify(document);
    files.contents.set(PATH, corrupt);
    await expect(new CredentialVault(PATH, encryption, files).set(ref, "replacement"))
      .rejects.toMatchObject({ code: "LOCKED" });
    expect(files.contents.get(PATH)).toBe(corrupt);
  });

  test("encrypted entries bind their version and opaque reference; swaps are refused before overwrite", async () => {
    const { encryption, files, vault, ref } = fixture();
    const second = createSecretReference();
    await vault.set(ref, CANARY);
    await vault.set(second, "second-key");
    const document = JSON.parse(files.contents.get(PATH)!) as { entries: Record<string, string> };
    document.entries[second] = document.entries[ref]!;
    const swapped = JSON.stringify(document);
    files.contents.set(PATH, swapped);
    await expect(vault.set(ref, "replacement")).rejects.toMatchObject({ code: "CORRUPT" });
    expect(files.contents.get(PATH)).toBe(swapped);
    document.entries[second] = encryption.encryptString(JSON.stringify({ version: 2, reference: second, secret: CANARY })).toString("base64");
    const future = JSON.stringify(document);
    files.contents.set(PATH, future);
    await expect(vault.set(ref, "replacement")).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
    expect(files.contents.get(PATH)).toBe(future);
  });

  test("raw encrypted strings are not accepted as current versioned entries", async () => {
    const { encryption, files, vault, ref } = fixture();
    const content = JSON.stringify({ format: "openpcb-credential-vault", version: 1, entries: {
      [ref]: encryption.encryptString(CANARY).toString("base64"),
    } });
    files.contents.set(PATH, content);
    await expect(vault.set(ref, "replacement")).rejects.toMatchObject({ code: "CORRUPT" });
    expect(files.contents.get(PATH)).toBe(content);
    expect(files.writes).toBe(0);
  });

  test("read errors fail closed without replacing a valid file", async () => {
    const { files, vault, ref } = fixture();
    await vault.set(ref, CANARY);
    const original = files.contents.get(PATH);
    files.readFailure = true;
    await expect(vault.set(ref, "replacement")).rejects.toMatchObject({ code: "CORRUPT" });
    expect(files.contents.get(PATH)).toBe(original);
  });

  test("failed write preserves the prior durable credential; retry works", async () => {
    const { encryption, files, vault, ref } = fixture();
    await vault.set(ref, CANARY);
    const original = files.contents.get(PATH);
    files.fail = true;
    await expect(vault.set(ref, "replacement")).rejects.toMatchObject({ code: "WRITE_FAILED" });
    expect(files.contents.get(PATH)).toBe(original);
    expect(await new CredentialVault(PATH, encryption, files).get(ref)).toBe(CANARY);
    files.fail = false;
    await vault.set(ref, "replacement");
    expect(await vault.get(ref)).toBe("replacement");
  });

  test("failure after publication still rejects acknowledgement and reloads actual disk state", async () => {
    const { encryption, files, vault, ref } = fixture();
    await vault.set(ref, CANARY);
    files.failAfterPublication = true;
    await expect(vault.set(ref, "published-but-not-acknowledged")).rejects.toMatchObject({ code: "WRITE_FAILED" });
    expect(await new CredentialVault(PATH, encryption, files).get(ref)).toBe("published-but-not-acknowledged");
  });

  test("serializes concurrent writes and rotation without lost entries", async () => {
    const { vault, ref } = fixture();
    const refs = Array.from({ length: 24 }, () => createSecretReference());
    await Promise.all(refs.map((reference, index) => vault.set(reference, `key-${index}`)));
    await Promise.all([vault.set(ref, "first"), vault.set(ref, "second"), vault.set(ref, "third")]);
    expect(await vault.get(ref)).toBe("third");
    expect((await vault.listRefs()).length).toBe(25);
    for (const [index, reference] of refs.entries()) expect(await vault.get(reference)).toBe(`key-${index}`);
  });

  test("rejects invalid namespace, non-opaque refs and oversize secrets before writing", async () => {
    const { files, vault, ref } = fixture();
    for (const reference of ["openai", "provider/openai", "cloud/openpcb.auth", "session/../provider", "__proto__"]) {
      await expect(vault.set(reference, CANARY)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
    await expect(vault.set(ref, "x".repeat(256 * 1024 + 1))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(files.writes).toBe(0);
  });

  test("real file persistence uses restrictive permissions and encrypted contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openpcb-credential-test-"));
    try {
      const path = join(directory, "vault.json");
      const encryption = new SyntheticKeychain();
      const reference = createSecretReference();
      await new CredentialVault(path, encryption).set(reference, CANARY);
      expect(await new CredentialVault(path, encryption).get(reference)).toBe(CANARY);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await readFile(path, "utf8")).not.toContain(CANARY);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("isolated Supabase legacy storage", () => {
  function cloudFixture(): { storage: CloudCredentialStorage; encryption: SyntheticKeychain; files: MemoryFiles } {
    const { encryption, files } = fixture();
    return { storage: new CloudCredentialStorage("/test/cloud.json", "/test/secure-store.json", encryption, files), encryption, files };
  }

  test("copies only verified encrypted entries with readback; never alters the legacy file", async () => {
    const { storage, encryption, files } = cloudFixture();
    const legacy = JSON.stringify({ "openpcb.auth": encryption.encryptString(CANARY).toString("base64"), unknown: "untouched" });
    files.contents.set("/test/secure-store.json", legacy);
    expect(await storage.get("openpcb.auth")).toBe(CANARY);
    expect(files.contents.get("/test/secure-store.json")).toBe(legacy);
    expect(files.contents.get("/test/cloud.json")).not.toContain(CANARY);
    expect(await new CloudCredentialStorage("/test/cloud.json", "/test/secure-store.json", encryption, files)
      .get("openpcb.auth")).toBe(CANARY);
  });

  test("uncertain base64/plaintext demands reconnect, stays untouched, permits explicit new encrypted login", async () => {
    const { storage, files } = cloudFixture();
    const legacy = JSON.stringify({ "openpcb.auth": Buffer.from(CANARY).toString("base64") });
    files.contents.set("/test/secure-store.json", legacy);
    await expect(storage.get("openpcb.auth")).rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
    expect(files.writes).toBe(0);
    await storage.set("openpcb.auth", "new-login");
    expect(await storage.get("openpcb.auth")).toBe("new-login");
    expect(files.contents.get("/test/secure-store.json")).toBe(legacy);
  });

  test("interrupted migration retains its only valid copy", async () => {
    const { storage, encryption, files } = cloudFixture();
    const legacy = JSON.stringify({ "openpcb.auth": encryption.encryptString(CANARY).toString("base64") });
    files.contents.set("/test/secure-store.json", legacy);
    files.fail = true;
    await expect(storage.get("openpcb.auth")).rejects.toMatchObject({ code: "WRITE_FAILED" });
    expect(files.contents.get("/test/secure-store.json")).toBe(legacy);
    expect(files.contents.has("/test/cloud.json")).toBe(false);
    files.fail = false;
    expect(await storage.get("openpcb.auth")).toBe(CANARY);
  });

  test("delete tombstones stop legacy credential resurrection after restart", async () => {
    const { storage, encryption, files } = cloudFixture();
    const legacy = JSON.stringify({ "openpcb.auth": encryption.encryptString(CANARY).toString("base64") });
    files.contents.set("/test/secure-store.json", legacy);
    await Promise.all([storage.get("openpcb.auth"), storage.remove("openpcb.auth")]);
    expect(await new CloudCredentialStorage("/test/cloud.json", "/test/secure-store.json", encryption, files)
      .get("openpcb.auth")).toBeNull();
    expect(files.contents.get("/test/secure-store.json")).toBe(legacy);
  });

  test("cannot read, write or delete provider or SIWC refs", async () => {
    const { storage, files } = cloudFixture();
    for (const reference of [createSecretReference(), createSecretReference("session"), "openpcb.auth-arbitrary"]) {
      await expect(storage.get(reference)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(storage.set(reference, CANARY)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(storage.remove(reference)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect(files.writes).toBe(0);
  });
});
