/**
 * useAutoSaveDraft Hook
 *
 * Debounced auto-save hook for component draft updates.
 * Automatically saves changes to the backend after user stops editing.
 */

import { useEffect, useRef, useCallback } from "react";
import { customFetch } from "@shared/sdk/mutator";
import { useComponentWizardStore } from "@/stores/component-wizard-store";

interface UseAutoSaveDraftOptions {
  /** Debounce delay in milliseconds (default: 1000) */
  debounceMs?: number;
  /** Whether auto-save is enabled (default: true) */
  enabled?: boolean;
  /** Callback when save succeeds */
  onSaveSuccess?: () => void;
  /** Callback when save fails */
  onSaveError?: (error: Error) => void;
}

/**
 * Hook that auto-saves draft changes to the backend with debouncing.
 *
 * Usage:
 * ```tsx
 * const { triggerSave, isSaving } = useAutoSaveDraft({
 *   debounceMs: 1000,
 *   onSaveSuccess: () => console.log("Saved!"),
 * });
 * ```
 */
export function useAutoSaveDraft(options: UseAutoSaveDraftOptions = {}) {
  const {
    debounceMs = 1000,
    enabled = true,
    onSaveSuccess,
    onSaveError,
  } = options;

  const draftId = useComponentWizardStore((s) => s.draftId);
  const draft = useComponentWizardStore((s) => s.draft);
  const isDirty = useComponentWizardStore((s) => s.isDirty);
  const isSaving = useComponentWizardStore((s) => s.isSaving);
  const setSaving = useComponentWizardStore((s) => s.setSaving);
  const markClean = useComponentWizardStore((s) => s.markClean);
  const setLastSaved = useComponentWizardStore((s) => s.setLastSaved);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const draftIdRef = useRef(draftId);

  // Keep draftId ref in sync
  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  // Save function
  const save = useCallback(async () => {
    const currentDraftId = draftIdRef.current;
    if (!currentDraftId || !draft) return;

    setSaving(true);

    try {
      await customFetch(`/api/components/drafts/${currentDraftId}`, {
        method: "PATCH",
        body: JSON.stringify({ payload: draft }),
      });

      // Only mark clean if draftId hasn't changed
      if (draftIdRef.current === currentDraftId) {
        markClean();
        setLastSaved(Date.now());
        onSaveSuccess?.();
      }
    } catch (error) {
      console.error("Failed to auto-save draft:", error);
      onSaveError?.(
        error instanceof Error ? error : new Error("Unknown save error"),
      );
    } finally {
      // Only clear saving state if draftId hasn't changed
      if (draftIdRef.current === currentDraftId) {
        setSaving(false);
      }
    }
  }, [draft, setSaving, markClean, setLastSaved, onSaveSuccess, onSaveError]);

  // Trigger save function (can be called manually)
  const triggerSave = useCallback(() => {
    if (!enabled || !draftId || !draft) return;

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Schedule new save
    timeoutRef.current = setTimeout(() => {
      save();
    }, debounceMs);
  }, [enabled, draftId, draft, debounceMs, save]);

  // Auto-trigger save when draft becomes dirty
  useEffect(() => {
    if (isDirty && enabled && draftId && draft) {
      triggerSave();
    }

    // Cleanup timeout on unmount or when deps change
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isDirty, enabled, draftId, draft, triggerSave]);

  // Cancel pending save on draftId change (prevents cross-draft saves)
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [draftId]);

  return {
    triggerSave,
    isSaving,
    save, // For manual immediate save
  };
}
