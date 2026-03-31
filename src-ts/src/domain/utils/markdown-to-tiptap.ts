/**
 * Markdown to TipTap JSON Converter
 *
 * Converts markdown text to TipTap/ProseMirror JSON document structure.
 * Used for AI-generated content injection into Knowledge pages.
 *
 * Uses remark/unified for battle-tested GFM parsing.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Content, PhrasingContent, Text, Link, Image, InlineCode, Strong, Emphasis, Delete, ListItem } from "mdast";

// TipTap types (matching existing tiptap-to-markdown.ts)
export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

export interface TiptapDocument {
  type: "doc";
  content: TiptapNode[];
}

export interface MarkdownToTiptapOptions {
  /** Preserve unknown nodes as paragraphs with raw text. Default: true */
  preserveUnknown?: boolean;
}

/**
 * Convert markdown string to TipTap JSON document
 */
export function markdownToTiptap(
  markdown: string,
  options?: MarkdownToTiptapOptions
): TiptapDocument {
  if (!markdown || typeof markdown !== "string") {
    return { type: "doc", content: [] };
  }

  const opts = { preserveUnknown: true, ...options };

  // Parse markdown to MDAST using remark
  const ast = unified()
    .use(remarkParse)
    .use(remarkGfm) // GitHub Flavored Markdown: tables, strikethrough, task lists
    .parse(markdown);

  const content = convertChildren(ast.children, opts);

  return {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}

/**
 * Convert array of MDAST nodes to TipTap nodes
 */
function convertChildren(
  nodes: Content[],
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode[] {
  const result: TiptapNode[] = [];

  for (const node of nodes) {
    const converted = convertNode(node, opts);
    if (converted) {
      if (Array.isArray(converted)) {
        result.push(...converted);
      } else {
        result.push(converted);
      }
    }
  }

  return result;
}

/**
 * Convert single MDAST node to TipTap node(s)
 */
function convertNode(
  node: Content,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode | TiptapNode[] | null {
  switch (node.type) {
    case "heading":
      return convertHeading(node, opts);

    case "paragraph":
      return convertParagraph(node, opts);

    case "text":
      return convertText(node);

    case "strong":
      return convertStrong(node, opts);

    case "emphasis":
      return convertEmphasis(node, opts);

    case "delete":
      return convertStrikethrough(node, opts);

    case "inlineCode":
      return convertInlineCode(node);

    case "code":
      return convertCodeBlock(node);

    case "blockquote":
      return convertBlockquote(node, opts);

    case "list":
      return convertList(node, opts);

    case "listItem":
      return convertListItem(node, opts);

    case "link":
      return convertLink(node, opts);

    case "image":
      return convertImage(node);

    case "thematicBreak":
      return { type: "horizontalRule" };

    case "break":
      return { type: "hardBreak" };

    case "table":
      return convertTable(node, opts);

    case "html":
      // Skip raw HTML
      return null;

    default:
      if (opts.preserveUnknown) {
        // Try to extract text content for unknown nodes
        const text = extractText(node);
        if (text) {
          return {
            type: "paragraph",
            content: [{ type: "text", text }],
          };
        }
      }
      return null;
  }
}

/**
 * Convert heading node
 */
function convertHeading(
  node: Extract<Content, { type: "heading" }>,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode {
  const level = Math.min(Math.max(node.depth, 1), 6);
  return {
    type: "heading",
    attrs: { level },
    content: convertInlineContent(node.children, opts),
  };
}

/**
 * Convert paragraph node
 */
function convertParagraph(
  node: Extract<Content, { type: "paragraph" }>,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode {
  const content = convertInlineContent(node.children, opts);
  return {
    type: "paragraph",
    content: content.length > 0 ? content : undefined,
  };
}

/**
 * Convert text node
 */
function convertText(node: Text): TiptapNode {
  return {
    type: "text",
    text: node.value,
  };
}

/**
 * Convert strong (bold) node
 */
function convertStrong(
  node: Strong,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode[] {
  return convertInlineContent(node.children, opts).map((child) => ({
    ...child,
    marks: [...(child.marks || []), { type: "bold" }],
  }));
}

/**
 * Convert emphasis (italic) node
 */
function convertEmphasis(
  node: Emphasis,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode[] {
  return convertInlineContent(node.children, opts).map((child) => ({
    ...child,
    marks: [...(child.marks || []), { type: "italic" }],
  }));
}

/**
 * Convert strikethrough node
 */
function convertStrikethrough(
  node: Delete,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode[] {
  return convertInlineContent(node.children, opts).map((child) => ({
    ...child,
    marks: [...(child.marks || []), { type: "strike" }],
  }));
}

/**
 * Convert inline code node
 */
function convertInlineCode(node: InlineCode): TiptapNode {
  return {
    type: "text",
    text: node.value,
    marks: [{ type: "code" }],
  };
}

/**
 * Convert code block node
 */
function convertCodeBlock(
  node: Extract<Content, { type: "code" }>
): TiptapNode {
  return {
    type: "codeBlock",
    attrs: {
      language: node.lang || null,
    },
    content: node.value ? [{ type: "text", text: node.value }] : undefined,
  };
}

/**
 * Convert blockquote node
 */
function convertBlockquote(
  node: Extract<Content, { type: "blockquote" }>,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode {
  return {
    type: "blockquote",
    content: convertChildren(node.children, opts),
  };
}

/**
 * Convert list node (bullet, ordered, or task)
 */
function convertList(
  node: Extract<Content, { type: "list" }>,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode {
  // Check if this is a task list (any item has checked property)
  const isTaskList = node.children.some(
    (item) => typeof item.checked === "boolean"
  );

  if (isTaskList) {
    return {
      type: "taskList",
      content: node.children.map((item) => convertTaskItem(item, opts)),
    };
  }

  const listType = node.ordered ? "orderedList" : "bulletList";
  const attrs: Record<string, unknown> = {};

  if (node.ordered && node.start !== undefined && node.start !== 1) {
    attrs.start = node.start;
  }

  return {
    type: listType,
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
    content: node.children.map((item) => convertListItem(item, opts)),
  };
}

/**
 * Convert list item node
 */
function convertListItem(
  node: ListItem,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode {
  // If list item has checked property, it's a task item
  if (typeof node.checked === "boolean") {
    return convertTaskItem(node, opts);
  }

  return {
    type: "listItem",
    content: convertListItemContent(node.children, opts),
  };
}

/**
 * Convert task list item
 */
function convertTaskItem(
  node: ListItem,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode {
  return {
    type: "taskItem",
    attrs: {
      checked: node.checked ?? false,
    },
    content: convertListItemContent(node.children, opts),
  };
}

/**
 * Convert list item children - wrap inline content in paragraph
 */
function convertListItemContent(
  children: Content[],
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode[] {
  const result: TiptapNode[] = [];

  for (const child of children) {
    if (child.type === "paragraph") {
      result.push(convertParagraph(child, opts));
    } else if (child.type === "list") {
      result.push(convertList(child, opts));
    } else {
      const converted = convertNode(child, opts);
      if (converted) {
        if (Array.isArray(converted)) {
          result.push(...converted);
        } else {
          result.push(converted);
        }
      }
    }
  }

  return result;
}

/**
 * Convert link node
 */
function convertLink(
  node: Link,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode[] {
  const linkMark: TiptapMark = {
    type: "link",
    attrs: {
      href: node.url,
      title: node.title || null,
    },
  };

  return convertInlineContent(node.children, opts).map((child) => ({
    ...child,
    marks: [...(child.marks || []), linkMark],
  }));
}

/**
 * Convert image node
 */
function convertImage(node: Image): TiptapNode {
  return {
    type: "image",
    attrs: {
      src: node.url,
      alt: node.alt || null,
      title: node.title || null,
    },
  };
}

/**
 * Convert table node
 */
function convertTable(
  node: Extract<Content, { type: "table" }>,
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode {
  const rows: TiptapNode[] = [];

  for (let rowIndex = 0; rowIndex < node.children.length; rowIndex++) {
    const row = node.children[rowIndex];
    if (!row) continue;
    const cells: TiptapNode[] = [];

    for (let cellIndex = 0; cellIndex < row.children.length; cellIndex++) {
      const cell = row.children[cellIndex];
      if (!cell) continue;
      const isHeader = rowIndex === 0;
      const alignment = node.align?.[cellIndex] || null;

      cells.push({
        type: isHeader ? "tableHeader" : "tableCell",
        attrs: alignment ? { alignment } : undefined,
        content: [
          {
            type: "paragraph",
            content: convertInlineContent(cell.children, opts),
          },
        ],
      });
    }

    rows.push({
      type: "tableRow",
      content: cells,
    });
  }

  return {
    type: "table",
    content: rows,
  };
}

/**
 * Convert inline/phrasing content (text, marks, links, etc.)
 */
function convertInlineContent(
  children: PhrasingContent[],
  opts: Required<MarkdownToTiptapOptions>
): TiptapNode[] {
  const result: TiptapNode[] = [];

  for (const child of children) {
    const converted = convertNode(child as Content, opts);
    if (converted) {
      if (Array.isArray(converted)) {
        result.push(...converted);
      } else {
        result.push(converted);
      }
    }
  }

  return result;
}

/**
 * Extract plain text from any node (fallback for unknown nodes)
 */
function extractText(node: Content): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }

  if ("children" in node && Array.isArray(node.children)) {
    return node.children
      .map((child) => extractText(child as Content))
      .join("");
  }

  return "";
}

/**
 * Merge adjacent text nodes with same marks (optimization)
 */
export function optimizeTiptapDoc(doc: TiptapDocument): TiptapDocument {
  return {
    type: "doc",
    content: optimizeNodes(doc.content),
  };
}

function optimizeNodes(nodes: TiptapNode[]): TiptapNode[] {
  const result: TiptapNode[] = [];

  for (const node of nodes) {
    if (node.content) {
      node.content = optimizeNodes(node.content);
    }

    // Try to merge with previous text node
    if (node.type === "text" && result.length > 0) {
      const prev = result[result.length - 1];
      if (prev && prev.type === "text" && marksEqual(prev.marks, node.marks)) {
        prev.text = (prev.text || "") + (node.text || "");
        continue;
      }
    }

    result.push(node);
  }

  return result;
}

function marksEqual(a?: TiptapMark[], b?: TiptapMark[]): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  const aTypes = a.map((m) => m.type).sort();
  const bTypes = b.map((m) => m.type).sort();

  return aTypes.every((t, i) => t === bTypes[i]);
}
