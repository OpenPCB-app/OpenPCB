import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";
import { PageRepository } from "../../../modules/knowledge/backend/db/repositories/page-repository";
import {
  PageContentConflictError,
  PageService,
} from "../../../modules/knowledge/backend/services/page-service";
import { registerRoutes } from "../../../modules/knowledge/backend/routes";
import type {
  CoreBackendModuleContext,
  ModuleRouteHandler,
  ModuleRouterHandle,
} from "../../contracts/modules/backend-module";
import type {
  EditorContent,
  Page,
} from "../../../modules/knowledge/shared/types";

const content = (text: string): EditorContent => ({
  engine: "tiptap",
  version: 1,
  data: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
});
let sqlite: Database;
let service: PageService;
let page: Page;
let clock: ReturnType<typeof spyOn>;
let db: BetterSQLite3Database<Record<string, unknown>>;
beforeEach(async () => {
  sqlite = new Database(":memory:");
  sqlite.exec(
    readFileSync(
      new URL(
        "../../../modules/knowledge/backend/migrations/0000_init.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  db = drizzle(sqlite) as unknown as BetterSQLite3Database<
    Record<string, unknown>
  >;
  service = new PageService(new PageRepository(db));
  page = await service.createPage({
    workspace_id: "default",
    title: "initial",
    content: content("initial"),
  });
  clock = spyOn(Date, "now").mockReturnValue(page.updated_at.getTime());
});
afterEach(() => {
  clock.mockRestore();
  sqlite.close();
});

describe("atomic title/body optimistic saves", () => {
  test("same-millisecond meta save invalidates old body token", async () => {
    const renamed = await service.updatePageMeta(
      page.id,
      { title: "rename" },
      page.updated_at,
    );
    expect(renamed.updated_at.getTime()).toBe(page.updated_at.getTime() + 1);
    expect(renamed.revision).toBe(page.revision + 1);
    await expect(
      service.updatePageContent(page.id, content("stale"), page.updated_at),
    ).rejects.toBeInstanceOf(PageContentConflictError);
    const saved = await service.updatePageContent(
      page.id,
      content("body"),
      renamed.updated_at,
    );
    expect(saved.updated_at.getTime()).toBe(renamed.updated_at.getTime() + 1);
    expect(saved.title).toBe("rename");
    expect(saved.content_json).toEqual(content("body"));
  });
  test("same-millisecond body save invalidates old title token", async () => {
    const saved = await service.updatePageContent(
      page.id,
      content("body"),
      page.updated_at,
    );
    await expect(
      service.updatePageMeta(page.id, { title: "stale" }, page.updated_at),
    ).rejects.toBeInstanceOf(PageContentConflictError);
    expect((await service.getPage(page.id))?.title).toBe("initial");
    expect(
      (
        await service.updatePageMeta(
          page.id,
          { title: "rename" },
          saved.updated_at,
        )
      ).content_json,
    ).toEqual(content("body"));
  });
  test("simultaneous writes using one token acknowledge exactly one mutation", async () => {
    const results = await Promise.allSettled([
      service.updatePageMeta(page.id, { title: "rename" }, page.updated_at),
      service.updatePageContent(page.id, content("body"), page.updated_at),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((await service.getPage(page.id))?.revision).toBe(page.revision + 1);
  });
  test("metadata route echoes requestId in acknowledgement and SSE; stale precondition returns 409", async () => {
    const handlers = new Map<string, ModuleRouteHandler>();
    const register =
      (method: string) => (path: string, handler: ModuleRouteHandler) => {
        handlers.set(`${method} ${path}`, handler);
      };
    const router: ModuleRouterHandle = {
      get: register("GET"),
      post: register("POST"),
      put: register("PUT"),
      patch: register("PATCH"),
      delete: register("DELETE"),
    };
    registerRoutes(router, {
      db: { db },
    } as unknown as CoreBackendModuleContext);
    const abort = new AbortController();
    const params = { get: () => page.id, getOrThrow: () => page.id };
    const stream = await handlers.get("GET /events/pages")!({
      req: new Request("http://test/events", { signal: abort.signal }),
      params,
      query: new URLSearchParams(),
    });
    const reader = stream.body!.getReader();
    await reader.read();
    try {
      const send = (title: string, requestId: string, precondition: string) =>
        handlers.get("PATCH /pages/:pageId/meta")!({
          req: new Request("http://test/meta", {
            method: "PATCH",
            headers: {
              "X-Request-Id": requestId,
              "If-Unmodified-Since": precondition,
            },
            body: JSON.stringify({ title }),
          }),
          params,
          query: new URLSearchParams(),
        });
      const result = await send(
        "rename",
        "meta-own",
        page.updated_at.toISOString(),
      );
      expect(result.status).toBe(200);
      expect((await result.json()).requestId).toBe("meta-own");
      const event = new TextDecoder().decode((await reader.read()).value);
      expect(event).toContain('"requestId":"meta-own"');
      expect(event).toContain('"type":"meta_updated"');
      const stale = await send(
        "stale",
        "stale-own",
        page.updated_at.toISOString(),
      );
      expect(stale.status).toBe(409);
      const conflict = await stale.json();
      expect(conflict.requestId).toBe("stale-own");
      expect(conflict.page.title).toBe("rename");
      expect((await send("bad", "invalid", "bad timestamp")).status).toBe(400);
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });
});
