import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

export type NativeProfile = { root: string; userData: string };
export type NetworkRecord = { url: string; method: string; blocked: boolean };
export type NativeSession = {
  app: ElectronApplication;
  page: Page;
  backend: string;
  profile: NativeProfile;
  info: TestInfo;
  label: string;
  patches: Array<{
    url: string;
    body: string | null;
    ifUnmodifiedSince: string | undefined;
    requestId: string | undefined;
  }>;
  responses: Array<{ url: string; status: number }>;
  console: Array<{ type: string; text: string; url: string }>;
  pageErrors: string[];
  stdout: string[];
  stderr: string[];
  expectedResourceFailures: Array<{ url: string; text: string }>;
};

const networkGuard = `
const { app, session } = require("electron");
globalThis.__openpcbNativeNetwork = [];
app.once("ready", () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    const url = new URL(details.url);
    const localProtocol = ["data:", "blob:", "file:", "about:", "devtools:"].includes(url.protocol);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    const blocked = !localProtocol && !loopback;
    globalThis.__openpcbNativeNetwork.push({ url: details.url, method: details.method, blocked });
    if (blocked) process.stderr.write("[native-offline] denied " + details.url + "\\n");
    callback({ cancel: blocked });
  });
  globalThis.__openpcbNativeNetworkInstalled = true;
});
`;

export async function createNativeProfile(): Promise<NativeProfile> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openpcb-native-docs-"));
  const userData = path.join(root, "user-data");
  await fs.mkdir(userData);
  await writeNativeNetworkGuard(root);
  return { root, userData };
}

export async function writeNativeNetworkGuard(root: string): Promise<void> {
  await fs.writeFile(path.join(root, "network-guard.cjs"), networkGuard);
}

export async function readyNativeWindow(
  app: ElectronApplication,
): Promise<Page> {
  let window: Page | null = null;
  await expect
    .poll(
      async () => {
        for (const candidate of app.windows()) {
          if (candidate.isClosed()) continue;
          const ready = await candidate
            .evaluate(() =>
              Boolean(
                (globalThis as unknown as { electronAPI?: unknown })
                  .electronAPI,
              ),
            )
            .catch(() => false);
          if (ready) {
            window = candidate;
            return true;
          }
        }
        return false;
      },
      {
        timeout: 120_000,
        message: "Application window must expose its preload API",
      },
    )
    .toBe(true);
  if (!window) throw new Error("Application window unavailable");
  return window as Page;
}

async function assertNativeIsolation(
  app: ElectronApplication,
  page: Page,
  profile: NativeProfile,
): Promise<string> {
  const diagnostics = await page.evaluate(() =>
    window.electronAPI!.getDiagnosticsPaths!(),
  );
  expect(await fs.realpath(diagnostics.userData)).toBe(
    await fs.realpath(profile.userData),
  );
  const state = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    dbPath: process.env.OPENPCB_DB_PATH,
    guardInstalled: Boolean(
      (globalThis as unknown as { __openpcbNativeNetworkInstalled?: boolean })
        .__openpcbNativeNetworkInstalled,
    ),
  }));
  expect(
    state.packaged,
    "This harness qualifies a development bundle only",
  ).toBe(false);
  expect(
    state.guardInstalled,
    "Offline guard must precede renderer navigation",
  ).toBe(true);
  expect(await fs.realpath(state.dbPath!)).toBe(
    path.join(await fs.realpath(profile.userData), "dev", "openpcb.sqlite"),
  );
  await page.waitForFunction(
    async () => window.electronAPI?.getBackendUrl(),
    null,
    { timeout: 60_000 },
  );
  const backend = await page.evaluate(() =>
    window.electronAPI!.getBackendUrl(),
  );
  if (!backend) throw new Error("Native backend unavailable");
  expect(new URL(backend.url).hostname).toBe("127.0.0.1");
  expect(backend.port).toBeGreaterThan(0);
  const registry = await fetch(`${backend.url}/api/modules/registry`);
  expect(registry.ok).toBe(true);
  expect(
    ((await registry.json()) as { loadedModules: string[] }).loadedModules,
  ).toContain("knowledge");
  return backend.url;
}

export async function launchNativeProfile(
  profile: NativeProfile,
  info: TestInfo,
  label: string,
): Promise<NativeSession> {
  const electronRequire = createRequire(path.resolve("electron/package.json"));
  const app = await electron.launch({
    executablePath: electronRequire("electron") as string,
    args: [
      "-r",
      path.join(profile.root, "network-guard.cjs"),
      ".",
      `--user-data-dir=${profile.userData}`,
    ],
    cwd: path.resolve("electron"),
    env: { ...process.env, OPENPCB_DEBUG: "1", ELECTRON_ENABLE_LOGGING: "1" },
    timeout: 120_000,
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  app
    .process()
    .stdout?.on("data", (chunk: Buffer) => stdout.push(chunk.toString()));
  app
    .process()
    .stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
  await app
    .context()
    .tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    const page = await readyNativeWindow(app);
    const session: NativeSession = {
      app,
      page,
      profile,
      info,
      label,
      stdout,
      stderr,
      backend: "",
      patches: [],
      responses: [],
      console: [],
      pageErrors: [],
      expectedResourceFailures: [],
    };
    page.on("console", (message) =>
      session.console.push({
        type: message.type(),
        text: message.text(),
        url: message.location().url,
      }),
    );
    page.on("pageerror", (error) =>
      session.pageErrors.push(error.stack ?? error.message),
    );
    page.on("request", (request) => {
      if (request.method() === "PATCH")
        session.patches.push({
          url: request.url(),
          body: request.postData(),
          ifUnmodifiedSince: request.headers()["if-unmodified-since"],
          requestId: request.headers()["x-request-id"],
        });
    });
    page.on("response", (response) =>
      session.responses.push({
        url: response.url(),
        status: response.status(),
      }),
    );
    await page.waitForLoadState("domcontentloaded");
    session.backend = await assertNativeIsolation(app, page, profile);
    await setNativeViewport(app, page, info, label);
    await attachNativeIdentity(session);
    return session;
  } catch (error) {
    await info.attach(`${label}-launch-output.json`, {
      body: JSON.stringify({ stdout, stderr }, null, 2),
      contentType: "application/json",
    });
    const trace = info.outputPath(`${label}-launch-failure-trace.zip`);
    await app
      .context()
      .tracing.stop({ path: trace })
      .catch(() => {});
    if (await fs.stat(trace).catch(() => null))
      await info.attach(`${label}-launch-failure-trace.zip`, {
        path: trace,
        contentType: "application/zip",
      });
    await app.close().catch(() => {});
    throw error;
  }
}

export async function setNativeViewport(
  app: ElectronApplication,
  page: Page,
  info: TestInfo,
  label: string,
): Promise<void> {
  const window = await app.browserWindow(page);
  const before = await window.evaluate((nativeWindow) => ({
    bounds: nativeWindow.getContentBounds(),
    devTools: nativeWindow.webContents.isDevToolsOpened(),
  }));
  const beforeViewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await window.evaluate((nativeWindow) => {
    nativeWindow.webContents.closeDevTools();
    nativeWindow.setContentSize(1100, 720);
  });
  await expect
    .poll(() =>
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    )
    .toEqual({ width: 1100, height: 720 });
  const after = await window.evaluate((nativeWindow) => ({
    bounds: nativeWindow.getContentBounds(),
    devTools: nativeWindow.webContents.isDevToolsOpened(),
  }));
  await info.attach(`${label}-window-bounds.json`, {
    body: JSON.stringify(
      {
        before,
        beforeViewport,
        after,
        viewport: await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
        })),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
}

async function attachNativeIdentity(session: NativeSession): Promise<void> {
  const { app, page, profile, info, label } = session;
  const rendererDist = path.resolve(
    process.env.OPENPCB_NATIVE_RENDERER_DIST ?? "src/core/frontend/dist",
  );
  const indexPath = path.join(rendererDist, "index.html");
  const servedIndex = await page.request.get(new URL("/", page.url()).href);
  expect(
    await servedIndex.text(),
    "Served renderer must match the attested artifact",
  ).toBe(await fs.readFile(indexPath, "utf8"));
  const identity = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    versions: process.versions,
    platform: process.platform,
    userData: app.getPath("userData"),
    dbPath: process.env.OPENPCB_DB_PATH,
    gpuFeatures: app.getGPUFeatureStatus(),
  }));
  const gpu = await app.evaluate(({ app }) => app.getGPUInfo("basic"));
  const builds = await Promise.all(
    ["electron/dist/main/index.js", indexPath].map(async (file) => ({
      file,
      sha256: createHash("sha256")
        .update(await fs.readFile(file))
        .digest("hex"),
      modifiedAt: (await fs.stat(file)).mtime.toISOString(),
    })),
  );
  const assets = (await fs.readdir(path.join(rendererDist, "assets"))).filter(
    (file) => !file.endsWith(".map"),
  );
  const assetHashes = await Promise.all(
    [
      "electron/dist/preload/index.js",
      ...assets.map((file) => path.join(rendererDist, "assets", file)),
    ].map(async (file) => ({
      file,
      sha256: createHash("sha256")
        .update(await fs.readFile(file))
        .digest("hex"),
    })),
  );
  const packages = await Promise.all(
    [
      "electron",
      "@openpcb/opclib-pack",
      "@openpcb/contracts",
      "@tiptap/react",
      "pdfjs-dist",
    ].map(async (name) => {
      const owner = createRequire(
        path.resolve(
          name === "electron" ? "electron/package.json" : "package.json",
        ),
      );
      for (const directory of owner.resolve.paths(name) ?? []) {
        const file = path.join(directory, name, "package.json");
        if (!(await fs.stat(file).catch(() => null))) continue;
        const manifest = JSON.parse(await fs.readFile(file, "utf8")) as {
          version: string;
        };
        return {
          name,
          version: manifest.version,
          manifest: await fs.realpath(file),
        };
      }
      throw new Error(`Installed package unavailable from its owner: ${name}`);
    }),
  );
  await info.attach(`${label}-identity.json`, {
    body: JSON.stringify(
      {
        identity,
        rendererDist,
        gpu,
        builds,
        assetHashes,
        packages,
        sourceIdentity:
          process.env.OPENPCB_NATIVE_BUILD_SOURCE ??
          "Unspecified; source identity must be supplied by the build owner",
        profile,
        observationScope: {
          network:
            "Electron default session renderer/worker HTTP traffic; main-process network is not instrumented",
          rendererErrors:
            "Listeners begin after application window preload-ready; current-process stdout/stderr also captured, early renderer errors may precede listeners",
        },
        diagnostics: await page.evaluate(() =>
          window.electronAPI!.getDiagnosticsPaths!(),
        ),
        viewport: await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
        })),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
}

export async function nativeScreenshot(
  session: NativeSession,
  label: string,
): Promise<void> {
  await session.info.attach(`${session.label}-${label}.png`, {
    body: await session.page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

/** External URLs the offline guard has denied so far, in request order. */
export async function nativeDeniedRequests(
  session: NativeSession,
): Promise<string[]> {
  const requests = await session.app.evaluate(
    () =>
      (globalThis as unknown as { __openpcbNativeNetwork: NetworkRecord[] })
        .__openpcbNativeNetwork,
  );
  return requests
    .filter((request) => request.blocked)
    .map((request) => request.url);
}

export type CloseNativeSessionOptions = {
  /** Denied URLs (and their console errors) a spec knowingly tolerates; default none. */
  toleratedDenied?: (url: string) => boolean;
};

export async function closeNativeSession(
  session: NativeSession,
  options: CloseNativeSessionOptions = {},
): Promise<void> {
  const { app, page, info, label } = session;
  const tolerated = options.toleratedDenied ?? (() => false);
  const toleratedConsole = (entry: { text: string; url: string }) =>
    tolerated(entry.url) ||
    (entry.text.match(/https?:\/\/[^\s"')]+/g) ?? []).some(tolerated);
  let requests: NetworkRecord[] | null = null;
  let evidenceError: unknown = null;
  try {
    requests = await app.evaluate(
      () =>
        (globalThis as unknown as { __openpcbNativeNetwork: NetworkRecord[] })
          .__openpcbNativeNetwork,
    );
    await nativeScreenshot(session, "final");
    const trace = info.outputPath(`${label}-trace.zip`);
    await app.context().tracing.stop({ path: trace });
    await info.attach(`${label}-trace.zip`, {
      path: trace,
      contentType: "application/zip",
    });
  } catch (error) {
    evidenceError = error;
    session.stderr.push(`Evidence capture failure: ${String(error)}\n`);
  } finally {
    if (!page.isClosed()) await page.unrouteAll({ behavior: "ignoreErrors" });
    await app.close();
  }
  await info.attach(`${label}-run.json`, {
    body: JSON.stringify(
      {
        requests,
        patches: session.patches,
        responses: session.responses,
        console: session.console,
        pageErrors: session.pageErrors,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await info.attach(`${label}-stdout.txt`, {
    body: session.stdout.join(""),
    contentType: "text/plain",
  });
  await info.attach(`${label}-stderr.txt`, {
    body: session.stderr.join(""),
    contentType: "text/plain",
  });
  if (evidenceError) throw evidenceError;
  expect(
    session.pageErrors,
    "Native renderer must have no uncaught errors",
  ).toEqual([]);
  const unexpectedConsole = session.console.filter(
    (entry) =>
      entry.type === "error" &&
      !toleratedConsole(entry) &&
      !session.expectedResourceFailures.some(
        (failure) => entry.url === failure.url && entry.text === failure.text,
      ),
  );
  expect(
    unexpectedConsole,
    "Only deliberately injected HTTP errors are expected",
  ).toEqual([]);
  expect(requests, "Native network evidence is required").not.toBeNull();
  expect(
    requests?.filter((request) => request.blocked && !tolerated(request.url)),
    "External renderer/session requests must never be attempted",
  ).toEqual([]);
}

export async function preserveNativeDatabase(
  profile: NativeProfile,
  info: TestInfo,
): Promise<void> {
  const database = path.join(profile.userData, "dev", "openpcb.sqlite");
  if (await fs.stat(database).catch(() => null)) {
    await info.attach("isolated-docs.sqlite", {
      path: database,
      contentType: "application/vnd.sqlite3",
    });
  }
  await fs.rm(profile.root, { recursive: true, force: true });
}
