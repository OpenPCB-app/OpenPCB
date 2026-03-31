/**
 * Prompt Builder for Content Editing
 *
 * Builds AI prompts for different edit modes.
 * Focus on selection mode as the primary implementation.
 */

import type { EditMode, ContentContext, ContentSelection } from "./types";
import type { ContentFormat } from "./output-parser";

/**
 * Built prompt for AI
 */
export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Prompt builder options
 */
export interface PromptBuilderOptions {
  /** Edit mode */
  mode: EditMode;
  /** User instruction */
  instruction: string;
  /** Content context */
  context: ContentContext;
  /** Selection info (for selection mode) */
  selection?: ContentSelection;
  /** Custom system prompt override */
  customSystemPrompt?: string;
  /** Include markdown formatting guide */
  includeFormatGuide?: boolean;
  /** Content format — markdown or html */
  contentFormat?: ContentFormat;
}

/**
 * Build prompts for content editing
 */
export function buildEditPrompt(options: PromptBuilderOptions): BuiltPrompt {
  const { mode, instruction, context, selection, customSystemPrompt, includeFormatGuide = true, contentFormat = "markdown" } = options;

  // Use custom system prompt if provided
  if (customSystemPrompt) {
    return {
      systemPrompt: customSystemPrompt,
      userPrompt: buildUserPrompt(mode, instruction, context, selection),
    };
  }

  // Build mode-specific prompts
  switch (mode) {
    case "selection":
      return buildSelectionPrompt(instruction, context, selection, includeFormatGuide, contentFormat);
    case "replace":
      return buildReplacePrompt(instruction, context, includeFormatGuide, contentFormat);
    case "append":
      return buildAppendPrompt(instruction, context, includeFormatGuide, contentFormat);
    default:
      throw new Error(`Unsupported edit mode: ${mode}`);
  }
}

/**
 * Build prompt for selection mode
 */
function buildSelectionPrompt(
  instruction: string,
  context: ContentContext,
  selection?: ContentSelection,
  includeFormatGuide?: boolean,
  contentFormat: ContentFormat = "markdown",
): BuiltPrompt {
  const isHtml = contentFormat === "html";
  const formatGuide = includeFormatGuide ? (isHtml ? HTML_FORMAT_GUIDE : MARKDOWN_FORMAT_GUIDE) : "";
  const formatNote = isHtml ? "Output HTML with inline styles." : "Use appropriate markdown formatting.";

  const systemPrompt = `You are a precise content editor. Your task is to edit a specific selection of text according to the user's instructions.

CRITICAL RULES:
1. Output ONLY the replacement text for the selection - nothing else
2. Do not include explanations, introductions, or commentary
3. Do not wrap your output in quotes or code blocks
4. Match the formatting style of the surrounding content
5. ${formatNote}
${formatGuide}

You will receive:
- The selected text to edit
- Context before and after the selection (for understanding, DO NOT include in output)
- Instructions for how to edit the selection`;

  const selectedText = selection?.selectedText || context.selectedContent?.markdown || "[Selection not provided]";
  const contextBefore = context.contextBefore || "";
  const contextAfter = context.contextAfter || "";

  const userPrompt = `SELECTION TO EDIT:
\`\`\`
${selectedText}
\`\`\`

${contextBefore ? `CONTEXT BEFORE (for reference only - do not include):
\`\`\`
${truncateContext(contextBefore, 500)}
\`\`\`

` : ""}${contextAfter ? `CONTEXT AFTER (for reference only - do not include):
\`\`\`
${truncateContext(contextAfter, 500)}
\`\`\`

` : ""}INSTRUCTIONS: ${instruction}

Output the edited replacement text now:`;

  return { systemPrompt, userPrompt };
}

/**
 * Build prompt for replace mode
 */
function buildReplacePrompt(
  instruction: string,
  context: ContentContext,
  includeFormatGuide?: boolean,
  contentFormat: ContentFormat = "markdown",
): BuiltPrompt {
  const isHtml = contentFormat === "html";
  const formatGuide = includeFormatGuide ? (isHtml ? HTML_FORMAT_GUIDE : MARKDOWN_FORMAT_GUIDE) : "";
  const formatNote = isHtml ? "Output HTML with inline styles for rich formatting." : "Use appropriate markdown formatting.";
  const contentLabel = isHtml ? "html" : "markdown";
  const docContent = context.contentHtml && isHtml ? context.contentHtml : context.contentMarkdown;

  const systemPrompt = `You are a content editor. Your task is to rewrite the entire document according to the user's instructions.

CRITICAL RULES:
1. Output ONLY the new document content - nothing else
2. Do not include explanations, introductions, or commentary
3. Do not wrap your output in quotes or code blocks
4. ${formatNote}
${formatGuide}`;

  const userPrompt = `CURRENT DOCUMENT:
\`\`\`${contentLabel}
${truncateContext(docContent, 8000)}
\`\`\`

INSTRUCTIONS: ${instruction}

Output the new document content now:`;

  return { systemPrompt, userPrompt };
}

/**
 * Build prompt for append mode
 */
function buildAppendPrompt(
  instruction: string,
  context: ContentContext,
  includeFormatGuide?: boolean,
  contentFormat: ContentFormat = "markdown",
): BuiltPrompt {
  const isHtml = contentFormat === "html";
  const formatGuide = includeFormatGuide ? (isHtml ? HTML_FORMAT_GUIDE : MARKDOWN_FORMAT_GUIDE) : "";
  const formatNote = isHtml ? "Output HTML with inline styles matching the document style." : "Use appropriate markdown formatting that matches the document style.";
  const contentLabel = isHtml ? "html" : "markdown";
  const docContent = context.contentHtml && isHtml ? context.contentHtml : context.contentMarkdown;

  const systemPrompt = `You are a content writer. Your task is to add new content at the end of a document according to the user's instructions.

CRITICAL RULES:
1. Output ONLY the new content to append - nothing else
2. Do not include explanations, introductions, or commentary
3. Do not repeat or summarize existing content
4. ${formatNote}
${formatGuide}`;

  const userPrompt = `EXISTING DOCUMENT (for context - do not repeat):
\`\`\`${contentLabel}
${truncateContext(docContent, 4000)}
\`\`\`

INSTRUCTIONS: ${instruction}

Output the new content to append now:`;

  return { systemPrompt, userPrompt };
}

/**
 * Build generic user prompt
 */
function buildUserPrompt(
  mode: EditMode,
  instruction: string,
  context: ContentContext,
  selection?: ContentSelection
): string {
  switch (mode) {
    case "selection":
      return `Edit this selection: "${selection?.selectedText || context.selectedContent?.markdown || ""}"
Instructions: ${instruction}`;

    case "replace":
      return `Rewrite this document according to: ${instruction}
Current content:
${truncateContext(context.contentMarkdown, 4000)}`;

    case "append":
      return `Add content after this document: ${instruction}
Current content:
${truncateContext(context.contentMarkdown, 2000)}`;

    default:
      return instruction;
  }
}

/**
 * Truncate context to max characters, preserving word boundaries
 */
function truncateContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > maxChars * 0.8) {
    return truncated.slice(0, lastSpace) + "...";
  }

  return truncated + "...";
}

/**
 * Markdown format guide for AI
 */
const MARKDOWN_FORMAT_GUIDE = `
MARKDOWN FORMATTING:
- Use # for headings (# H1, ## H2, etc.)
- Use **bold** and *italic* for emphasis
- Use \`code\` for inline code
- Use - or * for bullet lists
- Use 1. 2. 3. for numbered lists
- Use > for blockquotes
- Use [text](url) for links
- Use \`\`\`language for code blocks`;

const HTML_FORMAT_GUIDE = `
HTML FORMATTING (use inline styles for rich formatting):
- Headings: <h1>, <h2>, <h3>
- Bold: <strong>, Italic: <em>, Underline: <u>, Strike: <s>
- Color: <span style="color: #hex">text</span>
- Font: <span style="font-family: Georgia">text</span>
- Size: <span style="font-size: 16px">text</span>
- Highlight: <mark style="background-color: #hex">text</mark>
- Alignment: <p style="text-align: center">text</p>
- Line height: <p style="line-height: 1.5">text</p>
- Lists: <ul><li>, <ol><li>
- Task list: <ul data-type="taskList"><li data-type="taskItem" data-checked="false">
- Code: <pre><code class="language-js">
- Blockquote: <blockquote>
- Links: <a href="url">text</a>
- Subscript: <sub>, Superscript: <sup>
- Callout: <div data-callout-type="info">text</div> (types: info, warning, error, success)
- Toggle: <details><summary>Title</summary>Content</details>`;

/**
 * Get recommended temperature for edit mode
 */
export function getRecommendedTemperature(mode: EditMode): number {
  switch (mode) {
    case "selection":
      // Lower temperature for precise edits
      return 0.3;
    case "replace":
      // Medium temperature for rewrites
      return 0.5;
    case "append":
      // Higher temperature for creative additions
      return 0.7;
    default:
      return 0.5;
  }
}

/**
 * Get recommended max tokens for edit mode
 */
export function getRecommendedMaxTokens(mode: EditMode, selectionLength?: number): number {
  switch (mode) {
    case "selection":
      // Based on selection length, min 500, max 2000
      const base = selectionLength ? Math.ceil(selectionLength * 1.5) : 500;
      return Math.min(Math.max(base, 500), 2000);
    case "replace":
      // Full document replacement
      return 4000;
    case "append":
      // New content addition
      return 2000;
    default:
      return 1000;
  }
}
