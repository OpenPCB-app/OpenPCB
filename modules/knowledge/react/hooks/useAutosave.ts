import { useCallback, useRef, useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import type { EditorContent } from "@modules/knowledge/shared/types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface UseAutosaveOptions {
  /** Identifier for the current save target (e.g. page ID) */
  saveKey: string;
  /** Debounce delay in milliseconds */
  debounceMs?: number;
  /** Callback when save is triggered */
  onSave: (content: EditorContent, saveKey: string) => Promise<void>;
  /** Callback on save error */
  onError?: (error: Error) => void;
}

interface UseAutosaveReturn {
  /** Current save status */
  status: SaveStatus;
  /** Trigger a save (will be debounced) */
  triggerSave: (content: EditorContent) => void;
  /** Force immediate save (bypass debounce) */
  flushSave: () => void;
  /** Clear pending save queue and reset status */
  resetPending: () => void;
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;
}

type PendingSave = {
  key: string;
  content: EditorContent;
};

/**
 * Hook for managing autosave functionality
 *
 * Features:
 * - Debounced saves (default 1000ms)
 * - Status tracking (idle, saving, saved, error)
 * - Flush on unmount
 * - Error handling
 */
export function useAutosave({
  saveKey,
  debounceMs = 1000,
  onSave,
  onError,
}: UseAutosaveOptions): UseAutosaveReturn {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const saveKeyRef = useRef(saveKey);
  const isSavingRef = useRef(false);
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readPendingSave = useCallback((): PendingSave | null => {
    return pendingSaveRef.current;
  }, []);

  const clearIdleTimeout = useCallback(() => {
    if (idleTimeoutRef.current !== null) {
      clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
  }, []);

  const performSave = useCallback(async () => {
    if (!pendingSaveRef.current || isSavingRef.current) return;

    const pendingSave = pendingSaveRef.current;
    if (pendingSave.key !== saveKeyRef.current) {
      pendingSaveRef.current = null;
      return;
    }

    pendingSaveRef.current = null;
    isSavingRef.current = true;
    setStatus("saving");

    try {
      await onSave(pendingSave.content, pendingSave.key);
      if (pendingSave.key !== saveKeyRef.current) {
        return;
      }
      setStatus("saved");
      // Reset to idle after showing "saved" status
      clearIdleTimeout();
      idleTimeoutRef.current = setTimeout(() => setStatus("idle"), 2000);
    } catch (error) {
      if (pendingSave.key !== saveKeyRef.current) {
        return;
      }
      setStatus("error");
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      isSavingRef.current = false;
      const queued = readPendingSave();
      if (!queued) {
        return;
      }
      if (queued.key === saveKeyRef.current) {
        void performSave();
      } else {
        pendingSaveRef.current = null;
      }
    }
  }, [onSave, onError, clearIdleTimeout, readPendingSave]);

  const debouncedSave = useDebouncedCallback(performSave, debounceMs);

  const triggerSave = useCallback(
    (content: EditorContent) => {
      pendingSaveRef.current = { key: saveKey, content };
      clearIdleTimeout();
      setStatus("idle"); // Reset status when new changes come in
      debouncedSave();
    },
    [debouncedSave, clearIdleTimeout, saveKey],
  );

  const flushSave = useCallback(() => {
    debouncedSave.flush();
  }, [debouncedSave]);

  const resetPending = useCallback(() => {
    pendingSaveRef.current = null;
    debouncedSave.cancel();
    clearIdleTimeout();
    if (!isSavingRef.current) {
      setStatus("idle");
    }
  }, [debouncedSave, clearIdleTimeout]);

  useEffect(() => {
    if (saveKeyRef.current === saveKey) {
      return;
    }
    saveKeyRef.current = saveKey;
    pendingSaveRef.current = null;
    debouncedSave.cancel();
    clearIdleTimeout();
    if (!isSavingRef.current) {
      setStatus("idle");
    }
  }, [saveKey, debouncedSave, clearIdleTimeout]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      debouncedSave.flush();
      clearIdleTimeout();
    };
  }, [debouncedSave, clearIdleTimeout]);

  // Flush on page visibility change (minimize, tab switch)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        debouncedSave.flush();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [debouncedSave]);

  // Flush on window blur
  useEffect(() => {
    const handleBlur = () => {
      debouncedSave.flush();
    };

    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("blur", handleBlur);
    };
  }, [debouncedSave]);

  return {
    status,
    triggerSave,
    flushSave,
    resetPending,
    hasUnsavedChanges: pendingSaveRef.current !== null,
  };
}
