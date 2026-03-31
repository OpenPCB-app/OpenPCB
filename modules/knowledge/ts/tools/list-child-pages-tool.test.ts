import { describe, test, expect } from "bun:test";
import {
  createListChildPagesToolHandler,
  listChildPagesToolSpec,
} from "./list-child-pages-tool";

function makePage(
  overrides: Partial<{
    id: string;
    title: string;
    icon: string | null;
    workspace_id: string;
    parent_id: string | null;
    content_json: { engine: string; version: number; data: unknown };
    updated_at: Date;
  }> = {},
) {
  return {
    id: overrides.id ?? "child-1",
    title: overrides.title ?? "Child Page",
    icon: overrides.icon ?? "📄",
    workspace_id: overrides.workspace_id ?? "ws-1",
    parent_id: overrides.parent_id ?? "page-1",
    is_project_root: false,
    project_id: null,
    order_key: "a",
    properties_json: {},
    content_engine: "tiptap",
    content_version: 1,
    content_json: overrides.content_json ?? {
      engine: "tiptap",
      version: 1,
      data: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Some content" }] },
        ],
      },
    },
    created_at: new Date(),
    updated_at: overrides.updated_at ?? new Date("2026-02-18T10:00:00.000Z"),
    deleted_at: null,
  };
}

function makeRepo(
  overrides: Partial<{
    findRootPages: (wsId: string) => Promise<unknown[]>;
    findChildPages: (parentId: string, wsId: string) => Promise<unknown[]>;
    findById: (id: string) => Promise<unknown>;
    isAncestor: (ancestorId: string, nodeId: string) => Promise<boolean>;
  }> = {},
) {
  return {
    findRootPages:
      overrides.findRootPages ??
      (async () => [makePage({ id: "root-1", title: "Root Page 1", parent_id: null })]),
    findChildPages:
      overrides.findChildPages ??
      (async (parentId: string) =>
        parentId === "page-1"
          ? [makePage({ id: "child-1", title: "Child 1", parent_id: "page-1" })]
          : []),
    findById:
      overrides.findById ??
      (async (id: string) => makePage({ id, parent_id: null, workspace_id: "ws-1" })),
    isAncestor:
      overrides.isAncestor ??
      (async (ancestorId: string, nodeId: string) =>
        ancestorId === "page-1" && nodeId.startsWith("child-")),
  } as any;
}

function makeContext(workspaceId = "ws-1") {
  return {
    taskId: "task-1",
    activeContext: {
      workspaceId,
      activeTarget: {
        targetType: "knowledge.page",
        targetId: "page-1",
      },
    },
  };
}

describe("knowledge.list_child_pages tool", () => {
  test("registers as a module-scoped knowledge tool", () => {
    expect(listChildPagesToolSpec.name).toBe("knowledge.list_child_pages");
    expect(listChildPagesToolSpec.scope).toBe("module");
    expect(listChildPagesToolSpec.version).toBe("1.0");
  });

  test("lists active page children when no page_id is provided in scoped context", async () => {
    const handler = createListChildPagesToolHandler(makeRepo());

    const result = (await handler.execute({}, makeContext())) as {
      success: boolean;
      pages: unknown[];
      count: number;
      parent_page_id: string | null;
    };

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.parent_page_id).toBe("page-1");
    expect(result.pages[0]).toMatchObject({
      id: "child-1",
      title: "Child 1",
    });
  });

  test("lists children when explicit page_id is in allowed scope", async () => {
    const children = [
      makePage({ id: "child-1", title: "Child 1", parent_id: "page-1" }),
      makePage({ id: "child-2", title: "Child 2", parent_id: "page-1" }),
    ];

    const handler = createListChildPagesToolHandler(
      makeRepo({
        findChildPages: async (parentId) => (parentId === "page-1" ? children : []),
        findById: async () => makePage({ id: "page-1", parent_id: null, workspace_id: "ws-1" }),
      }),
    );

    const result = (await handler.execute(
      { page_id: "page-1" },
      makeContext(),
    )) as { success: boolean; pages: unknown[]; count: number; parent_page_id: string };

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.parent_page_id).toBe("page-1");
  });

  test("rejects page_id outside active page scope", async () => {
    const handler = createListChildPagesToolHandler(
      makeRepo({
        findById: async (id: string) => makePage({ id, parent_id: null, workspace_id: "ws-1" }),
        isAncestor: async () => false,
      }),
    );

    const result = (await handler.execute(
      { page_id: "outside-page" },
      makeContext(),
    )) as { success: boolean; error: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("PAGE_ACCESS_DENIED");
  });

  test("allows exact mentioned page outside subtree but filters non-mentioned descendants", async () => {
    const handler = createListChildPagesToolHandler(
      makeRepo({
        findById: async (id: string) =>
          makePage({ id, title: "Mentioned", parent_id: null, workspace_id: "ws-1" }),
        findChildPages: async () => [
          makePage({ id: "outside-child", title: "Outside Child", parent_id: "outside-page" }),
        ],
        isAncestor: async () => false,
      }),
    );

    const result = (await handler.execute(
      { page_id: "outside-page" },
      {
        ...makeContext(),
        activeContext: {
          ...makeContext().activeContext,
          knowledgeScope: {
            rootPageId: "page-1",
            mentionedPageIds: ["outside-page"],
            grantMode: "exact",
            grantLifetime: "turn",
          },
        },
      },
    )) as { success: boolean; count: number; pages: unknown[] };

    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.pages).toEqual([]);
  });

  test("includes content preview when requested", async () => {
    const handler = createListChildPagesToolHandler(makeRepo());

    const result = (await handler.execute(
      { include_content_preview: true },
      makeContext(),
    )) as { success: boolean; pages: Array<{ content_preview?: string }> };

    expect(result.success).toBe(true);
    expect(result.pages[0]?.content_preview).toBeDefined();
    expect(typeof result.pages[0]?.content_preview).toBe("string");
  });

  test("rejects missing workspace", async () => {
    const handler = createListChildPagesToolHandler(makeRepo());

    const result = (await handler.execute(
      {},
      { taskId: "t", activeContext: {} },
    )) as { success: boolean; error: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("MISSING_WORKSPACE");
  });

  test("rejects non-existent parent page", async () => {
    const handler = createListChildPagesToolHandler(
      makeRepo({
        findById: async () => null,
      }),
    );

    const result = (await handler.execute(
      { page_id: "missing-page" },
      makeContext(),
    )) as { success: boolean; error: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });

  test("rejects parent page from different workspace", async () => {
    const handler = createListChildPagesToolHandler(
      makeRepo({
        findById: async () => makePage({ id: "p1", workspace_id: "ws-other" }),
      }),
    );

    const result = (await handler.execute(
      { page_id: "p1" },
      makeContext(),
    )) as { success: boolean; error: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("WORKSPACE_MISMATCH");
  });
});
