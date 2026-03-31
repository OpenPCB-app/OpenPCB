import { createModuleV2 } from "../../_kit/createModule";
import { PageRepository } from "./db/repositories/page-repository";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { PageContentConflictError, PageService } from "./services/page-service";
import { SearchService } from "./services/search-service";
import { PageEventService } from "./services/page-event-service";
import { KnowledgePageMentionProvider } from "./providers/mention-provider";
import { KnowledgePageTarget } from "./adapters/knowledge-page-target";
import { createPageToolSpec, createCreatePageToolHandler } from "./tools/create-page-tool";
import { readPageToolSpec, createReadPageToolHandler } from "./tools/read-page-tool";
import { pageInfoToolSpec, createPageInfoToolHandler } from "./tools/page-info-tool";
import { listChildPagesToolSpec, createListChildPagesToolHandler } from "./tools/list-child-pages-tool";
import { searchPagesToolSpec, createSearchPagesToolHandler } from "./tools/search-pages-tool";
import type {
  CreatePageParams,
  UpdatePageMetaParams,
  UpdatePageContentParams,
  MovePageParams,
  PageUpdateEvent,
} from "../shared/types";

function isValidEditorContent(
  value: unknown,
): value is UpdatePageContentParams {
  if (!value || typeof value !== "object") return false;
  const record = value as {
    engine?: unknown;
    version?: unknown;
    data?: unknown;
  };
  return (
    typeof record.engine === "string" &&
    typeof record.version === "number" &&
    "data" in record
  );
}

let pageEventService: PageEventService | null = null;

export const knowledgeModule = createModuleV2("knowledge", {
  label: "Knowledge",
  namespace: "space.knowledge",
  version: "1.0.0",
  kind: "space",

  async onActivate(ctx) {
    ctx.logger.info("Knowledge module activating...");

    await ctx.db.createTable(
      "page",
      `
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      parent_id TEXT,
      is_project_root INTEGER DEFAULT 0,
      order_key TEXT NOT NULL,
      title TEXT NOT NULL,
      icon TEXT,
      properties_json TEXT DEFAULT '{}',
      content_engine TEXT NOT NULL DEFAULT 'tiptap',
      content_version INTEGER NOT NULL DEFAULT 1,
      content_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    `,
    );

    try {
      await ctx.db.execute(
        "ALTER TABLE $table ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
        "page",
      );
    } catch {}

    const db = ctx.db.getRawDb() as BunSQLiteDatabase<Record<string, unknown>>;
    const pageRepo = new PageRepository(db);
    const pageService = new PageService(pageRepo);
    pageEventService = new PageEventService();

    const pageTarget = new KnowledgePageTarget(pageService);
    const searchService = new SearchService(pageRepo);

    if (ctx.core.toolRegistry) {
      ctx.core.toolRegistry.registerTool(createPageToolSpec, createCreatePageToolHandler(pageService, pageRepo));
      ctx.core.toolRegistry.registerTool(readPageToolSpec, createReadPageToolHandler(pageTarget, pageRepo));
      ctx.core.toolRegistry.registerTool(pageInfoToolSpec, createPageInfoToolHandler(pageTarget, pageRepo));
      ctx.core.toolRegistry.registerTool(listChildPagesToolSpec, createListChildPagesToolHandler(pageRepo));
      ctx.core.toolRegistry.registerTool(searchPagesToolSpec, createSearchPagesToolHandler(searchService));
      ctx.logger.info("Registered knowledge tools (create_page, read_page, page_info, list_child_pages, search_pages)");
    }

    // Register mention provider
    const mentionProvider = new KnowledgePageMentionProvider(pageRepo);
    ctx.mentions.register(mentionProvider);
    ctx.logger.info("Registered KnowledgePageMentionProvider for mentions");

    // Register content editor target
    if (ctx.core.contentEditor) {
      ctx.core.contentEditor.registerTarget(pageTarget);
      ctx.logger.info("Registered KnowledgePageTarget for content editing");
    }

    ctx.logger.info("Knowledge module activated");
    ctx.logger.info("Endpoints available at /api/modules/knowledge/*");
  },

  async onDeactivate(ctx) {
    pageEventService = null;
    ctx.logger.info("Knowledge module deactivated");
  },

  endpoints(ctx, http, _ws) {
    const db = ctx.db.getRawDb() as BunSQLiteDatabase<Record<string, unknown>>;
    const repo = new PageRepository(db);
    const pageService = new PageService(repo);
    const searchService = new SearchService(repo);
    const events = pageEventService ?? (pageEventService = new PageEventService());

    const toPageUpdateEvent = (
      type: PageUpdateEvent["type"],
      page: {
        id: string;
        workspace_id: string;
        updated_at: Date;
        revision: number;
      },
      requestId?: string,
    ): PageUpdateEvent => ({
      type,
      pageId: page.id,
      workspaceId: page.workspace_id,
      updatedAt: page.updated_at.toISOString(),
      revision: page.revision,
      source: "user",
      ...(requestId ? { requestId } : {}),
    });

    http.get("/events/pages", ({ query, req }) => {
      const workspaceId = query.get("workspace_id");
      if (!workspaceId) {
        return Response.json({ error: "workspace_id required" }, { status: 400 });
      }

      const encoder = new TextEncoder();
      let unsubscribe: (() => void) | null = null;
      let keepAlive: ReturnType<typeof setInterval> | null = null;

      const stream = new ReadableStream({
        start(controller) {
          const sendData = (payload: unknown) => {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
              );
            } catch {}
          };

          const cleanup = () => {
            unsubscribe?.();
            unsubscribe = null;
            if (keepAlive) {
              clearInterval(keepAlive);
              keepAlive = null;
            }
          };

          unsubscribe = events.subscribe(workspaceId, (event) => {
            sendData(event);
          });

          sendData({ event: "ping", ts: new Date().toISOString() });
          keepAlive = setInterval(() => {
            sendData({ event: "ping", ts: new Date().toISOString() });
          }, 30000);

          req.signal.addEventListener(
            "abort",
            () => {
              cleanup();
              try {
                controller.close();
              } catch {}
            },
            { once: true },
          );
        },
        cancel() {
          unsubscribe?.();
          unsubscribe = null;
          if (keepAlive) {
            clearInterval(keepAlive);
            keepAlive = null;
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    });

    http.post("/pages", async ({ req }) => {
      try {
        const params = (await req.json()) as CreatePageParams;
        const page = await pageService.createPage(params);
        return Response.json({ page }, { status: 201 });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json({ error: message }, { status: 400 });
      }
    });

    http.get("/pages/:pageId", async ({ params }) => {
      try {
        const pageId = params.getOrThrow("pageId");
        const page = await pageService.getPage(pageId);
        if (!page) {
          return Response.json({ error: "PAGE_NOT_FOUND" }, { status: 404 });
        }
        return Response.json({ page });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    });

    http.patch("/pages/:pageId/meta", async ({ req, params }) => {
      try {
        const pageId = params.getOrThrow("pageId");
        const updates = (await req.json()) as UpdatePageMetaParams;
        const page = await pageService.updatePageMeta(pageId, updates);
        events.publish(toPageUpdateEvent("meta_updated", page));
        return Response.json({ page });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json({ error: message }, { status: 400 });
      }
    });

    http.patch("/pages/:pageId/content", async ({ req, params }) => {
      let requestId: string | undefined;
      try {
        const pageId = params.getOrThrow("pageId");
        const content = (await req.json()) as UpdatePageContentParams;
        if (!isValidEditorContent(content)) {
          return Response.json({ error: "INVALID_CONTENT" }, { status: 400 });
        }
        const ifUnmodifiedSince = req.headers.get("if-unmodified-since");
        let expectedUpdatedAt: Date | undefined;
        if (ifUnmodifiedSince) {
          const parsed = new Date(ifUnmodifiedSince);
          if (Number.isNaN(parsed.getTime())) {
            return Response.json(
              { error: "INVALID_IF_UNMODIFIED_SINCE" },
              { status: 400 },
            );
          }
          expectedUpdatedAt = parsed;
        }
        requestId = req.headers.get("x-request-id") ?? undefined;

        const page = await pageService.updatePageContent(
          pageId,
          content,
          expectedUpdatedAt,
        );
        events.publish(
          toPageUpdateEvent("content_updated", page, requestId),
        );
        return Response.json({ page, ...(requestId && { requestId }) });
      } catch (err) {
        if (err instanceof PageContentConflictError) {
          return Response.json(
            { error: err.code, page: err.page, ...(requestId && { requestId }) },
            { status: 409 },
          );
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        const status =
          message === "PAGE_NOT_FOUND" || message === "PAGE_DELETED"
            ? 404
            : 400;
        return Response.json({ error: message }, { status });
      }
    });

    http.post("/pages/:pageId/move", async ({ req, params }) => {
      try {
        const pageId = params.getOrThrow("pageId");
        const target = (await req.json()) as MovePageParams;
        const page = await pageService.movePage(pageId, target);
        events.publish(toPageUpdateEvent("moved", page));
        return Response.json({ page });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const status =
          message === "ROOT_LOCKED"
            ? 403
            : message === "INVALID_MOVE" ||
                message === "CIRCULAR_REFERENCE" ||
                message === "MAX_DEPTH"
              ? 400
              : 500;
        return Response.json({ error: message }, { status });
      }
    });

    http.delete("/pages/:pageId", async ({ params }) => {
      try {
        const pageId = params.getOrThrow("pageId");
        const pageBeforeDelete = await pageService.getPage(pageId);
        await pageService.softDeletePage(pageId);
        if (pageBeforeDelete) {
          events.publish({
            type: "deleted",
            pageId,
            workspaceId: pageBeforeDelete.workspace_id,
            updatedAt: new Date().toISOString(),
            revision: pageBeforeDelete.revision,
            source: "user",
          });
        }
        return new Response(null, { status: 204 });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const status =
          message === "ROOT_LOCKED"
            ? 403
            : message === "PAGE_NOT_FOUND"
              ? 404
              : 500;
        return Response.json({ error: message }, { status });
      }
    });

    http.post("/pages/:pageId/restore", async ({ params }) => {
      try {
        const pageId = params.getOrThrow("pageId");
        const page = await pageService.restorePage(pageId);
        events.publish(toPageUpdateEvent("restored", page));
        return Response.json({ page });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json({ error: message }, { status: 404 });
      }
    });

    http.get("/workspaces/:workspaceId/tree", async ({ params }) => {
      try {
        const workspaceId = params.getOrThrow("workspaceId");
        const pages = await pageService.getWorkspaceTree(workspaceId);
        return Response.json({ pages });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    });

    http.get("/projects/:projectId/tree", async ({ params, query }) => {
      try {
        const projectId = params.getOrThrow("projectId");
        const workspaceId = query.get("workspace_id");
        if (!workspaceId) {
          return Response.json(
            { error: "workspace_id required" },
            { status: 400 },
          );
        }
        const pages = await pageService.getProjectTree(projectId, workspaceId);
        return Response.json({ pages });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    });

    http.get("/search", async ({ query }) => {
      try {
        const q = query.get("q") ?? "";
        const scope = (query.get("scope") ?? "all") as
          | "all"
          | "workspace"
          | "projects";
        const workspaceId = query.get("workspace_id");

        if (!workspaceId) {
          return Response.json(
            { error: "workspace_id required" },
            { status: 400 },
          );
        }

        const results = await searchService.searchByTitle(
          workspaceId,
          q,
          scope,
        );
        return Response.json({ results });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    });

    http.post("/ensure-project-root", async ({ req }) => {
      try {
        const body = (await req.json()) as {
          workspace_id: string;
          project_id: string;
          title: string;
        };
        const page = await pageService.ensureProjectRoot({
          workspace_id: body.workspace_id,
          project_id: body.project_id,
          title: body.title,
        });
        return Response.json({ page });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    });

    // Bulk Operations
    http.post("/pages/bulk-delete", async ({ req }) => {
      try {
        const body = (await req.json()) as { page_ids: string[] };
        if (!Array.isArray(body.page_ids)) {
          return Response.json(
            { error: "page_ids must be an array" },
            { status: 400 },
          );
        }
        const result = await pageService.bulkDeletePages(body.page_ids);
        return Response.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    });

    http.post("/pages/bulk-move", async ({ req }) => {
      try {
        const body = (await req.json()) as {
          page_ids: string[];
          target_parent_id: string | null;
        };
        if (!Array.isArray(body.page_ids)) {
          return Response.json(
            { error: "page_ids must be an array" },
            { status: 400 },
          );
        }
        const result = await pageService.bulkMovePages(
          body.page_ids,
          body.target_parent_id ?? null,
        );
        return Response.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    });
  },
});

export default knowledgeModule;
