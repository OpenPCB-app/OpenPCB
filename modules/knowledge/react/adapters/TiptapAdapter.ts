import type {
  EditorEngineAdapter,
  EditorInstance,
  RenderOptions,
} from "./EditorEngineAdapter";

/**
 * Tiptap ProseMirror Node interface
 */
interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

/**
 * Tiptap Document structure
 */
interface TiptapDoc {
  type: "doc";
  content?: TiptapNode[];
}

/**
 * Empty document for new pages
 */
export const EMPTY_TIPTAP_DOCUMENT: TiptapDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
    },
  ],
};

/**
 * Tiptap Editor Adapter
 *
 * Implements EditorEngineAdapter for Tiptap (ProseMirror-based).
 * Handles conversion between Tiptap's JSON format and markdown.
 */
export class TiptapAdapter implements EditorEngineAdapter {
  private editorInstances: Map<string, unknown> = new Map();

  createEditor(initialContent?: unknown): EditorInstance {
    const id = crypto.randomUUID();
    const content = initialContent ?? EMPTY_TIPTAP_DOCUMENT;
    this.editorInstances.set(id, content);
    return { id, document: content };
  }

  destroyEditor(editor: EditorInstance): void {
    this.editorInstances.delete(editor.id);
  }

  getContentJson(editor: EditorInstance): unknown {
    return editor.document;
  }

  setContentJson(editor: EditorInstance, json: unknown): void {
    editor.document = json;
    this.editorInstances.set(editor.id, json);
  }

  renderToMarkdown(json: unknown, options?: RenderOptions): string {
    if (!json || typeof json !== "object") return "";

    const doc = json as TiptapDoc;
    if (doc.type !== "doc" || !doc.content) return "";

    let markdown = "";
    for (const node of doc.content) {
      markdown += this.nodeToMarkdown(node, options);
    }

    // Apply max chars limit if specified
    if (options?.maxChars && markdown.length > options.maxChars) {
      const truncated = markdown.slice(0, options.maxChars);
      const remaining = markdown.length - options.maxChars;
      markdown = truncated + `\n\n... (truncated: ${remaining.toLocaleString()} additional characters)`;
    }

    return markdown;
  }

  getPlainText(json: unknown): string {
    if (!json || typeof json !== "object") return "";

    const doc = json as TiptapDoc;
    if (doc.type !== "doc" || !doc.content) return "";

    return doc.content
      .map((node) => this.extractTextFromNode(node))
      .filter(Boolean)
      .join("\n");
  }

  validate(json: unknown): boolean {
    try {
      if (!json || typeof json !== "object") return false;
      const doc = json as TiptapDoc;
      if (doc.type !== "doc") return false;
      if (!doc.content) return true; // Empty doc is valid
      return doc.content.every((node) => this.isValidNode(node));
    } catch {
      return false;
    }
  }

  getWordCount(json: unknown): number {
    const text = this.getPlainText(json);
    return text.split(/\s+/).filter(Boolean).length;
  }

  // ============================================
  // Private Helpers
  // ============================================

  private nodeToMarkdown(node: TiptapNode, options?: RenderOptions): string {
    const attrs = node.attrs || {};

    switch (node.type) {
      case "heading": {
        const level = (attrs.level as number) || 1;
        const text = this.getTextContent(node);
        return `${"#".repeat(level)} ${text}\n\n`;
      }

      case "paragraph": {
        const text = this.getTextContent(node);
        return text ? `${text}\n\n` : "\n";
      }

      case "bulletList": {
        if (!node.content) return "";
        return (
          node.content
            .map((item) => {
              const text = this.getListItemContent(item);
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
              const text = this.getListItemContent(item);
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
              const text = this.getListItemContent(item);
              return `- [${checked}] ${text}\n`;
            })
            .join("") + "\n"
        );
      }

      case "listItem":
      case "taskItem": {
        // These are handled by their parent lists
        return "";
      }

      case "codeBlock": {
        if (options?.includeCodeBlocks === false) {
          return "";
        }
        const language = (attrs.language as string) || "";
        const text = this.getTextContent(node);
        return `\`\`\`${language}\n${text}\n\`\`\`\n\n`;
      }

      case "blockquote": {
        if (!node.content) return "";
        const content = node.content
          .map((child) => this.nodeToMarkdown(child, options))
          .join("")
          .trim();
        const quoted = content
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        return quoted + "\n\n";
      }

      case "image": {
        if (options?.excludeImages) {
          const alt = (attrs.alt as string) || "image";
          return `![${alt}](inline-image:omitted)\n\n`;
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
        return this.formatTextWithMarks(node);

      default:
        // For unknown nodes, try to extract text content
        if (node.content) {
          return node.content.map((child) => this.nodeToMarkdown(child, options)).join("");
        }
        return "";
    }
  }

  private getTextContent(node: TiptapNode): string {
    if (!node.content) return node.text || "";

    return node.content
      .map((child) => {
        if (child.type === "text") {
          return this.formatTextWithMarks(child);
        }
        if (child.type === "hardBreak") {
          return "\n";
        }
        return this.getTextContent(child);
      })
      .join("");
  }

  private getListItemContent(item: TiptapNode): string {
    if (!item.content) return "";

    return item.content
      .map((child) => {
        if (child.type === "paragraph") {
          return this.getTextContent(child);
        }
        if (child.type === "bulletList" || child.type === "orderedList" || child.type === "taskList") {
          // Nested list - indent
          const nestedItems = child.content || [];
          const nestedMarkdown = nestedItems
            .map((nestedItem, index) => {
              const text = this.getListItemContent(nestedItem);
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
        return this.getTextContent(child);
      })
      .join("");
  }

  private formatTextWithMarks(node: TiptapNode): string {
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
        case "link":
          const href = mark.attrs?.href || "";
          text = `[${text}](${href})`;
          break;
      }
    }

    return text;
  }

  private extractTextFromNode(node: TiptapNode): string {
    if (node.type === "text") {
      return node.text || "";
    }

    if (!node.content) return "";

    return node.content
      .map((child) => this.extractTextFromNode(child))
      .filter(Boolean)
      .join(" ");
  }

  private isValidNode(node: TiptapNode): boolean {
    if (!node || typeof node !== "object") return false;
    if (!node.type || typeof node.type !== "string") return false;

    // Recursively validate content
    if (node.content && Array.isArray(node.content)) {
      return node.content.every((child) => this.isValidNode(child));
    }

    return true;
  }
}

/**
 * Singleton instance for use in components
 */
export const tiptapAdapter = new TiptapAdapter();
