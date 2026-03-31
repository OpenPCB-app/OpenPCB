/**
 * Knowledge Page Content Target
 *
 * Implements ContentTarget interface for Knowledge pages.
 * Allows AI content editor to edit page content.
 */

import type { ContentTarget } from "../../../../src-ts/src/domain/services/content-editor/content-target.interface";
import type {
  EditMode,
  ContentSelection,
  ContentContext,
  ContextWindow,
} from "../../../../src-ts/src/domain/services/content-editor/types";
import type {
  TiptapDocument,
  TiptapNode,
} from "../../../../src-ts/src/domain/utils/markdown-to-tiptap";
import { tiptapToMarkdown } from "../../../../src-ts/src/domain/utils/tiptap-to-markdown";
import type { PageService } from "../services/page-service";

/**
 * Target type identifier for Knowledge pages
 */
export const KNOWLEDGE_PAGE_TARGET_TYPE = "knowledge.page";

/**
 * Context character limit for AI prompt
 */
const CONTEXT_CHAR_LIMIT = 10000;

const DEFAULT_SELECTION_CONTEXT_WINDOW: ContextWindow = {
  blocksBefore: 2,
  blocksAfter: 2,
};

type SelectionWithContextWindow = ContentSelection & {
  contextWindow?: ContextWindow;
};

/**
 * Knowledge Page content target adapter
 */
export class KnowledgePageTarget implements ContentTarget {
  readonly targetType = KNOWLEDGE_PAGE_TARGET_TYPE;
  readonly label = "Knowledge Page";
  readonly description = "Edit Knowledge page content with AI";
  readonly supportedModes: EditMode[] = ["replace", "append", "selection", "generate"];

  constructor(private pageService: PageService) {}

  /**
   * Check if page exists
   */
  async exists(targetId: string): Promise<boolean> {
    const page = await this.pageService.getPage(targetId);
    return page !== null;
  }

  /**
   * Get page content as TiptapDocument
   */
  async getContent(targetId: string): Promise<TiptapDocument> {
    const page = await this.pageService.getPage(targetId);
    if (!page) {
      throw new Error(`Page not found: ${targetId}`);
    }

    // Extract Tiptap data from EditorContent wrapper
    const content = page.content_json;
    if (!content || content.engine !== "tiptap" || !content.data) {
      return { type: "doc", content: [{ type: "paragraph" }] };
    }

    return content.data as TiptapDocument;
  }

  /**
   * Get content context for AI prompt building
   */
  async getContentContext(
    targetId: string,
    selection?: ContentSelection
  ): Promise<ContentContext> {
    const fullContent = await this.getContent(targetId);
    const contentMarkdown = this.renderMarkdown(fullContent);

    const context: ContentContext = {
      fullContent,
      contentMarkdown,
    };

    // Add selection context if provided
    if (selection && selection.from !== selection.to) {
      const normalizedSelection = this.normalizeSelection(selection, fullContent);
      const window = this.resolveContextWindow(selection);
      const selectedInfo = this.extractSelectionContext(
        fullContent,
        normalizedSelection,
        window
      );
      context.selectedContent = selectedInfo.selectedContent;
      context.contextBefore = selectedInfo.contextBefore;
      context.contextAfter = selectedInfo.contextAfter;
    }

    return context;
  }

  /**
   * Set page content
   */
  async setContent(targetId: string, content: TiptapDocument): Promise<void> {
    await this.pageService.updatePageContent(targetId, {
      engine: "tiptap",
      version: 1,
      data: content,
    });
  }

  /**
   * Apply a selection update (replace content in a range)
   */
  async applySelectionUpdate(
    targetId: string,
    selection: ContentSelection,
    newContent: TiptapDocument
  ): Promise<void> {
    const current = await this.getContent(targetId);

    // Apply the replacement
    const updated = this.replaceSelectionInDoc(current, selection, newContent);

    await this.setContent(targetId, updated);
  }

  /**
   * Validate selection is within document bounds
   */
  async validateSelection(
    targetId: string,
    selection: ContentSelection
  ): Promise<boolean> {
    const content = await this.getContent(targetId);

    // Calculate document size
    const docSize = this.calculateDocSize(content);

    // Check bounds
    return (
      selection.from >= 0 &&
      selection.to <= docSize &&
      selection.from <= selection.to
    );
  }

  /**
   * Get page metadata
   */
  async getMetadata(targetId: string): Promise<Record<string, unknown>> {
    const page = await this.pageService.getPage(targetId);
    if (!page) {
      return {};
    }

    return {
      title: page.title,
      icon: page.icon,
      parentId: page.parent_id,
      workspaceId: page.workspace_id,
      projectId: page.project_id,
      createdAt: page.created_at.toISOString(),
      updatedAt: page.updated_at.toISOString(),
    };
  }

  // ─── Private Methods ────────────────────────────────────────────────────────

  /**
   * Extract selection context from document
   */
  private extractSelectionContext(
    doc: TiptapDocument,
    selection: ContentSelection,
    window: ContextWindow
  ): {
    selectedContent?: ContentContext["selectedContent"];
    contextBefore?: string;
    contextAfter?: string;
  } {
    const normalizedSelection = this.normalizeSelection(selection, doc);

    if (normalizedSelection.from === normalizedSelection.to) {
      return {};
    }

    const selectedDoc = this.sliceDoc(
      doc,
      normalizedSelection.from,
      normalizedSelection.to
    );
    const selectedMarkdown = this.renderMarkdown(selectedDoc);
    const { contextBefore, contextAfter } = this.extractContextWindow(
      doc,
      normalizedSelection,
      window
    );

    return {
      selectedContent: {
        markdown: selectedMarkdown,
        tiptap: selectedDoc,
      },
      contextBefore,
      contextAfter,
    };
  }

  private renderMarkdown(doc: TiptapDocument): string {
    return tiptapToMarkdown(doc, {
      maxChars: CONTEXT_CHAR_LIMIT,
      excludeImages: true,
      includeCodeBlocks: true,
    });
  }

  private resolveContextWindow(selection: ContentSelection): ContextWindow {
    const withWindow = selection as SelectionWithContextWindow;
    return withWindow.contextWindow ?? DEFAULT_SELECTION_CONTEXT_WINDOW;
  }

  private normalizeSelection(
    selection: ContentSelection,
    doc: TiptapDocument
  ): ContentSelection {
    const docSize = this.calculateDocSize(doc);
    const from = Math.max(0, Math.min(selection.from, docSize));
    const to = Math.max(0, Math.min(selection.to, docSize));

    if (from <= to) {
      return { ...selection, from, to };
    }

    return { ...selection, from: to, to: from };
  }

  private extractContextWindow(
    doc: TiptapDocument,
    selection: ContentSelection,
    window: ContextWindow
  ): { contextBefore?: string; contextAfter?: string } {
    const docSize = this.calculateDocSize(doc);
    const from = Math.max(0, Math.min(selection.from, docSize));
    const to = Math.max(0, Math.min(selection.to, docSize));

    if (window.fullDocument) {
      return {
        contextBefore: this.renderMarkdown(this.sliceDoc(doc, 0, from)),
        contextAfter: this.renderMarkdown(this.sliceDoc(doc, to, docSize)),
      };
    }

    const blockContext = this.extractBlockWindow(doc, from, to, window);
    const charContext = this.extractCharWindow(doc, from, to, window);

    return {
      contextBefore: this.pickContext(
        blockContext.contextBefore,
        charContext.contextBefore
      ),
      contextAfter: this.pickContext(
        blockContext.contextAfter,
        charContext.contextAfter
      ),
    };
  }

  private extractBlockWindow(
    doc: TiptapDocument,
    from: number,
    to: number,
    window: ContextWindow
  ): { contextBefore?: string; contextAfter?: string } {
    const blocksBefore = window.blocksBefore ?? 0;
    const blocksAfter = window.blocksAfter ?? 0;

    if (blocksBefore === 0 && blocksAfter === 0) {
      return {};
    }

    const blocks = this.getTopLevelBlocks(doc);
    if (blocks.length === 0) {
      return {};
    }

    let startIndex = blocks.findIndex((block) => block.end > from);
    if (startIndex === -1) {
      startIndex = blocks.length - 1;
    }

    let endIndex = -1;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i]!.start < to) {
        endIndex = i;
      }
    }

    if (endIndex === -1) {
      endIndex = startIndex;
    }

    const beforeStart = Math.max(0, startIndex - blocksBefore);
    const beforeBlocks = blocks
      .slice(beforeStart, startIndex)
      .map((block) => block.node);
    const afterBlocks = blocks
      .slice(endIndex + 1, endIndex + 1 + blocksAfter)
      .map((block) => block.node);

    return {
      contextBefore: beforeBlocks.length
        ? this.renderMarkdown({ type: "doc", content: beforeBlocks })
        : undefined,
      contextAfter: afterBlocks.length
        ? this.renderMarkdown({ type: "doc", content: afterBlocks })
        : undefined,
    };
  }

  private extractCharWindow(
    doc: TiptapDocument,
    from: number,
    to: number,
    window: ContextWindow
  ): { contextBefore?: string; contextAfter?: string } {
    const charsBefore = window.charsBefore ?? 0;
    const charsAfter = window.charsAfter ?? 0;
    const docSize = this.calculateDocSize(doc);

    const contextBefore =
      charsBefore > 0
        ? this.renderMarkdown(
            this.sliceDoc(doc, Math.max(0, from - charsBefore), from)
          )
        : undefined;

    const contextAfter =
      charsAfter > 0
        ? this.renderMarkdown(
            this.sliceDoc(doc, to, Math.min(docSize, to + charsAfter))
          )
        : undefined;

    return { contextBefore, contextAfter };
  }

  private getTopLevelBlocks(
    doc: TiptapDocument
  ): Array<{ node: TiptapNode; start: number; end: number }> {
    const blocks: Array<{ node: TiptapNode; start: number; end: number }> = [];

    if (!doc.content) {
      return blocks;
    }

    let pos = 0;
    for (const node of doc.content) {
      const size = this.calculateNodeSize(node);
      blocks.push({ node, start: pos, end: pos + size });
      pos += size;
    }

    return blocks;
  }

  private pickContext(primary?: string, fallback?: string): string | undefined {
    if (primary && fallback) {
      return primary.length >= fallback.length ? primary : fallback;
    }

    return primary ?? fallback;
  }

  /**
   * Replace selection in document with new content
   */
  private replaceSelectionInDoc(
    doc: TiptapDocument,
    selection: ContentSelection,
    newContent: TiptapDocument
  ): TiptapDocument {
    if (!doc.content) {
      return newContent;
    }

    const normalizedSelection = this.normalizeSelection(selection, doc);
    if (normalizedSelection.from === normalizedSelection.to) {
      return doc;
    }

    const docSize = this.calculateDocSize(doc);
    const before = this.sliceDoc(doc, 0, normalizedSelection.from);
    const after = this.sliceDoc(doc, normalizedSelection.to, docSize);
    const replacementBlocks = newContent.content ?? [];
    const replacementInline = this.extractInlineReplacement(newContent);
    const inlineReplace =
      this.isSelectionWithinSameTextblock(doc, normalizedSelection) &&
      replacementInline !== null;

    if (inlineReplace) {
      const merged = this.mergeInlineSlices(before, replacementInline!, after);
      if (merged) {
        return merged;
      }
    }

    return {
      type: "doc",
      content: [
        ...(before.content ?? []),
        ...replacementBlocks,
        ...(after.content ?? []),
      ],
    };
  }

  private mergeInlineSlices(
    before: TiptapDocument,
    replacementInline: TiptapNode[],
    after: TiptapDocument
  ): TiptapDocument | null {
    const beforeContent = before.content ?? [];
    const afterContent = after.content ?? [];
    const beforeTail = beforeContent[beforeContent.length - 1];
    const afterHead = afterContent[0];

    if (!beforeTail || !afterHead || !this.nodesMergeable(beforeTail, afterHead)) {
      if (afterHead && this.isTextblockNode(afterHead)) {
        const mergedAtStart: TiptapNode = {
          ...afterHead,
          content: [...replacementInline, ...(afterHead.content ?? [])],
        };
        return {
          type: "doc",
          content: [...beforeContent, mergedAtStart, ...afterContent.slice(1)],
        };
      }

      if (beforeTail && this.isTextblockNode(beforeTail)) {
        const mergedAtEnd: TiptapNode = {
          ...beforeTail,
          content: [...(beforeTail.content ?? []), ...replacementInline],
        };
        return {
          type: "doc",
          content: [...beforeContent.slice(0, -1), mergedAtEnd, ...afterContent],
        };
      }

      return null;
    }

    const merged = this.mergeTextblockNodes(
      beforeTail,
      replacementInline,
      afterHead
    );

    return {
      type: "doc",
      content: [
        ...beforeContent.slice(0, -1),
        merged,
        ...afterContent.slice(1),
      ],
    };
  }

  private extractInlineReplacement(
    newContent: TiptapDocument
  ): TiptapNode[] | null {
    const content = newContent.content ?? [];

    if (content.length === 0) {
      return [];
    }

    if (content.every((node) => this.isInlineNode(node))) {
      return content;
    }

    if (content.length === 1 && this.isTextblockNode(content[0]!)) {
      return content[0]!.content ?? [];
    }

    return null;
  }

  private isSelectionWithinSameTextblock(
    doc: TiptapDocument,
    selection: ContentSelection
  ): boolean {
    const startInfo = this.findTextblockAtPos(doc, selection.from);
    const endProbe = Math.max(selection.from, selection.to - 1);
    const endInfo = this.findTextblockAtPos(doc, endProbe);

    if (!startInfo || !endInfo) {
      return false;
    }

    if (!this.pathsEqual(startInfo.path, endInfo.path)) {
      return false;
    }

    return (
      selection.from >= startInfo.contentStart &&
      selection.to <= startInfo.contentEnd
    );
  }

  private findTextblockAtPos(
    doc: TiptapDocument,
    pos: number
  ): {
    node: TiptapNode;
    start: number;
    end: number;
    contentStart: number;
    contentEnd: number;
    path: number[];
  } | null {
    const root: TiptapNode = { type: "doc", content: doc.content ?? [] };
    return this.findTextblockInNode(root, pos, 0, true, []);
  }

  private findTextblockInNode(
    node: TiptapNode,
    pos: number,
    start: number,
    isRoot: boolean,
    path: number[]
  ): {
    node: TiptapNode;
    start: number;
    end: number;
    contentStart: number;
    contentEnd: number;
    path: number[];
  } | null {
    const size = isRoot
      ? this.calculateDocSize({ type: "doc", content: node.content ?? [] })
      : this.calculateNodeSize(node);
    const contentStart = isRoot ? start : start + 1;
    const contentEnd = isRoot ? start + size : start + size - 1;

    if (this.isTextblockNode(node) && pos >= contentStart && pos < contentEnd) {
      return {
        node,
        start,
        end: start + size,
        contentStart,
        contentEnd,
        path,
      };
    }

    if (!node.content || node.content.length === 0) {
      return null;
    }

    let childPos = contentStart;
    for (let i = 0; i < node.content.length; i++) {
      const child = node.content[i]!;
      const childSize = this.calculateNodeSize(child);
      const childStart = childPos;
      const childEnd = childStart + childSize;

      if (pos >= childStart && pos < childEnd) {
        const found = this.findTextblockInNode(
          child,
          pos,
          childStart,
          false,
          [...path, i]
        );
        if (found) {
          return found;
        }
      }

      childPos = childEnd;
    }

    return null;
  }

  private pathsEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) {
      return false;
    }

    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }

    return true;
  }

  private isTextblockNode(node: TiptapNode): boolean {
    if (!node.content || node.content.length === 0) {
      return false;
    }

    return node.content.every((child) => this.isInlineNode(child));
  }

  private isInlineNode(node: TiptapNode): boolean {
    return node.type === "text" || !node.content || node.content.length === 0;
  }

  private nodesMergeable(left: TiptapNode, right: TiptapNode): boolean {
    return (
      left.type === right.type &&
      this.isTextblockNode(left) &&
      this.isTextblockNode(right) &&
      this.areAttrsEqual(left.attrs, right.attrs)
    );
  }

  private areAttrsEqual(
    left?: Record<string, unknown>,
    right?: Record<string, unknown>
  ): boolean {
    if (left === right) {
      return true;
    }

    if (!left || !right) {
      return false;
    }

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (const key of leftKeys) {
      if (left[key] !== right[key]) {
        return false;
      }
    }

    return true;
  }

  private mergeTextblockNodes(
    beforeNode: TiptapNode,
    replacementInline: TiptapNode[],
    afterNode: TiptapNode
  ): TiptapNode {
    return {
      ...beforeNode,
      content: [
        ...(beforeNode.content ?? []),
        ...replacementInline,
        ...(afterNode.content ?? []),
      ],
    };
  }

  private sliceDoc(
    doc: TiptapDocument,
    from: number,
    to: number
  ): TiptapDocument {
    if (!doc.content || from >= to) {
      return { type: "doc", content: [] };
    }

    const content = this.sliceNodes(doc.content, from, to, 0, true);
    return { type: "doc", content };
  }

  private sliceNodes(
    nodes: TiptapNode[],
    from: number,
    to: number,
    parentPos: number,
    isRoot: boolean
  ): TiptapNode[] {
    const result: TiptapNode[] = [];
    let pos = isRoot ? parentPos : parentPos + 1;

    for (const node of nodes) {
      const size = this.calculateNodeSize(node);
      const start = pos;
      const end = pos + size;

      if (end <= from) {
        pos = end;
        continue;
      }

      if (start >= to) {
        break;
      }

      const sliced = this.sliceNode(node, from, to, pos);
      if (sliced) {
        result.push(sliced);
      }

      pos = end;
    }

    return result;
  }

  private sliceNode(
    node: TiptapNode,
    from: number,
    to: number,
    start: number
  ): TiptapNode | null {
    if (node.type === "text") {
      const text = node.text ?? "";
      const textStart = start;
      const textEnd = textStart + text.length;
      if (to <= textStart || from >= textEnd) {
        return null;
      }
      const sliceStart = Math.max(from, textStart) - textStart;
      const sliceEnd = Math.min(to, textEnd) - textStart;
      const slicedText = text.slice(sliceStart, sliceEnd);
      if (!slicedText) {
        return null;
      }
      return { ...node, text: slicedText };
    }

    const size = this.calculateNodeSize(node);
    const end = start + size;
    if (to <= start || from >= end) {
      return null;
    }

    if (!node.content || node.content.length === 0) {
      return node;
    }

    const children = this.sliceNodes(node.content, from, to, start, false);
    if (children.length === 0) {
      return null;
    }

    return { ...node, content: children };
  }

  /**
   * Calculate approximate node size (character positions)
   */
  private calculateNodeSize(node: TiptapNode): number {
    if (node.type === "text") {
      return (node.text || "").length;
    }

    if (!node.content || node.content.length === 0) {
      return 1;
    }

    let size = 2;
    for (const child of node.content) {
      size += this.calculateNodeSize(child);
    }

    return size;
  }

  /**
   * Calculate total document size
   */
  private calculateDocSize(doc: TiptapDocument): number {
    if (!doc.content) return 0;

    let size = 0;
    for (const node of doc.content) {
      size += this.calculateNodeSize(node);
    }
    return size;
  }
}
