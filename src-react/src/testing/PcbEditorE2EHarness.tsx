import { useEffect, useMemo } from "react";
import { PcbCanvas } from "@/components/pcb-editor/canvas/PcbCanvas";
import { PcbSidebar } from "@/components/pcb-editor/PcbSidebar";
import { PcbToolbar } from "@/components/pcb-editor/PcbToolbar";
import { usePcbStore } from "@/stores/pcb-store";
import type { PcbDocument, PcbPlacement } from "@/components/pcb-editor/pcb-types";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";

function createFootprint(): ParsedKicadFootprint {
  return {
    name: "test-footprint",
    description: "",
    tags: [],
    pads: [
      {
        number: "1",
        type: "thru_hole",
        shape: "circle",
        position: { x: 0, y: 0 },
        size: { width: 1, height: 1 },
        rotation: 0,
        layers: ["F.Cu", "B.Cu"],
        drillDiameter: 0.5,
      },
    ],
    graphics: [],
    model3dRefs: [],
    attributes: { type: "through_hole" },
    warnings: [],
    rawSource: "",
  };
}

function createPlacement(
  id: string,
  reference: string,
  x: number,
  y: number,
): PcbPlacement {
  return {
    id,
    schematicSymbolId: id,
    componentId: id,
    variantId: "variant-1",
    footprintOptionId: "footprint-1",
    reference,
    value: reference,
    position: { x, y },
    rotation: 0,
    layer: "F.Cu",
    footprintData: createFootprint(),
  };
}

const TEST_DOCUMENT: PcbDocument = {
  boardOutline: { width: 100, height: 100 },
  manufacturerPreset: "jlcpcb_standard",
  netClasses: [],
  nets: [
    {
      id: "net-1",
      name: "NET1",
      netClass: "default",
      padRefs: [
        { componentId: "u1", padNumber: "1" },
        { componentId: "u2", padNumber: "1" },
      ],
    },
  ],
  placements: [
    createPlacement("u1", "U1", 20, 50),
    createPlacement("u2", "U2", 60, 50),
  ],
  traces: [],
  vias: [],
  zones: [],
};

function isTextEntryFocused(activeElement: Element | null): boolean {
  if (!(activeElement instanceof HTMLElement)) {
    return false;
  }

  if (
    activeElement.isContentEditable ||
    activeElement instanceof HTMLTextAreaElement
  ) {
    return true;
  }

  if (!(activeElement instanceof HTMLInputElement)) {
    return false;
  }

  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(activeElement.type);
}

function resetHarnessStore() {
  usePcbStore.getState().setDocument(TEST_DOCUMENT);
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
  const document = usePcbStore((state) => state.document);
  const routingSession = usePcbStore((state) => state.routingSession);
  const selectedIds = usePcbStore((state) => state.selectedIds);
  const activeTool = usePcbStore((state) => state.activeTool);
  const activeLayer = usePcbStore((state) => state.activeLayer);
  const ratsnest = usePcbStore((state) => state.ratsnest);
  const viewport = usePcbStore((state) => state.viewport);

  const routingSummary = useMemo(() => {
    if (!routingSession) {
      return "none";
    }

    return `${routingSession.netId}:${routingSession.layer}:${routingSession.committedSegments.length}`;
  }, [routingSession]);

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-30 flex w-72 flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950/90 p-3 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-100">PCB E2E</p>
        <button
          type="button"
          className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          onClick={resetHarnessStore}
        >
          Reset
        </button>
      </div>
      <DebugValue label="traces" value={document?.traces.length ?? 0} />
      <DebugValue label="vias" value={document?.vias.length ?? 0} />
      <DebugValue label="ratsnest" value={ratsnest.length} />
      <DebugValue
        label="selected"
        value={[...selectedIds].join(",") || "none"}
      />
      <DebugValue label="tool" value={activeTool} />
      <DebugValue label="layer" value={activeLayer} />
      <DebugValue label="offset-x" value={viewport.offsetX.toFixed(2)} />
      <DebugValue label="offset-y" value={viewport.offsetY.toFixed(2)} />
      <DebugValue label="zoom" value={viewport.zoom.toFixed(4)} />
      <DebugValue label="routing" value={routingSummary} />
      <DebugValue label="width" value={routingSession?.width ?? "none"} />
      <DebugValue
        label="elbow"
        value={routingSession?.elbowDirection ?? "none"}
      />
    </div>
  );
}

export function PcbEditorE2EHarness() {
  useEffect(() => {
    resetHarnessStore();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryFocused(globalThis.document.activeElement)) {
        return;
      }

      const pcbStore = usePcbStore.getState();

      if (pcbStore.routingSession) {
        if ((event.ctrlKey || event.metaKey) && !event.altKey) {
          if (event.key === "z" && !event.shiftKey) {
            event.preventDefault();
            pcbStore.cancelRouting();
            return;
          }
          if ((event.key === "z" && event.shiftKey) || event.key === "y") {
            event.preventDefault();
            return;
          }
        }
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key === "z" && !event.shiftKey) {
          event.preventDefault();
          pcbStore.undo();
          return;
        }
        if ((event.key === "z" && event.shiftKey) || event.key === "y") {
          event.preventDefault();
          pcbStore.redo();
          return;
        }
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!pcbStore.routingSession && pcbStore.selectedIds.size > 0) {
          if (event.key === "Backspace") {
            event.preventDefault();
          }
          pcbStore.deleteSelectedEntities();
        }
        return;
      }

      if (event.key === "Escape") {
        if (pcbStore.routingSession) {
          pcbStore.cancelRouting();
          pcbStore.setActiveTool("select");
        } else if (pcbStore.selectedIds.size > 0) {
          pcbStore.clearSelection();
        } else {
          pcbStore.setActiveTool("select");
        }
        return;
      }

      if (pcbStore.routingSession) {
        if (event.key === "v" || event.key === "V") {
          if (pcbStore.lastCursorPosition) {
            pcbStore.placeRoutingVia(pcbStore.lastCursorPosition);
          }
          return;
        }
        if (event.key === "w") {
          pcbStore.cycleTraceWidth(1);
          return;
        }
        if (event.key === "W") {
          pcbStore.cycleTraceWidth(-1);
          return;
        }
        if (event.key === "f" || event.key === "F") {
          pcbStore.flipElbowDirection();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="grid h-screen grid-cols-[280px_1fr] bg-slate-950 text-slate-50">
      <aside className="border-r border-slate-800 bg-slate-900">
        <PcbSidebar />
      </aside>
      <main className="relative flex items-center justify-center p-6">
        <E2EDebugPanel />
        <div className="relative h-[600px] w-[800px] overflow-hidden rounded-xl border border-slate-800 shadow-2xl">
          <div className="absolute left-4 top-4 z-20 flex items-center gap-3 rounded-lg bg-slate-900/90 px-3 py-2 backdrop-blur">
            <p className="text-sm font-medium text-slate-100">PCB Harness</p>
            <PcbToolbar />
          </div>
          <div className="relative h-full w-full">
            <PcbCanvas />
          </div>
        </div>
      </main>
    </div>
  );
}
