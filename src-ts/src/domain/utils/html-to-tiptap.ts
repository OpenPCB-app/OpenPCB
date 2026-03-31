/**
 * HTML to TipTap JSON Converter
 *
 * Parses HTML to TipTap/ProseMirror JSON with full rich formatting support.
 * Uses htmlparser2 for lightweight SAX-style parsing (no DOM needed).
 */

import { Parser } from "htmlparser2";
import type { TiptapDocument, TiptapNode, TiptapMark } from "./markdown-to-tiptap";
import { optimizeTiptapDoc } from "./markdown-to-tiptap";

export type { TiptapDocument, TiptapNode, TiptapMark };

// Tags that are always stripped (security)
const BLOCKED_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "form",
  "input", "textarea", "button", "select", "option",
]);

// Inline tags that map to TipTap marks
const MARK_TAG_MAP: Record<string, string> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  u: "underline",
  s: "strike",
  del: "strike",
  strike: "strike",
  code: "code",
  sub: "subscript",
  sup: "superscript",
};

// Block tags that produce TipTap block nodes
const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre",
  "hr", "br", "img", "table", "thead", "tbody", "tr", "th", "td",
  "div", "details", "summary",
  "figure", "figcaption",
]);

interface StackFrame {
  tag: string;
  attrs: Record<string, string>;
  children: TiptapNode[];
  marks: TiptapMark[];
  isBlocked: boolean;
}

function parseInlineStyles(styleStr: string): Record<string, string> {
  const styles: Record<string, string> = {};
  if (!styleStr) return styles;
  const parts = styleStr.split(";");
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) continue;
    const key = part.slice(0, colonIdx).trim().toLowerCase();
    const value = part.slice(colonIdx + 1).trim();
    if (key && value) styles[key] = value;
  }
  return styles;
}

function sanitizeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.toLowerCase().startsWith("javascript:")) return null;
  if (trimmed.toLowerCase().startsWith("data:") && !trimmed.toLowerCase().startsWith("data:image/")) return null;
  return trimmed;
}

function extractMarksFromTag(
  tag: string,
  attrs: Record<string, string>,
  parentMarks: TiptapMark[],
): TiptapMark[] {
  const marks = [...parentMarks];

  // Simple mark tags
  const markType = MARK_TAG_MAP[tag];
  if (markType) {
    if (!marks.some((m) => m.type === markType)) {
      marks.push({ type: markType });
    }
    return marks;
  }

  // <a> tag → link mark
  if (tag === "a") {
    const href = sanitizeUrl(attrs.href || "");
    if (href) {
      const linkMark: TiptapMark = {
        type: "link",
        attrs: { href },
      };
      if (attrs.title) linkMark.attrs!.title = attrs.title;
      marks.push(linkMark);
    }
    return marks;
  }

  // <mark> → highlight
  if (tag === "mark") {
    const styles = parseInlineStyles(attrs.style || "");
    const bgColor = styles["background-color"];
    const markObj: TiptapMark = { type: "highlight" };
    if (bgColor) markObj.attrs = { color: bgColor };
    marks.push(markObj);
    return marks;
  }

  // <span> → textStyle marks (color, font-family, font-size)
  if (tag === "span") {
    const styles = parseInlineStyles(attrs.style || "");
    const textStyleAttrs: Record<string, string> = {};
    if (styles.color) textStyleAttrs.color = styles.color;
    if (styles["font-family"]) textStyleAttrs.fontFamily = styles["font-family"];
    if (styles["font-size"]) textStyleAttrs.fontSize = styles["font-size"];

    if (Object.keys(textStyleAttrs).length > 0) {
      marks.push({ type: "textStyle", attrs: textStyleAttrs });
    }

    // Also check for background-color on span as highlight
    if (styles["background-color"]) {
      marks.push({ type: "highlight", attrs: { color: styles["background-color"] } });
    }

    return marks;
  }

  return marks;
}

function getBlockAttrsFromStyles(attrs: Record<string, string>): Record<string, unknown> {
  const blockAttrs: Record<string, unknown> = {};
  const styles = parseInlineStyles(attrs.style || "");

  if (styles["text-align"] && styles["text-align"] !== "left") {
    blockAttrs.textAlign = styles["text-align"];
  }
  if (styles["line-height"]) {
    blockAttrs.lineHeight = styles["line-height"];
  }

  return blockAttrs;
}

function isInlineTag(tag: string): boolean {
  return !BLOCK_TAGS.has(tag) && !BLOCKED_TAGS.has(tag);
}

/**
 * Convert HTML string to TipTap JSON document
 */
export function htmlToTiptap(html: string): TiptapDocument {
  if (!html || typeof html !== "string") {
    return { type: "doc", content: [] };
  }

  const stack: StackFrame[] = [
    { tag: "root", attrs: {}, children: [], marks: [], isBlocked: false },
  ];

  function currentFrame(): StackFrame {
    return stack[stack.length - 1]!;
  }

  function pushFrame(tag: string, attrs: Record<string, string>, marks: TiptapMark[]): void {
    const isBlocked = BLOCKED_TAGS.has(tag) || currentFrame().isBlocked;
    stack.push({ tag, attrs, children: [], marks, isBlocked });
  }

  function popFrame(): StackFrame {
    return stack.pop()!;
  }

  const parser = new Parser(
    {
      onopentag(tagName: string, tagAttrs: Record<string, string>) {
        const tag = tagName.toLowerCase();

        // Strip event handler attributes
        const cleanAttrs: Record<string, string> = {};
        for (const [key, value] of Object.entries(tagAttrs)) {
          if (!key.toLowerCase().startsWith("on")) {
            cleanAttrs[key] = value;
          }
        }

        const parentMarks = currentFrame().marks;
        const marks = extractMarksFromTag(tag, cleanAttrs, parentMarks);

        pushFrame(tag, cleanAttrs, marks);

        // Self-closing void elements handled in onclosetag
      },

      ontext(text: string) {
        const frame = currentFrame();
        if (frame.isBlocked) return;
        if (!text) return;

        // Only add non-empty text
        const trimmedCheck = text.replace(/\s+/g, " ");
        if (!trimmedCheck.trim() && frame.children.length === 0 && !isInlineTag(frame.tag)) {
          return;
        }

        const textNode: TiptapNode = { type: "text", text };
        if (frame.marks.length > 0) {
          textNode.marks = [...frame.marks];
        }
        frame.children.push(textNode);
      },

      onclosetag(tagName: string) {
        const tag = tagName.toLowerCase();
        const frame = popFrame();
        const parent = currentFrame();

        if (frame.isBlocked) return;

        const node = buildNodeFromFrame(tag, frame, parent);
        if (node) {
          if (Array.isArray(node)) {
            parent.children.push(...node);
          } else {
            parent.children.push(node);
          }
        } else if (frame.children.length > 0 && isInlineTag(tag)) {
          // Unknown inline tag — pass children through with marks
          parent.children.push(...frame.children);
        }
      },
    },
    {
      decodeEntities: true,
      lowerCaseTags: true,
      lowerCaseAttributeNames: true,
    },
  );

  parser.write(html);
  parser.end();

  const root = stack[0]!;
  let content = root.children;

  // Wrap any orphaned inline content in paragraphs
  content = wrapOrphanedInlines(content);

  // Remove empty text nodes
  content = content.filter((n) => {
    if (n.type === "text" && (!n.text || !n.text.trim())) return false;
    return true;
  });

  if (content.length === 0) {
    content = [{ type: "paragraph" }];
  }

  return optimizeTiptapDoc({ type: "doc", content });
}

function buildNodeFromFrame(
  tag: string,
  frame: StackFrame,
  _parent: StackFrame,
): TiptapNode | TiptapNode[] | null {
  const attrs = frame.attrs;
  const children = frame.children;
  const blockAttrs = getBlockAttrsFromStyles(attrs);

  switch (tag) {
    case "p": {
      const nodeAttrs = Object.keys(blockAttrs).length > 0 ? blockAttrs : undefined;
      return {
        type: "paragraph",
        attrs: nodeAttrs,
        content: children.length > 0 ? children : undefined,
      };
    }

    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = parseInt(tag[1]!, 10);
      return {
        type: "heading",
        attrs: { level, ...blockAttrs },
        content: children.length > 0 ? children : undefined,
      };
    }

    case "ul": {
      const isTaskList = attrs["data-type"] === "taskList";
      if (isTaskList) {
        return { type: "taskList", content: children };
      }
      return { type: "bulletList", content: children };
    }

    case "ol": {
      const nodeAttrs: Record<string, unknown> = {};
      if (attrs.start && attrs.start !== "1") {
        nodeAttrs.start = parseInt(attrs.start, 10);
      }
      return {
        type: "orderedList",
        attrs: Object.keys(nodeAttrs).length > 0 ? nodeAttrs : undefined,
        content: children,
      };
    }

    case "li": {
      const isTaskItem = attrs["data-type"] === "taskItem";
      if (isTaskItem) {
        const checked = attrs["data-checked"] === "true";
        const content = wrapInlineChildrenInParagraph(children);
        return {
          type: "taskItem",
          attrs: { checked },
          content,
        };
      }
      const content = wrapInlineChildrenInParagraph(children);
      return { type: "listItem", content };
    }

    case "blockquote": {
      const content = wrapInlineChildrenInParagraph(children);
      return { type: "blockquote", content };
    }

    case "pre": {
      // If children contains a codeBlock (from nested <code>), use it
      for (const child of children) {
        if (child.type === "codeBlock") return child;
      }

      // Otherwise build from text content
      const text = children
        .filter((c) => c.type === "text")
        .map((c) => c.text || "")
        .join("");
      return {
        type: "codeBlock",
        attrs: { language: null },
        content: text ? [{ type: "text", text }] : undefined,
      };
    }

    case "code": {
      // If inside <pre>, produce codeBlock
      if (_parent.tag === "pre") {
        const language = extractLanguageFromClass(attrs.class || "");
        const text = children
          .filter((c) => c.type === "text")
          .map((c) => c.text || "")
          .join("");
        return {
          type: "codeBlock",
          attrs: { language: language || null },
          content: text ? [{ type: "text", text }] : undefined,
        };
      }

      // Inline code — children get code mark (handled by mark extraction)
      return children;
    }

    case "hr":
      return { type: "horizontalRule" };

    case "br":
      return { type: "hardBreak" };

    case "img": {
      const src = sanitizeUrl(attrs.src || "");
      if (!src) return null;
      return {
        type: "image",
        attrs: {
          src,
          alt: attrs.alt || null,
          title: attrs.title || null,
        },
      };
    }

    case "div": {
      // Check for callout
      const calloutType = attrs["data-callout-type"];
      if (calloutType) {
        const content = wrapInlineChildrenInParagraph(children);
        return {
          type: "callout",
          attrs: { type: calloutType },
          content,
        };
      }

      // Regular div — unwrap children into block context
      if (children.length > 0) {
        return wrapInlineChildrenInParagraph(children);
      }
      return null;
    }

    case "details": {
      // children should contain summary + body
      return {
        type: "toggle",
        attrs: { open: attrs.open !== undefined },
        content: children.length > 0 ? children : [{ type: "paragraph" }],
      };
    }

    case "summary": {
      // Just pass through as a paragraph-like node (toggle summary)
      return {
        type: "paragraph",
        content: children.length > 0 ? children : undefined,
      };
    }

    case "table": {
      // Filter to only tableRow children
      const rows = children.filter((c) => c.type === "tableRow");
      if (rows.length === 0) return null;
      return { type: "table", content: rows };
    }

    case "thead":
    case "tbody":
    case "tfoot":
      // Unwrap — pass rows through
      return children;

    case "tr": {
      const cells = children.filter(
        (c) => c.type === "tableHeader" || c.type === "tableCell",
      );
      return { type: "tableRow", content: cells };
    }

    case "th": {
      const content = wrapInlineChildrenInParagraph(children);
      const nodeAttrs: Record<string, unknown> = {};
      if (attrs.colspan) nodeAttrs.colspan = parseInt(attrs.colspan, 10);
      if (attrs.rowspan) nodeAttrs.rowspan = parseInt(attrs.rowspan, 10);
      return {
        type: "tableHeader",
        attrs: Object.keys(nodeAttrs).length > 0 ? nodeAttrs : undefined,
        content,
      };
    }

    case "td": {
      const content = wrapInlineChildrenInParagraph(children);
      const nodeAttrs: Record<string, unknown> = {};
      if (attrs.colspan) nodeAttrs.colspan = parseInt(attrs.colspan, 10);
      if (attrs.rowspan) nodeAttrs.rowspan = parseInt(attrs.rowspan, 10);
      return {
        type: "tableCell",
        attrs: Object.keys(nodeAttrs).length > 0 ? nodeAttrs : undefined,
        content,
      };
    }

    // Inline mark tags — children already have marks applied
    case "strong":
    case "b":
    case "em":
    case "i":
    case "u":
    case "s":
    case "del":
    case "strike":
    case "sub":
    case "sup":
    case "a":
    case "mark":
    case "span":
      return children;

    case "figure": {
      // Pass through children (img, figcaption)
      return children;
    }

    case "figcaption": {
      return {
        type: "paragraph",
        content: children.length > 0 ? children : undefined,
      };
    }

    default:
      return null;
  }
}

function extractLanguageFromClass(className: string): string {
  const match = className.match(/language-(\S+)/);
  return match?.[1] || "";
}

/**
 * Wrap inline-only children in paragraph nodes.
 * If children are a mix of block and inline, wrap consecutive inline runs.
 */
function wrapInlineChildrenInParagraph(children: TiptapNode[]): TiptapNode[] {
  if (children.length === 0) return [{ type: "paragraph" }];

  const isBlockNode = (n: TiptapNode) =>
    [
      "paragraph", "heading", "bulletList", "orderedList", "taskList",
      "codeBlock", "blockquote", "image", "horizontalRule", "table",
      "callout", "toggle", "listItem", "taskItem",
    ].includes(n.type);

  const hasBlocks = children.some(isBlockNode);

  if (!hasBlocks) {
    // All inline — wrap in single paragraph
    return [{ type: "paragraph", content: children }];
  }

  // Mix — wrap consecutive inline runs
  const result: TiptapNode[] = [];
  let inlineBuffer: TiptapNode[] = [];

  const flushInline = () => {
    if (inlineBuffer.length > 0) {
      // Filter out whitespace-only text nodes
      const meaningful = inlineBuffer.filter(
        (n) => n.type !== "text" || (n.text && n.text.trim()),
      );
      if (meaningful.length > 0) {
        result.push({ type: "paragraph", content: inlineBuffer });
      }
      inlineBuffer = [];
    }
  };

  for (const child of children) {
    if (isBlockNode(child)) {
      flushInline();
      result.push(child);
    } else {
      inlineBuffer.push(child);
    }
  }
  flushInline();

  return result.length > 0 ? result : [{ type: "paragraph" }];
}

/**
 * Wrap orphaned inline nodes at root level in paragraphs
 */
function wrapOrphanedInlines(nodes: TiptapNode[]): TiptapNode[] {
  return wrapInlineChildrenInParagraph(nodes);
}
