import { beforeEach, describe, expect, it } from "vitest";
import { createHitTestCache } from "@/components/pcb/canvas/hit-test";
import { screenToSchematic } from "@/components/pcb/canvas/viewport";
import type { SchematicDocument } from "@/components/pcb/types";
import { useSchematicStore } from "./schematic-store";

const TEST_DOCUMENT: SchematicDocument = {
  id: "doc-1",
  projectId: "project-1",
  updatedAt: "2026-03-31T00:00:00Z",
  version: 1,
  formatVersion: "pcb.schematic-project-document/v1",
  name: "Main schematic",
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
      properties: {},
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
      properties: {},
    },
  ],
  wires: [
    {
      id: "wire-1",
      entityType: "wire",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirrored: false,
      points: [
        { x: 0, y: 0 },
        { x: 1_270_000, y: 0 },
      ],
      sourcePinId: "pin-1",
      targetPinId: "pin-2",
      net: "NET1",
    },
  ],
  labels: [
    {
      id: "label-1",
      entityType: "label",
      text: "NET1",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirrored: false,
      net: "NET1",
    },
  ],
};

function resetStore() {
  useSchematicStore.setState((state) => ({
    ...state,
    persisted: {
      document: TEST_DOCUMENT,
      projectId: "project-1",
      sheetId: "sheet-1",
    },
    derived: {
      connectivity: null,
      documentBounds: null,
      hitTestCache: {
        symbolBounds: {},
        connectorAnchors: {},
      },
    },
    chrome: {
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      selectedEntityIds: new Set(),
      activeTool: "select",
      popoverEntityId: null,
      gridSize: 1_270_000,
      showGrid: true,
      placementRotation: 0,
    },
    session: null,
  }));
}

describe("useSchematicStore", () => {
  beforeEach(() => {
    resetStore();
  });

  it("partitions schematic state into persisted, derived, chrome, and session slices", () => {
    const state = useSchematicStore.getState();

    expect(state.persisted.document?.id).toBe("doc-1");
    expect(state.derived.hitTestCache.connectorAnchors).toEqual({});
    expect(state.chrome.gridSize).toBe(1_270_000);
    expect(state.session).toBeNull();
  });

  it("defaults to 50mil grid size in nanometers", () => {
    expect(useSchematicStore.getState().chrome.gridSize).toBe(1_270_000);
  });

  it("zoomAt preserves world position under cursor", () => {
    const state = useSchematicStore.getState();
    const cursor = { x: 240, y: 180 };
    const worldBefore = screenToSchematic(
      cursor.x,
      cursor.y,
      useSchematicStore.getState().chrome.viewport,
    );

    state.zoomAt(cursor.x, cursor.y, 1.8);

    const worldAfter = screenToSchematic(
      cursor.x,
      cursor.y,
      useSchematicStore.getState().chrome.viewport,
    );

    expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThanOrEqual(1e-9);
  });

  it("keeps placement previews ephemeral and clears them through cancelSession", () => {
    const state = useSchematicStore.getState();
    const documentCountsBefore = {
      symbols: state.persisted.document?.symbols.length ?? 0,
      wires: state.persisted.document?.wires.length ?? 0,
      labels: state.persisted.document?.labels.length ?? 0,
    };

    state.beginPlacement("capacitor");
    state.setPlacementPreview({ x: 1_270_000, y: 2_540_000 });

    expect(useSchematicStore.getState().session).toEqual({
      type: "placement",
      symbolKind: "capacitor",
      rotation: 0,
      previewPosition: { x: 1_270_000, y: 2_540_000 },
    });

    state.cancelSession();

    expect(useSchematicStore.getState().session).toBeNull();
    expect(useSchematicStore.getState().chrome.activeTool).toBe("select");
    expect({
      symbols: useSchematicStore.getState().persisted.document?.symbols.length ?? 0,
      wires: useSchematicStore.getState().persisted.document?.wires.length ?? 0,
      labels: useSchematicStore.getState().persisted.document?.labels.length ?? 0,
    }).toEqual(documentCountsBefore);
  });

  it("commits placement once at the snapped position and exits the session", () => {
    const state = useSchematicStore.getState();

    state.beginPlacement("capacitor");
    state.setPlacementPreview({ x: 1_270_000, y: 2_540_000 });
    state.commitPlacement({ x: 1_270_000, y: 2_540_000 });

    const nextState = useSchematicStore.getState();
    expect(nextState.session).toBeNull();
    expect(nextState.chrome.activeTool).toBe("select");
    expect(nextState.persisted.document?.symbols).toHaveLength(3);
    expect(nextState.persisted.document?.symbols[2]).toMatchObject({
      entityType: "symbol",
      symbolKind: "capacitor",
      position: { x: 1_270_000, y: 2_540_000 },
      rotation: 0,
    });
    expect(nextState.chrome.selectedEntityIds).toEqual(
      new Set([nextState.persisted.document?.symbols[2]?.id]),
    );
  });

  it("starts wire sessions through beginWire without mutating the document", () => {
    const state = useSchematicStore.getState();
    const document = state.persisted.document;

    state.beginWire("pin-1");
    state.updateWirePreview([
      { x: 0, y: 0 },
      { x: 1_270_000, y: 0 },
    ]);

    expect(useSchematicStore.getState().session).toEqual({
      type: "wire",
      sourcePinId: "pin-1",
      previewPoints: [
        { x: 0, y: 0 },
        { x: 1_270_000, y: 0 },
      ],
      targetPinId: null,
    });
    expect(useSchematicStore.getState().persisted.document).toBe(document);
  });

  it("commits orthogonal wires between connectors and clears the session", () => {
    const state = useSchematicStore.getState();

    state.beginWire("pin-2");

    expect(state.commitWire("pin-3")).toBe(true);

    const nextState = useSchematicStore.getState();
    const committedWire = nextState.persisted.document?.wires.at(-1);

    expect(committedWire).toMatchObject({
      sourcePinId: "pin-2",
      targetPinId: "pin-3",
      points: [
        { x: 1_270_000, y: 0 },
        { x: 1_905_000, y: 0 },
        { x: 1_905_000, y: 1_270_000 },
      ],
    });
    expect(nextState.session).toBeNull();
  });

  it("rejects same-connector and zero-length wire commits", () => {
    const state = useSchematicStore.getState();

    state.beginWire("pin-1");
    expect(state.commitWire("pin-1")).toBe(false);
    expect(useSchematicStore.getState().persisted.document?.wires).toHaveLength(1);
    expect(useSchematicStore.getState().session).toMatchObject({
      type: "wire",
      sourcePinId: "pin-1",
    });

    useSchematicStore.setState((current) => ({
      ...current,
      persisted: {
        ...current.persisted,
        document: current.persisted.document
          ? {
              ...current.persisted.document,
              symbols: [
                ...current.persisted.document.symbols,
                {
                  id: "symbol-3",
                  entityType: "symbol",
                  symbolKind: "connector",
                  reference: "J2",
                  value: "HDR1",
                  position: { x: 1_270_000, y: 0 },
                  rotation: 0,
                  mirrored: false,
                  pins: [{ id: "pin-5", name: "1", position: { x: 0, y: 0 } }],
                  properties: {},
                },
              ],
            }
          : null,
      },
    }));

    const nextState = useSchematicStore.getState();
    nextState.beginWire("pin-2");
    expect(nextState.commitWire("pin-5")).toBe(false);
    expect(useSchematicStore.getState().persisted.document?.wires).toHaveLength(1);
  });

  it("inserts deterministic junction metadata when committed wires share endpoints", () => {
    const state = useSchematicStore.getState();

    state.beginWire("pin-2");
    state.commitWire("pin-3");

    expect(useSchematicStore.getState().derived.connectivity).toMatchObject({
      nets: [],
      junctions: [
        {
          id: "junction:1270000:0",
          position: { x: 1_270_000, y: 0 },
          degree: 2,
          wireIds: expect.arrayContaining(["wire-1"]),
        },
      ],
    });
  });

  it("tracks popover targets in editor chrome for single selected symbols", () => {
    const state = useSchematicStore.getState();

    state.selectEntities(["symbol-1"]);
    expect(useSchematicStore.getState().chrome.popoverEntityId).toBe("symbol-1");

    state.selectEntities(["wire-1"]);
    expect(useSchematicStore.getState().chrome.popoverEntityId).toBeNull();
  });

  it("stores deterministic symbol bounds and connector anchors for hit-testing", () => {
    const state = useSchematicStore.getState();
    state.setHitTestCache(createHitTestCache(TEST_DOCUMENT.symbols));

    expect(useSchematicStore.getState().derived.hitTestCache).toEqual({
      symbolBounds: {
        "symbol-1": {
          minX: 280_000,
          minY: -180_000,
          maxX: 990_000,
          maxY: 180_000,
        },
        "symbol-2": {
          minX: 1_525_000,
          minY: -220_000,
          maxX: 2_285_000,
          maxY: 1_490_000,
        },
      },
      connectorAnchors: {
        "pin-1": { x: 0, y: 0 },
        "pin-2": { x: 1_270_000, y: 0 },
        "pin-3": { x: 1_905_000, y: 1_270_000 },
        "pin-4": { x: 1_905_000, y: 0 },
      },
    });
  });
});
