import { describe, test, expect } from "bun:test";
import { markdownToTiptap, optimizeTiptapDoc } from "./markdown-to-tiptap";

describe("markdownToTiptap", () => {
  describe("edge cases", () => {
    test("handles empty string", () => {
      const result = markdownToTiptap("");
      expect(result.type).toBe("doc");
      expect(result.content).toEqual([]);
    });

    test("handles null/undefined", () => {
      expect(markdownToTiptap(null as unknown as string).content).toEqual([]);
      expect(markdownToTiptap(undefined as unknown as string).content).toEqual([]);
    });

    test("handles whitespace only", () => {
      const result = markdownToTiptap("   \n\n   ");
      expect(result.type).toBe("doc");
    });
  });

  describe("headings", () => {
    test("converts h1", () => {
      const result = markdownToTiptap("# Hello World");
      expect(result.content[0]).toEqual({
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Hello World" }],
      });
    });

    test("converts h2-h6", () => {
      for (let level = 2; level <= 6; level++) {
        const md = "#".repeat(level) + " Heading " + level;
        const result = markdownToTiptap(md);
        expect(result.content[0].attrs?.level).toBe(level);
      }
    });

    test("heading with marks", () => {
      const result = markdownToTiptap("# Hello **bold** world");
      expect(result.content[0].content).toHaveLength(3);
      expect(result.content[0].content?.[1].marks).toContainEqual({ type: "bold" });
    });
  });

  describe("paragraphs", () => {
    test("converts simple paragraph", () => {
      const result = markdownToTiptap("Hello world");
      expect(result.content[0]).toEqual({
        type: "paragraph",
        content: [{ type: "text", text: "Hello world" }],
      });
    });

    test("converts multiple paragraphs", () => {
      const result = markdownToTiptap("First para\n\nSecond para");
      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe("paragraph");
      expect(result.content[1].type).toBe("paragraph");
    });
  });

  describe("inline marks", () => {
    test("converts bold", () => {
      const result = markdownToTiptap("**bold text**");
      const textNode = result.content[0].content?.[0];
      expect(textNode?.text).toBe("bold text");
      expect(textNode?.marks).toContainEqual({ type: "bold" });
    });

    test("converts italic", () => {
      const result = markdownToTiptap("*italic text*");
      const textNode = result.content[0].content?.[0];
      expect(textNode?.text).toBe("italic text");
      expect(textNode?.marks).toContainEqual({ type: "italic" });
    });

    test("converts strikethrough", () => {
      const result = markdownToTiptap("~~deleted~~");
      const textNode = result.content[0].content?.[0];
      expect(textNode?.text).toBe("deleted");
      expect(textNode?.marks).toContainEqual({ type: "strike" });
    });

    test("converts inline code", () => {
      const result = markdownToTiptap("`code`");
      const textNode = result.content[0].content?.[0];
      expect(textNode?.text).toBe("code");
      expect(textNode?.marks).toContainEqual({ type: "code" });
    });

    test("nested marks (bold + italic)", () => {
      const result = markdownToTiptap("***bold italic***");
      const textNode = result.content[0].content?.[0];
      expect(textNode?.marks).toContainEqual({ type: "bold" });
      expect(textNode?.marks).toContainEqual({ type: "italic" });
    });
  });

  describe("links", () => {
    test("converts basic link", () => {
      const result = markdownToTiptap("[Click here](https://example.com)");
      const textNode = result.content[0].content?.[0];
      expect(textNode?.text).toBe("Click here");
      expect(textNode?.marks).toContainEqual({
        type: "link",
        attrs: { href: "https://example.com", title: null },
      });
    });

    test("converts link with title", () => {
      const result = markdownToTiptap('[Link](https://example.com "Title")');
      const linkMark = result.content[0].content?.[0]?.marks?.find(
        (m) => m.type === "link"
      );
      expect(linkMark?.attrs?.title).toBe("Title");
    });

    test("link with bold text", () => {
      const result = markdownToTiptap("[**Bold link**](https://example.com)");
      const textNode = result.content[0].content?.[0];
      expect(textNode?.marks?.map((m) => m.type)).toContain("bold");
      expect(textNode?.marks?.map((m) => m.type)).toContain("link");
    });
  });

  describe("images", () => {
    test("converts basic image", () => {
      const result = markdownToTiptap("![Alt text](https://example.com/img.png)");
      expect(result.content[0]).toEqual({
        type: "paragraph",
        content: [{
          type: "image",
          attrs: {
            src: "https://example.com/img.png",
            alt: "Alt text",
            title: null,
          },
        }],
      });
    });

    test("converts image with title", () => {
      const result = markdownToTiptap('![Alt](https://example.com/img.png "Image Title")');
      expect(result.content[0].content?.[0].attrs?.title).toBe("Image Title");
    });
  });

  describe("code blocks", () => {
    test("converts fenced code block", () => {
      const result = markdownToTiptap("```\ncode here\n```");
      expect(result.content[0]).toEqual({
        type: "codeBlock",
        attrs: { language: null },
        content: [{ type: "text", text: "code here" }],
      });
    });

    test("converts code block with language", () => {
      const result = markdownToTiptap("```typescript\nconst x = 1;\n```");
      expect(result.content[0].attrs?.language).toBe("typescript");
      expect(result.content[0].content?.[0].text).toBe("const x = 1;");
    });

    test("preserves code block content", () => {
      const code = "function test() {\n  return 42;\n}";
      const result = markdownToTiptap("```js\n" + code + "\n```");
      expect(result.content[0].content?.[0].text).toBe(code);
    });
  });

  describe("blockquotes", () => {
    test("converts simple blockquote", () => {
      const result = markdownToTiptap("> Quote text");
      expect(result.content[0].type).toBe("blockquote");
      expect(result.content[0].content?.[0].type).toBe("paragraph");
      expect(result.content[0].content?.[0].content?.[0].text).toBe("Quote text");
    });

    test("converts nested blockquote", () => {
      const result = markdownToTiptap("> Outer\n>> Inner");
      expect(result.content[0].type).toBe("blockquote");
      const inner = result.content[0].content?.find((n) => n.type === "blockquote");
      expect(inner).toBeDefined();
    });
  });

  describe("bullet lists", () => {
    test("converts simple bullet list", () => {
      const result = markdownToTiptap("- Item 1\n- Item 2\n- Item 3");
      expect(result.content[0].type).toBe("bulletList");
      expect(result.content[0].content).toHaveLength(3);
      expect(result.content[0].content?.[0].type).toBe("listItem");
    });

    test("list item content in paragraph", () => {
      const result = markdownToTiptap("- First item");
      const listItem = result.content[0].content?.[0];
      expect(listItem?.content?.[0].type).toBe("paragraph");
      expect(listItem?.content?.[0].content?.[0].text).toBe("First item");
    });

    test("nested bullet lists", () => {
      const result = markdownToTiptap("- Outer\n  - Inner");
      const outerItem = result.content[0].content?.[0];
      const nestedList = outerItem?.content?.find((n) => n.type === "bulletList");
      expect(nestedList).toBeDefined();
    });
  });

  describe("ordered lists", () => {
    test("converts simple ordered list", () => {
      const result = markdownToTiptap("1. First\n2. Second\n3. Third");
      expect(result.content[0].type).toBe("orderedList");
      expect(result.content[0].content).toHaveLength(3);
    });

    test("preserves start number", () => {
      const result = markdownToTiptap("5. Start at five\n6. Six");
      expect(result.content[0].attrs?.start).toBe(5);
    });
  });

  describe("task lists", () => {
    test("converts unchecked task", () => {
      const result = markdownToTiptap("- [ ] Todo item");
      expect(result.content[0].type).toBe("taskList");
      expect(result.content[0].content?.[0].type).toBe("taskItem");
      expect(result.content[0].content?.[0].attrs?.checked).toBe(false);
    });

    test("converts checked task", () => {
      const result = markdownToTiptap("- [x] Done item");
      expect(result.content[0].content?.[0].attrs?.checked).toBe(true);
    });

    test("mixed task list", () => {
      const result = markdownToTiptap("- [x] Done\n- [ ] Todo");
      expect(result.content[0].type).toBe("taskList");
      expect(result.content[0].content?.[0].attrs?.checked).toBe(true);
      expect(result.content[0].content?.[1].attrs?.checked).toBe(false);
    });
  });

  describe("horizontal rules", () => {
    test("converts thematic break", () => {
      const result = markdownToTiptap("Above\n\n---\n\nBelow");
      const hr = result.content.find((n) => n.type === "horizontalRule");
      expect(hr).toEqual({ type: "horizontalRule" });
    });
  });

  describe("tables", () => {
    test("converts basic table", () => {
      const md = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |`;
      const result = markdownToTiptap(md);
      expect(result.content[0].type).toBe("table");
      expect(result.content[0].content).toHaveLength(2); // header row + data row
    });

    test("table header cells", () => {
      const md = `| H1 | H2 |
| --- | --- |
| C1 | C2 |`;
      const result = markdownToTiptap(md);
      const headerRow = result.content[0].content?.[0];
      expect(headerRow?.content?.[0].type).toBe("tableHeader");
    });

    test("table data cells", () => {
      const md = `| H1 | H2 |
| --- | --- |
| C1 | C2 |`;
      const result = markdownToTiptap(md);
      const dataRow = result.content[0].content?.[1];
      expect(dataRow?.content?.[0].type).toBe("tableCell");
    });

    test("table alignment", () => {
      const md = `| Left | Center | Right |
| :--- | :---: | ---: |
| L | C | R |`;
      const result = markdownToTiptap(md);
      const headerRow = result.content[0].content?.[0];
      expect(headerRow?.content?.[0].attrs?.alignment).toBe("left");
      expect(headerRow?.content?.[1].attrs?.alignment).toBe("center");
      expect(headerRow?.content?.[2].attrs?.alignment).toBe("right");
    });
  });

  describe("complex documents", () => {
    test("heading + paragraph + list", () => {
      const md = `# Title

Some intro text.

- Item 1
- Item 2`;
      const result = markdownToTiptap(md);
      expect(result.content[0].type).toBe("heading");
      expect(result.content[1].type).toBe("paragraph");
      expect(result.content[2].type).toBe("bulletList");
    });

    test("mixed marks in paragraph", () => {
      const md = "Hello **bold** and *italic* and `code` text.";
      const result = markdownToTiptap(md);
      const content = result.content[0].content;
      expect(content?.length).toBeGreaterThan(1);
    });
  });

  describe("optimizeTiptapDoc", () => {
    test("merges adjacent text nodes with same marks", () => {
      const doc = {
        type: "doc" as const,
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              { type: "text", text: "World" },
            ],
          },
        ],
      };
      const optimized = optimizeTiptapDoc(doc);
      expect(optimized.content[0].content).toHaveLength(1);
      expect(optimized.content[0].content?.[0].text).toBe("Hello World");
    });

    test("does not merge nodes with different marks", () => {
      const doc = {
        type: "doc" as const,
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Normal " },
              { type: "text", text: "Bold", marks: [{ type: "bold" }] },
            ],
          },
        ],
      };
      const optimized = optimizeTiptapDoc(doc);
      expect(optimized.content[0].content).toHaveLength(2);
    });
  });
});
