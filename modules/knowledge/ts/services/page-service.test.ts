import { describe, test, expect } from "bun:test";
import { PageService, PageContentConflictError } from "./page-service";
import type { EditorContent } from "../../shared/types";
import type { KnowledgePage } from "../db/schema";
import type { PageRepository } from "../db/repositories/page-repository";

function makeContent(text: string): EditorContent {
  return {
    engine: "tiptap",
    version: 1,
    data: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
  };
}

function makeRow(overrides: Partial<KnowledgePage> = {}): KnowledgePage {
  return {
    id: "page-1",
    workspace_id: "ws-1",
    project_id: null,
    parent_id: null,
    is_project_root: false,
    order_key: "a0",
    title: "Page",
    icon: null,
    properties_json: {},
    content_engine: "tiptap",
    content_version: 1,
    content_json: makeContent("existing"),
    created_at: new Date("2026-02-18T09:00:00.000Z"),
    updated_at: new Date("2026-02-19T09:00:00.000Z"),
    deleted_at: null,
    ...overrides,
  };
}

describe("PageService.updatePageContent concurrency", () => {
  test("updates content when expected timestamp matches", async () => {
    const expected = new Date("2026-02-19T09:00:00.000Z");
    const newContent = makeContent("fresh");
    let capturedExpected: Date | undefined;

    const repo = {
      updateContent: async (_id: string, content: EditorContent, expectedUpdatedAt?: Date) => {
        capturedExpected = expectedUpdatedAt;
        return makeRow({
          content_json: content,
          content_version: content.version,
          updated_at: new Date("2026-02-19T09:01:00.000Z"),
        });
      },
      findById: async () => null,
    } as unknown as PageRepository;

    const service = new PageService(repo);
    const page = await service.updatePageContent("page-1", newContent, expected);

    expect(capturedExpected?.toISOString()).toBe(expected.toISOString());
    expect(page.content_json).toEqual(newContent);
    expect(new Date(page.updated_at).toISOString()).toBe("2026-02-19T09:01:00.000Z");
  });

  test("throws CONTENT_CONFLICT with latest page snapshot on stale expected timestamp", async () => {
    const staleExpected = new Date("2026-02-19T08:59:59.000Z");
    const latest = makeRow({
      title: "Latest Server Title",
      updated_at: new Date("2026-02-19T09:02:00.000Z"),
      content_json: makeContent("server-latest"),
    });

    const repo = {
      updateContent: async () => null,
      findById: async () => latest,
    } as unknown as PageRepository;

    const service = new PageService(repo);

    try {
      await service.updatePageContent("page-1", makeContent("local-draft"), staleExpected);
      throw new Error("Expected CONTENT_CONFLICT error");
    } catch (error) {
      expect(error).toBeInstanceOf(PageContentConflictError);
      const conflict = error as PageContentConflictError;
      expect(conflict.code).toBe("CONTENT_CONFLICT");
      expect(conflict.page.id).toBe("page-1");
      expect(conflict.page.title).toBe("Latest Server Title");
      expect(new Date(conflict.page.updated_at).toISOString()).toBe("2026-02-19T09:02:00.000Z");
    }
  });

  test("remains backward-compatible when expected timestamp is omitted", async () => {
    let capturedExpected: Date | undefined;
    const newContent = makeContent("no-guard-update");

    const repo = {
      updateContent: async (_id: string, content: EditorContent, expectedUpdatedAt?: Date) => {
        capturedExpected = expectedUpdatedAt;
        return makeRow({
          content_json: content,
          updated_at: new Date("2026-02-19T09:03:00.000Z"),
        });
      },
      findById: async () => null,
    } as unknown as PageRepository;

    const service = new PageService(repo);
    const page = await service.updatePageContent("page-1", newContent);

    expect(capturedExpected).toBeUndefined();
    expect(page.content_json).toEqual(newContent);
    expect(new Date(page.updated_at).toISOString()).toBe("2026-02-19T09:03:00.000Z");
  });
});
