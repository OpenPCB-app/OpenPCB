/**
 * FootprintEditorStep Component
 *
 * Step 2 of the component creation wizard.
 * Layout: Left sidebar (presets + config), Canvas (center), Right sidebar (pad properties).
 */

import {
  FootprintEditorCanvas,
  FootprintEditorToolbar,
  FootprintPresetSelector,
  PresetConfigPanel,
  PadPropertiesPanel,
  useFootprintEditorStore,
} from "./index";
import type { FootprintDraft } from "./types";

interface FootprintEditorStepProps {
  onImportedDraft?: (draft: FootprintDraft) => void;
}

export function FootprintEditorStep({ onImportedDraft }: FootprintEditorStepProps) {
  const preset = useFootprintEditorStore((s) => s.draft.preset);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <FootprintEditorToolbar onImportedDraft={onImportedDraft} />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Presets and config */}
        <div className="w-64 flex-shrink-0 overflow-y-auto border-r border-border-default bg-bg-secondary p-3 space-y-4">
          <FootprintPresetSelector />
          {preset !== "import" && preset !== "sot" && <PresetConfigPanel />}
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-hidden">
          <FootprintEditorCanvas />
        </div>

        {/* Right sidebar - Pad properties */}
        <div className="w-64 flex-shrink-0 overflow-y-auto border-l border-border-default bg-bg-secondary p-3">
          <PadPropertiesPanel />
        </div>
      </div>
    </div>
  );
}
