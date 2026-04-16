import { create } from "zustand";
import type {
  PreviewGraphic,
  PointMm,
  SymbolRenderSource,
  SymbolRenderSourcePin,
  SymbolRenderSourceGraphic,
} from "../../../../../shared/rendering/types";
import type {
  EditorGraphicElement,
  EditorPinElement,
  EditorSnapshot,
  EditorToolId,
} from "./types";

const MAX_UNDO = 50;

let nextId = 1;
export function editorId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

export function snapToGrid(value: number, gridMm: number): number {
  return Math.round(value / gridMm) * gridMm;
}

export function snapPointToGrid(point: PointMm, gridMm: number): PointMm {
  return {
    x: snapToGrid(point.x, gridMm),
    y: snapToGrid(point.y, gridMm),
  };
}

export interface SymbolEditorState {
  // Document
  graphics: EditorGraphicElement[];
  pins: EditorPinElement[];
  referencePrefix: string;

  // Undo/redo
  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];

  // Tool
  activeTool: EditorToolId;

  // Selection
  selectedIds: Set<string>;

  // Preview (rubber-band during drawing)
  previewGraphic: PreviewGraphic | null;

  // Grid
  gridSizeMm: number;
  gridVisible: boolean;

  // Actions — document
  addGraphic: (graphic: PreviewGraphic) => void;
  addPin: (pin: Omit<EditorPinElement, "id">) => void;
  setGraphic: (id: string, graphic: PreviewGraphic) => void;
  setPinPosition: (id: string, positionMm: PointMm) => void;
  updatePin: (id: string, patch: Partial<Omit<EditorPinElement, "id">>) => void;
  removeSelected: () => void;
  setReferencePrefix: (prefix: string) => void;

  // Actions — tool
  setActiveTool: (tool: EditorToolId) => void;

  // Actions — selection
  setSelection: (ids: Set<string>) => void;
  clearSelection: () => void;

  // Actions — preview
  setPreviewGraphic: (graphic: PreviewGraphic | null) => void;

  // Actions — grid
  setGridSizeMm: (size: number) => void;
  setGridVisible: (visible: boolean) => void;

  // Actions — undo/redo
  pushSnapshot: () => void;
  undo: () => void;
  redo: () => void;

  // Conversion
  toSymbolRenderSource: () => SymbolRenderSource;

  // Reset
  reset: () => void;
}

const INITIAL_STATE = {
  graphics: [] as EditorGraphicElement[],
  pins: [] as EditorPinElement[],
  referencePrefix: "U",
  undoStack: [] as EditorSnapshot[],
  redoStack: [] as EditorSnapshot[],
  activeTool: "select" as EditorToolId,
  selectedIds: new Set<string>(),
  previewGraphic: null as PreviewGraphic | null,
  gridSizeMm: 1.27,
  gridVisible: true,
};

export const useSymbolEditorStore = create<SymbolEditorState>((set, get) => ({
  ...INITIAL_STATE,

  addGraphic: (graphic) => {
    const state = get();
    const element: EditorGraphicElement = {
      id: editorId("g"),
      graphic,
    };
    set({
      graphics: [...state.graphics, element],
      redoStack: [],
    });
  },

  addPin: (pin) => {
    const state = get();
    const element: EditorPinElement = {
      ...pin,
      id: editorId("p"),
    };
    set({
      pins: [...state.pins, element],
      redoStack: [],
    });
  },

  setGraphic: (id, graphic) => {
    const state = get();
    set({
      graphics: state.graphics.map((g) =>
        g.id === id ? { ...g, graphic } : g,
      ),
    });
  },

  setPinPosition: (id, positionMm) => {
    const state = get();
    set({
      pins: state.pins.map((p) => (p.id === id ? { ...p, positionMm } : p)),
    });
  },

  updatePin: (id, patch) => {
    const state = get();
    set({
      pins: state.pins.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  },

  removeSelected: () => {
    const state = get();
    if (state.selectedIds.size === 0) return;
    set({
      graphics: state.graphics.filter((g) => !state.selectedIds.has(g.id)),
      pins: state.pins.filter((p) => !state.selectedIds.has(p.id)),
      selectedIds: new Set(),
      redoStack: [],
    });
  },

  setReferencePrefix: (prefix) => set({ referencePrefix: prefix }),

  setActiveTool: (tool) =>
    set({ activeTool: tool, previewGraphic: null, selectedIds: new Set() }),

  setSelection: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: new Set() }),

  setPreviewGraphic: (graphic) => set({ previewGraphic: graphic }),

  setGridSizeMm: (size) => set({ gridSizeMm: size }),
  setGridVisible: (visible) => set({ gridVisible: visible }),

  pushSnapshot: () => {
    const state = get();
    const snapshot: EditorSnapshot = {
      graphics: state.graphics,
      pins: state.pins,
    };
    const stack = [...state.undoStack, snapshot];
    if (stack.length > MAX_UNDO) stack.shift();
    set({ undoStack: stack, redoStack: [] });
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const snapshot = state.undoStack[state.undoStack.length - 1]!;
    const currentSnapshot: EditorSnapshot = {
      graphics: state.graphics,
      pins: state.pins,
    };
    set({
      graphics: [...snapshot.graphics],
      pins: [...snapshot.pins],
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnapshot],
      selectedIds: new Set(),
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const snapshot = state.redoStack[state.redoStack.length - 1]!;
    const currentSnapshot: EditorSnapshot = {
      graphics: state.graphics,
      pins: state.pins,
    };
    set({
      graphics: [...snapshot.graphics],
      pins: [...snapshot.pins],
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, currentSnapshot],
      selectedIds: new Set(),
    });
  },

  toSymbolRenderSource: (): SymbolRenderSource => {
    const state = get();
    const sourceGraphics: SymbolRenderSourceGraphic[] = state.graphics.map(
      (g) => ({
        unit: 1,
        graphic: g.graphic,
      }),
    );

    const sourcePins: SymbolRenderSourcePin[] = state.pins.map((p, i) => ({
      id: p.id,
      name: p.name,
      number: p.number,
      electricalType: p.electricalType,
      positionMm: p.positionMm,
      lengthMm: p.lengthMm,
      rotationDeg: p.rotationDeg,
      unit: 1,
      hidden: false,
    }));

    return {
      name: state.referencePrefix || "U",
      unitCount: 1,
      referenceText: `${state.referencePrefix}?`,
      valueText: state.referencePrefix || "U",
      pins: sourcePins,
      graphics: sourceGraphics,
      warnings: [],
    };
  },

  reset: () => {
    nextId = 1;
    set({ ...INITIAL_STATE, selectedIds: new Set() });
  },
}));
