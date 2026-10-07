import { createHash } from "node:crypto";
import { AI_PROVIDER_PRESETS } from "@openpcb/ai-core";
import { getSharedSqlite } from "../../../db/sqlite-client";
import type { ParityDomain } from "./domain";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function readRpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const line = response.headers.get("content-type")?.includes("text/event-stream")
    ? text.split("\n").find((item) => item.startsWith("data:"))?.slice(5).trim()
    : text;
  if (!line) throw new Error("MCP response has no JSON data frame");
  const parsed = JSON.parse(line) as Record<string, unknown>;
  if (parsed.error) throw new Error(JSON.stringify(parsed.error));
  return parsed;
}

export function rpcRequest(method: string, token: string, sessionId?: string, params?: unknown, client = "parity-catalog"): Request {
  return new Request("http://127.0.0.1/api/modules/assistant/mcp", {
    method: "POST", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`, "x-openpcb-mcp-client": client,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
}

export async function mcpSession(domain: ParityDomain, token: string, client = "parity-catalog") {
  const response = await domain.service.mcp.fetch(rpcRequest("initialize", token, undefined, {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Parity fixture", version: "1" },
  }, client));
  await readRpc(response);
  const id = response.headers.get("mcp-session-id") ?? undefined;
  return async (method: string, params?: unknown): Promise<Record<string, unknown>> =>
    readRpc(await domain.service.mcp.fetch(rpcRequest(method, token, id, params, client)));
}

async function mcpCatalog(domain: ParityDomain, token: string, writes: boolean) {
  domain.service.settings.updateSettings({ mcpEnabled: true, mcpAllowWrites: writes });
  const rpc = await mcpSession(domain, token, `parity-catalog-${writes}`);
  const tools = (await rpc("tools/list")).result as { tools: Array<{ name: string }> };
  const templates = (await rpc("resources/templates/list")).result;
  const prompts = (await rpc("prompts/list")).result as { prompts: Array<{ name: string }> };
  const bodies = [];
  for (const prompt of prompts.prompts) {
    bodies.push({ name: prompt.name, result: (await rpc("prompts/get", { name: prompt.name, arguments: { spec: "Parity fixture circuit" } })).result });
  }
  return { tools: [...tools.tools].sort((a, b) => a.name.localeCompare(b.name)), resourceTemplates: templates,
    prompts: [...prompts.prompts].sort((a, b) => a.name.localeCompare(b.name)), promptBodies: [...bodies].sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Only public definitions and DDL: no provider credentials, chats, URLs from env or user data. */
export async function captureCatalog(domain: ParityDomain) {
  const previousToken = process.env.OPENPCB_MCP_TOKEN;
  const settings = domain.service.settings.getSettings();
  const token = "parity-only-token-not-a-user-secret";
  process.env.OPENPCB_MCP_TOKEN = token;
  try {
    const data = {
      formatVersion: 1,
      scope: "Legacy desktop contracts; isolated library/designer/tasks/assistant migrations; no packaged qualification",
      providers: [...AI_PROVIDER_PRESETS].sort((a, b) => a.kind.localeCompare(b.kind)),
      inAppTools: domain.registry.listDefinitions().sort((a, b) => a.name.localeCompare(b.name)),
      mcpReadOnly: await mcpCatalog(domain, token, false),
      mcpWithWrites: await mcpCatalog(domain, token, true),
      sqliteSchema: getSharedSqlite().query<{ type: string; name: string; tbl_name: string; sql: string }, []>(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
      ).all(),
      migrations: getSharedSqlite().query<{ module_id: string; migration_name: string }, []>(
        "SELECT module_id, migration_name FROM openpcb_migrations ORDER BY module_id, migration_name",
      ).all(),
    };
    return { sha256: createHash("sha256").update(canonicalJson(data)).digest("hex"), data };
  } finally {
    domain.service.settings.updateSettings(settings);
    await domain.service.mcp.close();
    if (previousToken === undefined) delete process.env.OPENPCB_MCP_TOKEN;
    else process.env.OPENPCB_MCP_TOKEN = previousToken;
  }
}
