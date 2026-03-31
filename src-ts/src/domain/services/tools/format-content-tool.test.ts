import { describe, expect, it, mock } from "bun:test";
import { createFormatContentHandler, formatContentToolSpec } from "./format-content-tool";
import type { ContentTargetRegistry } from "../content-editor/content-target-registry";
import type { ContentEditSnapshotRepository } from "../../../db/repositories/content-edit-snapshot";
import type { ContentTarget } from "../content-editor/content-target.interface";
import type { TiptapDocument } from "../../utils/markdown-to-tiptap";

describe("core.format_content tool", () => {
  it("registers as a core-scoped tool", () => {
    expect(formatContentToolSpec.name).toBe("core.format_content");
    expect(formatContentToolSpec.scope).toBe("core");
    expect(formatContentToolSpec.version).toBe("1.0");
  });

  it("rejects knowledge.page target outside active page scope", async () => {
    const initialDoc: TiptapDocument = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    };
    let currentDoc = initialDoc;
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });

    const target: ContentTarget = {
      targetType: "knowledge.page",
      label: "Knowledge Page",
      supportedModes: ["replace", "append", "selection", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () => ({
        fullContent: currentDoc,
        contentMarkdown: "Hello",
      }),
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1", parentId: null }),
    };

    const createSnapshot = mock(async () => ({ id: "snap-1" } as unknown));
    const snapshotRepo = {
      createSnapshot,
      markActive: async () => {},
      completeEdit: async () => {},
      failEdit: async () => {},
      markRolledBack: async () => {},
    } as unknown as ContentEditSnapshotRepository;
    const targetRegistry = {
      resolve: async () => target,
    } as unknown as ContentTargetRegistry;

    const handler = createFormatContentHandler(targetRegistry, snapshotRepo);

    const result = await handler.execute(
      {
        mode: "operations",
        target_type: "knowledge.page",
        target_id: "outside-page",
        operations: [
          {
            target: { blockType: "all" },
            textStyles: { bold: true },
          },
        ],
      },
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: "knowledge.page",
            targetId: "page-1",
          },
        },
      },
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: "PAGE_ACCESS_DENIED" },
    });
    expect(setContent).not.toHaveBeenCalled();
    expect(createSnapshot).not.toHaveBeenCalled();
  });

  it("allows exact mention grant for out-of-subtree knowledge.page target", async () => {
    const initialDoc: TiptapDocument = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    };
    let currentDoc = initialDoc;
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });

    const target: ContentTarget = {
      targetType: "knowledge.page",
      label: "Knowledge Page",
      supportedModes: ["replace", "append", "selection", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () => ({
        fullContent: currentDoc,
        contentMarkdown: "Hello",
      }),
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1", parentId: null }),
    };

    const createSnapshot = mock(async () => ({ id: "snap-1" } as unknown));
    const snapshotRepo = {
      createSnapshot,
      markActive: async () => {},
      completeEdit: async () => {},
      failEdit: async () => {},
      markRolledBack: async () => {},
    } as unknown as ContentEditSnapshotRepository;
    const targetRegistry = {
      resolve: async () => target,
    } as unknown as ContentTargetRegistry;

    const handler = createFormatContentHandler(targetRegistry, snapshotRepo);

    const result = await handler.execute(
      {
        mode: "operations",
        target_type: "knowledge.page",
        target_id: "outside-page",
        operations: [
          {
            target: { blockType: "all" },
            textStyles: { bold: true },
          },
        ],
      },
      {
        taskId: "task-1",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: "knowledge.page",
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
    ) as { success: boolean; operationsApplied?: number; error?: { code: string } };

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.operationsApplied).toBe(1);
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(createSnapshot).toHaveBeenCalledTimes(1);
  });
});
