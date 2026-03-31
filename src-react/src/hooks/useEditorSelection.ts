/**
 * useEditorSelection Hook
 *
 * Tracks Tiptap editor selection (from/to positions and selected text).
 * Used for AI content editing with selection mode.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";

export interface EditorSelection {
  /** Start position (character offset in document) */
  from: number;
  /** End position */
  to: number;
  /** Selected text (if any) */
  selectedText: string;
  /** Whether there's an active selection (from !== to) */
  hasSelection: boolean;
  /** Whether selection is empty (no content) */
  isEmpty: boolean;
}

export interface UseEditorSelectionReturn {
  /** Current selection state */
  selection: EditorSelection;
  /** Update selection from editor */
  updateSelection: () => void;
  /** Clear selection tracking */
  clearSelection: () => void;
  /** Get selection suitable for content editor API */
  getSelectionForEdit: () => { type: "tiptap"; from: number; to: number; selectedText?: string } | null;
}

const EMPTY_SELECTION: EditorSelection = {
  from: 0,
  to: 0,
  selectedText: "",
  hasSelection: false,
  isEmpty: true,
};

/**
 * Hook to track Tiptap editor selection
 *
 * @param editor - Tiptap Editor instance (can be null while loading)
 */
export function useEditorSelection(editor: Editor | null): UseEditorSelectionReturn {
  const [selection, setSelection] = useState<EditorSelection>(EMPTY_SELECTION);
  const editorRef = useRef<Editor | null>(null);

  // Update ref when editor changes
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const updateSelection = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) {
      setSelection(EMPTY_SELECTION);
      return;
    }

    const { from, to } = currentEditor.state.selection;
    const hasSelection = from !== to;

    // Get selected text
    let selectedText = "";
    if (hasSelection) {
      selectedText = currentEditor.state.doc.textBetween(from, to, " ");
    }

    setSelection({
      from,
      to,
      selectedText,
      hasSelection,
      isEmpty: !selectedText.trim(),
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(EMPTY_SELECTION);
  }, []);

  const getSelectionForEdit = useCallback(() => {
    if (!selection.hasSelection || selection.isEmpty) {
      return null;
    }

    return {
      type: "tiptap" as const,
      from: selection.from,
      to: selection.to,
      selectedText: selection.selectedText || undefined,
    };
  }, [selection]);

  // Subscribe to editor selection changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      setSelection(EMPTY_SELECTION);
      return;
    }

    // Initial update
    updateSelection();

    // Listen for selection changes via transaction
    const handleUpdate = () => {
      updateSelection();
    };

    editor.on("selectionUpdate", handleUpdate);
    editor.on("transaction", handleUpdate);

    return () => {
      editor.off("selectionUpdate", handleUpdate);
      editor.off("transaction", handleUpdate);
    };
  }, [editor, updateSelection]);

  return {
    selection,
    updateSelection,
    clearSelection,
    getSelectionForEdit,
  };
}
