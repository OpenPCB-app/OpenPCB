import { describe, expect, test } from "bun:test";
import {
  createReadPageToolHandler,
  readPageToolSpec,
} from "./read-page-tool";
import { KNOWLEDGE_PAGE_TARGET_TYPE } from "../adapters/knowledge-page-target";

function createTargetStub(overrides?: {
  exists?: (targetId: string) => Promise<boolean>;
  getContentContext?: (targetId: string) => Promise<{
    fullContent: Record<string, unknown>;
    contentMarkdown: string;
  }>;
  getMetadata?: (targetId: string) => Promise<Record<string, unknown>>;
}) {
  return {
    exists:
      overrides?.exists ??
      (async () => true),
    getContentContext:
      overrides?.getContentContext ??
      (async () => ({
        fullContent: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Hello from knowledge." }],
            },
          ],
        },
        contentMarkdown: "Hello from knowledge.\n",
      })),
    getMetadata:
      overrides?.getMetadata ??
      (async () => ({
        title: "Test Page",
        icon: "📄",
        workspaceId: "ws-1",
        updatedAt: new Date("2026-02-18T10:00:00.000Z"),
      })),
  };
}

function createScopeRepoStub(overrides?: {
  isAncestor?: (ancestorId: string, nodeId: string) => Promise<boolean>;
}) {
  return {
    isAncestor:
      overrides?.isAncestor ??
      (async (ancestorId: string, nodeId: string) =>
        ancestorId === "page-1" && nodeId.startsWith("child-")),
  };
}

describe("knowledge.read_page tool", () => {
  test("registers as a module-scoped knowledge tool", () => {
    expect(readPageToolSpec.name).toBe("knowledge.read_page");
    expect(readPageToolSpec.scope).toBe("module");
    expect(readPageToolSpec.version).toBe("1.0");
  });

  test("returns page content from active knowledge target", async () => {
    const handler = createReadPageToolHandler(
      createTargetStub() as any,
      createScopeRepoStub() as any,
    );

    const result = await handler.execute(
      {},
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: KNOWLEDGE_PAGE_TARGET_TYPE,
            targetId: "page-1",
          },
        },
      },
    );

    expect(result).toMatchObject({
      success: true,
      page: {
        id: "page-1",
        title: "Test Page",
        icon: "📄",
        workspace_id: "ws-1",
      },
      truncated: false,
    });
  });

  test("rejects missing active target", async () => {
    const handler = createReadPageToolHandler(
      createTargetStub() as any,
      createScopeRepoStub() as any,
    );

    const result = await handler.execute(
      {},
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
        },
      },
    );

    expect(result).toEqual({
      success: false,
      error: {
        code: "NO_TARGET_PAGE",
        message: "page_id required when no active page context is available",
      },
    });
  });

  test("uses explicit page_id when active target is not a knowledge page", async () => {
    const handler = createReadPageToolHandler(
      createTargetStub() as any,
      createScopeRepoStub() as any,
    );

    const result = await handler.execute(
      { page_id: "page-explicit" },
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: "writer.document",
            targetId: "doc-1",
          },
        },
      },
    );

    expect(result).toEqual({
      success: true,
      page: {
        id: "page-explicit",
        title: "Test Page",
        icon: "📄",
        workspace_id: "ws-1",
        updated_at: "2026-02-18T10:00:00.000Z",
      },
      content_format: "html",
      content_html: expect.any(String),
      total_chars: expect.any(Number),
      returned_chars: expect.any(Number),
      truncated: false,
    });
  });

  test("rejects workspace mismatches", async () => {
    const handler = createReadPageToolHandler(
      createTargetStub({
        getMetadata: async () => ({
          title: "Cross-workspace page",
          workspaceId: "ws-2",
        }),
      }) as any,
      createScopeRepoStub() as any,
    );

    const result = await handler.execute(
      {},
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: KNOWLEDGE_PAGE_TARGET_TYPE,
            targetId: "page-1",
          },
        },
      },
    );

    expect(result).toEqual({
      success: false,
      error: {
        code: "WORKSPACE_MISMATCH",
        message: "Active page does not belong to the current workspace",
      },
    });
  });

  test("rejects page not found", async () => {
    const handler = createReadPageToolHandler(
      createTargetStub({ exists: async () => false }) as any,
      createScopeRepoStub() as any,
    );

    const result = await handler.execute(
      {},
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: KNOWLEDGE_PAGE_TARGET_TYPE,
            targetId: "page-missing",
          },
        },
      },
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: "PAGE_NOT_FOUND" },
    });
  });

  test("respects max_chars truncation", async () => {
    const longText = "A".repeat(1000);
    const handler = createReadPageToolHandler(
      createTargetStub({
        getContentContext: async () => ({
          fullContent: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: longText }],
              },
            ],
          },
          contentMarkdown: longText,
        }),
      }) as any,
      createScopeRepoStub() as any,
    );

    const result = (await handler.execute(
      { max_chars: 300 },
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: KNOWLEDGE_PAGE_TARGET_TYPE,
            targetId: "page-1",
          },
        },
      },
    )) as {
      success: boolean;
      total_chars?: number;
      returned_chars?: number;
      truncated?: boolean;
    };

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.total_chars).toBeGreaterThan(300);
    expect(result.returned_chars).toBe(300);
  });

  test("rejects invalid max_chars", async () => {
    const handler = createReadPageToolHandler(
      createTargetStub() as any,
      createScopeRepoStub() as any,
    );

    const result = await handler.execute(
      { max_chars: 50 },
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: KNOWLEDGE_PAGE_TARGET_TYPE,
            targetId: "page-1",
          },
        },
      },
    ) as { success: boolean; error?: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_MAX_CHARS");
  });

  test("rejects explicit page_id outside active scope", async () => {
    const handler = createReadPageToolHandler(
      createTargetStub() as any,
      createScopeRepoStub({ isAncestor: async () => false }) as any,
    );

    const result = await handler.execute(
      { page_id: "outside-page" },
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: KNOWLEDGE_PAGE_TARGET_TYPE,
            targetId: "page-1",
          },
        },
      },
    ) as { success: boolean; error?: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PAGE_ACCESS_DENIED");
  });

  test("allows exact mentioned page outside subtree", async () => {
    const handler = createReadPageToolHandler(
      createTargetStub() as any,
      createScopeRepoStub({ isAncestor: async () => false }) as any,
    );

    const result = await handler.execute(
      { page_id: "outside-page" },
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: KNOWLEDGE_PAGE_TARGET_TYPE,
            targetId: "page-1",
          },
          knowledgeScope: {
            rootPageId: "page-1",
            mentionedPageIds: ["outside-page"],
            grantMode: "exact",
            grantLifetime: "turn",
          },
        },
      },
    ) as { success: boolean; page?: { id: string }; error?: { code: string } };

    expect(result.success).toBe(true);
    expect(result.page?.id).toBe("outside-page");
  });

  test("mention grant is turn-scoped: next turn without mention is denied", async () => {
    const handler = createReadPageToolHandler(
      createTargetStub() as any,
      createScopeRepoStub({ isAncestor: async () => false }) as any,
    );

    const withMention = await handler.execute(
      { page_id: "outside-page" },
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: KNOWLEDGE_PAGE_TARGET_TYPE,
            targetId: "page-1",
          },
          knowledgeScope: {
            rootPageId: "page-1",
            mentionedPageIds: ["outside-page"],
            grantMode: "exact",
            grantLifetime: "turn",
          },
        },
      },
    ) as { success: boolean };

    const nextTurnWithoutMention = await handler.execute(
      { page_id: "outside-page" },
      {
        taskId: "task-2",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: KNOWLEDGE_PAGE_TARGET_TYPE,
            targetId: "page-1",
          },
        },
      },
    ) as { success: boolean; error?: { code: string } };

    expect(withMention.success).toBe(true);
    expect(nextTurnWithoutMention.success).toBe(false);
    expect(nextTurnWithoutMention.error?.code).toBe("PAGE_ACCESS_DENIED");
  });
});
