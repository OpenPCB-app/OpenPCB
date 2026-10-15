import { test as base, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fork, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { LocalApiBootstrap } from "../../../src/core/contracts/security/local-api";
import { isTroikaFontResolver } from "./offline-canvas";

interface AppFixture { origin: string; bootstrap: LocalApiBootstrap; port: number; componentId: string }
interface ReadyMessage extends AppFixture { ready?: boolean; error?: string }
type Fixtures = { agentkit: AppFixture; deniedRequests: string[] };

export const test = base.extend<Fixtures>({
  agentkit: async ({}, use) => {
    const root = path.resolve(".");
    const directory = await mkdtemp(path.join(os.tmpdir(), "openpcb-agentkit-browser-"));
    let frontend: ViteDevServer | undefined;
    let child: ChildProcess | undefined;
    try {
      frontend = await createServer({ configFile: path.join(root, "src/core/frontend/vite.config.ts"),
        root: path.join(root, "src/core/frontend"), envFile: false,
        define: Object.fromEntries(["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_CLOUD_API_URL",
          "VITE_CLOUD_WEB_URL"].map((key) => [`import.meta.env.${key}`, JSON.stringify("")])),
        server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null,
          proxy: { "/api": { target: "http://127.0.0.1:1" }, "/ws": { target: "ws://127.0.0.1:1" } } } });
      await frontend.listen();
      const address = frontend.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Fixture frontend has no TCP address");
      const origin = `http://127.0.0.1:${address.port}`;
      const output = path.join(directory, "runtime.mjs");
      await symlink(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
      buildRuntime(root, output);
      child = fork(output, [], { cwd: root, stdio: ["ignore", "pipe", "pipe", "ipc"], env: {
        PATH: process.env.PATH, NODE_ENV: "production", OPENPCB_DB_PATH: path.join(directory, "app.sqlite"),
        APP_DATA_DIR: directory, OPENPCB_WORKSPACE_ROOT: path.join(root, "src"),
        // The fixture seeds a real KiCad footprint; release intake quarantine (H13) is out of scope here.
        OPENPCB_FEATURE_LIBRARY_FOOTPRINTINTAKEQUARANTINE: "0",
      } });
      const ready = waitForRuntime(child);
      child.send({ origin });
      const fixture = await ready;
      await use({ ...fixture, origin });
    } finally {
      await stopRuntime(child);
      await frontend?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  deniedRequests: async ({}, use, testInfo) => {
    const denied: string[] = [];
    await use(denied);
    console.log(`[offline-guard] ${testInfo.title}: denied ${denied.length} external request(s)`);
    testInfo.annotations.push({ type: "offline-denied-requests", description: String(denied.length) });
    if (denied.length) await testInfo.attach("offline-denied-requests.json",
      { body: JSON.stringify(denied, null, 2), contentType: "application/json" });
    // The pinned r3f-eda-canvas v0.1.4 still asks Troika's CDN resolver for its default font.
    // Tighten to expect(denied).toEqual([]) once the r3f-eda-canvas re-pin lands.
    expect(denied.filter((url) => !isTroikaFontResolver(url)), "Only the pinned canvas font resolver may go off-host")
      .toEqual([]);
  },
  page: async ({ page, agentkit, deniedRequests }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => { errors.push((error.stack ?? error.message).replaceAll(agentkit.bootstrap.token, "[REDACTED]")); });
    // Every off-host request is aborted, the canvas font resolver included, so text must render offline.
    await page.context().route("**/*", (route) => {
      const url = route.request().url();
      if ([agentkit.origin, agentkit.bootstrap.url].includes(new URL(url).origin)) return route.continue();
      deniedRequests.push(url);
      return route.abort();
    });
    await page.addInitScript(({ bootstrap, port }) => {
      Object.defineProperty(window, "electronAPI", { configurable: true, value: {
        getBackendUrl: async () => ({ url: bootstrap.url, port }),
        onBackendReady: () => () => {},
        localApi: { bootstrap: async () => bootstrap },
      } });
    }, { bootstrap: agentkit.bootstrap, port: agentkit.port });
    await use(page);
    expect(errors, "Browser runtime errors").toEqual([]);
  },
});

function buildRuntime(root: string, output: string): void {
  execFileSync(path.join(root, "node_modules/.bin/esbuild"), [
    "tests/e2e/support/assistant-agentkit-runtime.node.ts", "--bundle", "--platform=node", "--format=esm",
    "--external:agentkit", "--external:agentkit/*", "--external:better-sqlite3", "--external:@openpcb/opclib-pack",
    "--banner:js=import { createRequire as createFixtureRequire } from 'node:module'; const require = createFixtureRequire(import.meta.url);",
    `--outfile=${output}`,
  ], { cwd: root, stdio: "pipe" });
}

function waitForRuntime(child: ChildProcess): Promise<ReadyMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Isolated runtime did not start within 30 s")), 30_000);
    let output = "";
    const capture = (chunk: Buffer) => { output = (output + String(chunk)).slice(-20_000); };
    child.stdout?.on("data", capture); child.stderr?.on("data", capture);
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Isolated runtime exited ${code}: ${output}`)); });
    child.on("message", (message: ReadyMessage) => {
      if (message.error) { clearTimeout(timer); reject(new Error(`${message.error}: ${output}`)); }
      else if (message.ready) { clearTimeout(timer); resolve(message); }
    });
  });
}

async function stopRuntime(child?: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    if (child.connected) child.send({ stop: true });
    else child.kill("SIGTERM");
  });
}

export { expect };
