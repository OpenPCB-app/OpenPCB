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

type BackendPayload = {
  url: string;
  port: number;
  startupContractVersion?: number;
  startupLicenseState?: string;
  startupLicenseCode?: string;
};

type DiagnosticsPaths = {
  logs: string;
  crashDumps: string;
  userData: string;
  appVersion: string;
};

const requiredModules = ["library", "designer", "assistant"] as const;

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function launchDesktopApp(userDataDir: string): Promise<ElectronApplication> {
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
    args: [".", ...launchArgs],
    cwd: path.resolve("electron"),
    env,
    timeout: 120_000,
  });
}

async function firstReadyWindow(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow({ timeout: 120_000 });
  await window.waitForLoadState("domcontentloaded", { timeout: 60_000 });
  return window;
}

async function resolveBackendPayload(page: Page): Promise<BackendPayload> {
  const payload = await page.waitForFunction(async () => {
    const electronApi = window.electronAPI;
    if (!electronApi?.getBackendUrl) return null;
    return electronApi.getBackendUrl();
  }, null, { timeout: 60_000 });

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

async function getDiagnosticsPaths(page: Page): Promise<DiagnosticsPaths | null> {
  return page.evaluate(async () => {
    if (!window.electronAPI?.getDiagnosticsPaths) return null;
    return window.electronAPI.getDiagnosticsPaths();
  });
}

async function attachElectronLogs(
  page: Page | null,
  testInfo: TestInfo,
): Promise<void> {
  if (!page) return;

  try {
    const diagnostics = await getDiagnosticsPaths(page);
    if (!diagnostics) return;

    await testInfo.attach("electron-diagnostics.json", {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: "application/json",
    });

    const entries = await fs.readdir(diagnostics.logs).catch(() => []);
    for (const entry of entries) {
      if (!entry.endsWith(".log")) continue;
      const logPath = path.join(diagnostics.logs, entry);
      const body = await fs.readFile(logPath, "utf8").catch(() => null);
      if (body) {
        await testInfo.attach(`electron-log-${entry}`, {
          body,
          contentType: "text/plain",
        });
      }
    }
  } catch {
    // Best-effort diagnostics only; never mask the original failure.
  }
}

test.describe.serial("Electron desktop release smoke", () => {
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
  });

  test.afterAll(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  test("packaged desktop app launches, boots backend, and persists local state", async ({}, testInfo) => {
    const rendererErrors: string[] = [];
    let app: ElectronApplication | null = null;
    let page: Page | null = null;
    let backendPayload: BackendPayload | null = null;

    try {
      app = await launchDesktopApp(userDataDir);
      page = await firstReadyWindow(app);
      page.on("pageerror", (error) => rendererErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") rendererErrors.push(message.text());
      });

      const appState = await app.evaluate(({ app, BrowserWindow }) => ({
        isPackaged: app.isPackaged,
        name: app.getName(),
        version: app.getVersion(),
        windowCount: BrowserWindow.getAllWindows().length,
      }));

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
      await expect(page.getByText("General Settings")).toBeVisible();
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "New Design" }).first().click();
      await expect(page.getByRole("tab", { name: "Schem" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator("canvas").first()).toBeVisible({
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
      await attachElectronLogs(page, testInfo);
      await app?.close();
    }

    app = null;
    page = null;

    try {
      app = await launchDesktopApp(userDataDir);
      page = await firstReadyWindow(app);
      page.on("pageerror", (error) => rendererErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") rendererErrors.push(message.text());
      });
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

      const windowCount = await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      );
      expect(windowCount).toBe(1);
    } finally {
      await attachElectronLogs(page, testInfo);
      await app?.close();
    }

    expect(rendererErrors).toEqual([]);
  });
});
