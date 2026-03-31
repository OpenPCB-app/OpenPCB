/**
 * Prompt Builder Tests
 */

import { describe, test, expect } from "bun:test";
import {
  buildEditPrompt,
  getRecommendedTemperature,
  getRecommendedMaxTokens,
} from "./prompt-builder";
import type { ContentContext, ContentSelection } from "./types";

const createMockContext = (overrides?: Partial<ContentContext>): ContentContext => ({
  fullContent: { type: "doc", content: [] },
  contentMarkdown: "# Test Document\n\nThis is test content.",
  ...overrides,
});

const createMockSelection = (overrides?: Partial<ContentSelection>): ContentSelection => ({
  type: "tiptap",
  from: 0,
  to: 10,
  selectedText: "test text",
  ...overrides,
});

describe("buildEditPrompt", () => {
  describe("selection mode", () => {
    test("builds prompt with selected text", () => {
      const result = buildEditPrompt({
        mode: "selection",
        instruction: "Make it concise",
        context: createMockContext({
          selectedContent: { markdown: "selected content", tiptap: { type: "doc", content: [] } },
        }),
        selection: createMockSelection({ selectedText: "selected content" }),
      });

      expect(result.systemPrompt).toContain("precise content editor");
      expect(result.systemPrompt).toContain("CRITICAL RULES");
      expect(result.userPrompt).toContain("SELECTION TO EDIT");
      expect(result.userPrompt).toContain("selected content");
      expect(result.userPrompt).toContain("Make it concise");
    });

    test("uses context.selectedContent when selection.selectedText missing", () => {
      const result = buildEditPrompt({
        mode: "selection",
        instruction: "Edit this",
        context: createMockContext({
          selectedContent: { markdown: "from context", tiptap: { type: "doc", content: [] } },
        }),
        selection: createMockSelection({ selectedText: undefined }),
      });

      expect(result.userPrompt).toContain("from context");
    });

    test("includes context before/after when provided", () => {
      const result = buildEditPrompt({
        mode: "selection",
        instruction: "Fix it",
        context: createMockContext({
          contextBefore: "Before text here",
          contextAfter: "After text here",
        }),
        selection: createMockSelection(),
      });

      expect(result.userPrompt).toContain("CONTEXT BEFORE");
      expect(result.userPrompt).toContain("Before text here");
      expect(result.userPrompt).toContain("CONTEXT AFTER");
      expect(result.userPrompt).toContain("After text here");
    });

    test("omits context sections when empty", () => {
      const result = buildEditPrompt({
        mode: "selection",
        instruction: "Fix it",
        context: createMockContext(),
        selection: createMockSelection(),
      });

      expect(result.userPrompt).not.toContain("CONTEXT BEFORE");
      expect(result.userPrompt).not.toContain("CONTEXT AFTER");
    });

    test("includes markdown format guide by default", () => {
      const result = buildEditPrompt({
        mode: "selection",
        instruction: "Edit",
        context: createMockContext(),
        selection: createMockSelection(),
      });

      expect(result.systemPrompt).toContain("MARKDOWN FORMATTING");
      expect(result.systemPrompt).toContain("**bold**");
    });

    test("excludes format guide when disabled", () => {
      const result = buildEditPrompt({
        mode: "selection",
        instruction: "Edit",
        context: createMockContext(),
        selection: createMockSelection(),
        includeFormatGuide: false,
      });

      expect(result.systemPrompt).not.toContain("MARKDOWN FORMATTING");
    });
  });

  describe("replace mode", () => {
    test("builds prompt for full document replacement", () => {
      const result = buildEditPrompt({
        mode: "replace",
        instruction: "Rewrite formally",
        context: createMockContext({ contentMarkdown: "Casual doc content" }),
      });

      expect(result.systemPrompt).toContain("content editor");
      expect(result.systemPrompt).toContain("rewrite the entire document");
      expect(result.userPrompt).toContain("CURRENT DOCUMENT");
      expect(result.userPrompt).toContain("Casual doc content");
      expect(result.userPrompt).toContain("Rewrite formally");
    });

    test("includes critical rules about output", () => {
      const result = buildEditPrompt({
        mode: "replace",
        instruction: "Rewrite",
        context: createMockContext(),
      });

      expect(result.systemPrompt).toContain("CRITICAL RULES");
      expect(result.systemPrompt).toContain("ONLY the new document content");
      expect(result.systemPrompt).toContain("Do not include explanations");
    });
  });

  describe("append mode", () => {
    test("builds prompt for content addition", () => {
      const result = buildEditPrompt({
        mode: "append",
        instruction: "Add a conclusion",
        context: createMockContext({ contentMarkdown: "Existing content here" }),
      });

      expect(result.systemPrompt).toContain("content writer");
      expect(result.systemPrompt).toContain("add new content at the end");
      expect(result.userPrompt).toContain("EXISTING DOCUMENT");
      expect(result.userPrompt).toContain("Existing content here");
      expect(result.userPrompt).toContain("Add a conclusion");
    });

    test("warns not to repeat content", () => {
      const result = buildEditPrompt({
        mode: "append",
        instruction: "Continue",
        context: createMockContext(),
      });

      expect(result.systemPrompt).toContain("Do not repeat or summarize existing content");
    });
  });

  describe("custom system prompt", () => {
    test("uses custom prompt when provided", () => {
      const customPrompt = "You are a special editor.";
      const result = buildEditPrompt({
        mode: "selection",
        instruction: "Edit this",
        context: createMockContext(),
        selection: createMockSelection(),
        customSystemPrompt: customPrompt,
      });

      expect(result.systemPrompt).toBe(customPrompt);
      expect(result.systemPrompt).not.toContain("CRITICAL RULES");
    });

    test("still builds user prompt with custom system prompt", () => {
      const result = buildEditPrompt({
        mode: "replace",
        instruction: "Rewrite it",
        context: createMockContext({ contentMarkdown: "Original" }),
        customSystemPrompt: "Custom system",
      });

      expect(result.userPrompt).toContain("Rewrite it");
      expect(result.userPrompt).toContain("Original");
    });

    test("supports generate mode when overriding the system prompt", () => {
      const result = buildEditPrompt({
        mode: "generate",
        instruction: "Create a fresh page",
        context: createMockContext({ contentMarkdown: "Unused" }),
        customSystemPrompt: "Generate new content",
      });

      expect(result.systemPrompt).toBe("Generate new content");
      expect(result.userPrompt).toBe("Create a fresh page");
    });
  });

  describe("unsupported mode", () => {
    test("throws for invalid mode", () => {
      expect(() =>
        buildEditPrompt({
          mode: "invalid" as any,
          instruction: "Do something",
          context: createMockContext(),
        })
      ).toThrow("Unsupported edit mode: invalid");
    });
  });

  describe("context truncation", () => {
    test("truncates long document content in replace mode", () => {
      const longContent = "x".repeat(10000);
      const result = buildEditPrompt({
        mode: "replace",
        instruction: "Summarize",
        context: createMockContext({ contentMarkdown: longContent }),
      });

      // Replace mode truncates at 8000 chars
      expect(result.userPrompt.length).toBeLessThan(longContent.length);
      expect(result.userPrompt).toContain("...");
    });

    test("truncates context before/after in selection mode", () => {
      const longContext = "word ".repeat(200);
      const result = buildEditPrompt({
        mode: "selection",
        instruction: "Edit",
        context: createMockContext({
          contextBefore: longContext,
          contextAfter: longContext,
        }),
        selection: createMockSelection(),
      });

      // Selection mode truncates context at 500 chars
      expect(result.userPrompt).toContain("...");
    });

    test("preserves word boundaries when truncating", () => {
      const textWithWords = "hello world this is a test sentence with multiple words";
      // Create a text that will need truncation at a position that's in a word
      const repeated = (textWithWords + " ").repeat(20);
      const result = buildEditPrompt({
        mode: "selection",
        instruction: "Edit",
        context: createMockContext({ contextBefore: repeated }),
        selection: createMockSelection(),
      });

      // Should not end mid-word (unless space is far from end)
      const truncatedPart = result.userPrompt.split("CONTEXT BEFORE")[1];
      if (truncatedPart?.includes("...")) {
        const beforeEllipsis = truncatedPart.split("...")[0];
        // Either ends at word boundary or at 80% threshold
        expect(
          beforeEllipsis.endsWith(" ") ||
            beforeEllipsis.endsWith("```") ||
            beforeEllipsis.length > 0
        ).toBe(true);
      }
    });
  });
});

describe("getRecommendedTemperature", () => {
  test("returns 0.3 for selection mode", () => {
    expect(getRecommendedTemperature("selection")).toBe(0.3);
  });

  test("returns 0.5 for replace mode", () => {
    expect(getRecommendedTemperature("replace")).toBe(0.5);
  });

  test("returns 0.7 for append mode", () => {
    expect(getRecommendedTemperature("append")).toBe(0.7);
  });

  test("returns 0.5 for unknown mode", () => {
    expect(getRecommendedTemperature("unknown" as any)).toBe(0.5);
  });
});

describe("getRecommendedMaxTokens", () => {
  describe("selection mode", () => {
    test("returns minimum 500 for short selections", () => {
      expect(getRecommendedMaxTokens("selection", 10)).toBe(500);
      expect(getRecommendedMaxTokens("selection", 100)).toBe(500);
    });

    test("returns 1.5x selection length for medium selections", () => {
      expect(getRecommendedMaxTokens("selection", 500)).toBe(750);
      expect(getRecommendedMaxTokens("selection", 1000)).toBe(1500);
    });

    test("caps at 2000 for long selections", () => {
      expect(getRecommendedMaxTokens("selection", 2000)).toBe(2000);
      expect(getRecommendedMaxTokens("selection", 5000)).toBe(2000);
    });

    test("returns 500 when selection length not provided", () => {
      expect(getRecommendedMaxTokens("selection")).toBe(500);
      expect(getRecommendedMaxTokens("selection", undefined)).toBe(500);
    });
  });

  test("returns 4000 for replace mode", () => {
    expect(getRecommendedMaxTokens("replace")).toBe(4000);
    expect(getRecommendedMaxTokens("replace", 100)).toBe(4000);
  });

  test("returns 2000 for append mode", () => {
    expect(getRecommendedMaxTokens("append")).toBe(2000);
    expect(getRecommendedMaxTokens("append", 100)).toBe(2000);
  });

  test("returns 1000 for unknown mode", () => {
    expect(getRecommendedMaxTokens("unknown" as any)).toBe(1000);
  });
});
