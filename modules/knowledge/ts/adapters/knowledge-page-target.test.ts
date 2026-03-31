/// <reference path="../types/bun-test.d.ts" />
/// <reference path="../types/bun-test.d.ts" />

import { describe, expect, it } from "bun:test";
import { KnowledgePageTarget } from "./knowledge-page-target";
import type {
  ContentSelection,
  ContextWindow,
} from "../../../../src-ts/src/domain/services/content-editor/types";
import type { TiptapDocument, TiptapNode } from "../../../../src-ts/src/domain/utils/markdown-to-tiptap";
import type { PageService } from "../services/page-service";
import type { EditorContent } from "../../shared/types";

const createParagraph = (text: string): TiptapNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

class FakePageService {
  page: {
    id: string;
    title: string;
    workspace_id: string;
    project_id: string | null;
    icon: string | null;
    content_json: EditorContent;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
  } = {
    id: "page-1",
    title: "Test Document",
    workspace_id: "ws",
    project_id: "proj",
    icon: null,
    content_json: {
      engine: "tiptap",
      version: 1,
      data: { type: "doc", content: [] as TiptapNode[] },
    },
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  };
  lastUpdatedDoc?: TiptapDocument;

  constructor(doc: TiptapDocument) {
    this.page.content_json = {
      engine: "tiptap",
      version: 1,
      data: doc,
    };
  }

  async getPage() {
    return this.page;
  }

  async updatePageContent(_pageId: string, content: EditorContent) {
    this.lastUpdatedDoc = content.data as TiptapDocument;
    this.page = {
      ...this.page,
      content_json: content,
      updated_at: new Date(),
    };
    return this.page;
  }
}

describe("KnowledgePageTarget", () => {
  it("keeps blocks outside selection unchanged when replacing a paragraph", async () => {
    const firstParagraphText = "First paragraph stays in replaced range.";
    const secondParagraphText = "Second paragraph should remain untouched.";
    const initialDoc: TiptapDocument = {
      type: "doc",
      content: [
        createParagraph(firstParagraphText),
        createParagraph(secondParagraphText),
      ],
    };

    const fakeService = new FakePageService(initialDoc);
    const target = new KnowledgePageTarget(
      fakeService as unknown as PageService
    );

    const blocksAccessor = target as unknown as {
      getTopLevelBlocks(doc: TiptapDocument): Array<{ start: number; end: number }>;
    };
    const topLevelBlocks = blocksAccessor.getTopLevelBlocks(initialDoc);
    const firstBlock = topLevelBlocks[0];
    if (!firstBlock) {
      throw new Error("Expected at least one block to replace");
    }
    const selection: ContentSelection = {
      type: "tiptap",
      from: firstBlock.start,
      to: firstBlock.end,
    };

    const replacement: TiptapDocument = {
      type: "doc",
      content: [createParagraph("Replacement paragraph.")],
    };

    await target.applySelectionUpdate(fakeService.page.id, selection, replacement);

    const updated = fakeService.lastUpdatedDoc!;

    expect(updated.content?.[0]?.content?.[0]?.text).toBe("Replacement paragraph.");
    expect(updated.content?.[1]?.content?.[0]?.text).toBe(secondParagraphText);
  });

  it("respects selection context window limits", async () => {
    const firstParagraphText = "Paragraph before selection stands tall";
    const secondParagraphText = "Target paragraph in the middle";
    const thirdParagraphText = "Paragraph after selection breathes";
    const initialDoc: TiptapDocument = {
      type: "doc",
      content: [
        createParagraph(firstParagraphText),
        createParagraph(secondParagraphText),
        createParagraph(thirdParagraphText),
      ],
    };

    const fakeService = new FakePageService(initialDoc);
    const target = new KnowledgePageTarget(
      fakeService as unknown as PageService
    );

    const blocksAccessor = target as unknown as {
      getTopLevelBlocks(doc: TiptapDocument): Array<{ start: number; end: number }>;
    };
    const topLevelBlocks = blocksAccessor.getTopLevelBlocks(initialDoc);
    const secondBlock = topLevelBlocks[1];
    if (!secondBlock) {
      throw new Error("Expected a second block for selection");
    }

    const baseSelection: ContentSelection = {
      type: "tiptap",
      from: secondBlock.start,
      to: secondBlock.end,
    };

    const blockWindowSelection = {
      ...baseSelection,
      contextWindow: {
        blocksBefore: 1,
        blocksAfter: 1,
      },
    } as ContentSelection & { contextWindow: ContextWindow };

    const blockContext = await target.getContentContext(
      fakeService.page.id,
      blockWindowSelection
    );

    expect(
      blockContext.contextBefore?.includes(firstParagraphText) ?? false
    ).toBe(true);
    expect(
      blockContext.contextAfter?.includes(thirdParagraphText) ?? false
    ).toBe(true);

    const charsLimit = 4;
    const charWindowSelection = {
      ...baseSelection,
      contextWindow: {
        blocksBefore: 0,
        blocksAfter: 0,
        charsBefore: charsLimit,
        charsAfter: charsLimit,
      },
    } as ContentSelection & { contextWindow: ContextWindow };

    const charContext = await target.getContentContext(
      fakeService.page.id,
      charWindowSelection
    );

    expect(charContext.contextBefore != null).toBe(true);
    expect(
      (charContext.contextBefore?.length ?? 0) < firstParagraphText.length
    ).toBe(true);
    expect(charContext.contextAfter != null).toBe(true);
    expect(
      (charContext.contextAfter?.length ?? 0) < thirdParagraphText.length
    ).toBe(true);
  });
});
