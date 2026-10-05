import { readFile } from "node:fs/promises";
import type {
  CoreBackendModuleContext,
  ModuleRouterHandle,
} from "../../../core/contracts/modules/backend-module";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { PageRepository } from "./db/repositories/page-repository";
import { PageContentConflictError, PageService } from "./services/page-service";
import { SearchService } from "./services/search-service";
import { PageEventService } from "./services/page-event-service";
import {
  PDF_SIZE_LIMIT_BYTES,
  pdfAbsolutePath,
  writePdf,
} from "./services/pdf-store";
import type {
  CreatePageParams,
  MovePageParams,
  UpdatePageContentParams,
  UpdatePageMetaParams,
  PageUpdateEvent,
} from "../shared/types";

const DEFAULT_WORKSPACE = "default";

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

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

function hasPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i += 1) {
    if (bytes[i] !== PDF_MAGIC[i]) return false;
  }
  return true;
}

/** Derive a page title from an uploaded filename (basename minus .pdf). */
function titleFromFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.pdf$/i, "").trim() || "Untitled PDF";
}

function json<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

function error(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export function registerRoutes(
  router: ModuleRouterHandle,
  ctx: CoreBackendModuleContext,
): void {
  const db = ctx.db.db as BetterSQLite3Database<Record<string, unknown>>;
  const repo = new PageRepository(db);
  const pageService = new PageService(repo);
  const searchService = new SearchService(repo);
  const events = new PageEventService();

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

  router.get("/events/pages", ({ query, req }) => {
    const workspaceId = query.get("workspace_id") ?? DEFAULT_WORKSPACE;

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
          } catch {
            // Ignore enqueue errors on closed stream
          }
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
            } catch {
              // already closed
            }
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

  router.post("/pages", async ({ req }) => {
    try {
      const params = (await req.json()) as CreatePageParams;
      const page = await pageService.createPage({
        ...params,
        workspace_id: params.workspace_id ?? DEFAULT_WORKSPACE,
      });
      return json({ page }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message);
    }
  });

  // Import a PDF as a new page (content_engine="pdf"); bytes are stored on disk,
  // content_json keeps only the sha256 + metadata. Served back via /pages/:id/pdf.
  router.post("/pages/import/pdf", async ({ req }) => {
    try {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return error("file must be a file upload", 400);
      }
      if (file.size > PDF_SIZE_LIMIT_BYTES) {
        return error("PDF exceeds the 50MB size limit", 413);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!hasPdfMagic(bytes)) {
        return error("File is not a PDF (missing %PDF- header)", 400);
      }

      const stored = await writePdf(bytes);

      const projectId = formData.get("project_id");
      const parentId = formData.get("parent_id");
      const workspaceId = formData.get("workspace_id");
      const pageCountRaw = formData.get("page_count");
      const pageCount =
        typeof pageCountRaw === "string" && pageCountRaw.length > 0
          ? Number(pageCountRaw)
          : undefined;

      const page = await pageService.createPage({
        workspace_id:
          typeof workspaceId === "string" && workspaceId.length > 0
            ? workspaceId
            : DEFAULT_WORKSPACE,
        project_id: typeof projectId === "string" ? projectId : undefined,
        parent_id: typeof parentId === "string" ? parentId : undefined,
        title: titleFromFileName(file.name),
        content: {
          engine: "pdf",
          version: 1,
          data: {
            sha256: stored.sha256,
            fileName: file.name,
            byteSize: stored.byteSize,
            mimeType: "application/pdf",
            ...(pageCount !== undefined && Number.isFinite(pageCount)
              ? { pageCount }
              : {}),
          },
        },
      });
      return json({ page }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message);
    }
  });

  router.get("/pages/:pageId", async ({ params }) => {
    try {
      const pageId = params.getOrThrow("pageId");
      const page = await pageService.getPage(pageId);
      if (!page) {
        return error("PAGE_NOT_FOUND", 404);
      }
      return json({ page });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message, 500);
    }
  });

  // Stream the stored PDF for a pdf-engine page (embedded viewer + download).
  router.get("/pages/:pageId/pdf", async ({ params }) => {
    try {
      const pageId = params.getOrThrow("pageId");
      const page = await pageService.getPage(pageId);
      if (!page) {
        return error("PAGE_NOT_FOUND", 404);
      }
      const content = page.content_json;
      if (content.engine !== "pdf") {
        return error("NOT_A_PDF_PAGE", 400);
      }
      // Use node:fs (not Bun.file): the desktop app runs the backend in
      // Electron's Node runtime where `Bun` is undefined.
      let bytes: Buffer;
      try {
        bytes = await readFile(pdfAbsolutePath(content.data.sha256));
      } catch (err) {
        if (
          err instanceof Error &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          return error("PDF_NOT_FOUND", 404);
        }
        throw err;
      }
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${encodeURIComponent(
            content.data.fileName,
          )}"`,
          "Cache-Control": "private, max-age=86400",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message, 500);
    }
  });

  router.patch("/pages/:pageId/meta", async ({ req, params }) => {
    let requestId: string | undefined;
    try {
      const pageId = params.getOrThrow("pageId");
      const updates = (await req.json()) as UpdatePageMetaParams;
      const ifUnmodifiedSince = req.headers.get("if-unmodified-since");
      let expectedUpdatedAt: Date | undefined;
      if (ifUnmodifiedSince) {
        expectedUpdatedAt = new Date(ifUnmodifiedSince);
        if (Number.isNaN(expectedUpdatedAt.getTime()))
          return error("INVALID_IF_UNMODIFIED_SINCE", 400);
      }
      requestId = req.headers.get("x-request-id") ?? undefined;
      const page = await pageService.updatePageMeta(
        pageId,
        updates,
        expectedUpdatedAt,
      );
      events.publish(toPageUpdateEvent("meta_updated", page, requestId));
      return json({ page, ...(requestId && { requestId }) });
    } catch (err) {
      if (err instanceof PageContentConflictError) {
        return Response.json(
          { error: err.code, page: err.page, ...(requestId && { requestId }) },
          { status: 409 },
        );
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(
        message,
        message === "PAGE_NOT_FOUND" || message === "PAGE_DELETED" ? 404 : 400,
      );
    }
  });

  router.patch("/pages/:pageId/content", async ({ req, params }) => {
    let requestId: string | undefined;
    try {
      const pageId = params.getOrThrow("pageId");
      const content = (await req.json()) as UpdatePageContentParams;
      if (!isValidEditorContent(content)) {
        return error("INVALID_CONTENT", 400);
      }
      const ifUnmodifiedSince = req.headers.get("if-unmodified-since");
      let expectedUpdatedAt: Date | undefined;
      if (ifUnmodifiedSince) {
        const parsed = new Date(ifUnmodifiedSince);
        if (Number.isNaN(parsed.getTime())) {
          return error("INVALID_IF_UNMODIFIED_SINCE", 400);
        }
        expectedUpdatedAt = parsed;
      }
      requestId = req.headers.get("x-request-id") ?? undefined;

      const page = await pageService.updatePageContent(
        pageId,
        content,
        expectedUpdatedAt,
      );
      events.publish(toPageUpdateEvent("content_updated", page, requestId));
      return json({ page, ...(requestId && { requestId }) });
    } catch (err) {
      if (err instanceof PageContentConflictError) {
        return Response.json(
          { error: err.code, page: err.page, ...(requestId && { requestId }) },
          { status: 409 },
        );
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      const status =
        message === "PAGE_NOT_FOUND" || message === "PAGE_DELETED" ? 404 : 400;
      return error(message, status);
    }
  });

  router.post("/pages/:pageId/move", async ({ req, params }) => {
    try {
      const pageId = params.getOrThrow("pageId");
      const target = (await req.json()) as MovePageParams;
      const page = await pageService.movePage(pageId, target);
      events.publish(toPageUpdateEvent("moved", page));
      return json({ page });
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
      return error(message, status);
    }
  });

  router.delete("/pages/:pageId", async ({ params }) => {
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
      return error(message, status);
    }
  });

  router.post("/pages/:pageId/restore", async ({ params }) => {
    try {
      const pageId = params.getOrThrow("pageId");
      const page = await pageService.restorePage(pageId);
      events.publish(toPageUpdateEvent("restored", page));
      return json({ page });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message, 404);
    }
  });

  router.get("/workspaces/:workspaceId/tree", async ({ params }) => {
    try {
      const workspaceId = params.getOrThrow("workspaceId");
      const pages = await pageService.getWorkspaceTree(workspaceId);
      return json({ pages });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message, 500);
    }
  });

  router.get("/projects/:projectId/tree", async ({ params, query }) => {
    try {
      const projectId = params.getOrThrow("projectId");
      const workspaceId = query.get("workspace_id") ?? DEFAULT_WORKSPACE;
      const pages = await pageService.getProjectTree(projectId, workspaceId);
      return json({ pages });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message, 500);
    }
  });

  router.get("/search", async ({ query }) => {
    try {
      const q = query.get("q") ?? "";
      const scope = (query.get("scope") ?? "all") as
        "all" | "workspace" | "projects";
      const workspaceId = query.get("workspace_id") ?? DEFAULT_WORKSPACE;

      const results = await searchService.searchByTitle(workspaceId, q, scope);
      return json({ results });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message, 500);
    }
  });

  router.post("/ensure-project-root", async ({ req }) => {
    try {
      const body = (await req.json()) as {
        workspace_id: string;
        project_id: string;
        title: string;
      };
      const page = await pageService.ensureProjectRoot({
        workspace_id: body.workspace_id ?? DEFAULT_WORKSPACE,
        project_id: body.project_id,
        title: body.title,
      });
      return json({ page });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message, 500);
    }
  });

  router.post("/pages/bulk-delete", async ({ req }) => {
    try {
      const body = (await req.json()) as { page_ids: string[] };
      if (!Array.isArray(body.page_ids)) {
        return error("page_ids must be an array", 400);
      }
      const result = await pageService.bulkDeletePages(body.page_ids);
      return json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message, 500);
    }
  });

  router.post("/pages/bulk-move", async ({ req }) => {
    try {
      const body = (await req.json()) as {
        page_ids: string[];
        target_parent_id: string | null;
      };
      if (!Array.isArray(body.page_ids)) {
        return error("page_ids must be an array", 400);
      }
      const result = await pageService.bulkMovePages(
        body.page_ids,
        body.target_parent_id ?? null,
      );
      return json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message, 500);
    }
  });
}
