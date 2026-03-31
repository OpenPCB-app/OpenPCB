import { create } from "zustand";
import type {
  Bounds,
  DerivedConnectivity,
  DerivedSchematicState,
  EditorChromeState,
  HitTestCache,
  InteractionSession,
  Rotation,
  SchematicDocument,
  SymbolKind,
  ToolMode,
  Viewport,
} from "@/components/pcb/types";

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

  setViewport: (viewport: Viewport) => void;
  pan: (dx: number, dy: number) => void;
  zoomAt: (centerX: number, centerY: number, factor: number) => void;
  fitToContent: () => void;

  activateTool: (tool: ToolMode) => void;
  beginPlacement: (kind: SymbolKind) => void;
  setPlacementPreview: (position: { x: number; y: number } | null) => void;
  rotatePlacement: () => void;
  beginWire: (sourcePinId: string) => void;
  updateWirePreview: (points: Array<{ x: number; y: number }>, targetPinId?: string | null) => void;
  cancelSession: () => void;

  selectEntities: (ids: string[]) => void;
  addToSelection: (ids: string[]) => void;
  clearSelection: () => void;
  selectAll: () => void;
  setPopoverTarget: (id: string | null) => void;

  setDocument: (doc: SchematicDocument) => void;
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
  viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
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

export const useSchematicStore = create<SchematicState>((set, get) => ({
  persisted: {
    document: null,
    projectId: null,
    sheetId: null,
  },
  derived: INITIAL_DERIVED_STATE,
  chrome: INITIAL_CHROME_STATE,
  session: null,

  setViewport: (viewport) =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        viewport,
      },
    })),

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
      const newZoom = Math.max(0.05, Math.min(50, state.chrome.viewport.zoom * factor));
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

  fitToContent: () =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
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
    set((state) => ({
      persisted: {
        ...state.persisted,
        document,
      },
      chrome: {
        ...state.chrome,
        popoverEntityId: derivePopoverTargetId(document, state.chrome.selectedEntityIds),
      },
    })),

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

  setGridSize: (gridSize) =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        gridSize,
      },
    })),

  toggleGrid: () =>
    set((state) => ({
      chrome: {
        ...state.chrome,
        showGrid: !state.chrome.showGrid,
      },
    })),
}));
