import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REST_ROUTES } from "agentkit/contracts";
import type { ModuleRouterHandle } from "../../../contracts/modules/backend-module";
import { GENERIC_AGENTKIT_OPERATIONS } from "../../../../modules/assistant/backend/agentkit-routes";
import { createAssistantModuleDefinition } from "../../../../modules/assistant/backend";
import { definition as tasksDefinition } from "../../../../modules/tasks/backend";
import {
  isolatedHttpDomain,
  TOKEN,
  waitUntil,
  type HttpDomain,
} from "./agentkit-http-domain";
import { boundChat, placement } from "./agentkit-http-scenarios";

let domain: HttpDomain | undefined;
afterEach(async () => {
  await domain?.close();
  domain = undefined;
});

interface Frame {
  id: string;
  event: string;
  data: { seq: number; type: string };
}

/** Reads SSE frames until the stream ends or `stop` says enough; aborts the connection when stopping early. */
async function readFrames(response: Response, stop?: (frames: Frame[]) => boolean): Promise<Frame[]> {
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const lines = buffer.slice(0, end).split("\n");
      buffer = buffer.slice(end + 2);
      const field = (name: string) => lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);
      const id = field("id");
      if (id) frames.push({ id, event: field("event")!, data: JSON.parse(field("data")!) as Frame["data"] });
    }
    if (stop?.(frames)) {
      await reader.cancel();
      break;
    }
  }
  return frames;
}

test("SSE reconnect from a cursor mid-run replays then tails identical ordered events through final verification", async () => {
  const place = placement("replay-place", 2);
  domain = await isolatedHttpDomain([{ calls: [place] }, { content: "Placed for replay" }]);
  place.arguments.components.push({ componentId: domain.componentId, quantity: 2 });
  const { chatId, designId } = await boundChat(domain);
  place.arguments.action_id = `place_replay_stream_${designId}`;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = domain.designer.dispatchOperation.bind(domain.designer);
  domain.designer.dispatchOperation = async (...args) => { await gate; return original(...args); };
  const submitted = await domain.request(`/v1/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Idempotency-Key": "replay-stream" },
    body: JSON.stringify({ content: "Place for replay" }),
  });
  assert.equal(submitted.status, 201);
  const { runId } = (await submitted.json()) as { runId: string };
  const stream = (headers: Record<string, string> = {}) =>
    domain!.request(`/v1/runs/${runId}/stream`, { headers });

  const before = await readFrames(await stream(), (frames) =>
    frames.some((frame) => frame.event === "run.tool.requested"));
  assert.ok(before.length > 0);
  assert.equal(before.some((frame) => frame.event === "run.verification"), false);
  // Reconnect while the run is still held: the stream must hand off from replay to the live tail.
  const live = readFrames(await stream({ "Last-Event-ID": before.at(-1)!.id }));
  assert.notEqual((await domain.service.host.store.tasks.getTask(runId))?.status, "completed");
  release();
  const resumed = await live;
  await waitUntil(async () => (await domain!.service.host.store.tasks.getTask(runId))?.status === "completed");
  const full = await readFrames(await stream());
  const replay = await readFrames(await stream());

  const durable = await domain.service.host.store.tasks.listEvents(runId);
  const ids = (frames: Frame[]) => frames.map((frame) => frame.id);
  assert.deepEqual(ids(full), durable.map((event) => event.eventId));
  assert.deepEqual([...ids(before), ...ids(resumed)], ids(full));
  assert.deepEqual(replay, full);
  const seqs = full.map((frame) => frame.data.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, seqs.length);
  const verification = resumed.filter((frame) => frame.event === "run.verification").at(-1);
  assert.ok(verification && JSON.stringify(verification.data).includes('"status":"pass"'));
  assert.deepEqual(verification, full.filter((frame) => frame.event === "run.verification").at(-1));
  const mid = Math.floor(full.length / 2);
  assert.deepEqual(await readFrames(await stream({ "Last-Event-ID": full[mid]!.id })), full.slice(mid + 1));
});

interface RouteRow {
  method: string;
  path: string;
  owner: string;
  guard: string;
}

const MCP_GUARD = "Host + Origin, own MCP bearer (app token ignored)";
const APP_GUARD = "Host + Origin + app token, before body or handler";

/** Records what the module definitions register, so routes added outside the AgentKit adapter count too. */
async function recordRoutes(current: HttpDomain): Promise<RouteRow[]> {
  const contract = new Map<string, string>(Object.entries(REST_ROUTES).map(([operation, route]) =>
    [`${route.method} ${route.path}`, operation]));
  const generic = new Set<string>(GENERIC_AGENTKIT_OPERATIONS);
  const rows: RouteRow[] = [];
  const record = (method: string) => (route: string) => {
    const operation = contract.get(`${method} ${route}`);
    rows.push({
      method,
      path: `/api/modules/assistant${route}`,
      owner: route === "/mcp" ? "AgentKit MCP server adapter"
        : operation && generic.has(operation) ? `AgentKit REST \`${operation}\``
        : operation ? `OpenPCB adapter over AgentKit \`${operation}\`` : "OpenPCB app adapter",
      guard: route === "/mcp" ? MCP_GUARD : APP_GUARD,
    });
  };
  const recorder: ModuleRouterHandle = {
    get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"),
  };
  assert.equal(tasksDefinition.registerRoutes, undefined, "tasks module registers no routes");
  const assistant = createAssistantModuleDefinition({
    agentkit: { ...current.options, databasePath: path.join(current.directory, "agentkit-routes.sqlite") },
  });
  await assistant.onActivate!(current.ctx);
  try {
    await assistant.registerRoutes!(recorder, current.ctx);
  } finally {
    await assistant.onDeactivate?.(current.ctx);
  }
  return rows;
}

function renderTable(rows: RouteRow[]): string {
  const sorted = [...rows].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return ["| Method | Path | Owner | Guard |", "| --- | --- | --- | --- |",
    ...sorted.map((row) => `| ${row.method} | \`${row.path}\` | ${row.owner} | ${row.guard} |`)].join("\n");
}

test("every registered assistant/tasks route is owner-classified in docs and guarded before work", async () => {
  domain = await isolatedHttpDomain();
  const rows = await recordRoutes(domain);
  const keys = rows.map((row) => `${row.method} ${row.path}`);
  assert.equal(new Set(keys).size, keys.length, "no duplicate or shadow route registrations");
  for (const operation of GENERIC_AGENTKIT_OPERATIONS)
    assert.ok(rows.some((row) => row.owner === `AgentKit REST \`${operation}\``), operation);

  const doc = await readFile(path.resolve("docs/assistant/compatibility.md"), "utf8");
  const section = /<!-- route-ownership:start -->\n([\s\S]*?)\n<!-- route-ownership:end -->/.exec(doc)?.[1];
  assert.equal(section, renderTable(rows), `Update docs/assistant/compatibility.md route table:\n${renderTable(rows)}`);

  // MCP live, so its routes reach the bearer check instead of the disabled-server 503.
  const previousMcpToken = process.env.OPENPCB_MCP_TOKEN;
  process.env.OPENPCB_MCP_TOKEN = "mcp-route-table-canary";
  domain.service.host.settings.updateSettings({ mcpEnabled: true });
  const chatsBefore = (await domain.service.host.store.conversations.listChats()).length;
  try {
    await assertRoutesGuarded(domain, rows);
  } finally {
    if (previousMcpToken === undefined) delete process.env.OPENPCB_MCP_TOKEN;
    else process.env.OPENPCB_MCP_TOKEN = previousMcpToken;
  }
  assert.equal((await domain.service.host.store.conversations.listChats()).length, chatsBefore);
  assert.equal(domain.provider.requests.length, 0);
});

const OVERSIZED = JSON.stringify({ content: "x".repeat(2 * 1024 * 1024) });

async function assertRoutesGuarded(current: HttpDomain, rows: RouteRow[]): Promise<void> {
  for (const row of rows) {
    const target = row.path.replace(/:[A-Za-z]+/g, "x");
    const send = (origin: string, headers: Record<string, string>, body = "{}") => current.server.fetch(new Request(`${origin}${target}`, {
      method: row.method, headers: { "content-type": "application/json", ...headers },
      ...(row.method === "GET" ? {} : { body }),
    }));
    const label = `${row.method} ${row.path}`;
    assert.equal((await send("http://127.0.0.1:3000", { "X-OpenPCB-Token": TOKEN, Origin: "https://evil.example" })).status, 403, label);
    assert.equal((await send("http://evil.example:3000", { "X-OpenPCB-Token": TOKEN })).status, 403, label);
    assert.equal((await send("http://127.0.0.1:3000", { "X-OpenPCB-Token": "b".repeat(64) })).status, 401, label);
    assert.equal((await send("http://127.0.0.1:3000", {})).status, 401, label);
    if (row.method !== "GET" && row.guard === APP_GUARD) {
      // A body the handler would reject (400) or cap (413) proves nothing unless the guard answers first.
      assert.equal((await send("http://127.0.0.1:3000", {}, "{")).status, 401, label);
      assert.equal((await send("http://127.0.0.1:3000", {}, OVERSIZED)).status, 401, label);
    }
    if (row.method !== "GET" && row.guard === MCP_GUARD) {
      // MCP keeps the shared bounded-body guard ahead of its own bearer check; both refuse.
      assert.equal((await send("http://127.0.0.1:3000", {}, "{")).status, 400, label);
      assert.equal((await send("http://127.0.0.1:3000", {}, OVERSIZED)).status, 413, label);
    }
    if (row.guard === MCP_GUARD)
      assert.equal((await send("http://127.0.0.1:3000", { "X-OpenPCB-Token": TOKEN })).status, 401, label);
  }
}
