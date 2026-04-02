import { create } from "zustand";
import {
  createComponentLibraryIndex,
  createSymbolEntity,
  EMPTY_COMPONENT_LIBRARY_INDEX,
  resolveSymbolEntityFromLibrary,
  type ComponentLibraryIndex,
} from "@/components/pcb/symbol-library";
import {
  GRID_PRESETS,
  normalizeSchematicDocument,
  toEditorSchematicDocument,
} from "@/components/pcb/types";
import type { SchematicProjectDocument } from "@shared/types";
import type { ComponentType } from "@shared/types/component-library-schema.types";
import { createHitTestCache } from "@/components/pcb/canvas/hit-test";
import type {
  Bounds,
  DerivedConnectivity,
  DerivedSchematicState,
  EditorChromeState,
  DragSession,
  HitTestCache,
  InteractionSession,
  Point,
  Rotation,
  SchematicDocument,
  SymbolKind,
  ToolMode,
  Viewport,
  WireEntity,
} from "@/components/pcb/types";
import {
  buildOrthogonalWirePathWithWaypoints,
  deriveWireJunctions,
  getWireLength,
} from "@/components/pcb/canvas/wires";
import {
  getSymbolBodyBounds,
  transformSymbolLocalPoint,
} from "@/components/pcb/canvas/symbols";
import {
  clampViewportZoom,
  createCenteredViewport,
  fitViewportToBounds,
  MAX_VIEWPORT_ZOOM,
  MIN_VIEWPORT_ZOOM,
} from "@/components/pcb/canvas/viewport";

interface PersistedDocumentState {
  document: SchematicDocument | null;
  projectId: string | null;
  designId: string | null;
}

interface SchematicState {
  persisted: PersistedDocumentState;
  derived: DerivedSchematicState;
  chrome: EditorChromeState;
  session: InteractionSession;
  draggedSymbolKind: SymbolKind | null;
  componentLibraryIndex: ComponentLibraryIndex;

  setViewport: (viewport: Viewport) => void;
  pan: (dx: number, dy: number) => void;
  zoomAt: (centerX: number, centerY: number, factor: number) => void;
  resetViewport: (canvasWidth?: number, canvasHeight?: number) => void;

  activateTool: (tool: ToolMode) => void;
  beginPlacement: (kind: SymbolKind) => void;
  setPlacementPreview: (position: { x: number; y: number } | null) => void;
  commitPlacement: (position: { x: number; y: number }) => void;
  rotatePlacement: () => void;
  beginWire: (sourcePinId: string) => void;
  addWireWaypoint: (point: Point) => void;
  updateWirePreview: (
    points: Array<{ x: number; y: number }>,
    targetPinId?: string | null,
  ) => void;
  commitWire: (targetPinId: string) => boolean;
  beginDragMove: (
    symbolIds: string[],
    anchorSymbolId: string,
    startPointer: Point,
  ) => void;
  updateDragMove: (delta: Point) => void;
  commitDragMove: () => void;
  setPaletteDragSymbolKind: (kind: SymbolKind | null) => void;
  cancelSession: () => void;

  selectEntities: (ids: string[]) => void;
  addToSelection: (ids: string[]) => void;
  clearSelection: () => void;
  selectAll: () => void;
  setPopoverTarget: (id: string | null) => void;
  deleteSelectedEntities: () => void;

  setDocument: (doc: SchematicDocument | SchematicProjectDocument) => void;
  clearDocument: () => void;
  setComponentLibrary: (components: ComponentType[]) => void;
  setProjectContext: (projectId: string | null, designId: string | null) => void;
  setConnectivity: (conn: DerivedConnectivity | null) => void;
  setDocumentBounds: (bounds: Bounds | null) => void;
  setHitTestCache: (cache: HitTestCache) => void;

  setGridSize: (size: number) => void;
  toggleGrid: () => void;
  setGridPreset: (presetId: string) => void;

  updateSymbolValue: (symbolId: string, value: string) => void;
}

const DEFAULT_GRID_NM = 508_000; // 0.508mm (20 mils) - smaller default grid

const EMPTY_HIT_TEST_CACHE: HitTestCache = {
  symbolBounds: {},
  connectorAnchors: {},
};

const INITIAL_DERIVED_STATE: DerivedSchematicState = {
  connectivity: null,
  documentBounds: null,
  hitTestCache: EMPTY_HIT_TEST_CACHE,
};

const INITIAL_CHROME_STATE: EditorChromeState = {
  viewport: createCenteredViewport(),
  selectedEntityIds: new Set(),
  activeTool: "select",
  popoverEntityId: null,
  gridSize: DEFAULT_GRID_NM,
  showGrid: true,
  placementRotation: 0,
  gridPresetId: "small",
};

function derivePopoverTargetId(
  document: SchematicDocument | null,
  ids: Set<string>,
): string | null {
  if (ids.size !== 1 || !document) {
    return null;
  }

  const selectedId = ids.values().next().value;
  if (selectedId === undefined) {
    return null;
  }

  return document.symbols.some((symbol) => symbol.id === selectedId)
    ? selectedId
    : null;
}

function updateSelection(ids: string[], document: SchematicDocument | null) {
  const selectedEntityIds = new Set(ids);

  return {
    selectedEntityIds,
    popoverEntityId: derivePopoverTargetId(document, selectedEntityIds),
  };
}

function findPinAnchor(
  document: SchematicDocument,
  pinId: string,
): { x: number; y: number } | null {
  for (const symbol of document.symbols) {
    const pin = symbol.pins.find((candidate) => candidate.id === pinId);
    if (!pin) {
      continue;
    }

    return transformSymbolLocalPoint(symbol, pin.position);
  }

  return null;
}

function deriveConnectivity(document: SchematicDocument): DerivedConnectivity {
  return {
    nets: [],
    junctions: deriveWireJunctions(document.wires),
  };
}

function collectConnectedWireIds(
  wires: WireEntity[],
  deletedPinIds: Set<string>,
): Set<string> {
  return new Set(
    wires
      .filter(
        (wire) =>
          deletedPinIds.has(wire.sourcePinId) ||
          deletedPinIds.has(wire.targetPinId),
      )
      .map((wire) => wire.id),
  );
}

function includePointInBounds(bounds: Bounds | null, point: Point): Bounds {
  if (!bounds) {
    return {
      minX: point.x,
      minY: point.y,
      maxX: point.x,
      maxY: point.y,
    };
  }

  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

function includeBounds(current: Bounds | null, next: Bounds): Bounds {
  if (!current) {
    return next;
  }

  return {
    minX: Math.min(current.minX, next.minX),
    minY: Math.min(current.minY, next.minY),
    maxX: Math.max(current.maxX, next.maxX),
    maxY: Math.max(current.maxY, next.maxY),
  };
}

function deriveDocumentBounds(
  document: SchematicDocument | null,
): Bounds | null {
  if (!document) {
    return null;
  }

  let bounds: Bounds | null = null;

  for (const symbol of document.symbols) {
    bounds = includeBounds(bounds, getSymbolBodyBounds(symbol));
  }

  for (const wire of document.wires) {
    for (const point of wire.points) {
      bounds = includePointInBounds(bounds, point);
    }
  }

  for (const label of document.labels) {
    bounds = includePointInBounds(bounds, label.position);
  }

  return bounds;
}

function getResetViewport(
  document: SchematicDocument | null,
  canvasWidth?: number,
  canvasHeight?: number,
): Viewport {
  return fitViewportToBounds(
    deriveDocumentBounds(document),
    canvasWidth,
    canvasHeight,
  );
}

function createWireId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `wire-${Date.now()}`;
}

function getUpdatedSymbolPositions(
  document: SchematicDocument,
  symbolIds: string[],
  positions: Record<string, Point>,
  delta: Point,
): SchematicDocument {
  const movedSymbolIds = new Set(symbolIds);

  return {
    ...document,
    symbols: document.symbols.map((symbol) =>
      movedSymbolIds.has(symbol.id)
        ? {
            ...symbol,
            position: {
              x: (positions[symbol.id]?.x ?? symbol.position.x) + delta.x,
              y: (positions[symbol.id]?.y ?? symbol.position.y) + delta.y,
            },
          }
        : symbol,
    ),
  };
}

function resolveDocumentSymbolsFromLibrary(
  document: SchematicDocument,
  index: ComponentLibraryIndex,
): SchematicDocument {
  return {
    ...document,
    symbols: document.symbols.map((symbol) =>
      resolveSymbolEntityFromLibrary(symbol, index),
    ),
  };
}

export const useSchematicStore = create<SchematicState>((set, get) => ({
  persisted: {
    document: null,
    projectId: null,
    designId: null,
  },
  derived: INITIAL_DERIVED_STATE,
  chrome: INITIAL_CHROME_STATE,
  session: null,
  draggedSymbolKind: null,
  componentLibraryIndex: EMPTY_COMPONENT_LIBRARY_INDEX,

  setViewport: (viewport) => {
    if (
      !Number.isFinite(viewport.zoom) ||
      viewport.zoom < MIN_VIEWPORT_ZOOM ||
      viewport.zoom > MAX_VIEWPORT_ZOOM
    ) {
      throw new RangeError(
        `Invalid viewport.zoom: ${viewport.zoom}. Must be between ${MIN_VIEWPORT_ZOOM} and ${MAX_VIEWPORT_ZOOM}.`,
      );
    }

    set((state) => ({
      chrome: {
        ...state.chrome,
        viewport,
      },
    }));
  },

  pan: (dx, dy) =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        viewport: {
          ...state.chrome.viewport,
          offsetX: state.chrome.viewport.offsetX + dx,
          offsetY: state.chrome.viewport.offsetY + dy,
        },
      },
    })),

  zoomAt: (centerX, centerY, factor) =>
    set((state) => {
      const newZoom = clampViewportZoom(state.chrome.viewport.zoom * factor);
      const ratio = newZoom / state.chrome.viewport.zoom;

      return {
        chrome: {
          ...state.chrome,
          viewport: {
            zoom: newZoom,
            offsetX:
              centerX - (centerX - state.chrome.viewport.offsetX) * ratio,
            offsetY:
              centerY - (centerY - state.chrome.viewport.offsetY) * ratio,
          },
        },
      };
    }),

  resetViewport: (canvasWidth, canvasHeight) =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        viewport: getResetViewport(
          state.persisted.document,
          canvasWidth,
          canvasHeight,
        ),
      },
    })),

  activateTool: (tool) =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        activeTool: tool,
      },
      session: tool === state.chrome.activeTool ? state.session : null,
    })),

  beginPlacement: (kind) =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        activeTool: "place",
      },
      session: {
        type: "placement",
        symbolKind: kind,
        rotation: state.chrome.placementRotation,
        previewPosition: null,
      },
    })),

  setPlacementPreview: (position) =>
    set((state) => {
      if (state.session?.type !== "placement") {
        return state;
      }

      return {
        session: {
          ...state.session,
          previewPosition: position,
        },
      };
    }),

  commitPlacement: (position) =>
    set((state) => {
      const document = state.persisted.document;
      if (state.session?.type !== "placement" || !document) {
        return state;
      }

      const symbol = createSymbolEntity(
        state.session.symbolKind,
        position,
        state.session.rotation,
        document.symbols,
        state.componentLibraryIndex,
      );
      const nextDocument = {
        ...document,
        symbols: [...document.symbols, symbol],
      };

      return {
        persisted: {
          ...state.persisted,
          document: nextDocument,
        },
        derived: {
          ...state.derived,
          connectivity: deriveConnectivity(nextDocument),
          documentBounds: deriveDocumentBounds(nextDocument),
          hitTestCache: createHitTestCache(nextDocument.symbols),
        },
        chrome: {
          ...state.chrome,
          activeTool: "select",
          ...updateSelection([symbol.id], nextDocument),
        },
        session: null,
      };
    }),

  rotatePlacement: () =>
    set((state) => {
      const placementRotation = ((state.chrome.placementRotation + 90) %
        360) as Rotation;

      return {
        chrome: {
          ...state.chrome,
          placementRotation,
        },
        session:
          state.session?.type === "placement"
            ? {
                ...state.session,
                rotation: placementRotation,
              }
            : state.session,
      };
    }),

  beginWire: (sourcePinId) =>
    set((state) => ({
      session: {
        type: "wire",
        sourcePinId,
        waypoints: [],
        previewPoints: [],
        targetPinId: null,
      },
      chrome: {
        ...state.chrome,
        selectedEntityIds: new Set(),
        popoverEntityId: null,
      },
    })),

  beginDragMove: (symbolIds, anchorSymbolId, startPointer) =>
    set((state) => {
      const document = state.persisted.document;
      if (!document) {
        return state;
      }

      const initialPositions = Object.fromEntries(
        symbolIds.map((symbolId) => [
          symbolId,
          document.symbols.find((symbol) => symbol.id === symbolId)
            ?.position ?? {
            x: 0,
            y: 0,
          },
        ]),
      ) as Record<string, Point>;

      return {
        session: {
          type: "drag",
          symbolIds,
          anchorSymbolId,
          startPointer,
          lastSnappedDelta: { x: 0, y: 0 },
          initialPositions,
        } satisfies DragSession,
      };
    }),

  updateDragMove: (delta) =>
    set((state) => {
      if (state.session?.type !== "drag") {
        return state;
      }

      const document = state.persisted.document;
      if (!document) {
        return state;
      }

      if (
        delta.x === state.session.lastSnappedDelta.x &&
        delta.y === state.session.lastSnappedDelta.y
      ) {
        return state;
      }

      const nextDocument = getUpdatedSymbolPositions(
        document,
        state.session.symbolIds,
        state.session.initialPositions,
        delta,
      );

      return {
        persisted: {
          ...state.persisted,
          document: nextDocument,
        },
        derived: {
          ...state.derived,
          documentBounds: deriveDocumentBounds(nextDocument),
          hitTestCache: createHitTestCache(nextDocument.symbols),
        },
        session: {
          ...state.session,
          lastSnappedDelta: delta,
        },
      };
    }),

  commitDragMove: () =>
    set((state) => {
      if (state.session?.type !== "drag") {
        return state;
      }

      return {
        session: null,
      };
    }),

  updateWirePreview: (points, targetPinId = null) =>
    set((state) => {
      if (state.session?.type !== "wire") {
        return state;
      }

      return {
        session: {
          ...state.session,
          previewPoints: points,
          targetPinId,
        },
      };
    }),

  addWireWaypoint: (point) =>
    set((state) => {
      if (state.session?.type !== "wire") {
        return state;
      }

      const lastWaypoint = state.session.waypoints.at(-1);
      if (
        lastWaypoint &&
        lastWaypoint.x === point.x &&
        lastWaypoint.y === point.y
      ) {
        return state;
      }

      return {
        session: {
          ...state.session,
          waypoints: [...state.session.waypoints, point],
        },
      };
    }),

  commitWire: (targetPinId) => {
    let didCommit = false;

    set((state) => {
      if (state.session?.type !== "wire") {
        return state;
      }

      const document = state.persisted.document;
      if (!document || state.session.sourcePinId === targetPinId) {
        return state;
      }

      const sourcePoint = findPinAnchor(document, state.session.sourcePinId);
      const targetPoint = findPinAnchor(document, targetPinId);
      if (!sourcePoint || !targetPoint) {
        return state;
      }

      const points = buildOrthogonalWirePathWithWaypoints(
        sourcePoint,
        state.session.waypoints,
        targetPoint,
      );
      if (points.length < 2 || getWireLength(points) <= 0) {
        return state;
      }

      const nextWire: WireEntity = {
        id: createWireId(),
        entityType: "wire",
        position: points[0]!,
        rotation: 0,
        mirrored: false,
        points,
        sourcePinId: state.session.sourcePinId,
        targetPinId,
        net: null,
      };
      const nextDocument = {
        ...document,
        wires: [...document.wires, nextWire],
      };
      didCommit = true;

      return {
        persisted: {
          ...state.persisted,
          document: nextDocument,
        },
        derived: {
          ...state.derived,
          connectivity: deriveConnectivity(nextDocument),
          documentBounds: deriveDocumentBounds(nextDocument),
          hitTestCache: createHitTestCache(nextDocument.symbols),
        },
        session: null,
      };
    });

    return didCommit;
  },

  setPaletteDragSymbolKind: (draggedSymbolKind) =>
    set(() => ({
      draggedSymbolKind,
    })),

  cancelSession: () =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        activeTool:
          state.session?.type === "placement" &&
          state.chrome.activeTool === "place"
            ? "select"
            : state.chrome.activeTool,
      },
      session: null,
      draggedSymbolKind: null,
    })),

  selectEntities: (ids) =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        ...updateSelection(ids, state.persisted.document),
      },
    })),

  addToSelection: (ids) =>
    set((state) => {
      const nextIds = new Set(state.chrome.selectedEntityIds);
      for (const id of ids) {
        nextIds.add(id);
      }

      return {
        chrome: {
          ...state.chrome,
          selectedEntityIds: nextIds,
          popoverEntityId: derivePopoverTargetId(
            state.persisted.document,
            nextIds,
          ),
        },
      };
    }),

  clearSelection: () =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        selectedEntityIds: new Set(),
        popoverEntityId: null,
      },
    })),

  selectAll: () => {
    const document = get().persisted.document;
    if (!document) {
      return;
    }

    const allIds = [
      ...document.symbols.map((symbol) => symbol.id),
      ...document.wires.map((wire) => wire.id),
      ...document.labels.map((label) => label.id),
    ];

    set((state) => ({
      chrome: {
        ...state.chrome,
        ...updateSelection(allIds, document),
      },
    }));
  },

  setPopoverTarget: (id) =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        popoverEntityId: id,
      },
    })),

  deleteSelectedEntities: () =>
    set((state) => {
      const document = state.persisted.document;
      const selectedEntityIds = state.chrome.selectedEntityIds;

      if (!document || selectedEntityIds.size === 0) {
        return state;
      }

      const symbolIds = new Set(
        document.symbols
          .filter((symbol) => selectedEntityIds.has(symbol.id))
          .map((symbol) => symbol.id),
      );
      const wireIds = new Set(
        document.wires
          .filter((wire) => selectedEntityIds.has(wire.id))
          .map((wire) => wire.id),
      );
      const labelIds = new Set(
        document.labels
          .filter((label) => selectedEntityIds.has(label.id))
          .map((label) => label.id),
      );

      const deletedPinIds = new Set<string>();
      for (const symbol of document.symbols) {
        if (!symbolIds.has(symbol.id)) {
          continue;
        }

        for (const pin of symbol.pins) {
          deletedPinIds.add(pin.id);
        }
      }

      const wireIdsToDelete = new Set(wireIds);
      for (const wireId of collectConnectedWireIds(
        document.wires,
        deletedPinIds,
      )) {
        wireIdsToDelete.add(wireId);
      }

      const nextDocument = {
        ...document,
        symbols: document.symbols.filter((symbol) => !symbolIds.has(symbol.id)),
        wires: document.wires.filter((wire) => !wireIdsToDelete.has(wire.id)),
        labels: document.labels.filter((label) => !labelIds.has(label.id)),
      };

      return {
        persisted: {
          ...state.persisted,
          document: nextDocument,
        },
        derived: {
          ...state.derived,
          connectivity: deriveConnectivity(nextDocument),
          documentBounds: deriveDocumentBounds(nextDocument),
          hitTestCache: createHitTestCache(nextDocument.symbols),
        },
        chrome: {
          ...state.chrome,
          selectedEntityIds: new Set(),
          popoverEntityId: null,
        },
      };
    }),

  setDocument: (document) =>
    set((state) => {
      const normalizedDocument =
        "name" in document
          ? normalizeSchematicDocument(document)
          : toEditorSchematicDocument(document);
      const resolvedDocument = resolveDocumentSymbolsFromLibrary(
        normalizedDocument,
        state.componentLibraryIndex,
      );

      return {
        persisted: {
          ...state.persisted,
          document: resolvedDocument,
        },
        derived: {
          ...state.derived,
          connectivity: deriveConnectivity(resolvedDocument),
          documentBounds: deriveDocumentBounds(resolvedDocument),
          hitTestCache: createHitTestCache(resolvedDocument.symbols),
        },
        chrome: {
          ...state.chrome,
          viewport: getResetViewport(resolvedDocument),
          selectedEntityIds: new Set(),
          activeTool: "select",
          popoverEntityId: null,
        },
        session: null,
        draggedSymbolKind: null,
      };
    }),

  clearDocument: () =>
    set(() => ({
      persisted: {
        document: null,
        projectId: null,
        designId: null,
      },
      derived: INITIAL_DERIVED_STATE,
      chrome: {
        ...INITIAL_CHROME_STATE,
      },
      session: null,
      draggedSymbolKind: null,
    })),

  setComponentLibrary: (components) =>
    set((state) => {
      const componentLibraryIndex = createComponentLibraryIndex(components);

      if (!state.persisted.document) {
        return {
          componentLibraryIndex,
        };
      }

      const resolvedDocument = resolveDocumentSymbolsFromLibrary(
        state.persisted.document,
        componentLibraryIndex,
      );

      return {
        componentLibraryIndex,
        persisted: {
          ...state.persisted,
          document: resolvedDocument,
        },
        derived: {
          ...state.derived,
          connectivity: deriveConnectivity(resolvedDocument),
          documentBounds: deriveDocumentBounds(resolvedDocument),
          hitTestCache: createHitTestCache(resolvedDocument.symbols),
        },
      };
    }),

  setProjectContext: (projectId, designId) =>
    set((state) => ({
      persisted: {
        ...state.persisted,
        projectId,
        designId,
      },
    })),

  setConnectivity: (connectivity) =>
    set((state) => ({
      derived: {
        ...state.derived,
        connectivity,
      },
    })),

  setDocumentBounds: (documentBounds) =>
    set((state) => ({
      derived: {
        ...state.derived,
        documentBounds,
      },
    })),

  setHitTestCache: (hitTestCache) =>
    set((state) => ({
      derived: {
        ...state.derived,
        hitTestCache,
      },
    })),

  setGridSize: (gridSize) => {
    if (!Number.isFinite(gridSize) || gridSize <= 0) {
      throw new RangeError(
        `Invalid gridSize: ${gridSize}. Must be positive finite number.`,
      );
    }

    set((state) => ({
      chrome: {
        ...state.chrome,
        gridSize,
      },
    }));
  },

  toggleGrid: () =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        showGrid: !state.chrome.showGrid,
      },
    })),

  setGridPreset: (presetId: string) =>
    set((state) => {
      const preset = GRID_PRESETS.find((p) => p.id === presetId);
      if (!preset) return state;
      return {
        chrome: {
          ...state.chrome,
          gridPresetId: presetId,
          gridSize: preset.size,
        },
      };
    }),

  updateSymbolValue: (symbolId: string, value: string) =>
    set((state) => {
      const document = state.persisted.document;
      if (!document) return state;

      const symbolIndex = document.symbols.findIndex((s) => s.id === symbolId);
      if (symbolIndex === -1) return state;

      const updatedSymbols = [...document.symbols];
      const existingSymbol = updatedSymbols[symbolIndex];
      if (!existingSymbol) return state;

      updatedSymbols[symbolIndex] = {
        ...existingSymbol,
        value,
      };

      const nextDocument = {
        ...document,
        symbols: updatedSymbols,
      };

      return {
        persisted: {
          ...state.persisted,
          document: nextDocument,
        },
        derived: {
          ...state.derived,
          documentBounds: deriveDocumentBounds(nextDocument),
        },
      };
    }),
}));
