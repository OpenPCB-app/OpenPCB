/**
 * Output Parser Tests
 */

import { describe, test, expect } from "bun:test";
import {
  parseEditOutput,
  validateNotEmpty,
  OutputAccumulator,
  extractText,
  isSubstantiallyDifferent,
} from "./output-parser";
import { ContentParseError } from "./errors";

describe("parseEditOutput", () => {
  test("parses plain markdown", () => {
    const result = parseEditOutput("# Hello World\n\nThis is a paragraph.");

    expect(result.markdown).toBe("# Hello World\n\nThis is a paragraph.");
    expect(result.cleanedUp).toBe(false);
    expect(result.tiptap.type).toBe("doc");
    expect(result.tiptap.content).toHaveLength(2);
  });

  test("removes code block wrappers", () => {
    const input = "```markdown\n# Hello\nWorld\n```";
    const result = parseEditOutput(input);

    expect(result.markdown).toBe("# Hello\nWorld");
    expect(result.cleanedUp).toBe(true);
  });

  test("removes code block wrappers without language", () => {
    const input = "```\n# Hello\n```";
    const result = parseEditOutput(input);

    expect(result.markdown).toBe("# Hello");
    expect(result.cleanedUp).toBe(true);
  });

  test("removes double quote wrappers", () => {
    const input = '"Hello World"';
    const result = parseEditOutput(input);

    expect(result.markdown).toBe("Hello World");
    expect(result.cleanedUp).toBe(true);
  });

  test("removes single quote wrappers", () => {
    const input = "'Hello World'";
    const result = parseEditOutput(input);

    expect(result.markdown).toBe("Hello World");
    expect(result.cleanedUp).toBe(true);
  });

  test("trims whitespace", () => {
    const input = "  \n  Hello World  \n  ";
    const result = parseEditOutput(input);

    expect(result.markdown).toBe("Hello World");
    expect(result.cleanedUp).toBe(true);
  });

  test("handles empty string", () => {
    const result = parseEditOutput("");

    expect(result.markdown).toBe("");
    expect(result.tiptap.type).toBe("doc");
  });

  test("handles complex markdown", () => {
    const input = `# Title

- Item 1
- Item 2

**Bold** and *italic* text.`;

    const result = parseEditOutput(input);

    expect(result.cleanedUp).toBe(false);
    expect(result.tiptap.content!.length).toBeGreaterThan(0);
  });

  test("combines multiple cleanups", () => {
    const input = '```markdown\n  "Hello World"  \n```';
    const result = parseEditOutput(input);

    // Note: code block is removed first, then quotes and whitespace
    expect(result.cleanedUp).toBe(true);
  });

  test("extracts replacement tags", () => {
    const input = "<replacement>\n**Updated** text\n</replacement>";
    const result = parseEditOutput(input);

    expect(result.markdown).toBe("**Updated** text");
    expect(result.cleanedUp).toBe(true);
  });

  test("handles replacement markers split across streaming chunks", () => {
    const accumulator = new OutputAccumulator();

    accumulator.addChunk("<replacement>\n");
    accumulator.addChunk("Streamed content ");
    accumulator.addChunk("arrives in pieces");
    accumulator.addChunk("\n</repl");
    accumulator.addChunk("acement>");

    const result = accumulator.parse();

    expect(result.markdown).toBe("Streamed content arrives in pieces");
    expect(result.cleanedUp).toBe(true);
  });
});

describe("validateNotEmpty", () => {
  test("passes for valid content", () => {
    const result = parseEditOutput("Hello World");
    expect(() => validateNotEmpty(result)).not.toThrow();
  });

  test("throws for empty markdown", () => {
    const result = {
      tiptap: { type: "doc" as const, content: [] },
      markdown: "",
      cleanedUp: false,
    };

    expect(() => validateNotEmpty(result)).toThrow(ContentParseError);
  });

  test("throws for empty document", () => {
    const result = {
      tiptap: { type: "doc" as const, content: [] },
      markdown: "some text",
      cleanedUp: false,
    };

    expect(() => validateNotEmpty(result)).toThrow(ContentParseError);
  });

  test("throws for single empty paragraph", () => {
    const result = {
      tiptap: {
        type: "doc" as const,
        content: [{ type: "paragraph" }],
      },
      markdown: "some text",
      cleanedUp: false,
    };

    expect(() => validateNotEmpty(result)).toThrow(ContentParseError);
  });

  test("passes for paragraph with content", () => {
    const result = {
      tiptap: {
        type: "doc" as const,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello" }],
          },
        ],
      },
      markdown: "Hello",
      cleanedUp: false,
    };

    expect(() => validateNotEmpty(result)).not.toThrow();
  });
});

describe("OutputAccumulator", () => {
  test("accumulates chunks", () => {
    const acc = new OutputAccumulator();

    acc.addChunk("Hello");
    acc.addChunk(" ");
    acc.addChunk("World");

    expect(acc.getText()).toBe("Hello World");
  });

  test("tracks length", () => {
    const acc = new OutputAccumulator();

    expect(acc.length).toBe(0);

    acc.addChunk("Hello");
    expect(acc.length).toBe(5);

    acc.addChunk(" World");
    expect(acc.length).toBe(11);
  });

  test("parses accumulated content", () => {
    const acc = new OutputAccumulator();

    acc.addChunk("# ");
    acc.addChunk("Title");
    acc.addChunk("\n\n");
    acc.addChunk("Paragraph");

    const result = acc.parse();

    expect(result.markdown).toBe("# Title\n\nParagraph");
    expect(result.tiptap.type).toBe("doc");
  });

  test("clears accumulated content", () => {
    const acc = new OutputAccumulator();

    acc.addChunk("Hello World");
    expect(acc.length).toBe(11);

    acc.clear();

    expect(acc.length).toBe(0);
    expect(acc.getText()).toBe("");
  });

  test("handles empty accumulator", () => {
    const acc = new OutputAccumulator();

    expect(acc.getText()).toBe("");
    expect(acc.length).toBe(0);
  });
});

describe("extractText", () => {
  test("extracts text from simple paragraph", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello World" }],
        },
      ],
    };

    expect(extractText(doc)).toBe("Hello World");
  });

  test("extracts text from multiple paragraphs", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "First" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second" }],
        },
      ],
    };

    expect(extractText(doc)).toBe("First\nSecond");
  });

  test("handles empty document", () => {
    const doc = { type: "doc" as const, content: [] };
    expect(extractText(doc)).toBe("");
  });

  test("handles document without content", () => {
    const doc = { type: "doc" as const, content: [] };
    expect(extractText(doc)).toBe("");
  });

  test("handles nested content", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const text = extractText(doc);
    expect(text).toContain("Title");
    expect(text).toContain("Item");
  });
});

describe("parseEditOutput — HTML format", () => {
  test("parses HTML to tiptap", () => {
    const result = parseEditOutput("<h1>Title</h1><p>Text</p>", "html");

    expect(result.tiptap.type).toBe("doc");
    expect(result.tiptap.content).toHaveLength(2);
    expect(result.tiptap.content[0]!.type).toBe("heading");
    expect(result.tiptap.content[1]!.type).toBe("paragraph");
    expect(result.cleanedUp).toBe(false);
  });

  test("strips HTML code block wrappers", () => {
    const input = '```html\n<p>Hello</p>\n```';
    const result = parseEditOutput(input, "html");

    expect(result.tiptap.content).toHaveLength(1);
    expect(result.tiptap.content[0]!.type).toBe("paragraph");
    expect(result.cleanedUp).toBe(true);
  });

  test("preserves rich formatting marks", () => {
    const input = '<p><span style="color: #dc2626">Red text</span></p>';
    const result = parseEditOutput(input, "html");

    const para = result.tiptap.content[0]!;
    const textNode = para.content![0]!;
    expect(textNode.marks).toBeDefined();
    expect(textNode.marks!.some((m) => m.type === "textStyle")).toBe(true);
  });

  test("falls back to markdown format by default", () => {
    const result = parseEditOutput("# Title");
    expect(result.tiptap.content[0]!.type).toBe("heading");
  });
});

describe("OutputAccumulator — HTML format", () => {
  test("parses accumulated HTML content", () => {
    const acc = new OutputAccumulator();

    acc.addChunk("<h1>");
    acc.addChunk("Title");
    acc.addChunk("</h1>");
    acc.addChunk("<p>Body</p>");

    const result = acc.parse("html");
    expect(result.tiptap.content).toHaveLength(2);
    expect(result.tiptap.content[0]!.type).toBe("heading");
  });

  test("defaults to markdown when no format given", () => {
    const acc = new OutputAccumulator();
    acc.addChunk("# Title");

    const result = acc.parse();
    expect(result.tiptap.content[0]!.type).toBe("heading");
  });
});

describe("isSubstantiallyDifferent", () => {
  test("returns false for identical strings", () => {
    expect(isSubstantiallyDifferent("Hello World", "Hello World")).toBe(false);
  });

  test("returns false for case-different strings", () => {
    expect(isSubstantiallyDifferent("Hello World", "hello world")).toBe(false);
  });

  test("returns false for whitespace-different strings", () => {
    expect(isSubstantiallyDifferent("Hello  World", "Hello World")).toBe(false);
  });

  test("returns true for completely different strings", () => {
    expect(isSubstantiallyDifferent("Hello World", "Goodbye Moon")).toBe(true);
  });

  test("returns false for similar strings (high overlap)", () => {
    // Jaccard similarity: intersection/union >= 0.8 for threshold 0.2
    // 9 words, 1 different → intersection=8, union=10 → 0.8 = threshold
    expect(
      isSubstantiallyDifferent(
        "the quick brown fox jumps over the lazy sleeping dog",
        "the quick brown cat jumps over the lazy sleeping dog"
      )
    ).toBe(false);
  });

  test("returns true for sufficiently different strings", () => {
    // Most words are different
    expect(
      isSubstantiallyDifferent(
        "the quick brown fox",
        "a slow red elephant"
      )
    ).toBe(true);
  });

  test("respects custom threshold", () => {
    // Same comparison but with stricter threshold
    const input = "word1 word2 word3 word4";
    const output = "word1 word2 different1 different2";

    // Default threshold (0.2) - 50% overlap might pass
    // With threshold 0.6, needs more difference
    expect(isSubstantiallyDifferent(input, output, 0.6)).toBe(true);
  });

  test("handles empty strings", () => {
    expect(isSubstantiallyDifferent("", "")).toBe(false);
    expect(isSubstantiallyDifferent("hello", "")).toBe(true);
    expect(isSubstantiallyDifferent("", "hello")).toBe(true);
  });
});
