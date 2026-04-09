import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createHttpServer } from "../runtime/http/create-http-server";
import { DiagnosticsStore } from "../runtime/diagnostics/diagnostics-store";
import { ModuleRouter } from "../runtime/router/module-router";
import { ModuleRouterRegistry } from "../runtime/router/module-registry";
import { success } from "../runtime/http/response";

describe("routing and error contract", () => {
  test("returns problem details for missing route", async () => {
    const server = createHttpServer({ diagnosticsStore: new DiagnosticsStore() });

    const response = await server.fetch(new Request("http://localhost/unknown"));
    const body = (await response.json()) as { title: string; status: number; type: string };

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body.status).toBe(404);
    expect(body.title).toBe("Not Found");
  });

  test("validates module route params with zod", async () => {
    const diagnosticsStore = new DiagnosticsStore();
    const registry = new ModuleRouterRegistry();
    const usersModule = new ModuleRouter("users");

    usersModule.get(
      "/items/:itemId",
      async (ctx) => success({ module: ctx.moduleId, itemId: ctx.params.getOrThrow("itemId") }),
      { params: z.object({ itemId: z.string().uuid() }) },
    );

    registry.register(usersModule);

    const server = createHttpServer({ diagnosticsStore, moduleRegistry: registry });

    const invalid = await server.fetch(
      new Request("http://localhost/api/modules/users/items/not-a-uuid"),
    );
    const invalidBody = (await invalid.json()) as { status: number; title: string };
    expect(invalid.status).toBe(400);
    expect(invalidBody.title).toBe("Bad Request");

    const valid = await server.fetch(
      new Request("http://localhost/api/modules/users/items/550e8400-e29b-41d4-a716-446655440000"),
    );
    const validBody = (await valid.json()) as {
      ok: boolean;
      data?: { module: string; itemId: string };
    };
    expect(valid.status).toBe(200);
    expect(validBody.ok).toBe(true);
    expect(validBody.data?.module).toBe("users");
  });

  test("tracks errors in diagnostics store", async () => {
    const server = createHttpServer({ diagnosticsStore: new DiagnosticsStore() });

    await server.fetch(new Request("http://localhost/api/does-not-exist"));
    const diagnostics = await server.fetch(new Request("http://localhost/api/diagnostics"));
    const body = (await diagnostics.json()) as {
      ok: boolean;
      data?: { errorCount: number; recentErrors: Array<{ status: number; path: string }> };
    };

    expect(diagnostics.status).toBe(200);
    expect(body.ok).toBe(true);
    expect((body.data?.errorCount ?? 0) > 0).toBe(true);
    expect(body.data?.recentErrors[0]?.status).toBe(404);
  });
});
