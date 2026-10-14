import { useEffect, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { createKnowledgeEditorExtensions } from "./tiptap-extensions";
import type { EditorContent as EditorContentType } from "../../../shared/types";

interface TiptapEditorProps {
  initialContent?: EditorContentType;
  onChange?: (content: EditorContentType) => void;
  /** `null` on unmount, with the departing editor so owners can drop it by identity. */
  onReady?: (editor: Editor | null, departed?: Editor) => void;
  readOnly?: boolean;
}

function isEmptyContent(content?: EditorContentType): boolean {
  if (!content?.data) return true;
  const data = content.data as { type?: string; content?: unknown[] };
  if (!data || typeof data !== "object") return true;
  if (data.type === "doc") {
    if (!Array.isArray(data.content) || data.content.length === 0) return true;
    if (data.content.length === 1) {
      const first = data.content[0] as { type?: string; content?: unknown[] };
      if (first.type === "paragraph" && !first.content?.length) return true;
    }
  }
  return false;
}

export function TiptapEditor({
  initialContent,
  onChange,
  onReady,
  readOnly = false,
}: TiptapEditorProps) {
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: createKnowledgeEditorExtensions(),
    content: (() => {
      const data = initialContent?.data;
      if (data && typeof data === "object" && "type" in data) {
        return data as object;
      }
      return { type: "doc", content: [{ type: "paragraph" }] };
    })(),
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor }) => {
      onChangeRef.current?.({
        engine: "tiptap",
        version: 1,
        data: editor.getJSON(),
      });
    },
    onCreate: ({ editor }) => {
      onReadyRef.current?.(editor);
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert focus:outline-none mx-auto max-w-[46rem] px-6 py-8 min-h-[200px]",
      },
    },
  });

  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable !== !readOnly) {
      editor.setEditable(!readOnly, false);
    }
  }, [editor, readOnly]);

  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    return () => {
      onReadyRef.current?.(null, editorRef.current ?? undefined);
    };
  }, []);

  if (!editor) {
    return null;
  }

  return (
    <div className="h-full w-full">
      <EditorContent editor={editor} />
    </div>
  );
}

export { isEmptyContent };
