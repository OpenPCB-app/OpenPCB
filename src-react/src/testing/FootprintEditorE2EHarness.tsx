import { useEffect } from "react";
import {
  FootprintEditorCanvas,
  FootprintEditorToolbar,
  PadPropertiesPanel,
  useFootprintDraft,
  useFootprintChrome,
  useFootprintEditorStore,
} from "@/components/footprint-editor";

function resetHarnessStore() {
  useFootprintEditorStore.getState().resetDraft("footprint-e2e");
  useFootprintEditorStore.setState((state) => ({
    ...state,
    draft: {
      ...state.draft,
      metadata: {
        ...state.draft.metadata,
        name: "E2E Footprint",
      },
      pads: [
        {
          id: "pad-1",
          number: "1",
          name: "Pad 1",
          type: "smd",
          shape: "rect",
          position: { x: 1, y: 1 },
          size: { width: 0.6, height: 0.8 },
          rotation: 0,
          layers: ["F.Cu", "F.Mask", "F.Paste"],
        },
        {
          id: "pad-2",
          number: "2",
          name: "Pad 2",
          type: "smd",
          shape: "oval",
          position: { x: 2, y: 1 },
          size: { width: 0.6, height: 0.8 },
          rotation: 0,
          layers: ["F.Cu", "F.Mask", "F.Paste"],
        },
      ],
    },
  }));
}

function DebugValue({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-slate-200">
      <span className="text-slate-400">{label}</span>
      <span data-testid={`e2e-${label}`} className="font-mono">
        {value}
      </span>
    </div>
  );
}

function E2EDebugPanel() {
  const draft = useFootprintDraft();
  const chrome = useFootprintChrome();

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-30 flex w-64 flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950/90 p-3 shadow-xl">
      <div className="flex items-center justify-between gap-2 pointer-events-auto">
        <p className="text-sm font-semibold text-slate-100">
          Footprint Editor E2E
        </p>
        <button
          type="button"
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          onClick={resetHarnessStore}
        >
          Reset
        </button>
      </div>
      <DebugValue label="pads-count" value={draft.pads.length} />
      <DebugValue
        label="selected-pads"
        value={chrome.selection.selectedPadIds.size}
      />
      <DebugValue label="grid-size" value={chrome.gridSize} />
      <DebugValue
        label="viewport-zoom"
        value={chrome.viewport.zoom.toFixed(1)}
      />
    </div>
  );
}

export function FootprintEditorE2EHarness() {
  useEffect(() => {
    resetHarnessStore();
  }, []);

  return (
    <div className="grid h-screen grid-cols-[260px_1fr_260px] bg-slate-950 text-slate-50">
      <aside className="border-r border-slate-800 bg-slate-900 p-4">
        <p className="text-sm font-semibold text-slate-100">Presets</p>
      </aside>
      <main className="relative flex flex-col">
        <FootprintEditorToolbar />
        <div className="relative flex flex-1 items-center justify-center p-6">
          <E2EDebugPanel />
          <div
            className="relative h-[600px] w-[800px] overflow-hidden rounded-xl border border-slate-800 shadow-2xl"
            data-testid="footprint-editor-canvas-container"
          >
            <FootprintEditorCanvas />
          </div>
        </div>
      </main>
      <aside className="border-l border-slate-800 bg-slate-900 p-4">
        <PadPropertiesPanel />
      </aside>
    </div>
  );
}
