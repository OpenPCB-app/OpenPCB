import { create } from "zustand";
import type {
  PcbDocument,
  PcbViewport,
  Point2D,
  RatsnestLine,
} from "@/components/pcb-editor/pcb-types";
import { createDefaultPcbViewport } from "@/components/pcb-editor/pcb-types";
import {
  DEFAULT_GRID_SIZE,
  DEFAULT_NET_CLASSES,
} from "@/components/pcb-editor/layer-colors";
import { calculateRatsnest } from "@/components/pcb-editor/ratsnest";
import { syncSchematicToPcb } from "@/components/pcb-editor/schematic-pcb-sync";
import type { ExtractedNet } from "@/components/pcb/canvas/net-extraction";
import type { EditorSchematicSymbol } from "@/components/pcb/types";
import {
  createComponentLibraryIndex,
  type ComponentLibraryIndex,
} from "@/components/pcb/symbol-library";
import type { ComponentType } from "@shared/types/component-library-schema.types";
import { createUndoManager, type UndoManager } from "@/lib/undo-manager";

interface PcbStoreState {
  document: PcbDocument | null;
  ratsnest: RatsnestLine[];

  viewport: PcbViewport;
  activeLayer: "F.Cu" | "B.Cu";
  visibleLayers: Set<string>;
  gridSize: number;
  selectedIds: Set<string>;
  activeTool: "select" | "place" | "route";

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  initFromSchematic: (
    nets: ExtractedNet[],
    symbols: EditorSchematicSymbol[],
    components: ComponentType[],
  ) => void;
  syncFromSchematic: (
    nets: ExtractedNet[],
    symbols: EditorSchematicSymbol[],
    componentLibrary: ComponentLibraryIndex,
  ) => void;
  setDocument: (doc: PcbDocument) => void;
  setActiveTool: (tool: "select" | "place" | "route") => void;
  movePlacement: (id: string, position: Point2D) => void;
  rotatePlacement: (id: string, delta: number) => void;
  flipPlacement: (id: string) => void;
  selectPlacement: (id: string) => void;
  clearSelection: () => void;
  deletePlacement: (id: string) => void;
  setBoardSize: (width: number, height: number) => void;
  setGridSize: (size: number) => void;
  setActiveLayer: (layer: "F.Cu" | "B.Cu") => void;
  toggleLayerVisibility: (layer: string) => void;
  setViewport: (viewport: PcbViewport) => void;
  pan: (dx: number, dy: number) => void;
  zoomAt: (centerX: number, centerY: number, factor: number) => void;
}

const DEFAULT_VISIBLE_LAYERS = new Set([
  "F.Cu",
  "B.Cu",
  "F.SilkS",
  "B.SilkS",
  "F.Mask",
  "B.Mask",
  "F.CrtYd",
  "Edge.Cuts",
  "ratsnest",
]);

function recalculateRatsnest(document: PcbDocument | null): RatsnestLine[] {
  if (!document) return [];
  return calculateRatsnest(
    document.nets,
    document.placements,
    document.traces,
    document.vias,
  );
}

const pcbUndoManager: UndoManager<PcbDocument> =
  createUndoManager<PcbDocument>(50);

export const usePcbStore = create<PcbStoreState>((set, get) => ({
  document: null,
  ratsnest: [],

  viewport: createDefaultPcbViewport(),
  activeLayer: "F.Cu",
  visibleLayers: new Set(DEFAULT_VISIBLE_LAYERS),
  gridSize: DEFAULT_GRID_SIZE,
  selectedIds: new Set(),
  activeTool: "select",

  undo: () => {
    const { document } = get();
    if (!document) return;

    const result = pcbUndoManager.undo(document);
    if (!result) return;

    set({
      document: result.restored,
      ratsnest: recalculateRatsnest(result.restored),
      selectedIds: new Set(),
    });
  },

  redo: () => {
    const { document } = get();
    if (!document) return;

    const result = pcbUndoManager.redo(document);
    if (!result) return;

    set({
      document: result.restored,
      ratsnest: recalculateRatsnest(result.restored),
      selectedIds: new Set(),
    });
  },

  canUndo: () => pcbUndoManager.canUndo(),
  canRedo: () => pcbUndoManager.canRedo(),

  initFromSchematic: (nets, symbols, components) => {
    const { document: existingDocument } = get();
    const componentLibrary = createComponentLibraryIndex(components);
    const result = syncSchematicToPcb(
      symbols,
      nets,
      componentLibrary,
      existingDocument,
      existingDocument?.boardOutline ?? { width: 100, height: 100 },
    );
    const document: PcbDocument = {
      ...result.document,
      netClasses:
        result.document.netClasses.length > 0
          ? result.document.netClasses
          : [...DEFAULT_NET_CLASSES],
    };

    set({
      document,
      ratsnest: result.ratsnest,
    });
  },

  syncFromSchematic: (nets, symbols, componentLibrary) => {
    const { document: existingDocument } = get();
    const result = syncSchematicToPcb(
      symbols,
      nets,
      componentLibrary,
      existingDocument,
      existingDocument?.boardOutline ?? { width: 100, height: 100 },
    );
    set({
      document: {
        ...result.document,
        netClasses:
          result.document.netClasses.length > 0
            ? result.document.netClasses
            : [...DEFAULT_NET_CLASSES],
      },
      ratsnest: result.ratsnest,
    });
  },

  setDocument: (doc) => {
    pcbUndoManager.clear();
    set({
      document: doc,
      ratsnest: recalculateRatsnest(doc),
    });
  },

  setActiveTool: (tool) => {
    set({ activeTool: tool });
  },

  movePlacement: (id, position) => {
    const { document } = get();
    if (!document) return;

    pcbUndoManager.pushUndo("Move placement", document);

    const placements = document.placements.map((p) =>
      p.id === id ? { ...p, position } : p,
    );
    const newDoc = { ...document, placements };

    set({
      document: newDoc,
      ratsnest: recalculateRatsnest(newDoc),
    });
  },

  rotatePlacement: (id, delta) => {
    const { document } = get();
    if (!document) return;

    pcbUndoManager.pushUndo("Rotate placement", document);

    const placements = document.placements.map((p) =>
      p.id === id ? { ...p, rotation: (p.rotation + delta) % 360 } : p,
    );
    const newDoc = { ...document, placements };

    set({
      document: newDoc,
      ratsnest: recalculateRatsnest(newDoc),
    });
  },

  flipPlacement: (id) => {
    const { document } = get();
    if (!document) return;

    pcbUndoManager.pushUndo("Flip placement", document);

    const placements = document.placements.map((p) =>
      p.id === id
        ? {
            ...p,
            layer: p.layer === "F.Cu" ? ("B.Cu" as const) : ("F.Cu" as const),
          }
        : p,
    );
    const newDoc = { ...document, placements };

    set({
      document: newDoc,
      ratsnest: recalculateRatsnest(newDoc),
    });
  },

  selectPlacement: (id) => {
    set({ selectedIds: new Set([id]) });
  },

  clearSelection: () => {
    set({ selectedIds: new Set() });
  },

  deletePlacement: (id) => {
    const { document, selectedIds } = get();
    if (!document) return;

    pcbUndoManager.pushUndo("Delete placement", document);

    const placements = document.placements.filter((p) => p.id !== id);
    const newDoc = { ...document, placements };

    const newSelectedIds = new Set(selectedIds);
    newSelectedIds.delete(id);

    set({
      document: newDoc,
      ratsnest: recalculateRatsnest(newDoc),
      selectedIds: newSelectedIds,
    });
  },

  setBoardSize: (width, height) => {
    const { document } = get();
    if (!document) return;

    set({
      document: {
        ...document,
        boardOutline: { width, height },
      },
    });
  },

  setGridSize: (size) => {
    set({ gridSize: size });
  },

  setActiveLayer: (layer) => {
    set({ activeLayer: layer });
  },

  toggleLayerVisibility: (layer) => {
    const { visibleLayers } = get();
    const newLayers = new Set(visibleLayers);
    if (newLayers.has(layer)) {
      newLayers.delete(layer);
    } else {
      newLayers.add(layer);
    }
    set({ visibleLayers: newLayers });
  },

  setViewport: (viewport) => {
    set({ viewport });
  },

  pan: (dx, dy) => {
    const { viewport } = get();
    set({
      viewport: {
        ...viewport,
        offsetX: viewport.offsetX + dx,
        offsetY: viewport.offsetY + dy,
      },
    });
  },

  zoomAt: (centerX, centerY, factor) => {
    const { viewport } = get();
    const newZoom = Math.max(0.1, Math.min(50, viewport.zoom * factor));
    const zoomRatio = newZoom / viewport.zoom;

    set({
      viewport: {
        offsetX: centerX - (centerX - viewport.offsetX) * zoomRatio,
        offsetY: centerY - (centerY - viewport.offsetY) * zoomRatio,
        zoom: newZoom,
      },
    });
  },
}));
