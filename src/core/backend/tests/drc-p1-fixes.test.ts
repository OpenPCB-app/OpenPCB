// P1 correctness fixes for the DRC engine (see plan
// ~/.claude/plans/claude-plans-you-are-reviewing-a-lively-steady-torvalds.md):
//   C8  getDrcResult guards a corrupt persisted blob (returns null, no throw)
//   C13 projectPointToSegment degenerate guard uses EPS² (not a dead EPS check)
//   C12 violation-id escapes separators + 64-bit hash (no cross-anchor collision)
//   C4  a via dropped on a same-net through-hole pad is not a HOLE_TO_HOLE breach
//   C11 drill-size for every hole; annular ring for TH/std pads; via aspect by span
//   C7  trace↔trace marker sits at the true point of closest approach
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { getDrcResult } from "../../../modules/designer/backend/drc-results";
import { computeViolationId } from "../../../modules/designer/backend/drc/violation-id";
import {
  polylineToPolylineClosestPoints,
  projectPointToSegment,
} from "../../../modules/designer/backend/pcb/pcb-trace-geometry";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import type { FootprintRenderSourcePad } from "../../../shared/rendering/types";
import type {
  DesignerPcbProjection,
  DrcReport,
  DrcRuleCode,
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbFreeHole,
  PcbFreePad,
  PcbPlacedPart,
  PcbVia,
} from "../../../sdks/designer";

const TS = "2026-01-01T00:00:00.000Z";

function board(overrides: Partial<PcbBoardSettings> = {}): PcbBoardSettings {
  return { ...createDefaultPcbBoardSettings(TS), ...overrides };
}

function projection(
  parts: Partial<DesignerPcbProjection> = {},
): DesignerPcbProjection {
  return {
    designId: "d1",
    revision: 1,
    board: parts.board ?? board(),
    placements: parts.placements ?? [],
    traces: parts.traces ?? [],
    vias: parts.vias ?? [],
    freeHoles: parts.freeHoles ?? [],
    freePads: parts.freePads ?? [],
    overlayTexts: parts.overlayTexts ?? [],
    overlayShapes: parts.overlayShapes ?? [],
    zones: parts.zones ?? [],
    ratsnest: parts.ratsnest ?? [],
    netNames: parts.netNames ?? {},
    padNets: parts.padNets,
    warnings: [],
  };
}

function via(
  id: string,
  opts: {
    netId?: string | null;
    center?: { x: number; y: number };
    diameterMm?: number;
    drillMm?: number;
    fromLayer?: PcbCopperLayerId;
    toLayer?: PcbCopperLayerId;
  } = {},
): PcbVia {
  return {
    id,
    netId: opts.netId ?? null,
    netClassId: "default",
    centerMm: opts.center ?? { x: 0, y: 0 },
    diameterMm: opts.diameterMm ?? 0.8,
    drillMm: opts.drillMm ?? 0.4,
    fromLayer: opts.fromLayer ?? "F.Cu",
    toLayer: opts.toLayer ?? "B.Cu",
    viaType: "through",
    protection: "tented",
    provenance: "route",
  };
}

/** SMD pad (no drill). */
function pad(
  number: string,
  center: { x: number; y: number },
  w: number,
  h: number,
  shape: FootprintRenderSourcePad["shape"] = "rect",
): FootprintRenderSourcePad {
  return {
    id: `pad-${number}`,
    number,
    shape,
    centerMm: center,
    widthMm: w,
    heightMm: h,
    rotationDeg: 0,
  };
}

/** Through-hole pad (carries a drill). */
function thPad(
  number: string,
  center: { x: number; y: number },
  w: number,
  h: number,
  drillMm: number,
): FootprintRenderSourcePad {
  return { ...pad(number, center, w, h, "circle"), drillDiameterMm: drillMm };
}

function placement(
  id: string,
  opts: {
    positionMm?: { x: number; y: number };
    rotationDeg?: number;
    pads?: FootprintRenderSourcePad[];
  } = {},
): PcbPlacedPart {
  return {
    id,
    partId: id,
    componentId: "c",
    reference: id,
    positionMm: opts.positionMm ?? { x: 0, y: 0 },
    rotationDeg: opts.rotationDeg ?? 0,
    mirrored: false,
    layer: "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads: opts.pads ?? [],
        graphics: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
  };
}

function freeHole(
  id: string,
  center: { x: number; y: number },
  drillMm: number,
): PcbFreeHole {
  return { id, centerMm: center, drillMm, lockedAt: null };
}

function freeStdPad(
  id: string,
  center: { x: number; y: number },
  size: number,
  drillMm: number,
): PcbFreePad {
  return {
    id,
    centerMm: center,
    rotationDeg: 0,
    padType: "std",
    shape: "circle",
    widthMm: size,
    heightMm: size,
    drillMm,
    layer: "F.Cu",
    netId: null,
    solderMaskExpansionMm: null,
    solderPasteExpansionMm: null,
    lockedAt: null,
  };
}

function codes(report: DrcReport): DrcRuleCode[] {
  return report.violations.map((v) => v.code);
}

describe("DRC P1 — C8 getDrcResult corrupt-row guard", () => {
  // Minimal fake of the drizzle query chain used by getDrcResultRow:
  //   db.select().from(...).where(...).get()
  function fakeDb(row: unknown): Parameters<typeof getDrcResult>[0] {
    const chain = {
      from: () => chain,
      where: () => chain,
      get: () => row,
    };
    return { select: () => chain } as unknown as Parameters<
      typeof getDrcResult
    >[0];
  }

  test("a corrupt violationsJson blob returns null instead of throwing", () => {
    const db = fakeDb({ violationsJson: "{ this is not json" });
    expect(getDrcResult(db, "d1")).toBeNull();
  });

  test("a valid row is still reconstructed", () => {
    const db = fakeDb({
      violationsJson: "[]",
      ranAtRevision: 7,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      ranAt: TS,
    });
    const result = getDrcResult(db, "d1");
    expect(result?.report.revision).toBe(7);
    expect(result?.report.violations).toEqual([]);
  });
});

describe("DRC P1 — C13 projectPointToSegment degenerate guard", () => {
  test("a truly zero-length segment collapses to the start point", () => {
    const r = projectPointToSegment(
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.distance).toBeCloseTo(Math.SQRT2, 10);
  });

  test("a sub-µm (but non-zero) segment still projects onto itself", () => {
    // length 1e-4 mm: lenSq = 1e-8. The old `lenSq < EPS` (1e-6) wrongly treated
    // this as degenerate and returned the start (x=0); `lenSq < EPS*EPS` (1e-12)
    // does not, so the point projects to the segment midpoint (x≈5e-5).
    const r = projectPointToSegment(
      { x: 5e-5, y: 1 },
      { x: 0, y: 0 },
      { x: 1e-4, y: 0 },
    );
    expect(r.x).toBeCloseTo(5e-5, 12);
    expect(r.t).toBeCloseTo(0.5, 6);
  });
});

describe("DRC P1 — C12 violation-id hardening", () => {
  test("ids are order-independent (A,B) === (B,A)", () => {
    const a = computeViolationId("TRACE_TO_TRACE_CLEARANCE", [
      { kind: "trace", traceId: "x" },
      { kind: "trace", traceId: "y" },
    ]);
    const b = computeViolationId("TRACE_TO_TRACE_CLEARANCE", [
      { kind: "trace", traceId: "y" },
      { kind: "trace", traceId: "x" },
    ]);
    expect(a).toBe(b);
  });

  test("separator-bearing ids that aliased under the old scheme are now distinct", () => {
    // Pad ("x","1:2") vs ("x:1","2") both built "p:x:1:2" before escaping.
    const a = computeViolationId("PAD_TO_PAD_CLEARANCE", [
      { kind: "pad", placementId: "x", padNumber: "1:2" },
    ]);
    const b = computeViolationId("PAD_TO_PAD_CLEARANCE", [
      { kind: "pad", placementId: "x:1", padNumber: "2" },
    ]);
    expect(a).not.toBe(b);

    // A net id containing "|" vs two separate net anchors both joined "n:a|n:b".
    const c = computeViolationId("NET_SHORT_CIRCUIT", [
      { kind: "net", netId: "a|n:b" },
    ]);
    const d = computeViolationId("NET_SHORT_CIRCUIT", [
      { kind: "net", netId: "a" },
      { kind: "net", netId: "b" },
    ]);
    expect(c).not.toBe(d);
  });

  test("id is a 16-hex 64-bit hash suffix", () => {
    const id = computeViolationId("HOLE_TO_HOLE", [
      { kind: "via", viaId: "v1" },
    ]);
    expect(id).toMatch(/^HOLE_TO_HOLE-[0-9a-f]{16}$/);
  });
});

describe("DRC P1 — C4 via-in-pad hole skip", () => {
  test("a via on a same-net through-hole pad is not a HOLE_TO_HOLE breach", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("A", { pads: [thPad("1", { x: 0, y: 0 }, 1.5, 1.5, 0.4)] }),
        ],
        vias: [via("v1", { netId: "n1", center: { x: 0, y: 0 } })],
        padNets: { "A|1": "n1" },
      }),
    );
    expect(codes(report)).not.toContain("HOLE_TO_HOLE");
  });

  test("coincident holes on different nets are still flagged", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("A", { pads: [thPad("1", { x: 0, y: 0 }, 1.5, 1.5, 0.4)] }),
        ],
        vias: [via("v1", { netId: "n2", center: { x: 0, y: 0 } })],
        padNets: { "A|1": "n1" },
      }),
    );
    expect(codes(report)).toContain("HOLE_TO_HOLE");
  });
});

describe("DRC P1 — C11 manufacturability coverage", () => {
  test("a free hole below the drill-size minimum is flagged", () => {
    const report = runDrc(
      projection({ freeHoles: [freeHole("h1", { x: 0, y: 0 }, 0.3)] }),
    );
    expect(codes(report)).toContain("DRILL_SIZE_MIN");
  });

  test("a free hole at the drill-size minimum is not flagged", () => {
    const report = runDrc(
      projection({ freeHoles: [freeHole("h1", { x: 0, y: 0 }, 0.4)] }),
    );
    expect(codes(report)).not.toContain("DRILL_SIZE_MIN");
  });

  test("a through-hole footprint pad with a thin annular ring is flagged", () => {
    // OD 1.0, drill 0.9 → annular 0.05 < 0.2 minimum.
    const report = runDrc(
      projection({
        placements: [
          placement("A", { pads: [thPad("1", { x: 0, y: 0 }, 1.0, 1.0, 0.9)] }),
        ],
        padNets: { "A|1": "n1" },
      }),
    );
    expect(codes(report)).toContain("ANNULAR_RING_MIN");
    expect(codes(report)).not.toContain("DRILL_SIZE_MIN");
  });

  test("a free std pad with a thin annular ring is flagged", () => {
    // OD 0.6, drill 0.5 → annular 0.05 < 0.2 minimum.
    const report = runDrc(
      projection({ freePads: [freeStdPad("p1", { x: 0, y: 0 }, 0.6, 0.5)] }),
    );
    expect(codes(report)).toContain("ANNULAR_RING_MIN");
  });

  test("via aspect ratio scales by span depth (blind via spared, through via flagged)", () => {
    const b = board({
      layerCount: 4,
      boardThicknessMm: 5,
      fabricator: "jlcpcb_4l", // maxAspectRatio 10
    });
    // Through via spans the full 5 mm → 12.5:1 > 10 → flagged.
    const through = runDrc(
      projection({
        board: b,
        vias: [via("v", { fromLayer: "F.Cu", toLayer: "B.Cu", drillMm: 0.4 })],
      }),
    );
    expect(codes(through)).toContain("VIA_ASPECT_RATIO");
    // Blind via spans 1/3 of the stackup → ~1.67 mm → 4.2:1 < 10 → spared.
    const blind = runDrc(
      projection({
        board: b,
        vias: [
          via("v", { fromLayer: "F.Cu", toLayer: "In1.Cu", drillMm: 0.4 }),
        ],
      }),
    );
    expect(codes(blind)).not.toContain("VIA_ASPECT_RATIO");
  });
});

describe("DRC P1 — C7 marker at the true closest point", () => {
  test("trace↔trace closest-point pair is between the nearest segments", () => {
    // Horizontal trace y=0 over x∈[0,10]; short vertical trace near x=5.
    const a = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const b = [
      { x: 5, y: 0.2 },
      { x: 5, y: 4 },
    ];
    const cp = polylineToPolylineClosestPoints(a, b);
    expect(cp.distance).toBeCloseTo(0.2, 6);
    expect(cp.a.x).toBeCloseTo(5, 6);
    expect(cp.a.y).toBeCloseTo(0, 6);
    expect(cp.b.x).toBeCloseTo(5, 6);
    expect(cp.b.y).toBeCloseTo(0.2, 6);
  });

  test("the trace↔trace violation marker is at the closest approach, not bbox midpoints", () => {
    // Long trace a (y=0) and short trace b near its far end (x≈9, y=0.15 gap).
    // The bbox-midpoint placement would land near x≈4.5; the true closest point
    // is near x≈9.
    const report = runDrc(
      projection({
        traces: [
          {
            id: "a",
            netId: "n1",
            netClassId: "default",
            layer: "F.Cu",
            widthMm: 0.2,
            segmentMode: "manhattan-90",
            pointsNm: [
              { x: 0, y: 0 },
              { x: 10_000_000, y: 0 },
            ],
          },
          {
            id: "b",
            netId: "n2",
            netClassId: "default",
            layer: "F.Cu",
            widthMm: 0.2,
            segmentMode: "manhattan-90",
            pointsNm: [
              { x: 9_000_000, y: 250_000 },
              { x: 10_000_000, y: 250_000 },
            ],
          },
        ],
      }),
    );
    const v = report.violations.find(
      (x) => x.code === "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(v).toBeDefined();
    expect(v?.locationMm?.x ?? 0).toBeGreaterThan(8.5);
  });
});
