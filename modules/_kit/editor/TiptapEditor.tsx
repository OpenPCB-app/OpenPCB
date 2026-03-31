import { useEffect, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { useDebouncedCallback } from "use-debounce";
import { useTheme } from "@/components/ThemeProvider";
import type { EditorContent as EditorContentType } from "./types";
import { slashCommandSuggestion } from "./SlashCommand";
import { BubbleMenu } from "./BubbleMenu";
import { DragHandle } from "./DragHandle";
import { Callout } from "./extensions/Callout";
import { Toggle } from "./extensions/Toggle";
import { BlockSelection } from "./extensions/BlockSelection";
import type { ContentSelection } from "@/hooks/useContentEditor";

interface TiptapEditorProps {
  /** Initial content to load */
  initialContent?: EditorContentType;
  /** Callback when content changes (debounced) */
  onChange?: (content: EditorContentType) => void;
  /** Callback when editor is ready */
  onReady?: (editor: import("@tiptap/react").Editor) => void;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Debounce delay in ms (default: 1000) */
  debounceMs?: number;
  /** Callback to open link dialog */
  onLinkClick?: () => void;
  /** Callback to trigger AI edit for selection */
  onAiEdit?: (selection: ContentSelection) => void;
}

/**
 * TiptapEditor Component
 *
 * Wraps Tiptap's React editor with OpenPCB integration:
 * - Debounced onChange for autosave
 * - Pure Tailwind CSS styling
 * - Type-safe EditorContent format
 * - Dynamic theme support
 * - Exposes editor instance for external toolbar control
 */
export function TiptapEditor({
  initialContent,
  onChange,
  onReady,
  readOnly = false,
  debounceMs = 1000,
  onLinkClick,
  onAiEdit,
}: TiptapEditorProps) {
  const { mode } = useTheme();
  const isDark = mode === "dark";

  // Debounced save handler
  const debouncedSave = useDebouncedCallback(
    useCallback(
      (json: unknown) => {
        if (!onChange) return;
        onChange({
          engine: "tiptap",
          version: 1,
          data: json,
        });
      },
      [onChange],
    ),
    debounceMs,
  );

  // Create SlashCommand extension
  const SlashCommand = Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: "/",
          ...slashCommandSuggestion,
        }),
      ];
    },
  });

  // Custom keyboard shortcuts extension
  const KeyboardShortcuts = Extension.create({
    name: "keyboardShortcuts",
    addKeyboardShortcuts() {
      return {
        // Block conversion shortcuts
        "Mod-Alt-0": () =>
          this.editor.chain().focus().setNode("paragraph").run(),
        "Mod-Alt-1": () =>
          this.editor.chain().focus().toggleHeading({ level: 1 }).run(),
        "Mod-Alt-2": () =>
          this.editor.chain().focus().toggleHeading({ level: 2 }).run(),
        "Mod-Alt-3": () =>
          this.editor.chain().focus().toggleHeading({ level: 3 }).run(),
        // List shortcuts
        "Mod-Shift-7": () =>
          this.editor.chain().focus().toggleOrderedList().run(),
        "Mod-Shift-8": () =>
          this.editor.chain().focus().toggleBulletList().run(),
        "Mod-Shift-9": () => this.editor.chain().focus().toggleTaskList().run(),
        // Duplicate block
        "Mod-d": () => {
          const { from, to } = this.editor.state.selection;
          const content = this.editor.state.doc.slice(from, to);
          return this.editor
            .chain()
            .focus()
            .insertContentAt(to, content.content.toJSON())
            .run();
        },
      };
    },
  });

  // Create editor instance with extensions
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: {
          HTMLAttributes: {
            class: "tiptap-code-block",
          },
        },
        blockquote: {
          HTMLAttributes: {
            class: "tiptap-blockquote",
          },
        },
        bulletList: {
          HTMLAttributes: {
            class: "tiptap-bullet-list",
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: "tiptap-ordered-list",
          },
        },
        listItem: {
          HTMLAttributes: {
            class: "tiptap-list-item",
          },
        },
        horizontalRule: {
          HTMLAttributes: {
            class: "tiptap-hr",
          },
        },
      }),
      Placeholder.configure({
        placeholder: "Start typing, or press '/' for commands...",
        emptyEditorClass: "tiptap-empty",
      }),
      TaskList.configure({
        HTMLAttributes: {
          class: "tiptap-task-list",
        },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class: "tiptap-task-item",
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: "tiptap-image",
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "tiptap-link",
        },
      }),
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      Callout,
      Toggle,
      BlockSelection,
      SlashCommand,
      KeyboardShortcuts,
    ],
    content: (() => {
      const data = initialContent?.data;
      if (data && typeof data === "object" && "type" in data) {
        return data as object;
      }
      // Fallback for empty or invalid content
      return { type: "doc", content: [{ type: "paragraph" }] };
    })(),
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      debouncedSave(json);
    },
    onCreate: ({ editor }) => {
      requestAnimationFrame(() => {
        onReady?.(editor);
      });
    },
    editorProps: {
      attributes: {
        class: `tiptap-editor w-full max-w-none focus:outline-none text-foreground ${isDark ? "dark" : ""}`,
      },
    },
  });

  // Sync content when initialContent changes (page switch)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    // Skip if content is the same (avoid cursor jump)
    const newData = initialContent?.data;
    const currentData = editor.getJSON();

    // Simple deep compare - if data is different, update editor
    if (JSON.stringify(newData) !== JSON.stringify(currentData)) {
      // Use setTimeout to avoid race condition with editor creation
      queueMicrotask(() => {
        if (!editor.isDestroyed) {
          editor.commands.setContent(
            (newData as object) || {
              type: "doc",
              content: [{ type: "paragraph" }],
            },
            { emitUpdate: false }, // emitUpdate = false to prevent loops
          );
        }
      });
    }
  }, [initialContent, editor]);

  // Update editable state when readOnly changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly);
    }
  }, [editor, readOnly]);

  // Flush pending saves on unmount
  useEffect(() => {
    return () => {
      debouncedSave.flush();
    };
  }, [debouncedSave]);

  // Clean up editor on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  if (!editor) {
    return null;
  }

  return (
    <div
      className={`tiptap-wrapper ${isDark ? "dark" : ""}`}
      data-theme={isDark ? "dark" : "light"}
    >
      <BubbleMenu
        editor={editor}
        onLinkClick={onLinkClick || (() => {})}
        onAiEdit={onAiEdit}
      />
      <DragHandle editor={editor} />
      {/* Editor Styles - Tailwind CSS */}
      <style>{`
        .tiptap-wrapper {
          height: 100%;
          width: 100%;
        }

        .tiptap-editor {
          min-height: 200px;
          font-size: 1rem;
          line-height: 1.75;
          color: hsl(var(--foreground));
        }

        .tiptap-editor:focus {
          outline: none;
        }

        /* Headings */
        .tiptap-editor h1 {
          font-size: 2rem;
          font-weight: 700;
          line-height: 1.2;
          margin-top: 1.5rem;
          margin-bottom: 0.5rem;
        }

        .tiptap-editor h2 {
          font-size: 1.5rem;
          font-weight: 600;
          line-height: 1.3;
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
        }

        .tiptap-editor h3 {
          font-size: 1.25rem;
          font-weight: 600;
          line-height: 1.4;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }

        /* Paragraph */
        .tiptap-editor p {
          margin-bottom: 0.75rem;
        }

        /* Lists */
        .tiptap-bullet-list,
        .tiptap-ordered-list {
          padding-left: 1.5rem;
          margin-bottom: 0.75rem;
        }

        .tiptap-bullet-list {
          list-style-type: disc;
        }

        .tiptap-ordered-list {
          list-style-type: decimal;
        }

        .tiptap-list-item {
          margin-bottom: 0.25rem;
        }

        /* Task List */
        .tiptap-task-list {
          list-style: none;
          padding-left: 0;
          margin-bottom: 0.75rem;
        }

        .tiptap-task-item {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          margin-bottom: 0.25rem;
        }

        .tiptap-task-item > label {
          flex-shrink: 0;
          margin-top: 0.25rem;
        }

        .tiptap-task-item > label > input[type="checkbox"] {
          width: 1rem;
          height: 1rem;
          accent-color: hsl(var(--primary));
          cursor: pointer;
        }

        .tiptap-task-item[data-checked="true"] > div {
          text-decoration: line-through;
          opacity: 0.6;
        }

        /* Code Block */
        .tiptap-code-block {
          background: hsl(var(--muted) / 0.5);
          border-radius: 0.5rem;
          font-family: ui-monospace, monospace;
          font-size: 0.875rem;
          padding: 1rem;
          overflow-x: auto;
          margin-bottom: 0.75rem;
        }

        .tiptap-code-block code {
          background: transparent;
          color: inherit;
          padding: 0;
          font-size: inherit;
        }

        /* Inline Code */
        .tiptap-editor code:not(.tiptap-code-block code) {
          background: hsl(var(--muted) / 0.5);
          border-radius: 0.25rem;
          font-family: ui-monospace, monospace;
          font-size: 0.875em;
          padding: 0.125rem 0.375rem;
        }

        /* Blockquote */
        .tiptap-blockquote {
          background: hsl(var(--muted) / 0.3);
          border-left: 4px solid hsl(var(--primary));
          border-radius: 0 0.5rem 0.5rem 0;
          padding: 0.75rem 1rem;
          margin: 0.5rem 0 0.75rem 0;
        }

        /* Horizontal Rule */
        .tiptap-hr {
          border: none;
          border-top: 1px solid hsl(var(--border));
          margin: 1.5rem 0;
        }

        /* Links */
        .tiptap-link {
          color: hsl(var(--primary));
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        .tiptap-link:hover {
          color: hsl(var(--primary) / 0.8);
        }

        /* Images */
        .tiptap-image {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
          margin: 0.5rem 0;
        }

        /* Bold, Italic, Strikethrough */
        .tiptap-editor strong {
          font-weight: 700;
        }

        .tiptap-editor em {
          font-style: italic;
        }

        .tiptap-editor s {
          text-decoration: line-through;
        }

        /* Callout */
        .tiptap-callout {
          border-radius: 0.5rem;
          padding: 1rem;
          margin: 0.75rem 0;
          border-left: 4px solid;
        }

        .tiptap-callout[data-callout-type="info"] {
          background: hsl(210 100% 97%);
          border-color: hsl(210 100% 50%);
        }

        .dark .tiptap-callout[data-callout-type="info"] {
          background: hsl(210 100% 10%);
          border-color: hsl(210 100% 40%);
        }

        .tiptap-callout[data-callout-type="warning"] {
          background: hsl(38 100% 97%);
          border-color: hsl(38 100% 50%);
        }

        .dark .tiptap-callout[data-callout-type="warning"] {
          background: hsl(38 100% 10%);
          border-color: hsl(38 100% 40%);
        }

        .tiptap-callout[data-callout-type="error"] {
          background: hsl(0 100% 97%);
          border-color: hsl(0 100% 50%);
        }

        .dark .tiptap-callout[data-callout-type="error"] {
          background: hsl(0 100% 10%);
          border-color: hsl(0 100% 40%);
        }

        .tiptap-callout[data-callout-type="success"] {
          background: hsl(142 76% 97%);
          border-color: hsl(142 76% 36%);
        }

        .dark .tiptap-callout[data-callout-type="success"] {
          background: hsl(142 76% 10%);
          border-color: hsl(142 76% 30%);
        }

        /* Toggle */
        .tiptap-toggle {
          border: 1px solid hsl(var(--border));
          border-radius: 0.5rem;
          padding: 0;
          margin: 0.75rem 0;
        }

        .tiptap-toggle-summary {
          font-weight: 600;
          padding: 0.75rem 1rem;
          cursor: pointer;
          user-select: none;
        }

        .tiptap-toggle-summary:hover {
          background: hsl(var(--muted) / 0.3);
        }

        .tiptap-toggle[open] .tiptap-toggle-summary {
          border-bottom: 1px solid hsl(var(--border));
        }

        .tiptap-toggle-content {
          padding: 1rem;
        }

        /* Placeholder */
        .tiptap-empty:first-child::before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground) / 0.5);
          font-style: italic;
          pointer-events: none;
          position: absolute;
        }

        .tiptap-editor p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground) / 0.5);
          font-style: italic;
          pointer-events: none;
          float: left;
          height: 0;
        }

        /* Selection */
        .tiptap-editor ::selection {
          background: hsl(212 95% 68% / 0.35);
        }

        .dark .tiptap-editor ::selection {
          background: hsl(212 95% 55% / 0.45);
        }

        .tiptap-editor *::selection {
          background: hsl(212 95% 68% / 0.35);
        }

        .dark .tiptap-editor *::selection {
          background: hsl(212 95% 55% / 0.45);
        }

        /* Drag Handle */
        .drag-handle-wrapper {
          position: fixed;
          opacity: 0;
          transition: opacity 0.15s ease;
          z-index: 50;
        }

        .tiptap-editor:hover .drag-handle-wrapper,
        .drag-handle-wrapper:hover {
          opacity: 1;
        }

        .block-selected {
          background: hsl(var(--primary) / 0.1);
          border-radius: 0.25rem;
          outline: 2px solid hsl(var(--primary) / 0.3);
          outline-offset: 2px;
        }

        /* Responsive */
        @media (max-width: 640px) {
          .tiptap-editor {
            font-size: 0.9375rem;
          }

          .tiptap-editor h1 {
            font-size: 1.5rem;
          }

          .tiptap-editor h2 {
            font-size: 1.25rem;
          }

          .tiptap-editor h3 {
            font-size: 1.125rem;
          }
        }
      `}</style>
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * Helper to check if content is empty
 */
export function isEmptyContent(content?: EditorContentType): boolean {
  if (!content?.data) return true;

  const data = content.data as { type?: string; content?: unknown[] };
  if (!data || typeof data !== "object") return true;

  // Tiptap stores content as { type: "doc", content: [...] }
  if (data.type === "doc") {
    const docContent = data.content;
    if (!docContent || !Array.isArray(docContent) || docContent.length === 0)
      return true;

    // Check if it's just an empty paragraph
    if (docContent.length === 1) {
      const firstNode = docContent[0] as { type?: string; content?: unknown[] };
      if (firstNode.type === "paragraph") {
        if (!firstNode.content || firstNode.content.length === 0) {
          return true;
        }
      }
    }
  }

  // BlockNote format fallback (for backwards compatibility)
  if (Array.isArray(content.data)) {
    const blocks = content.data;
    if (blocks.length === 0) return true;
    if (blocks.length === 1) {
      const block = blocks[0] as { type?: string; content?: unknown[] };
      if (block.type === "paragraph") {
        if (
          !block.content ||
          (Array.isArray(block.content) && block.content.length === 0)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}
