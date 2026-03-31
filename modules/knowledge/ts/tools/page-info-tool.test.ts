import { describe, test, expect } from "bun:test";
import { createPageInfoToolHandler, pageInfoToolSpec } from "./page-info-tool";
import type { ToolExecutionContext } from "../../../../src-ts/shared/types/tool.types";

function makeTarget(overrides: Partial<{
  exists: (id: string) => Promise<boolean>;
  getContent: (id: string) => Promise<unknown>;
  getContentContext: (id: string) => Promise<unknown>;
  getMetadata: (id: string) => Promise<Record<string, unknown>>;
}> = {}) {
  return {
    exists: overrides.exists ?? (async () => true),
    getContent: overrides.getContent ?? (async () => ({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
    })),
    getContentContext: overrides.getContentContext ?? (async () => ({
      fullContent: { type: "doc", content: [] },
      contentMarkdown: "",
    })),
    getMetadata: overrides.getMetadata ?? (async () => ({
      title: "My Page",
      icon: "📝",
      workspaceId: "ws-1",
      updatedAt: "2024-01-01T00:00:00.000Z",
    })),
  };
}

function makePageRepo(overrides: Partial<{
  findById: (id: string) => Promise<unknown>;
  getBreadcrumb: (id: string) => Promise<string[]>;
  isAncestor: (ancestorId: string, nodeId: string) => Promise<boolean>;
}> = {}) {
  return {
    findById: overrides.findById ?? (async () => ({
      id: "page-1",
      parent_id: "parent-1",
      project_id: "proj-1",
      is_project_root: false,
      properties_json: {
        p1: { id: "p1", name: "Status", type: "text", value: "Draft" },
        p2: { id: "p2", name: "Done", type: "checkbox", value: true },
      },
    })),
    getBreadcrumb: overrides.getBreadcrumb ?? (async () => ["Root", "Parent", "My Page"]),
    isAncestor: overrides.isAncestor ?? (async () => false),
  } as any;
}

function makeContext(overrides?: Partial<ToolExecutionContext>): ToolExecutionContext {
  return {
    taskId: "task-1",
    activeContext: {
      workspaceId: "ws-1",
      activeTarget: {
        targetType: "knowledge.page",
        targetId: "page-1",
      },
    },
    ...overrides,
  };
}

describe("knowledge.page_info tool", () => {
  test("registers as a module-scoped knowledge tool", () => {
    expect(pageInfoToolSpec.name).toBe("knowledge.page_info");
    expect(pageInfoToolSpec.scope).toBe("module");
    expect(pageInfoToolSpec.version).toBe("1.0");
  });

  test("returns page metadata for a non-empty page", async () => {
    const handler = createPageInfoToolHandler(makeTarget(), makePageRepo());
    const result = await handler.execute({}, makeContext()) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.id).toBe("page-1");
    expect(result.title).toBe("My Page");
    expect(result.icon).toBe("📝");
    expect(result.isEmpty).toBe(false);
    expect(typeof result.charCount).toBe("number");
    expect((result.charCount as number)).toBeGreaterThan(0);
    expect(typeof result.wordCount).toBe("number");
    expect(result.updatedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(Array.isArray(result.outline)).toBe(true);
    expect((result.outline as Array<{ level: number; text: string }>)[0]).toEqual({ level: 1, text: "Title" });
  });

  test("returns Knowledge-specific fields", async () => {
    const handler = createPageInfoToolHandler(makeTarget(), makePageRepo());
    const result = await handler.execute({}, makeContext()) as Record<string, unknown>;

    expect(result.parent_id).toBe("parent-1");
    expect(result.project_id).toBe("proj-1");
    expect(result.is_project_root).toBe(false);
    expect(result.breadcrumb).toEqual(["Root", "Parent", "My Page"]);
    expect(Array.isArray(result.properties)).toBe(true);
    const props = result.properties as Array<{ name: string; type: string; value: string }>;
    expect(props.length).toBe(2);
    expect(props.find(p => p.name === "Status")).toEqual({ name: "Status", type: "text", value: "Draft" });
    expect(props.find(p => p.name === "Done")).toEqual({ name: "Done", type: "checkbox", value: "Yes" });
  });

  test("returns isEmpty=true for empty page", async () => {
    const handler = createPageInfoToolHandler(
      makeTarget({
        getContent: async () => ({
          type: "doc",
          content: [{ type: "paragraph" }],
        }),
      }),
      makePageRepo(),
    );
    const result = await handler.execute({}, makeContext()) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.isEmpty).toBe(true);
    expect(result.charCount).toBe(0);
    expect(result.wordCount).toBe(0);
  });

  test("fails without workspace", async () => {
    const handler = createPageInfoToolHandler(makeTarget(), makePageRepo());
    const ctx: ToolExecutionContext = { taskId: "t", activeContext: {} };
    const result = await handler.execute({}, ctx) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect((result.error as Record<string, unknown>).code).toBe("MISSING_WORKSPACE");
  });

  test("fails without active target", async () => {
    const handler = createPageInfoToolHandler(makeTarget(), makePageRepo());
    const ctx: ToolExecutionContext = {
      taskId: "t",
      activeContext: { workspaceId: "ws-1" },
    };
    const result = await handler.execute({}, ctx) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect((result.error as Record<string, unknown>).code).toBe("NO_TARGET_PAGE");
  });

  test("rejects explicit page_id outside active page scope", async () => {
    const handler = createPageInfoToolHandler(
      makeTarget(),
      makePageRepo({
        isAncestor: async () => false,
      }),
    );

    const result = await handler.execute(
      { page_id: "outside-page" },
      makeContext(),
    ) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect((result.error as Record<string, unknown>).code).toBe("PAGE_ACCESS_DENIED");
  });

  test("allows exact mentioned page outside subtree", async () => {
    const handler = createPageInfoToolHandler(
      makeTarget({
        getMetadata: async () => ({
          title: "Mentioned Page",
          icon: "📌",
          workspaceId: "ws-1",
          updatedAt: "2024-01-01T00:00:00.000Z",
        }),
      }),
      makePageRepo({
        findById: async () => ({
          id: "outside-page",
          parent_id: null,
          project_id: null,
          is_project_root: false,
          properties_json: {},
        }),
        getBreadcrumb: async () => ["Outside"],
      }),
    );

    const result = await handler.execute(
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
    ) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.id).toBe("outside-page");
    expect(result.breadcrumb).toEqual(["Outside"]);
  });

  test("fails when page not found", async () => {
    const handler = createPageInfoToolHandler(
      makeTarget({ exists: async () => false }),
      makePageRepo(),
    );
    const result = await handler.execute({}, makeContext()) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect((result.error as Record<string, unknown>).code).toBe("PAGE_NOT_FOUND");
  });

  test("fails on workspace mismatch", async () => {
    const handler = createPageInfoToolHandler(
      makeTarget({ getMetadata: async () => ({ workspaceId: "ws-other", title: "X" }) }),
      makePageRepo(),
    );
    const result = await handler.execute({}, makeContext()) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect((result.error as Record<string, unknown>).code).toBe("WORKSPACE_MISMATCH");
  });
});
