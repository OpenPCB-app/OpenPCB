import { useEffect, useMemo } from "react";
import { ComponentPalette } from "@/components/pcb/palette/ComponentPalette";
import { FloatingPropertiesPopover } from "@/components/pcb/properties/FloatingPropertiesPopover";
import { useSchematicInteractionController } from "@/components/pcb/useSchematicInteractionController";
import { SchematicCanvas } from "@/components/pcb/canvas/SchematicCanvas";
import { createHitTestCache } from "@/components/pcb/canvas/hit-test";
import { useSchematicStore } from "@/stores/schematic-store";
import type { SchematicDocument } from "@/components/pcb/types";

const TEST_DOCUMENT: SchematicDocument = {
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
  useSchematicStore.setState((state) => ({
    ...state,
    persisted: {
      document: TEST_DOCUMENT,
      projectId: "project-e2e",
      designId: TEST_DOCUMENT.id,
    },
    derived: {
      connectivity: null,
      documentBounds: null,
      hitTestCache: createHitTestCache(TEST_DOCUMENT.symbols),
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
  const document = useSchematicStore((state) => state.persisted.document);
  const session = useSchematicStore((state) => state.session);
  const selectedIds = useSchematicStore(
    (state) => state.chrome.selectedEntityIds,
  );
  const popoverEntityId = useSchematicStore(
    (state) => state.chrome.popoverEntityId,
  );

  const sessionSummary = useMemo(() => {
    if (!session) {
      return "none";
    }

    if (session.type === "placement") {
      return `placement:${session.symbolKind}`;
    }

    if ("sourcePinId" in session) {
      return `wire:${session.sourcePinId}:${session.targetPinId ?? "pending"}`;
    }

    return `drag:${session.anchorSymbolId}`;
  }, [session]);

  return (
    <div className="absolute left-4 top-4 z-30 flex w-64 flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950/90 p-3 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-100">Schematic E2E</p>
        <button
          type="button"
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          onClick={resetHarnessStore}
        >
          Reset
        </button>
      </div>
      <DebugValue label="symbols" value={document?.symbols.length ?? 0} />
      <DebugValue label="wires" value={document?.wires.length ?? 0} />
      <DebugValue
        label="selected"
        value={[...selectedIds].join(",") || "none"}
      />
      <DebugValue label="session" value={sessionSummary} />
      <DebugValue label="popover" value={popoverEntityId ?? "none"} />
    </div>
  );
}

export function SchematicEditorE2EHarness() {
  const controller = useSchematicInteractionController();
  const popoverEntityId = useSchematicStore(
    (state) => state.chrome.popoverEntityId,
  );
  const setPopoverTarget = useSchematicStore((state) => state.setPopoverTarget);

  useEffect(() => {
    resetHarnessStore();
  }, []);

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
        <E2EDebugPanel />
        <div className="relative h-[600px] w-[800px] overflow-hidden rounded-xl border border-slate-800 shadow-2xl">
          <SchematicCanvas controller={controller} />
          <FloatingPropertiesPopover />
        </div>
      </main>
    </div>
  );
}
