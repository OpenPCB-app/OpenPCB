import type { PcbFabricatorId } from "../../../../sdks/designer";

/**
 * Manufacturer capability minimums sourced from public capability pages
 * (JLCPCB, PCBWay) circa 2025. Values are MINIMUMS the fab can produce —
 * designs at or above these pass; below requires a special-process upcharge
 * or fails outright. Validation surfaces non-blocking warnings.
 *
 * `custom` is the explicit opt-out: no validation, only the user's own
 * design rules apply.
 */
export interface PcbFabPreset {
  id: Exclude<PcbFabricatorId, "custom">;
  name: string;
  /** Minimum drill / pad diameter for vias (mm). */
  minDrillMm: number;
  minPadMm: number;
  minAnnularRingMm: number;
  /** Minimum trace width and clearance (mm). */
  minTraceWidthMm: number;
  minClearanceMm: number;
  /** Maximum aspect ratio (board_thickness / drill_diameter) for through vias. */
  maxAspectRatio: number;
}

export const FAB_PRESETS: Record<PcbFabPreset["id"], PcbFabPreset> = {
  jlcpcb_2l: {
    id: "jlcpcb_2l",
    name: "JLCPCB 2-layer",
    minDrillMm: 0.3,
    minPadMm: 0.6,
    minAnnularRingMm: 0.15,
    minTraceWidthMm: 0.127,
    minClearanceMm: 0.127,
    maxAspectRatio: 10,
  },
  jlcpcb_4l: {
    id: "jlcpcb_4l",
    name: "JLCPCB 4-layer",
    minDrillMm: 0.2,
    minPadMm: 0.45,
    minAnnularRingMm: 0.15,
    minTraceWidthMm: 0.0889,
    minClearanceMm: 0.0889,
    maxAspectRatio: 10,
  },
  pcbway_std: {
    id: "pcbway_std",
    name: "PCBWay Standard",
    minDrillMm: 0.2,
    minPadMm: 0.5,
    minAnnularRingMm: 0.15,
    minTraceWidthMm: 0.127,
    minClearanceMm: 0.127,
    maxAspectRatio: 8,
  },
  pcbway_advanced: {
    id: "pcbway_advanced",
    name: "PCBWay Advanced",
    minDrillMm: 0.15,
    minPadMm: 0.45,
    minAnnularRingMm: 0.15,
    minTraceWidthMm: 0.0889,
    minClearanceMm: 0.0889,
    maxAspectRatio: 10,
  },
};

export interface FabRuleViolation {
  rule:
    | "minDrillMm"
    | "minPadMm"
    | "minAnnularRingMm"
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
  if (via.drillMm < preset.minDrillMm) {
    violations.push({
      rule: "minDrillMm",
      fabValue: preset.minDrillMm,
      actualValue: via.drillMm,
      message: `Drill ${via.drillMm.toFixed(3)} mm < ${preset.name} min ${preset.minDrillMm.toFixed(3)} mm`,
    });
  }
  if (via.diameterMm < preset.minPadMm) {
    violations.push({
      rule: "minPadMm",
      fabValue: preset.minPadMm,
      actualValue: via.diameterMm,
      message: `Pad ${via.diameterMm.toFixed(3)} mm < ${preset.name} min ${preset.minPadMm.toFixed(3)} mm`,
    });
  }
  const ar = (via.diameterMm - via.drillMm) / 2;
  if (ar < preset.minAnnularRingMm) {
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
  if (trace.widthMm < preset.minTraceWidthMm) {
    violations.push({
      rule: "minTraceWidthMm",
      fabValue: preset.minTraceWidthMm,
      actualValue: trace.widthMm,
      message: `Trace ${trace.widthMm.toFixed(3)} mm < ${preset.name} min ${preset.minTraceWidthMm.toFixed(3)} mm`,
    });
  }
  return violations;
}
