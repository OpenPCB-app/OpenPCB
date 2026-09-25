/**
 * The stdio bridge (`electron/src/mcp-shim/bridge.ts`) against a real backend
 * on a real loopback port: the failure modes that made the old pipe unusable
 * from Claude Code — app not running, app restarting on a new port and token,
 * MCP switched off, writes toggled, cancelled calls.
 *
 * Lives here (Bun) because the electron workspace has no test runner; the
 * bridge modules are Electron-free by design.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpBridge } from "../../../../electron/src/mcp-shim/bridge";
import {
  processAlive,
  type DiscoveryEnv,
} from "../../../../electron/src/mcp-shim/portfile";
import type { JsonRpcMessage } from "../../../../electron/src/mcp-shim/upstream";
import { getAssistantService } from "../../../modules/assistant/backend/assistant-service";
import { bootMcpHarness, MCP_TOKEN, type McpHarness } from "./helpers/mcp-harness";

let h: McpHarness;
let dir: string;
let portfilePath: string;
let servers: Array<{ stop(force?: boolean): void; port: number }> = [];

function serve(): { stop(force?: boolean): void; port: number } {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req) => h.server.fetch(req),
  });
  servers.push(server as never);
  return server as never;
}

function writePortfile(port: number, token: string): void {
  writeFileSync(
    portfilePath,
    JSON.stringify({
      version: 1,
      url: `http://127.0.0.1:${port}/api/modules/assistant/mcp`,
      port,
      token,
      pid: process.pid,
      appVersion: "test",
    }),
  );
}

function discovery(): DiscoveryEnv {
  return {
    env: { OPENPCB_MCP_PORTFILE: portfilePath },
    platform: process.platform,
    homedir: dir,
    processAlive,
    readFile: (p) => {
      try {
        return require("node:fs").readFileSync(p, "utf8") as string;
      } catch {
        return null;
      }
    },
  };
}

function makeBridge(fetchImpl?: typeof fetch) {
  const sent: JsonRpcMessage[] = [];
  const bridge = new McpBridge({
    discovery: discovery(),
    instanceId: `bridge-${crypto.randomUUID()}`,
    send: (m) => sent.push(m),
    fetchImpl,
  });
  let nextId = 1;
  async function request(method: string, params?: Record<string, unknown>) {
    const id = nextId++;
    const before = sent.length;
    await bridge.handleClientMessage({ jsonrpc: "2.0", id, method, params });
    return sent.slice(before).find((m) => m.id === id)!;
  }
  async function init() {
    const response = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "Claude Code", version: "2.1.282" },
    });
    await bridge.handleClientMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    return response;
  }
  return { bridge, sent, request, init };
}

beforeAll(async () => {
  h = await bootMcpHarness("mcp-shim-bridge");
  dir = mkdtempSync(path.join(os.tmpdir(), "openpcb-bridge-"));
  portfilePath = path.join(dir, "mcp.json");
});

afterAll(() => {
  for (const server of servers) server.stop(true);
  servers = [];
  process.env.OPENPCB_MCP_TOKEN = MCP_TOKEN;
  rmSync(dir, { recursive: true, force: true });
});

describe("mcp bridge", () => {
  test("answers initialize and explains itself while OpenPCB is not running", async () => {
    rmSync(portfilePath, { force: true });
    const { init, request } = makeBridge();
    const init1 = await init();
    const result = init1.result as {
      instructions: string;
      capabilities: { tools: { listChanged: boolean } };
    };
    expect(result.instructions).toContain("not running");
    expect(result.capabilities.tools.listChanged).toBe(true);

    const call = await request("tools/call", {
      name: "designer_list_designs",
      arguments: {},
    });
    const callResult = call.result as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(callResult.isError).toBe(true);
    expect(callResult.content[0]!.text).toContain("not running");

    const discover = await request("server/discover");
    expect(discover.error?.code).toBe(-32601);
    expect((await request("ping")).result).toEqual({});
  });

  test("announces the tools once OpenPCB comes up, then forwards calls", async () => {
    rmSync(portfilePath, { force: true });
    h.enable();
    const { bridge, sent, init, request } = makeBridge();
    await init();
    await bridge.poll();
    const server = serve();
    writePortfile(server.port, MCP_TOKEN);
    const before = sent.length;
    await bridge.poll();
    expect(
      sent.slice(before).some((m) => m.method === "notifications/tools/list_changed"),
    ).toBe(true);

    const tools = (await request("tools/list")).result as { tools: Array<{ name: string }> };
    expect(tools.tools.map((t) => t.name)).toContain("designer_list_designs");
    const call = await request("tools/call", {
      name: "designer_list_designs",
      arguments: {},
    });
    expect((call.result as { structuredContent: { ok: boolean } }).structuredContent.ok).toBe(true);
  });

  test("survives an app restart on a new port with a new token", async () => {
    h.enable();
    const first = serve();
    writePortfile(first.port, MCP_TOKEN);
    const { init, request } = makeBridge();
    await init();
    expect((await request("tools/list")).result).toBeTruthy();

    first.stop(true);
    const rotated = `rotated-${crypto.randomUUID()}`;
    process.env.OPENPCB_MCP_TOKEN = rotated;
    const second = serve();
    writePortfile(second.port, rotated);

    const call = await request("tools/call", {
      name: "designer_list_designs",
      arguments: {},
    });
    expect((call.result as { structuredContent: { ok: boolean } }).structuredContent.ok).toBe(true);
    process.env.OPENPCB_MCP_TOKEN = MCP_TOKEN;
  });

  test("re-reads the token after a 401 on the same port", async () => {
    h.enable();
    const server = serve();
    writePortfile(server.port, MCP_TOKEN);
    const { init, request } = makeBridge();
    await init();
    await request("tools/list");
    const rotated = `rotated-${crypto.randomUUID()}`;
    process.env.OPENPCB_MCP_TOKEN = rotated;
    writePortfile(server.port, rotated);
    const call = await request("tools/call", {
      name: "designer_list_designs",
      arguments: {},
    });
    expect((call.result as { structuredContent: { ok: boolean } }).structuredContent.ok).toBe(true);
    process.env.OPENPCB_MCP_TOKEN = MCP_TOKEN;
  });

  test("reports a disabled server as an actionable tool result", async () => {
    const server = serve();
    writePortfile(server.port, MCP_TOKEN);
    getAssistantService().updateSettings({ mcpEnabled: false });
    const { init, request } = makeBridge();
    await init();
    const call = await request("tools/call", {
      name: "designer_list_designs",
      arguments: {},
    });
    const result = call.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Settings");
    h.enable();
  });

  test("tells the client to re-list tools when writes are toggled", async () => {
    h.enable({ writes: false });
    const server = serve();
    writePortfile(server.port, MCP_TOKEN);
    const { bridge, sent, init } = makeBridge();
    await init();
    await bridge.poll();
    const before = sent.length;
    h.enable({ writes: true });
    await bridge.poll();
    expect(
      sent.slice(before).some((m) => m.method === "notifications/tools/list_changed"),
    ).toBe(true);
    const quiet = sent.length;
    await bridge.poll();
    expect(sent.length).toBe(quiet);
  });

  test("notifications/cancelled aborts the in-flight request", async () => {
    writePortfile(1, MCP_TOKEN);
    const hanging: typeof fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as typeof fetch;
    const { bridge, sent } = makeBridge(hanging);
    const pending = bridge.handleClientMessage({
      jsonrpc: "2.0",
      id: 77,
      method: "tools/call",
      params: { name: "designer_run_drc", arguments: {} },
    });
    await Promise.resolve();
    await bridge.handleClientMessage({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 77 },
    });
    await pending;
    const response = sent.find((m) => m.id === 77);
    expect(response?.error?.code).toBe(-32800);
  });
});

describe("bundled shim process", () => {
  test("a real MCP client connects over stdio and calls a tool", async () => {
    const { Client } = await import("@modelcontextprotocol/client");
    const { StdioClientTransport } = await import("@modelcontextprotocol/client/stdio");
    h.enable();
    const server = serve();
    writePortfile(server.port, MCP_TOKEN);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve(import.meta.dir, "../../../../electron/src/mcp-shim/index.ts")],
      env: { ...(process.env as Record<string, string>), OPENPCB_MCP_PORTFILE: portfilePath },
      stderr: "ignore",
    });
    const client = new Client({ name: "shim-e2e", version: "1.0.0" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain("designer_list_designs");
      const result = (await client.callTool({
        name: "designer_list_designs",
        arguments: {},
      })) as { structuredContent?: { ok?: boolean } };
      expect(result.structuredContent?.ok).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);
});
