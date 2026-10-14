import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export interface DurableRecord {
  readonly token: string;
  readonly value: string;
}

export interface RecordWrite extends DurableRecord {
  readonly key: string;
  readonly expectedToken: string | null;
}

interface Envelope extends DurableRecord {
  readonly version: 1;
  readonly key: string;
  readonly checksum: string;
}

type FileSystem = Pick<
  typeof fs,
  "mkdir" | "lstat" | "open" | "rename" | "unlink" | "readdir"
>;
const MAX_VALUE_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 2 * MAX_VALUE_BYTES + 4096;
const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const checksum = (record: DurableRecord & { key: string }): string =>
  hash(JSON.stringify([1, record.key, record.token, record.value]));
const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

function boundedString(
  value: unknown,
  bytes: number,
  name: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value) > bytes
  )
    throw new Error(`Invalid record ${name}`);
}

function validateWrite(input: RecordWrite): void {
  boundedString(input.key, 512, "key");
  boundedString(input.token, 128, "token");
  if (input.expectedToken !== null)
    boundedString(input.expectedToken, 128, "expected token");
  boundedString(input.value, MAX_VALUE_BYTES, "value");
  JSON.parse(input.value);
}

function decode(text: string, filename: string): Envelope {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object")
    throw new Error("Unrecognized record envelope");
  const record = data as Partial<Envelope>;
  if (
    record.version !== 1 ||
    Object.keys(record).sort().join() !== "checksum,key,token,value,version"
  )
    throw new Error("Unsupported record envelope; retained unchanged");
  boundedString(record.key, 512, "key");
  boundedString(record.token, 128, "token");
  boundedString(record.value, MAX_VALUE_BYTES, "value");
  JSON.parse(record.value);
  const recognized = record as Envelope;
  if (
    filename !== `${hash(recognized.key)}.json` ||
    record.checksum !== checksum(recognized)
  )
    throw new Error("Record integrity mismatch; retained unchanged");
  return recognized;
}

/** Single-process storage. The caller must own the directory and exclude other writers. */
export class AtomicRecordStore {
  private queues = new Map<string, Promise<unknown>>();
  private ready: Promise<void> | undefined;

  constructor(
    private directory: string,
    private io: FileSystem = fs,
  ) {
    if (!isAbsolute(directory))
      throw new Error("Record directory must be absolute");
  }

  private async syncDirectory(directory = this.directory): Promise<void> {
    const handle = await this.io.open(
      directory,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async prepare(): Promise<void> {
    try {
      await this.io.mkdir(this.directory, { mode: 0o700 });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
    }
    const stat = await this.io.lstat(this.directory);
    if (!stat.isDirectory() || (stat.mode & 0o077) !== 0)
      throw new Error("Record directory must be private and not a symlink");
    // A new directory entry must survive restart before records can be acknowledged.
    await this.syncDirectory(dirname(this.directory));
  }

  private async initialized(): Promise<void> {
    this.ready ??= this.prepare().catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    await this.ready;
  }

  private serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    boundedString(key, 512, "key");
    const next = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        await this.initialized();
        return operation();
      });
    this.queues.set(key, next);
    const clean = (): void => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    };
    void next.then(clean, clean);
    return next;
  }

  private async load(filename: string): Promise<Envelope | null> {
    let handle: Awaited<ReturnType<FileSystem["open"]>>;
    try {
      const stat = await this.io.lstat(join(this.directory, filename));
      if (!stat.isFile() || stat.size > MAX_RECORD_BYTES)
        throw new Error("Invalid record file; retained unchanged");
      handle = await this.io.open(
        join(this.directory, filename),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_RECORD_BYTES)
        throw new Error("Invalid record file; retained unchanged");
      return decode(await handle.readFile("utf8"), filename);
    } finally {
      await handle.close();
    }
  }

  read(key: string): Promise<DurableRecord | null> {
    return this.serialized(key, async () => {
      const record = await this.load(`${hash(key)}.json`);
      return record ? { token: record.token, value: record.value } : null;
    });
  }

  write(input: RecordWrite): Promise<DurableRecord> {
    validateWrite(input);
    const record = { ...input };
    return this.serialized(record.key, async () => {
      const filename = `${hash(record.key)}.json`;
      const previous = await this.load(filename);
      if (previous?.token === record.token && previous.value === record.value) {
        await this.syncDirectory();
        return { token: record.token, value: record.value };
      }
      if (
        (previous?.token ?? null) !== record.expectedToken ||
        previous?.token === record.token
      )
        throw new Error("Record conflict; existing draft retained");
      const envelope: Envelope = {
        version: 1,
        key: record.key,
        token: record.token,
        value: record.value,
        checksum: checksum(record),
      };
      await this.publish(filename, JSON.stringify(envelope));
      return { token: record.token, value: record.value };
    });
  }

  private async publish(filename: string, text: string): Promise<void> {
    const temporary = join(this.directory, `${filename}.${randomUUID()}.tmp`);
    const handle = await this.io.open(temporary, "wx", 0o600);
    try {
      try {
        await handle.writeFile(text, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.io.rename(temporary, join(this.directory, filename));
      await this.syncDirectory();
    } finally {
      // Only this attempt's unpublished temporary file may be removed.
      await this.io.unlink(temporary).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
    }
  }

  remove(input: { key: string; expectedToken: string }): Promise<boolean> {
    boundedString(input.expectedToken, 128, "expected token");
    const { key, expectedToken } = input;
    return this.serialized(key, async () => {
      const filename = `${hash(key)}.json`;
      const record = await this.load(filename);
      if (record && record.token !== expectedToken)
        throw new Error("Record conflict; newer draft retained");
      if (record) await this.io.unlink(join(this.directory, filename));
      await this.syncDirectory();
      return record !== null;
    });
  }

  async list(): Promise<{
    records: Array<{ key: string; token: string }>;
    unreadableCount: number;
  }> {
    await this.initialized();
    const records: Array<{ key: string; token: string }> = [];
    let unreadableCount = 0;
    for (const filename of (await this.io.readdir(this.directory)).sort()) {
      if (!filename.endsWith(".json")) {
        unreadableCount++;
        continue;
      }
      try {
        const record = await this.load(filename);
        if (record) records.push({ key: record.key, token: record.token });
      } catch {
        unreadableCount++;
      }
    }
    return { records, unreadableCount };
  }
}
