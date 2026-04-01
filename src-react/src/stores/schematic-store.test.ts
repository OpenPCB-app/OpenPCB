import { beforeEach, describe, expect, it } from "vitest";
import { createHitTestCache } from "@/components/pcb/canvas/hit-test";
import {
  MAX_VIEWPORT_ZOOM,
  MIN_VIEWPORT_ZOOM,
  fitViewportToBounds,
  screenToSchematic,
} from "@/components/pcb/canvas/viewport";
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
      symbolTemplate: "resistor",
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
      symbolTemplate: "connector",
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
      gridPresetId: "small",
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

  it("resetViewport restores the default viewport", () => {
    const state = useSchematicStore.getState();

    state.setViewport({ offsetX: 120, offsetY: -80, zoom: 3 });
    state.resetViewport(800, 600);

    expect(useSchematicStore.getState().chrome.viewport).toEqual(
      fitViewportToBounds(
        {
          minX: 0,
          minY: -220_000,
          maxX: 2_285_000,
          maxY: 1_490_000,
        },
        800,
        600,
      ),
    );
  });

  it("rejects invalid viewport zoom values", () => {
    const state = useSchematicStore.getState();

    expect(() =>
      state.setViewport({
        offsetX: 0,
        offsetY: 0,
        zoom: MIN_VIEWPORT_ZOOM / 2,
      }),
    ).toThrow(RangeError);
    expect(() =>
      state.setViewport({
        offsetX: 0,
        offsetY: 0,
        zoom: MAX_VIEWPORT_ZOOM + 0.1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      state.setViewport({ offsetX: 0, offsetY: 0, zoom: Number.NaN }),
    ).toThrow(RangeError);
  });

  it("rejects invalid grid sizes", () => {
    const state = useSchematicStore.getState();

    expect(() => state.setGridSize(0)).toThrow(RangeError);
    expect(() => state.setGridSize(-1)).toThrow(RangeError);
    expect(() => state.setGridSize(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  it("keeps placement previews ephemeral and clears them through cancelSession", () => {
    const state = useSchematicStore.getState();
    const documentCountsBefore = {
      symbols: state.persisted.document?.symbols.length ?? 0,
      wires: state.persisted.document?.wires.length ?? 0,
      labels: state.persisted.document?.labels.length ?? 0,
    };

    state.beginPlacement("gnd");
    state.setPlacementPreview({ x: 1_270_000, y: 2_540_000 });

    expect(useSchematicStore.getState().session).toEqual({
      type: "placement",
      symbolKind: "gnd",
      rotation: 0,
      previewPosition: { x: 1_270_000, y: 2_540_000 },
    });

    state.cancelSession();

    expect(useSchematicStore.getState().session).toBeNull();
    expect(useSchematicStore.getState().chrome.activeTool).toBe("select");
    expect({
      symbols:
        useSchematicStore.getState().persisted.document?.symbols.length ?? 0,
      wires: useSchematicStore.getState().persisted.document?.wires.length ?? 0,
      labels:
        useSchematicStore.getState().persisted.document?.labels.length ?? 0,
    }).toEqual(documentCountsBefore);
  });

  it("commits placement once at the snapped position and exits the session", () => {
    const state = useSchematicStore.getState();

    state.beginPlacement("gnd");
    state.setPlacementPreview({ x: 1_270_000, y: 2_540_000 });
    state.commitPlacement({ x: 1_270_000, y: 2_540_000 });

    const nextState = useSchematicStore.getState();
    expect(nextState.session).toBeNull();
    expect(nextState.chrome.activeTool).toBe("select");
    expect(nextState.persisted.document?.symbols).toHaveLength(3);
    expect(nextState.persisted.document?.symbols[2]).toMatchObject({
      entityType: "symbol",
      symbolKind: "gnd",
      position: { x: 1_270_000, y: 2_540_000 },
      rotation: 0,
    });
    expect(nextState.chrome.selectedEntityIds).toEqual(
      new Set([nextState.persisted.document?.symbols[2]?.id]),
    );
  });

  it("tracks drag sessions and moves selected symbols from their initial positions", () => {
    const state = useSchematicStore.getState();

    state.beginDragMove(["symbol-1", "symbol-2"], "symbol-1", {
      x: 0,
      y: 0,
    });

    expect(useSchematicStore.getState().session).toMatchObject({
      type: "drag",
      symbolIds: ["symbol-1", "symbol-2"],
      anchorSymbolId: "symbol-1",
      startPointer: { x: 0, y: 0 },
      lastSnappedDelta: { x: 0, y: 0 },
      initialPositions: {
        "symbol-1": { x: 0, y: 0 },
        "symbol-2": { x: 1_905_000, y: 635_000 },
      },
    });

    state.updateDragMove({ x: 635_000, y: 635_000 });

    expect(useSchematicStore.getState().persisted.document?.symbols).toEqual([
      expect.objectContaining({
        id: "symbol-1",
        position: { x: 635_000, y: 635_000 },
      }),
      expect.objectContaining({
        id: "symbol-2",
        position: { x: 2_540_000, y: 1_270_000 },
      }),
    ]);

    const bounds = useSchematicStore.getState().derived.documentBounds;
    expect(bounds).not.toBeNull();
    expect(
      useSchematicStore.getState().derived.hitTestCache.symbolBounds,
    ).toEqual(
      expect.objectContaining({
        "symbol-1": expect.any(Object),
        "symbol-2": expect.any(Object),
      }),
    );

    state.updateDragMove({ x: 635_000, y: 635_000 });
    expect(useSchematicStore.getState().persisted.document?.symbols).toEqual([
      expect.objectContaining({
        id: "symbol-1",
        position: { x: 635_000, y: 635_000 },
      }),
      expect.objectContaining({
        id: "symbol-2",
        position: { x: 2_540_000, y: 1_270_000 },
      }),
    ]);

    state.commitDragMove();
    expect(useSchematicStore.getState().session).toBeNull();
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
      waypoints: [],
      previewPoints: [
        { x: 0, y: 0 },
        { x: 1_270_000, y: 0 },
      ],
      targetPinId: null,
    });
    expect(useSchematicStore.getState().persisted.document).toBe(document);
  });

  it("adds wire waypoints without consecutive duplicates", () => {
    const state = useSchematicStore.getState();

    state.beginWire("pin-1");
    state.addWireWaypoint({ x: 635_000, y: 0 });
    state.addWireWaypoint({ x: 635_000, y: 0 });
    state.addWireWaypoint({ x: 635_000, y: 635_000 });

    expect(useSchematicStore.getState().session).toMatchObject({
      type: "wire",
      sourcePinId: "pin-1",
      waypoints: [
        { x: 635_000, y: 0 },
        { x: 635_000, y: 635_000 },
      ],
    });
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

  it("includes wire waypoints when committing a wire", () => {
    const state = useSchematicStore.getState();

    state.beginWire("pin-1");
    state.addWireWaypoint({ x: 635_000, y: 0 });
    state.addWireWaypoint({ x: 635_000, y: 635_000 });

    expect(state.commitWire("pin-3")).toBe(true);

    expect(
      useSchematicStore.getState().persisted.document?.wires.at(-1),
    ).toMatchObject({
      sourcePinId: "pin-1",
      targetPinId: "pin-3",
      points: [
        { x: 0, y: 0 },
        { x: 635_000, y: 0 },
        { x: 635_000, y: 635_000 },
        { x: 1_905_000, y: 635_000 },
        { x: 1_905_000, y: 1_270_000 },
      ],
    });
  });

  it("rejects same-connector and zero-length wire commits", () => {
    const state = useSchematicStore.getState();

    state.beginWire("pin-1");
    expect(state.commitWire("pin-1")).toBe(false);
    expect(useSchematicStore.getState().persisted.document?.wires).toHaveLength(
      1,
    );
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
    expect(useSchematicStore.getState().persisted.document?.wires).toHaveLength(
      1,
    );
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
    expect(useSchematicStore.getState().chrome.popoverEntityId).toBe(
      "symbol-1",
    );

    state.selectEntities(["wire-1"]);
    expect(useSchematicStore.getState().chrome.popoverEntityId).toBeNull();
  });

  it("deletes a single selected symbol without touching wires", () => {
    const state = useSchematicStore.getState();

    state.selectEntities(["symbol-2"]);
    state.deleteSelectedEntities();

    const nextState = useSchematicStore.getState();
    expect(
      nextState.persisted.document?.symbols.map((symbol) => symbol.id),
    ).toEqual(["symbol-1"]);
    expect(nextState.persisted.document?.wires.map((wire) => wire.id)).toEqual([
      "wire-1",
    ]);
    expect(
      nextState.persisted.document?.labels.map((label) => label.id),
    ).toEqual(["label-1"]);
    expect(nextState.chrome.selectedEntityIds).toEqual(new Set());
    expect(nextState.chrome.popoverEntityId).toBeNull();
  });

  it("cascades wire deletion when deleting a symbol with connected pins", () => {
    const state = useSchematicStore.getState();

    state.selectEntities(["symbol-1"]);
    state.deleteSelectedEntities();

    const nextState = useSchematicStore.getState();
    expect(
      nextState.persisted.document?.symbols.map((symbol) => symbol.id),
    ).toEqual(["symbol-2"]);
    expect(nextState.persisted.document?.wires).toEqual([]);
    expect(nextState.derived.connectivity).toEqual({
      nets: [],
      junctions: [],
    });
    expect(nextState.derived.hitTestCache).toEqual({
      symbolBounds: {
        "symbol-2": {
          minX: 1_525_000,
          minY: -220_000,
          maxX: 2_285_000,
          maxY: 1_490_000,
        },
      },
      connectorAnchors: {
        "pin-3": { x: 1_905_000, y: 1_270_000 },
        "pin-4": { x: 1_905_000, y: 0 },
      },
    });
  });

  it("deletes a selected wire without deleting symbols or labels", () => {
    const state = useSchematicStore.getState();

    state.selectEntities(["wire-1"]);
    state.deleteSelectedEntities();

    const nextState = useSchematicStore.getState();
    expect(
      nextState.persisted.document?.symbols.map((symbol) => symbol.id),
    ).toEqual(["symbol-1", "symbol-2"]);
    expect(nextState.persisted.document?.wires).toEqual([]);
    expect(
      nextState.persisted.document?.labels.map((label) => label.id),
    ).toEqual(["label-1"]);
  });

  it("deletes mixed selected entities and cascaded wires", () => {
    const state = useSchematicStore.getState();

    useSchematicStore.setState((current) => ({
      ...current,
      persisted: {
        ...current.persisted,
        document: current.persisted.document
          ? {
              ...current.persisted.document,
              wires: [
                ...current.persisted.document.wires,
                {
                  id: "wire-2",
                  entityType: "wire",
                  position: { x: 1_905_000, y: 0 },
                  rotation: 0,
                  mirrored: false,
                  points: [
                    { x: 1_270_000, y: 0 },
                    { x: 1_905_000, y: 0 },
                    { x: 1_905_000, y: 1_270_000 },
                  ],
                  sourcePinId: "pin-2",
                  targetPinId: "pin-3",
                  net: "NET2",
                },
              ],
            }
          : null,
      },
    }));

    state.selectEntities(["symbol-2", "wire-1", "label-1"]);
    state.deleteSelectedEntities();

    const nextState = useSchematicStore.getState();
    expect(
      nextState.persisted.document?.symbols.map((symbol) => symbol.id),
    ).toEqual(["symbol-1"]);
    expect(nextState.persisted.document?.wires).toEqual([]);
    expect(nextState.persisted.document?.labels).toEqual([]);
  });

  it("is a no-op when nothing is selected", () => {
    const state = useSchematicStore.getState();
    const documentBefore = state.persisted.document;

    state.deleteSelectedEntities();

    const nextState = useSchematicStore.getState();
    expect(nextState.persisted.document).toBe(documentBefore);
    expect(nextState.chrome.selectedEntityIds).toEqual(new Set());
  });

  it("clears selection and popover after deleting selected entities", () => {
    const state = useSchematicStore.getState();

    state.selectEntities(["symbol-1"]);
    state.deleteSelectedEntities();

    const nextState = useSchematicStore.getState();
    expect(nextState.chrome.selectedEntityIds).toEqual(new Set());
    expect(nextState.chrome.popoverEntityId).toBeNull();
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
