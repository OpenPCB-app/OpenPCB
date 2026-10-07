import { describe, expect, test } from "bun:test";
import { mkdtemp, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { credentialFiles, MAX_CREDENTIAL_FILE_BYTES, publishCredentialFile, type AtomicFileOperations, type DurableFileHandle } from "../src/main/credential-files";

function injectedFiles(failure: string | null, events: string[]): AtomicFileOperations {
  let failed = false;
  function stage(name: string): void {
    events.push(name);
    if (failure === name && !failed) {
      failed = true;
      throw new Error("sensitive OS failure detail must not escape");
    }
  }
  return {
    async open(path, flags, mode): Promise<DurableFileHandle> {
      const directory = flags === "r";
      stage(directory ? "open-directory" : "open-file");
      const handle = await open(path, flags, mode);
      return {
        async writeFile(content, encoding) { stage("write"); await handle.writeFile(content, encoding); },
        async sync() { stage(directory ? "sync-directory" : "sync-file"); await handle.sync(); },
        async close() { stage(directory ? "close-directory" : "close-file"); await handle.close(); },
      };
    },
    async rename(from, to) { stage("rename"); await rename(from, to); },
    unlink,
  };
}

describe("atomic durable credential publication", () => {
  test("orders write/fsync/rename/directory fsync; sets mode 0600", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openpcb-atomic-test-"));
    try {
      const path = join(directory, "vault.json");
      const events: string[] = [];
      await publishCredentialFile(path, "ciphertext", injectedFiles(null, events));
      expect(events).toEqual(["open-file", "write", "sync-file", "close-file", "rename", "open-directory", "sync-directory", "close-directory"]);
      expect(await readFile(path, "utf8")).toBe("ciphertext");
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await readdir(directory)).toEqual(["vault.json"]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  for (const failure of ["open-file", "write", "sync-file", "close-file", "rename", "open-directory", "sync-directory", "close-directory"]) {
    test(`rejects ${failure}, cleans temp file, preserves last valid complete file`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "openpcb-atomic-test-"));
      try {
        const path = join(directory, "vault.json");
        await writeFile(path, "previous ciphertext", { mode: 0o600 });
        const events: string[] = [];
        await expect(publishCredentialFile(path, "replacement ciphertext", injectedFiles(failure, events)))
          .rejects.toMatchObject({ code: "WRITE_FAILED" });
        const published = events.includes("open-directory");
        expect(await readFile(path, "utf8")).toBe(published ? "replacement ciphertext" : "previous ciphertext");
        expect(await readdir(directory)).toEqual(["vault.json"]);
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
  }

  test("an interrupted orphan temp file is not adopted or used to replace the target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openpcb-atomic-test-"));
    try {
      const path = join(directory, "vault.json");
      await writeFile(path, "durable ciphertext", { mode: 0o600 });
      await writeFile(`${path}.interrupted.tmp`, "partial ciphertext", { mode: 0o600 });
      await expect(publishCredentialFile(path, "new ciphertext", injectedFiles("rename", [])))
        .rejects.toMatchObject({ code: "WRITE_FAILED" });
      expect(await readFile(path, "utf8")).toBe("durable ciphertext");
      expect(await readFile(`${path}.interrupted.tmp`, "utf8")).toBe("partial ciphertext");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("missing files are distinct from unreadable/oversized files and non-files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openpcb-atomic-test-"));
    try {
      const path = join(directory, "vault.json");
      expect(await credentialFiles.read(path)).toBeNull();
      await expect(credentialFiles.read(directory)).rejects.toMatchObject({ code: "CORRUPT" });
      await writeFile(path, "x".repeat(MAX_CREDENTIAL_FILE_BYTES + 1), { mode: 0o600 });
      await expect(credentialFiles.read(path)).rejects.toMatchObject({ code: "CORRUPT" });
      expect((await stat(path)).size).toBe(MAX_CREDENTIAL_FILE_BYTES + 1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
