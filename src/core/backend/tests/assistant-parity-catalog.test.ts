import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { AI_PROVIDER_PRESETS, type AiRunEvent } from "@openpcb/ai-core";
import { buildAiProviderClient, providerRequiresApiKey } from "../../../modules/assistant/backend/providers/openpcb-provider-factory";
import { isolatedDomain, type ParityDomain } from "./fixtures/assistant-parity/domain";
import { captureCatalog, canonicalJson, mcpSession, readRpc, rpcRequest } from "./fixtures/assistant-parity/catalog";

let domain: ParityDomain;
let previousToken: string | undefined;
beforeEach(async () => {
  previousToken = process.env.OPENPCB_MCP_TOKEN;
  domain = await isolatedDomain();
});
afterEach(async () => {
  await domain?.close();
  if (previousToken === undefined) delete process.env.OPENPCB_MCP_TOKEN;
  else process.env.OPENPCB_MCP_TOKEN = previousToken;
});

describe("OPENPCB-112 actual public contract snapshots", () => {
  test("native catalogs, MCP schemas/prompts/resources and migrated SQLite DDL match pinned fixture", async () => {
    await domain.service.providers.updateProvider("lmstudio", { apiKey: "PARITY_SECRET_CANARY_704b4b9c" });
    const actual = await captureCatalog(domain);
    const expected: unknown = await Bun.file(path.join(import.meta.dir, "fixtures/assistant-parity/catalog.current.json")).json();
    expect(canonicalJson(actual)).toBe(canonicalJson(expected));
    const legacy = await Bun.file(path.join(import.meta.dir, "fixtures/assistant-parity/catalog.json")).json() as typeof actual;
    expect(actual.data.inAppTools).toEqual(legacy.data.inAppTools);
    expect(actual.data.mcpReadOnly).toEqual(legacy.data.mcpReadOnly);
    expect(actual.data.mcpWithWrites).toEqual(legacy.data.mcpWithWrites);
    expect(canonicalJson(actual)).not.toContain("PARITY_SECRET_CANARY_704b4b9c");
    const read = actual.data.mcpReadOnly.tools.map((tool) => tool.name);
    const writes = actual.data.mcpWithWrites.tools.map((tool) => tool.name);
    for (const tool of actual.data.inAppTools.filter((tool) => tool.effect === "write")) {
      expect(read).not.toContain(tool.name);
      expect(writes).toContain(tool.name);
    }
    expect(read).toContain("designer_run_drc");
    expect(actual.data.inAppTools.map((tool) => tool.name)).not.toContain("designer_run_drc");
  });

  test("all installed API-key/local provider kinds preserve actual tool wire contract without paid calls", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:43210/v1/chat/completions");
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const delta = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "wire-call", type: "function", function: { name: "designer_get_design_summary", arguments: "{}" } }] }, finish_reason: null }] };
      const done = { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
      return new Response(`data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    try {
      for (const kind of AI_PROVIDER_PRESETS.map((preset) => preset.kind)) {
        const config = await domain.service.providers.createProvider({ kind, label: `Fixture ${kind}`, baseUrl: "http://127.0.0.1:43210/v1", apiKey: "fixture-key-not-a-user-secret", defaultModel: "fixture-model", enabled: true });
        const internal = domain.service.providers.getProviderInternal(config.id)!;
        expect(providerRequiresApiKey(internal)).toBe(kind === "openai" || kind === "openrouter");
        const client = await buildAiProviderClient(internal, {
          resolveApiKey: (provider) => domain.service.providers.resolveApiKey(provider),
        });
        const events: AiRunEvent[] = [];
        for await (const event of client.streamChat({ runId: `provider-${kind}`, model: "fixture-model", messages: [{ role: "user", content: "Inspect design" }], tools: domain.registry.listDefinitions() })) events.push(event);
        const completed = events.find((event) => event.type === "run.message.completed");
        expect(completed?.type === "run.message.completed" ? completed.data.toolCalls : []).toEqual([{ id: "wire-call", name: "designer_get_design_summary", argumentsJson: "{}" }]);
        expect(events.some((event) => event.type === "run.failed")).toBe(false);
      }
      expect(bodies).toHaveLength(AI_PROVIDER_PRESETS.length);
      for (const body of bodies) {
        expect(body.model).toBe("fixture-model");
        expect(body.stream).toBe(true);
        expect(body.tools).toHaveLength(domain.registry.size());
      }
    } finally { globalThis.fetch = originalFetch; }
  });

  test("MCP rejects absent bearer and hides writes; reconnect stays actor-isolated", async () => {
    const token = "parity-mcp-token";
    process.env.OPENPCB_MCP_TOKEN = token;
    domain.service.settings.updateSettings({ mcpEnabled: true, mcpAllowWrites: false });
    const absentBearer = rpcRequest("tools/list", token);
    absentBearer.headers.delete("authorization");
    expect((await domain.service.mcp.fetch(absentBearer)).status).toBe(401);
    const rejected = await domain.service.mcp.fetch(rpcRequest("tools/list", "wrong-token"));
    expect(rejected.status).toBe(401);
    const actorA = await mcpSession(domain, token, "actor-a");
    const actorB = await mcpSession(domain, token, "actor-b");
    const a = domain.service.conversation.listChats().find((chat) => JSON.stringify(chat.metadata).includes("actor-a"))!;
    const b = domain.service.conversation.listChats().find((chat) => JSON.stringify(chat.metadata).includes("actor-b"))!;
    expect(a.id).not.toBe(b.id);
    const designA = await domain.designer.createDesign({ name: "Actor A" });
    const designB = await domain.designer.createDesign({ name: "Actor B" });
    await actorA("tools/call", { name: "designer_use_design", arguments: { designId: designA.id } });
    await actorB("tools/call", { name: "designer_use_design", arguments: { designId: designB.id } });
    expect(domain.service.contextResolver.getPrimaryDesign(a.id)!.refId).toBe(designA.id);
    expect(domain.service.contextResolver.getPrimaryDesign(b.id)!.refId).toBe(designB.id);
    const count = domain.service.conversation.listChats().length;
    await domain.service.mcp.close();
    await mcpSession(domain, token, "actor-a");
    expect(domain.service.conversation.listChats()).toHaveLength(count);
    expect(domain.service.conversation.getChat(a.id)).not.toBeNull();
    const denied = await domain.service.mcp.fetch(rpcRequest("tools/call", token, undefined, {
      name: "designer_place_components", arguments: { components: [{ componentId: domain.componentId }] },
    }, "actor-a"));
    await expect(readRpc(denied)).rejects.toThrow("Tool designer_place_components not found");
    expect((await domain.designer.getSchematicProjection(designA.id))!.revision).toBe(0);
    expect((await domain.designer.getSchematicProjection(designB.id))!.revision).toBe(0);
  });
});
