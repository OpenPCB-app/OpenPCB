import { create } from "zustand";
import type {
  PreviewGraphic,
  PreviewLabel,
  PointMm,
  SymbolRenderSource,
  SymbolRenderSourcePin,
  SymbolRenderSourceGraphic,
  SymbolRenderSourceLabel,
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
  AlignmentGuide,
  SpacingGuide,
} from "../../../../../shared/frontend/canvas/guides";
import type {
  EditorGraphicElement,
  EditorLabelElement,
  EditorPinElement,
  EditorSnapshot,
  EditorTextEditorState,
  EditorToolId,
} from "./types";

export {
  snapToGrid,
  snapPointToGrid,
} from "../../../../../shared/frontend/canvas/tools/tool-utils";

const MAX_UNDO = 50;
const DUPLICATE_OFFSET_MM = 2.54;

let nextId = 1;
export function editorId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

export interface ClipboardPayload {
  readonly graphics: readonly PreviewGraphic[];
  readonly pins: readonly Omit<EditorPinElement, "id">[];
  readonly labels: readonly PreviewLabel[];
  /** Center of copied items in mm; paste translates by `target - anchor`. */
  readonly anchorMm: PointMm;
}

export interface SelectionRect {
  readonly a: PointMm;
  readonly b: PointMm;
}

export interface PinDefaults {
  readonly electricalType: string;
  readonly lengthMm: number;
  readonly rotationDeg: number;
}

export interface SymbolEditorState {
  // Document
  graphics: EditorGraphicElement[];
  pins: EditorPinElement[];
  labels: EditorLabelElement[];
  referencePrefix: string;

  // Undo/redo
  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];

  // Tool
  activeTool: EditorToolId;

  // Selection
  selectedIds: Set<string>;
  selectionRect: SelectionRect | null;
  hoveredId: string | null;

  // Alignment guides (Figma-style; updated live during a drag)
  alignmentGuidesVisible: boolean;
  alignmentGuides: AlignmentGuide[];
  alignmentSpacing: SpacingGuide[];

  // Preview (rubber-band during drawing)
  previewGraphic: PreviewGraphic | null;

  // Clipboard + cursor (cursor drives paste target)
  clipboard: ClipboardPayload | null;
  cursorMm: PointMm | null;

  // Inline text editor state (floating DOM input over canvas)
  textEditor: EditorTextEditorState | null;

  // Grid
  gridSizeMm: number;
  gridVisible: boolean;

  // Pin tool defaults (session-only; applied on each Pin placement)
  pinDefaults: PinDefaults;

  // Actions — document
  addGraphic: (graphic: PreviewGraphic) => void;
  addPin: (pin: Omit<EditorPinElement, "id">) => void;
  setGraphic: (id: string, graphic: PreviewGraphic) => void;
  setPinPosition: (id: string, positionMm: PointMm) => void;
  updatePin: (id: string, patch: Partial<Omit<EditorPinElement, "id">>) => void;
  updateLabel: (id: string, patch: Partial<PreviewLabel>) => void;
  removeSelected: () => void;
  setReferencePrefix: (prefix: string) => void;

  // Actions — tool
  setActiveTool: (tool: EditorToolId) => void;

  // Actions — selection
  setSelection: (ids: Set<string>) => void;
  clearSelection: () => void;
  selectAll: () => void;
  setSelectionRect: (rect: SelectionRect | null) => void;
  setHoveredId: (id: string | null) => void;

  // Actions — alignment guides
  toggleAlignmentGuidesVisible: () => void;
  setAlignmentGuides: (
    guides: AlignmentGuide[],
    spacing: SpacingGuide[],
  ) => void;
  clearAlignmentGuides: () => void;

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

  // Actions — pin defaults
  setPinDefaults: (patch: Partial<PinDefaults>) => void;

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
  labels: [] as EditorLabelElement[],
  referencePrefix: "U",
  undoStack: [] as EditorSnapshot[],
  redoStack: [] as EditorSnapshot[],
  activeTool: "select" as EditorToolId,
  selectedIds: new Set<string>(),
  selectionRect: null as SelectionRect | null,
  hoveredId: null as string | null,
  alignmentGuidesVisible: true,
  alignmentGuides: [] as AlignmentGuide[],
  alignmentSpacing: [] as SpacingGuide[],
  previewGraphic: null as PreviewGraphic | null,
  clipboard: null as ClipboardPayload | null,
  cursorMm: null as PointMm | null,
  textEditor: null as EditorTextEditorState | null,
  gridSizeMm: 1.27,
  gridVisible: true,
  pinDefaults: {
    electricalType: "passive",
    lengthMm: 2.54,
    rotationDeg: 180,
  } as PinDefaults,
};

function snapshotOf(state: SymbolEditorState): EditorSnapshot {
  return {
    graphics: state.graphics,
    pins: state.pins,
    labels: state.labels,
  };
}

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
      graphics: state.graphics.filter((g) => !state.selectedIds.has(g.id)),
      pins: state.pins.filter((p) => !state.selectedIds.has(p.id)),
      labels: state.labels.filter((l) => !state.selectedIds.has(l.id)),
      selectedIds: new Set(),
      redoStack: [],
    });
  },

  setReferencePrefix: (prefix) => set({ referencePrefix: prefix }),

  setActiveTool: (tool) =>
    set({
      activeTool: tool,
      previewGraphic: null,
      selectedIds: new Set(),
      textEditor: null,
      selectionRect: null,
    }),

  setSelection: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: new Set() }),
  selectAll: () => {
    const state = get();
    const ids = new Set<string>();
    for (const g of state.graphics) ids.add(g.id);
    for (const p of state.pins) ids.add(p.id);
    for (const l of state.labels) ids.add(l.id);
    set({ selectedIds: ids });
  },
  setSelectionRect: (rect) => set({ selectionRect: rect }),
  setHoveredId: (id) => set({ hoveredId: id }),

  toggleAlignmentGuidesVisible: () =>
    set((state) => ({
      alignmentGuidesVisible: !state.alignmentGuidesVisible,
      alignmentGuides: [],
      alignmentSpacing: [],
    })),
  setAlignmentGuides: (guides, spacing) =>
    set({ alignmentGuides: guides, alignmentSpacing: spacing }),
  clearAlignmentGuides: () => {
    const state = get();
    if (
      state.alignmentGuides.length === 0 &&
      state.alignmentSpacing.length === 0
    )
      return;
    set({ alignmentGuides: [], alignmentSpacing: [] });
  },

  setPreviewGraphic: (graphic) => set({ previewGraphic: graphic }),

  setCursorMm: (point) => set({ cursorMm: point }),

  copySelection: () => {
    const state = get();
    if (state.selectedIds.size === 0) return;

    const graphicsCopy: PreviewGraphic[] = [];
    const pinsCopy: Omit<EditorPinElement, "id">[] = [];
    const labelsCopy: PreviewLabel[] = [];
    let bounds = emptyBoundsMm();

    for (const element of state.graphics) {
      if (state.selectedIds.has(element.id)) {
        graphicsCopy.push(element.graphic);
        const b = boundsFromGraphics([element.graphic]);
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
    for (const pin of state.pins) {
      if (state.selectedIds.has(pin.id)) {
        pinsCopy.push({
          name: pin.name,
          number: pin.number,
          electricalType: pin.electricalType,
          positionMm: pin.positionMm,
          lengthMm: pin.lengthMm,
          rotationDeg: pin.rotationDeg,
        });
        bounds = includePoint(bounds, pin.positionMm);
      }
    }
    for (const element of state.labels) {
      if (state.selectedIds.has(element.id)) {
        labelsCopy.push(element.label);
        bounds = includePoint(bounds, element.label.at);
      }
    }

    if (
      graphicsCopy.length === 0 &&
      pinsCopy.length === 0 &&
      labelsCopy.length === 0
    ) {
      return;
    }

    const anchorMm: PointMm = isFiniteBoundsMm(bounds)
      ? {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        }
      : { x: 0, y: 0 };

    set({
      clipboard: {
        graphics: graphicsCopy,
        pins: pinsCopy,
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
    // Copy selection implicitly (into clipboard), then paste beside
    get().copySelection();
    pasteInternal(get, set, null, true);
  },

  beginTextEdit: (labelId, worldMm, screenX, screenY, initialText) => {
    set({
      textEditor: { labelId, worldMm, screenX, screenY, initialText },
    });
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
      // New label — snapshot, add, clear editor
      const snapshot = snapshotOf(state);
      const undoStack = [...state.undoStack, snapshot];
      if (undoStack.length > MAX_UNDO) undoStack.shift();

      const id = editorId("l");
      const newLabel: PreviewLabel = {
        id,
        text: trimmed,
        at: editor.worldMm,
        fontSizeMm: 1.0,
        rotationDeg: 0,
        anchorX: "center",
        anchorY: "middle",
        role: "footprint-text",
      };
      set({
        labels: [...state.labels, { id, label: newLabel }],
        undoStack,
        redoStack: [],
        textEditor: null,
      });
    } else {
      // Edit existing label text
      const existing = state.labels.find((l) => l.id === editor.labelId);
      if (!existing) {
        set({ textEditor: null });
        return;
      }
      if (existing.label.text === trimmed) {
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

  setGridSizeMm: (size) => set({ gridSizeMm: size }),
  setGridVisible: (visible) => set({ gridVisible: visible }),

  setPinDefaults: (patch) =>
    set((state) => ({ pinDefaults: { ...state.pinDefaults, ...patch } })),

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
    const currentSnapshot = snapshotOf(state);
    set({
      graphics: [...snapshot.graphics],
      pins: [...snapshot.pins],
      labels: [...snapshot.labels],
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, currentSnapshot],
      selectedIds: new Set(),
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const snapshot = state.redoStack[state.redoStack.length - 1]!;
    const currentSnapshot = snapshotOf(state);
    set({
      graphics: [...snapshot.graphics],
      pins: [...snapshot.pins],
      labels: [...snapshot.labels],
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, currentSnapshot],
      selectedIds: new Set(),
    });
  },

  toSymbolRenderSource: (): SymbolRenderSource => {
    const state = get();
    const sourceGraphics: SymbolRenderSourceGraphic[] = state.graphics.map(
      (g) => ({ unit: 1, graphic: g.graphic }),
    );

    const sourcePins: SymbolRenderSourcePin[] = state.pins.map((p) => ({
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

    const sourceLabels: SymbolRenderSourceLabel[] = state.labels.map((l) => ({
      unit: 1,
      label: l.label,
    }));

    return {
      name: state.referencePrefix || "U",
      unitCount: 1,
      referenceText: `${state.referencePrefix}?`,
      valueText: state.referencePrefix || "U",
      pins: sourcePins,
      graphics: sourceGraphics,
      labels: sourceLabels,
      warnings: [],
    };
  },

  reset: () => {
    nextId = 1;
    set({ ...INITIAL_STATE, selectedIds: new Set() });
  },
}));

type StoreGet = () => SymbolEditorState;
type StoreSet = (partial: Partial<SymbolEditorState>) => void;

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
    clipboard.graphics.length === 0 &&
    clipboard.pins.length === 0 &&
    clipboard.labels.length === 0
  ) {
    return;
  }

  // Resolve paste target (anchor lands here):
  //   - duplicate: always clipboard.anchor + offset (keep near origin)
  //   - paste: explicit targetMm, else cursor (grid-snapped if visible),
  //            else clipboard.anchor + offset as fallback
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

  // Snapshot BEFORE mutating so undo reverts the paste.
  const snapshot = snapshotOf(state);
  const undoStack = [...state.undoStack, snapshot];
  if (undoStack.length > MAX_UNDO) undoStack.shift();

  const newGraphicsIds: string[] = [];
  const newPinsIds: string[] = [];
  const newLabelsIds: string[] = [];

  const pastedGraphics: EditorGraphicElement[] = clipboard.graphics.map((g) => {
    const id = editorId("g");
    newGraphicsIds.push(id);
    return { id, graphic: translateGraphic(g, dx, dy) };
  });

  // Next-free pin number starting from max parseable int + 1.
  let maxPinNumber = 0;
  for (const p of state.pins) {
    const n = Number.parseInt(p.number, 10);
    if (Number.isFinite(n) && n > maxPinNumber) maxPinNumber = n;
  }

  const pastedPins: EditorPinElement[] = clipboard.pins.map((p) => {
    const id = editorId("p");
    newPinsIds.push(id);
    maxPinNumber += 1;
    const nextNumber = String(maxPinNumber);
    // Preserve semantic pin names (e.g. "VCC", "GND"); only auto-rename
    // when the name was just mirroring the pin number.
    const preserveName = p.name !== p.number && p.name.trim().length > 0;
    return {
      ...p,
      id,
      number: nextNumber,
      name: preserveName ? p.name : nextNumber,
      positionMm: { x: p.positionMm.x + dx, y: p.positionMm.y + dy },
    };
  });

  const pastedLabels: EditorLabelElement[] = clipboard.labels.map((l) => {
    const id = editorId("l");
    newLabelsIds.push(id);
    return {
      id,
      label: {
        ...l,
        id,
        at: { x: l.at.x + dx, y: l.at.y + dy },
      },
    };
  });

  const nextSelection = new Set<string>([
    ...newGraphicsIds,
    ...newPinsIds,
    ...newLabelsIds,
  ]);

  set({
    graphics: [...state.graphics, ...pastedGraphics],
    pins: [...state.pins, ...pastedPins],
    labels: [...state.labels, ...pastedLabels],
    undoStack,
    redoStack: [],
    selectedIds: nextSelection,
  });
}
