import {
  attachElectronLogs,
  attachHomeNameGeometry,
  getDiagnosticsPaths,
} from "./electron-smoke-evidence";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  setNativeViewport,
  writeNativeNetworkGuard,
  type NetworkRecord,
} from "./electron-native-helpers";

type BackendPayload = {
  url: string;
  port: number;
  startupContractVersion?: number;
  startupLicenseState?: string;
  startupLicenseCode?: string;
};

type DesktopWindow = { webContents: { getURL(): string } };
type NativeOutput = { run: string; channel: string; text: string };

function captureProcess(
  app: ElectronApplication,
  run: string,
  output: NativeOutput[],
): void {
  app
    .process()
    .stdout?.on("data", (chunk: Buffer) =>
      output.push({ run, channel: "stdout", text: chunk.toString() }),
    );
  app
    .process()
    .stderr?.on("data", (chunk: Buffer) =>
      output.push({ run, channel: "stderr", text: chunk.toString() }),
    );
}

async function finishSmokeCapture(
  app: ElectronApplication | null,
  page: Page | null,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  await attachElectronLogs(page, testInfo);
  if (!app) return;
  const trace = testInfo.outputPath(`${label}-trace.zip`);
  await app
    .context()
    .tracing.stop({ path: trace })
    .catch(() => {});
  if (await pathExists(trace))
    await testInfo.attach(`${label}-trace.zip`, {
      path: trace,
      contentType: "application/zip",
    });
  let network: NetworkRecord[] | null = null;
  if (!process.env.OPENPCB_ELECTRON_EXECUTABLE) {
    network = await app
      .evaluate(
        () =>
          (globalThis as unknown as { __openpcbNativeNetwork: NetworkRecord[] })
            .__openpcbNativeNetwork,
      )
      .catch(() => null);
    await testInfo.attach(`${label}-network.json`, {
      body: JSON.stringify(network, null, 2),
      contentType: "application/json",
    });
  }
  await app.close();
  if (!process.env.OPENPCB_ELECTRON_EXECUTABLE) {
    expect(
      network,
      "Development launch must install its network guard",
    ).not.toBeNull();
    expect(
      network?.filter((request) => request.blocked),
      "No external requests may be attempted",
    ).toEqual([]);
  }
}

const requiredModules = ["library", "designer", "assistant"] as const;

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function launchDesktopApp(
  userDataDir: string,
): Promise<ElectronApplication> {
  const executablePath = process.env.OPENPCB_ELECTRON_EXECUTABLE;
  const launchArgs = [`--user-data-dir=${userDataDir}`];
  const env = {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: "1",
    OPENPCB_DEBUG: "1",
  };

  if (executablePath) {
    if (!(await pathExists(executablePath))) {
      throw new Error(
        `OPENPCB_ELECTRON_EXECUTABLE does not exist: ${executablePath}`,
      );
    }
    return electron.launch({
      executablePath,
      args: launchArgs,
      env,
      timeout: 120_000,
    });
  }

  return electron.launch({
    executablePath: createRequire(path.resolve("electron/package.json"))(
      "electron",
    ) as string,
    args: [
      "-r",
      path.join(path.dirname(userDataDir), "network-guard.cjs"),
      ".",
      ...launchArgs,
    ],
    cwd: path.resolve("electron"),
    env,
    timeout: 120_000,
  });
}

async function firstReadyWindow(app: ElectronApplication): Promise<Page> {
  // Detached DevTools can arrive before the application window in development.
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
  const readyWindow = window as Page;
  await readyWindow.waitForLoadState("domcontentloaded", { timeout: 60_000 });
  return readyWindow;
}

async function resolveBackendPayload(page: Page): Promise<BackendPayload> {
  const payload = await page.waitForFunction(
    async () => {
      const electronApi = window.electronAPI;
      if (!electronApi?.getBackendUrl) return null;
      return electronApi.getBackendUrl();
    },
    null,
    { timeout: 60_000 },
  );

  const value = await payload.jsonValue();
  if (!value || typeof value !== "object") {
    throw new Error("Electron backend payload unavailable");
  }
  const typed = value as Partial<BackendPayload>;
  if (!typed.url || typeof typed.port !== "number") {
    throw new Error(`Invalid backend payload: ${JSON.stringify(value)}`);
  }
  return typed as BackendPayload;
}

async function expectBackendHealthy(payload: BackendPayload): Promise<void> {
  const parsed = new URL(payload.url);
  expect(parsed.hostname).toBe("127.0.0.1");
  expect(payload.port).toBeGreaterThan(0);
  expect(payload.startupContractVersion).toBe(1);
  expect(payload.startupLicenseState).toBe("active");

  const health = await fetch(`${payload.url}/api/health`);
  expect(health.ok).toBeTruthy();

  const registryResponse = await fetch(`${payload.url}/api/modules/registry`);
  expect(registryResponse.ok).toBeTruthy();
  const registry = (await registryResponse.json()) as {
    loadedModules?: string[];
    modules?: Array<{ id: string; status: string }>;
  };

  for (const moduleId of requiredModules) {
    expect(registry.loadedModules).toContain(moduleId);
    expect(registry.modules).toContainEqual(
      expect.objectContaining({ id: moduleId, status: "loaded" }),
    );
  }
}

const buildKind = process.env.OPENPCB_ELECTRON_EXECUTABLE
  ? "packaged release"
  : "development";
test.describe.serial(`Electron desktop ${buildKind} smoke`, () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    !process.env.OPENPCB_E2E_NO_WEBSERVER,
    "Electron desktop smoke launches its own backend; set OPENPCB_E2E_NO_WEBSERVER=1",
  );

  let tmpRoot = "";
  let userDataDir = "";

  test.beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openpcb-desktop-e2e-"));
    userDataDir = path.join(tmpRoot, "user-data");
    await fs.mkdir(userDataDir, { recursive: true });
    await writeNativeNetworkGuard(tmpRoot);
  });

  test.afterAll(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  test(`${buildKind} app launches, boots backend, and persists local state`, async ({}, testInfo) => {
    const pageErrors: string[] = [];
    const output: NativeOutput[] = [];
    const consoleMessages: Array<{ run: string; type: string; text: string }> =
      [];
    let app: ElectronApplication | null = null;
    let page: Page | null = null;
    let backendPayload: BackendPayload | null = null;

    try {
      app = await launchDesktopApp(userDataDir);
      captureProcess(app, "initial", output);
      await app
        .context()
        .tracing.start({ screenshots: true, snapshots: true, sources: true });
      page = await firstReadyWindow(app);
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) =>
        consoleMessages.push({
          run: "initial",
          type: message.type(),
          text: message.text(),
        }),
      );
      await testInfo.attach("initial-docked-window.png", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await setNativeViewport(app, page, testInfo, "initial");

      const appState = await app.evaluate(({ app, BrowserWindow }) => ({
        isPackaged: app.isPackaged,
        name: app.getName(),
        version: app.getVersion(),
        windowCount: BrowserWindow.getAllWindows().length,
        gpuFeatures: app.getGPUFeatureStatus(),
      }));
      const gpu = await app.evaluate(({ app }) => app.getGPUInfo("basic"));
      await testInfo.attach("electron-gpu.json", {
        body: JSON.stringify({ appState, gpu }, null, 2),
        contentType: "application/json",
      });

      if (process.env.OPENPCB_ELECTRON_EXPECT_PACKAGED === "1") {
        expect(appState.isPackaged).toBe(true);
      }
      expect(appState.name).toMatch(/openpcb/i);
      expect(appState.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(appState.windowCount).toBeGreaterThanOrEqual(1);

      await expect(page).toHaveTitle(/OpenPCB/i);
      await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible({
        timeout: 60_000,
      });

      const rendererSecurity = await page.evaluate(() => ({
        hasElectronApi: Boolean(window.electronAPI),
        hasNodeRequire: "require" in window,
        protocol: window.location.protocol,
      }));
      expect(rendererSecurity.hasElectronApi).toBe(true);
      expect(rendererSecurity.hasNodeRequire).toBe(false);
      expect(["http:", "https:"]).toContain(rendererSecurity.protocol);

      backendPayload = await resolveBackendPayload(page);
      await expectBackendHealthy(backendPayload);

      const diagnostics = await getDiagnosticsPaths(page);
      expect(diagnostics).not.toBeNull();
      expect(await fs.realpath(diagnostics!.userData)).toBe(
        await fs.realpath(userDataDir),
      );
      expect(diagnostics?.appVersion).toBe(appState.version);

      await page.getByLabel("Settings").click();
      // Settings screen header (the General tab renders by default). Was
      // "General Settings"; the panel was restructured to a "Settings" header
      // + a "General" panel heading.
      await expect(
        page.getByRole("heading", { name: "Settings" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");

      const createResponse = await fetch(
        `${backendPayload.url}/api/modules/designer/designs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(createResponse.ok).toBeTruthy();

      await page.reload();
      await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible({
        timeout: 30_000,
      });
      await attachHomeNameGeometry(page, testInfo, "initial");
      await expect(
        page.getByText("Untitled Design").first(),
        "Home design label must be visible at supported native content width1100",
      ).toBeVisible({
        timeout: 30_000,
      });

      const designsAfterCreate = await fetch(
        `${backendPayload.url}/api/modules/designer/designs`,
      );
      expect(designsAfterCreate.ok).toBeTruthy();
      const createdPayload = (await designsAfterCreate.json()) as {
        data?: { designs?: Array<{ id: string; name: string }> };
      };
      expect(createdPayload.data?.designs?.length ?? 0).toBeGreaterThan(0);
    } finally {
      await finishSmokeCapture(app, page, testInfo, "initial");
      await testInfo.attach("electron-smoke-initial-run.json", {
        body: JSON.stringify(
          { output, console: consoleMessages, pageErrors },
          null,
          2,
        ),
        contentType: "application/json",
      });
    }

    app = null;
    page = null;

    try {
      app = await launchDesktopApp(userDataDir);
      captureProcess(app, "restarted", output);
      await app
        .context()
        .tracing.start({ screenshots: true, snapshots: true, sources: true });
      page = await firstReadyWindow(app);
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) =>
        consoleMessages.push({
          run: "restarted",
          type: message.type(),
          text: message.text(),
        }),
      );
      await setNativeViewport(app, page, testInfo, "restarted");
      await expect(page.getByRole("heading", { name: "Designs" })).toBeVisible({
        timeout: 60_000,
      });

      const relaunchBackend = await resolveBackendPayload(page);
      await expectBackendHealthy(relaunchBackend);

      const persistedDesigns = await fetch(
        `${relaunchBackend.url}/api/modules/designer/designs`,
      );
      expect(persistedDesigns.ok).toBeTruthy();
      const persistedPayload = (await persistedDesigns.json()) as {
        data?: { designs?: Array<{ id: string; name: string }> };
      };
      expect(persistedPayload.data?.designs?.length ?? 0).toBeGreaterThan(0);
      await attachHomeNameGeometry(page, testInfo, "restarted");
      await expect(
        page.getByText("Untitled Design").first(),
        "Persisted design label must be visible at supported native content width1100",
      ).toBeVisible({
        timeout: 30_000,
      });

      const windows = await app.evaluate(({ app, BrowserWindow }) => ({
        packaged: app.isPackaged,
        urls: BrowserWindow.getAllWindows().map((window: DesktopWindow) =>
          window.webContents.getURL(),
        ),
      }));
      await testInfo.attach("electron-restart-windows.json", {
        body: JSON.stringify(windows, null, 2),
        contentType: "application/json",
      });
      const applicationWindows = windows.urls.filter(
        (url: string) => !url.startsWith("devtools://"),
      );
      expect(applicationWindows).toHaveLength(1);
      if (windows.packaged) expect(windows.urls).toHaveLength(1);
    } finally {
      await finishSmokeCapture(app, page, testInfo, "restarted");
      await testInfo.attach("electron-smoke-current-run.json", {
        body: JSON.stringify(
          { output, console: consoleMessages, pageErrors },
          null,
          2,
        ),
        contentType: "application/json",
      });
    }

    expect(pageErrors).toEqual([]);
    expect(
      consoleMessages.filter((message) => message.type === "error"),
    ).toEqual([]);
  });
});
