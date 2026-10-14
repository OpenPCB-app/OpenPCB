import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AtomicRecordStore } from "../storage/atomic-record-store";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "openpcb-record-store-"));
  roots.push(root);
  const directory = join(root, "records");
  return { root, directory, store: new AtomicRecordStore(directory) };
}

const filename = (directory: string, key: string): string =>
  join(directory, `${createHash("sha256").update(key).digest("hex")}.json`);
const draft = (
  key = "page",
  token = "first",
  expectedToken: string | null = null,
) => ({
  key,
  token,
  expectedToken,
  value: JSON.stringify({ body: `Draft ${token}` }),
});

test("atomic JSON records survive a new store and have private modes", async () => {
  const { directory, store } = await fixture();
  expect(await store.read("page")).toBeNull();
  const input = draft();
  expect(await store.write(input)).toEqual({
    token: input.token,
    value: input.value,
  });
  expect(await new AtomicRecordStore(directory).read("page")).toEqual({
    token: input.token,
    value: input.value,
  });
  expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
  expect((await fs.stat(filename(directory, "page"))).mode & 0o777).toBe(0o600);
  expect(await store.list()).toEqual({
    records: [{ key: "page", token: "first" }],
    unreadableCount: 0,
  });
});

test("concurrent compare-and-swap has one winner and never silently overwrites", async () => {
  const { store } = await fixture();
  await store.write(draft());
  const results = await Promise.allSettled([
    store.write(draft("page", "second", "first")),
    store.write(draft("page", "third", "first")),
  ]);
  expect(results.map((result) => result.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect((await store.read("page"))?.token).toBe("second");
  await expect(
    store.remove({ key: "page", expectedToken: "first" }),
  ).rejects.toThrow("newer draft retained");
  expect(await store.remove({ key: "page", expectedToken: "second" })).toBe(
    true,
  );
  expect(await store.remove({ key: "page", expectedToken: "second" })).toBe(
    false,
  );
});

test("identical operation replay is idempotent but token reuse with new contents is rejected", async () => {
  const { store } = await fixture();
  const input = draft();
  await store.write(input);
  expect(await store.write(input)).toEqual({
    token: input.token,
    value: input.value,
  });
  await expect(
    store.write({ ...input, expectedToken: "first", value: "{}" }),
  ).rejects.toThrow("conflict");
  expect((await store.read("page"))?.value).toBe(input.value);
});

test("keys are opaque, path characters cannot escape storage, and namespaces stay distinct", async () => {
  const { root, directory, store } = await fixture();
  for (const key of ["../escaped", "a/b", "a\\b", "__proto__", "雪\u0000page"])
    await store.write(draft(key));
  expect(await fs.readdir(root)).toEqual(["records"]);
  expect(
    (await fs.readdir(directory)).every((name) =>
      /^[a-f0-9]{64}\.json$/.test(name),
    ),
  ).toBe(true);
  expect((await store.list()).records).toHaveLength(5);
});

for (const corrupt of ["{", '{"version":2,"unknown":"retain"}', "null"]) {
  test(`unrecognized file remains byte-identical on read/write/remove: ${corrupt}`, async () => {
    const { directory, store } = await fixture();
    await store.read("page");
    const file = filename(directory, "page");
    await fs.writeFile(file, corrupt, { mode: 0o600 });
    await expect(store.read("page")).rejects.toThrow();
    await expect(store.write(draft())).rejects.toThrow();
    await expect(
      store.remove({ key: "page", expectedToken: "first" }),
    ).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe(corrupt);
    expect(await store.list()).toEqual({ records: [], unreadableCount: 1 });
  });
}

test("checksum modification and moving a valid file to a different key are refused", async () => {
  const { directory, store } = await fixture();
  await store.write(draft());
  const bytes = await fs.readFile(filename(directory, "page"), "utf8");
  await fs.writeFile(filename(directory, "another"), bytes);
  await expect(store.read("another")).rejects.toThrow("integrity mismatch");
  await fs.writeFile(
    filename(directory, "page"),
    bytes.replace("Draft first", "Draft other"),
  );
  await expect(store.read("page")).rejects.toThrow("integrity mismatch");
  expect((await store.list()).unreadableCount).toBe(2);
});

test("symlink record and symlink directory never follow or overwrite their target", async () => {
  const { root, directory, store } = await fixture();
  await store.read("page");
  const target = join(root, "original.json");
  await fs.writeFile(target, "original data");
  await fs.symlink(target, filename(directory, "page"));
  await expect(store.write(draft())).rejects.toThrow();
  await expect(
    store.remove({ key: "page", expectedToken: "first" }),
  ).rejects.toThrow();
  expect(await fs.readFile(target, "utf8")).toBe("original data");
  const link = join(root, "linked-records");
  await fs.symlink(directory, link);
  await expect(new AtomicRecordStore(link).read("page")).rejects.toThrow(
    "not a symlink",
  );
});

test("invalid and excessive inputs fail without creating any record", async () => {
  const { store } = await fixture();
  for (const input of [
    { ...draft(), key: "" },
    { ...draft(), key: "雪".repeat(171) },
    { ...draft(), token: "x".repeat(129) },
    { ...draft(), expectedToken: "" },
    { ...draft(), value: "invalid JSON" },
    { ...draft(), value: JSON.stringify("x".repeat(16 * 1024 * 1024)) },
  ])
    expect(() => store.write(input)).toThrow();
  expect(await store.list()).toEqual({ records: [], unreadableCount: 0 });
  expect(() => new AtomicRecordStore("relative")).toThrow("absolute");
});

test.skipIf(process.platform === "win32")(
  "a FIFO is refused before an open can wait for a writer",
  async () => {
    const { directory, store } = await fixture();
    await store.read("page");
    const file = filename(directory, "page");
    execFileSync("mkfifo", [file]);
    await expect(store.read("page")).rejects.toThrow("Invalid record file");
    expect((await fs.lstat(file)).isFIFO()).toBe(true);
  },
);

for (const step of ["file-sync", "rename", "directory-sync"] as const) {
  test(`failed ${step} never falsely acknowledges and exact retry is safe`, async () => {
    const { directory, store } = await fixture();
    await store.write(draft());
    let failed = false;
    const io: ConstructorParameters<typeof AtomicRecordStore>[1] = {
      ...fs,
      rename: async (...args) => {
        if (step === "rename" && !failed) {
          failed = true;
          throw new Error("injected rename failure");
        }
        return fs.rename(...args);
      },
      open: async (path, flags, mode) => {
        const handle = await fs.open(path, flags, mode);
        if (
          (step === "file-sync" && flags === "wx") ||
          (step === "directory-sync" && path === directory)
        ) {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            if (!failed) {
              failed = true;
              throw new Error("injected sync failure");
            }
            return sync();
          };
        }
        return handle;
      },
    };
    const failing = new AtomicRecordStore(directory, io);
    const update = draft("page", "second", "first");
    await expect(failing.write(update)).rejects.toThrow("injected");
    expect(failed).toBe(true);
    expect((await store.read("page"))?.token).toBe(
      step === "directory-sync" ? "second" : "first",
    );
    expect(
      (await fs.readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    await failing.write(update);
    expect((await new AtomicRecordStore(directory).read("page"))?.token).toBe(
      "second",
    );
  });
}

test("failed conditional removal is reported and does not discard a different record", async () => {
  const { directory, store } = await fixture();
  await store.write(draft());
  const failing = new AtomicRecordStore(directory, {
    ...fs,
    unlink: async () => {
      throw new Error("disk denied");
    },
  });
  await expect(
    failing.remove({ key: "page", expectedToken: "first" }),
  ).rejects.toThrow("disk denied");
  expect((await store.read("page"))?.token).toBe("first");
});
