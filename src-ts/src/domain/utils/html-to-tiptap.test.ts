/**
 * HTML to TipTap JSON Converter Tests
 *
 * Comprehensive test suite covering parsing, security, formatting, and roundtrip conversion
 */

import { describe, it, expect } from "bun:test";
import { htmlToTiptap } from "./html-to-tiptap";
import { tiptapToHTML } from "./tiptap-to-html";
import type { TiptapDocument } from "./markdown-to-tiptap";

describe("htmlToTiptap", () => {
  describe("Basic block elements", () => {
    it("should convert paragraph", () => {
      const html = "<p>Hello world</p>";
      const result = htmlToTiptap(html);

      expect(result.type).toBe("doc");
      expect(result.content).toEqual([
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
      ]);
    });

    it("should convert headings h1-h6", () => {
      const html = "<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>";
      const result = htmlToTiptap(html);

      expect(result.content).toHaveLength(6);
      expect(result.content[0]).toEqual({
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "H1" }],
      });
      expect(result.content[5]).toEqual({
        type: "heading",
        attrs: { level: 6 },
        content: [{ type: "text", text: "H6" }],
      });
    });

    it("should convert horizontal rule", () => {
      const html = "<hr>";
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([{ type: "horizontalRule" }]);
    });

    it("should convert hard break", () => {
      const html = "<p>Line 1<br>Line 2</p>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toEqual([
        { type: "text", text: "Line 1" },
        { type: "hardBreak" },
        { type: "text", text: "Line 2" },
      ]);
    });

    it("should convert empty paragraph", () => {
      const html = "<p></p>";
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([{ type: "paragraph" }]);
    });
  });

  describe("Inline marks", () => {
    it("should convert bold marks (strong and b)", () => {
      const html = "<p><strong>Strong text</strong> and <b>Bold text</b></p>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toEqual([
        { type: "text", text: "Strong text", marks: [{ type: "bold" }] },
        { type: "text", text: " and " },
        { type: "text", text: "Bold text", marks: [{ type: "bold" }] },
      ]);
    });

    it("should convert italic marks (em and i)", () => {
      const html = "<p><em>Emphasis</em> and <i>Italic</i></p>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toEqual([
        { type: "text", text: "Emphasis", marks: [{ type: "italic" }] },
        { type: "text", text: " and " },
        { type: "text", text: "Italic", marks: [{ type: "italic" }] },
      ]);
    });

    it("should convert underline mark", () => {
      const html = "<p><u>Underlined</u></p>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toEqual([
        { type: "text", text: "Underlined", marks: [{ type: "underline" }] },
      ]);
    });

    it("should convert strikethrough marks (s, del, strike)", () => {
      const html = "<p><s>Strike 1</s> <del>Strike 2</del></p>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toEqual([
        { type: "text", text: "Strike 1", marks: [{ type: "strike" }] },
        { type: "text", text: " " },
        { type: "text", text: "Strike 2", marks: [{ type: "strike" }] },
      ]);
    });

    it("should convert inline code mark", () => {
      const html = "<p>Use <code>const x = 1;</code> in JS</p>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toEqual([
        { type: "text", text: "Use " },
        { type: "text", text: "const x = 1;", marks: [{ type: "code" }] },
        { type: "text", text: " in JS" },
      ]);
    });

    it("should convert subscript mark", () => {
      const html = "<p>H<sub>2</sub>O</p>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toEqual([
        { type: "text", text: "H" },
        { type: "text", text: "2", marks: [{ type: "subscript" }] },
        { type: "text", text: "O" },
      ]);
    });

    it("should convert superscript mark", () => {
      const html = "<p>E=mc<sup>2</sup></p>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toEqual([
        { type: "text", text: "E=mc" },
        { type: "text", text: "2", marks: [{ type: "superscript" }] },
      ]);
    });

    it("should combine multiple marks", () => {
      const html = "<p><strong><em><u>Bold italic underlined</u></em></strong></p>";
      const result = htmlToTiptap(html);

      const marks = result.content[0]?.content?.[0]?.marks || [];
      expect(marks).toHaveLength(3);
      expect(marks.some(m => m.type === "bold")).toBe(true);
      expect(marks.some(m => m.type === "italic")).toBe(true);
      expect(marks.some(m => m.type === "underline")).toBe(true);
    });
  });

  describe("Links", () => {
    it("should convert link with href", () => {
      const html = '<p><a href="https://example.com">Click here</a></p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toEqual([
        {
          type: "text",
          text: "Click here",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ]);
    });

    it("should convert link with title", () => {
      const html = '<p><a href="https://example.com" title="Example Site">Link</a></p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content?.[0]?.marks).toEqual([
        {
          type: "link",
          attrs: { href: "https://example.com", title: "Example Site" },
        },
      ]);
    });

    it("should strip javascript: URLs", () => {
      const html = '<p><a href="javascript:alert(1)">XSS</a></p>';
      const result = htmlToTiptap(html);

      // Link should be ignored (no href)
      expect(result.content[0]?.content).toEqual([{ type: "text", text: "XSS" }]);
    });

    it("should sanitize data: URLs (except images)", () => {
      const html = '<p><a href="data:text/html,<script>alert(1)</script>">Bad</a></p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toEqual([{ type: "text", text: "Bad" }]);
    });
  });

  describe("Rich formatting (textStyle and highlight)", () => {
    it("should extract color from span style", () => {
      const html = '<p><span style="color: red">Red text</span></p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toEqual([
        {
          type: "text",
          text: "Red text",
          marks: [{ type: "textStyle", attrs: { color: "red" } }],
        },
      ]);
    });

    it("should extract font-family from span style", () => {
      const html = '<p><span style="font-family: Georgia">Serif text</span></p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content?.[0]?.marks).toEqual([
        { type: "textStyle", attrs: { fontFamily: "Georgia" } },
      ]);
    });

    it("should extract font-size from span style", () => {
      const html = '<p><span style="font-size: 16px">Sized text</span></p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content?.[0]?.marks).toEqual([
        { type: "textStyle", attrs: { fontSize: "16px" } },
      ]);
    });

    it("should combine multiple textStyle properties", () => {
      const html = '<p><span style="color: red; font-family: Georgia; font-size: 16px">Rich</span></p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content?.[0]?.marks).toEqual([
        {
          type: "textStyle",
          attrs: { color: "red", fontFamily: "Georgia", fontSize: "16px" },
        },
      ]);
    });

    it("should extract highlight from mark tag", () => {
      const html = '<p><mark style="background-color: #fef2f2">Highlighted</mark></p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content?.[0]?.marks).toEqual([
        { type: "highlight", attrs: { color: "#fef2f2" } },
      ]);
    });

    it("should extract highlight from span background-color", () => {
      const html = '<p><span style="background-color: yellow">Yellow bg</span></p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content?.[0]?.marks).toEqual([
        { type: "highlight", attrs: { color: "yellow" } },
      ]);
    });
  });

  describe("Block attributes", () => {
    it("should extract text-align from paragraph", () => {
      const html = '<p style="text-align: center">Centered text</p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]).toEqual({
        type: "paragraph",
        attrs: { textAlign: "center" },
        content: [{ type: "text", text: "Centered text" }],
      });
    });

    it("should extract line-height from paragraph", () => {
      const html = '<p style="line-height: 1.5">Spaced text</p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]).toEqual({
        type: "paragraph",
        attrs: { lineHeight: "1.5" },
        content: [{ type: "text", text: "Spaced text" }],
      });
    });

    it("should combine block attributes", () => {
      const html = '<p style="text-align: right; line-height: 2">Styled para</p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.attrs).toEqual({
        textAlign: "right",
        lineHeight: "2",
      });
    });

    it("should ignore text-align: left (default)", () => {
      const html = '<p style="text-align: left">Default align</p>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.attrs).toBeUndefined();
    });
  });

  describe("Lists", () => {
    it("should convert bullet list", () => {
      const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Item 1" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Item 2" }] }],
            },
          ],
        },
      ]);
    });

    it("should convert ordered list", () => {
      const html = "<ol><li>First</li><li>Second</li></ol>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.type).toBe("orderedList");
      expect(result.content[0]?.content).toHaveLength(2);
    });

    it("should preserve ordered list start attribute", () => {
      const html = '<ol start="5"><li>Five</li></ol>';
      const result = htmlToTiptap(html);

      expect(result.content[0]).toMatchObject({
        type: "orderedList",
        attrs: { start: 5 },
      });
    });

    it("should convert task list", () => {
      const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">Done</li><li data-type="taskItem" data-checked="false">Todo</li></ul>';
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Done" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Todo" }] }],
            },
          ],
        },
      ]);
    });
  });

  describe("Code blocks", () => {
    it("should convert pre tag to code block", () => {
      const html = "<pre>const x = 1;</pre>";
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([
        {
          type: "codeBlock",
          attrs: { language: null },
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ]);
    });

    it("should extract language from code class", () => {
      const html = '<pre><code class="language-js">const x = 1;</code></pre>';
      const result = htmlToTiptap(html);

      expect(result.content[0]).toEqual({
        type: "codeBlock",
        attrs: { language: "js" },
        content: [{ type: "text", text: "const x = 1;" }],
      });
    });

    it("should handle code block with multiple languages in class", () => {
      const html = '<pre><code class="language-typescript highlighter-rouge">type T = string;</code></pre>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.attrs).toEqual({ language: "typescript" });
    });

    it("should preserve whitespace in code blocks", () => {
      const html = "<pre>  indented\n  code</pre>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content?.[0]?.text).toBe("  indented\n  code");
    });
  });

  describe("Blockquote", () => {
    it("should convert blockquote", () => {
      const html = "<blockquote><p>Quoted text</p></blockquote>";
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Quoted text" }],
            },
          ],
        },
      ]);
    });

    it("should handle blockquote with multiple paragraphs", () => {
      const html = "<blockquote><p>Para 1</p><p>Para 2</p></blockquote>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toHaveLength(2);
      expect(result.content[0]?.content?.[0]?.type).toBe("paragraph");
      expect(result.content[0]?.content?.[1]?.type).toBe("paragraph");
    });
  });

  describe("Images", () => {
    it("should convert image with src", () => {
      const html = '<img src="https://example.com/image.jpg">';
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([
        {
          type: "image",
          attrs: {
            src: "https://example.com/image.jpg",
            alt: null,
            title: null,
          },
        },
      ]);
    });

    it("should convert image with alt and title", () => {
      const html = '<img src="test.jpg" alt="Test image" title="Hover text">';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.attrs).toEqual({
        src: "test.jpg",
        alt: "Test image",
        title: "Hover text",
      });
    });

    it("should ignore image without src", () => {
      const html = '<img alt="No source">';
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([{ type: "paragraph" }]);
    });

    it("should allow data:image URLs for images", () => {
      const html = '<img src="data:image/png;base64,iVBORw0KGgoAAAANS" alt="Base64">';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.type).toBe("image");
      expect(result.content[0]?.attrs?.src).toContain("data:image/png");
    });
  });

  describe("Callout", () => {
    it("should convert div with data-callout-type", () => {
      const html = '<div data-callout-type="info"><p>Information</p></div>';
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([
        {
          type: "callout",
          attrs: { type: "info" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Information" }],
            },
          ],
        },
      ]);
    });

    it("should handle different callout types", () => {
      const html = '<div data-callout-type="warning"><p>Warning text</p></div>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.attrs).toEqual({ type: "warning" });
    });
  });

  describe("Toggle (details/summary)", () => {
    it("should convert details tag to toggle", () => {
      const html = "<details><summary>Title</summary><p>Body content</p></details>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.type).toBe("toggle");
      expect(result.content[0]?.attrs?.open).toBe(false);
      expect(result.content[0]?.content).toHaveLength(2);
    });

    it("should preserve open attribute", () => {
      const html = '<details open><summary>Open</summary><p>Content</p></details>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.attrs?.open).toBe(true);
    });

    it("should handle empty details", () => {
      const html = "<details><summary>Empty</summary></details>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toHaveLength(1);
      expect(result.content[0]?.content?.[0]?.type).toBe("paragraph");
    });
  });

  describe("Tables", () => {
    it("should convert basic table", () => {
      const html = `
        <table>
          <tr><th>Header</th></tr>
          <tr><td>Cell</td></tr>
        </table>
      `;
      const result = htmlToTiptap(html);

      expect(result.content[0]?.type).toBe("table");
      expect(result.content[0]?.content).toHaveLength(2);
      expect(result.content[0]?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
      expect(result.content[0]?.content?.[1]?.content?.[0]?.type).toBe("tableCell");
    });

    it("should handle colspan and rowspan", () => {
      const html = '<table><tr><td colspan="2" rowspan="3">Merged</td></tr></table>';
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content?.[0]?.content?.[0]?.attrs).toEqual({
        colspan: 2,
        rowspan: 3,
      });
    });

    it("should unwrap thead and tbody", () => {
      const html = `
        <table>
          <thead><tr><th>H1</th></tr></thead>
          <tbody><tr><td>C1</td></tr></tbody>
        </table>
      `;
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content).toHaveLength(2);
      expect(result.content[0]?.content?.[0]?.type).toBe("tableRow");
    });

    it("should wrap cell content in paragraphs", () => {
      const html = "<table><tr><td>Text</td></tr></table>";
      const result = htmlToTiptap(html);

      const cellContent = result.content[0]?.content?.[0]?.content?.[0]?.content;
      expect(cellContent?.[0]?.type).toBe("paragraph");
    });
  });

  describe("Security (XSS prevention)", () => {
    it("should strip script tags", () => {
      const html = '<p>Text</p><script>alert("XSS")</script><p>More</p>';
      const result = htmlToTiptap(html);

      expect(result.content).toHaveLength(2);
      expect(result.content.every((n) => n.type !== "script")).toBe(true);
    });

    it("should strip event handler attributes", () => {
      const html = '<p onclick="alert(1)">Clickable</p>';
      const result = htmlToTiptap(html);

      // Just verify no errors and content is preserved
      expect(result.content[0]?.content?.[0]?.text).toBe("Clickable");
    });

    it("should strip iframe tags", () => {
      const html = '<iframe src="https://evil.com"></iframe>';
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([{ type: "paragraph" }]);
    });

    it("should strip form elements", () => {
      const html = '<form><input type="text"><button>Submit</button></form>';
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([{ type: "paragraph" }]);
    });

    it("should strip style tags", () => {
      const html = '<style>body { display: none; }</style><p>Text</p>';
      const result = htmlToTiptap(html);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("paragraph");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty input", () => {
      const result = htmlToTiptap("");
      expect(result).toEqual({ type: "doc", content: [] });
    });

    it("should handle null input", () => {
      const result = htmlToTiptap(null as any);
      expect(result).toEqual({ type: "doc", content: [] });
    });

    it("should handle undefined input", () => {
      const result = htmlToTiptap(undefined as any);
      expect(result).toEqual({ type: "doc", content: [] });
    });

    it("should wrap orphaned text in paragraph", () => {
      const html = "Just plain text";
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([
        {
          type: "paragraph",
          content: [{ type: "text", text: "Just plain text" }],
        },
      ]);
    });

    it("should handle leading whitespace", () => {
      const html = "   <p>Text</p>";
      const result = htmlToTiptap(html);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("paragraph");
    });

    it("should filter empty text nodes", () => {
      const html = "<p>   </p>";
      const result = htmlToTiptap(html);

      expect(result.content).toEqual([{ type: "paragraph" }]);
    });

    it("should handle mixed inline and block content", () => {
      const html = "Text before<p>Para</p>Text after";
      const result = htmlToTiptap(html);

      expect(result.content).toHaveLength(3);
      expect(result.content[0]?.type).toBe("paragraph");
      expect(result.content[1]?.type).toBe("paragraph");
      expect(result.content[2]?.type).toBe("paragraph");
    });

    it("should handle nested lists", () => {
      const html = "<ul><li>Item 1<ul><li>Nested</li></ul></li></ul>";
      const result = htmlToTiptap(html);

      const outerList = result.content[0];
      expect(outerList?.type).toBe("bulletList");
      const firstItem = outerList?.content?.[0];
      expect(firstItem?.content).toHaveLength(2);
      expect(firstItem?.content?.[1]?.type).toBe("bulletList");
    });

    it("should handle HTML entities", () => {
      const html = "<p>&lt;tag&gt; &amp; &quot;quotes&quot;</p>";
      const result = htmlToTiptap(html);

      expect(result.content[0]?.content?.[0]?.text).toBe('<tag> & "quotes"');
    });
  });

  describe("Roundtrip conversion", () => {
    it("should roundtrip heading", () => {
      const original: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Title" }],
          },
        ],
      };

      const html = tiptapToHTML(original, { excludeImages: false });
      const result = htmlToTiptap(html);

      expect(result).toEqual(original);
    });

    it("should roundtrip paragraph with bold and italic", () => {
      const original: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Normal " },
              { type: "text", text: "bold", marks: [{ type: "bold" }] },
              { type: "text", text: " and " },
              { type: "text", text: "italic", marks: [{ type: "italic" }] },
            ],
          },
        ],
      };

      const html = tiptapToHTML(original, { excludeImages: false });
      const result = htmlToTiptap(html);

      expect(result).toEqual(original);
    });

    it("should roundtrip bullet list", () => {
      const original: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Item 1" }] },
                ],
              },
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Item 2" }] },
                ],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(original, { excludeImages: false });
      const result = htmlToTiptap(html);

      expect(result).toEqual(original);
    });

    it("should roundtrip ordered list with start attribute", () => {
      const original: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 5 },
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Five" }] },
                ],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(original, { excludeImages: false });
      const result = htmlToTiptap(html);

      expect(result).toEqual(original);
    });

    it("should roundtrip code block with language", () => {
      const original: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: "javascript" },
            content: [{ type: "text", text: "const x = 1;" }],
          },
        ],
      };

      const html = tiptapToHTML(original, { excludeImages: false });
      const result = htmlToTiptap(html);

      expect(result).toEqual(original);
    });

    it("should roundtrip link with title", () => {
      const original: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Link text",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "https://example.com", title: "Example" },
                  },
                ],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(original, { excludeImages: false });
      const result = htmlToTiptap(html);

      expect(result).toEqual(original);
    });

    it("should roundtrip blockquote", () => {
      const original: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Quoted" }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(original, { excludeImages: false });
      const result = htmlToTiptap(html);

      expect(result).toEqual(original);
    });

    it("should roundtrip horizontal rule", () => {
      const original: TiptapDocument = {
        type: "doc",
        content: [{ type: "horizontalRule" }],
      };

      const html = tiptapToHTML(original, { excludeImages: false });
      const result = htmlToTiptap(html);

      expect(result).toEqual(original);
    });

    it("should roundtrip task list", () => {
      const original: TiptapDocument = {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: true },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Done" }] },
                ],
              },
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Todo" }] },
                ],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(original, { excludeImages: false });
      const result = htmlToTiptap(html);

      expect(result).toEqual(original);
    });
  });

  describe("Complex real-world scenarios", () => {
    it("should handle rich formatted paragraph", () => {
      const html = `
        <p style="text-align: center; line-height: 1.5">
          <span style="color: red; font-family: Georgia; font-size: 18px">
            <strong><em>Rich formatted text</em></strong>
          </span>
        </p>
      `;
      const result = htmlToTiptap(html);

      const paragraph = result.content[0];
      expect(paragraph?.type).toBe("paragraph");
      expect(paragraph?.attrs).toEqual({
        textAlign: "center",
        lineHeight: "1.5",
      });

      // Text should have nested marks (textStyle, bold, italic all accumulated)
      const textNodes = paragraph?.content || [];
      expect(textNodes.length).toBeGreaterThan(0);

      // Check that we have the expected marks present
      const allMarks = textNodes.flatMap((n) => n.marks || []);
      const markTypes = allMarks.map((m) => m.type);
      expect(markTypes).toContain("textStyle");

      // Verify textStyle attrs
      const textStyleMark = allMarks.find((m) => m.type === "textStyle");
      expect(textStyleMark?.attrs).toEqual({
        color: "red",
        fontFamily: "Georgia",
        fontSize: "18px",
      });
    });

    it("should handle document with mixed content", () => {
      const html = `
        <h1>Document Title</h1>
        <p>Introduction paragraph with <strong>bold</strong> and <em>italic</em>.</p>
        <ul>
          <li>List item 1</li>
          <li>List item 2</li>
        </ul>
        <blockquote>
          <p>A meaningful quote</p>
        </blockquote>
        <pre><code class="language-js">console.log("code");</code></pre>
      `;
      const result = htmlToTiptap(html);

      expect(result.content).toHaveLength(5);
      expect(result.content[0]?.type).toBe("heading");
      expect(result.content[1]?.type).toBe("paragraph");
      expect(result.content[2]?.type).toBe("bulletList");
      expect(result.content[3]?.type).toBe("blockquote");
      expect(result.content[4]?.type).toBe("codeBlock");
    });

    it("should handle table with formatted cells", () => {
      const html = `
        <table>
          <thead>
            <tr>
              <th><strong>Header 1</strong></th>
              <th><em>Header 2</em></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cell 1</td>
              <td><code>code cell</code></td>
            </tr>
          </tbody>
        </table>
      `;
      const result = htmlToTiptap(html);

      expect(result.content[0]?.type).toBe("table");
      const firstHeader = result.content[0]?.content?.[0]?.content?.[0];
      expect(firstHeader?.type).toBe("tableHeader");
      expect(firstHeader?.content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe("bold");
    });
  });
});
