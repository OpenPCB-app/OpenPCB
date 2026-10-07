import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createCoreLibraryDevWatcher } from "../../../modules/library/backend/sync/core-library-dev-watch";

class Watcher extends EventEmitter {
  closes = 0;
  close() { this.closes++; this.emit("close"); }
  unref() {}
}

function fixture(directory: string, importer: () => Promise<void> = async () => {}) {
  const watcher = new Watcher();
  let notify = () => {};
  const warnings: string[] = [];
  const logger = { debug: () => {}, info: () => {}, error: () => {}, warn: (message: string) => { warnings.push(message); } };
  const factory = (_directory: string, listener: () => void) => { notify = listener; return watcher; };
  const managed = createCoreLibraryDevWatcher(directory, importer, logger, factory)!;
  return { watcher, managed, logger, factory, notify: () => notify(), warnings };
}

describe("library development watcher lifecycle", () => {
  test("asynchronous EMFILE stops the watcher without escaping error event", async () => {
    const f = fixture("/synthetic/EMFILE");
    f.notify();
    expect(() => f.watcher.emit("error", Object.assign(new Error("too many open files"), { code: "EMFILE" }))).not.toThrow();
    expect(f.watcher.closes).toBe(1);
    expect(f.warnings).toEqual(["core-library: dev watcher stopped after filesystem error"]);
    const next = fixture("/synthetic/EMFILE");
    await f.managed.close();
    expect(createCoreLibraryDevWatcher("/synthetic/EMFILE", async () => {}, next.logger, next.factory)).toBeNull();
    await next.managed.close();
  });

  test("failed creation and normal close release directory ownership", async () => {
    const logger = fixture("/synthetic/logger");
    expect(() => createCoreLibraryDevWatcher("/synthetic/create-failure", async () => {}, logger.logger,
      () => { throw new Error("EMFILE"); })).toThrow("EMFILE");
    const retry = fixture("/synthetic/create-failure");
    await retry.managed.close();
    const next = fixture("/synthetic/create-failure");
    await next.managed.close();
    await logger.managed.close();
  });

  test("close clears queued import and awaits already-running import before domain DB may close", async () => {
    let finish = () => {};
    let calls = 0;
    let settled = false;
    const importing = new Promise<void>((resolve) => { finish = resolve; });
    const f = fixture("/synthetic/pending", () => { calls++; return importing; });
    f.notify();
    await new Promise((resolve) => setTimeout(resolve, 280));
    expect(calls).toBe(1);
    f.notify();
    const closing = f.managed.close().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await closing;
    f.notify();
    await new Promise((resolve) => setTimeout(resolve, 280));
    expect(calls).toBe(1);
  });
});
