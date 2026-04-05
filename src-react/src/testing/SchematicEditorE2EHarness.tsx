import { useEffect, useMemo } from "react";
import { ComponentPalette } from "@/components/pcb/palette/ComponentPalette";
import { FloatingPropertiesPopover } from "@/components/pcb/properties/FloatingPropertiesPopover";
import { useSchematicInteractionController } from "@/components/pcb/useSchematicInteractionController";
import { SchematicCanvasR3F as SchematicCanvas } from "@/lib/render-engine/wrappers/SchematicCanvasR3F";
import { createHitTestCache } from "@/components/pcb/canvas/hit-test";
import { collectDirectlyAttachedPinIds } from "@/components/pcb/canvas/wires";
import { useSchematicStore } from "@/stores/schematic-store";
import type { SchematicDocument } from "@/components/pcb/types";

type HarnessFixture = "base" | "drag-wiring";

const BASE_FIXTURE: SchematicDocument = {
  id: "e2e-doc-1",
  projectId: "project-e2e",
  updatedAt: "2026-03-31T00:00:00Z",
  version: 1,
  formatVersion: "pcb.schematic-project-document/v1",
  name: "E2E schematic",
  revision: 1,
  symbols: [
    {
      id: "symbol-1",
      entityType: "symbol",
      symbolKind: "resistor",

      reference: "R1",
      value: "10k",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirrored: false,
      pins: [
        { id: "pin-1", name: "1", position: { x: 0, y: 0 } },
        { id: "pin-2", name: "2", position: { x: 1_270_000, y: 0 } },
      ],
      properties: {
        Footprint: "R_0603",
        Tolerance: "1%",
      },
    },
    {
      id: "symbol-2",
      entityType: "symbol",
      symbolKind: "connector",

      reference: "J1",
      value: "HDR2",
      position: { x: 1_905_000, y: 635_000 },
      rotation: 0,
      mirrored: false,
      pins: [
        { id: "pin-3", name: "1", position: { x: 0, y: 635_000 } },
        { id: "pin-4", name: "2", position: { x: 0, y: -635_000 } },
      ],
      properties: {
        Footprint: "PinHeader_1x02",
      },
    },
  ],
  wires: [],
  labels: [],
};

const DRAG_WIRING_FIXTURE: SchematicDocument = {
  ...BASE_FIXTURE,
  symbols: [
    BASE_FIXTURE.symbols[0]!,
    BASE_FIXTURE.symbols[1]!,
    {
      id: "symbol-3",
      entityType: "symbol",
      symbolKind: "connector",

      reference: "J2",
      value: "HDR2",
      position: { x: 3_810_000, y: 0 },
      rotation: 0,
      mirrored: false,
      pins: [
        { id: "pin-5", name: "1", position: { x: 0, y: 0 } },
        { id: "pin-6", name: "2", position: { x: 1_270_000, y: 0 } },
      ],
      properties: {
        Footprint: "PinHeader_1x02",
      },
    },
  ],
  wires: [
    {
      id: "wire-1",
      entityType: "wire",
      position: { x: 1_270_000, y: 0 },
      rotation: 0,
      sourcePinId: "pin-2",
      targetPinId: "pin-3",
      points: [
        { x: 1_270_000, y: 0 },
        { x: 1_905_000, y: 0 },
        { x: 1_905_000, y: 1_270_000 },
      ],
    },
    {
      id: "wire-2",
      entityType: "wire",
      position: { x: 1_905_000, y: 0 },
      rotation: 0,
      sourcePinId: "pin-4",
      targetPinId: "pin-5",
      points: [
        { x: 1_905_000, y: 0 },
        { x: 2_857_500, y: 0 },
        { x: 3_810_000, y: 0 },
      ],
    },
  ],
};

const FIXTURES: Record<HarnessFixture, SchematicDocument> = {
  base: BASE_FIXTURE,
  "drag-wiring": DRAG_WIRING_FIXTURE,
};

function getHarnessFixture(): HarnessFixture {
  if (typeof window === "undefined") {
    return "base";
  }

  const fixture = new URLSearchParams(window.location.search).get("fixture");
  return fixture === "drag-wiring" ? "drag-wiring" : "base";
}

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

function resetHarnessStore(fixture: HarnessFixture) {
  const document = FIXTURES[fixture];

  useSchematicStore.setState((state) => ({
    ...state,
    persisted: {
      document,
      projectId: "project-e2e",
      designId: document.id,
    },
    derived: {
      connectivity: null,
      documentBounds: null,
      hitTestCache: createHitTestCache(document.symbols),
    },
    chrome: {
      viewport: { offsetX: 200, offsetY: 150, zoom: 1 / 12_700 },
      selectedEntityIds: new Set(),
      activeTool: "select",
      popoverEntityId: null,
      gridSize: 1_270_000,
      showGrid: true,
      placementRotation: 0,
      gridPresetId: "small",
    },
    session: null,
    draggedSymbolKind: null,
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

import { schematicToScreen } from "@/components/pcb/canvas/viewport";

// ... [rest unchanged until E2EDebugPanel] ...

function E2EDebugPanel({ fixture }: { fixture: HarnessFixture }) {
  const schematicDocument = useSchematicStore(
    (state) => state.persisted.document,
  );
  const session = useSchematicStore((state) => state.session);
  const selectedIds = useSchematicStore(
    (state) => state.chrome.selectedEntityIds,
  );
  const popoverEntityId = useSchematicStore(
    (state) => state.chrome.popoverEntityId,
  );
  const viewport = useSchematicStore((state) => state.chrome.viewport);

  const themeMode =
    globalThis.document.documentElement.dataset.colorMode ??
    globalThis.localStorage.getItem("theme") ??
    "system";

  const wirePoints = useMemo(() => {
    if (!schematicDocument) {
      return "";
    }

    return [...schematicDocument.wires]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(
        (wire) =>
          `${wire.id}:${wire.points.map((point) => `${point.x},${point.y}`).join("|")}`,
      )
      .join(";");
  }, [schematicDocument]);

  const connectedPins = useMemo(() => {
    if (!schematicDocument) {
      return "[]";
    }

    return JSON.stringify(
      collectDirectlyAttachedPinIds(schematicDocument.wires),
    );
  }, [schematicDocument]);

  const sessionSummary = useMemo(() => {
    if (!session) {
      return "none";
    }

    if (session.type === "placement") {
      return `placement:${session.symbolKind}`;
    }

    if (session.type === "netLabel") {
      return "netLabel:pending";
    }

    if ("sourcePinId" in session) {
      return `wire:${session.sourcePinId}:${session.targetPinId ?? "pending"}`;
    }

    return `drag:${session.anchorSymbolId}`;
  }, [session]);

  const symbol1Screen = useMemo(() => {
    if (!schematicDocument) return "0,0";
    const sym = schematicDocument.symbols.find((s) => s.id === "symbol-1");
    if (!sym) return "0,0";
    const pt = schematicToScreen(
      sym.position.x + 635000,
      sym.position.y,
      viewport,
    );
    return `${Math.round(pt.x)},${Math.round(pt.y)}`;
  }, [schematicDocument, viewport]);

  const symbol2Screen = useMemo(() => {
    if (!schematicDocument) return "0,0";
    const sym = schematicDocument.symbols.find((s) => s.id === "symbol-2");
    if (!sym) return "0,0";
    const pt = schematicToScreen(sym.position.x, sym.position.y, viewport);
    return `${Math.round(pt.x)},${Math.round(pt.y)}`;
  }, [schematicDocument, viewport]);

  const pin2Screen = useMemo(() => {
    const pt = schematicToScreen(1270000, 0, viewport);
    return `${Math.round(pt.x)},${Math.round(pt.y)}`;
  }, [viewport]);

  const pin3Screen = useMemo(() => {
    const pt = schematicToScreen(1905000, 1270000, viewport);
    return `${Math.round(pt.x)},${Math.round(pt.y)}`;
  }, [viewport]);

  return (
    <div className="absolute left-4 top-4 z-30 flex w-64 flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950/90 p-3 shadow-xl pointer-events-none">
      <div className="flex items-center justify-between gap-2 pointer-events-auto">
        <p className="text-sm font-semibold text-slate-100">Schematic E2E</p>
        <button
          type="button"
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          onClick={() => resetHarnessStore(fixture)}
        >
          Reset
        </button>
      </div>
      <DebugValue label="theme" value={themeMode} />
      <DebugValue label="wire-points" value={wirePoints} />
      <DebugValue label="connected-pins" value={connectedPins} />
      <DebugValue
        label="symbols"
        value={schematicDocument?.symbols.length ?? 0}
      />
      <DebugValue label="wires" value={schematicDocument?.wires.length ?? 0} />
      <DebugValue
        label="selected"
        value={[...selectedIds].join(",") || "none"}
      />
      <DebugValue label="session" value={sessionSummary} />
      <DebugValue label="popover" value={popoverEntityId ?? "none"} />
      <DebugValue label="symbol1" value={symbol1Screen} />
      <DebugValue label="symbol2" value={symbol2Screen} />
      <DebugValue label="pin2" value={pin2Screen} />
      <DebugValue label="pin3" value={pin3Screen} />
    </div>
  );
}

export function SchematicEditorE2EHarness() {
  const controller = useSchematicInteractionController();
  const currentFixture = useMemo(getHarnessFixture, []);
  const popoverEntityId = useSchematicStore(
    (state) => state.chrome.popoverEntityId,
  );
  const setPopoverTarget = useSchematicStore((state) => state.setPopoverTarget);

  useEffect(() => {
    resetHarnessStore(currentFixture);
  }, [currentFixture]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (popoverEntityId) {
        if (isTextEntryFocused(globalThis.document.activeElement)) {
          return;
        }

        setPopoverTarget(null);
        return;
      }

      controller.cancelSession();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controller, popoverEntityId, setPopoverTarget]);

  return (
    <div className="grid h-screen grid-cols-[260px_1fr] bg-slate-950 text-slate-50">
      <aside className="border-r border-slate-800 bg-slate-900">
        <ComponentPalette controller={controller} />
      </aside>
      <main className="relative flex items-center justify-center p-6">
        <E2EDebugPanel fixture={currentFixture} />
        <div className="relative h-[600px] w-[800px] overflow-hidden rounded-xl border border-slate-800 shadow-2xl">
          <SchematicCanvas controller={controller} />
          <FloatingPropertiesPopover />
        </div>
      </main>
    </div>
  );
}
