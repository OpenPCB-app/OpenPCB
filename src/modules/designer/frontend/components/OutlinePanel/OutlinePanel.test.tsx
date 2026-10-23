// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { DesignerPlacedPart } from "../../../../../sdks/designer";
import type { DesignerWorkspaceActions, DesignerWorkspaceState } from "../../hooks/useDesignerWorkspace";
import { duplicateSchematicPositionNm } from "../../lib/grid";
import { useGridPreferences } from "../../stores/grid-prefs";
import { OutlinePanel } from "./OutlinePanel";

function placed(): DesignerPlacedPart {
  return {
    id: "placed", componentId: "gone-library-component", reference: "U1", value: "Stored value",
    rotationDeg: 90, mirrored: true, positionNm: { x: 1_000_123, y: 2_000_456 },
    propertiesJson: { manufacturer: "Stored maker" },
    symbol: {
      symbolId: "symbol", name: "Symbol", referencePrefix: "U", sourceHash: null, pins: [],
      preview: { kind: "symbol", units: "mm", name: "Symbol", unitCount: 1, pins: [], graphics: [], labels: [], bounds: null, warnings: [] },
    },
    footprint: { footprintId: "footprint", name: "Footprint", mountType: null, sourceHash: null, preview: null },
    pins: ["no_connect", "power_source", "future_intent"].map((electricalIntent, index) => ({
      id: `placed:${index}`, originPinKey: `${index}`, number: `${index}`, name: "Pin",
      electricalType: "passive", electricalIntent, unit: 1,
      localPositionNm: { x: index * 1_000_000, y: 0 },
      worldPositionNm: { x: 1_000_123, y: 2_000_456 - index * 1_000_000 },
    })),
  };
}

for (const snap of [true, false]) {
  test(`actual Duplicate action sends source snapshot command; snap=${snap}`, async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const previous = useGridPreferences.getState().schematic;
    useGridPreferences.setState({ schematic: { ...previous, snap } });
    const part = placed();
    const before = structuredClone(part);
    const dispatchCommand = vi.fn(async () => ({ ok: true, revision: 1, createdEntityId: "copy" }));
    const setError = vi.fn();
    const state = {
      projection: { designId: "design", revision: 0, parts: [part], wires: [], labels: [], primitives: [], nets: [], junctions: [] },
      selectedPartId: null, selectedPartIds: new Set<string>(),
    } as unknown as DesignerWorkspaceState;
    const actions = { dispatchCommand, setError } as unknown as DesignerWorkspaceActions;
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(<OutlinePanel
        state={state} actions={actions} onPlaceComponent={vi.fn()} onAddNetLabel={vi.fn()}
        onBrowseLibrary={vi.fn()} onFrameBoundsMm={vi.fn()} onSelectOnCanvas={vi.fn()}
      />));
      const menu = host.querySelector<HTMLButtonElement>('button[aria-label="Actions"]');
      expect(menu).not.toBeNull();
      await act(async () => menu!.click());
      const duplicate = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((button) => button.textContent === "Duplicate");
      expect(duplicate).toBeDefined();
      await act(async () => duplicate!.click());
      expect(dispatchCommand).toHaveBeenCalledExactlyOnceWith({
        type: "duplicate_part", partId: part.id,
        positionNm: duplicateSchematicPositionNm(part.positionNm, snap),
      });
      expect(setError).not.toHaveBeenCalled();
      expect(part).toEqual(before);
    } finally {
      await act(async () => root.unmount());
      useGridPreferences.setState({ schematic: previous });
    }
  });
}
