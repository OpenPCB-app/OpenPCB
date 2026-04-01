import { create } from "zustand";
import { createSymbolEntity } from "@/components/pcb/symbol-library";
import {
  normalizeSchematicDocument,
  toEditorSchematicDocument,
} from "@/components/pcb/types";
import type { SchematicProjectDocument } from "@shared/types";
import { createHitTestCache } from "@/components/pcb/canvas/hit-test";
import type {
  Bounds,
  DerivedConnectivity,
  DerivedSchematicState,
  EditorChromeState,
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
  buildOrthogonalWirePath,
  deriveWireJunctions,
  getWireLength,
} from "@/components/pcb/canvas/wires";
import { getSymbolBodyBounds, transformSymbolLocalPoint } from "@/components/pcb/canvas/symbols";
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
  sheetId: string | null;
}

interface SchematicState {
  persisted: PersistedDocumentState;
  derived: DerivedSchematicState;
  chrome: EditorChromeState;
  session: InteractionSession;
  draggedSymbolKind: SymbolKind | null;

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
  updateWirePreview: (points: Array<{ x: number; y: number }>, targetPinId?: string | null) => void;
  commitWire: (targetPinId: string) => boolean;
  setPaletteDragSymbolKind: (kind: SymbolKind | null) => void;
  cancelSession: () => void;

  selectEntities: (ids: string[]) => void;
  addToSelection: (ids: string[]) => void;
  clearSelection: () => void;
  selectAll: () => void;
  setPopoverTarget: (id: string | null) => void;

  setDocument: (doc: SchematicDocument | SchematicProjectDocument) => void;
  setProjectContext: (projectId: string | null, sheetId: string | null) => void;
  setConnectivity: (conn: DerivedConnectivity | null) => void;
  setDocumentBounds: (bounds: Bounds | null) => void;
  setHitTestCache: (cache: HitTestCache) => void;

  setGridSize: (size: number) => void;
  toggleGrid: () => void;
}

const DEFAULT_GRID_NM = 1_270_000;

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

function includePointInBounds(
  bounds: Bounds | null,
  point: Point,
): Bounds {
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

function includeBounds(
  current: Bounds | null,
  next: Bounds,
): Bounds {
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

function deriveDocumentBounds(document: SchematicDocument | null): Bounds | null {
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

export const useSchematicStore = create<SchematicState>((set, get) => ({
  persisted: {
    document: null,
    projectId: null,
    sheetId: null,
  },
  derived: INITIAL_DERIVED_STATE,
  chrome: INITIAL_CHROME_STATE,
  session: null,
  draggedSymbolKind: null,

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
            offsetX: centerX - (centerX - state.chrome.viewport.offsetX) * ratio,
            offsetY: centerY - (centerY - state.chrome.viewport.offsetY) * ratio,
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
      const placementRotation = ((state.chrome.placementRotation + 90) % 360) as Rotation;

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
        previewPoints: [],
        targetPinId: null,
      },
      chrome: {
        ...state.chrome,
        selectedEntityIds: new Set(),
        popoverEntityId: null,
      },
    })),

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

      const points = buildOrthogonalWirePath(sourcePoint, targetPoint);
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
          state.session?.type === "placement" && state.chrome.activeTool === "place"
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
      ids.forEach((id) => nextIds.add(id));

      return {
        chrome: {
          ...state.chrome,
          selectedEntityIds: nextIds,
          popoverEntityId: derivePopoverTargetId(state.persisted.document, nextIds),
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

  setDocument: (document) =>
    set((state) => {
      const normalizedDocument =
        "name" in document
          ? normalizeSchematicDocument(document)
          : toEditorSchematicDocument(document);

      return {
        persisted: {
          ...state.persisted,
          document: normalizedDocument,
        },
        derived: {
          ...state.derived,
          connectivity: deriveConnectivity(normalizedDocument),
          documentBounds: deriveDocumentBounds(normalizedDocument),
          hitTestCache: createHitTestCache(normalizedDocument.symbols),
        },
        chrome: {
          ...state.chrome,
          viewport: getResetViewport(normalizedDocument),
          selectedEntityIds: new Set(),
          activeTool: "select",
          popoverEntityId: null,
        },
        session: null,
        draggedSymbolKind: null,
      };
    }),

  setProjectContext: (projectId, sheetId) =>
    set((state) => ({
      persisted: {
        ...state.persisted,
        projectId,
        sheetId,
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
      throw new RangeError(`Invalid gridSize: ${gridSize}. Must be positive finite number.`);
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
}));
