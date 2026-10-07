import { open, rename, unlink } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CredentialError } from "../../../src/core/contracts/credentials/secret-store.js";

export interface CredentialFileSystem {
  read(path: string): Promise<string | null>;
  publish(path: string, content: string): Promise<void>;
}

export interface DurableFileHandle {
  writeFile(content: string, encoding: "utf8"): Promise<unknown>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicFileOperations {
  open(path: string, flags: string, mode?: number): Promise<DurableFileHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const operations: AtomicFileOperations = { open, rename, unlink };
export const MAX_CREDENTIAL_FILE_BYTES = 4 * 1024 * 1024;

/** Acknowledgement includes both file contents and the directory entry publication. */
export async function publishCredentialFile(
  path: string,
  content: string,
  files: AtomicFileOperations = operations,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle: DurableFileHandle | null = null;
  let directory: DurableFileHandle | null = null;
  try {
    handle = await files.open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await files.rename(temporary, path);
    directory = await files.open(dirname(path), "r");
    await directory.sync();
    await directory.close();
    directory = null;
  } catch {
    throw new CredentialError("WRITE_FAILED");
  } finally {
    await handle?.close().catch(() => undefined);
    await directory?.close().catch(() => undefined);
    await files.unlink(temporary).catch(() => undefined);
  }
}

export const credentialFiles: CredentialFileSystem = {
  async read(path) {
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(path, "r");
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_CREDENTIAL_FILE_BYTES) throw new CredentialError("CORRUPT");
      const buffer = Buffer.alloc(metadata.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > metadata.size) throw new CredentialError("CORRUPT");
      return buffer.subarray(0, offset).toString("utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw new CredentialError("CORRUPT");
    } finally {
      await handle?.close().catch(() => undefined);
    }
  },
  publish: publishCredentialFile,
};
