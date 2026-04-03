import { create } from "zustand";
import type {
  PcbDocument,
  PcbPlacement,
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
import type { ExtractedNet } from "@/components/pcb/canvas/net-extraction";
import type { EditorSchematicSymbol } from "@/components/pcb/types";
import type { ComponentType } from "@shared/types/component-library-schema.types";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";

interface PcbStoreState {
  document: PcbDocument | null;
  ratsnest: RatsnestLine[];

  viewport: PcbViewport;
  activeLayer: "F.Cu" | "B.Cu";
  visibleLayers: Set<string>;
  gridSize: number;
  selectedIds: Set<string>;
  activeTool: "select" | "place";

  initFromSchematic: (
    nets: ExtractedNet[],
    symbols: EditorSchematicSymbol[],
    components: ComponentType[],
  ) => void;
  setDocument: (doc: PcbDocument) => void;
  movePlacement: (id: string, position: Point2D) => void;
  rotatePlacement: (id: string, delta: number) => void;
  flipPlacement: (id: string) => void;
  selectPlacement: (id: string) => void;
  clearSelection: () => void;
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

export const usePcbStore = create<PcbStoreState>((set, get) => ({
  document: null,
  ratsnest: [],

  viewport: createDefaultPcbViewport(),
  activeLayer: "F.Cu",
  visibleLayers: new Set(DEFAULT_VISIBLE_LAYERS),
  gridSize: DEFAULT_GRID_SIZE,
  selectedIds: new Set(),
  activeTool: "select",

  initFromSchematic: (nets, symbols, components) => {
    const componentMap = new Map(components.map((c) => [c.id, c]));
    const placements: PcbPlacement[] = [];
    let placementX = 10;

    for (const symbol of symbols) {
      if (!symbol.componentId || symbol.componentId.startsWith("builtin:")) {
        continue;
      }

      const component = componentMap.get(symbol.componentId);
      if (!component) continue;

      const defaultVariant =
        component.variants.find((v) => v.id === component.defaultVariantId) ??
        component.variants[0];
      if (!defaultVariant) continue;

      const footprintOption =
        defaultVariant.footprintOptions.find(
          (f) => f.id === defaultVariant.defaultFootprintOptionId,
        ) ?? defaultVariant.footprintOptions[0];
      if (!footprintOption?.kicadPayload) continue;

      const footprintData =
        footprintOption.kicadPayload as ParsedKicadFootprint;

      placements.push({
        id: `pcb-${symbol.id}`,
        schematicSymbolId: symbol.id,
        componentId: symbol.componentId,
        variantId: defaultVariant.id,
        footprintOptionId: footprintOption.id,
        reference: symbol.reference ?? "?",
        value: symbol.value ?? "",
        position: { x: placementX, y: 50 },
        rotation: 0,
        layer: "F.Cu",
        footprintData,
      });

      placementX += 15;
    }

    const pcbNets = nets.map((net) => ({
      id: net.id,
      name: net.name ?? `Net_${net.id}`,
      netClass: "Default",
      padRefs: net.pinIds.map((pinId) => {
        const [symbolId, padNumber] = pinId.split("-");
        return {
          componentId: `pcb-${symbolId}`,
          padNumber: padNumber ?? "1",
        };
      }),
    }));

    const document: PcbDocument = {
      boardOutline: { width: 100, height: 100 },
      manufacturerPreset: "jlcpcb_standard",
      netClasses: [...DEFAULT_NET_CLASSES],
      nets: pcbNets,
      placements,
      traces: [],
      vias: [],
      zones: [],
    };

    set({
      document,
      ratsnest: recalculateRatsnest(document),
    });
  },

  setDocument: (doc) => {
    set({
      document: doc,
      ratsnest: recalculateRatsnest(doc),
    });
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

  rotatePlacement: (id, delta) => {
    const { document } = get();
    if (!document) return;

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
