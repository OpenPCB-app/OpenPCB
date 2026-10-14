import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { isolatedHttpDomain, type HttpDomain } from "../agentkit-http-domain";
import { committedChange, type ProposalPresentation } from "../../../../../modules/assistant/frontend/agentkit-projections";

const MCP_TOKEN = "m".repeat(64);
const MCP_URL = "http://127.0.0.1:3000/api/modules/assistant/mcp";
let domain: HttpDomain | undefined;
let sequence = 0;
const previousToken = process.env.OPENPCB_MCP_TOKEN;

afterEach(async () => {
  mock.restoreAll();
  await domain?.close();
  domain = undefined;
  if (previousToken === undefined) delete process.env.OPENPCB_MCP_TOKEN;
  else process.env.OPENPCB_MCP_TOKEN = previousToken;
});

async function rpc(method: string, params?: unknown, sessionId?: string) {
  const response = await domain!.server.fetch(new Request(MCP_URL, { method: "POST", headers: {
    host: "127.0.0.1:3000", authorization: `Bearer ${MCP_TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream",
    ...(sessionId ? { "mcp-session-id": sessionId, "mcp-protocol-version": "2025-06-18" } : {}) },
  body: JSON.stringify({ jsonrpc: "2.0", ...(method.startsWith("notifications/") ? {} : { id: ++sequence }), method,
    ...(params === undefined ? {} : { params }) }) }));
  const text = await response.text();
  const body = response.headers.get("content-type")?.includes("text/event-stream")
    ? text.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim() : text;
  return { response, value: body ? JSON.parse(body) as Record<string, unknown> : {} };
}

async function call(sessionId: string, name: string, args: Record<string, unknown> = {}) {
  const { value } = await rpc("tools/call", { name, arguments: args }, sessionId);
  const result = value.result as { content: Array<{ text: string }>; isError?: boolean };
  const json = result.content.map((item) => item.text).reverse().find((text) => text.startsWith("{"));
  return { isError: result.isError === true, data: JSON.parse(json ?? "{}") as Record<string, unknown> };
}

test("MCP tools run on the composed host with ChatGPT globally selected and never build a provider client", async () => {
  process.env.OPENPCB_MCP_TOKEN = MCP_TOKEN;
  domain = await isolatedHttpDomain();
  const { host } = domain.service;
  await host.providers.updateProvider("openai", { enabled: true, apiKey: "sk-chatgpt-canary-0123456789abcdef", defaultModel: "gpt-5" });
  host.settings.updateSettings({ defaultProviderId: "openai", mcpEnabled: true, mcpAllowWrites: true });
  assert.equal(host.settings.getSettings().defaultProviderId, "openai");
  const outbound = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected outbound request"); });
  const design = await domain.designer.createDesign({ name: "MCP without inference" });
  const initialized = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
  assert.equal(initialized.response.status, 200);
  const session = initialized.response.headers.get("mcp-session-id")!;
  await rpc("notifications/initialized", undefined, session);
  assert.ok(((await rpc("tools/list", undefined, session)).value.result as { tools: unknown[] }).tools.length > 0);
  await rpc("prompts/get", { name: "openpcb-build-circuit", arguments: { spec: "5V capacitor" } }, session);
  await rpc("resources/read", { uri: `openpcb://design/${design.id}/schematic` }, session);
  assert.equal((await call(session, "designer_use_design", { designId: design.id })).isError, false);
  const placed = await call(session, "designer_place_components", { action_id: `place_no_inference_${design.id}`,
    components: [{ componentId: domain.componentId, quantity: 2 }] });
  assert.equal(placed.isError, false);
  assert.equal(placed.data.status, "ok");
  assert.equal((await call(session, "designer_get_schematic_connectivity")).isError, false);

  const presented = await domain.request(`/v1/proposals/${String(placed.data.proposalId)}/presentation`);
  assert.equal(presented.status, 200);
  const revision = (await domain.designer.getSchematicProjection(design.id))!.revision;
  assert.deepEqual(committedChange(await presented.json() as ProposalPresentation), { designId: design.id, revision });

  assert.deepEqual(domain.providerConfigs, []);
  assert.equal(domain.provider.requests.length, 0);
  assert.equal(outbound.mock.callCount(), 0);
  for (const chat of await host.store.conversations.listChats()) assert.equal((await host.store.tasks.listByScope(chat.id)).length, 0);
});
