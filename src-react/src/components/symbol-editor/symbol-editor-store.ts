/**
 * Symbol Editor Store
 *
 * Local zustand store for the Step 1 symbol editor.
 * Completely separate from the schematic editor store.
 */

import { create } from "zustand";
import {
  type SymbolDraft,
  type SymbolPin,
  type EditorChrome,
  type HistoryState,
  type Viewport,
  type EditorTool,
  type BodyPresetKind,
  type Point,
  type Nanometers,
  createEmptyDraft,
  createDefaultChrome,
  createDefaultHistory,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_BODY_WIDTH,
  DEFAULT_BODY_HEIGHT,
  PASSIVE_BODY_WIDTH,
  PASSIVE_BODY_HEIGHT,
} from "./types";

// ---------------------------------------------------------------------------
// Store Interface
// ---------------------------------------------------------------------------

interface SymbolEditorState {
  /** Current symbol draft */
  draft: SymbolDraft;
  /** Editor UI state */
  chrome: EditorChrome;
  /** Undo/redo history */
  history: HistoryState;
  /** Whether draft has unsaved changes */
  isDirty: boolean;

  // Draft actions
  setDraft: (draft: SymbolDraft) => void;
  resetDraft: (id?: string) => void;
  updateMetadata: (updates: Partial<SymbolDraft["metadata"]>) => void;
  setBodyPreset: (kind: BodyPresetKind) => void;
  resizeBody: (width: Nanometers, height: Nanometers) => void;

  // Pin actions
  addPin: (pin: SymbolPin) => void;
  updatePin: (id: string, updates: Partial<Omit<SymbolPin, "id">>) => void;
  removePin: (id: string) => void;
  removePins: (ids: string[]) => void;
  movePin: (id: string, position: Point) => void;

  // Graphic actions
  setGraphics: (graphics: SymbolDraft["graphics"]) => void;
  updateGraphic: (id: string, graphic: SymbolDraft["graphics"][number]) => void;
  removeGraphics: (ids: string[]) => void;

  // Selection actions
  selectPin: (id: string, additive?: boolean) => void;
  selectGraphic: (id: string, additive?: boolean) => void;
  selectPins: (ids: string[]) => void;
  clearSelection: () => void;
  selectAllPins: () => void;

  // Viewport actions
  setViewport: (viewport: Viewport) => void;
  pan: (dx: number, dy: number) => void;
  zoomAt: (centerX: number, centerY: number, factor: number) => void;
  resetViewport: () => void;

  // Tool actions
  setTool: (tool: EditorTool) => void;

  // Grid actions
  setGridSize: (size: Nanometers) => void;
  toggleGrid: () => void;

  // History actions
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  clearHistory: () => void;

  // Dirty state
  markClean: () => void;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function getBodyDimensionsForPreset(kind: BodyPresetKind): {
  width: Nanometers;
  height: Nanometers;
} {
  switch (kind) {
    case "blank":
      return { width: DEFAULT_BODY_WIDTH, height: DEFAULT_BODY_HEIGHT };
    case "ic_box":
      return { width: DEFAULT_BODY_WIDTH, height: DEFAULT_BODY_HEIGHT };
    case "opamp":
      return { width: DEFAULT_BODY_WIDTH, height: DEFAULT_BODY_HEIGHT };
    case "two_pin_passive":
      return { width: PASSIVE_BODY_WIDTH, height: PASSIVE_BODY_HEIGHT };
    case "transistor":
      return { width: DEFAULT_BODY_WIDTH, height: DEFAULT_BODY_WIDTH };
    case "diode":
      return { width: PASSIVE_BODY_WIDTH * 2, height: PASSIVE_BODY_HEIGHT * 2 };
    case "connector":
      return { width: DEFAULT_BODY_WIDTH, height: DEFAULT_BODY_HEIGHT };
    case "voltage_regulator":
      return { width: DEFAULT_BODY_WIDTH, height: DEFAULT_BODY_HEIGHT };
    default:
      kind satisfies never;
      return { width: DEFAULT_BODY_WIDTH, height: DEFAULT_BODY_HEIGHT };
  }
}

function createHistorySnapshot(draft: SymbolDraft): SymbolDraft {
  return {
    ...draft,
    metadata: { ...draft.metadata },
    body: { ...draft.body },
    pins: draft.pins.map((p) => ({ ...p, position: { ...p.position } })),
    graphics: draft.graphics.map(cloneGraphic),
    importPreservation: draft.importPreservation
      ? {
          ...draft.importPreservation,
          warnings: [...draft.importPreservation.warnings],
        }
      : null,
  };
}

function cloneGraphic(graphic: SymbolDraft["graphics"][number]): SymbolDraft["graphics"][number] {
  if (graphic.type === "polygon") {
    return { ...graphic, points: graphic.points.map((point) => ({ ...point })) };
  }
  if (graphic.type === "bezier") {
    return {
      ...graphic,
      points: graphic.points.map((point) => ({ ...point })) as typeof graphic.points,
    };
  }
  return { ...graphic };
}

// ---------------------------------------------------------------------------
// Store Factory
// ---------------------------------------------------------------------------

export function createSymbolEditorStore(initialDraftId?: string) {
  return create<SymbolEditorState>((set, get) => ({
    draft: createEmptyDraft(initialDraftId ?? crypto.randomUUID()),
    chrome: createDefaultChrome(),
    history: createDefaultHistory(),
    isDirty: false,

    // -------------------------------------------------------------------------
    // Draft Actions
    // -------------------------------------------------------------------------

    setDraft: (draft) => {
      set({
        draft,
        chrome: createDefaultChrome(),
        isDirty: false,
        history: createDefaultHistory(),
      });
    },

    resetDraft: (id) => {
      set({
        draft: createEmptyDraft(id ?? crypto.randomUUID()),
        chrome: createDefaultChrome(),
        history: createDefaultHistory(),
        isDirty: false,
      });
    },

    updateMetadata: (updates) => {
      const state = get();
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          metadata: { ...state.draft.metadata, ...updates },
        },
        isDirty: true,
      });
    },

    setBodyPreset: (kind) => {
      const state = get();
      state.pushHistory();
      const dimensions = getBodyDimensionsForPreset(kind);
      set({
        draft: {
          ...state.draft,
          body: { kind, ...dimensions },
        },
        isDirty: true,
      });
    },

    resizeBody: (width, height) => {
      const state = get();
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          body: { ...state.draft.body, width, height },
        },
        isDirty: true,
      });
    },

    // -------------------------------------------------------------------------
    // Pin Actions
    // -------------------------------------------------------------------------

    addPin: (pin) => {
      const state = get();
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          pins: [...state.draft.pins, pin],
        },
        isDirty: true,
      });
    },

    updatePin: (id, updates) => {
      const state = get();
      const pinIndex = state.draft.pins.findIndex((p) => p.id === id);
      if (pinIndex === -1) return;

      state.pushHistory();
      const newPins = [...state.draft.pins];
      newPins[pinIndex] = { ...newPins[pinIndex]!, ...updates };
      set({
        draft: { ...state.draft, pins: newPins },
        isDirty: true,
      });
    },

    removePin: (id) => {
      const state = get();
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          pins: state.draft.pins.filter((p) => p.id !== id),
        },
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedPinIds: new Set(
              [...state.chrome.selection.selectedPinIds].filter(
                (pid) => pid !== id,
              ),
            ),
          },
        },
        isDirty: true,
      });
    },

    removePins: (ids) => {
      const state = get();
      const idSet = new Set(ids);
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          pins: state.draft.pins.filter((p) => !idSet.has(p.id)),
        },
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedPinIds: new Set(
              [...state.chrome.selection.selectedPinIds].filter(
                (pid) => !idSet.has(pid),
              ),
            ),
          },
        },
        isDirty: true,
      });
    },

    movePin: (id, position) => {
      const state = get();
      const pinIndex = state.draft.pins.findIndex((p) => p.id === id);
      if (pinIndex === -1) return;

      const newPins = [...state.draft.pins];
      newPins[pinIndex] = { ...newPins[pinIndex]!, position };
      set({
        draft: { ...state.draft, pins: newPins },
        isDirty: true,
      });
    },

    setGraphics: (graphics) => {
      const state = get();
      state.pushHistory();
      set({
        draft: { ...state.draft, graphics: graphics.map(cloneGraphic) },
        isDirty: true,
      });
    },

    updateGraphic: (id, graphic) => {
      const state = get();
      const graphics = state.draft.graphics.map((entry) =>
        entry.id === id ? cloneGraphic(graphic) : cloneGraphic(entry),
      );
      set({ draft: { ...state.draft, graphics }, isDirty: true });
    },

    removeGraphics: (ids) => {
      const state = get();
      const idSet = new Set(ids);
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          graphics: state.draft.graphics.filter((graphic) => !idSet.has(graphic.id)),
        },
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedGraphicIds: new Set(
              [...state.chrome.selection.selectedGraphicIds].filter((gid) => !idSet.has(gid)),
            ),
          },
        },
        isDirty: true,
      });
    },

    // -------------------------------------------------------------------------
    // Selection Actions
    // -------------------------------------------------------------------------

    selectPin: (id, additive = false) => {
      const state = get();
      const newSelection = additive
        ? new Set([...state.chrome.selection.selectedPinIds, id])
        : new Set([id]);
      set({
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedPinIds: newSelection,
          },
        },
      });
    },

    selectGraphic: (id, additive = false) => {
      const state = get();
      const newSelection = additive
        ? new Set([...state.chrome.selection.selectedGraphicIds, id])
        : new Set([id]);
      set({
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedGraphicIds: newSelection,
          },
        },
      });
    },

    selectPins: (ids) => {
      const state = get();
      set({
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedPinIds: new Set(ids),
          },
        },
      });
    },

    clearSelection: () => {
      const state = get();
      set({
        chrome: {
          ...state.chrome,
          selection: {
            selectedPinIds: new Set(),
            selectedGraphicIds: new Set(),
          },
        },
      });
    },

    selectAllPins: () => {
      const state = get();
      set({
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedPinIds: new Set(state.draft.pins.map((p) => p.id)),
          },
        },
      });
    },

    // -------------------------------------------------------------------------
    // Viewport Actions
    // -------------------------------------------------------------------------

    setViewport: (viewport) => {
      set((state) => ({
        chrome: {
          ...state.chrome,
          viewport: {
            ...viewport,
            zoom: clampZoom(viewport.zoom),
          },
        },
      }));
    },

    pan: (dx, dy) => {
      set((state) => ({
        chrome: {
          ...state.chrome,
          viewport: {
            ...state.chrome.viewport,
            offsetX: state.chrome.viewport.offsetX + dx,
            offsetY: state.chrome.viewport.offsetY + dy,
          },
        },
      }));
    },

    zoomAt: (centerX, centerY, factor) => {
      set((state) => {
        const oldZoom = state.chrome.viewport.zoom;
        const newZoom = clampZoom(oldZoom * factor);
        const ratio = newZoom / oldZoom;

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
      });
    },

    resetViewport: () => {
      set((state) => ({
        chrome: {
          ...state.chrome,
          viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
        },
      }));
    },

    // -------------------------------------------------------------------------
    // Tool Actions
    // -------------------------------------------------------------------------

    setTool: (tool) => {
      set((state) => ({
        chrome: { ...state.chrome, activeTool: tool },
      }));
    },

    // -------------------------------------------------------------------------
    // Grid Actions
    // -------------------------------------------------------------------------

    setGridSize: (size) => {
      set((state) => ({
        chrome: { ...state.chrome, gridSize: size },
      }));
    },

    toggleGrid: () => {
      set((state) => ({
        chrome: { ...state.chrome, showGrid: !state.chrome.showGrid },
      }));
    },

    // -------------------------------------------------------------------------
    // History Actions
    // -------------------------------------------------------------------------

    undo: () => {
      const state = get();
      if (state.history.past.length === 0) return;

      const newPast = [...state.history.past];
      const snapshot = newPast.pop()!;
      const currentSnapshot = createHistorySnapshot(state.draft);

      set({
        draft: snapshot.draft,
        history: {
          ...state.history,
          past: newPast,
          future: [
            { draft: currentSnapshot, timestamp: Date.now() },
            ...state.history.future,
          ].slice(0, state.history.maxDepth),
        },
        isDirty: true,
      });
    },

    redo: () => {
      const state = get();
      if (state.history.future.length === 0) return;

      const newFuture = [...state.history.future];
      const snapshot = newFuture.shift()!;
      const currentSnapshot = createHistorySnapshot(state.draft);

      set({
        draft: snapshot.draft,
        history: {
          ...state.history,
          past: [
            ...state.history.past,
            { draft: currentSnapshot, timestamp: Date.now() },
          ].slice(-state.history.maxDepth),
          future: newFuture,
        },
        isDirty: true,
      });
    },

    pushHistory: () => {
      const state = get();
      const snapshot = createHistorySnapshot(state.draft);
      set({
        history: {
          ...state.history,
          past: [
            ...state.history.past,
            { draft: snapshot, timestamp: Date.now() },
          ].slice(-state.history.maxDepth),
          future: [], // Clear redo stack on new action
        },
      });
    },

    clearHistory: () => {
      set({
        history: createDefaultHistory(),
      });
    },

    // -------------------------------------------------------------------------
    // Dirty State
    // -------------------------------------------------------------------------

    markClean: () => {
      set({ isDirty: false });
    },
  }));
}

// ---------------------------------------------------------------------------
// Default Store Instance
// ---------------------------------------------------------------------------

export const useSymbolEditorStore = createSymbolEditorStore();

// ---------------------------------------------------------------------------
// Selector Hooks
// ---------------------------------------------------------------------------

export const useSymbolDraft = () => useSymbolEditorStore((s) => s.draft);
export const useSymbolChrome = () => useSymbolEditorStore((s) => s.chrome);
export const useSymbolViewport = () =>
  useSymbolEditorStore((s) => s.chrome.viewport);
export const useSymbolSelection = () =>
  useSymbolEditorStore((s) => s.chrome.selection);
export const useCanUndo = () =>
  useSymbolEditorStore((s) => s.history.past.length > 0);
export const useCanRedo = () =>
  useSymbolEditorStore((s) => s.history.future.length > 0);
export const useIsDirty = () => useSymbolEditorStore((s) => s.isDirty);
