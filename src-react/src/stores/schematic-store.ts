import { create } from "zustand";
import type {
  SchematicDocument,
  DerivedConnectivity,
  Viewport,
  ToolMode,
  InteractionState,
  SymbolKind,
  Rotation,
} from "@/components/pcb/types";

interface SchematicState {
  // Document (synced from backend)
  document: SchematicDocument | null;
  connectivity: DerivedConnectivity | null;
  projectId: string | null;
  sheetId: string | null;

  // Viewport
  viewport: Viewport;

  // Selection
  selectedEntityIds: Set<string>;

  // Tool state
  activeTool: ToolMode;
  placingSymbolKind: SymbolKind | null;
  placingRotation: Rotation;

  // Interaction
  interaction: InteractionState;

  // Grid
  gridSize: number; // in nanometers (default 2.54mm = 2540000nm)
  showGrid: boolean;

  // Actions - viewport
  setViewport: (viewport: Viewport) => void;
  pan: (dx: number, dy: number) => void;
  zoomAt: (centerX: number, centerY: number, factor: number) => void;
  fitToContent: () => void;

  // Actions - tool
  setTool: (tool: ToolMode) => void;
  setPlacingSymbol: (kind: SymbolKind | null) => void;
  rotatePlacing: () => void;

  // Actions - selection
  selectEntities: (ids: string[]) => void;
  addToSelection: (ids: string[]) => void;
  clearSelection: () => void;
  selectAll: () => void;

  // Actions - interaction
  updateInteraction: (partial: Partial<InteractionState>) => void;
  resetInteraction: () => void;

  // Actions - document
  setDocument: (doc: SchematicDocument) => void;
  setConnectivity: (conn: DerivedConnectivity) => void;

  // Actions - grid
  setGridSize: (size: number) => void;
  toggleGrid: () => void;
}

const INITIAL_INTERACTION: InteractionState = {
  wireVertices: [],
  placingGhost: null,
  selectionBox: null,
  dragOffset: null,
};

// Default grid: 2.54mm = 2,540,000 nanometers (standard 100mil grid)
const DEFAULT_GRID_NM = 2_540_000;

export const useSchematicStore = create<SchematicState>((set, get) => ({
  document: null,
  connectivity: null,
  projectId: null,
  sheetId: null,

  viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
  selectedEntityIds: new Set(),

  activeTool: "select",
  placingSymbolKind: null,
  placingRotation: 0,

  interaction: { ...INITIAL_INTERACTION },

  gridSize: DEFAULT_GRID_NM,
  showGrid: true,

  // Viewport
  setViewport: (viewport) => set({ viewport }),

  pan: (dx, dy) =>
    set((s) => ({
      viewport: {
        ...s.viewport,
        offsetX: s.viewport.offsetX + dx,
        offsetY: s.viewport.offsetY + dy,
      },
    })),

  zoomAt: (centerX, centerY, factor) =>
    set((s) => {
      const newZoom = Math.max(0.05, Math.min(50, s.viewport.zoom * factor));
      const ratio = newZoom / s.viewport.zoom;
      return {
        viewport: {
          zoom: newZoom,
          offsetX: centerX - (centerX - s.viewport.offsetX) * ratio,
          offsetY: centerY - (centerY - s.viewport.offsetY) * ratio,
        },
      };
    }),

  fitToContent: () => {
    // Will be implemented when entities exist
    set({ viewport: { offsetX: 0, offsetY: 0, zoom: 1 } });
  },

  // Tool
  setTool: (tool) =>
    set({
      activeTool: tool,
      interaction: { ...INITIAL_INTERACTION },
      ...(tool !== "place" ? { placingSymbolKind: null } : {}),
    }),

  setPlacingSymbol: (kind) =>
    set({
      activeTool: kind ? "place" : "select",
      placingSymbolKind: kind,
      placingRotation: 0,
      interaction: { ...INITIAL_INTERACTION },
    }),

  rotatePlacing: () =>
    set((s) => ({
      placingRotation: ((s.placingRotation + 90) % 360) as Rotation,
    })),

  // Selection
  selectEntities: (ids) => set({ selectedEntityIds: new Set(ids) }),
  addToSelection: (ids) =>
    set((s) => {
      const next = new Set(s.selectedEntityIds);
      ids.forEach((id) => next.add(id));
      return { selectedEntityIds: next };
    }),
  clearSelection: () => set({ selectedEntityIds: new Set() }),
  selectAll: () => {
    const doc = get().document;
    if (!doc) return;
    const allIds = [
      ...doc.symbols.map((s) => s.id),
      ...doc.wires.map((w) => w.id),
      ...doc.labels.map((l) => l.id),
    ];
    set({ selectedEntityIds: new Set(allIds) });
  },

  // Interaction
  updateInteraction: (partial) =>
    set((s) => ({
      interaction: { ...s.interaction, ...partial },
    })),
  resetInteraction: () => set({ interaction: { ...INITIAL_INTERACTION } }),

  // Document
  setDocument: (doc) => set({ document: doc }),
  setConnectivity: (conn) => set({ connectivity: conn }),

  // Grid
  setGridSize: (size) => set({ gridSize: size }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
}));
