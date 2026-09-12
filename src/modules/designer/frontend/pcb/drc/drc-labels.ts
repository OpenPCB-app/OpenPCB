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
  PAD_LAYER_MISMATCH: "Pad on invalid layer",
  NETCLASS_TRACE_WIDTH: "Trace narrower than net class",
  NETCLASS_VIA_DIAMETER: "Via smaller than net class",
  NETCLASS_VIA_DRILL: "Via drill smaller than net class",
  HOLE_TO_BOARD_EDGE: "Hole too close to board edge",
  HOLE_OFF_BOARD: "Hole outside board",
  TRACK_DANGLING: "Dangling trace",
  VIA_DANGLING: "Dangling via",
  CREEPAGE_DISTANCE: "IPC-2221 conductor spacing (voltage)",
  TRACE_CURRENT_WIDTH:
    "Trace narrower than the IPC-2221 width for its class current",
  DIFF_PAIR_GAP: "Diff-pair gap off target",
  DIFF_PAIR_SKEW: "Diff-pair length skew",
  DIFF_PAIR_UNCOUPLED_LENGTH: "Diff-pair uncoupled run too long",
  PLACED_PART_MISSING_FOOTPRINT: "Missing footprint",
  NPTH_PAD_NET: "Net on a non-plated pad",
  FAB_TRACE_WIDTH: "Trace below fab minimum",
  FAB_CLEARANCE: "Clearance below fab minimum",
  FAB_ANNULAR_RING: "Annular below fab minimum",
  FAB_HOLE_TO_HOLE: "Hole spacing below fab minimum",
  FAB_DRILL: "Drill below fab minimum",
  FAB_PAD: "Via pad below fab minimum",
  NET_LENGTH_OUT_OF_RANGE: "Net length out of range",
  VIA_TO_VIA_CLEARANCE: "Via-to-via clearance",
  PAD_TO_PAD_CLEARANCE: "Pad-to-pad clearance",
  PAD_TO_VIA_CLEARANCE: "Pad-to-via clearance",
  COPPER_TO_BOARD_EDGE: "Copper too close to board edge",
  HOLE_TO_HOLE: "Hole-to-hole spacing",
  COPPER_TO_HOLE: "Copper too close to a non-plated hole",
  VIA_LAYER_SPAN: "Invalid via layer span",
  VIA_ASPECT_RATIO: "Via aspect ratio too high",
  VIA_TYPE_UNSUPPORTED: "Via type cannot be manufactured",
  BOARD_OUTLINE_INVALID: "Invalid board outline",
  OUTLINE_INTERNAL_RADIUS: "Internal corner radius too small",
  OUTLINE_SLOT_WIDTH: "Board slot / neck too narrow",
  COPPER_OFF_BOARD: "Copper outside board",
  ISOLATED_COPPER_ISLAND: "Isolated copper island",
  KEEPOUT_VIOLATION: "Object inside keepout",
  ZONE_OVERLAP: "Zones overlap with different nets",
  ZONE_INVALID: "Invalid zone or keepout",
  ZONE_EMPTY_FILL: "Zone pours no copper",
  ZONE_FILL_FAILED: "Zone fill failed",
  DRC_RULE_INVALID: "Design rule cannot be applied",
  DRC_RULE_INEFFECTIVE: "Design rule has no effect",
  COURTYARD_OVERLAP: "Courtyards overlap",
  COURTYARD_INVALID: "Courtyard could not be resolved",
  SILK_TO_MASK_CLEARANCE: "Silkscreen over a mask opening",
  SILK_TO_BOARD_EDGE: "Silkscreen too close to board edge",
  FAB_SILK_CLEARANCE: "Silkscreen to pad below fab minimum",
  FAB_SILK_WIDTH: "Silkscreen line below fab minimum",
  FAB_SILK_TEXT_HEIGHT: "Silkscreen text below fab minimum",
  MASK_BRIDGE: "Solder-mask dam too narrow",
  FAB_MASK_BRIDGE: "Mask dam below fab minimum",
  MASK_SLIVER: "Solder-mask sliver",
  FAB_MASK_TO_COPPER: "Mask opening exposes foreign copper",
  COPPER_CONNECTION_WIDTH: "Copper connection too narrow",
  COPPER_SLIVER: "Copper sliver",
  COPPER_SHAPE_UNCHECKED: "Copper shape not checked",
  TRACE_ACUTE_ANGLE: "Acute trace angle",
  TRACE_OVERLAP: "Overlapping traces",
  OUTLINE_MIN_WEB: "Board material too narrow",
  // Covers all three homes of the code (12 §4, §5): the web certificate and the
  // two exact recomputations that can run out of budget.
  OUTLINE_WEB_UNCHECKED: "Board geometry not fully checked",
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
    case "zone": {
      const zone = projection?.zones.find((z) => z.id === anchor.zoneId);
      // The user's own name first (contract §7); the net is only a fallback for
      // imported zones, which carry a net but no name.
      if (zone?.name) return `zone ${zone.name}`;
      return zone?.netName
        ? `zone ${zone.netName}`
        : `zone ${anchor.zoneId.slice(0, 6)}`;
    }
    case "keepout": {
      const keepout = projection?.keepouts?.find(
        (k) => k.id === anchor.keepoutId,
      );
      return `keepout ${keepout?.name ?? anchor.keepoutId.slice(0, 6)}`;
    }
    case "diffPair": {
      const p = projection?.netNames[anchor.pNetId] ?? anchor.pNetId.slice(0, 4);
      const n = projection?.netNames[anchor.nNetId] ?? anchor.nNetId.slice(0, 4);
      return `pair ${p}/${n}`;
    }
    case "lengthGroup": {
      const group = projection?.board.lengthMatchGroups?.find(
        (g) => g.id === anchor.groupId,
      );
      return group
        ? `length group ${group.name}`
        : `length group ${anchor.groupId.slice(0, 6)}`;
    }
    case "rule":
      return `rule ${anchor.ruleId.slice(0, 12)}`;
    case "overlayShape":
      return `drawing ${anchor.shapeId.slice(0, 6)}`;
    case "overlayText": {
      // The text itself is the only name an overlay text has — an id prefix
      // tells the user nothing about which label on the board is meant.
      const text = projection?.overlayTexts?.find(
        (t) => t.id === anchor.textId,
      )?.text;
      return text ? `text "${text}"` : `text ${anchor.textId.slice(0, 6)}`;
    }
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
