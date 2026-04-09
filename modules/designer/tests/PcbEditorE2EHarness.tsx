import { useEffect, useMemo, useState } from "react";
import { PcbCanvasR3F as PcbCanvas } from "@/lib/render-engine/adapters/PcbCanvasR3F";
import { PcbSidebar } from "@/components/pcb-editor/PcbSidebar";
import { PcbToolbar } from "@/components/pcb-editor/PcbToolbar";
import { usePcbStore } from "@/stores/pcb-store";
import type {
  PcbDocument,
  PcbPlacement,
} from "@/components/pcb-editor/pcb-types";
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

function resetHarnessStore() {
  usePcbStore.getState().setDocument(TEST_DOCUMENT);
}

interface PcbViewportProof {
  camera: {
    x: number;
    y: number;
    zoom: number;
  };
  points: {
    boardCenter: { x: number; y: number };
    leftPad: { x: number; y: number } | null;
    rightPad: { x: number; y: number } | null;
  };
}

function readViewportProof(): PcbViewportProof | null {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    (
      window as Window & {
        __OPENPCB_PCB_VIEWPORT_PROOF__?: PcbViewportProof;
      }
    ).__OPENPCB_PCB_VIEWPORT_PROOF__ ?? null
  );
}

function formatProofValue(value: number | null | undefined, digits = 2) {
  return typeof value === "number" ? value.toFixed(digits) : "pending";
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
  const [viewportProof, setViewportProof] = useState<PcbViewportProof | null>(
    () => readViewportProof(),
  );

  useEffect(() => {
    setViewportProof(readViewportProof());

    const handleViewportProof = (event: Event) => {
      setViewportProof((event as CustomEvent<PcbViewportProof>).detail);
    };

    window.addEventListener(
      "openpcb:pcb-viewport-proof",
      handleViewportProof as EventListener,
    );

    return () => {
      window.removeEventListener(
        "openpcb:pcb-viewport-proof",
        handleViewportProof as EventListener,
      );
    };
  }, []);

  const routingSummary = useMemo(() => {
    if (!routingSession) {
      return "none";
    }

    return `${routingSession.netId}:${routingSession.layer}:${routingSession.committedSegments.length}`;
  }, [routingSession]);

  const visiblePadSpanX = useMemo(() => {
    if (!viewportProof?.points.leftPad || !viewportProof.points.rightPad) {
      return "pending";
    }

    return Math.abs(
      viewportProof.points.rightPad.x - viewportProof.points.leftPad.x,
    ).toFixed(2);
  }, [viewportProof]);

  const cameraX = viewportProof?.camera.x ?? viewport.offsetX;
  const cameraY = viewportProof?.camera.y ?? viewport.offsetY;
  const cameraZoom = viewportProof?.camera.zoom ?? viewport.zoom;

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
      <DebugValue label="offset-x" value={cameraX.toFixed(2)} />
      <DebugValue label="offset-y" value={cameraY.toFixed(2)} />
      <DebugValue label="zoom" value={cameraZoom.toFixed(4)} />
      <DebugValue
        label="proof-left-pad-x"
        value={formatProofValue(viewportProof?.points.leftPad?.x)}
      />
      <DebugValue
        label="proof-left-pad-y"
        value={formatProofValue(viewportProof?.points.leftPad?.y)}
      />
      <DebugValue
        label="proof-right-pad-x"
        value={formatProofValue(viewportProof?.points.rightPad?.x)}
      />
      <DebugValue label="proof-span-x" value={visiblePadSpanX} />
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
