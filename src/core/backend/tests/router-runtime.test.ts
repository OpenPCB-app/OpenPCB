import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import type { RequestContext } from "../http/request-context";
import { success } from "../http/response";
import { HttpRouter } from "../router/http-router";
import { ModuleRouter } from "../router/module-router";
import { ModuleRouterRegistry } from "../router/module-registry";
import { RouteParams } from "../router/route-params";

function createContext(url: string, init?: RequestInit): RequestContext {
  const req = new Request(url, init);
  const parsedUrl = new URL(req.url);
  return {
    req,
    url: parsedUrl,
    query: parsedUrl.searchParams,
    params: new RouteParams({}),
    requestId: "test-request-id",
    signal: req.signal,
    validated: {},
  };
}

describe("runtime router behavior", () => {
  test("adds CORS headers to problem responses for trusted origins", async () => {
    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
    });

    const response = await server.fetch(
      new Request("http://localhost/api/missing", {
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(response.headers.get("x-request-id")?.length).toBeGreaterThan(0);
  });

  test("returns allow header for method not allowed", async () => {
    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
    });

    const response = await server.fetch(
      new Request("http://localhost/api/health", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  test("preserves module query string during dispatch", async () => {
    const moduleRegistry = new ModuleRouterRegistry();
    const moduleRouter = new ModuleRouter("users");
    moduleRouter.get("/items", async (ctx) =>
      success({ limit: ctx.query.get("limit") }),
    );
    moduleRegistry.register(moduleRouter);

    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
      moduleRegistry,
    });

    const response = await server.fetch(
      new Request("http://localhost/api/modules/users/items?limit=10"),
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: { limit: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.data?.limit).toBe("10");
  });

  test("prefers static routes over dynamic routes", async () => {
    const router = new HttpRouter();
    router.get("/items/:itemId", async (ctx) =>
      success({ route: "dynamic", value: ctx.params.getOrThrow("itemId") }),
    );
    router.get("/items/new", async () => success({ route: "static" }));

    const response = await router.dispatch(
      createContext("http://localhost/items/new"),
    );
    const body = (await response.json()) as { data?: { route: string } };

    expect(response.status).toBe(200);
    expect(body.data?.route).toBe("static");
  });

  test("keeps request body readable after body validation", async () => {
    const router = new HttpRouter();
    router.post(
      "/submit",
      async (ctx) => {
        const rawBody = (await ctx.req.json()) as { name: string };
        const validatedBody = ctx.validated.body as { name: string };
        return success({
          rawName: rawBody.name,
          validatedName: validatedBody.name,
        });
      },
      { body: z.object({ name: z.string().min(1) }) },
    );

    const response = await router.dispatch(
      createContext("http://localhost/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "alice" }),
      }),
    );
    const body = (await response.json()) as {
      data?: { rawName: string; validatedName: string };
    };

    expect(response.status).toBe(200);
    expect(body.data?.rawName).toBe("alice");
    expect(body.data?.validatedName).toBe("alice");
  });

  test("preserves repeated query params for zod validation", async () => {
    const router = new HttpRouter();
    router.get(
      "/search",
      async (ctx) => success({ tags: ctx.validated.query }),
      { query: z.object({ tag: z.array(z.string()) }) },
    );

    const response = await router.dispatch(
      createContext("http://localhost/search?tag=a&tag=b"),
    );
    const body = (await response.json()) as {
      data?: { tags: { tag: string[] } };
    };

    expect(response.status).toBe(200);
    expect(body.data?.tags.tag).toEqual(["a", "b"]);
  });

  test("passes matched params to module error boundaries", async () => {
    const moduleRouter = new ModuleRouter("users", async (_error, ctx) => {
      return success({ itemId: ctx.params.getOrThrow("itemId") });
    });
    moduleRouter.get("/items/:itemId", async () => {
      throw new Error("boom");
    });

    const response = await moduleRouter.dispatch(
      createContext("http://localhost/items/42"),
    );
    const body = (await response.json()) as { data?: { itemId: string } };

    expect(response.status).toBe(200);
    expect(body.data?.itemId).toBe("42");
  });
});
