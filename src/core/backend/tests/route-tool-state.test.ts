import { describe, expect, test } from "bun:test";
import {
  initialRouteToolState,
  nextPosture,
  routeToolReducer,
  sessionAnchors,
} from "../../../modules/designer/frontend/pcb/tools/route-tool-state";

const startEvent = {
  kind: "start",
  anchorNm: { x: 0, y: 0 },
  layer: "F.Cu",
  segmentMode: "manhattan-45",
  netId: null,
  netClassId: "default",
  widthMm: 0.25,
} as const;

describe("routeToolReducer", () => {
  test("transitions idle → routing on start", () => {
    const next = routeToolReducer(initialRouteToolState, startEvent);
    expect(next.kind).toBe("routing");
    if (next.kind === "routing") {
      expect(next.session.anchorNm).toEqual({ x: 0, y: 0 });
      expect(next.session.waypointsNm).toEqual([]);
      expect(next.session.layer).toBe("F.Cu");
    }
  });

  test("commits a waypoint", () => {
    const after = routeToolReducer(
      routeToolReducer(initialRouteToolState, startEvent),
      { kind: "commit-waypoint", pointNm: { x: 1_000_000, y: 0 } },
    );
    if (after.kind !== "routing") throw new Error("expected routing");
    expect(after.session.waypointsNm).toEqual([{ x: 1_000_000, y: 0 }]);
  });

  test("ignores duplicate consecutive waypoint", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const b = routeToolReducer(a, {
      kind: "commit-waypoint",
      pointNm: { x: 1_000_000, y: 0 },
    });
    const c = routeToolReducer(b, {
      kind: "commit-waypoint",
      pointNm: { x: 1_000_000, y: 0 },
    });
    if (c.kind !== "routing") throw new Error("expected routing");
    expect(c.session.waypointsNm.length).toBe(1);
  });

  test("step-back removes last waypoint, then exits to idle", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const b = routeToolReducer(a, {
      kind: "commit-waypoint",
      pointNm: { x: 1_000_000, y: 0 },
    });
    const c = routeToolReducer(b, { kind: "step-back" });
    if (c.kind !== "routing") throw new Error("expected routing");
    expect(c.session.waypointsNm.length).toBe(0);
    const d = routeToolReducer(c, { kind: "step-back" });
    expect(d.kind).toBe("idle");
  });

  test("rebase-layer resets anchor, clears waypoints, flips layer", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const withWaypoint = routeToolReducer(a, {
      kind: "commit-waypoint",
      pointNm: { x: 1_000_000, y: 0 },
    });
    const b = routeToolReducer(withWaypoint, {
      kind: "rebase-layer",
      layer: "B.Cu",
      anchorNm: { x: 2_000_000, y: 0 },
    });
    if (b.kind !== "routing") throw new Error("expected routing");
    expect(b.session.layer).toBe("B.Cu");
    expect(b.session.anchorNm).toEqual({ x: 2_000_000, y: 0 });
    expect(b.session.waypointsNm).toEqual([]);
    // Width / net / posture / segmentMode preserved.
    expect(b.session.widthMm).toBe(0.25);
    expect(b.session.netId).toBe(null);
    expect(b.session.netClassId).toBe("default");
    expect(b.session.segmentMode).toBe("manhattan-45");
  });

  test("set-via-diameter and set-via-drill update overrides", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const b = routeToolReducer(a, {
      kind: "set-via-diameter",
      diameterMmOverride: 0.9,
    });
    const c = routeToolReducer(b, {
      kind: "set-via-drill",
      drillMmOverride: 0.45,
    });
    if (c.kind !== "routing") throw new Error("expected routing");
    expect(c.session.viaDiameterMmOverride).toBe(0.9);
    expect(c.session.viaDrillMmOverride).toBe(0.45);

    // Setting back to undefined clears.
    const d = routeToolReducer(c, {
      kind: "set-via-diameter",
      diameterMmOverride: undefined,
    });
    if (d.kind !== "routing") throw new Error("expected routing");
    expect(d.session.viaDiameterMmOverride).toBeUndefined();
  });

  test("rebase-layer preserves via-size overrides", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const withOverride = routeToolReducer(a, {
      kind: "set-via-diameter",
      diameterMmOverride: 1.2,
    });
    const b = routeToolReducer(withOverride, {
      kind: "rebase-layer",
      layer: "B.Cu",
      anchorNm: { x: 2_000_000, y: 0 },
    });
    if (b.kind !== "routing") throw new Error("expected routing");
    expect(b.session.viaDiameterMmOverride).toBe(1.2);
  });

  test("set-mode toggles segment mode", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const b = routeToolReducer(a, { kind: "set-mode", mode: "manhattan-90" });
    if (b.kind !== "routing") throw new Error("expected routing");
    expect(b.session.segmentMode).toBe("manhattan-90");
  });

  test("set-width updates width", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const b = routeToolReducer(a, { kind: "set-width", widthMm: 0.5 });
    if (b.kind !== "routing") throw new Error("expected routing");
    expect(b.session.widthMm).toBe(0.5);
  });

  test("cancel returns to idle", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const b = routeToolReducer(a, { kind: "cancel" });
    expect(b.kind).toBe("idle");
  });

  test("sessionAnchors returns anchor + waypoints in order", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const b = routeToolReducer(a, {
      kind: "commit-waypoint",
      pointNm: { x: 1_000_000, y: 0 },
    });
    if (b.kind !== "routing") throw new Error("expected routing");
    expect(sessionAnchors(b.session)).toEqual([
      { x: 0, y: 0 },
      { x: 1_000_000, y: 0 },
    ]);
  });

  test("start defaults posture to auto", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    if (a.kind !== "routing") throw new Error("expected routing");
    expect(a.session.posture).toBe("auto");
  });

  test("cycle-posture rotates auto → axis → diagonal → auto", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const b = routeToolReducer(a, { kind: "cycle-posture" });
    const c = routeToolReducer(b, { kind: "cycle-posture" });
    const d = routeToolReducer(c, { kind: "cycle-posture" });
    if (b.kind !== "routing" || c.kind !== "routing" || d.kind !== "routing") {
      throw new Error("expected routing");
    }
    expect(b.session.posture).toBe("axis");
    expect(c.session.posture).toBe("diagonal");
    expect(d.session.posture).toBe("auto");
  });

  test("set-posture jumps directly to the requested value", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const b = routeToolReducer(a, {
      kind: "set-posture",
      posture: "diagonal",
    });
    if (b.kind !== "routing") throw new Error("expected routing");
    expect(b.session.posture).toBe("diagonal");
  });

  test("nextPosture wraps cleanly", () => {
    expect(nextPosture("auto")).toBe("axis");
    expect(nextPosture("axis")).toBe("diagonal");
    expect(nextPosture("diagonal")).toBe("auto");
  });

  test("rebase resets anchor + waypoints + width while keeping layer/net/posture", () => {
    const a = routeToolReducer(initialRouteToolState, startEvent);
    const b = routeToolReducer(a, {
      kind: "commit-waypoint",
      pointNm: { x: 1_000_000, y: 0 },
    });
    const c = routeToolReducer(b, {
      kind: "rebase",
      anchorNm: { x: 1_000_000, y: 0 },
      widthMm: 0.5,
    });
    if (c.kind !== "routing") throw new Error("expected routing");
    expect(c.session.anchorNm).toEqual({ x: 1_000_000, y: 0 });
    expect(c.session.waypointsNm).toEqual([]);
    expect(c.session.widthMm).toBe(0.5);
    expect(c.session.layer).toBe("F.Cu"); // preserved
    expect(c.session.netClassId).toBe("default"); // preserved
    expect(c.session.posture).toBe("auto"); // preserved
  });
});
