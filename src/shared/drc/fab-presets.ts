import type { PcbFabricatorId } from "../../sdks/designer";
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
  /** Minimum mechanical drill (mm) — applies to vias, PTH and NPTH holes. */
  minDrillMm: number;
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
  /** Minimum trace width and clearance (mm). */
  minTraceWidthMm: number;
  minClearanceMm: number;
  /** Maximum aspect ratio (board_thickness / drill_diameter) for through vias. */
  maxAspectRatio: number;
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
    minPadMm: 0.25,
    minAnnularRingMm: 0.05,
    pthAnnularRingMm: 0.18,
    minTraceWidthMm: 0.1,
    minClearanceMm: 0.1,
    maxAspectRatio: 10,
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
    minPadMm: 0.25,
    minAnnularRingMm: 0.05,
    pthAnnularRingMm: 0.15,
    minTraceWidthMm: 0.0889,
    minClearanceMm: 0.0889,
    maxAspectRatio: 10,
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
    minPadMm: 0.5,
    minAnnularRingMm: 0.15,
    pthAnnularRingMm: 0.15,
    minTraceWidthMm: 0.127,
    minClearanceMm: 0.127,
    maxAspectRatio: 8,
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
    minPadMm: 0.45,
    minAnnularRingMm: 0.1,
    pthAnnularRingMm: 0.15,
    minTraceWidthMm: 0.0889,
    minClearanceMm: 0.0889,
    maxAspectRatio: 10,
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
  rule:
    | "minDrillMm"
    | "minPadMm"
    | "minAnnularRingMm"
    | "pthAnnularRingMm"
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
 * Validate a plated component hole (TH footprint pad / free `std` pad)
 * against a fab preset: drill floor + PTH annular ring per side. NPTH holes
 * only get the drill floor (pass `padOdMm: undefined`).
 */
export function validateHoleAgainstFab(
  hole: { drillMm: number; padOdMm?: number },
  fabId: PcbFabricatorId,
): FabRuleViolation[] {
  if (fabId === "custom") return [];
  const preset = FAB_PRESETS[fabId];
  if (!preset) return [];
  const violations: FabRuleViolation[] = [];
  if (below(hole.drillMm, preset.minDrillMm)) {
    violations.push({
      rule: "minDrillMm",
      fabValue: preset.minDrillMm,
      actualValue: hole.drillMm,
      message: `Drill ${hole.drillMm.toFixed(3)} mm < ${preset.name} min ${preset.minDrillMm.toFixed(3)} mm`,
    });
  }
  if (hole.padOdMm !== undefined) {
    const ar = (hole.padOdMm - hole.drillMm) / 2;
    if (below(ar, preset.pthAnnularRingMm)) {
      violations.push({
        rule: "pthAnnularRingMm",
        fabValue: preset.pthAnnularRingMm,
        actualValue: ar,
        message: `PTH annular ring ${ar.toFixed(3)} mm < ${preset.name} min ${preset.pthAnnularRingMm.toFixed(3)} mm`,
      });
    }
  }
  return violations;
}
