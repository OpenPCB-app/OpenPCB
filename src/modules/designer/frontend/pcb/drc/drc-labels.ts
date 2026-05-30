import type {
  DesignerPcbProjection,
  DrcAnchor,
  DrcReport,
  DrcRuleCode,
  DrcSeverity,
} from "../../../../../sdks";

/** Human label per DRC rule code. Shared by the DRC panel + the canvas tooltip. */
export const CODE_LABEL: Record<DrcRuleCode, string> = {
  TRACE_WIDTH_MIN: "Trace width below minimum",
  VIA_DIAMETER_MIN: "Via diameter below minimum",
  VIA_DRILL_MIN: "Via drill below minimum",
  DRILL_SIZE_MIN: "Drill size below minimum",
  ANNULAR_RING_MIN: "Annular ring below minimum",
  TRACE_TO_TRACE_CLEARANCE: "Trace-to-trace clearance",
  TRACE_TO_PAD_CLEARANCE: "Trace-to-pad clearance",
  TRACE_TO_VIA_CLEARANCE: "Trace-to-via clearance",
  UNCONNECTED_NET: "Unconnected net",
  NET_SHORT_CIRCUIT: "Short circuit",
  TRACE_LAYER_MISMATCH: "Trace on invalid layer",
  PLACED_PART_MISSING_FOOTPRINT: "Missing footprint",
  FAB_TRACE_WIDTH: "Trace below fab minimum",
  FAB_CLEARANCE: "Clearance below fab minimum",
  FAB_ANNULAR_RING: "Annular below fab minimum",
  FAB_DRILL: "Drill below fab minimum",
  FAB_PAD: "Via pad below fab minimum",
  VIA_TO_VIA_CLEARANCE: "Via-to-via clearance",
  PAD_TO_PAD_CLEARANCE: "Pad-to-pad clearance",
  PAD_TO_VIA_CLEARANCE: "Pad-to-via clearance",
  COPPER_TO_BOARD_EDGE: "Copper too close to board edge",
  HOLE_TO_HOLE: "Hole-to-hole spacing",
  VIA_LAYER_SPAN: "Invalid via layer span",
  VIA_ASPECT_RATIO: "Via aspect ratio too high",
  BOARD_OUTLINE_INVALID: "Invalid board outline",
  COPPER_OFF_BOARD: "Copper outside board",
};

/** Short human label for a violation anchor (uses the projection for ref/net names). */
export function resolveAnchorLabel(
  anchor: DrcAnchor,
  projection: DesignerPcbProjection | null,
): string {
  switch (anchor.kind) {
    case "trace":
      return `trace ${anchor.traceId.slice(0, 6)}`;
    case "segment":
      return `trace ${anchor.traceId.slice(0, 6)}·${anchor.index}`;
    case "via":
      return `via ${anchor.viaId.slice(0, 6)}`;
    case "pad": {
      const ref = projection?.placements.find(
        (p) => p.id === anchor.placementId,
      )?.reference;
      return `${ref ?? "?"}.${anchor.padNumber}`;
    }
    case "freePad":
      return `pad ${anchor.freePadId.slice(0, 6)}`;
    case "freeHole":
      return `hole ${anchor.freeHoleId.slice(0, 6)}`;
    case "placement":
      return (
        projection?.placements.find((p) => p.id === anchor.placementId)
          ?.reference ?? "part"
      );
    case "net":
      return (
        projection?.netNames[anchor.netId] ?? `net ${anchor.netId.slice(0, 6)}`
      );
    case "boardEdge":
      return "board edge";
  }
}

/** A renderable/hit-testable DRC marker — one per non-waived violation with a location. */
export interface DrcMarker {
  id: string;
  x: number;
  y: number;
  severity: DrcSeverity;
  selected: boolean;
  hovered: boolean;
}

/**
 * Build the canvas marker list from the report. Single source of truth for
 * waiver filtering + selected/hovered flags, shared by `DrcMarkerLayer`
 * (rendering) and `hitDrcMarker` (hover/click hit-test) so they never drift.
 */
export function buildDrcMarkers(
  report: DrcReport | null,
  selectedId: string | null,
  hoveredId: string | null,
  waivedIds: readonly string[] | undefined,
): DrcMarker[] {
  const waived = new Set(waivedIds ?? []);
  const out: DrcMarker[] = [];
  for (const v of report?.violations ?? []) {
    if (!v.locationMm || waived.has(v.id)) continue;
    out.push({
      id: v.id,
      x: v.locationMm.x,
      y: v.locationMm.y,
      severity: v.severity,
      selected: v.id === selectedId,
      hovered: v.id === hoveredId,
    });
  }
  return out;
}
