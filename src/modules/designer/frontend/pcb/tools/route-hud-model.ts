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
   * group. `totalMm` = the net's ROUTED path length (SI contract 14 §6) plus
   * this session's in-flight polyline.
   */
  lengthTarget: {
    groupName: string;
    targetMm: number;
    toleranceMm: number;
    totalMm: number;
    /**
     * False when the net has no defined routed path and `totalMm` fell back to
     * the committed traces' polyline sum — the HUD marks the gauge "≈" rather
     * than hiding it, because an OPEN net is the normal case mid-route.
     */
    pathDefined: boolean;
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
    /**
     * The net's committed routed length (mm): its `computeNetPaths` path
     * length, or the committed traces' polyline sum when that path is
     * undefined (`pathDefined: false`).
     */
    committedMm: number;
    /** False when that path is undefined; defaults to true. */
    pathDefined?: boolean;
  } | null;
}): RouteHudModel {
  const s = input.session;
  // Total session length = accumulated runs (behind vias / width splits)
  // plus the active ghost.
  const pendingLengthMm = s.boundaries.reduce(
    (sum, b) => sum + (b.run ? routeLengthMm(b.run.pointsNm) : 0),
    0,
  );
  // The in-flight delta: copper this session has drawn but not committed, so
  // no path model has seen it yet. It is a PLAIN POLYLINE length — no pad
  // clipping, no via z — a stated v1 approximation (SI contract 14 §6, §10).
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
          // The gauge total the contract defines: the net's routed path length
          // plus the in-flight polyline delta.
          totalMm: input.lengthTarget.committedMm + sessionLengthMm,
          pathDefined: input.lengthTarget.pathDefined !== false,
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
