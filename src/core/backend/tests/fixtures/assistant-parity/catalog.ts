import { createHash } from "node:crypto";
import { AI_PROVIDER_PRESETS } from "agentkit/core";
import { SqliteAssistantStore } from "agentkit/adapters-sqlite";
import { ProposalService, SessionWritePolicy, defaultClock, defaultIds } from "agentkit/host";
import { getSharedSqlite } from "../../../db/sqlite-client";
import { createNativeMcpEndpoint } from "../../../../../modules/assistant/backend/agentkit/native-mcp";
import { createNativeMcpProposalApplier } from "../../../../../modules/assistant/backend/agentkit/native-mcp-applier";
import { NativeMcpActors } from "../../../../../modules/assistant/backend/agentkit/native-mcp-actors";
import { PREFERENCE_PROVIDER_KINDS } from "../../../../../modules/assistant/backend/agentkit/provider-preferences";
import type { ParityDomain } from "./domain";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readRpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const line = response.headers.get("content-type")?.includes("text/event-stream")
    ? text.split("\n").find((item) => item.startsWith("data:"))?.slice(5).trim() : text;
  if (!line) throw new Error("MCP response has no JSON data frame");
  const parsed = JSON.parse(line) as Record<string, unknown>;
  if (parsed.error) throw new Error(JSON.stringify(parsed.error));
  return parsed;
}

async function mcpCatalog(domain: ParityDomain, designId: string, writes: boolean) {
  const store = new SqliteAssistantStore(":memory:");
  const settings = { mcpEnabled: true, mcpAllowWrites: writes };
  const actors = new NativeMcpActors(() => settings);
  const policy = new SessionWritePolicy();
  const applier = createNativeMcpProposalApplier({ context: domain.ctx, store, actors, contextResolver: domain.contextResolver });
  const proposals = new ProposalService({ store, applier, policy, clock: defaultClock, ids: defaultIds });
  const token = "catalog-fixture-not-a-user-secret";
  const endpoint = createNativeMcpEndpoint({ context: domain.ctx, host: { store, proposals, policy }, actors,
    contextStore: domain.contextStore, contextResolver: domain.contextResolver, getSettings: () => settings, getToken: () => token });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => endpoint.fetch(request) });
  const url = `http://127.0.0.1:${server.port}/mcp`;
  let sessionId: string | undefined;
  const request = (method: string, params?: unknown) => fetch(url, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
    ...(sessionId ? { "mcp-session-id": sessionId, "mcp-protocol-version": "2025-06-18" } : {}),
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }) });
  try {
    const initialized = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Catalog", version: "1" } });
    await readRpc(initialized);
    sessionId = initialized.headers.get("mcp-session-id") ?? undefined;
    const tools = (await readRpc(await request("tools/list"))).result as { tools: Array<{ name: string; inputSchema: unknown }> };
    const prompts = (await readRpc(await request("prompts/list"))).result as { prompts: Array<{ name: string }> };
    const bodies = [];
    for (const prompt of prompts.prompts) bodies.push({ name: prompt.name,
      result: (await readRpc(await request("prompts/get", { name: prompt.name,
        arguments: prompt.name === "openpcb-build-circuit" ? { spec: "Parity fixture circuit" } : {} }))).result });
    const resources = (await readRpc(await request("resources/list"))).result as { resources: Array<{ uri: string; name: string }> };
    return { tools: [...tools.tools].sort((a, b) => a.name.localeCompare(b.name)),
      resources: resources.resources.map((item) => ({ ...item, uri: item.uri.replace(designId, "{designId}") })).sort((a, b) => a.uri.localeCompare(b.uri)),
      resourceTemplates: { supported: false, reason: "AgentKit 0.6.0 public resource extension exposes concrete resources only." },
      prompts: [...prompts.prompts].sort((a, b) => a.name.localeCompare(b.name)),
      promptBodies: bodies.sort((a, b) => a.name.localeCompare(b.name)) };
  } finally { await endpoint.close(); server.stop(true); store.close(); }
}

/** Public definitions and DDL only; no credentials, chats, tokens or user database contents. */
export async function captureCatalog(domain: ParityDomain) {
  const designId = (await domain.designer.createDesign({ name: "Catalog design" })).id;
  const data = {
    formatVersion: 2,
    scope: "Canonical AgentKit desktop contracts; pure native domain and separate MCP store; no inference or packaged qualification",
    providers: AI_PROVIDER_PRESETS.filter((provider) => PREFERENCE_PROVIDER_KINDS.some((kind) => kind === provider.kind))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
    inAppTools: domain.registry.listDefinitions().sort((a, b) => a.name.localeCompare(b.name)),
    mcpReadOnly: await mcpCatalog(domain, designId, false),
    mcpWithWrites: await mcpCatalog(domain, designId, true),
    sqliteSchema: getSharedSqlite().query<{ type: string; name: string; tbl_name: string; sql: string }, []>(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all(),
    migrations: getSharedSqlite().query<{ module_id: string; migration_name: string }, []>(
      "SELECT module_id, migration_name FROM openpcb_migrations ORDER BY module_id, migration_name").all(),
  };
  return { sha256: createHash("sha256").update(canonicalJson(data)).digest("hex"), data };
}
