import { describe, expect, test } from "bun:test";
import { request } from "node:http";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { DEFAULT_JSON_BODY_LIMIT } from "../http/local-api-security";
import { ModuleRouter } from "../router/module-router";
import { ModuleRouterRegistry } from "../router/module-registry";

const TOKEN = "a".repeat(64);
const MCP_TOKEN = "mcp-separate-canary";
const ORIGIN = "http://127.0.0.1:4567";
const RENDERER = "http://127.0.0.1:1420";

function fixture(configured = true, opaque = false, port = 4567) {
  const registry = new ModuleRouterRegistry();
  let calls = 0;
  for (const id of ["assistant", "tasks"]) {
    const router = new ModuleRouter(id);
    for (const path of ["/work", "/providers", "/providers/probe", "/events"]) {
      const handler = async () => { calls++; return Response.json({ ok: true }); };
      router.get(path, handler);
      router.post(path, handler);
    }
    if (id === "assistant") {
      router.post("/mcp", async (ctx) => ctx.req.headers.get("authorization") === `Bearer ${MCP_TOKEN}`
        ? Response.json({ mcp: true }) : new Response(null, { status: 401 }));
    }
    registry.register(router);
  }
  const server = createHttpServer({ host: "127.0.0.1", port, moduleRegistry: registry,
    diagnosticsStore: new DiagnosticsStore(),
    ...(configured ? { localApi: { token: TOKEN, rendererOrigins: [RENDERER], allowOpaqueOrigin: opaque } } : {}),
  });
  return { server, calls: () => calls };
}

function apiRequest(path: string, headers: Record<string, string> = {}, body?: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { "X-OpenPCB-Token": TOKEN, ...headers }, ...(body === undefined ? {} : { body }) });
}

describe("per-launch local application boundary", () => {
  test("guards all assistant/task operations, provider probes and SSE before work", async () => {
    const { server, calls } = fixture();
    for (const module of ["assistant", "tasks"]) {
      for (const path of ["work", "providers", "providers/probe", "events"]) {
        for (const token of ["", "wrong", "b".repeat(64), MCP_TOKEN]) {
          const response = await server.fetch(apiRequest(`/api/modules/${module}/${path}`, { "X-OpenPCB-Token": token }));
          expect(response.status).toBe(401);
          expect(await response.text()).not.toContain(TOKEN);
        }
      }
    }
    expect(calls()).toBe(0);
    expect((await server.fetch(apiRequest("/api/modules/assistant/work"))).status).toBe(200);
    expect(calls()).toBe(1);
  });

  test("legacy, encoded and alternate aliases cannot bypass authentication", async () => {
    const { server, calls } = fixture();
    for (const path of ["/api/assistant/providers", "/api/tasks/events", "/assistant/work", "/tasks/work",
      "/api/modules/%61ssistant/providers", "/api/modules/tasks%2Fevents"]) {
      const response = await server.fetch(apiRequest(path, { "X-OpenPCB-Token": "" }));
      expect(response.status).toBe(401);
    }
    expect((await server.fetch(apiRequest("/api/modules/assistant/%ZZ", { "X-OpenPCB-Token": "" }))).status).toBe(401);
    expect((await server.fetch(apiRequest("/api/modules/assistant/%ZZ"))).status).toBe(404);
    expect(calls()).toBe(0);
  });

  test("missing configuration fails closed despite obsolete unauthenticated flag; health stays public", async () => {
    const previous = process.env.OPENPCB_ALLOW_UNAUTHENTICATED_API;
    process.env.OPENPCB_ALLOW_UNAUTHENTICATED_API = "true";
    try {
      const { server, calls } = fixture(false);
      expect((await server.fetch(apiRequest("/api/modules/assistant/work"))).status).toBe(401);
      expect((await server.fetch(new Request(`${ORIGIN}/api/health`))).status).toBe(200);
      expect(calls()).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.OPENPCB_ALLOW_UNAUTHENTICATED_API;
      else process.env.OPENPCB_ALLOW_UNAUTHENTICATED_API = previous;
    }
  });

  test("exact Host and Origin are required; token never authorizes hostile origins", async () => {
    const { server, calls } = fixture();
    for (const host of ["evil.test:4567", "localhost:4567", "127.0.0.1:4568", "127.0.0.1.evil.test:4567", ""]) {
      expect((await server.fetch(apiRequest("/api/modules/assistant/work", { host }))).status).toBe(403);
    }
    for (const origin of ["http://evil.test", "http://127.0.0.1:1421", "http://localhost:1420", "null", "file://", `${RENDERER}/path`]) {
      expect((await server.fetch(apiRequest("/api/modules/assistant/work", { origin }))).status).toBe(403);
    }
    expect(calls()).toBe(0);
    expect((await server.fetch(apiRequest("/api/modules/assistant/work", { origin: RENDERER }))).status).toBe(200);
    expect((await server.fetch(apiRequest("/api/modules/assistant/work", { origin: ORIGIN }))).status).toBe(200);
    const opaque = fixture(true, true);
    expect((await opaque.server.fetch(apiRequest("/api/modules/assistant/work", { origin: "null" }))).status).toBe(200);
    expect((await opaque.server.fetch(apiRequest("/api/modules/assistant/work", { origin: "null", "X-OpenPCB-Token": "" }))).status).toBe(401);
  });

  test("valid preflight skips no application checks for subsequent requests", async () => {
    const { server, calls } = fixture();
    const response = await server.fetch(new Request(`${ORIGIN}/api/modules/assistant/work`, {
      method: "OPTIONS", headers: { origin: RENDERER, "Access-Control-Request-Headers": "X-OpenPCB-Token" },
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("X-OpenPCB-Token");
    expect(calls()).toBe(0);
    const denied = await server.fetch(apiRequest("/api/modules/assistant/work", { origin: RENDERER, "X-OpenPCB-Token": "" }));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("access-control-allow-origin")).toBe(RENDERER);
  });

  test("MCP token cannot authorize REST; application token cannot authorize MCP", async () => {
    const { server, calls } = fixture();
    expect((await server.fetch(apiRequest("/api/modules/assistant/work", { "X-OpenPCB-Token": "", authorization: `Bearer ${MCP_TOKEN}` }))).status).toBe(401);
    expect((await server.fetch(apiRequest("/api/modules/assistant/mcp", { authorization: `Bearer ${TOKEN}` }, "{}"))).status).toBe(401);
    expect((await server.fetch(apiRequest("/api/modules/assistant/mcp", { "X-OpenPCB-Token": "", authorization: `Bearer ${MCP_TOKEN}` }, "{}"))).status).toBe(200);
    expect((await server.fetch(apiRequest("/api/modules/assistant/mcp", { origin: "http://evil.test", authorization: `Bearer ${MCP_TOKEN}` }, "{}"))).status).toBe(403);
    expect(calls()).toBe(0);
  });

  test("wrong token is rejected before body consumption or parsing", async () => {
    const { server, calls } = fixture();
    const request = apiRequest("/api/modules/assistant/work", { "X-OpenPCB-Token": "wrong", "content-type": "application/json" }, "not json");
    expect((await server.fetch(request)).status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(calls()).toBe(0);
  });

  test("query tokens do not authorize work; application token never appears in request logs or diagnostics", async () => {
    const { server, calls } = fixture();
    const previousEnvironment = process.env.NODE_ENV;
    const previousInfo = console.info;
    const logs: string[] = [];
    process.env.NODE_ENV = "development";
    console.info = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
    try {
      const response = await server.fetch(apiRequest(`/api/modules/assistant/work?token=${TOKEN}`, { "X-OpenPCB-Token": "" }));
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(TOKEN);
      const accepted = await server.fetch(apiRequest("/api/modules/assistant/work"));
      expect(accepted.status).toBe(200);
      expect(await accepted.text()).not.toContain(TOKEN);
      const diagnostics = await server.fetch(new Request(`${ORIGIN}/api/diagnostics`));
      expect(await diagnostics.text()).not.toContain(TOKEN);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join("\n")).not.toContain(TOKEN);
      expect(calls()).toBe(1);
    } finally {
      console.info = previousInfo;
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
    }
  });

  test("malformed, advertised oversized and chunked oversized bodies cannot reach work", async () => {
    const { server, calls } = fixture();
    expect((await server.fetch(apiRequest("/api/modules/assistant/work", { "content-type": "application/json" }, "{"))).status).toBe(400);
    expect((await server.fetch(apiRequest("/api/modules/assistant/work", { "content-length": String(DEFAULT_JSON_BODY_LIMIT + 1) }, "{}"))).status).toBe(413);
    for (const contentType of ["application/json", "multipart/form-data; boundary=test", "text/plain"]) {
      expect((await server.fetch(apiRequest("/api/modules/assistant/work", { "content-type": contentType }, "x".repeat(DEFAULT_JSON_BODY_LIMIT + 1)))).status).toBe(413);
    }
    expect(calls()).toBe(0);
    expect((await server.fetch(apiRequest("/api/modules/assistant/work", { "content-type": "application/json" }, "{}"))).status).toBe(200);
  });

  test("real Node listener binds port-zero checks to actual port; token works without Origin", async () => {
    const { server, calls } = fixture(true, false, 0);
    const started = await server.start();
    const url = `http://${started.hostname}:${started.port}/api/modules/assistant/work`;
    try {
      expect((await fetch(url, { headers: { "X-OpenPCB-Token": TOKEN } })).status).toBe(200);
      expect((await fetch(url)).status).toBe(401);
      const hostile = await new Promise<number>((resolve, reject) => {
        const outgoing = request(url, { headers: { Host: "evil.test", "X-OpenPCB-Token": TOKEN } }, (incoming) => {
          incoming.resume(); resolve(incoming.statusCode ?? 0);
        });
        outgoing.on("error", reject); outgoing.end();
      });
      expect(hostile).toBe(403);
      expect(calls()).toBe(1);
    } finally { await started.close(); }
  });
});
