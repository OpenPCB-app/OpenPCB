import { create } from "zustand";
import type {
  PreviewGraphic,
  PreviewLabel,
  PointMm,
  FootprintRenderSource,
  FootprintRenderSourcePad,
} from "../../../../../shared/rendering/types";
import {
  boundsFromGraphics,
  emptyBoundsMm,
  includePoint,
  isFiniteBoundsMm,
} from "../../../../../shared/rendering/geometry";
import {
  snapPointToGrid,
  translateGraphic,
} from "../../../../../shared/frontend/canvas/tools/tool-utils";
import type {
  EditorPadElement,
  EditorFootprintGraphic,
  EditorFootprintLabel,
  EditorFootprintSnapshot,
  FootprintEditorToolId,
  FootprintEditorTextEditorState,
  PadDefaults,
  PadShape,
  PCB_EDITOR_LAYERS,
} from "./types";

export {
  snapToGrid,
  snapPointToGrid,
} from "../../../../../shared/frontend/canvas/tools/tool-utils";

const MAX_UNDO = 50;
const DUPLICATE_OFFSET_MM = 2.54;

let nextId = 1;
export function fpEditorId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

export interface ClipboardPayload {
  readonly pads: readonly Omit<EditorPadElement, "id">[];
  readonly graphics: readonly Omit<EditorFootprintGraphic, "id">[];
  readonly labels: readonly PreviewLabel[];
  readonly anchorMm: PointMm;
}

export interface SelectionRect {
  readonly a: PointMm;
  readonly b: PointMm;
}

const DEFAULT_PAD_DEFAULTS: PadDefaults = {
  shape: "rect",
  widthMm: 1.6,
  heightMm: 1.6,
  rotationDeg: 0,
  layer: "F.Cu",
  drillDiameterMm: null,
  roundrectRatio: 0.25,
};

const ALL_LAYERS: readonly string[] = [
  "F.Cu",
  "B.Cu",
  "F.SilkS",
  "B.SilkS",
  "F.CrtYd",
  "B.CrtYd",
  "F.Fab",
  "B.Fab",
  "Edge.Cuts",
];

export interface FootprintEditorState {
  // Document
  pads: EditorPadElement[];
  graphics: EditorFootprintGraphic[];
  labels: EditorFootprintLabel[];
  footprintName: string;
  mountTypeOverride: "smd" | "tht" | null;

  // Undo/redo
  undoStack: EditorFootprintSnapshot[];
  redoStack: EditorFootprintSnapshot[];

  // Tool
  activeTool: FootprintEditorToolId;

  // Layers
  activeLayer: string;
  layerVisibility: Set<string>;

  // Selection
  selectedIds: Set<string>;
  selectionRect: SelectionRect | null;

  // Preview
  previewGraphic: PreviewGraphic | null;

  // Clipboard + cursor
  clipboard: ClipboardPayload | null;
  cursorMm: PointMm | null;

  // Text editor overlay
  textEditor: FootprintEditorTextEditorState | null;

  // Grid
  gridSizeMm: number;
  gridVisible: boolean;

  // Pad defaults
  padDefaults: PadDefaults;

  // Actions — document
  addPad: (pad: Omit<EditorPadElement, "id">) => void;
  updatePad: (id: string, patch: Partial<Omit<EditorPadElement, "id">>) => void;
  setPadPosition: (id: string, centerMm: PointMm) => void;
  addGraphic: (graphic: PreviewGraphic, layer: string) => void;
  setGraphic: (id: string, graphic: PreviewGraphic) => void;
  updateLabel: (id: string, patch: Partial<PreviewLabel>) => void;
  removeSelected: () => void;
  setFootprintName: (name: string) => void;
  setMountTypeOverride: (override: "smd" | "tht" | null) => void;

  // Actions — tool
  setActiveTool: (tool: FootprintEditorToolId) => void;

  // Actions — layers
  setActiveLayer: (layer: string) => void;
  setLayerVisible: (layer: string, visible: boolean) => void;

  // Actions — selection
  setSelection: (ids: Set<string>) => void;
  clearSelection: () => void;
  selectAll: () => void;
  setSelectionRect: (rect: SelectionRect | null) => void;

  // Actions — preview
  setPreviewGraphic: (graphic: PreviewGraphic | null) => void;

  // Actions — cursor
  setCursorMm: (point: PointMm | null) => void;

  // Actions — clipboard
  copySelection: () => void;
  paste: (targetMm?: PointMm) => void;
  duplicateSelection: () => void;

  // Actions — text editor
  beginTextEdit: (
    labelId: string | null,
    worldMm: PointMm,
    screenX: number,
    screenY: number,
    initialText: string,
  ) => void;
  commitTextEdit: (text: string) => void;
  cancelTextEdit: () => void;

  // Actions — grid
  setGridSizeMm: (size: number) => void;
  setGridVisible: (visible: boolean) => void;

  // Actions — pad defaults
  setPadDefaults: (patch: Partial<PadDefaults>) => void;

  // Actions — undo/redo
  pushSnapshot: () => void;
  undo: () => void;
  redo: () => void;

  // Derived
  derivedMountType: () => "smd" | "tht" | "mixed";

  // Conversion
  toFootprintRenderSource: () => FootprintRenderSource;

  // Reset
  reset: () => void;
}

const INITIAL_STATE = {
  pads: [] as EditorPadElement[],
  graphics: [] as EditorFootprintGraphic[],
  labels: [] as EditorFootprintLabel[],
  footprintName: "",
  mountTypeOverride: null as "smd" | "tht" | null,
  undoStack: [] as EditorFootprintSnapshot[],
  redoStack: [] as EditorFootprintSnapshot[],
  activeTool: "select" as FootprintEditorToolId,
  activeLayer: "F.Cu" as string,
  layerVisibility: new Set<string>(ALL_LAYERS),
  selectedIds: new Set<string>(),
  selectionRect: null as SelectionRect | null,
  previewGraphic: null as PreviewGraphic | null,
  clipboard: null as ClipboardPayload | null,
  cursorMm: null as PointMm | null,
  textEditor: null as FootprintEditorTextEditorState | null,
  gridSizeMm: 0.635,
  gridVisible: true,
  padDefaults: { ...DEFAULT_PAD_DEFAULTS } as PadDefaults,
};

function snapshotOf(state: FootprintEditorState): EditorFootprintSnapshot {
  return { pads: state.pads, graphics: state.graphics, labels: state.labels };
}

export const useFootprintEditorStore = create<FootprintEditorState>(
  (set, get) => ({
    ...INITIAL_STATE,

    // ── Document actions ──────────────────────────────────────────────

    addPad: (pad) => {
      const state = get();
      const id = fpEditorId("pa");
      set({
        pads: [...state.pads, { ...pad, id }],
        redoStack: [],
      });
    },

    updatePad: (id, patch) => {
      const state = get();
      set({
        pads: state.pads.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      });
    },

    setPadPosition: (id, centerMm) => {
      const state = get();
      set({
        pads: state.pads.map((p) => (p.id === id ? { ...p, centerMm } : p)),
      });
    },

    addGraphic: (graphic, layer) => {
      const state = get();
      const id = fpEditorId("fg");
      set({
        graphics: [...state.graphics, { id, graphic, layer }],
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

    updateLabel: (id, patch) => {
      const state = get();
      set({
        labels: state.labels.map((l) =>
          l.id === id ? { ...l, label: { ...l.label, ...patch, id: l.id } } : l,
        ),
      });
    },

    removeSelected: () => {
      const state = get();
      if (state.selectedIds.size === 0) return;
      set({
        pads: state.pads.filter((p) => !state.selectedIds.has(p.id)),
        graphics: state.graphics.filter((g) => !state.selectedIds.has(g.id)),
        labels: state.labels.filter((l) => !state.selectedIds.has(l.id)),
        selectedIds: new Set(),
        redoStack: [],
      });
    },

    setFootprintName: (name) => set({ footprintName: name }),
    setMountTypeOverride: (override) => set({ mountTypeOverride: override }),

    // ── Tool ──────────────────────────────────────────────────────────

    setActiveTool: (tool) =>
      set({
        activeTool: tool,
        previewGraphic: null,
        selectedIds: new Set(),
        textEditor: null,
        selectionRect: null,
      }),

    // ── Layers ────────────────────────────────────────────────────────

    setActiveLayer: (layer) => set({ activeLayer: layer }),
    setLayerVisible: (layer, visible) => {
      const state = get();
      const next = new Set(state.layerVisibility);
      if (visible) next.add(layer);
      else next.delete(layer);
      set({ layerVisibility: next });
    },

    // ── Selection ─────────────────────────────────────────────────────

    setSelection: (ids) => set({ selectedIds: ids }),
    clearSelection: () => set({ selectedIds: new Set() }),
    selectAll: () => {
      const state = get();
      const ids = new Set<string>();
      for (const p of state.pads) ids.add(p.id);
      for (const g of state.graphics) ids.add(g.id);
      for (const l of state.labels) ids.add(l.id);
      set({ selectedIds: ids });
    },
    setSelectionRect: (rect) => set({ selectionRect: rect }),

    // ── Preview ───────────────────────────────────────────────────────

    setPreviewGraphic: (graphic) => set({ previewGraphic: graphic }),

    // ── Cursor ────────────────────────────────────────────────────────

    setCursorMm: (point) => set({ cursorMm: point }),

    // ── Clipboard ─────────────────────────────────────────────────────

    copySelection: () => {
      const state = get();
      if (state.selectedIds.size === 0) return;

      const padsCopy: Omit<EditorPadElement, "id">[] = [];
      const graphicsCopy: Omit<EditorFootprintGraphic, "id">[] = [];
      const labelsCopy: PreviewLabel[] = [];
      let bounds = emptyBoundsMm();

      for (const pad of state.pads) {
        if (state.selectedIds.has(pad.id)) {
          const { id: _, ...rest } = pad;
          padsCopy.push(rest);
          bounds = includePoint(bounds, pad.centerMm);
        }
      }
      for (const g of state.graphics) {
        if (state.selectedIds.has(g.id)) {
          graphicsCopy.push({ graphic: g.graphic, layer: g.layer });
          const b = boundsFromGraphics([g.graphic]);
          if (b) {
            bounds = {
              minX: Math.min(bounds.minX, b.minX),
              minY: Math.min(bounds.minY, b.minY),
              maxX: Math.max(bounds.maxX, b.maxX),
              maxY: Math.max(bounds.maxY, b.maxY),
            };
          }
        }
      }
      for (const l of state.labels) {
        if (state.selectedIds.has(l.id)) {
          labelsCopy.push(l.label);
          bounds = includePoint(bounds, l.label.at);
        }
      }

      if (
        padsCopy.length === 0 &&
        graphicsCopy.length === 0 &&
        labelsCopy.length === 0
      )
        return;

      const anchorMm: PointMm = isFiniteBoundsMm(bounds)
        ? {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          }
        : { x: 0, y: 0 };

      set({
        clipboard: {
          pads: padsCopy,
          graphics: graphicsCopy,
          labels: labelsCopy,
          anchorMm,
        },
      });
    },

    paste: (targetMm) => {
      pasteInternal(get, set, targetMm ?? null, false);
    },

    duplicateSelection: () => {
      const state = get();
      if (state.selectedIds.size === 0) return;
      get().copySelection();
      pasteInternal(get, set, null, true);
    },

    // ── Text editor ───────────────────────────────────────────────────

    beginTextEdit: (labelId, worldMm, screenX, screenY, initialText) => {
      set({ textEditor: { labelId, worldMm, screenX, screenY, initialText } });
    },

    commitTextEdit: (text) => {
      const state = get();
      const editor = state.textEditor;
      if (!editor) return;
      const trimmed = text.trim();

      if (editor.labelId === null) {
        if (trimmed.length === 0) {
          set({ textEditor: null });
          return;
        }
        const snapshot = snapshotOf(state);
        const undoStack = [...state.undoStack, snapshot];
        if (undoStack.length > MAX_UNDO) undoStack.shift();

        const id = fpEditorId("fl");
        const newLabel: PreviewLabel = {
          id,
          text: trimmed,
          at: editor.worldMm,
          fontSizeMm: 1.0,
          rotationDeg: 0,
          anchorX: "center",
          anchorY: "middle",
          layer: state.activeLayer,
        };
        set({
          labels: [...state.labels, { id, label: newLabel }],
          undoStack,
          redoStack: [],
          textEditor: null,
        });
      } else {
        const existing = state.labels.find((l) => l.id === editor.labelId);
        if (!existing || existing.label.text === trimmed) {
          set({ textEditor: null });
          return;
        }
        const snapshot = snapshotOf(state);
        const undoStack = [...state.undoStack, snapshot];
        if (undoStack.length > MAX_UNDO) undoStack.shift();

        set({
          labels: state.labels.map((l) =>
            l.id === editor.labelId
              ? { ...l, label: { ...l.label, text: trimmed } }
              : l,
          ),
          undoStack,
          redoStack: [],
          textEditor: null,
        });
      }
    },

    cancelTextEdit: () => set({ textEditor: null }),

    // ── Grid ──────────────────────────────────────────────────────────

    setGridSizeMm: (size) => set({ gridSizeMm: size }),
    setGridVisible: (visible) => set({ gridVisible: visible }),

    // ── Pad defaults ──────────────────────────────────────────────────

    setPadDefaults: (patch) =>
      set((state) => ({ padDefaults: { ...state.padDefaults, ...patch } })),

    // ── Undo/Redo ─────────────────────────────────────────────────────

    pushSnapshot: () => {
      const state = get();
      const snapshot = snapshotOf(state);
      const stack = [...state.undoStack, snapshot];
      if (stack.length > MAX_UNDO) stack.shift();
      set({ undoStack: stack, redoStack: [] });
    },

    undo: () => {
      const state = get();
      if (state.undoStack.length === 0) return;
      const snapshot = state.undoStack[state.undoStack.length - 1]!;
      const current = snapshotOf(state);
      set({
        pads: [...snapshot.pads],
        graphics: [...snapshot.graphics],
        labels: [...snapshot.labels],
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, current],
        selectedIds: new Set(),
      });
    },

    redo: () => {
      const state = get();
      if (state.redoStack.length === 0) return;
      const snapshot = state.redoStack[state.redoStack.length - 1]!;
      const current = snapshotOf(state);
      set({
        pads: [...snapshot.pads],
        graphics: [...snapshot.graphics],
        labels: [...snapshot.labels],
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, current],
        selectedIds: new Set(),
      });
    },

    // ── Derived ───────────────────────────────────────────────────────

    derivedMountType: () => {
      const state = get();
      if (state.mountTypeOverride) return state.mountTypeOverride;
      let hasSmd = false;
      let hasTht = false;
      for (const pad of state.pads) {
        if (pad.drillDiameterMm && pad.drillDiameterMm > 0) hasTht = true;
        else hasSmd = true;
      }
      if (hasSmd && hasTht) return "mixed";
      if (hasTht) return "tht";
      return "smd";
    },

    // ── Conversion ────────────────────────────────────────────────────

    toFootprintRenderSource: (): FootprintRenderSource => {
      const state = get();
      const pads: FootprintRenderSourcePad[] = state.pads.map((p) => ({
        id: p.id,
        number: p.number,
        shape: p.shape,
        centerMm: p.centerMm,
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        rotationDeg: p.rotationDeg,
        roundrectRatio: p.roundrectRatio,
        drillDiameterMm: p.drillDiameterMm,
        layer: p.layer,
      }));

      const graphics = state.graphics.map((g) => ({
        ...g.graphic,
        layer: g.layer,
      }));

      const labels = state.labels.map((l) => l.label);

      return {
        name: state.footprintName || "FP",
        pads,
        graphics,
        labels,
        warnings: [],
      };
    },

    // ── Reset ─────────────────────────────────────────────────────────

    reset: () => {
      nextId = 1;
      set({
        ...INITIAL_STATE,
        selectedIds: new Set(),
        layerVisibility: new Set(ALL_LAYERS),
      });
    },
  }),
);

// ── Internal helpers ────────────────────────────────────────────────

type StoreGet = () => FootprintEditorState;
type StoreSet = (partial: Partial<FootprintEditorState>) => void;

function pasteInternal(
  get: StoreGet,
  set: StoreSet,
  targetMm: PointMm | null,
  isDuplicate: boolean,
): void {
  const state = get();
  const clipboard = state.clipboard;
  if (!clipboard) return;
  if (
    clipboard.pads.length === 0 &&
    clipboard.graphics.length === 0 &&
    clipboard.labels.length === 0
  ) {
    return;
  }

  let target: PointMm;
  if (isDuplicate) {
    target = {
      x: clipboard.anchorMm.x + DUPLICATE_OFFSET_MM,
      y: clipboard.anchorMm.y,
    };
  } else if (targetMm) {
    target = targetMm;
  } else if (state.cursorMm) {
    target = state.gridVisible
      ? snapPointToGrid(state.cursorMm, state.gridSizeMm)
      : state.cursorMm;
  } else {
    target = {
      x: clipboard.anchorMm.x + DUPLICATE_OFFSET_MM,
      y: clipboard.anchorMm.y,
    };
  }

  const dx = target.x - clipboard.anchorMm.x;
  const dy = target.y - clipboard.anchorMm.y;

  const snapshot = snapshotOf(state);
  const undoStack = [...state.undoStack, snapshot];
  if (undoStack.length > MAX_UNDO) undoStack.shift();

  const newIds: string[] = [];

  // Paste pads with renumbered numbers
  let maxPadNumber = 0;
  for (const p of state.pads) {
    const n = Number.parseInt(p.number, 10);
    if (Number.isFinite(n) && n > maxPadNumber) maxPadNumber = n;
  }

  const pastedPads: EditorPadElement[] = clipboard.pads.map((p) => {
    const id = fpEditorId("pa");
    newIds.push(id);
    maxPadNumber += 1;
    const nextNumber = String(maxPadNumber);
    const preserveName = p.number !== String(maxPadNumber - 1);
    return {
      ...p,
      id,
      number: nextNumber,
      centerMm: { x: p.centerMm.x + dx, y: p.centerMm.y + dy },
    };
  });

  const pastedGraphics: EditorFootprintGraphic[] = clipboard.graphics.map(
    (g) => {
      const id = fpEditorId("fg");
      newIds.push(id);
      return {
        id,
        graphic: translateGraphic(g.graphic, dx, dy),
        layer: g.layer,
      };
    },
  );

  const pastedLabels: EditorFootprintLabel[] = clipboard.labels.map((l) => {
    const id = fpEditorId("fl");
    newIds.push(id);
    return {
      id,
      label: { ...l, id, at: { x: l.at.x + dx, y: l.at.y + dy } },
    };
  });

  set({
    pads: [...state.pads, ...pastedPads],
    graphics: [...state.graphics, ...pastedGraphics],
    labels: [...state.labels, ...pastedLabels],
    undoStack,
    redoStack: [],
    selectedIds: new Set(newIds),
  });
}
