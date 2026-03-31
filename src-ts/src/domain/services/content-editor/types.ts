/**
 * Content Editor Types
 *
 * Core type definitions for the AI content editing system.
 */

import type { TiptapDocument } from "../../utils/markdown-to-tiptap";

/**
 * Edit modes supported
 */
export type EditMode = "replace" | "append" | "selection" | "generate";

/**
 * Target reference - identifies a content target
 */
export interface TargetRef {
  /** Target type (e.g., "knowledge.page") */
  targetType: string;
  /** Target ID */
  targetId: string;
}

/**
 * Selection within content (Tiptap positions)
 */
export interface ContentSelection {
  type: "tiptap";
  /** Start position (character offset in document) */
  from: number;
  /** End position */
  to: number;
  /** Selected text (optional, for context) */
  selectedText?: string;
}

/**
 * Context window configuration for editing operations
 */
export interface ContextWindow {
  /** Number of content blocks to include before the selection */
  blocksBefore?: number;
  /** Number of content blocks to include after the selection */
  blocksAfter?: number;
  /** Additional characters to include before the selection */
  charsBefore?: number;
  /** Additional characters to include after the selection */
  charsAfter?: number;
  /** Request the entire document as context rather than windowed */
  fullDocument?: boolean;
}

/**
 * Supported formatting options for edit output
 */
export type OutputFormat = "raw" | "markers";

/**
 * Edit request input
 */
export interface EditContentInput {
  /** Target to edit */
  target: TargetRef;
  /** Edit mode */
  mode: EditMode;
  /** AI instruction for editing */
  instruction: string;
  /** Selection (required for selection mode) */
  selection?: ContentSelection;
  /** Provider to use */
  provider: string;
  /** Model to use */
  model: string;
  /** Workspace context */
  workspaceId: string;
  /** Optional project context */
  projectId?: string;
  /** Custom system prompt override */
  systemPrompt?: string;
  /** Temperature (0-2, default based on mode) */
  temperature?: number;
  /** Max tokens for response */
  maxTokens?: number;
  /** Context window controls */
  contextWindow?: ContextWindow;
  /** Preferred output formatting */
  outputFormat?: OutputFormat;
  /** Content format for parsing — markdown or html */
  contentFormat?: "markdown" | "html";
}

/**
 * Edit stream result
 */
export interface EditStreamResult {
  /** SSE stream */
  stream: ReadableStream<Uint8Array>;
  /** Edit operation ID */
  editId: string;
  /** Snapshot ID for rollback */
  snapshotId: string;
  /** Lock ID if acquired */
  lockId?: string;
}

/**
 * Content context for prompt building
 */
export interface ContentContext {
  /** Full document content (Tiptap JSON) */
  fullContent: TiptapDocument;
  /** Document as markdown (for AI context) */
  contentMarkdown: string;
  /** Document as HTML (for rich formatting AI context) */
  contentHtml?: string;
  /** Selected portion (for selection mode) */
  selectedContent?: {
    markdown: string;
    tiptap: TiptapDocument;
  };
  /** Context before selection */
  contextBefore?: string;
  /** Context after selection */
  contextAfter?: string;
}

/**
 * Edit completion info
 */
export interface EditCompletionInfo {
  editId: string;
  contentAfter: TiptapDocument;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Edit cancellation info
 */
export interface EditCancellationInfo {
  editId: string;
  rolledBack: boolean;
  partialContent?: string;
}

/**
 * Registered target info (for API)
 */
export interface RegisteredTargetInfo {
  targetType: string;
  label: string;
  description?: string;
  supportedModes: EditMode[];
}
