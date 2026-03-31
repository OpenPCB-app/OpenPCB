import { describe, expect, test, mock } from "bun:test";
import {
  createCreatePageToolHandler,
  createPageToolSpec,
} from "./create-page-tool";
import type { CreatePageParams } from "../../shared/types";

function makePageService(overrides?: {
  createPage?: (params: CreatePageParams) => Promise<Record<string, unknown>>;
  updatePageContent?: (pageId: string, content: unknown) => Promise<Record<string, unknown>>;
}) {
  return {
    createPage:
      overrides?.createPage ??
      (async (params: CreatePageParams) => ({
        id: "page-new",
        title: params.title,
        workspace_id: params.workspace_id,
        parent_id: params.parent_id ?? null,
      })),
    updatePageContent:
      overrides?.updatePageContent ??
      (async () => ({
        id: "page-new",
      })),
  } as any;
}

function makeScopeRepo(
  overrides?: {
    isAncestor?: (ancestorId: string, nodeId: string) => Promise<boolean>;
  },
) {
  return {
    isAncestor:
      overrides?.isAncestor ??
      (async (ancestorId: string, nodeId: string) =>
        ancestorId === "page-1" && nodeId.startsWith("child-")),
  };
}

function makeContext() {
  return {
    taskId: "task-1",
    activeContext: {
      workspaceId: "ws-1",
      activeTarget: {
        targetType: "knowledge.page",
        targetId: "page-1",
      },
    },
  };
}

describe("knowledge.create_page tool", () => {
  test("registers as a module-scoped knowledge tool", () => {
    expect(createPageToolSpec.name).toBe("knowledge.create_page");
    expect(createPageToolSpec.scope).toBe("module");
    expect(createPageToolSpec.version).toBe("1.0");
  });

  test("defaults parent_id to active page when omitted", async () => {
    const createPage = mock(async (params: CreatePageParams) => ({
      id: "page-new",
      title: params.title,
      workspace_id: params.workspace_id,
      parent_id: params.parent_id ?? null,
    }));
    const handler = createCreatePageToolHandler(
      makePageService({ createPage }),
      makeScopeRepo(),
    );

    const result = await handler.execute(
      {
        workspace_id: "ws-1",
        title: "Child Page",
      },
      makeContext(),
    ) as { page: { id: string; parent_id: string | null } };

    expect(createPage).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "ws-1",
        title: "Child Page",
        parent_id: "page-1",
      }),
    );
    expect(result.page.id).toBe("page-new");
    expect(result.page.parent_id).toBe("page-1");
  });

  test("rejects parent page outside active scope", async () => {
    const handler = createCreatePageToolHandler(
      makePageService(),
      makeScopeRepo({ isAncestor: async () => false }),
    );

    const result = await handler.execute(
      {
        workspace_id: "ws-1",
        title: "Outside Child",
        parent_id: "outside-parent",
      },
      makeContext(),
    ) as { success: boolean; error?: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PAGE_ACCESS_DENIED");
  });

  test("allows exact mentioned parent page outside subtree", async () => {
    const createPage = mock(async (params: CreatePageParams) => ({
      id: "page-outside-child",
      title: params.title,
      workspace_id: params.workspace_id,
      parent_id: params.parent_id ?? null,
    }));
    const handler = createCreatePageToolHandler(
      makePageService({ createPage }),
      makeScopeRepo({ isAncestor: async () => false }),
    );

    const result = await handler.execute(
      {
        workspace_id: "ws-1",
        title: "Mention Child",
        parent_id: "outside-parent",
      },
      {
        ...makeContext(),
        activeContext: {
          ...makeContext().activeContext,
          knowledgeScope: {
            rootPageId: "page-1",
            mentionedPageIds: ["outside-parent"],
            grantMode: "exact",
            grantLifetime: "turn",
          },
        },
      },
    ) as { page: { id: string; parent_id: string | null } };

    expect(createPage).toHaveBeenCalledWith(
      expect.objectContaining({
        parent_id: "outside-parent",
      }),
    );
    expect(result.page.id).toBe("page-outside-child");
    expect(result.page.parent_id).toBe("outside-parent");
  });

  test("allows root-level creation when no scoped active page exists", async () => {
    const createPage = mock(async (params: CreatePageParams) => ({
      id: "root-page-new",
      title: params.title,
      workspace_id: params.workspace_id,
      parent_id: params.parent_id ?? null,
    }));
    const handler = createCreatePageToolHandler(
      makePageService({ createPage }),
      makeScopeRepo(),
    );

    const result = await handler.execute(
      {
        workspace_id: "ws-1",
        title: "Root Level",
      },
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
        },
      },
    ) as { page: { id: string; parent_id: string | null } };

    expect(createPage).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "ws-1",
        title: "Root Level",
        parent_id: undefined,
      }),
    );
    expect(result.page.id).toBe("root-page-new");
    expect(result.page.parent_id).toBe(null);
  });
});
