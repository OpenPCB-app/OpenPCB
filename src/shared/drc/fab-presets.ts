import type { PcbFabricatorId, PcbViaType } from "../../sdks/designer";
import { below } from "../pcb-geometry/tolerance";

/**
 * Manufacturer capability minimums. JLCPCB values refreshed 2026-07-11 from
 * the live capabilities page (jlcpcb.com/capabilities/pcb-capabilities; see
 * DRC_AUDIT_REPORT.md §7 drift table + §8 sources). PCBWay rows carry the
 * previous-generation values pending a re-fetch (marked below). Values are
 * MINIMUMS the fab can produce — designs at or above these pass; below
 * requires a special-process upcharge or fails outright. Validation surfaces
 * non-blocking warnings.
 *
 * `custom` is the explicit opt-out: no validation, only the user's own
 * design rules apply.
 */
export interface PcbFabPreset {
  id: Exclude<PcbFabricatorId, "custom">;
  name: string;
  /**
   * Minimum ROUND drill (mm) for a via or a PLATED component hole. NPTH holes
   * have their own, larger floor (`minNpthDrillMm`) and slots have theirs
   * (contract 10 §4) — this row never applied to them, whatever it used to say.
   */
  minDrillMm: number;
  /**
   * Minimum ROUND drill (mm) for a NON-PLATED hole.
   * JLCPCB "Minimum NPTH Hole Size: 0.50mm"; PCBWay NPTH "0.15-6.0mm"
   * (`pcbway_std` keeps its 0.2 mm mechanical floor). Fetched 2026-09-10.
   */
  minNpthDrillMm: number;
  /**
   * Minimum routed-SLOT width (mm) for a PLATED slot.
   * JLCPCB "Minimum Plated Slot Width 2-layer 0.5mm / Multi-layer 0.35mm";
   * PCBWay "Plated slots ≥0.5mm". Fetched 2026-09-10.
   */
  minPlatedSlotWidthMm: number;
  /**
   * Minimum routed-SLOT width (mm) for a NON-PLATED slot.
   * JLCPCB "Minimum Non-Plated Slot Width 1.0mm"; PCBWay "Non-plated slots
   * ≥0.8mm". Fetched 2026-09-10. (Numerically today's `minSlotWidthMm`, which
   * the outline milling advisory keeps for its own, different purpose.)
   */
  minNpthSlotWidthMm: number;
  /** Minimum VIA outer (pad) diameter (mm). */
  minPadMm: number;
  /**
   * Minimum VIA annular ring per side (mm). JLCPCB: via OD must exceed the
   * hole by ≥ 0.1 mm total (0.05 per side; 0.075 recommended). Component
   * (PTH) holes have their own, larger minimum — `pthAnnularRingMm`.
   */
  minAnnularRingMm: number;
  /** Minimum COMPONENT-HOLE (PTH) annular ring per side (mm). */
  pthAnnularRingMm: number;
  /**
   * Minimum annular ring per side (mm) of a NON-PLATED hole that carries a
   * copper ring. JLCPCB "NPTH Pad Annular Ring ≧0.45mm"; PCBWay states none, so
   * the field is ABSENT there and no check runs. Fetched 2026-09-10.
   */
  npthAnnularRingMm?: number;
  /** Minimum trace width and clearance (mm). */
  minTraceWidthMm: number;
  minClearanceMm: number;
  /**
   * Maximum aspect ratio (board_thickness / drill_diameter) for THROUGH vias.
   * JLCPCB blog "Do not exceed 10:1 when plating through-holes"; PCBWay
   * "Thickness to diameter ratio ≤8" standard, 10 for high difficulty. Fetched
   * 2026-09-10. There is no per-layer thickness model and no preset states a
   * limit for blind / buried / micro vias, so they get NO aspect verdict (§5.2).
   */
  maxAspectRatio: number;
  /**
   * Via types the fabricator will build. JLCPCB: "Not supported. Currently we
   * don't support Blind/Buried Vias, only make through holes."; PCBWay lists
   * blind / buried only under separately quoted HDI rows, which are not
   * modelled. Fetched 2026-09-10. Every preset is `{through}` — and
   * `VIA_TYPE_UNSUPPORTED` fires on `custom` too, because the limit is
   * OpenPCB's own single-plated-drill-file export (§5.1).
   */
  viaTypes: ReadonlySet<PcbViaType>;
  /** Minimum hole-edge-to-hole-edge spacing between VIA drills (mm). */
  holeToHoleViaMm: number;
  /** Minimum hole-edge-to-hole-edge spacing involving PTH/NPTH drills (mm). */
  holeToHolePthMm: number;
  /** Copper-to-board-edge minimums (mm): routed edge / V-cut edge. */
  boardEdgeRoutedMm: number;
  boardEdgeVcutMm: number;
  /** Minimum solder-mask dam between openings (mm, 1 oz). */
  maskDamMm: number;
  /**
   * Milling limits for the board outline / cutouts. A routed internal (concave)
   * corner can't be sharper than the router-bit radius, and a slot / neck can't
   * be narrower than the bit diameter. Advisory (warnings).
   */
  minInternalRadiusMm: number;
  minSlotWidthMm: number;
}

export const FAB_PRESETS: Record<PcbFabPreset["id"], PcbFabPreset> = {
  jlcpcb_2l: {
    id: "jlcpcb_2l",
    name: "JLCPCB 2-layer",
    minDrillMm: 0.15,
    minNpthDrillMm: 0.5,
    minPlatedSlotWidthMm: 0.5,
    minNpthSlotWidthMm: 1.0,
    minPadMm: 0.25,
    minAnnularRingMm: 0.05,
    pthAnnularRingMm: 0.18,
    npthAnnularRingMm: 0.45,
    minTraceWidthMm: 0.1,
    minClearanceMm: 0.1,
    maxAspectRatio: 10,
    viaTypes: new Set<PcbViaType>(["through"]),
    holeToHoleViaMm: 0.2,
    holeToHolePthMm: 0.45,
    boardEdgeRoutedMm: 0.2,
    boardEdgeVcutMm: 0.4,
    maskDamMm: 0.1,
    minInternalRadiusMm: 0.8,
    minSlotWidthMm: 1.0,
  },
  jlcpcb_4l: {
    id: "jlcpcb_4l",
    name: "JLCPCB 4-layer",
    minDrillMm: 0.15,
    minNpthDrillMm: 0.5,
    minPlatedSlotWidthMm: 0.35,
    minNpthSlotWidthMm: 1.0,
    minPadMm: 0.25,
    minAnnularRingMm: 0.05,
    pthAnnularRingMm: 0.15,
    npthAnnularRingMm: 0.45,
    minTraceWidthMm: 0.0889,
    minClearanceMm: 0.0889,
    maxAspectRatio: 10,
    viaTypes: new Set<PcbViaType>(["through"]),
    holeToHoleViaMm: 0.2,
    holeToHolePthMm: 0.45,
    boardEdgeRoutedMm: 0.2,
    boardEdgeVcutMm: 0.4,
    maskDamMm: 0.1,
    minInternalRadiusMm: 0.8,
    minSlotWidthMm: 1.0,
  },
  // PCBWay rows: previous-generation values; re-fetch pending (P8 follow-up).
  pcbway_std: {
    id: "pcbway_std",
    name: "PCBWay Standard",
    minDrillMm: 0.2,
    minNpthDrillMm: 0.2,
    minPlatedSlotWidthMm: 0.5,
    minNpthSlotWidthMm: 1.0,
    minPadMm: 0.5,
    minAnnularRingMm: 0.15,
    pthAnnularRingMm: 0.15,
    minTraceWidthMm: 0.127,
    minClearanceMm: 0.127,
    maxAspectRatio: 8,
    viaTypes: new Set<PcbViaType>(["through"]),
    holeToHoleViaMm: 0.25,
    holeToHolePthMm: 0.45,
    boardEdgeRoutedMm: 0.3,
    boardEdgeVcutMm: 0.4,
    maskDamMm: 0.1,
    minInternalRadiusMm: 0.8,
    minSlotWidthMm: 1.0,
  },
  pcbway_advanced: {
    id: "pcbway_advanced",
    name: "PCBWay Advanced",
    minDrillMm: 0.15,
    minNpthDrillMm: 0.15,
    minPlatedSlotWidthMm: 0.5,
    minNpthSlotWidthMm: 0.8,
    minPadMm: 0.45,
    minAnnularRingMm: 0.1,
    pthAnnularRingMm: 0.15,
    minTraceWidthMm: 0.0889,
    minClearanceMm: 0.0889,
    maxAspectRatio: 10,
    viaTypes: new Set<PcbViaType>(["through"]),
    holeToHoleViaMm: 0.2,
    holeToHolePthMm: 0.45,
    boardEdgeRoutedMm: 0.2,
    boardEdgeVcutMm: 0.4,
    maskDamMm: 0.1,
    minInternalRadiusMm: 0.5,
    minSlotWidthMm: 0.8,
  },
};

export interface FabRuleViolation {
  /** The preset FIELD that was compared — the caller maps it to a rule code. */
  rule:
    | "minDrillMm"
    | "minNpthDrillMm"
    | "minPlatedSlotWidthMm"
    | "minNpthSlotWidthMm"
    | "minPadMm"
    | "minAnnularRingMm"
    | "pthAnnularRingMm"
    | "npthAnnularRingMm"
    | "minTraceWidthMm"
    | "minClearanceMm";
  fabValue: number;
  actualValue: number;
  message: string;
}

/**
 * Validate a via against a fab preset. Returns a list of violations; empty
 * means the via is fab-compliant. Caller surfaces violations as warnings,
 * not errors — design rules still drive the hard gate.
 */
export function validateViaAgainstFab(
  via: { diameterMm: number; drillMm: number },
  fabId: PcbFabricatorId,
): FabRuleViolation[] {
  if (fabId === "custom") return [];
  const preset = FAB_PRESETS[fabId];
  if (!preset) return [];
  const violations: FabRuleViolation[] = [];
  if (below(via.drillMm, preset.minDrillMm)) {
    violations.push({
      rule: "minDrillMm",
      fabValue: preset.minDrillMm,
      actualValue: via.drillMm,
      message: `Drill ${via.drillMm.toFixed(3)} mm < ${preset.name} min ${preset.minDrillMm.toFixed(3)} mm`,
    });
  }
  if (below(via.diameterMm, preset.minPadMm)) {
    violations.push({
      rule: "minPadMm",
      fabValue: preset.minPadMm,
      actualValue: via.diameterMm,
      message: `Pad ${via.diameterMm.toFixed(3)} mm < ${preset.name} min ${preset.minPadMm.toFixed(3)} mm`,
    });
  }
  const ar = (via.diameterMm - via.drillMm) / 2;
  if (below(ar, preset.minAnnularRingMm)) {
    violations.push({
      rule: "minAnnularRingMm",
      fabValue: preset.minAnnularRingMm,
      actualValue: ar,
      message: `Annular ring ${ar.toFixed(3)} mm < ${preset.name} min ${preset.minAnnularRingMm.toFixed(3)} mm`,
    });
  }
  return violations;
}

export function validateTraceAgainstFab(
  trace: { widthMm: number },
  fabId: PcbFabricatorId,
): FabRuleViolation[] {
  if (fabId === "custom") return [];
  const preset = FAB_PRESETS[fabId];
  if (!preset) return [];
  const violations: FabRuleViolation[] = [];
  if (below(trace.widthMm, preset.minTraceWidthMm)) {
    violations.push({
      rule: "minTraceWidthMm",
      fabValue: preset.minTraceWidthMm,
      actualValue: trace.widthMm,
      message: `Trace ${trace.widthMm.toFixed(3)} mm < ${preset.name} min ${preset.minTraceWidthMm.toFixed(3)} mm`,
    });
  }
  return violations;
}

/**
 * Validate a component hole (footprint pad / free pad / free hole) against a
 * fab preset. The row depends on the hole KIND and the TOOL (contract 10 §4):
 *
 * | Hole | Round | Slot |
 * |---|---|---|
 * | pth (plated) | `minDrillMm` | `minPlatedSlotWidthMm` |
 * | npth | `minNpthDrillMm` | `minNpthSlotWidthMm` |
 *
 * plus the annular ring per side when the hole carries one: `pthAnnularRingMm`
 * for a plated hole, `npthAnnularRingMm` for a non-plated ring — the latter
 * only when the preset states a value at all. Vias are validated by
 * `validateViaAgainstFab` with the via-specific rows instead.
 */
export function validateHoleAgainstFab(
  hole: {
    kind: "pth" | "npth";
    /** Tool diameter — the slot WIDTH when `slot` is true. */
    drillMm: number;
    slot: boolean;
    annularRingMm?: number;
  },
  fabId: PcbFabricatorId,
): FabRuleViolation[] {
  if (fabId === "custom") return [];
  const preset = FAB_PRESETS[fabId];
  if (!preset) return [];
  const violations: FabRuleViolation[] = [];
  const plated = hole.kind === "pth";
  const drillRule: FabRuleViolation["rule"] = hole.slot
    ? plated
      ? "minPlatedSlotWidthMm"
      : "minNpthSlotWidthMm"
    : plated
      ? "minDrillMm"
      : "minNpthDrillMm";
  const drillLimit = preset[drillRule];
  if (below(hole.drillMm, drillLimit)) {
    const subject = hole.slot
      ? `${plated ? "Plated" : "Non-plated"} slot width`
      : `${plated ? "Plated" : "Non-plated"} drill`;
    violations.push({
      rule: drillRule,
      fabValue: drillLimit,
      actualValue: hole.drillMm,
      message: `${subject} ${hole.drillMm.toFixed(3)} mm < ${preset.name} ${drillRule} ${drillLimit.toFixed(3)} mm`,
    });
  }
  if (hole.annularRingMm !== undefined) {
    const ringRule: FabRuleViolation["rule"] = plated
      ? "pthAnnularRingMm"
      : "npthAnnularRingMm";
    const ringLimit = plated
      ? preset.pthAnnularRingMm
      : preset.npthAnnularRingMm;
    // PCBWay states no NPTH ring minimum — absent means no check (§4).
    if (ringLimit !== undefined && below(hole.annularRingMm, ringLimit)) {
      violations.push({
        rule: ringRule,
        fabValue: ringLimit,
        actualValue: hole.annularRingMm,
        message: `${plated ? "PTH" : "NPTH"} annular ring ${hole.annularRingMm.toFixed(3)} mm < ${preset.name} ${ringRule} ${ringLimit.toFixed(3)} mm`,
      });
    }
  }
  return violations;
}
