/**
 * Boots the real module runtime (designer + library + assistant + tasks +
 * knowledge, from `src/modules`) behind the real HTTP server, and speaks MCP
 * JSON-RPC to `/api/modules/assistant/mcp` the way the bundled shim does.
 *
 * Use it for MCP tests that need real designs: designer tools, proposals,
 * chat recording. Pure endpoint tests (auth, gating) can keep the lighter
 * two-module harness in `assistant-mcp-endpoint.test.ts`.
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getAssistantService,
  resetAssistantServiceForTesting,
} from "../../../../modules/assistant/backend/assistant-service";
import { resetTaskRuntimeForTesting } from "../../../../modules/tasks/backend/runtime-singleton";
import { MODULE_SDK_TOKENS, type DesignerSDK } from "../../../../sdks";
import { resetSharedSqliteForTesting } from "../../db/sqlite-client";
import { DiagnosticsStore } from "../../diagnostics/diagnostics-store";
import { createHttpServer } from "../../http/create-http-server";
import { MentionRegistry } from "../../mentions";
import { ModuleRuntime } from "../../modules/module-loader";
import { ModuleRouterRegistry } from "../../router/module-registry";

export const MCP_TOKEN = "test-mcp-token";
export const MCP_ORIGIN = "http://127.0.0.1";
export const MCP_URL = `${MCP_ORIGIN}/api/modules/assistant/mcp`;

const SRC_ROOT = path.resolve(import.meta.dir, "../../../..");
const PACK_DIR = path.resolve(SRC_ROOT, "../resources/core-library");

/**
 * The bundled CoreLibrary pack. Pinned (unpinned, the locator prefers a
 * sibling `../CoreLibrary/dist/*-dev.opclib`, which would make tests
 * machine-dependent). CI fetches the newest release; a clean checkout carries
 * an older one — take whichever is present, newest first.
 */
function bundledPack(): string | undefined {
  for (const name of [
    "openpcb-core-library-0.1.0-beta.2.opclib",
    "openpcb-core-library-0.1.0-beta.1.opclib",
  ]) {
    const candidate = path.join(PACK_DIR, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export interface McpHarness {
  server: ReturnType<typeof createHttpServer>;
  runtime: ModuleRuntime;
  designer: DesignerSDK;
  /** Turn the MCP server on, optionally with writes. */
  enable(options?: { writes?: boolean }): void;
  /** Raw JSON-RPC POST; returns the parsed JSON-RPC response body. */
  rpc(
    body: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<Record<string, unknown>>;
  listTools(headers?: Record<string, string>): Promise<Array<Record<string, unknown>>>;
  /** `tools/call`; returns the MCP `CallToolResult`. */
  callTool(
    name: string,
    args?: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<McpToolCallResult>;
  fetch(pathname: string, init?: RequestInit): Promise<Response>;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    ok: boolean;
    status: string;
    summary: string;
    warnings: string[];
    error?: { message: string };
    proposal?: {
      id: string;
      kind: string;
      status: string;
      riskLevel: string | null;
      approvalHint?: string;
    };
    data: unknown;
  };
  isError?: boolean;
}

/** Streamable HTTP may answer with JSON or SSE; return the JSON-RPC response. */
export async function readRpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(text) as Record<string, unknown>;
  }
  const frames = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
  // The response is the frame carrying `result` or `error`; progress
  // notifications may precede it.
  const final = frames.find((f) => "result" in f || "error" in f);
  if (!final) throw new Error(`No JSON-RPC response frame in: ${text}`);
  return final;
}

let requestId = 100;

export function defaultMcpHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${MCP_TOKEN}`,
    "x-openpcb-mcp-client": "claude-code",
    "x-openpcb-mcp-client-name": "Claude Code",
    "x-openpcb-mcp-instance": "instance-a",
  };
}

export async function bootMcpHarness(label: string): Promise<McpHarness> {
  process.env.OPENPCB_MCP_TOKEN = MCP_TOKEN;
  delete process.env.OPENPCB_FEATURE_MCP_SERVER;
  const pack = bundledPack();
  if (pack) process.env.OPENPCB_BUNDLED_LIBRARY_PATH = pack;
  resetSharedSqliteForTesting();
  resetTaskRuntimeForTesting();
  resetAssistantServiceForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
  MentionRegistry.init();

  const moduleRegistry = new ModuleRouterRegistry();
  const runtime = new ModuleRuntime({ moduleRegistry, workspaceRoot: SRC_ROOT });
  await runtime.bootstrap();
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime: runtime,
  });
  const designer = runtime
    .getSdkRegistry()
    .resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

  const rpc: McpHarness["rpc"] = async (body, headers) => {
    const response = await server.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: { ...defaultMcpHeaders(), ...(headers ?? {}) },
        body: JSON.stringify({ jsonrpc: "2.0", ...body }),
      }),
    );
    return readRpc(response);
  };

  return {
    server,
    runtime,
    designer,
    enable(options = {}) {
      getAssistantService().updateSettings({
        mcpEnabled: true,
        mcpAllowWrites: options.writes === true,
      });
    },
    rpc,
    async listTools(headers) {
      const body = await rpc({ id: ++requestId, method: "tools/list" }, headers);
      if (body.error) throw new Error(JSON.stringify(body.error));
      return (body.result as { tools: Array<Record<string, unknown>> }).tools;
    },
    async callTool(name, args = {}, headers) {
      const body = await rpc(
        {
          id: ++requestId,
          method: "tools/call",
          params: { name, arguments: args },
        },
        headers,
      );
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body.result as McpToolCallResult;
    },
    fetch(pathname, init) {
      return server.fetch(new Request(`${MCP_ORIGIN}${pathname}`, init));
    },
  };
}
