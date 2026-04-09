/**
 * Symbol Editor E2E Test Harness
 *
 * Isolated environment for Playwright testing of the symbol editor.
 * Bypasses the wizard flow and mounts symbol editor components directly.
 */

import { useEffect, useMemo } from "react";
import { SymbolEditorCanvasR3F as SymbolEditorCanvas } from "@/lib/render-engine/adapters/SymbolEditorCanvasR3F";
import { SymbolEditorToolbar } from "@/components/symbol-editor/SymbolEditorToolbar";
import { PinPalette } from "@/components/symbol-editor/PinPalette";
import {
  useSymbolEditorStore,
  useSymbolDraft,
  useSymbolChrome,
} from "@/components/symbol-editor/symbol-editor-store";
import {
  createEmptyDraft,
  createDefaultChrome,
  createDefaultHistory,
  type SymbolDraft,
} from "@/components/symbol-editor/types";
import { symbolToScreen } from "@/components/symbol-editor/viewport";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type HarnessFixture = "empty" | "with-graphics";

const EMPTY_FIXTURE: SymbolDraft = {
  ...createEmptyDraft("e2e-draft-1"),
  metadata: {
    name: "E2E Test Symbol",
    referencePrefix: "U",
    description: "Symbol for E2E testing",
  },
};

const WITH_GRAPHICS_FIXTURE: SymbolDraft = {
  ...EMPTY_FIXTURE,
  id: "e2e-draft-2",
  graphics: [
    {
      id: "rect-1",
      zIndex: 0,
      type: "rect",
      x: -2_540_000,
      y: -2_540_000,
      width: 5_080_000,
      height: 5_080_000,
      filled: false,
      strokeWidth: 254_000,
    },
  ],
  pins: [
    {
      id: "pin-1",
      name: "A",
      number: "1",
      electricalType: "input",
      side: "left",
      position: { x: -5_080_000, y: 0 },
      length: 2_540_000,
    },
    {
      id: "pin-2",
      name: "Y",
      number: "2",
      electricalType: "output",
      side: "right",
      position: { x: 5_080_000, y: 0 },
      length: 2_540_000,
    },
  ],
};

const FIXTURES: Record<HarnessFixture, SymbolDraft> = {
  empty: EMPTY_FIXTURE,
  "with-graphics": WITH_GRAPHICS_FIXTURE,
};

function getHarnessFixture(): HarnessFixture {
  if (typeof window === "undefined") {
    return "empty";
  }
  const fixture = new URLSearchParams(window.location.search).get("fixture");
  return fixture === "with-graphics" ? "with-graphics" : "empty";
}

// ---------------------------------------------------------------------------
// Store Reset
// ---------------------------------------------------------------------------

function resetHarnessStore(fixture: HarnessFixture) {
  const draft = FIXTURES[fixture];

  useSymbolEditorStore.setState({
    draft: {
      ...draft,
      metadata: { ...draft.metadata },
      pins: draft.pins.map((p) => ({ ...p, position: { ...p.position } })),
      graphics: draft.graphics.map((g) => ({ ...g })),
    },
    chrome: createDefaultChrome(),
    history: createDefaultHistory(),
    isDirty: false,
  });
}

// ---------------------------------------------------------------------------
// Debug Components
// ---------------------------------------------------------------------------

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

function E2EDebugPanel({ fixture }: { fixture: HarnessFixture }) {
  const draft = useSymbolDraft();
  const chrome = useSymbolChrome();

  const themeMode =
    globalThis.document.documentElement.dataset.colorMode ??
    globalThis.localStorage.getItem("theme") ??
    "system";

  const lastGraphicType = useMemo(() => {
    if (draft.graphics.length === 0) return "none";
    return draft.graphics[draft.graphics.length - 1]?.type ?? "none";
  }, [draft.graphics]);

  const selectedPinsCount = chrome.selection.selectedPinIds.size;
  const selectedGraphicsCount = chrome.selection.selectedGraphicIds.size;

  // Screen coordinates for first pin (if exists)
  const pin1Screen = useMemo(() => {
    if (draft.pins.length === 0) return "0,0";
    const pin = draft.pins[0]!;
    const pt = symbolToScreen(pin.position.x, pin.position.y, chrome.viewport);
    return `${Math.round(pt.x)},${Math.round(pt.y)}`;
  }, [draft.pins, chrome.viewport]);

  return (
    <div className="absolute left-4 top-4 z-30 flex w-64 flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950/90 p-3 shadow-xl pointer-events-none">
      <div className="flex items-center justify-between gap-2 pointer-events-auto">
        <p className="text-sm font-semibold text-slate-100">
          Symbol Editor E2E
        </p>
        <button
          type="button"
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          onClick={() => resetHarnessStore(fixture)}
        >
          Reset
        </button>
      </div>
      <DebugValue label="theme" value={themeMode} />
      <DebugValue label="graphics-count" value={draft.graphics.length} />
      <DebugValue label="pins-count" value={draft.pins.length} />
      <DebugValue label="active-tool" value={chrome.activeTool} />
      <DebugValue label="last-graphic-type" value={lastGraphicType} />
      <DebugValue label="selected-pins" value={selectedPinsCount} />
      <DebugValue label="selected-graphics" value={selectedGraphicsCount} />
      <DebugValue
        label="viewport-zoom"
        value={chrome.viewport.zoom.toFixed(1)}
      />
      <DebugValue label="grid-size" value={chrome.gridSize} />
      <DebugValue label="pin1" value={pin1Screen} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Harness Component
// ---------------------------------------------------------------------------

export function SymbolEditorE2EHarness() {
  const currentFixture = useMemo(getHarnessFixture, []);
  const setTool = useSymbolEditorStore((s) => s.setTool);
  const clearSelection = useSymbolEditorStore((s) => s.clearSelection);
  const undo = useSymbolEditorStore((s) => s.undo);

  // Initialize store on mount
  useEffect(() => {
    resetHarnessStore(currentFixture);
  }, [currentFixture]);

  // Global keyboard handler
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Tool shortcuts
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        switch (event.key.toLowerCase()) {
          case "v":
            setTool("select");
            return;
          case "l":
            setTool("line");
            return;
          case "r":
            setTool("rect");
            return;
          case "c":
            setTool("circle");
            return;
          case "escape":
            clearSelection();
            setTool("select");
            return;
        }
      }

      // Undo/Redo
      if ((event.ctrlKey || event.metaKey) && event.key === "z") {
        event.preventDefault();
        undo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setTool, clearSelection, undo]);

  return (
    <div className="grid h-screen grid-cols-[260px_1fr] bg-slate-950 text-slate-50">
      {/* Sidebar */}
      <aside className="flex flex-col border-r border-slate-800 bg-slate-900">
        <div className="p-4">
          <PinPalette />
        </div>
      </aside>

      {/* Main area */}
      <main className="relative flex flex-col">
        <SymbolEditorToolbar />
        <div className="relative flex flex-1 items-center justify-center p-6">
          <E2EDebugPanel fixture={currentFixture} />
          <div
            className="relative h-[600px] w-[800px] overflow-hidden rounded-xl border border-slate-800 shadow-2xl"
            data-testid="symbol-editor-canvas-container"
          >
            <SymbolEditorCanvas />
          </div>
        </div>
      </main>
    </div>
  );
}
