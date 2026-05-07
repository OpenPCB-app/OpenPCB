import type {
  PcbCopperLayerId,
  PcbTraceSegmentMode,
} from "../../../../../sdks";

export interface PointNm {
  x: number;
  y: number;
}

/** Posture cycle order (matches PcbCanvas `/` key cycling). */
export type RoutePosture = "auto" | "axis" | "diagonal";

export const POSTURE_CYCLE: ReadonlyArray<RoutePosture> = [
  "auto",
  "axis",
  "diagonal",
];

export function nextPosture(current: RoutePosture): RoutePosture {
  const idx = POSTURE_CYCLE.indexOf(current);
  return POSTURE_CYCLE[(idx + 1) % POSTURE_CYCLE.length]!;
}

/**
 * RouteSession captures the state of an in-progress trace placement.
 *
 *  - `anchorNm`: the last committed vertex of the route (start = first pad/click).
 *  - `waypointsNm`: subsequent committed vertices (intermediate clicks). The
 *    cursor extends a *pending* segment from the last waypoint to the snapped
 *    cursor; that pending segment is committed on the next click.
 *  - `layer`: the active copper layer the segments are being routed on. Smart
 *    Via flips this and inserts a via at the cursor.
 *  - `posture`: corner-posture for elbows in the current session (`auto` infers
 *    from prior segment direction; `/` key cycles auto→axis→diagonal).
 */
export interface RouteSession {
  anchorNm: PointNm;
  waypointsNm: PointNm[];
  layer: PcbCopperLayerId;
  segmentMode: PcbTraceSegmentMode;
  netId: string | null;
  netClassId: string;
  widthMm: number;
  posture: RoutePosture;
}

export type RouteToolState =
  | { kind: "idle" }
  | { kind: "routing"; session: RouteSession };

export type RouteToolEvent =
  | {
      kind: "start";
      anchorNm: PointNm;
      layer: PcbCopperLayerId;
      segmentMode: PcbTraceSegmentMode;
      netId: string | null;
      netClassId: string;
      widthMm: number;
      posture?: RoutePosture;
    }
  | { kind: "commit-waypoint"; pointNm: PointNm }
  | { kind: "switch-layer"; layer: PcbCopperLayerId; viaCenterNm: PointNm }
  | { kind: "set-mode"; mode: PcbTraceSegmentMode }
  | { kind: "set-width"; widthMm: number }
  | { kind: "set-posture"; posture: RoutePosture }
  | { kind: "cycle-posture" }
  /**
   * Reset the session to a single anchor at `anchorNm`, preserving layer / net
   * / posture / width settings. Used after a width change splits the trace —
   * the in-flight segments get committed at the old width, a new session
   * starts at the join point with the new width.
   */
  | {
      kind: "rebase";
      anchorNm: PointNm;
      widthMm: number;
    }
  | { kind: "step-back" }
  | { kind: "cancel" };

export const initialRouteToolState: RouteToolState = { kind: "idle" };

export function routeToolReducer(
  state: RouteToolState,
  event: RouteToolEvent,
): RouteToolState {
  switch (event.kind) {
    case "start":
      return {
        kind: "routing",
        session: {
          anchorNm: event.anchorNm,
          waypointsNm: [],
          layer: event.layer,
          segmentMode: event.segmentMode,
          netId: event.netId,
          netClassId: event.netClassId,
          widthMm: event.widthMm,
          posture: event.posture ?? "auto",
        },
      };
    case "cancel":
      return { kind: "idle" };
    default:
      break;
  }
  if (state.kind !== "routing") return state;
  switch (event.kind) {
    case "commit-waypoint": {
      const last =
        state.session.waypointsNm[state.session.waypointsNm.length - 1] ??
        state.session.anchorNm;
      if (last.x === event.pointNm.x && last.y === event.pointNm.y) {
        return state;
      }
      return {
        kind: "routing",
        session: {
          ...state.session,
          waypointsNm: [...state.session.waypointsNm, event.pointNm],
        },
      };
    }
    case "switch-layer":
      return {
        kind: "routing",
        session: {
          ...state.session,
          layer: event.layer,
          waypointsNm: [...state.session.waypointsNm, event.viaCenterNm],
          anchorNm: state.session.anchorNm,
        },
      };
    case "set-mode":
      return {
        kind: "routing",
        session: { ...state.session, segmentMode: event.mode },
      };
    case "set-width":
      return {
        kind: "routing",
        session: { ...state.session, widthMm: event.widthMm },
      };
    case "set-posture":
      return {
        kind: "routing",
        session: { ...state.session, posture: event.posture },
      };
    case "cycle-posture":
      return {
        kind: "routing",
        session: {
          ...state.session,
          posture: nextPosture(state.session.posture),
        },
      };
    case "rebase":
      return {
        kind: "routing",
        session: {
          ...state.session,
          anchorNm: event.anchorNm,
          waypointsNm: [],
          widthMm: event.widthMm,
        },
      };
    case "step-back": {
      if (state.session.waypointsNm.length === 0) return { kind: "idle" };
      return {
        kind: "routing",
        session: {
          ...state.session,
          waypointsNm: state.session.waypointsNm.slice(0, -1),
        },
      };
    }
    default:
      return state;
  }
}

/** All committed anchors (anchor + waypoints) of the current session. */
export function sessionAnchors(session: RouteSession): PointNm[] {
  return [session.anchorNm, ...session.waypointsNm];
}
