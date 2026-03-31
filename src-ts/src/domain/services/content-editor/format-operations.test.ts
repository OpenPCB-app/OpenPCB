/**
 * Tests for Format Operations Engine
 */

import { describe, it, expect } from "bun:test";
import {
  applyFormatOperations,
  type FormatOperation,
  type FormatTarget,
  type BlockStyles,
  type TextStyles,
  type ConvertTo,
} from "./format-operations";
import type { TiptapDocument } from "../../utils/markdown-to-tiptap";

describe("applyFormatOperations", () => {
  describe("Block Targeting", () => {
    it("should target all blocks with blockType='all'", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Para 1" }] },
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Heading" }] },
          { type: "paragraph", content: [{ type: "text", text: "Para 2" }] },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, blockStyles: { textAlign: "center" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.textAlign).toBe("center");
      expect(result.content[1]?.attrs?.textAlign).toBe("center");
      expect(result.content[2]?.attrs?.textAlign).toBe("center");
    });

    it("should target only headings with blockType='heading'", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Para" }] },
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H1" }] },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H2" }] },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "heading" }, blockStyles: { textAlign: "right" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.textAlign).toBeUndefined();
      expect(result.content[1]?.attrs?.textAlign).toBe("right");
      expect(result.content[2]?.attrs?.textAlign).toBe("right");
    });

    it("should target only paragraphs with blockType='paragraph'", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Para 1" }] },
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Heading" }] },
          { type: "paragraph", content: [{ type: "text", text: "Para 2" }] },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "paragraph" }, blockStyles: { lineHeight: "1.5" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.lineHeight).toBe("1.5");
      expect(result.content[1]?.attrs?.lineHeight).toBeUndefined();
      expect(result.content[2]?.attrs?.lineHeight).toBe("1.5");
    });

    it("should filter headings by level", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H1" }] },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H2" }] },
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Another H1" }] },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "heading", level: 1 }, blockStyles: { textAlign: "center" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.textAlign).toBe("center");
      expect(result.content[1]?.attrs?.textAlign).toBeUndefined();
      expect(result.content[2]?.attrs?.textAlign).toBe("center");
    });

    it("should target specific block by blockIndex", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Para 0" }] },
          { type: "paragraph", content: [{ type: "text", text: "Para 1" }] },
          { type: "paragraph", content: [{ type: "text", text: "Para 2" }] },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockIndex: 1 }, blockStyles: { textAlign: "center" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.textAlign).toBeUndefined();
      expect(result.content[1]?.attrs?.textAlign).toBe("center");
      expect(result.content[2]?.attrs?.textAlign).toBeUndefined();
    });

    it("should target block range with blockRange", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Para 0" }] },
          { type: "paragraph", content: [{ type: "text", text: "Para 1" }] },
          { type: "paragraph", content: [{ type: "text", text: "Para 2" }] },
          { type: "paragraph", content: [{ type: "text", text: "Para 3" }] },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockRange: [1, 2] }, blockStyles: { textAlign: "justify" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.textAlign).toBeUndefined();
      expect(result.content[1]?.attrs?.textAlign).toBe("justify");
      expect(result.content[2]?.attrs?.textAlign).toBe("justify");
      expect(result.content[3]?.attrs?.textAlign).toBeUndefined();
    });

    it("should target blocks containing text with textContains", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
          { type: "paragraph", content: [{ type: "text", text: "Goodbye world" }] },
          { type: "paragraph", content: [{ type: "text", text: "Something else" }] },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { textContains: "world" }, blockStyles: { textAlign: "right" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.textAlign).toBe("right");
      expect(result.content[1]?.attrs?.textAlign).toBe("right");
      expect(result.content[2]?.attrs?.textAlign).toBeUndefined();
    });
  });

  describe("Block Styles", () => {
    it("should apply textAlign to matched blocks", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, blockStyles: { textAlign: "center" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.textAlign).toBe("center");
    });

    it("should apply lineHeight to matched blocks", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, blockStyles: { lineHeight: "2.0" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.lineHeight).toBe("2.0");
    });

    it("should apply both textAlign and lineHeight", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
      };

      const operations: FormatOperation[] = [
        {
          target: { blockType: "all" },
          blockStyles: { textAlign: "justify", lineHeight: "1.8" },
        },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.textAlign).toBe("justify");
      expect(result.content[0]?.attrs?.lineHeight).toBe("1.8");
    });
  });

  describe("Text Styles - Add Marks", () => {
    it("should add bold mark", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Bold me" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { bold: true } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toContainEqual({ type: "bold" });
    });

    it("should add italic mark", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Italic me" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { italic: true } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toContainEqual({ type: "italic" });
    });

    it("should add underline mark", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Underline me" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { underline: true } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toContainEqual({ type: "underline" });
    });

    it("should add strikethrough mark", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Strike me" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { strikethrough: true } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toContainEqual({ type: "strike" });
    });

    it("should add color via textStyle mark", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Color me" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { color: "#ff0000" } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toContainEqual({
        type: "textStyle",
        attrs: { color: "#ff0000" },
      });
    });

    it("should add fontFamily via textStyle mark", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Font me" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { fontFamily: "monospace" } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toContainEqual({
        type: "textStyle",
        attrs: { fontFamily: "monospace" },
      });
    });

    it("should add fontSize via textStyle mark", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Size me" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { fontSize: "20px" } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toContainEqual({
        type: "textStyle",
        attrs: { fontSize: "20px" },
      });
    });

    it("should combine multiple textStyle attrs", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Style me" }] }],
      };

      const operations: FormatOperation[] = [
        {
          target: { blockType: "all" },
          textStyles: { color: "#ff0000", fontFamily: "serif", fontSize: "18px" },
        },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toContainEqual({
        type: "textStyle",
        attrs: { color: "#ff0000", fontFamily: "serif", fontSize: "18px" },
      });
    });

    it("should add backgroundColor via highlight mark", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Highlight me" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { backgroundColor: "#ffff00" } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toContainEqual({
        type: "highlight",
        attrs: { color: "#ffff00" },
      });
    });
  });

  describe("Text Styles - Remove Marks", () => {
    it("should remove bold mark with null", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Bold", marks: [{ type: "bold" }] }],
          },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { bold: null } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toBeUndefined();
    });

    it("should remove italic mark with null", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Italic", marks: [{ type: "italic" }] }],
          },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { italic: null } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toBeUndefined();
    });

    it("should remove color from textStyle mark with null", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Colored",
                marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }],
              },
            ],
          },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { color: null } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      // textStyle mark should be removed entirely since no attrs remain
      expect(textNode?.marks).toBeUndefined();
    });

    it("should remove fontFamily from textStyle but preserve other attrs", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Styled",
                marks: [
                  { type: "textStyle", attrs: { color: "#ff0000", fontFamily: "serif" } },
                ],
              },
            ],
          },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { fontFamily: null } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toContainEqual({
        type: "textStyle",
        attrs: { color: "#ff0000" },
      });
    });

    it("should remove backgroundColor by removing highlight mark", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Highlighted",
                marks: [{ type: "highlight", attrs: { color: "#ffff00" } }],
              },
            ],
          },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { backgroundColor: null } },
      ];

      const result = applyFormatOperations(doc, operations);

      const textNode = result.content[0]?.content?.[0];
      expect(textNode?.marks).toBeUndefined();
    });
  });

  describe("textMatch - Partial Text Styling", () => {
    it("should style only matching substring", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
      };

      const operations: FormatOperation[] = [
        {
          target: { blockType: "all" },
          textStyles: { bold: true },
          textMatch: "world",
        },
      ];

      const result = applyFormatOperations(doc, operations);

      const content = result.content[0]?.content;
      expect(content).toHaveLength(2);
      expect(content?.[0]).toEqual({ type: "text", text: "Hello ", marks: undefined });
      expect(content?.[1]).toEqual({
        type: "text",
        text: "world",
        marks: [{ type: "bold" }],
      });
    });

    it("should split text node into before/match/after", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "abc def ghi" }] }],
      };

      const operations: FormatOperation[] = [
        {
          target: { blockType: "all" },
          textStyles: { color: "#ff0000" },
          textMatch: "def",
        },
      ];

      const result = applyFormatOperations(doc, operations);

      const content = result.content[0]?.content;
      expect(content).toHaveLength(3);
      expect(content?.[0]).toEqual({ type: "text", text: "abc ", marks: undefined });
      expect(content?.[1]?.text).toBe("def");
      expect(content?.[1]?.marks).toContainEqual({
        type: "textStyle",
        attrs: { color: "#ff0000" },
      });
      expect(content?.[2]).toEqual({ type: "text", text: " ghi", marks: undefined });
    });

    it("should preserve existing marks on unstyled portions", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Bold text", marks: [{ type: "bold" }] },
            ],
          },
        ],
      };

      const operations: FormatOperation[] = [
        {
          target: { blockType: "all" },
          textStyles: { color: "#0000ff" },
          textMatch: "text",
        },
      ];

      const result = applyFormatOperations(doc, operations);

      const content = result.content[0]?.content;
      expect(content).toHaveLength(2);
      expect(content?.[0]).toEqual({
        type: "text",
        text: "Bold ",
        marks: [{ type: "bold" }],
      });
      expect(content?.[1]?.marks).toContainEqual({ type: "bold" });
      expect(content?.[1]?.marks).toContainEqual({
        type: "textStyle",
        attrs: { color: "#0000ff" },
      });
    });

    it("should not style text that doesn't contain textMatch", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "No match here" }],
          },
        ],
      };

      const operations: FormatOperation[] = [
        {
          target: { blockType: "all" },
          textStyles: { bold: true },
          textMatch: "xyz",
        },
      ];

      const result = applyFormatOperations(doc, operations);

      const content = result.content[0]?.content;
      expect(content).toHaveLength(1);
      expect(content?.[0]).toEqual({ type: "text", text: "No match here" });
    });
  });

  describe("convertTo - Block Type Conversion", () => {
    it("should convert paragraph to heading", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Make me heading" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "paragraph" }, convertTo: { type: "heading", level: 2 } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.type).toBe("heading");
      expect(result.content[0]?.attrs?.level).toBe(2);
      expect(result.content[0]?.content?.[0]).toEqual({ type: "text", text: "Make me heading" });
    });

    it("should use default level 2 for heading conversion", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Heading" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "paragraph" }, convertTo: { type: "heading" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.level).toBe(2);
    });

    it("should convert heading to paragraph", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Heading" }] },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "heading" }, convertTo: { type: "paragraph" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.type).toBe("paragraph");
      expect(result.content[0]?.content?.[0]).toEqual({ type: "text", text: "Heading" });
    });

    it("should convert paragraph to blockquote", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Quote this" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockIndex: 0 }, convertTo: { type: "blockquote" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.type).toBe("blockquote");
      expect(result.content[0]?.content?.[0]?.type).toBe("paragraph");
      expect(result.content[0]?.content?.[0]?.content?.[0]).toEqual({
        type: "text",
        text: "Quote this",
      });
    });

    it("should convert paragraph to callout with default info type", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Callout text" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockIndex: 0 }, convertTo: { type: "callout" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.type).toBe("callout");
      expect(result.content[0]?.attrs?.type).toBe("info");
      expect(result.content[0]?.content?.[0]?.type).toBe("paragraph");
    });

    it("should convert paragraph to callout with specific type", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Warning text" }] }],
      };

      const operations: FormatOperation[] = [
        {
          target: { blockIndex: 0 },
          convertTo: { type: "callout", calloutType: "warning" },
        },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.type).toBe("warning");
    });

    it("should convert paragraph to bulletList", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "List item" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockIndex: 0 }, convertTo: { type: "bulletList" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.type).toBe("bulletList");
      expect(result.content[0]?.content?.[0]?.type).toBe("listItem");
      expect(result.content[0]?.content?.[0]?.content?.[0]?.type).toBe("paragraph");
      expect(result.content[0]?.content?.[0]?.content?.[0]?.content?.[0]).toEqual({
        type: "text",
        text: "List item",
      });
    });

    it("should convert paragraph to orderedList", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Ordered item" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockIndex: 0 }, convertTo: { type: "orderedList" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.type).toBe("orderedList");
      expect(result.content[0]?.content?.[0]?.type).toBe("listItem");
    });

    it("should convert paragraph to codeBlock", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "const x = 1;" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "paragraph" }, convertTo: { type: "codeBlock" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.type).toBe("codeBlock");
      expect(result.content[0]?.attrs?.language).toBeNull();
      expect(result.content[0]?.content?.[0]).toEqual({
        type: "text",
        text: "const x = 1;",
      });
    });
  });

  describe("Multiple Operations", () => {
    it("should apply multiple operations in sequence", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Para 1" }] },
          { type: "paragraph", content: [{ type: "text", text: "Para 2" }] },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockIndex: 0 }, blockStyles: { textAlign: "left" } },
        { target: { blockIndex: 1 }, blockStyles: { textAlign: "right" } },
        { target: { blockType: "all" }, textStyles: { bold: true } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.textAlign).toBe("left");
      expect(result.content[1]?.attrs?.textAlign).toBe("right");
      expect(result.content[0]?.content?.[0]?.marks).toContainEqual({ type: "bold" });
      expect(result.content[1]?.content?.[0]?.marks).toContainEqual({ type: "bold" });
    });

    it("should combine blockStyles, textStyles, and convertTo", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Transform me" }] }],
      };

      const operations: FormatOperation[] = [
        {
          target: { blockType: "all" },
          blockStyles: { textAlign: "center" },
          textStyles: { color: "#ff0000", bold: true },
          convertTo: { type: "heading", level: 3 },
        },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.type).toBe("heading");
      expect(result.content[0]?.attrs?.level).toBe(3);
      expect(result.content[0]?.attrs?.textAlign).toBe("center");
      expect(result.content[0]?.content?.[0]?.marks).toContainEqual({ type: "bold" });
      expect(result.content[0]?.content?.[0]?.marks).toContainEqual({
        type: "textStyle",
        attrs: { color: "#ff0000" },
      });
    });
  });

  describe("Immutability", () => {
    it("should not mutate original document", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }],
      };

      const originalJson = JSON.stringify(doc);

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, blockStyles: { textAlign: "center" } },
      ];

      applyFormatOperations(doc, operations);

      expect(JSON.stringify(doc)).toBe(originalJson);
    });

    it("should return new document with changes", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { bold: true } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result).not.toBe(doc);
      expect(result.content).not.toBe(doc.content);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty document", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, blockStyles: { textAlign: "center" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content).toEqual([]);
    });

    it("should handle document without content field", () => {
      const doc = {
        type: "doc" as const,
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, blockStyles: { textAlign: "center" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.type).toBe("doc");
    });

    it("should handle empty operations array", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
      };

      const result = applyFormatOperations(doc, []);

      expect(result).toEqual(doc);
    });

    it("should handle no matching targets", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Test" }] }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "heading" }, blockStyles: { textAlign: "center" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.textAlign).toBeUndefined();
    });

    it("should handle blocks without content", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [{ type: "paragraph" }],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "all" }, textStyles: { bold: true } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.type).toBe("paragraph");
    });

    it("should handle nested blocks in lists", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Item 1" }] }],
              },
            ],
          },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockType: "paragraph" }, textStyles: { bold: true } },
      ];

      const result = applyFormatOperations(doc, operations);

      const listItem = result.content[0]?.content?.[0];
      const para = listItem?.content?.[0];
      expect(para?.content?.[0]?.marks).toContainEqual({ type: "bold" });
    });

    it("should handle blockRange at document boundaries", () => {
      const doc: TiptapDocument = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Para 1" }] },
          { type: "paragraph", content: [{ type: "text", text: "Para 2" }] },
        ],
      };

      const operations: FormatOperation[] = [
        { target: { blockRange: [0, 10] }, blockStyles: { textAlign: "center" } },
      ];

      const result = applyFormatOperations(doc, operations);

      expect(result.content[0]?.attrs?.textAlign).toBe("center");
      expect(result.content[1]?.attrs?.textAlign).toBe("center");
    });
  });
});
