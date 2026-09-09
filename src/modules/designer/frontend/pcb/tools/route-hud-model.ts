/**
 * Pure view-model builder for the route HUD. Keeps every displayed value —
 * net, layer, width + its source, via sizes, live length, DRC status — in one
 * testable place so the HUD component stays dumb.
 */
import type {
  PcbCopperLayerId,
  PcbNetClass,
  PcbTraceSegmentMode,
} from "../../../../../sdks";
import type {
  PointNm,
  RoutePosture,
  RouteSession,
  RouteWidthSource,
} from "./route-tool-state";
import { routeKeyHints, type RouteKeyBinding } from "./route-keymap";
import { polylineLength } from "../../../../../shared/pcb-geometry/pcb-trace-geometry";

const NM_PER_MM = 1_000_000;

/** Polyline length in mm (input points in integer nm). */
export function routeLengthMm(pathNm: readonly PointNm[]): number {
  return polylineLength(pathNm) / NM_PER_MM;
}

export interface RouteHudModel {
  netName: string | null;
  layer: PcbCopperLayerId;
  widthMm: number;
  widthSource: RouteWidthSource;
  /** Session net-class name — attributes the width/via defaults. */
  netClassName: string | null;
  viaDiameterMm: number | null;
  viaDrillMm: number | null;
  /** True when a route-time via size override is active. */
  viaOverridden: boolean;
  segmentMode: PcbTraceSegmentMode;
  posture: RoutePosture;
  /** Committed segments + pending ghost, mm. */
  lengthMm: number;
  /**
   * Length-match gauge (pcb.lengthTuning): the session net belongs to a
   * group. `totalMm` = already-committed net copper + this session's length.
   */
  lengthTarget: {
    groupName: string;
    targetMm: number;
    toleranceMm: number;
    totalMm: number;
  } | null;
  /**
   * Violations a `refuse` commit would be REJECTED for (live-parity contract
   * 07 §6 refuse set) — the HUD's "conflicts".
   */
  drcConflictCount: number;
  /**
   * The rest of the live verdict: codes in `L` that are reported but never
   * block (fab tiers, hole-to-hole, the netclass/manufacturability scalars).
   */
  drcWarningCount: number;
  /** Ghost head is currently bending around an obstacle (walkaround). */
  detourActive: boolean;
  hints: readonly RouteKeyBinding[];
}

export function buildRouteHudModel(input: {
  session: RouteSession;
  /** Active run's ghost path incl. the pending segment (nm). */
  previewPathNm: readonly PointNm[];
  netName: string | null;
  netClass: PcbNetClass | null;
  drcConflictCount: number;
  /** Non-blocking violations of the same verdict; defaults to 0. */
  drcWarningCount?: number;
  /** pcb.routeAutoFinish flag — shows/hides the Tab hint. */
  autoFinishEnabled?: boolean;
  /** Walkaround detour currently shaping the ghost head. */
  detourActive?: boolean;
  /** Length-match rule matching the session net (target + committed copper). */
  lengthTarget?: {
    groupName: string;
    targetMm: number;
    toleranceMm: number;
    /** Net copper already committed OUTSIDE this session (mm). */
    committedMm: number;
  } | null;
}): RouteHudModel {
  const s = input.session;
  // Total session length = accumulated runs (behind vias / width splits)
  // plus the active ghost.
  const pendingLengthMm = s.boundaries.reduce(
    (sum, b) => sum + (b.run ? routeLengthMm(b.run.pointsNm) : 0),
    0,
  );
  const sessionLengthMm = pendingLengthMm + routeLengthMm(input.previewPathNm);
  return {
    netName: input.netName,
    layer: s.layer,
    widthMm: s.widthMm,
    widthSource: s.widthSource,
    netClassName: input.netClass?.name ?? null,
    viaDiameterMm:
      s.viaDiameterMmOverride ?? input.netClass?.viaDiameterMm ?? null,
    viaDrillMm: s.viaDrillMmOverride ?? input.netClass?.viaDrillMm ?? null,
    viaOverridden:
      s.viaDiameterMmOverride !== undefined ||
      s.viaDrillMmOverride !== undefined,
    segmentMode: s.segmentMode,
    posture: s.posture,
    lengthMm: sessionLengthMm,
    lengthTarget: input.lengthTarget
      ? {
          groupName: input.lengthTarget.groupName,
          targetMm: input.lengthTarget.targetMm,
          toleranceMm: input.lengthTarget.toleranceMm,
          totalMm: input.lengthTarget.committedMm + sessionLengthMm,
        }
      : null,
    drcConflictCount: input.drcConflictCount,
    drcWarningCount: input.drcWarningCount ?? 0,
    detourActive: input.detourActive === true,
    hints: routeKeyHints({
      routing: true,
      primaryOnly: true,
      autoFinish: input.autoFinishEnabled,
    }),
  };
}
