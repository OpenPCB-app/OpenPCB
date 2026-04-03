import { calculateRatsnest } from "./ratsnest";
import type {
  BoardOutline,
  NetClass,
  PcbDocument,
  PcbNet,
  PcbPlacement,
  Point2D,
  RatsnestLine,
} from "./pcb-types";
import type { ExtractedNet } from "@/components/pcb/canvas/net-extraction";
import type { EditorSchematicSymbol } from "@/components/pcb/types";
import {
  resolveComponentAndVariant,
  type ComponentLibraryIndex,
} from "@/components/pcb/symbol-library";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";

export interface SyncResult {
  document: PcbDocument;
  placements: PcbPlacement[];
  nets: PcbNet[];
  ratsnest: RatsnestLine[];
  added: string[];
  removed: string[];
}

interface ResolvedPlacementData {
  symbol: EditorSchematicSymbol;
  placementId: string;
  variantId: string;
  footprintOptionId: string;
  footprintData: ParsedKicadFootprint;
}

function isPowerNet(name: string | null | undefined): boolean {
  const normalized = name?.trim().toUpperCase();
  return normalized === "GND" || normalized === "VCC";
}

function getFootprintBounds(footprint: ParsedKicadFootprint): {
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pad of footprint.pads) {
    const halfWidth = pad.size.width / 2;
    const halfHeight = pad.size.height / 2;
    minX = Math.min(minX, pad.position.x - halfWidth);
    minY = Math.min(minY, pad.position.y - halfHeight);
    maxX = Math.max(maxX, pad.position.x + halfWidth);
    maxY = Math.max(maxY, pad.position.y + halfHeight);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { width: 10, height: 10 };
  }

  return {
    width: Math.max(maxX - minX, 2),
    height: Math.max(maxY - minY, 2),
  };
}

function autoLayoutNewPlacements(
  pendingPlacements: ResolvedPlacementData[],
  boardOutline: BoardOutline,
): Map<string, Point2D> {
  const positions = new Map<string, Point2D>();
  const gap = 2;
  const startX = Math.max(boardOutline.width / 2 - 15, 5);
  const startY = Math.max(boardOutline.height / 2 - 15, 5);
  const maxRowWidth = Math.max(boardOutline.width - 10, 20);

  let cursorX = startX;
  let cursorY = startY;
  let rowHeight = 0;

  for (const entry of pendingPlacements) {
    const bounds = getFootprintBounds(entry.footprintData);
    const itemWidth = bounds.width + gap;
    const itemHeight = bounds.height + gap;

    if (cursorX + itemWidth > maxRowWidth) {
      cursorX = startX;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }

    positions.set(entry.placementId, {
      x: cursorX + bounds.width / 2,
      y: cursorY + bounds.height / 2,
    });

    cursorX += itemWidth;
    rowHeight = Math.max(rowHeight, itemHeight);
  }

  return positions;
}

function resolvePlacementData(
  symbols: EditorSchematicSymbol[],
  componentLibrary: ComponentLibraryIndex,
): ResolvedPlacementData[] {
  const resolved: ResolvedPlacementData[] = [];

  for (const symbol of symbols) {
    if (!symbol.componentId || symbol.componentId.startsWith("builtin:")) {
      continue;
    }

    const resolvedComponent = resolveComponentAndVariant(
      componentLibrary,
      symbol.componentId,
      symbol.variantId,
    );
    if (!resolvedComponent) {
      console.warn("Skipping PCB sync for unresolved component", {
        componentId: symbol.componentId,
        variantId: symbol.variantId,
        symbolId: symbol.id,
      });
      continue;
    }

    const { variant } = resolvedComponent;
    const footprintOption =
      variant.footprintOptions.find(
        (option) => option.id === variant.defaultFootprintOptionId,
      ) ??
      variant.footprintOptions.find((option) => option.isDefault) ??
      variant.footprintOptions[0];

    if (!footprintOption?.kicadPayload) {
      console.warn("Skipping PCB sync for missing footprint payload", {
        componentId: symbol.componentId,
        variantId: variant.id,
        symbolId: symbol.id,
      });
      continue;
    }

    resolved.push({
      symbol,
      placementId: `pcb-${symbol.id}`,
      variantId: variant.id,
      footprintOptionId: footprintOption.id,
      footprintData: footprintOption.kicadPayload as ParsedKicadFootprint,
    });
  }

  return resolved;
}

function buildPadRefsForNet(
  net: ExtractedNet,
  resolvedPlacements: Map<string, ResolvedPlacementData>,
): PcbNet["padRefs"] {
  const padRefs: PcbNet["padRefs"] = [];

  for (const pinId of net.pinIds) {
    for (const resolved of resolvedPlacements.values()) {
      const pin = resolved.symbol.pins.find((candidate) => candidate.id === pinId);
      if (!pin) {
        continue;
      }

      padRefs.push({
        componentId: resolved.placementId,
        padNumber: pin.name,
      });
      break;
    }
  }

  return padRefs;
}

export function syncSchematicToPcb(
  schematicSymbols: EditorSchematicSymbol[],
  extractedNets: ExtractedNet[],
  componentLibrary: ComponentLibraryIndex,
  existingPcbDoc: PcbDocument | null,
  boardOutline: BoardOutline,
): SyncResult {
  const resolvedPlacementEntries = resolvePlacementData(
    schematicSymbols,
    componentLibrary,
  );
  const resolvedPlacementMap = new Map(
    resolvedPlacementEntries.map((entry) => [entry.symbol.id, entry]),
  );
  const existingPlacements = new Map(
    (existingPcbDoc?.placements ?? []).map((placement) => [
      placement.schematicSymbolId,
      placement,
    ]),
  );

  const newEntries = resolvedPlacementEntries.filter(
    (entry) => !existingPlacements.has(entry.symbol.id),
  );
  const autoLayoutPositions = autoLayoutNewPlacements(newEntries, boardOutline);

  const placements: PcbPlacement[] = resolvedPlacementEntries.map((entry) => {
    const existing = existingPlacements.get(entry.symbol.id);
    return {
      id: entry.placementId,
      schematicSymbolId: entry.symbol.id,
      componentId: entry.symbol.componentId!,
      variantId: entry.variantId,
      footprintOptionId: entry.footprintOptionId,
      reference: entry.symbol.reference ?? existing?.reference ?? "?",
      value: entry.symbol.value ?? existing?.value ?? "",
      position:
        existing?.position ??
        autoLayoutPositions.get(entry.placementId) ?? { x: 10, y: 10 },
      rotation: existing?.rotation ?? 0,
      layer: existing?.layer ?? "F.Cu",
      footprintData: entry.footprintData,
    };
  });

  const nets: PcbNet[] = extractedNets.map((net) => ({
    id: net.id,
    name: net.name ?? `Net_${net.id}`,
    netClass: isPowerNet(net.name) ? "Power" : "Default",
    padRefs: buildPadRefsForNet(net, resolvedPlacementMap),
  }));

  const document: PcbDocument = {
    boardOutline,
    manufacturerPreset:
      existingPcbDoc?.manufacturerPreset ?? "jlcpcb_standard",
    netClasses: existingPcbDoc?.netClasses ?? [],
    nets,
    placements,
    traces: existingPcbDoc?.traces ?? [],
    vias: existingPcbDoc?.vias ?? [],
    zones: existingPcbDoc?.zones ?? [],
  };

  const ratsnest = calculateRatsnest(
    document.nets,
    document.placements,
    document.traces,
    document.vias,
  );

  const nextIds = new Set(placements.map((placement) => placement.schematicSymbolId));
  const previousIds = new Set(
    (existingPcbDoc?.placements ?? []).map((placement) => placement.schematicSymbolId),
  );

  const added = placements
    .filter((placement) => !previousIds.has(placement.schematicSymbolId))
    .map((placement) => placement.reference);
  const removed = (existingPcbDoc?.placements ?? [])
    .filter((placement) => !nextIds.has(placement.schematicSymbolId))
    .map((placement) => placement.reference);

  return {
    document,
    placements,
    nets,
    ratsnest,
    added,
    removed,
  };
}

export function createDefaultPcbNetClasses(): NetClass[] {
  return [
    {
      name: "Default",
      traceWidth: 0.25,
      clearance: 0.2,
      viaDiameter: 0.6,
      viaDrill: 0.3,
    },
    {
      name: "Power",
      traceWidth: 0.5,
      clearance: 0.25,
      viaDiameter: 0.8,
      viaDrill: 0.4,
    },
  ];
}
