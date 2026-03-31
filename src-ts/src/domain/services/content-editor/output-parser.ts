/**
 * Output Parser for Content Editing
 *
 * Parses AI-generated output and converts to Tiptap format.
 */

import { markdownToTiptap, optimizeTiptapDoc, type TiptapDocument } from "../../utils/markdown-to-tiptap";
import { htmlToTiptap } from "../../utils/html-to-tiptap";
import { ContentParseError } from "./errors";

export type ContentFormat = "markdown" | "html";

/**
 * Parse result
 */
export interface ParseResult {
  /** Parsed Tiptap document */
  tiptap: TiptapDocument;
  /** Raw markdown output */
  markdown: string;
  /** Whether any cleanup was performed */
  cleanedUp: boolean;
}

/**
 * Parse AI output to Tiptap document
 *
 * Handles common AI output artifacts:
 * - Unwanted markdown code block wrappers
 * - Leading/trailing quotes
 * - Extra whitespace
 */
export function parseEditOutput(output: string, format: ContentFormat = "markdown"): ParseResult {
  let cleaned = output;
  let cleanedUp = false;

  if (format === "html") {
    // For HTML format: strip wrapping code blocks and quotes
    const htmlCodeBlockMatch = cleaned.match(/^```(?:html)?\n?([\s\S]*?)```$/);
    if (htmlCodeBlockMatch && htmlCodeBlockMatch[1] !== undefined) {
      cleaned = htmlCodeBlockMatch[1];
      cleanedUp = true;
    }

    // Trim whitespace
    const trimmed = cleaned.trim();
    if (trimmed !== cleaned) {
      cleaned = trimmed;
      cleanedUp = true;
    }

    try {
      const tiptap = htmlToTiptap(cleaned);
      return { tiptap, markdown: cleaned, cleanedUp };
    } catch (err) {
      throw new ContentParseError(
        `Failed to parse HTML output to Tiptap: ${err instanceof Error ? err.message : String(err)}`,
        { output: output.slice(0, 500), error: err },
      );
    }
  }

  // Markdown format (original path)
  let markdown = cleaned;

  // Remove markdown code block wrappers if present
  const codeBlockMatch = markdown.match(/^```(?:markdown)?\n?([\s\S]*?)```$/);
  if (codeBlockMatch && codeBlockMatch[1] !== undefined) {
    markdown = codeBlockMatch[1];
    cleanedUp = true;
  }

  // Remove leading/trailing quotes
  if (
    (markdown.startsWith('"') && markdown.endsWith('"')) ||
    (markdown.startsWith("'") && markdown.endsWith("'"))
  ) {
    markdown = markdown.slice(1, -1);
    cleanedUp = true;
  }

  // Trim whitespace
  const trimmed = markdown.trim();
  if (trimmed !== markdown) {
    markdown = trimmed;
    cleanedUp = true;
  }

  // Extract replacement tags if present
  const replacementMatch = markdown.match(/<replacement>([\s\S]*?)<\/replacement>/i);
  if (replacementMatch && replacementMatch[1] !== undefined) {
    markdown = replacementMatch[1].trim();
    cleanedUp = true;
  }

  // Convert to Tiptap
  try {
    const tiptap = markdownToTiptap(markdown);
    const optimized = optimizeTiptapDoc(tiptap);

    return {
      tiptap: optimized,
      markdown,
      cleanedUp,
    };
  } catch (err) {
    throw new ContentParseError(
      `Failed to parse AI output to Tiptap: ${err instanceof Error ? err.message : String(err)}`,
      { output: output.slice(0, 500), error: err }
    );
  }
}

/**
 * Validate parsed output is not empty
 */
export function validateNotEmpty(result: ParseResult): void {
  if (!result.markdown || result.markdown.length === 0) {
    throw new ContentParseError("AI produced empty output");
  }

  const content = result.tiptap.content;
  if (
    !content ||
    content.length === 0 ||
    (content.length === 1 &&
      content[0] &&
      content[0].type === "paragraph" &&
      !content[0].content)
  ) {
    throw new ContentParseError("AI produced empty document");
  }
}

/**
 * Accumulate streaming tokens into final output
 */
export class OutputAccumulator {
  private chunks: string[] = [];

  /**
   * Add a token chunk
   */
  addChunk(chunk: string): void {
    this.chunks.push(chunk);
  }

  /**
   * Get accumulated text
   */
  getText(): string {
    return this.chunks.join("");
  }

  /**
   * Parse accumulated output
   */
  parse(format: ContentFormat = "markdown"): ParseResult {
    const text = this.getText();
    return parseEditOutput(text, format);
  }

  /**
   * Clear accumulated chunks
   */
  clear(): void {
    this.chunks = [];
  }

  /**
   * Get current length
   */
  get length(): number {
    return this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  }
}

/**
 * Extract text from Tiptap document for comparison
 */
export function extractText(doc: TiptapDocument): string {
  const extractFromNode = (node: any): string => {
    if (node.type === "text") {
      return node.text || "";
    }

    if (node.content && Array.isArray(node.content)) {
      return node.content.map(extractFromNode).join("");
    }

    return "";
  };

  if (!doc.content) {
    return "";
  }

  return doc.content.map(extractFromNode).join("\n").trim();
}

/**
 * Check if output is substantially different from input
 * (helps detect when AI just echoed the input)
 */
export function isSubstantiallyDifferent(
  input: string,
  output: string,
  threshold = 0.2
): boolean {
  // Normalize for comparison
  const normalizedInput = input.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedOutput = output.toLowerCase().replace(/\s+/g, " ").trim();

  if (normalizedInput === normalizedOutput) {
    return false;
  }

  // Calculate simple similarity (Jaccard index on words)
  const inputWords = new Set(normalizedInput.split(" "));
  const outputWords = new Set(normalizedOutput.split(" "));

  const intersection = new Set([...inputWords].filter((x) => outputWords.has(x)));
  const union = new Set([...inputWords, ...outputWords]);

  const similarity = intersection.size / union.size;

  // If similarity is above (1 - threshold), not substantially different
  return similarity < 1 - threshold;
}
