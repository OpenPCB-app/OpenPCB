/**
 * Format Operations Engine
 *
 * Walks a TipTap document tree and applies targeted style operations
 * without modifying text content. Used by format_content tool.
 */

import type { TiptapDocument, TiptapNode, TiptapMark } from "../../utils/markdown-to-tiptap";

/**
 * Target selector for which blocks to affect
 */
export interface FormatTarget {
  blockType?: "all" | "heading" | "paragraph" | "blockquote" | "codeBlock" | "listItem" | "callout";
  level?: number;
  blockIndex?: number;
  blockRange?: [number, number];
  textContains?: string;
}

/**
 * Block-level style properties
 */
export interface BlockStyles {
  textAlign?: "left" | "center" | "right" | "justify";
  lineHeight?: string;
}

/**
 * Inline text style properties. null = remove.
 */
export interface TextStyles {
  color?: string | null;
  backgroundColor?: string | null;
  fontFamily?: string | null;
  fontSize?: string | null;
  bold?: boolean | null;
  italic?: boolean | null;
  underline?: boolean | null;
  strikethrough?: boolean | null;
}

/**
 * Block type conversion
 */
export interface ConvertTo {
  type: "paragraph" | "heading" | "blockquote" | "codeBlock" | "bulletList" | "orderedList" | "callout";
  level?: number;
  calloutType?: "info" | "warning" | "error" | "success";
}

/**
 * Single formatting operation
 */
export interface FormatOperation {
  target: FormatTarget;
  blockStyles?: BlockStyles;
  textStyles?: TextStyles;
  textMatch?: string;
  convertTo?: ConvertTo;
}

/**
 * Apply format operations to a TipTap document.
 * Returns a new document — input is not mutated.
 */
export function applyFormatOperations(
  doc: TiptapDocument,
  operations: FormatOperation[],
): TiptapDocument {
  const cloned = structuredClone(doc);

  if (!cloned.content) return cloned;

  let blockIndex = 0;

  function walkBlocks(nodes: TiptapNode[]): TiptapNode[] {
    const result: TiptapNode[] = [];

    for (let i = 0; i < nodes.length; i++) {
      let node = nodes[i]!;
      const currentIndex = blockIndex;

      if (isBlockNode(node)) {
        blockIndex++;

        for (const op of operations) {
          if (matchesTarget(node, op.target, currentIndex)) {
            node = applyOperation(node, op);
          }
        }
      }

      // Recurse into children for nested blocks
      if (node.content && hasNestedBlocks(node)) {
        node.content = walkBlocks(node.content);
      }

      result.push(node);
    }

    return result;
  }

  cloned.content = walkBlocks(cloned.content);
  return cloned;
}

function isBlockNode(node: TiptapNode): boolean {
  return [
    "paragraph", "heading", "blockquote", "codeBlock",
    "listItem", "taskItem", "callout", "image", "horizontalRule",
  ].includes(node.type);
}

function hasNestedBlocks(node: TiptapNode): boolean {
  return [
    "bulletList", "orderedList", "taskList", "blockquote",
    "listItem", "taskItem", "callout", "toggle",
  ].includes(node.type);
}

function matchesTarget(node: TiptapNode, target: FormatTarget, blockIndex: number): boolean {
  // blockType filter
  if (target.blockType && target.blockType !== "all") {
    if (target.blockType !== node.type) return false;
  }

  // heading level filter
  if (target.level !== undefined && node.type === "heading") {
    if ((node.attrs?.level as number) !== target.level) return false;
  }

  // blockIndex filter
  if (target.blockIndex !== undefined) {
    if (blockIndex !== target.blockIndex) return false;
  }

  // blockRange filter
  if (target.blockRange !== undefined) {
    const [start, end] = target.blockRange;
    if (blockIndex < start || blockIndex > end) return false;
  }

  // textContains filter
  if (target.textContains) {
    const text = extractPlainText(node);
    if (!text.includes(target.textContains)) return false;
  }

  return true;
}

function applyOperation(node: TiptapNode, op: FormatOperation): TiptapNode {
  // Apply blockStyles
  if (op.blockStyles) {
    if (!node.attrs) node.attrs = {};
    if (op.blockStyles.textAlign) {
      node.attrs.textAlign = op.blockStyles.textAlign;
    }
    if (op.blockStyles.lineHeight) {
      node.attrs.lineHeight = op.blockStyles.lineHeight;
    }
  }

  // Apply textStyles to text nodes
  if (op.textStyles && node.content) {
    node.content = applyTextStylesToContent(node.content, op.textStyles, op.textMatch);
  }

  // Apply convertTo
  if (op.convertTo) {
    node = convertBlockType(node, op.convertTo);
  }

  return node;
}

function applyTextStylesToContent(
  nodes: TiptapNode[],
  styles: TextStyles,
  textMatch?: string,
): TiptapNode[] {
  const result: TiptapNode[] = [];

  for (const node of nodes) {
    if (node.type === "text") {
      if (textMatch && node.text && !node.text.includes(textMatch)) {
        // If textMatch specified and this text doesn't contain it, split and style only matching part
        result.push(...splitAndStyleTextNode(node, styles, textMatch));
      } else if (textMatch && node.text && node.text.includes(textMatch)) {
        result.push(...splitAndStyleTextNode(node, styles, textMatch));
      } else if (!textMatch) {
        // No textMatch — style all text
        result.push(applyTextStylesToNode(node, styles));
      } else {
        result.push(node);
      }
    } else if (node.content) {
      // Recurse into inline containers
      node.content = applyTextStylesToContent(node.content, styles, textMatch);
      result.push(node);
    } else {
      result.push(node);
    }
  }

  return result;
}

function splitAndStyleTextNode(
  node: TiptapNode,
  styles: TextStyles,
  textMatch: string,
): TiptapNode[] {
  const text = node.text || "";
  const matchIndex = text.indexOf(textMatch);

  if (matchIndex === -1) return [node];

  const result: TiptapNode[] = [];

  // Before match
  if (matchIndex > 0) {
    result.push({ type: "text", text: text.slice(0, matchIndex), marks: node.marks ? [...node.marks] : undefined });
  }

  // Match — apply styles
  const styledNode: TiptapNode = {
    type: "text",
    text: textMatch,
    marks: node.marks ? [...node.marks] : [],
  };
  result.push(applyTextStylesToNode(styledNode, styles));

  // After match
  const afterIndex = matchIndex + textMatch.length;
  if (afterIndex < text.length) {
    result.push({ type: "text", text: text.slice(afterIndex), marks: node.marks ? [...node.marks] : undefined });
  }

  return result;
}

function applyTextStylesToNode(node: TiptapNode, styles: TextStyles): TiptapNode {
  let marks = node.marks ? [...node.marks] : [];

  // Toggle marks (bold, italic, underline, strikethrough)
  marks = toggleMark(marks, "bold", styles.bold);
  marks = toggleMark(marks, "italic", styles.italic);
  marks = toggleMark(marks, "underline", styles.underline);
  marks = toggleMark(marks, "strike", styles.strikethrough);

  // textStyle mark (color, fontFamily, fontSize)
  const textStyleAttrs: Record<string, string> = {};
  let existingTextStyle = marks.find((m) => m.type === "textStyle");

  if (styles.color !== undefined) {
    if (styles.color === null) {
      // Remove color
      if (existingTextStyle?.attrs) delete (existingTextStyle.attrs as Record<string, unknown>).color;
    } else {
      textStyleAttrs.color = styles.color;
    }
  }

  if (styles.fontFamily !== undefined) {
    if (styles.fontFamily === null) {
      if (existingTextStyle?.attrs) delete (existingTextStyle.attrs as Record<string, unknown>).fontFamily;
    } else {
      textStyleAttrs.fontFamily = styles.fontFamily;
    }
  }

  if (styles.fontSize !== undefined) {
    if (styles.fontSize === null) {
      if (existingTextStyle?.attrs) delete (existingTextStyle.attrs as Record<string, unknown>).fontSize;
    } else {
      textStyleAttrs.fontSize = styles.fontSize;
    }
  }

  if (Object.keys(textStyleAttrs).length > 0) {
    if (existingTextStyle) {
      existingTextStyle.attrs = { ...existingTextStyle.attrs, ...textStyleAttrs };
    } else {
      marks.push({ type: "textStyle", attrs: textStyleAttrs });
    }
  }

  // Clean up textStyle if all attrs removed
  marks = marks.filter((m) => {
    if (m.type === "textStyle" && m.attrs) {
      const keys = Object.keys(m.attrs).filter((k) => (m.attrs as Record<string, unknown>)[k] !== undefined);
      return keys.length > 0;
    }
    return true;
  });

  // highlight mark (backgroundColor)
  if (styles.backgroundColor !== undefined) {
    marks = marks.filter((m) => m.type !== "highlight");
    if (styles.backgroundColor !== null) {
      marks.push({ type: "highlight", attrs: { color: styles.backgroundColor } });
    }
  }

  node.marks = marks.length > 0 ? marks : undefined;
  return node;
}

function toggleMark(marks: TiptapMark[], markType: string, value?: boolean | null): TiptapMark[] {
  if (value === undefined) return marks;

  if (value === null || value === false) {
    return marks.filter((m) => m.type !== markType);
  }

  if (!marks.some((m) => m.type === markType)) {
    marks.push({ type: markType });
  }

  return marks;
}

function convertBlockType(node: TiptapNode, convertTo: ConvertTo): TiptapNode {
  switch (convertTo.type) {
    case "paragraph":
      return { ...node, type: "paragraph", attrs: { ...node.attrs } };

    case "heading": {
      const level = convertTo.level ?? 2;
      return { ...node, type: "heading", attrs: { ...node.attrs, level } };
    }

    case "blockquote":
      return {
        type: "blockquote",
        content: [{ type: "paragraph", content: node.content, attrs: node.attrs }],
      };

    case "codeBlock": {
      const text = extractPlainText(node);
      return {
        type: "codeBlock",
        attrs: { language: null },
        content: text ? [{ type: "text", text }] : undefined,
      };
    }

    case "callout": {
      const calloutType = convertTo.calloutType ?? "info";
      return {
        type: "callout",
        attrs: { type: calloutType },
        content: node.content
          ? [{ type: "paragraph", content: node.content, attrs: node.attrs }]
          : [{ type: "paragraph" }],
      };
    }

    case "bulletList":
      return {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: node.content, attrs: node.attrs }],
          },
        ],
      };

    case "orderedList":
      return {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: node.content, attrs: node.attrs }],
          },
        ],
      };

    default:
      return node;
  }
}

function extractPlainText(node: TiptapNode): string {
  if (node.type === "text") return node.text || "";
  if (!node.content) return "";
  return node.content.map(extractPlainText).join("");
}
