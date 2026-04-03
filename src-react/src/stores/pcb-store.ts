import { create } from "zustand";
import type {
  PcbDocument,
  PcbViewport,
  Point2D,
  RatsnestLine,
  TraceSegment,
  Via,
  PadReference,
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
import {
  calculateManhattanPath,
  snapPointToGrid,
} from "@/components/pcb-editor/routing/manhattan-path";
import {
  resolveNetClassWidths,
  findWidthIndex,
} from "@/components/pcb-editor/routing/net-class-resolve";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export interface RoutingSession {
  netId: string;
  layer: string;
  width: number;
  widthPresets: number[];
  widthIndex: number;
  elbowDirection: "horizontal_first" | "vertical_first";
  committedSegments: TraceSegment[];
  committedVias: Via[];
  startPoint: Point2D;
  previewSegments: TraceSegment[];
  viaDiameter: number;
  viaDrill: number;
}

interface PcbStoreState {
  document: PcbDocument | null;
  ratsnest: RatsnestLine[];
  routingSession: RoutingSession | null;
  lastCursorPosition: Point2D | null;

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
  beginPlacementMove: (id: string) => void;
  rotatePlacement: (id: string, delta: number) => void;
  flipPlacement: (id: string) => void;
  selectEntity: (id: string, additive?: boolean) => void;
  selectAllPlacements: () => void;
  clearSelection: () => void;
  deleteSelectedEntities: () => void;
  setBoardSize: (width: number, height: number) => void;
  setGridSize: (size: number) => void;
  setActiveLayer: (layer: "F.Cu" | "B.Cu") => void;
  toggleLayerVisibility: (layer: string) => void;
  setViewport: (viewport: PcbViewport) => void;
  pan: (dx: number, dy: number) => void;
  zoomAt: (centerX: number, centerY: number, factor: number) => void;

  startRouting: (padRef: PadReference, worldPosition: Point2D) => void;
  updateRoutingPreview: (cursorPosition: Point2D) => void;
  addRoutingCorner: (position: Point2D) => void;
  placeRoutingVia: (position: Point2D) => void;
  completeRoute: (targetPadPosition: Point2D) => void;
  cancelRouting: () => void;
  cycleTraceWidth: (direction: 1 | -1) => void;
  flipElbowDirection: () => void;
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

function buildRoutingPreview(
  session: RoutingSession,
  cursorPosition: Point2D | null,
): TraceSegment[] {
  if (!cursorPosition) {
    return [];
  }

  return calculateManhattanPath(
    session.startPoint,
    cursorPosition,
    session.elbowDirection,
    session.width,
    session.layer,
    session.netId,
  );
}

function updateRoutingSession(
  session: RoutingSession,
  overrides: Partial<RoutingSession>,
  cursorPosition: Point2D | null,
): RoutingSession {
  const nextSession = {
    ...session,
    ...overrides,
  };

  return {
    ...nextSession,
    previewSegments: buildRoutingPreview(nextSession, cursorPosition),
  };
}

const pcbUndoManager: UndoManager<PcbDocument> =
  createUndoManager<PcbDocument>(50);

export const usePcbStore = create<PcbStoreState>((set, get) => ({
  document: null,
  ratsnest: [],
  routingSession: null,
  lastCursorPosition: null,

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
    set((state) => ({
      activeTool: tool,
      routingSession: tool === "route" ? state.routingSession : null,
      lastCursorPosition: tool === "route" ? state.lastCursorPosition : null,
    }));
  },

  movePlacement: (id, position) => {
    const { document } = get();
    if (!document) return;

    const placements = document.placements.map((p) =>
      p.id === id ? { ...p, position } : p,
    );
    const newDoc = { ...document, placements };

    set({
      document: newDoc,
      ratsnest: recalculateRatsnest(newDoc),
    });
  },

  beginPlacementMove: (id) => {
    const { document } = get();
    if (!document) return;

    const placement = document.placements.find((item) => item.id === id);
    if (!placement) return;

    pcbUndoManager.pushUndo("Move placement", document);
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

  selectEntity: (id, additive = false) => {
    set((state) => {
      if (!additive) {
        return { selectedIds: new Set([id]) };
      }

      const selectedIds = new Set(state.selectedIds);
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }

      return { selectedIds };
    });
  },

  selectAllPlacements: () => {
    const { document } = get();
    if (!document) return;

    set({ selectedIds: new Set(document.placements.map((placement) => placement.id)) });
  },

  clearSelection: () => {
    set({ selectedIds: new Set() });
  },

  deleteSelectedEntities: () => {
    const { document, selectedIds } = get();
    if (!document || selectedIds.size === 0) return;

    const placementIds = new Set(document.placements.map((placement) => placement.id));
    const traceIds = new Set(document.traces.map((trace) => trace.id));
    const viaIds = new Set(document.vias.map((via) => via.id));

    const placements = document.placements.filter(
      (placement) => !selectedIds.has(placement.id),
    );
    const traces = document.traces.filter((trace) => !selectedIds.has(trace.id));
    const vias = document.vias.filter((via) => !selectedIds.has(via.id));
    const newDoc = { ...document, placements, traces, vias };

    const removedSomething = Array.from(selectedIds).some(
      (id) => placementIds.has(id) || traceIds.has(id) || viaIds.has(id),
    );
    if (!removedSomething) {
      return;
    }

    pcbUndoManager.pushUndo("Delete selected entities", document);

    set({
      document: newDoc,
      ratsnest: recalculateRatsnest(newDoc),
      selectedIds: new Set(),
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

  startRouting: (padRef, worldPosition) => {
    const { document, activeLayer } = get();
    if (!document) return;

    const net = document.nets.find((n) =>
      n.padRefs.some(
        (pr) =>
          pr.componentId === padRef.componentId &&
          pr.padNumber === padRef.padNumber,
      ),
    );
    if (!net) return;

    const resolved = resolveNetClassWidths(net.id, document);

    set({
      routingSession: {
        netId: net.id,
        layer: activeLayer,
        width: resolved.defaultWidth,
        widthPresets: resolved.presets,
        widthIndex: findWidthIndex(resolved.defaultWidth, resolved.presets),
        elbowDirection: "horizontal_first",
        committedSegments: [],
        committedVias: [],
        startPoint: worldPosition,
        previewSegments: [],
        viaDiameter: resolved.viaDiameter,
        viaDrill: resolved.viaDrill,
      },
      lastCursorPosition: worldPosition,
      activeTool: "route",
      selectedIds: new Set(),
    });
  },

  updateRoutingPreview: (cursorPosition) => {
    const { routingSession, gridSize } = get();
    if (!routingSession) return;

    const snapped = snapPointToGrid(cursorPosition, gridSize);

    set({
      routingSession: updateRoutingSession(routingSession, {}, snapped),
      lastCursorPosition: snapped,
    });
  },

  addRoutingCorner: (position) => {
    const { routingSession, gridSize } = get();
    if (!routingSession) return;

    const snapped = snapPointToGrid(position, gridSize);

    const newSegments = calculateManhattanPath(
      routingSession.startPoint,
      snapped,
      routingSession.elbowDirection,
      routingSession.width,
      routingSession.layer,
      routingSession.netId,
    );

    set({
      routingSession: {
        ...routingSession,
        committedSegments: [
          ...routingSession.committedSegments,
          ...newSegments,
        ],
        startPoint: snapped,
        previewSegments: buildRoutingPreview(
          {
            ...routingSession,
            committedSegments: [
              ...routingSession.committedSegments,
              ...newSegments,
            ],
            startPoint: snapped,
          },
          get().lastCursorPosition,
        ),
      },
    });
  },

  placeRoutingVia: (position) => {
    const { routingSession, gridSize } = get();
    if (!routingSession) return;

    const snapped = snapPointToGrid(position, gridSize);

    const newSegments = calculateManhattanPath(
      routingSession.startPoint,
      snapped,
      routingSession.elbowDirection,
      routingSession.width,
      routingSession.layer,
      routingSession.netId,
    );

    const via: Via = {
      id: generateId(),
      position: snapped,
      padDiameter: routingSession.viaDiameter,
      drillDiameter: routingSession.viaDrill,
      net: routingSession.netId,
      type: "through",
      layers: ["F.Cu", "B.Cu"],
      tented: true,
    };

    const newLayer = routingSession.layer === "F.Cu" ? "B.Cu" : "F.Cu";

    set({
      routingSession: updateRoutingSession(
        routingSession,
        {
          committedSegments: [
            ...routingSession.committedSegments,
            ...newSegments,
          ],
          committedVias: [...routingSession.committedVias, via],
          startPoint: snapped,
          layer: newLayer,
        },
        get().lastCursorPosition,
      ),
      activeLayer: newLayer as "F.Cu" | "B.Cu",
    });
  },

  completeRoute: (targetPadPosition) => {
    const { document, routingSession } = get();
    if (!document || !routingSession) return;

    const finalSegments = calculateManhattanPath(
      routingSession.startPoint,
      targetPadPosition,
      routingSession.elbowDirection,
      routingSession.width,
      routingSession.layer,
      routingSession.netId,
    );

    const allSegments = [...routingSession.committedSegments, ...finalSegments];
    const tracesWithIds: TraceSegment[] = allSegments.map((seg) => ({
      ...seg,
      id: generateId(),
    }));

    pcbUndoManager.pushUndo("Route traces", document);

    const newDoc: PcbDocument = {
      ...document,
      traces: [...document.traces, ...tracesWithIds],
      vias: [...document.vias, ...routingSession.committedVias],
    };

    set({
      document: newDoc,
      ratsnest: recalculateRatsnest(newDoc),
      routingSession: null,
      lastCursorPosition: null,
      activeTool: "route",
    });
  },

  cancelRouting: () => {
    set({
      routingSession: null,
      lastCursorPosition: null,
    });
  },

  cycleTraceWidth: (direction) => {
    const { routingSession, lastCursorPosition } = get();
    if (!routingSession) return;

    const { widthPresets, widthIndex } = routingSession;
    const newIndex =
      (widthIndex + direction + widthPresets.length) % widthPresets.length;
    const newWidth = widthPresets[newIndex] ?? routingSession.width;

    set({
      routingSession: updateRoutingSession(
        routingSession,
        {
          widthIndex: newIndex,
          width: newWidth,
        },
        lastCursorPosition,
      ),
    });
  },

  flipElbowDirection: () => {
    const { routingSession, lastCursorPosition } = get();
    if (!routingSession) return;

    set({
      routingSession: updateRoutingSession(
        routingSession,
        {
          elbowDirection:
            routingSession.elbowDirection === "horizontal_first"
              ? "vertical_first"
              : "horizontal_first",
        },
        lastCursorPosition,
      ),
    });
  },
}));
