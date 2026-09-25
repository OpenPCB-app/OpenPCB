import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getAssistantService,
  resetAssistantServiceForTesting,
} from "../../../modules/assistant/backend/assistant-service";
import { resetTaskRuntimeForTesting } from "../../../modules/tasks/backend/runtime-singleton";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

const MCP_URL = "http://127.0.0.1/api/modules/assistant/mcp";
const TOKEN = "test-mcp-token";

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "test-key";
const DB_PATH = path.join(
  os.tmpdir(),
  `openpcb-mcp-${Date.now()}-${crypto.randomUUID()}.sqlite`,
);
process.env.OPENPCB_DB_PATH = DB_PATH;

const tempDirs: string[] = [];

async function writeModule(
  workspace: string,
  moduleId: string,
  manifest: Record<string, unknown>,
  backendEntrySource: string,
): Promise<void> {
  const moduleDir = path.join(workspace, "modules", moduleId);
  await mkdir(moduleDir, { recursive: true });
  await writeFile(
    path.join(moduleDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(moduleDir, "module.backend.mjs"),
    backendEntrySource,
    "utf8",
  );
  await cp(
    path.resolve(import.meta.dir, "../../../modules", moduleId, "backend/migrations"),
    path.join(moduleDir, "backend", "migrations"),
    { recursive: true },
  );
}

function baseManifest(moduleId: string): Record<string, unknown> {
  return {
    id: moduleId,
    label: moduleId,
    version: "1.0.0",
    apiVersion: 2,
    namespace: `space.${moduleId}`,
    kind: "space",
    sidebar: { label: moduleId, icon: "Box", order: 10 },
    runtime: { backendEntry: "module.backend.mjs" },
    dependsOn: [],
  };
}

async function boot(): Promise<ReturnType<typeof createHttpServer>> {
  process.env.OPENPCB_DB_PATH = DB_PATH;
  resetSharedSqliteForTesting();
  resetTaskRuntimeForTesting();
  resetAssistantServiceForTesting();

  const workspace = await mkdtemp(path.join(os.tmpdir(), "openpcb-mcp-"));
  tempDirs.push(workspace);
  await mkdir(path.join(workspace, "modules"), { recursive: true });

  await writeModule(
    workspace,
    "tasks",
    { ...baseManifest("tasks"), kind: "tool" },
    `
    import { initializeTaskRuntime } from "../../../../../src/modules/tasks/backend/runtime-singleton";
    import { buildTasksSdk } from "../../../../../src/modules/tasks/backend/sdk";
    export default {
      id: "tasks",
      async onActivate(ctx) { await initializeTaskRuntime(ctx); },
      registerSdk(ctx) { ctx.sdk.registerValue("TasksSDK", buildTasksSdk()); },
    };
  `,
  );

  await writeModule(
    workspace,
    "assistant",
    {
      ...baseManifest("assistant"),
      dependsOn: [{ id: "tasks", minVersion: "0.1.0", optional: false }],
    },
    `
    import { initializeAssistantService } from "../../../../../src/modules/assistant/backend/assistant-service";
    import { registerRoutes } from "../../../../../src/modules/assistant/backend/routes";
    export default {
      id: "assistant",
      onActivate(ctx) { initializeAssistantService(ctx); },
      registerRoutes(router, ctx) { registerRoutes(router, ctx); },
    };
  `,
  );

  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: workspace,
  });
  await moduleRuntime.bootstrap();

  return createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
}

/** One JSON-RPC POST with the headers a real MCP client sends. */
function rpc(
  body: unknown,
  init: { token?: string | null; origin?: string; sessionId?: string } = {},
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Streamable HTTP requires the client to accept both.
    accept: "application/json, text/event-stream",
    "x-openpcb-mcp-client": "test-client",
  };
  const token = init.token === undefined ? TOKEN : init.token;
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.origin) headers.origin = init.origin;
  if (init.sessionId) headers["mcp-session-id"] = init.sessionId;
  return new Request(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "Test Client", version: "1.0.0" },
  },
};

/** Streamable HTTP may answer with JSON or a single SSE event; accept both. */
async function readRpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(text) as Record<string, unknown>;
  }
  const dataLine = text
    .split("\n")
    .find((line) => line.startsWith("data:"));
  if (!dataLine) throw new Error(`No SSE data frame in: ${text}`);
  return JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
}

beforeEach(() => {
  process.env.OPENPCB_MCP_TOKEN = TOKEN;
  // The route is gated on the mcp.server dev flag; NODE_ENV is not
  // "production" under bun test, so it is on. Assert rather than assume.
  delete process.env.OPENPCB_FEATURE_MCP_SERVER;
});

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("assistant MCP endpoint", () => {
  test("is disabled until the setting is turned on", async () => {
    const server = await boot();
    const response = await server.fetch(rpc(INITIALIZE));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("disabled");
  });

  test("rejects a request with no bearer token", async () => {
    const server = await boot();
    getAssistantService().updateSettings({ mcpEnabled: true });

    const response = await server.fetch(rpc(INITIALIZE, { token: null }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  test("rejects a wrong bearer token", async () => {
    const server = await boot();
    getAssistantService().updateSettings({ mcpEnabled: true });

    const response = await server.fetch(rpc(INITIALIZE, { token: "nope" }));
    expect(response.status).toBe(401);
  });

  test("rejects a non-loopback Origin (DNS rebinding guard)", async () => {
    const server = await boot();
    getAssistantService().updateSettings({ mcpEnabled: true });

    const response = await server.fetch(
      rpc(INITIALIZE, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
  });

  test("initializes and lists read tools, hiding writes by default", async () => {
    const server = await boot();
    getAssistantService().updateSettings({ mcpEnabled: true });

    const initResponse = await server.fetch(rpc(INITIALIZE));
    expect(initResponse.status).toBe(200);
    const initBody = await readRpc(initResponse);
    expect(initBody.error).toBeUndefined();

    const sessionId = initResponse.headers.get("mcp-session-id") ?? undefined;

    await server.fetch(
      rpc(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { sessionId },
      ),
    );

    const listResponse = await server.fetch(
      rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { sessionId }),
    );
    expect(listResponse.status).toBe(200);
    const listBody = await readRpc(listResponse);
    const tools = (
      listBody.result as { tools: Array<{ name: string }> }
    ).tools.map((t) => t.name);

    // Extended read tools are MCP-only and must be present.
    expect(tools).toContain("designer_list_designs");
    expect(tools).toContain("designer_run_drc");
    expect(tools).toContain("designer_get_bom");
    // Session-scoped pin tool.
    expect(tools).toContain("designer_use_design");
    // Projected library reads.
    expect(tools).toContain("library_search_components");
    // Writes are off by default, so they must not be advertised at all.
    expect(tools).not.toContain("designer_propose_schematic_wires");
    expect(tools).not.toContain("designer_propose_schematic_deletions");
  });

  test("advertises write tools once mcpAllowWrites is granted", async () => {
    const server = await boot();
    getAssistantService().updateSettings({
      mcpEnabled: true,
      mcpAllowWrites: true,
    });

    const initResponse = await server.fetch(rpc(INITIALIZE));
    const sessionId = initResponse.headers.get("mcp-session-id") ?? undefined;
    await server.fetch(
      rpc(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { sessionId },
      ),
    );

    const listBody = await readRpc(
      await server.fetch(
        rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { sessionId }),
      ),
    );
    const tools = (
      listBody.result as { tools: Array<{ name: string }> }
    ).tools.map((t) => t.name);

    expect(tools).toContain("designer_propose_schematic_wires");
    expect(tools).toContain("designer_create_design");
  });

  test("writes cannot be enabled while the server is off", async () => {
    const server = await boot();
    const settings = getAssistantService().updateSettings({
      mcpEnabled: false,
      mcpAllowWrites: true,
    });
    expect(settings.mcpAllowWrites).toBe(false);
  });

  test("calling a read tool returns a structured result", async () => {
    const server = await boot();
    getAssistantService().updateSettings({ mcpEnabled: true });

    const initResponse = await server.fetch(rpc(INITIALIZE));
    const sessionId = initResponse.headers.get("mcp-session-id") ?? undefined;
    await server.fetch(
      rpc(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { sessionId },
      ),
    );

    const callBody = await readRpc(
      await server.fetch(
        rpc(
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "designer_list_designs", arguments: {} },
          },
          { sessionId },
        ),
      ),
    );

    // The designer module is not booted in this workspace, so the tool reports
    // its absence rather than throwing — the contract that matters here is that
    // the call round-trips as a well-formed MCP result.
    const result = callBody.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.content[0]?.type).toBe("text");
    expect(callBody.error).toBeUndefined();
  });

  test("advertises design resources and guided prompts", async () => {
    const server = await boot();
    getAssistantService().updateSettings({ mcpEnabled: true });

    const initResponse = await server.fetch(rpc(INITIALIZE));
    const sessionId = initResponse.headers.get("mcp-session-id") ?? undefined;
    await server.fetch(
      rpc(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { sessionId },
      ),
    );

    const templatesBody = await readRpc(
      await server.fetch(
        rpc(
          { jsonrpc: "2.0", id: 4, method: "resources/templates/list" },
          { sessionId },
        ),
      ),
    );
    const templates = (
      templatesBody.result as {
        resourceTemplates: Array<{ uriTemplate: string }>;
      }
    ).resourceTemplates.map((t) => t.uriTemplate);
    expect(templates).toContain("openpcb://design/{designId}/{kind}");

    const promptsBody = await readRpc(
      await server.fetch(
        rpc({ jsonrpc: "2.0", id: 5, method: "prompts/list" }, { sessionId }),
      ),
    );
    const prompts = (
      promptsBody.result as { prompts: Array<{ name: string }> }
    ).prompts.map((p) => p.name);
    // The build workflow needs write tools, so it is only offered with writes on.
    expect(prompts).not.toContain("openpcb-build-circuit");
    expect(prompts).toContain("openpcb-review-schematic");
    expect(prompts).toContain("openpcb-drc-triage");
    expect(prompts).toContain("openpcb-bom-check");
  });

  test("one client keeps one backing chat across reconnects", async () => {
    const server = await boot();
    const service = getAssistantService();
    service.updateSettings({ mcpEnabled: true });

    await server.fetch(rpc(INITIALIZE));
    await server.fetch(rpc(INITIALIZE));

    const mcpChats = service.conversation
      .listChats()
      .filter((chat) => Boolean((chat.metadata as { mcp?: unknown })?.mcp));
    expect(mcpChats).toHaveLength(1);
    expect(mcpChats[0]?.title).toBe("MCP · Test Client");
  });
});
