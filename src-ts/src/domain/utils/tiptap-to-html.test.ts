import { describe, it, expect } from "bun:test";
import { tiptapToHTML, type TiptapToHtmlOptions } from "./tiptap-to-html";

describe("tiptapToHTML", () => {
  describe("basic nodes", () => {
    it("should convert headings h1-h6", () => {
      const doc = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Heading 1" }] },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading 2" }] },
          { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Heading 3" }] },
          { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Heading 4" }] },
          { type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "Heading 5" }] },
          { type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "Heading 6" }] },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain("<h1>Heading 1</h1>");
      expect(html).toContain("<h2>Heading 2</h2>");
      expect(html).toContain("<h3>Heading 3</h3>");
      expect(html).toContain("<h4>Heading 4</h4>");
      expect(html).toContain("<h5>Heading 5</h5>");
      expect(html).toContain("<h6>Heading 6</h6>");
    });

    it("should convert paragraph", () => {
      const doc = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Simple paragraph" }] }],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p>Simple paragraph</p>");
    });

    it("should handle empty paragraph", () => {
      const doc = {
        type: "doc",
        content: [{ type: "paragraph", content: [] }],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p></p>");
    });

    it("should convert horizontal rule", () => {
      const doc = {
        type: "doc",
        content: [{ type: "horizontalRule" }],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<hr>");
    });

    it("should convert hard break", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Line 1" },
              { type: "hardBreak" },
              { type: "text", text: "Line 2" },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p>Line 1<br>Line 2</p>");
    });
  });

  describe("text marks", () => {
    it("should convert bold to strong", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "bold text", marks: [{ type: "bold" }] }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p><strong>bold text</strong></p>");
    });

    it("should convert italic to em", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "italic text", marks: [{ type: "italic" }] }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p><em>italic text</em></p>");
    });

    it("should convert underline to u", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "underlined", marks: [{ type: "underline" }] }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p><u>underlined</u></p>");
    });

    it("should convert strike to s", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "strikethrough", marks: [{ type: "strike" }] }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p><s>strikethrough</s></p>");
    });

    it("should convert code to code", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "inline code", marks: [{ type: "code" }] }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p><code>inline code</code></p>");
    });

    it("should convert subscript to sub", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "H2O", marks: [{ type: "subscript" }] }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p><sub>H2O</sub></p>");
    });

    it("should convert superscript to sup", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x2", marks: [{ type: "superscript" }] }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p><sup>x2</sup></p>");
    });
  });

  describe("link marks", () => {
    it("should convert link with href", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "click here",
                marks: [{ type: "link", attrs: { href: "https://example.com" } }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<p><a href="https://example.com">click here</a></p>');
    });

    it("should convert link with title", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "link",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "https://example.com", title: "Example Site" },
                  },
                ],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<p><a href="https://example.com" title="Example Site">link</a></p>');
    });
  });

  describe("rich formatting marks", () => {
    it("should convert textStyle with color", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "colored text",
                marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<p><span style="color: #ff0000">colored text</span></p>');
    });

    it("should convert textStyle with fontFamily", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "custom font",
                marks: [{ type: "textStyle", attrs: { fontFamily: "Arial" } }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<p><span style="font-family: Arial">custom font</span></p>');
    });

    it("should convert textStyle with fontSize", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "large text",
                marks: [{ type: "textStyle", attrs: { fontSize: "24px" } }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<p><span style="font-size: 24px">large text</span></p>');
    });

    it("should convert textStyle with multiple style attrs", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "styled",
                marks: [
                  {
                    type: "textStyle",
                    attrs: { color: "#00ff00", fontFamily: "Courier", fontSize: "18px" },
                  },
                ],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain('style="');
      expect(html).toContain("color: #00ff00");
      expect(html).toContain("font-family: Courier");
      expect(html).toContain("font-size: 18px");
    });

    it("should convert highlight as mark", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "highlighted", marks: [{ type: "highlight" }] }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p><mark>highlighted</mark></p>");
    });

    it("should convert highlight with custom color", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "yellow highlight",
                marks: [{ type: "highlight", attrs: { color: "#ffff00" } }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<p><mark style="background-color: #ffff00">yellow highlight</mark></p>');
    });
  });

  describe("block styles", () => {
    it("should apply textAlign to paragraph", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "center" },
            content: [{ type: "text", text: "centered" }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<p style="text-align: center">centered</p>');
    });

    it("should skip textAlign left (default)", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "left" },
            content: [{ type: "text", text: "left aligned" }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p>left aligned</p>");
    });

    it("should apply lineHeight to paragraph", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { lineHeight: "2" },
            content: [{ type: "text", text: "double spaced" }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<p style="line-height: 2">double spaced</p>');
    });

    it("should apply textAlign and lineHeight together", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "right", lineHeight: "1.5" },
            content: [{ type: "text", text: "styled paragraph" }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain('style="');
      expect(html).toContain("text-align: right");
      expect(html).toContain("line-height: 1.5");
    });

    it("should apply textAlign to heading", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2, textAlign: "center" },
            content: [{ type: "text", text: "Centered Heading" }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<h2 style="text-align: center">Centered Heading</h2>');
    });
  });

  describe("lists", () => {
    it("should convert bulletList", () => {
      const doc = {
        type: "doc",
        content: [
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
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain("<ul>");
      expect(html).toContain("<li><p>Item 1</p></li>");
      expect(html).toContain("<li><p>Item 2</p></li>");
      expect(html).toContain("</ul>");
    });

    it("should convert orderedList", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }],
              },
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain("<ol>");
      expect(html).toContain("<li><p>First</p></li>");
      expect(html).toContain("<li><p>Second</p></li>");
      expect(html).toContain("</ol>");
    });

    it("should convert orderedList with start attribute", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 5 },
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Fifth" }] }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain('<ol start="5">');
    });

    it("should convert taskList", () => {
      const doc = {
        type: "doc",
        content: [
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
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain('<ul data-type="taskList">');
      expect(html).toContain('<li data-type="taskItem" data-checked="true">');
      expect(html).toContain('<li data-type="taskItem" data-checked="false">');
    });
  });

  describe("code blocks", () => {
    it("should convert code block without language", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "codeBlock",
            content: [{ type: "text", text: "const x = 1;" }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<pre><code>const x = 1;</code></pre>");
    });

    it("should convert code block with language", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: "javascript" },
            content: [{ type: "text", text: 'console.log("hello");' }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<pre><code class="language-javascript">console.log(&quot;hello&quot;);</code></pre>');
    });
  });

  describe("blockquote", () => {
    it("should convert blockquote with nested content", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Quote line 1" }] },
              { type: "paragraph", content: [{ type: "text", text: "Quote line 2" }] },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<blockquote><p>Quote line 1</p><p>Quote line 2</p></blockquote>");
    });
  });

  describe("images", () => {
    it("should exclude images by default", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "https://example.com/pic.jpg", alt: "my picture" },
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p>[Image: my picture]</p>");
    });

    it("should use 'image' as default alt text when excluded", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "https://example.com/pic.jpg" },
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p>[Image: image]</p>");
    });

    it("should show images when excludeImages=false", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "https://example.com/pic.jpg", alt: "my picture" },
          },
        ],
      };

      const html = tiptapToHTML(doc, { excludeImages: false });
      expect(html).toBe('<img src="https://example.com/pic.jpg" alt="my picture">');
    });

    it("should include title attribute when present", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              src: "https://example.com/pic.jpg",
              alt: "picture",
              title: "Click to enlarge",
            },
          },
        ],
      };

      const html = tiptapToHTML(doc, { excludeImages: false });
      expect(html).toContain('title="Click to enlarge"');
    });
  });

  describe("callout", () => {
    it("should convert callout with data-callout-type", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "callout",
            attrs: { type: "warning" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Warning message" }] }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<div data-callout-type="warning"><p>Warning message</p></div>');
    });

    it("should default callout type to info", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "callout",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Info" }] }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe('<div data-callout-type="info"><p>Info</p></div>');
    });
  });

  describe("toggle/details", () => {
    it("should convert toggle with summary", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "toggle",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Summary text" }] },
              { type: "paragraph", content: [{ type: "text", text: "Hidden content" }] },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain("<details>");
      expect(html).toContain("<summary>");
      expect(html).toContain("Summary text");
      expect(html).toContain("</summary>");
      expect(html).toContain("<p>Hidden content</p>");
      expect(html).toContain("</details>");
    });

    it("should convert details with open attribute", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "details",
            attrs: { open: true },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Summary" }] },
              { type: "paragraph", content: [{ type: "text", text: "Content" }] },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain('<details open="true">');
    });
  });

  describe("table", () => {
    it("should convert table with tableRow, tableHeader, tableCell", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }],
                  },
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Age" }] }],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Alice" }] }],
                  },
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "30" }] }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain("<table>");
      expect(html).toContain("<tr>");
      expect(html).toContain("<th><p>Name</p></th>");
      expect(html).toContain("<th><p>Age</p></th>");
      expect(html).toContain("<td><p>Alice</p></td>");
      expect(html).toContain("<td><p>30</p></td>");
      expect(html).toContain("</tr>");
      expect(html).toContain("</table>");
    });

    it("should handle colspan and rowspan", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    attrs: { colspan: 2 },
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Header" }] }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain('<th colspan="2">');
    });
  });

  describe("options", () => {
    it("should truncate with maxChars", () => {
      const doc = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "This is a long paragraph" }] }],
      };

      const html = tiptapToHTML(doc, { maxChars: 10 });
      expect(html.length).toBeGreaterThan(10);
      expect(html).toContain("<!-- truncated:");
    });

    it("should strip inline styles when includeStyles=false", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "center" },
            content: [
              {
                type: "text",
                text: "styled",
                marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc, { includeStyles: false });
      expect(html).toBe("<p>styled</p>");
    });

    it("should preserve marks when includeStyles=false", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "bold",
                marks: [{ type: "bold" }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc, { includeStyles: false });
      expect(html).toBe("<p><strong>bold</strong></p>");
    });

    it("should not strip highlight marks when includeStyles=false", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "highlighted",
                marks: [{ type: "highlight" }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc, { includeStyles: false });
      expect(html).toBe("<p>highlighted</p>");
    });
  });

  describe("edge cases", () => {
    it("should handle null input", () => {
      const html = tiptapToHTML(null);
      expect(html).toBe("");
    });

    it("should handle undefined input", () => {
      const html = tiptapToHTML(undefined);
      expect(html).toBe("");
    });

    it("should handle empty doc", () => {
      const doc = { type: "doc", content: [] };
      const html = tiptapToHTML(doc);
      expect(html).toBe("");
    });

    it("should handle doc without content", () => {
      const doc = { type: "doc" };
      const html = tiptapToHTML(doc);
      expect(html).toBe("");
    });

    it("should handle unknown nodes by passing through children", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "unknownNode",
            content: [{ type: "paragraph", content: [{ type: "text", text: "inside unknown" }] }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p>inside unknown</p>");
    });

    it("should handle unknown nodes without content", () => {
      const doc = {
        type: "doc",
        content: [{ type: "unknownNode" }],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("");
    });
  });

  describe("multiple marks on same text", () => {
    it("should apply bold + italic together", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "bold italic",
                marks: [{ type: "bold" }, { type: "italic" }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      // Marks are applied inside-out, so order depends on array position
      expect(html).toContain("<strong>");
      expect(html).toContain("<em>");
      expect(html).toContain("bold italic");
      expect(html).toContain("</em>");
      expect(html).toContain("</strong>");
    });

    it("should apply bold + italic + color", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "styled",
                marks: [
                  { type: "bold" },
                  { type: "italic" },
                  { type: "textStyle", attrs: { color: "#0000ff" } },
                ],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain("<span");
      expect(html).toContain("color: #0000ff");
      expect(html).toContain("<strong>");
      expect(html).toContain("<em>");
    });

    it("should apply underline + strike + link", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "complex",
                marks: [
                  { type: "underline" },
                  { type: "strike" },
                  { type: "link", attrs: { href: "https://example.com" } },
                ],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain("<u>");
      expect(html).toContain("<s>");
      expect(html).toContain('<a href="https://example.com">');
    });
  });

  describe("HTML escaping", () => {
    it("should escape < > & \" in text content", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: '<script>alert("xss")</script> & more' }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toBe("<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; more</p>");
    });

    it("should escape HTML in link href", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "link",
                marks: [{ type: "link", attrs: { href: 'javascript:alert("xss")' } }],
              },
            ],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain("&quot;");
    });

    it("should escape HTML in attributes", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "pic.jpg", alt: 'Test <img src="x">' },
          },
        ],
      };

      const html = tiptapToHTML(doc, { excludeImages: false });
      expect(html).toContain("&lt;");
      expect(html).toContain("&gt;");
      expect(html).toContain("&quot;");
    });

    it("should escape HTML in code blocks", () => {
      const doc = {
        type: "doc",
        content: [
          {
            type: "codeBlock",
            content: [{ type: "text", text: '<div class="test">code</div>' }],
          },
        ],
      };

      const html = tiptapToHTML(doc);
      expect(html).toContain("&lt;div");
      expect(html).toContain("&gt;");
      expect(html).toContain("&quot;");
    });
  });
});
