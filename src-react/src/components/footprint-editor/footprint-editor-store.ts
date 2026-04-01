/**
 * Footprint Editor Store
 *
 * Local zustand store for the Step 2 footprint editor.
 * Manages footprint draft state, viewport, selection, and undo/redo.
 */

import { create } from "zustand";
import {
  type FootprintDraft,
  type FootprintConfigMode,
  type DensityLevel,
  type EditorChrome,
  type HistoryState,
  type Viewport,
  type EditorTool,
  type FootprintPresetKind,
  type PresetConfig,
  type PadDefinition,
  type FootprintGraphic,
  type Point,
  type Millimeters,
  createEmptyDraft,
  createDefaultChrome,
  createDefaultHistory,
  MIN_ZOOM,
  MAX_ZOOM,
} from "./types";

// ---------------------------------------------------------------------------
// Store Interface
// ---------------------------------------------------------------------------

interface FootprintEditorState {
  /** Current footprint draft */
  draft: FootprintDraft;
  /** Editor UI state */
  chrome: EditorChrome;
  /** Undo/redo history */
  history: HistoryState;
  /** Whether draft has unsaved changes */
  isDirty: boolean;

  // Draft actions
  setDraft: (draft: FootprintDraft) => void;
  resetDraft: (id?: string) => void;
  updateMetadata: (updates: Partial<FootprintDraft["metadata"]>) => void;
  setPreset: (kind: FootprintPresetKind, config: PresetConfig) => void;
  updateConfig: (updates: Partial<PresetConfig>) => void;
  setDensityLevel: (density: DensityLevel) => void;
  setConfigMode: (mode: FootprintConfigMode) => void;

  // Pad actions
  addPad: (pad: PadDefinition) => void;
  updatePad: (id: string, updates: Partial<Omit<PadDefinition, "id">>) => void;
  removePad: (id: string) => void;
  removePads: (ids: string[]) => void;
  movePad: (id: string, position: Point) => void;
  setPads: (pads: PadDefinition[]) => void;
  setPadPinMapping: (padId: string, pinNumber: string | undefined) => void;

  // Graphics actions
  setGraphics: (graphics: FootprintGraphic[]) => void;
  addGraphic: (graphic: FootprintGraphic) => void;
  removeGraphic: (id: string) => void;

  // Selection actions
  selectPad: (id: string, additive?: boolean) => void;
  selectPads: (ids: string[]) => void;
  clearSelection: () => void;
  selectAllPads: () => void;

  // Viewport actions
  setViewport: (viewport: Viewport) => void;
  pan: (dx: number, dy: number) => void;
  zoomAt: (centerX: number, centerY: number, factor: number) => void;
  resetViewport: () => void;

  // Tool actions
  setTool: (tool: EditorTool) => void;

  // Grid actions
  setGridSize: (size: Millimeters) => void;
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

function createHistorySnapshot(draft: FootprintDraft): FootprintDraft {
  return {
    ...draft,
    metadata: { ...draft.metadata },
    config: { ...draft.config } as PresetConfig,
    pads: draft.pads.map((p) => ({
      ...p,
      position: { ...p.position },
      size: { ...p.size },
      layers: [...p.layers],
    })),
    graphics: draft.graphics.map((g) => ({ ...g })),
    importPreservation: draft.importPreservation
      ? {
          ...draft.importPreservation,
          warnings: [...draft.importPreservation.warnings],
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Store Factory
// ---------------------------------------------------------------------------

export function createFootprintEditorStore(initialDraftId?: string) {
  return create<FootprintEditorState>((set, get) => ({
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

    setPreset: (kind, config) => {
      const state = get();
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          preset: kind,
          config,
        },
        isDirty: true,
      });
    },

    updateConfig: (updates) => {
      const state = get();
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          config: { ...state.draft.config, ...updates } as PresetConfig,
        },
        isDirty: true,
      });
    },

    setDensityLevel: (density) => {
      const state = get();
      state.pushHistory();
      set({
        draft: { ...state.draft, densityLevel: density },
        isDirty: true,
      });
    },

    setConfigMode: (mode) => {
      const state = get();
      state.pushHistory();
      set({
        draft: { ...state.draft, configMode: mode },
        isDirty: true,
      });
    },

    // -------------------------------------------------------------------------
    // Pad Actions
    // -------------------------------------------------------------------------

    addPad: (pad) => {
      const state = get();
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          pads: [...state.draft.pads, pad],
        },
        isDirty: true,
      });
    },

    updatePad: (id, updates) => {
      const state = get();
      const padIndex = state.draft.pads.findIndex((p) => p.id === id);
      if (padIndex === -1) return;

      state.pushHistory();
      const newPads = [...state.draft.pads];
      newPads[padIndex] = { ...newPads[padIndex]!, ...updates };
      set({
        draft: { ...state.draft, pads: newPads },
        isDirty: true,
      });
    },

    removePad: (id) => {
      const state = get();
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          pads: state.draft.pads.filter((p) => p.id !== id),
        },
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedPadIds: new Set(
              [...state.chrome.selection.selectedPadIds].filter(
                (pid) => pid !== id,
              ),
            ),
          },
        },
        isDirty: true,
      });
    },

    removePads: (ids) => {
      const state = get();
      const idSet = new Set(ids);
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          pads: state.draft.pads.filter((p) => !idSet.has(p.id)),
        },
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedPadIds: new Set(
              [...state.chrome.selection.selectedPadIds].filter(
                (pid) => !idSet.has(pid),
              ),
            ),
          },
        },
        isDirty: true,
      });
    },

    movePad: (id, position) => {
      const state = get();
      const padIndex = state.draft.pads.findIndex((p) => p.id === id);
      if (padIndex === -1) return;

      state.pushHistory();
      const newPads = [...state.draft.pads];
      newPads[padIndex] = { ...newPads[padIndex]!, position };
      set({
        draft: { ...state.draft, pads: newPads },
        isDirty: true,
      });
    },

    setPads: (pads) => {
      const state = get();
      state.pushHistory();
      set({
        draft: { ...state.draft, pads },
        isDirty: true,
      });
    },

    setPadPinMapping: (padId, pinNumber) => {
      const state = get();
      const padIndex = state.draft.pads.findIndex((p) => p.id === padId);
      if (padIndex === -1) return;

      state.pushHistory();
      const newPads = [...state.draft.pads];
      newPads[padIndex] = { ...newPads[padIndex]!, pinMapping: pinNumber };
      set({
        draft: { ...state.draft, pads: newPads },
        isDirty: true,
      });
    },

    // -------------------------------------------------------------------------
    // Graphics Actions
    // -------------------------------------------------------------------------

    setGraphics: (graphics) => {
      const state = get();
      state.pushHistory();
      set({
        draft: { ...state.draft, graphics },
        isDirty: true,
      });
    },

    addGraphic: (graphic) => {
      const state = get();
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          graphics: [...state.draft.graphics, graphic],
        },
        isDirty: true,
      });
    },

    removeGraphic: (id) => {
      const state = get();
      state.pushHistory();
      set({
        draft: {
          ...state.draft,
          graphics: state.draft.graphics.filter((g) => g.id !== id),
        },
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedGraphicIds: new Set(
              [...state.chrome.selection.selectedGraphicIds].filter(
                (gid) => gid !== id,
              ),
            ),
          },
        },
        isDirty: true,
      });
    },

    // -------------------------------------------------------------------------
    // Selection Actions// -------------------------------------------------------------------------

    selectPad: (id, additive = false) => {
      const state = get();
      const newSelection = additive
        ? new Set([...state.chrome.selection.selectedPadIds, id])
        : new Set([id]);
      set({
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedPadIds: newSelection,
          },
        },
      });
    },

    selectPads: (ids) => {
      const state = get();
      set({
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedPadIds: new Set(ids),
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
            selectedPadIds: new Set(),
            selectedGraphicIds: new Set(),
          },
        },
      });
    },

    selectAllPads: () => {
      const state = get();
      set({
        chrome: {
          ...state.chrome,
          selection: {
            ...state.chrome.selection,
            selectedPadIds: new Set(state.draft.pads.map((p) => p.id)),
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

export const useFootprintEditorStore = createFootprintEditorStore();

// ---------------------------------------------------------------------------
// Selector Hooks
// ---------------------------------------------------------------------------

export const useFootprintDraft = () => useFootprintEditorStore((s) => s.draft);
export const useFootprintChrome = () =>
  useFootprintEditorStore((s) => s.chrome);
export const useFootprintViewport = () =>
  useFootprintEditorStore((s) => s.chrome.viewport);
export const useFootprintSelection = () =>
  useFootprintEditorStore((s) => s.chrome.selection);
export const useCanUndo = () =>
  useFootprintEditorStore((s) => s.history.past.length > 0);
export const useCanRedo = () =>
  useFootprintEditorStore((s) => s.history.future.length > 0);
export const useIsDirty = () => useFootprintEditorStore((s) => s.isDirty);
