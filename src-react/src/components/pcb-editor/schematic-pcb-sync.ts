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

interface NormalizedGraphic {
  type: ParsedKicadFootprint["graphics"][number]["type"];
  layer: string;
  data: Record<string, unknown>;
}

function isPowerNet(name: string | null | undefined): boolean {
  const normalized = name?.trim().toUpperCase();
  return normalized === "GND" || normalized === "VCC";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePoint(value: unknown): Point2D | null {
  if (Array.isArray(value)) {
    return {
      x: toFiniteNumber(value[0]),
      y: toFiniteNumber(value[1]),
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  return {
    x: toFiniteNumber(value.x),
    y: toFiniteNumber(value.y),
  };
}

function normalizePad(payload: unknown): ParsedKicadFootprint["pads"][number] | null {
  if (!isRecord(payload)) {
    return null;
  }

  const position = normalizePoint(payload.position);
  const sizeRecord = isRecord(payload.size) ? payload.size : null;
  if (!position || !sizeRecord) {
    return null;
  }

  const layers = Array.isArray(payload.layers)
    ? payload.layers.filter((layer): layer is string => typeof layer === "string")
    : [];

  return {
    number: typeof payload.number === "string" ? payload.number : "",
    type:
      payload.type === "thru_hole" ||
      payload.type === "np_thru_hole" ||
      payload.type === "connect"
        ? payload.type
        : "smd",
    shape:
      payload.shape === "circle" ||
      payload.shape === "oval" ||
      payload.shape === "roundrect" ||
      payload.shape === "trapezoid" ||
      payload.shape === "custom"
        ? payload.shape
        : "rect",
    position,
    size: {
      width: toFiniteNumber(sizeRecord.width, 1),
      height: toFiniteNumber(sizeRecord.height, 1),
    },
    rotation: toFiniteNumber(payload.rotation),
    layers,
    roundrectRatio: toFiniteNumber(payload.roundrectRatio, undefined),
    drillDiameter: toFiniteNumber(payload.drillDiameter, undefined),
    drillOffset: normalizePoint(payload.drillOffset) ?? undefined,
  };
}

function normalizeGraphic(payload: unknown): NormalizedGraphic | null {
  if (!isRecord(payload) || typeof payload.type !== "string") {
    return null;
  }

  const layer = typeof payload.layer === "string" ? payload.layer : "F.Fab";
  const data = isRecord(payload.data) ? { ...payload.data } : null;

  if (data) {
    if (payload.type === "poly") {
      const points = Array.isArray(data.points)
        ? data.points.map(normalizePoint).filter((point): point is Point2D => point !== null)
        : Array.isArray(data.pts)
          ? data.pts
              .map((entry) => {
                if (!Array.isArray(entry) || entry[0] !== "xy") {
                  return null;
                }
                return normalizePoint({ x: entry[1], y: entry[2] });
              })
              .filter((point): point is Point2D => point !== null)
          : [];

      return { type: "poly", layer, data: { ...data, points } };
    }

    return {
      type: payload.type as NormalizedGraphic["type"],
      layer,
      data: {
        ...data,
        start: normalizePoint(data.start) ?? data.start,
        end: normalizePoint(data.end) ?? data.end,
        mid: normalizePoint(data.mid) ?? data.mid,
        center: normalizePoint(data.center) ?? data.center,
      },
    };
  }

  if (payload.type === "line") {
    return {
      type: "line",
      layer,
      data: {
        start: normalizePoint(payload.start),
        end: normalizePoint(payload.end),
        width: toFiniteNumber(payload.strokeWidth, 0.12),
      },
    };
  }

  if (payload.type === "rect") {
    const center = normalizePoint(payload.position);
    if (!center) {
      return null;
    }
    const halfWidth = toFiniteNumber(payload.width) / 2;
    const halfHeight = toFiniteNumber(payload.height) / 2;
    return {
      type: "rect",
      layer,
      data: {
        start: { x: center.x - halfWidth, y: center.y - halfHeight },
        end: { x: center.x + halfWidth, y: center.y + halfHeight },
        width: toFiniteNumber(payload.strokeWidth, 0.12),
        fill: payload.filled ? "solid" : "none",
      },
    };
  }

  if (payload.type === "circle") {
    const center = normalizePoint(payload.center);
    if (!center) {
      return null;
    }
    const radius = toFiniteNumber(payload.radius);
    return {
      type: "circle",
      layer,
      data: {
        center,
        end: { x: center.x + radius, y: center.y },
        width: toFiniteNumber(payload.strokeWidth, 0.12),
        fill: payload.filled ? "solid" : "none",
      },
    };
  }

  if (payload.type === "polygon") {
    const points = Array.isArray(payload.points)
      ? payload.points.map(normalizePoint).filter((point): point is Point2D => point !== null)
      : [];
    return {
      type: "poly",
      layer,
      data: {
        points,
        width: toFiniteNumber(payload.strokeWidth, 0.12),
        fill: payload.filled ? "solid" : "none",
      },
    };
  }

  if (payload.type === "text") {
    return {
      type: "text",
      layer,
      data: {
        at: [
          toFiniteNumber(isRecord(payload.position) ? payload.position.x : undefined),
          toFiniteNumber(isRecord(payload.position) ? payload.position.y : undefined),
          toFiniteNumber(payload.rotation),
        ],
        __args: [payload.content],
        width: toFiniteNumber(payload.strokeWidth, 0.12),
      },
    };
  }

  return null;
}

function inferFootprintType(
  pads: ParsedKicadFootprint["pads"],
): ParsedKicadFootprint["attributes"]["type"] {
  if (pads.some((pad) => pad.type === "thru_hole" || pad.type === "np_thru_hole")) {
    return "through_hole";
  }
  if (pads.some((pad) => pad.type === "smd")) {
    return "smd";
  }
  return "unknown";
}

function normalizeFootprintPayload(payload: unknown): ParsedKicadFootprint | null {
  if (!isRecord(payload)) {
    return null;
  }

  const pads = Array.isArray(payload.pads)
    ? payload.pads.map(normalizePad).filter((pad): pad is ParsedKicadFootprint["pads"][number] => pad !== null)
    : [];
  const graphics = Array.isArray(payload.graphics)
    ? payload.graphics
        .map(normalizeGraphic)
        .filter((graphic): graphic is ParsedKicadFootprint["graphics"][number] => graphic !== null)
    : [];

  const metadata = isRecord(payload.metadata) ? payload.metadata : null;
  const importPreservation = isRecord(payload.importPreservation)
    ? payload.importPreservation
    : null;
  const model3dRefsSource = Array.isArray(payload.model3dRefs)
    ? payload.model3dRefs
    : Array.isArray(importPreservation?.model3dReferences)
      ? importPreservation.model3dReferences
      : [];
  const model3dRefs = model3dRefsSource.filter(isRecord).map((ref) => ({
    path: typeof ref.path === "string" ? ref.path : "",
    resolvedFileName:
      typeof ref.resolvedFileName === "string" ? ref.resolvedFileName : "",
    offset: isRecord(ref.offset)
      ? {
          x: toFiniteNumber(ref.offset.x),
          y: toFiniteNumber(ref.offset.y),
          z: toFiniteNumber(ref.offset.z),
        }
      : { x: 0, y: 0, z: 0 },
    scale: isRecord(ref.scale)
      ? {
          x: toFiniteNumber(ref.scale.x, 1),
          y: toFiniteNumber(ref.scale.y, 1),
          z: toFiniteNumber(ref.scale.z, 1),
        }
      : { x: 1, y: 1, z: 1 },
    rotation: isRecord(ref.rotation)
      ? {
          x: toFiniteNumber(ref.rotation.x),
          y: toFiniteNumber(ref.rotation.y),
          z: toFiniteNumber(ref.rotation.z),
        }
      : { x: 0, y: 0, z: 0 },
  }));

  const rawSource =
    typeof payload.rawSource === "string"
      ? payload.rawSource
      : typeof payload.rawKicadSource === "string"
        ? payload.rawKicadSource
        : typeof importPreservation?.rawSource === "string"
          ? importPreservation.rawSource
          : "";

  const attributesSource = isRecord(payload.attributes)
    ? payload.attributes
    : isRecord(importPreservation?.attributes)
      ? importPreservation.attributes
      : null;

  return {
    name:
      typeof payload.name === "string"
        ? payload.name
        : typeof metadata?.name === "string"
          ? metadata.name
          : "",
    description:
      typeof payload.description === "string"
        ? payload.description
        : typeof metadata?.description === "string"
          ? metadata.description
          : "",
    tags: Array.isArray(payload.tags)
      ? payload.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    pads,
    graphics,
    model3dRefs,
    attributes: {
      type:
        attributesSource?.type === "smd" ||
        attributesSource?.type === "through_hole" ||
        attributesSource?.type === "virtual"
          ? attributesSource.type
          : inferFootprintType(pads),
    },
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.filter(isRecord).map((warning) => ({
          code: typeof warning.code === "string" ? warning.code : "warning",
          message:
            typeof warning.message === "string" ? warning.message : "Unknown warning",
        }))
      : Array.isArray(importPreservation?.warnings)
        ? importPreservation.warnings.filter(isRecord).map((warning) => ({
            code: typeof warning.code === "string" ? warning.code : "warning",
            message:
              typeof warning.message === "string"
                ? warning.message
                : "Unknown warning",
          }))
        : [],
    rawSource,
  };
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

    if (!footprintOption) {
      console.warn("Skipping PCB sync for missing footprint option", {
        componentId: symbol.componentId,
        variantId: variant.id,
        symbolId: symbol.id,
      });
      continue;
    }

    const footprintData = normalizeFootprintPayload(footprintOption.kicadPayload);
    if (!footprintData) {
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
      footprintData,
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
