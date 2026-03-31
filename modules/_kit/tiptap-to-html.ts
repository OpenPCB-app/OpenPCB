/**
 * TipTap JSON to HTML Converter (shared module utility)
 *
 * Pure function, zero dependencies — safe for use in both React and TS module contexts.
 * Mirrors src-ts/src/domain/utils/tiptap-to-html.ts.
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

export function tiptapToHTML(json: unknown, options?: TiptapToHtmlOptions): string {
  if (!json || typeof json !== "object") return "";

  const doc = json as TiptapDoc;
  if (doc.type !== "doc" || !doc.content) return "";

  const opts = {
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

function nodeToHtml(node: TiptapNode, opts: { maxChars: number; excludeImages: boolean; includeStyles: boolean }): string {
  const attrs = node.attrs || {};

  switch (node.type) {
    case "heading": {
      const level = Math.min(Math.max((attrs.level as number) || 1, 1), 6);
      const tag = `h${level}`;
      const style = getBlockStyles(attrs, opts.includeStyles);
      const tagAttrs: Record<string, string> = {};
      if (style) tagAttrs.style = style;
      return openTag(tag, tagAttrs) + renderChildren(node, opts) + closeTag(tag);
    }

    case "paragraph": {
      const style = getBlockStyles(attrs, opts.includeStyles);
      const tagAttrs: Record<string, string> = {};
      if (style) tagAttrs.style = style;
      return openTag("p", tagAttrs) + renderChildren(node, opts) + closeTag("p");
    }

    case "bulletList": {
      if (!node.content) return "";
      return openTag("ul") + node.content.map((item) => nodeToHtml(item, opts)).join("") + closeTag("ul");
    }

    case "orderedList": {
      if (!node.content) return "";
      const tagAttrs: Record<string, string> = {};
      if (attrs.start !== undefined && attrs.start !== 1) tagAttrs.start = String(attrs.start);
      return openTag("ol", tagAttrs) + node.content.map((item) => nodeToHtml(item, opts)).join("") + closeTag("ol");
    }

    case "taskList": {
      if (!node.content) return "";
      return openTag("ul", { "data-type": "taskList" }) + node.content.map((item) => nodeToHtml(item, opts)).join("") + closeTag("ul");
    }

    case "listItem":
      return openTag("li") + renderChildren(node, opts) + closeTag("li");

    case "taskItem": {
      const checked = attrs.checked === true;
      return openTag("li", { "data-type": "taskItem", "data-checked": String(checked) }) + renderChildren(node, opts) + closeTag("li");
    }

    case "codeBlock": {
      const language = (attrs.language as string) || "";
      const codeAttrs: Record<string, string> = {};
      if (language) codeAttrs.class = `language-${language}`;
      const text = getPlainText(node);
      return openTag("pre") + openTag("code", codeAttrs) + escapeHtml(text) + closeTag("code") + closeTag("pre");
    }

    case "blockquote": {
      if (!node.content) return "";
      return openTag("blockquote") + node.content.map((child) => nodeToHtml(child, opts)).join("") + closeTag("blockquote");
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
      return openTag("div", { "data-callout-type": calloutType }) + renderChildren(node, opts) + closeTag("div");
    }

    case "toggle":
    case "details": {
      if (!node.content || node.content.length === 0) return "";
      const isOpen = attrs.open === true;
      const detailsAttrs: Record<string, string> = {};
      if (isOpen) detailsAttrs.open = "true";
      const summaryNode = node.content[0];
      const restNodes = node.content.slice(1);
      const summaryHtml = summaryNode ? openTag("summary") + renderChildren(summaryNode, opts) + closeTag("summary") : "";
      const bodyHtml = restNodes.map((child) => nodeToHtml(child, opts)).join("");
      return openTag("details", detailsAttrs) + summaryHtml + bodyHtml + closeTag("details");
    }

    case "table": {
      if (!node.content) return "";
      return openTag("table") + node.content.map((row) => nodeToHtml(row, opts)).join("") + closeTag("table");
    }

    case "tableRow": {
      if (!node.content) return "";
      return openTag("tr") + node.content.map((cell) => nodeToHtml(cell, opts)).join("") + closeTag("tr");
    }

    case "tableHeader": {
      const tagAttrs: Record<string, string> = {};
      if (attrs.colspan && Number(attrs.colspan) > 1) tagAttrs.colspan = String(attrs.colspan);
      if (attrs.rowspan && Number(attrs.rowspan) > 1) tagAttrs.rowspan = String(attrs.rowspan);
      return openTag("th", tagAttrs) + renderChildren(node, opts) + closeTag("th");
    }

    case "tableCell": {
      const tagAttrs: Record<string, string> = {};
      if (attrs.colspan && Number(attrs.colspan) > 1) tagAttrs.colspan = String(attrs.colspan);
      if (attrs.rowspan && Number(attrs.rowspan) > 1) tagAttrs.rowspan = String(attrs.rowspan);
      return openTag("td", tagAttrs) + renderChildren(node, opts) + closeTag("td");
    }

    default: {
      if (node.content) return node.content.map((child) => nodeToHtml(child, opts)).join("");
      return "";
    }
  }
}

function renderChildren(node: TiptapNode, opts: { maxChars: number; excludeImages: boolean; includeStyles: boolean }): string {
  if (!node.content) return "";
  return node.content.map((child) => nodeToHtml(child, opts)).join("");
}

function renderTextWithMarks(node: TiptapNode, includeStyles: boolean): string {
  if (!node.text) return "";

  let html = escapeHtml(node.text);
  const marks = node.marks || [];

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
          wrappers.push({ open: `<mark style="background-color: ${escapeAttr(bgColor)}">`, close: "</mark>" });
        } else {
          wrappers.push({ open: "<mark>", close: "</mark>" });
        }
        break;
      }
    }
  }

  if (Object.keys(spanStyles).length > 0) {
    const styleStr = buildStyleString(spanStyles);
    wrappers.unshift({ open: `<span style="${escapeAttr(styleStr)}">`, close: "</span>" });
  }

  for (const w of wrappers) {
    html = w.open + html + w.close;
  }

  return html;
}

function getPlainText(node: TiptapNode): string {
  if (node.type === "text") return node.text || "";
  if (!node.content) return "";
  return node.content.map(getPlainText).join("");
}
