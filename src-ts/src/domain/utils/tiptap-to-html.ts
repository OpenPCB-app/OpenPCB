/**
 * TipTap JSON to HTML Converter
 *
 * Converts TipTap/ProseMirror JSON document structure to HTML,
 * preserving all rich formatting (colors, fonts, sizes, alignment, etc.)
 * that markdown cannot express.
 */

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

interface TiptapDoc {
  type: "doc";
  content?: TiptapNode[];
}

export interface TiptapToHtmlOptions {
  maxChars?: number;
  excludeImages?: boolean;
  includeStyles?: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildStyleString(styles: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(styles)) {
    if (value !== undefined && value !== null && value !== "") {
      parts.push(`${key}: ${value}`);
    }
  }
  return parts.join("; ");
}

function getBlockStyles(attrs: Record<string, unknown>, includeStyles: boolean): string {
  if (!includeStyles) return "";
  const styles: Record<string, string | undefined> = {};
  if (typeof attrs.textAlign === "string" && attrs.textAlign !== "left") {
    styles["text-align"] = attrs.textAlign;
  }
  if (attrs.lineHeight !== undefined && attrs.lineHeight !== null) {
    styles["line-height"] = String(attrs.lineHeight);
  }
  return buildStyleString(styles);
}

function openTag(tag: string, attrs?: Record<string, string>): string {
  if (!attrs || Object.keys(attrs).length === 0) {
    return `<${tag}>`;
  }
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(" ");
  return attrStr ? `<${tag} ${attrStr}>` : `<${tag}>`;
}

function closeTag(tag: string): string {
  return `</${tag}>`;
}

/**
 * Convert TipTap JSON document to HTML string
 */
export function tiptapToHTML(json: unknown, options?: TiptapToHtmlOptions): string {
  if (!json || typeof json !== "object") return "";

  const doc = json as TiptapDoc;
  if (doc.type !== "doc" || !doc.content) return "";

  const opts: Required<TiptapToHtmlOptions> = {
    maxChars: options?.maxChars ?? 0,
    excludeImages: options?.excludeImages ?? true,
    includeStyles: options?.includeStyles ?? true,
  };

  let html = "";
  for (const node of doc.content) {
    html += nodeToHtml(node, opts);
  }

  if (opts.maxChars > 0 && html.length > opts.maxChars) {
    const truncated = html.slice(0, opts.maxChars);
    html = truncated + `\n<!-- truncated: ${html.length - opts.maxChars} additional characters -->`;
  }

  return html;
}

function nodeToHtml(node: TiptapNode, opts: Required<TiptapToHtmlOptions>): string {
  const attrs = node.attrs || {};

  switch (node.type) {
    case "heading": {
      const level = Math.min(Math.max((attrs.level as number) || 1, 1), 6);
      const tag = `h${level}`;
      const style = getBlockStyles(attrs, opts.includeStyles);
      const tagAttrs: Record<string, string> = {};
      if (style) tagAttrs.style = style;
      const children = renderChildren(node, opts);
      return openTag(tag, tagAttrs) + children + closeTag(tag);
    }

    case "paragraph": {
      const style = getBlockStyles(attrs, opts.includeStyles);
      const tagAttrs: Record<string, string> = {};
      if (style) tagAttrs.style = style;
      const children = renderChildren(node, opts);
      return openTag("p", tagAttrs) + children + closeTag("p");
    }

    case "bulletList": {
      if (!node.content) return "";
      const children = node.content.map((item) => nodeToHtml(item, opts)).join("");
      return openTag("ul") + children + closeTag("ul");
    }

    case "orderedList": {
      if (!node.content) return "";
      const tagAttrs: Record<string, string> = {};
      if (attrs.start !== undefined && attrs.start !== 1) {
        tagAttrs.start = String(attrs.start);
      }
      const children = node.content.map((item) => nodeToHtml(item, opts)).join("");
      return openTag("ol", tagAttrs) + children + closeTag("ol");
    }

    case "taskList": {
      if (!node.content) return "";
      const children = node.content.map((item) => nodeToHtml(item, opts)).join("");
      return openTag("ul", { "data-type": "taskList" }) + children + closeTag("ul");
    }

    case "listItem": {
      const children = renderChildren(node, opts);
      return openTag("li") + children + closeTag("li");
    }

    case "taskItem": {
      const checked = attrs.checked === true;
      const tagAttrs: Record<string, string> = {
        "data-type": "taskItem",
        "data-checked": String(checked),
      };
      const children = renderChildren(node, opts);
      return openTag("li", tagAttrs) + children + closeTag("li");
    }

    case "codeBlock": {
      const language = (attrs.language as string) || "";
      const codeAttrs: Record<string, string> = {};
      if (language) codeAttrs.class = `language-${language}`;
      const text = getPlainTextContent(node);
      return openTag("pre") + openTag("code", codeAttrs) + escapeHtml(text) + closeTag("code") + closeTag("pre");
    }

    case "blockquote": {
      if (!node.content) return "";
      const children = node.content.map((child) => nodeToHtml(child, opts)).join("");
      return openTag("blockquote") + children + closeTag("blockquote");
    }

    case "image": {
      if (opts.excludeImages) {
        const alt = (attrs.alt as string) || "image";
        return `<p>[Image: ${escapeHtml(alt)}]</p>`;
      }
      const imgAttrs: Record<string, string> = {};
      if (attrs.src) imgAttrs.src = String(attrs.src);
      if (attrs.alt) imgAttrs.alt = String(attrs.alt);
      if (attrs.title) imgAttrs.title = String(attrs.title);
      return openTag("img", imgAttrs);
    }

    case "horizontalRule":
      return "<hr>";

    case "hardBreak":
      return "<br>";

    case "text":
      return renderTextWithMarks(node, opts.includeStyles);

    case "callout": {
      const calloutType = (attrs.type as string) || "info";
      const children = renderChildren(node, opts);
      return openTag("div", { "data-callout-type": calloutType }) + children + closeTag("div");
    }

    case "toggle":
    case "details": {
      if (!node.content || node.content.length === 0) return "";
      const isOpen = attrs.open === true;
      const detailsAttrs: Record<string, string> = {};
      if (isOpen) detailsAttrs.open = "true";

      // First child is summary, rest is content
      const summaryNode = node.content[0];
      const restNodes = node.content.slice(1);

      const summaryHtml = summaryNode
        ? openTag("summary") + renderChildren(summaryNode, opts) + closeTag("summary")
        : "";
      const bodyHtml = restNodes.map((child) => nodeToHtml(child, opts)).join("");

      return openTag("details", detailsAttrs) + summaryHtml + bodyHtml + closeTag("details");
    }

    case "table": {
      if (!node.content) return "";
      const rows = node.content.map((row) => nodeToHtml(row, opts)).join("");
      return openTag("table") + rows + closeTag("table");
    }

    case "tableRow": {
      if (!node.content) return "";
      const cells = node.content.map((cell) => nodeToHtml(cell, opts)).join("");
      return openTag("tr") + cells + closeTag("tr");
    }

    case "tableHeader": {
      const children = renderChildren(node, opts);
      const tagAttrs: Record<string, string> = {};
      if (attrs.colspan && Number(attrs.colspan) > 1) tagAttrs.colspan = String(attrs.colspan);
      if (attrs.rowspan && Number(attrs.rowspan) > 1) tagAttrs.rowspan = String(attrs.rowspan);
      return openTag("th", tagAttrs) + children + closeTag("th");
    }

    case "tableCell": {
      const children = renderChildren(node, opts);
      const tagAttrs: Record<string, string> = {};
      if (attrs.colspan && Number(attrs.colspan) > 1) tagAttrs.colspan = String(attrs.colspan);
      if (attrs.rowspan && Number(attrs.rowspan) > 1) tagAttrs.rowspan = String(attrs.rowspan);
      return openTag("td", tagAttrs) + children + closeTag("td");
    }

    default: {
      // For unknown nodes, try to render children
      if (node.content) {
        return node.content.map((child) => nodeToHtml(child, opts)).join("");
      }
      return "";
    }
  }
}

function renderChildren(node: TiptapNode, opts: Required<TiptapToHtmlOptions>): string {
  if (!node.content) return "";
  return node.content.map((child) => nodeToHtml(child, opts)).join("");
}

function renderTextWithMarks(node: TiptapNode, includeStyles: boolean): string {
  if (!node.text) return "";

  let html = escapeHtml(node.text);
  const marks = node.marks || [];

  // Collect style marks to merge into a single <span>
  const spanStyles: Record<string, string> = {};
  const wrappers: Array<{ open: string; close: string }> = [];

  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        wrappers.push({ open: "<strong>", close: "</strong>" });
        break;
      case "italic":
        wrappers.push({ open: "<em>", close: "</em>" });
        break;
      case "underline":
        wrappers.push({ open: "<u>", close: "</u>" });
        break;
      case "strike":
        wrappers.push({ open: "<s>", close: "</s>" });
        break;
      case "code":
        wrappers.push({ open: "<code>", close: "</code>" });
        break;
      case "subscript":
        wrappers.push({ open: "<sub>", close: "</sub>" });
        break;
      case "superscript":
        wrappers.push({ open: "<sup>", close: "</sup>" });
        break;
      case "link": {
        const href = mark.attrs?.href ? escapeAttr(String(mark.attrs.href)) : "";
        const title = mark.attrs?.title ? ` title="${escapeAttr(String(mark.attrs.title))}"` : "";
        wrappers.push({ open: `<a href="${href}"${title}>`, close: "</a>" });
        break;
      }
      case "textStyle": {
        if (!includeStyles) break;
        const a = mark.attrs || {};
        if (typeof a.color === "string") spanStyles.color = a.color;
        if (typeof a.fontFamily === "string") spanStyles["font-family"] = a.fontFamily;
        if (typeof a.fontSize === "string") spanStyles["font-size"] = a.fontSize;
        break;
      }
      case "highlight": {
        if (!includeStyles) break;
        const bgColor = mark.attrs?.color;
        if (typeof bgColor === "string") {
          wrappers.push({
            open: `<mark style="background-color: ${escapeAttr(bgColor)}">`,
            close: "</mark>",
          });
        } else {
          wrappers.push({ open: "<mark>", close: "</mark>" });
        }
        break;
      }
    }
  }

  // Add span for textStyle if any styles collected
  if (Object.keys(spanStyles).length > 0) {
    const styleStr = buildStyleString(spanStyles);
    wrappers.unshift({ open: `<span style="${escapeAttr(styleStr)}">`, close: "</span>" });
  }

  // Apply wrappers inside-out
  for (const w of wrappers) {
    html = w.open + html + w.close;
  }

  return html;
}

function getPlainTextContent(node: TiptapNode): string {
  if (node.type === "text") return node.text || "";
  if (!node.content) return "";
  return node.content.map(getPlainTextContent).join("");
}
