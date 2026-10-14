/**
 * TipTap JSON to Markdown Converter
 *
 * Converts TipTap/ProseMirror JSON document structure to markdown format.
 * Used for injecting Knowledge page content into AI chat context.
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

export interface TiptapToMarkdownOptions {
  maxChars?: number;
  excludeImages?: boolean;
  includeCodeBlocks?: boolean;
}

export function tiptapToMarkdown(
  json: unknown,
  options?: TiptapToMarkdownOptions,
): string {
  if (!json || typeof json !== "object") return "";

  const doc = json as TiptapDoc;
  if (doc.type !== "doc" || !doc.content) return "";

  let markdown = "";
  for (const node of doc.content) {
    markdown += nodeToMarkdown(node, options);
  }

  if (options?.maxChars && markdown.length > options.maxChars) {
    const truncated = markdown.slice(0, options.maxChars);
    const remaining = markdown.length - options.maxChars;
    markdown =
      truncated + `\n\n... (truncated: ${remaining} additional characters)`;
  }

  return markdown.trim();
}

export function tiptapToPlainText(json: unknown): string {
  if (!json || typeof json !== "object") return "";

  const doc = json as TiptapDoc;
  if (doc.type !== "doc" || !doc.content) return "";

  return doc.content
    .map((node) => extractTextFromNode(node))
    .filter(Boolean)
    .join("\n");
}

function nodeToMarkdown(
  node: TiptapNode,
  options?: TiptapToMarkdownOptions,
): string {
  const attrs = node.attrs || {};

  switch (node.type) {
    case "heading": {
      const level = (attrs.level as number) || 1;
      const text = getTextContent(node);
      return `${"#".repeat(level)} ${text}\n\n`;
    }

    case "paragraph": {
      const text = getTextContent(node);
      return text ? `${text}\n\n` : "\n";
    }

    case "bulletList": {
      if (!node.content) return "";
      return (
        node.content
          .map((item) => {
            const text = getListItemContent(item, options);
            return `- ${text}\n`;
          })
          .join("") + "\n"
      );
    }

    case "orderedList": {
      if (!node.content) return "";
      return (
        node.content
          .map((item, index) => {
            const text = getListItemContent(item, options);
            return `${index + 1}. ${text}\n`;
          })
          .join("") + "\n"
      );
    }

    case "taskList": {
      if (!node.content) return "";
      return (
        node.content
          .map((item) => {
            const checked = item.attrs?.checked ? "x" : " ";
            const text = getListItemContent(item, options);
            return `- [${checked}] ${text}\n`;
          })
          .join("") + "\n"
      );
    }

    case "listItem":
    case "taskItem": {
      return "";
    }

    case "codeBlock": {
      if (options?.includeCodeBlocks === false) {
        return "";
      }
      const language = (attrs.language as string) || "";
      const text = getTextContent(node);
      return `\`\`\`${language}\n${text}\n\`\`\`\n\n`;
    }

    case "blockquote": {
      if (!node.content) return "";
      const content = node.content
        .map((child) => nodeToMarkdown(child, options))
        .join("")
        .trim();
      const quoted = content
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return quoted + "\n\n";
    }

    case "image": {
      const shouldExcludeImages = options?.excludeImages ?? true;
      if (shouldExcludeImages) {
        const alt = (attrs.alt as string) || "image";
        return `[Image: ${alt}]\n\n`;
      }
      const src = attrs.src as string;
      const alt = (attrs.alt as string) || "";
      return `![${alt}](${src})\n\n`;
    }

    case "horizontalRule":
      return "---\n\n";

    case "hardBreak":
      return "\n";

    case "text":
      return formatTextWithMarks(node);

    default:
      if (node.content) {
        return node.content
          .map((child) => nodeToMarkdown(child, options))
          .join("");
      }
      return "";
  }
}

function getTextContent(node: TiptapNode): string {
  if (!node.content) return node.text || "";

  return node.content
    .map((child) => {
      if (child.type === "text") {
        return formatTextWithMarks(child);
      }
      if (child.type === "hardBreak") {
        return "\n";
      }
      return getTextContent(child);
    })
    .join("");
}

function getListItemContent(
  item: TiptapNode,
  options?: TiptapToMarkdownOptions,
): string {
  if (!item.content) return "";

  return item.content
    .map((child) => {
      if (child.type === "paragraph") {
        return getTextContent(child);
      }
      if (
        child.type === "bulletList" ||
        child.type === "orderedList" ||
        child.type === "taskList"
      ) {
        const nestedItems = child.content || [];
        const nestedMarkdown = nestedItems
          .map((nestedItem, index) => {
            const text = getListItemContent(nestedItem, options);
            if (child.type === "orderedList") {
              return `  ${index + 1}. ${text}`;
            }
            if (child.type === "taskList") {
              const checked = nestedItem.attrs?.checked ? "x" : " ";
              return `  - [${checked}] ${text}`;
            }
            return `  - ${text}`;
          })
          .join("\n");
        return "\n" + nestedMarkdown;
      }
      return getTextContent(child);
    })
    .join("");
}

function formatTextWithMarks(node: TiptapNode): string {
  if (!node.text) return "";

  let text = node.text;
  const marks = node.marks || [];

  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        text = `**${text}**`;
        break;
      case "italic":
        text = `*${text}*`;
        break;
      case "code":
        text = `\`${text}\``;
        break;
      case "strike":
        text = `~~${text}~~`;
        break;
      case "link": {
        const href = mark.attrs?.href || "";
        text = `[${text}](${href})`;
        break;
      }
    }
  }

  return text;
}

function extractTextFromNode(node: TiptapNode): string {
  if (node.type === "text") {
    return node.text || "";
  }

  if (!node.content) return "";

  return node.content
    .map((child) => extractTextFromNode(child))
    .filter(Boolean)
    .join(" ");
}

export interface ExtractedImage {
  src: string;
  alt: string;
  mimeType: string;
  byteSize: number;
}

/** Raster formats every supported provider accepts; anything else (SVG, PDF, …) is refused. */
export const ALLOWED_IMAGE_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Strict: allow-listed type and canonical padded base64, so a malformed payload is never sent to a provider. */
export function parseImageDataUri(src: string): { mimeType: string; base64: string; byteSize: number } | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if (!match) return null;
  const mimeType = (match[1] ?? "").toLowerCase();
  const base64 = match[2] ?? "";
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType) || base64.length % 4 !== 0) return null;
  const byteSize = (base64.length * 3) / 4 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  return { mimeType, base64, byteSize };
}

function collectImagesFromNode(node: TiptapNode, out: ExtractedImage[], onUnsupported?: () => void): void {
  if (node.type === "image") {
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
    // Only inline data images are sent: a URL or path would need a fetch or file read.
    const parsed = parseImageDataUri(src);
    if (parsed) {
      out.push({
        src,
        alt: (node.attrs?.alt as string) || "image",
        mimeType: parsed.mimeType,
        byteSize: parsed.byteSize,
      });
    } else {
      onUnsupported?.();
    }
    return;
  }

  if (node.content) {
    for (const child of node.content) {
      collectImagesFromNode(child, out, onUnsupported);
    }
  }
}

export function extractImagesFromTiptap(json: unknown, onUnsupported?: () => void): ExtractedImage[] {
  if (!json || typeof json !== "object") return [];

  const doc = json as TiptapDoc;
  if (doc.type !== "doc" || !doc.content) return [];

  const images: ExtractedImage[] = [];
  for (const node of doc.content) {
    collectImagesFromNode(node, images, onUnsupported);
  }
  return images;
}
