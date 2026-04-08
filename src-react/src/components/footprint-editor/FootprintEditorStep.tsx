import { useEffect, useRef } from "react";
import {
  FootprintEditorToolbar,
  FootprintPresetSelector,
  PresetConfigPanel,
  PadPropertiesPanel,
  useFootprintEditorStore,
} from "./index";
import { FootprintEditorCanvasR3F } from "@/lib/render-engine/adapters/FootprintEditorCanvasR3F";
import type { FootprintDraft } from "./types";
import { VariantListPanel } from "@/components/wizard/VariantListPanel";
import { VariantMetadataForm } from "@/components/wizard/VariantMetadataForm";
import {
  useComponentWizardStore,
  useActiveVariantId,
} from "@/stores/component-wizard-store";

interface FootprintEditorStepProps {
  onImportedDraft?: (draft: FootprintDraft) => void;
}

export function FootprintEditorStep({
  onImportedDraft,
}: FootprintEditorStepProps) {
  const preset = useFootprintEditorStore((s) => s.draft.preset);
  const footprintDraft = useFootprintEditorStore((s) => s.draft);
  const setFootprintDraft = useFootprintEditorStore((s) => s.setDraft);
  const resetFootprintDraft = useFootprintEditorStore((s) => s.resetDraft);

  const activeVariantId = useActiveVariantId();
  const updateVariantFootprint = useComponentWizardStore(
    (s) => s.updateVariantFootprint,
  );
  const getActiveVariant = useComponentWizardStore((s) => s.getActiveVariant);

  const prevVariantIdRef = useRef<string | null>(null);
  const isInitialMountRef = useRef(true);

  useEffect(() => {
    if (!activeVariantId) return;

    const prevId = prevVariantIdRef.current;

    if (prevId && prevId !== activeVariantId && !isInitialMountRef.current) {
      updateVariantFootprint(prevId, footprintDraft);
    }

    if (prevId !== activeVariantId) {
      const activeVariant = getActiveVariant();
      if (activeVariant?.footprintDraft) {
        setFootprintDraft(activeVariant.footprintDraft);
      } else {
        resetFootprintDraft();
      }
    }

    prevVariantIdRef.current = activeVariantId;
    isInitialMountRef.current = false;
  }, [
    activeVariantId,
    footprintDraft,
    getActiveVariant,
    resetFootprintDraft,
    setFootprintDraft,
    updateVariantFootprint,
  ]);

  useEffect(() => {
    if (activeVariantId) {
      updateVariantFootprint(activeVariantId, footprintDraft);
    }
  }, [footprintDraft, activeVariantId, updateVariantFootprint]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden h-full">
      <div className="flex flex-1 overflow-hidden">
        <div className="w-48 flex-shrink-0 border-r border-border-default bg-bg-secondary">
          <VariantListPanel />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <VariantMetadataForm />
          <FootprintEditorToolbar onImportedDraft={onImportedDraft} />

          <div className="flex flex-1 overflow-hidden">
            <div className="w-64 flex-shrink-0 overflow-y-auto border-r border-border-default bg-bg-secondary p-3 space-y-4">
              <FootprintPresetSelector />
              {preset !== "import" && preset !== "sot" && <PresetConfigPanel />}
            </div>

            <div className="flex-1 overflow-hidden">
              <FootprintEditorCanvasR3F />
            </div>

            <div className="w-64 flex-shrink-0 overflow-y-auto border-l border-border-default bg-bg-secondary p-3">
              <PadPropertiesPanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
