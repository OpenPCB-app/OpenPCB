/**
 * EditorEngineAdapter Interface
 *
 * Abstraction layer for block-based editors. This allows swapping
 * the underlying editor engine (BlockNote, TipTap, etc.) without
 * changing the Knowledge module's business logic.
 */

export interface EditorInstance {
  id: string;
  document: unknown;
}

export interface RenderOptions {
  /** Exclude base64 images from markdown output */
  excludeImages?: boolean;
  /** Include code blocks in markdown output */
  includeCodeBlocks?: boolean;
  /** Maximum characters for output (truncate if exceeded) */
  maxChars?: number;
}

export interface BlockData {
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlockData[];
}

export interface EditorEngineAdapter {
  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Create a new editor instance with optional initial content
   */
  createEditor(initialContent?: unknown): EditorInstance;

  /**
   * Clean up editor instance resources
   */
  destroyEditor(editor: EditorInstance): void;

  // ============================================
  // Content Access
  // ============================================

  /**
   * Get the current editor content as JSON
   */
  getContentJson(editor: EditorInstance): unknown;

  /**
   * Replace editor content with new JSON data
   */
  setContentJson(editor: EditorInstance, json: unknown): void;

  // ============================================
  // Rendering
  // ============================================

  /**
   * Render editor content to Markdown format
   */
  renderToMarkdown(json: unknown, options?: RenderOptions): string;

  /**
   * Extract plain text from editor content (no formatting)
   */
  getPlainText(json: unknown): string;

  // ============================================
  // Validation
  // ============================================

  /**
   * Validate that JSON matches expected schema
   */
  validate(json: unknown): boolean;

  // ============================================
  // Optional Extensions
  // ============================================

  /**
   * Convert pasted markdown to editor blocks
   */
  applyMarkdownPaste?(editor: EditorInstance, markdown: string): void;

  /**
   * Get word count from content
   */
  getWordCount?(json: unknown): number;
}

/**
 * Default empty document for new pages
 */
export const EMPTY_DOCUMENT: BlockData[] = [
  {
    type: "paragraph",
    content: [],
  },
];

/**
 * Helper to check if content is empty
 */
export function isEmptyDocument(json: unknown): boolean {
  if (!Array.isArray(json)) return true;
  if (json.length === 0) return true;
  if (json.length === 1) {
    const block = json[0] as BlockData;
    if (block.type === "paragraph") {
      const content = block.content;
      if (!content || (Array.isArray(content) && content.length === 0)) {
        return true;
      }
    }
  }
  return false;
}
