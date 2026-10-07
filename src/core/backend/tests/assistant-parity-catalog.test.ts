import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import type { AiRunEvent } from "agentkit/core";
import { buildAiProviderClient, providerRequiresApiKey } from "../../../modules/assistant/backend/providers/openpcb-provider-factory";
import { isolatedDomain, type ParityDomain } from "./fixtures/assistant-parity/domain";
import { captureCatalog, canonicalJson } from "./fixtures/assistant-parity/catalog";
import { PREFERENCE_PROVIDER_KINDS } from "../../../modules/assistant/backend/agentkit/provider-preferences";

let domain: ParityDomain;
beforeEach(async () => { domain = await isolatedDomain(); });
afterEach(async () => { await domain?.close(); });

describe("canonical desktop public contracts", () => {
  test("reviewed catalog matches current snapshot and preserves all historical native input schemas", async () => {
    await domain.providers.updateProvider("lmstudio", { apiKey: "PARITY_SECRET_CANARY_704b4b9c" });
    const actual = await captureCatalog(domain);
    const expected: unknown = await Bun.file(path.join(import.meta.dir, "fixtures/assistant-parity/catalog.current.json")).json();
    expect(canonicalJson(actual)).toBe(canonicalJson(expected));
    const legacy = await Bun.file(path.join(import.meta.dir, "fixtures/assistant-parity/catalog.json")).json() as {
      data: { inAppTools: Array<{ name: string; inputSchema: unknown }> };
    };
    expect(actual.data.inAppTools.map((tool) => tool.name).sort()).toEqual(legacy.data.inAppTools.map((tool) => tool.name).sort());
    for (const tool of legacy.data.inAppTools) {
      expect(canonicalJson(actual.data.inAppTools.find((item) => item.name === tool.name)?.inputSchema)).toEqual(canonicalJson(tool.inputSchema));
    }
    expect(canonicalJson(actual)).not.toContain("PARITY_SECRET_CANARY_704b4b9c");
    expect(actual.data.mcpReadOnly.tools).toHaveLength(14);
    expect(actual.data.mcpWithWrites.tools).toHaveLength(22);
    expect(actual.data.mcpReadOnly.resources).toHaveLength(5);
    expect(actual.data.mcpWithWrites.prompts).toHaveLength(4);
    for (const tool of actual.data.inAppTools.filter((item) => item.effect === "write")) {
      expect(actual.data.mcpReadOnly.tools.map((item) => item.name)).not.toContain(tool.name);
      expect(actual.data.mcpWithWrites.tools.find((item) => item.name === tool.name)?.inputSchema).toEqual(tool.inputSchema);
    }
  });

  test("all five provider kinds retain actual native tool wire definitions without network inference", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:43210/v1/chat/completions");
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const chunk = { choices: [{ delta: { tool_calls: [{ index: 0, id: "wire-call", type: "function", function: { name: "designer_get_design_summary", arguments: "{}" } }] }, finish_reason: null }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    try {
      for (const kind of PREFERENCE_PROVIDER_KINDS) {
        const config = await domain.providers.createProvider({ kind, label: `Fixture ${kind}`, baseUrl: "http://127.0.0.1:43210/v1", apiKey: "fixture-key", defaultModel: "fixture-model", enabled: true });
        const snapshot = await domain.providers.snapshotProvider(config.id);
        expect(providerRequiresApiKey(snapshot)).toBe(kind === "openai" || kind === "openrouter");
        const client = await buildAiProviderClient(snapshot, { resolveApiKey: (provider) => domain.providers.resolveApiKey(provider) });
        const events: AiRunEvent[] = [];
        for await (const event of client.streamChat({ runId: `provider-${kind}`, model: "fixture-model", messages: [{ role: "user", content: "Inspect" }], tools: domain.registry.listDefinitions() })) events.push(event);
        const completed = events.find((event) => event.type === "run.message.completed");
        expect(completed?.type === "run.message.completed" ? completed.data.toolCalls : []).toEqual([{ id: "wire-call", name: "designer_get_design_summary", argumentsJson: "{}" }]);
      }
      expect(bodies).toHaveLength(5);
      expect(bodies.every((body) => body.model === "fixture-model" && body.stream === true)).toBe(true);
    } finally { globalThis.fetch = originalFetch; }
  });
});
