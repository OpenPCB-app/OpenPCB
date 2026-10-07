import { watch } from "node:fs";
import path from "node:path";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { listCoreReleases, shouldImportBundledRelease } from "./bootstrap";
import { importOpclib } from "./opclib-importer";
import { locateBundledOpclib } from "./package-locator";
import { readOpclibFromPath } from "./opclib-reader";

const startedWatchDirs = new Set<string>();
const DEBOUNCE_MS = 250;

type Timer = ReturnType<typeof setTimeout> & { unref?: () => void };
export interface CoreLibraryDevWatcher { close(): Promise<void>; }
interface WatchHandle {
  close(): void;
  unref(): void;
  on(event: "error" | "close", listener: () => void): unknown;
}
type WatchFactory = (directory: string, listener: () => void) => WatchHandle;

export async function startCoreLibraryDevWatcher(
  ctx: CoreBackendModuleContext,
  initialBundledPath: string | null,
): Promise<CoreLibraryDevWatcher | null> {
  if (process.env.NODE_ENV === "production") return null;
  const bundledPath = initialBundledPath ?? (await locateBundledOpclib());
  if (!bundledPath) return null;

  const watchDir = path.dirname(bundledPath);
  return createCoreLibraryDevWatcher(watchDir, () => importLatestDevPackage(ctx), ctx.logger);
}

export function createCoreLibraryDevWatcher(
  watchDir: string, importLatest: () => Promise<void>, logger: CoreBackendModuleContext["logger"],
  createWatcher: WatchFactory = (directory, listener) => watch(directory, { persistent: false }, listener),
): CoreLibraryDevWatcher | null {
  if (startedWatchDirs.has(watchDir)) return null;
  startedWatchDirs.add(watchDir);
  const queue = createImportQueue(importLatest, logger);
  let closed = false;
  const release = () => {
    if (closed) return;
    closed = true;
    queue.stop();
    startedWatchDirs.delete(watchDir);
  };
  let watcher: WatchHandle;
  try { watcher = createWatcher(watchDir, queue.schedule); } catch (error) { release(); throw error; }
  watcher.on("error", () => {
    release();
    watcher.close();
    logger.warn("core-library: dev watcher stopped after filesystem error");
  });
  watcher.on("close", release);
  watcher.unref();
  logger.info(`core-library: watching bundled package directory ${watchDir}`);
  return { async close() { release(); try { watcher.close(); } finally { await queue.settled(); } } };
}

function createImportQueue(importLatest: () => Promise<void>, logger: CoreBackendModuleContext["logger"]) {
  let timer: Timer | null = null;
  let importing: Promise<void> | null = null;
  let queued = false;
  let closed = false;
  const stop = () => {
    closed = true;
    queued = false;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runImport();
    }, DEBOUNCE_MS) as Timer;
    timer.unref?.();
  };

  const runImport = async (): Promise<void> => {
    if (closed) return;
    if (importing) {
      queued = true;
      return;
    }
    importing = Promise.resolve().then(importLatest).catch((error: unknown) => {
      logger.warn("core-library: live import skipped", {
        error: error instanceof Error ? error.message : String(error),
      });
    }).finally(() => {
      importing = null;
      if (queued) {
        queued = false;
        schedule();
      }
    });
    await importing;
  };
  return { schedule, stop, settled: () => importing };
}

async function importLatestDevPackage(
  ctx: CoreBackendModuleContext,
): Promise<void> {
  const bundledPath = await locateBundledOpclib();
  if (!bundledPath) return;
  const pkg = await readOpclibFromPath(bundledPath);
  if (pkg.manifest.library.id !== "openpcb.core") return;
  if (!shouldImportBundledRelease(listCoreReleases(ctx), pkg)) return;

  const imported = await importOpclib(ctx, pkg, { installOrigin: "bundled" });
  ctx.logger.info(
    `core-library: live-imported ${imported.sourceId}@${imported.version} from ${bundledPath}`,
  );
}
