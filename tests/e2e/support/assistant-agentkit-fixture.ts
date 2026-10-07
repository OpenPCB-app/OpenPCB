import { test as base, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fork, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { LocalApiBootstrap } from "../../../src/core/contracts/security/local-api";

interface AppFixture { origin: string; bootstrap: LocalApiBootstrap; port: number; componentId: string }
interface ReadyMessage extends AppFixture { ready?: boolean; error?: string }
type Fixtures = { agentkit: AppFixture };

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
          "VITE_CLOUD_WEB_URL", "VITE_CLOUD_COPILOT_URL"].map((key) => [`import.meta.env.${key}`, JSON.stringify("")])),
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
  page: async ({ page, agentkit }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => { errors.push((error.stack ?? error.message).replaceAll(agentkit.bootstrap.token, "[REDACTED]")); });
    await page.context().route("**/*", (route) => {
      const request = route.request();
      const origin = new URL(request.url()).origin;
      const publicFont = request.method() === "GET" && request.url().startsWith(
        "https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@v1.0.1/packages/data/",
      );
      return [agentkit.origin, agentkit.bootstrap.url].includes(origin) || publicFont ? route.continue() : route.abort();
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
