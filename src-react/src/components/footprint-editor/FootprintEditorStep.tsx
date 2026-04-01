/**
 * FootprintEditorStep Component
 *
 * Step 2 of the component creation wizard.
 * Layout: Left sidebar (presets + config), Canvas (center), Right sidebar (pad properties).
 */

import { useEffect } from "react";
import { Upload } from "lucide-react";
import {
  FootprintEditorCanvas,
  FootprintEditorToolbar,
  FootprintPresetSelector,
  PresetConfigPanel,
  PadPropertiesPanel,
  useFootprintEditorStore,
} from "./index";
import { importFootprintFile } from "./import-utils";

export function FootprintEditorStep() {
  const resetDraft = useFootprintEditorStore((s) => s.resetDraft);
  const setDraft = useFootprintEditorStore((s) => s.setDraft);
  const preset = useFootprintEditorStore((s) => s.draft.preset);

  // Reset draft when component mounts
  useEffect(() => {
    resetDraft();
  }, [resetDraft]);

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const draft = await importFootprintFile(file);
      setDraft(draft);
    } catch (error) {
      console.error("Failed to import footprint:", error);
      alert(`Failed to import footprint: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    // Reset input
    e.target.value = "";
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <FootprintEditorToolbar />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Presets and config */}
        <div className="w-64 flex-shrink-0 overflow-y-auto border-r border-border-default bg-bg-secondary p-3 space-y-4">
          <FootprintPresetSelector />
          {preset === "import" && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-text-primary">Import File</h3>
              <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-default hover:border-brand cursor-pointer p-4 transition-colors">
                <Upload className="h-6 w-6 text-text-muted" />
                <span className="text-xs text-text-secondary">Drop .kicad_mod file</span>
                <span className="text-[10px] text-text-muted">or click to browse</span>
                <input
                  type="file"
                  accept=".kicad_mod"
                  onChange={handleFileImport}
                  className="hidden"
                />
              </label>
            </div>
          )}
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