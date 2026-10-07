import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StartedBackendRuntime } from "../../src/core/backend/runtime";
import type { ModuleRegistryResponse } from "../../src/core/contracts/modules/registry";

const requiredModules = ["library", "designer", "assistant"];
const savedEnvironment = { ...process.env };
let userData = "";
let snapshot: ModuleRegistryResponse;
let startupFailure: Error | null = null;
let publicationFailure: Error | null = null;
let cleanupFailure: Error | null = null;
const close = mock(async (): Promise<void> => {
  if (cleanupFailure) throw cleanupFailure;
});
const disposeWorker = mock(async (): Promise<void> => {
  if (cleanupFailure) throw cleanupFailure;
});
const start = mock(async (): Promise<StartedBackendRuntime> => {
  if (startupFailure) throw startupFailure;
  return { host: "127.0.0.1", port: 43123, url: "http://127.0.0.1:43123", snapshot, close };
});
const send = mock((): void => {});
const writePortfile = mock((): void => {
  if (publicationFailure) throw publicationFailure;
});
const removePortfile = mock((): void => {});
const resetDatabase = mock((): void => {});
const captureException = mock((): void => {});
const setWorkerEntry = mock((): void => {});
const configureCredentials = mock((): void => {});
const secretStore = {
  get: async () => null,
  set: async () => {},
  delete: async () => {},
  listRefs: async () => [],
};

mock.module("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => userData,
    getAppPath: () => join(import.meta.dir, ".."),
    getVersion: () => "startup-test",
  },
  BrowserWindow: { getAllWindows: () => [{ webContents: { send } }] },
}));
mock.module("../src/main/logger.js", () => ({
  log: { scope: () => ({ info: () => {}, warn: () => {} }) },
}));
mock.module("../src/main/sentry.js", () => ({ Sentry: { captureException } }));
mock.module("../src/main/preferences.js", () => ({ getTelemetryOptIn: () => false }));
mock.module("../src/main/credential-runtime.js", () => ({
  getCredentialSecretStore: () => secretStore,
  configureProviderCredentials: configureCredentials,
}));
mock.module("../../src/core/backend/runtime", () => ({ startBackendRuntime: start }));
mock.module("../../src/core/backend/db/sqlite-client", () => ({ resetSharedSqlite: resetDatabase }));
mock.module("../../src/shared/drc/worker/drc-worker-client", () => ({
  disposeDrcWorker: disposeWorker,
  setDrcWorkerEntry: setWorkerEntry,
}));
mock.module("../src/main/mcp-portfile.js", () => ({
  ensureMcpToken: () => "isolated-test-token",
  clearStaleMcpPortfile: () => {},
  writeMcpPortfile: writePortfile,
  removeMcpPortfile: removePortfile,
}));

type BackendServer = typeof import("../src/main/backend-server");
let server: BackendServer;
let launch = 0;
async function freshLaunch(): Promise<void> {
  server = await import(`../src/main/backend-server.ts?launch=${launch++}`) as BackendServer;
}
const startBackendServer = () => server.startBackendServer();
const stopBackendServer = () => server.stopBackendServer();
const getBackendPayload = () => server.getBackendPayload();

function seedDatabaseFiles(): Map<string, Buffer> {
  const directory = join(userData, "dev");
  mkdirSync(directory, { recursive: true });
  const files = new Map<string, Buffer>();
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = join(directory, `openpcb.sqlite${suffix}`);
    const bytes = Buffer.from(`existing user data ${suffix}\0\xff`, "latin1");
    writeFileSync(path, bytes);
    files.set(path, bytes);
  }
  return files;
}

function expectDatabasePreserved(files: Map<string, Buffer>): void {
  for (const [path, bytes] of files) expect(readFileSync(path)).toEqual(bytes);
  expect(resetDatabase).not.toHaveBeenCalled();
}

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), "openpcb-startup-preservation-"));
  snapshot = { modules: [], loadedModules: [...requiredModules] };
  startupFailure = publicationFailure = cleanupFailure = null;
  for (const operation of [start, close, disposeWorker, send, writePortfile,
    removePortfile, resetDatabase, captureException, setWorkerEntry, configureCredentials]) operation.mockClear();
  await freshLaunch();
});

afterEach(async () => {
  cleanupFailure = null;
  await stopBackendServer();
  rmSync(userData, { recursive: true, force: true });
  for (const name of Object.keys(process.env)) {
    if (!(name in savedEnvironment)) delete process.env[name];
  }
  Object.assign(process.env, savedEnvironment);
});

afterAll(() => mock.restore());

describe("desktop startup preserves existing database files", () => {
  for (const missing of requiredModules) {
    test(`failed ${missing} activation closes runtime without resetting or retrying`, async () => {
      const files = seedDatabaseFiles();
      snapshot.loadedModules = requiredModules.filter((id) => id !== missing);
      snapshot.modules = [{
        id: missing, label: missing, namespace: `openpcb.${missing}`, version: "0.1.0",
        kind: "space", sidebar: { label: missing, icon: "Box", order: 0 },
        defaultPinned: false, status: "failed", reason: "SQLITE_ERROR: missing column",
        dependencies: [],
      }];

      await expect(startBackendServer()).rejects.toThrow(
        `Desktop backend started, but required module(s) failed to load: ${missing}\n\nModule registry:\n${missing}: failed — SQLITE_ERROR: missing column`,
      );
      expectDatabasePreserved(files);
      expect(start).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(disposeWorker).toHaveBeenCalledTimes(1);
      expect(getBackendPayload()).toBeNull();
      expect(send).not.toHaveBeenCalled();
      await stopBackendServer();
      expect(close).toHaveBeenCalledTimes(1);
      expect(disposeWorker).toHaveBeenCalledTimes(1);
    });
  }

  test("publication failure clears runtime and payload, preserves original error", async () => {
    const files = seedDatabaseFiles();
    publicationFailure = new Error("portfile write denied");
    cleanupFailure = new Error("cleanup failed");
    await expect(startBackendServer()).rejects.toBe(publicationFailure);
    expectDatabasePreserved(files);
    expect(close).toHaveBeenCalledTimes(1);
    expect(disposeWorker).toHaveBeenCalledTimes(1);
    expect(getBackendPayload()).toBeNull();
    expect(removePortfile).toHaveBeenCalledTimes(1);
    publicationFailure = cleanupFailure = null;
    await freshLaunch();
    await startBackendServer();
    expect(start).toHaveBeenCalledTimes(2);
  });

  test("runtime rejection preserves original error and database", async () => {
    const files = seedDatabaseFiles();
    startupFailure = new Error("backend bootstrap failed");
    await expect(startBackendServer()).rejects.toBe(startupFailure);
    expectDatabasePreserved(files);
    expect(start).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(disposeWorker).toHaveBeenCalledTimes(1);
    expect(getBackendPayload()).toBeNull();
    expect(send).not.toHaveBeenCalled();
    await stopBackendServer();
    expect(disposeWorker).toHaveBeenCalledTimes(1);
  });

  test("cleanup rejection preserves actionable module failure without retry", async () => {
    const files = seedDatabaseFiles();
    snapshot.loadedModules = [];
    cleanupFailure = new Error("cleanup failed");
    await expect(startBackendServer()).rejects.toThrow(
      "Desktop backend started, but required module(s) failed to load: library, designer, assistant\n\nModule registry:\nNo module manifests were discovered.",
    );
    expectDatabasePreserved(files);
    expect(start).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(disposeWorker).toHaveBeenCalledTimes(1);
    expect(getBackendPayload()).toBeNull();
  });

  test("successful startup reuses runtime; shutdown closes it once", async () => {
    const files = seedDatabaseFiles();
    const payload = await startBackendServer();
    expect(payload.url).toBe("http://127.0.0.1:43123");
    expect(payload.port).toBe(43123);
    expect(await startBackendServer()).toBe(payload);
    expect(start).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("backend-ready", payload);
    expect(start).toHaveBeenCalledWith({ host: "127.0.0.1", port: 0, secretStore,
      localApi: { token: expect.stringMatching(/^[a-f0-9]{64}$/), rendererOrigins: ["http://127.0.0.1:1420"] } });
    expect(writePortfile).toHaveBeenCalledTimes(1);
    expect(process.env.OPENPCB_DB_PATH).toBe(join(userData, "dev", "openpcb.sqlite"));
    expect(process.env.PORT).toBe("0");
    expect(process.env.HOST).toBe("127.0.0.1");
    expectDatabasePreserved(files);
    await stopBackendServer();
    await stopBackendServer();
    expect(close).toHaveBeenCalledTimes(1);
    expect(disposeWorker).toHaveBeenCalledTimes(1);
    expect(getBackendPayload()).toBeNull();
    expect(configureCredentials).toHaveBeenLastCalledWith(null);
  });

  test("quit during startup waits for the created runtime and rejects restart", async () => {
    let finishStartup: (runtime: StartedBackendRuntime) => void = () => {};
    start.mockImplementationOnce(() => new Promise<StartedBackendRuntime>((resolve) => { finishStartup = resolve; }));
    const starting = startBackendServer();
    const stopping = stopBackendServer();
    expect(stopBackendServer()).toBe(stopping);
    await expect(startBackendServer()).rejects.toThrow("Backend shutdown has started");
    expect(close).not.toHaveBeenCalled();
    finishStartup({ host: "127.0.0.1", port: 43123, url: "http://127.0.0.1:43123", snapshot, close });
    await starting;
    await stopping;
    expect(close).toHaveBeenCalledTimes(1);
    expect(disposeWorker).toHaveBeenCalledTimes(1);
    expect(getBackendPayload()).toBeNull();
  });
});
