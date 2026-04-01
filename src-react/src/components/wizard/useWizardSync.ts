/**
 * useWizardSync Hook
 *
 * Synchronizes symbol and footprint editor stores with the wizard store.
 * Handles bidirectional sync and dirty state propagation.
 */

import { useEffect, useRef } from "react";
import { useComponentWizardStore } from "@/stores/component-wizard-store";
import { useSymbolEditorStore } from "@/components/symbol-editor";
import { useFootprintEditorStore } from "@/components/footprint-editor/footprint-editor-store";
import type { SymbolDraft } from "@/components/symbol-editor/types";
import type { FootprintDraft } from "@/components/footprint-editor/types";

interface UseWizardSyncOptions {
  /** Whether sync is enabled */
  enabled?: boolean;
  /** Debounce delay in ms for syncing to wizard store */
  debounceMs?: number;
}

interface UseWizardSyncReturn {
  /** Current symbol draft */
  symbolDraft: SymbolDraft;
  /** Current footprint draft */
  footprintDraft: FootprintDraft;
  /** Whether any editor has unsaved changes */
  hasUnsavedChanges: boolean;
}

/**
 * Hook that syncs editor stores to the wizard store.
 *
 * - Watches symbol/footprint editor drafts
 * - Updates wizard store's draft payload on changes
 * - Propagates dirty state
 */
export function useWizardSync(
  options: UseWizardSyncOptions = {},
): UseWizardSyncReturn {
  const { enabled = true, debounceMs = 300 } = options;

  // Wizard store
  const currentStep = useComponentWizardStore((s) => s.currentStep);
  const updateDraft = useComponentWizardStore((s) => s.updateDraft);
  const markDirty = useComponentWizardStore((s) => s.markDirty);

  // Symbol editor store
  const symbolDraft = useSymbolEditorStore((s) => s.draft);
  const symbolIsDirty = useSymbolEditorStore((s) => s.isDirty);

  // Footprint editor store
  const footprintDraft = useFootprintEditorStore((s) => s.draft);
  const footprintIsDirty = useFootprintEditorStore((s) => s.isDirty);

  // Refs for debouncing
  const symbolSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const footprintSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync symbol editor to wizard store
  useEffect(() => {
    if (!enabled || currentStep !== "symbol") return;

    // Clear existing timeout
    if (symbolSyncTimeoutRef.current) {
      clearTimeout(symbolSyncTimeoutRef.current);
    }

    // Debounced sync
    symbolSyncTimeoutRef.current = setTimeout(() => {
      updateDraft({
        displayLabel: symbolDraft.metadata.name,
        description: symbolDraft.metadata.description,
        symbolData: transformSymbolToPayload(symbolDraft),
      });

      if (symbolIsDirty) {
        markDirty();
      }
    }, debounceMs);

    return () => {
      if (symbolSyncTimeoutRef.current) {
        clearTimeout(symbolSyncTimeoutRef.current);
      }
    };
  }, [
    enabled,
    currentStep,
    symbolDraft,
    symbolIsDirty,
    debounceMs,
    updateDraft,
    markDirty,
  ]);

  // Sync footprint editor to wizard store
  useEffect(() => {
    if (!enabled || currentStep !== "footprint") return;

    // Clear existing timeout
    if (footprintSyncTimeoutRef.current) {
      clearTimeout(footprintSyncTimeoutRef.current);
    }

    // Debounced sync
    footprintSyncTimeoutRef.current = setTimeout(() => {
      updateDraft({
        footprintData: transformFootprintToPayload(footprintDraft),
      });

      if (footprintIsDirty) {
        markDirty();
      }
    }, debounceMs);

    return () => {
      if (footprintSyncTimeoutRef.current) {
        clearTimeout(footprintSyncTimeoutRef.current);
      }
    };
  }, [
    enabled,
    currentStep,
    footprintDraft,
    footprintIsDirty,
    debounceMs,
    updateDraft,
    markDirty,
  ]);

  const hasUnsavedChanges = symbolIsDirty || footprintIsDirty;

  return {
    symbolDraft,
    footprintDraft,
    hasUnsavedChanges,
  };
}

// ---------------------------------------------------------------------------
// Payload Transformers
// ---------------------------------------------------------------------------

/**
 * Transform symbol draft to backend payload format
 */
function transformSymbolToPayload(draft: SymbolDraft): Record<string, unknown> {
  return {
    id: draft.id,
    name: draft.metadata.name,
    referencePrefix: draft.metadata.referencePrefix,
    description: draft.metadata.description,
    body: {
      kind: draft.body.kind,
      width: draft.body.width,
      height: draft.body.height,
    },
    pins: draft.pins.map((pin) => ({
      id: pin.id,
      name: pin.name,
      number: pin.number,
      electricalType: pin.electricalType,
      side: pin.side,
      position: { x: pin.position.x, y: pin.position.y },
      length: pin.length,
    })),
    graphics: draft.graphics.map((g) => ({ ...g })),
  };
}

/**
 * Transform footprint draft to backend payload format
 */
function transformFootprintToPayload(
  draft: FootprintDraft,
): Record<string, unknown> {
  return {
    id: draft.id,
    preset: draft.preset,
    config: draft.config,
    pads: draft.pads.map((pad) => ({
      id: pad.id,
      number: pad.number,
      shape: pad.shape,
      position: { x: pad.position.x, y: pad.position.y },
      size: { width: pad.size.width, height: pad.size.height },
      layers: [...pad.layers],
      drillDiameter: pad.drillDiameter,
      pinMapping: pad.pinMapping,
    })),
    graphics: draft.graphics.map((g) => ({ ...g })),
    metadata: {
      name: draft.metadata.name,
      description: draft.metadata.description,
    },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { transformSymbolToPayload, transformFootprintToPayload };
