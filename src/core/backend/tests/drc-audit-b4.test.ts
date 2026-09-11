/**
 * Audit regression suite B4 — board-edge / off-board / hole-to-hole
 * (DRC_AUDIT_REPORT.md §4). Post-fix expectations; flip live per milestone.
 */
import { describe, expect, spyOn, test } from "bun:test";
import * as realOutlineGeometry from "../../../shared/pcb-geometry/outline-geometry";
import { arcSegmentCount } from "../../../modules/designer/backend/pcb/outline-geometry";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import type { PcbBoardContour, PcbBoardSettings } from "../../../sdks/designer";
import {
  board,
  codes,
  freeHole,
  freePad,
  pad,
  placement,
  projection,
  trace,
} from "./helpers/drc-fixtures";

function board100(overrides: Partial<PcbBoardSettings> = {}): PcbBoardSettings {
  return {
    ...board(),
    outline: {
      kind: "rect",
      widthMm: 100,
      heightMm: 100,
      centerMm: { x: 0, y: 0 },
    },
    ...overrides,
  };
}

describe("audit B4 — board checks", () => {
  // Fixed by the S2 geometry contract (checks/board.ts consumes the board
  // region's stadiumInsideRegion instead of point sampling).
  test("B4-1: trace crossing a narrow cutout between samples is OFF-BOARD", () => {
    const report = runDrc(
      projection({
        board: board100({
          cutouts: [
            {
              id: "c1",
              shape: {
                kind: "circle",
                widthMm: 4,
                heightMm: 4,
                centerMm: { x: 20, y: 0 },
              },
            },
          ],
        }),
        // Vertices ±40 and midpoint 0 all sit OUTSIDE the cutout at (20,0):
        // today's sampling misses the crossing and demotes it to a
        // distance-0 edge warning.
        traces: [trace("t", "n1", [[-40, 0], [40, 0]], { widthMm: 1 })],
        netNames: { n1: "SIG" },
      }),
    );
    expect(codes(report)).toContain("COPPER_OFF_BOARD");
  });

  // Fixed by the S2 geometry contract (pad off-board now tests polygonInsideRegion).
  test("B4-2: slot cutout passing through a pad interior is OFF-BOARD", () => {
    const report = runDrc(
      projection({
        board: board100({
          cutouts: [
            {
              id: "c1",
              // Thin 8×1 mm routed slot straight through the pad center:
              // no cutout vertex inside the pad, no pad vertex inside the
              // cutout — today both vertex tests miss it.
              shape: {
                kind: "roundrect",
                widthMm: 8,
                heightMm: 1,
                centerMm: { x: 0, y: 0 },
                cornerRadiusMm: 0.4,
              },
            },
          ],
        }),
        placements: [
          placement("U1", {
            pads: [pad("1", { x: 0, y: 0 }, 3, 3)],
          }),
        ],
        padNets: { "U1|1": "n1" },
        netNames: { n1: "SIG" },
      }),
    );
    expect(codes(report)).toContain("COPPER_OFF_BOARD");
  });

  // Cutout-vertex crossing case: a contour "diamond" cutout whose vertices are
  // exactly on the trace's centerline.
  test("B4-1b: trace crossing exactly through a cutout vertex is OFF-BOARD", () => {
    const cutout = {
      kind: "contour" as const,
      widthMm: 4,
      heightMm: 4,
      centerMm: { x: 20, y: 0 },
      start: { x: 18, y: 0 },
      segments: [
        { type: "line" as const, to: { x: 20, y: 2 } },
        { type: "line" as const, to: { x: 22, y: 0 } },
        { type: "line" as const, to: { x: 20, y: -2 } },
        { type: "line" as const, to: { x: 18, y: 0 } },
      ],
    };
    const report = runDrc(
      projection({
        board: board100({ cutouts: [{ id: "c1", shape: cutout }] }),
        traces: [trace("t", "n1", [[-40, 0], [40, 0]], { widthMm: 1 })],
        netNames: { n1: "SIG" },
      }),
    );
    expect(codes(report)).toContain("COPPER_OFF_BOARD");
  });

  // A concave notch in a polygon outline: the pad's edges dip into the
  // removed area even though it sits well within the outline's bounding box.
  test("B4-2b: pad spanning a concave notch is OFF-BOARD", () => {
    const outline = {
      kind: "polygon" as const,
      widthMm: 100,
      heightMm: 100,
      centerMm: { x: 0, y: 0 },
      // 100×100 square with a 10-wide × 20-deep notch cut into the top edge.
      pointsMm: [
        { x: -50, y: -50 },
        { x: 50, y: -50 },
        { x: 50, y: 50 },
        { x: 5, y: 50 },
        { x: 5, y: 30 },
        { x: -5, y: 30 },
        { x: -5, y: 50 },
        { x: -50, y: 50 },
      ],
    };
    const report = runDrc(
      projection({
        board: { ...board(), outline },
        placements: [
          placement("U1", { pads: [pad("1", { x: 0, y: 45 }, 14, 2)] }),
        ],
        padNets: { "U1|1": "n1" },
        netNames: { n1: "SIG" },
      }),
    );
    expect(codes(report)).toContain("COPPER_OFF_BOARD");
  });

  // Astra finding 2: a pad exactly filling a cutout shares every edge with it,
  // so no cutout vertex sits strictly inside the pad ring — the vertex-only
  // test used to miss this entirely.
  test("B4-2c: pad exactly filling a cutout is OFF-BOARD", () => {
    const cutout = {
      kind: "contour" as const,
      widthMm: 4,
      heightMm: 4,
      centerMm: { x: 20, y: 0 },
      start: { x: 18, y: -2 },
      segments: [
        { type: "line" as const, to: { x: 22, y: -2 } },
        { type: "line" as const, to: { x: 22, y: 2 } },
        { type: "line" as const, to: { x: 18, y: 2 } },
        { type: "line" as const, to: { x: 18, y: -2 } },
      ],
    };
    const report = runDrc(
      projection({
        board: board100({ cutouts: [{ id: "c1", shape: cutout }] }),
        placements: [
          placement("U1", { pads: [pad("1", { x: 20, y: 0 }, 4, 4)] }),
        ],
        padNets: { "U1|1": "n1" },
        netNames: { n1: "SIG" },
      }),
    );
    expect(codes(report)).toContain("COPPER_OFF_BOARD");
  });

  // Fixed in P5 (same-footprint skip must not exempt overlapping drills).
  test("B4-3: overlapping drills within ONE footprint are flagged", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("U1", {
            pads: [
              pad("1", { x: 0, y: 0 }, 1.6, 1.6, { drillDiameterMm: 1.0 }),
              // 0.8 mm apart: drill edges overlap by 0.2 mm — a broken drill
              // file regardless of footprint membership.
              pad("2", { x: 0.8, y: 0 }, 1.6, 1.6, { drillDiameterMm: 1.0 }),
            ],
          }),
        ],
      }),
    );
    expect(codes(report)).toContain("HOLE_TO_HOLE");
  });

  // Fixed in P5b (new HOLE_TO_BOARD_EDGE check; audit's silent-failure repro).
  test("B4-4: NPTH hole crossing the board edge is flagged", () => {
    const report = runDrc(
      projection({
        board: board100(),
        // Drill edge reaches x = 50.7 — physically crossing the x = 50 edge.
        // Today: zero violations.
        freeHoles: [freeHole("h1", { x: 49.2, y: 0 }, 3)],
      }),
    );
    // The breach half of the code is HOLE_OFF_BOARD after S6 §7.
    expect(codes(report).map(String)).toContain("HOLE_OFF_BOARD");
  });

  // Fixed in P5b (checks/outline.ts resurrects BOARD_OUTLINE_INVALID).
  test("B4-5: self-intersecting outline emits BOARD_OUTLINE_INVALID", () => {
    const report = runDrc(
      projection({
        board: {
          ...board(),
          outline: {
            kind: "polygon",
            widthMm: 10,
            heightMm: 10,
            centerMm: { x: 5, y: 5 },
            // Bow-tie: edges (0,0)-(10,10) and (10,0)-(0,10) cross.
            pointsMm: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
              { x: 10, y: 0 },
              { x: 0, y: 10 },
            ],
          },
        },
      }),
    );
    expect(codes(report)).toContain("BOARD_OUTLINE_INVALID");
  });

  // Fixed by the S2 geometry contract §3 (circumscribed step rule for cutout
  // arcs, one chord tolerance for every consumer).
  test("B4-6: circular cutout polygonization does not under-measure", () => {
    // Inscribed-polygon flattening shrinks the hole by up to ~0.024 mm at
    // r = 20 (false-pass direction for copper-to-cutout-edge). Post-fix:
    // circumscribed (or tolerance-compensated) sampling for cutouts.
    // Fixture: copper at exactly edge-clearance from the TRUE circle must
    // flag. Written against the P4 edge-tree implementation.
    //
    // Deviation from the brief: a trace running the WHOLE way around the
    // cutout does NOT reproduce the bug — polylineToRingEdgeDistance takes
    // the true minimum over every trace-segment/ring-segment pair, and that
    // minimum lands near a cutout-ring VERTEX (where the inscribed polygon
    // touches the true circle exactly), correctly catching the violation
    // regardless of the mid-chord error elsewhere. Confirmed via scratch
    // probe: a 90-point loop at this same true gap is (correctly) flagged
    // today. The under-measurement only surfaces when the copper is a SHORT
    // segment confined to a single mid-chord region, with no ring vertex
    // nearby to pull the sampled minimum back down to the true gap.
    const radiusMm = 20;
    const edgeReqMm = 0.5; // board().designRules.clearance.copperToBoardEdgeMm
    const trueGapMm = edgeReqMm - 0.01; // 0.49 — a real violation
    const halfWidthMm = 0.1; // trace width 0.2 / 2
    const centerlineR = radiusMm + trueGapMm + halfWidthMm;
    // The S2 contract replaced the old fixed 64-gon with the per-arc step
    // rule (§3); recompute so the fixture still lands mid-chord.
    const arcSegments = arcSegmentCount(radiusMm, 2 * Math.PI, "circumscribed");
    const midAngle = Math.PI / arcSegments; // half of one step
    const halfLenMm = 0.3;
    const cx = Math.cos(midAngle) * centerlineR;
    const cy = Math.sin(midAngle) * centerlineR;
    const tx = -Math.sin(midAngle);
    const ty = Math.cos(midAngle);
    const p1: [number, number] = [cx - tx * halfLenMm, cy - ty * halfLenMm];
    const p2: [number, number] = [cx + tx * halfLenMm, cy + ty * halfLenMm];

    const report = runDrc(
      projection({
        board: board100({
          cutouts: [
            {
              id: "c1",
              shape: {
                kind: "circle",
                widthMm: radiusMm * 2,
                heightMm: radiusMm * 2,
                centerMm: { x: 0, y: 0 },
              },
            },
          ],
        }),
        traces: [trace("t", "n1", [p1, p2], { widthMm: halfWidthMm * 2 })],
        netNames: { n1: "SIG" },
      }),
    );
    expect(codes(report)).toContain("COPPER_TO_BOARD_EDGE");
  });

  // Same under-measurement risk at a roundrect corner, not just a full circle.
  test("B4-6b: roundrect cutout mid-corner does not under-measure", () => {
    const cornerRadiusMm = 3;
    const hw = 5; // half of the 10 mm roundrect
    const cornerCenter = { x: hw - cornerRadiusMm, y: hw - cornerRadiusMm }; // (2,2)
    const edgeReqMm = 0.5;
    const trueGapMm = edgeReqMm - 0.01; // 0.49
    const halfWidthMm = 0.1; // trace width 0.2 / 2
    const centerlineR = cornerRadiusMm + trueGapMm + halfWidthMm;
    const steps = arcSegmentCount(
      cornerRadiusMm,
      Math.PI / 2,
      "circumscribed",
    );
    const stepAngle = Math.PI / 2 / steps;
    // Corner sweeps from angle 0 to π/2 around cornerCenter; offset the
    // nominal mid-sweep angle by half a step to land mid-chord.
    const midAngle = Math.PI / 4 + stepAngle / 2;
    const halfLenMm = 0.3;
    const cx = cornerCenter.x + Math.cos(midAngle) * centerlineR;
    const cy = cornerCenter.y + Math.sin(midAngle) * centerlineR;
    const tx = -Math.sin(midAngle);
    const ty = Math.cos(midAngle);
    const p1: [number, number] = [cx - tx * halfLenMm, cy - ty * halfLenMm];
    const p2: [number, number] = [cx + tx * halfLenMm, cy + ty * halfLenMm];

    const report = runDrc(
      projection({
        board: board100({
          cutouts: [
            {
              id: "c1",
              shape: {
                kind: "roundrect",
                widthMm: 10,
                heightMm: 10,
                centerMm: { x: 0, y: 0 },
                cornerRadiusMm,
              },
            },
          ],
        }),
        traces: [trace("t", "n1", [p1, p2], { widthMm: halfWidthMm * 2 })],
        netNames: { n1: "SIG" },
      }),
    );
    expect(codes(report)).toContain("COPPER_TO_BOARD_EDGE");
  });

  // S12b §4 — the certified interval. The chord region `R_inner` and its mirror
  // superset `R_outer` bracket the truth, and only a verdict they disagree about
  // is recomputed exactly. Copper tangent to a curved edge inside that band was
  // reported by up to the chord deviation before S12b (02 §6).
  test("B4-9: copper in the chord band against a curved edge is not reported", () => {
    const r = 20;
    const outline: PcbBoardSettings["outline"] = {
      kind: "contour",
      widthMm: 100,
      heightMm: 100,
      centerMm: { x: 0, y: 0 },
      start: { x: -50, y: -50 },
      segments: [
        { type: "line", to: { x: 50, y: -50 } },
        { type: "line", to: { x: 50, y: 50 - r } },
        {
          type: "arc",
          to: { x: 50 - r, y: 50 },
          centerMm: { x: 50 - r, y: 50 - r },
          cw: false,
        },
        { type: "line", to: { x: -50, y: 50 } },
        { type: "line", to: { x: -50, y: -50 } },
      ],
    };
    const centre = { x: 50 - r, y: 50 - r };
    /** A via whose TRUE clearance to the fillet arc is `clearanceMm`. */
    const bandVia = (clearanceMm: number) => {
      const d = r - clearanceMm - 0.4;
      return {
        id: "v",
        netId: null,
        netClassId: "default",
        centerMm: {
          x: centre.x + d * Math.SQRT1_2,
          y: centre.y + d * Math.SQRT1_2,
        },
        diameterMm: 0.8,
        drillMm: 0.4,
        fromLayer: "F.Cu" as const,
        toLayer: "B.Cu" as const,
        viaType: "through" as const,
        protection: "tented" as const,
        provenance: "route" as const,
      };
    };
    const base = board();
    const settings: PcbBoardSettings = {
      ...base,
      outline,
      designRules: {
        ...base.designRules,
        clearance: { ...base.designRules.clearance, copperToBoardEdgeMm: 0.2 },
      },
    };
    // 0.205 mm true clearance: the chords read 0.1952 and used to fail it.
    const inBand = runDrc(
      projection({ board: settings, vias: [bandVia(0.205)] }),
    );
    expect(codes(inBand)).not.toContain("COPPER_TO_BOARD_EDGE");
    // Outside the band on either side the verdict is certified and unchanged.
    expect(
      codes(runDrc(projection({ board: settings, vias: [bandVia(0.1)] }))),
    ).toContain("COPPER_TO_BOARD_EDGE");
    expect(
      codes(runDrc(projection({ board: settings, vias: [bandVia(0.5)] }))),
    ).not.toContain("COPPER_TO_BOARD_EDGE");
  });

  // S12b §4 — a FALLBACK ring: a biased flattening that still self-crosses at
  // the refinement cap, so `buildRings` falls back to the UNBIASED ring for both
  // ends of the interval. The two regions then coincide and cannot bracket
  // anything, so the ring's own `boundMm` applies symmetrically and containment
  // within it is UNKNOWN (Astra run 1 #13).
  const lobeArc = (
    to: { x: number; y: number },
    centerMm: { x: number; y: number },
  ) => ({ type: "arc" as const, to, centerMm, cw: false });
  /** Two 100 mm lobes meeting at a 1 µm pinch — `fallbacks = [0]`. */
  const twoLobes: PcbBoardSettings["outline"] = {
    kind: "contour",
    widthMm: 400,
    heightMm: 200,
    centerMm: { x: 0, y: 0 },
    start: { x: -200, y: 0 },
    segments: [
      lobeArc({ x: -0.0005, y: 0 }, { x: -100, y: 0 }),
      lobeArc({ x: 200, y: 0 }, { x: 100, y: 0 }),
      lobeArc({ x: 0.0005, y: 0 }, { x: 100, y: 0 }),
      lobeArc({ x: -200, y: 0 }, { x: -100, y: 0 }),
    ],
  };
  /** A via whose TRUE clearance to the left lobe's rim is `clearanceMm`. */
  const lobeVia = (id: string, clearanceMm: number, angleRad: number) => {
    const d = 100 - clearanceMm - 0.4;
    return {
      id,
      netId: null,
      netClassId: "default",
      centerMm: {
        x: -100 + d * Math.cos(angleRad),
        y: d * Math.sin(angleRad),
      },
      diameterMm: 0.8,
      drillMm: 0.2,
      fromLayer: "F.Cu" as const,
      toLayer: "B.Cu" as const,
      viaType: "through" as const,
      protection: "tented" as const,
      provenance: "route" as const,
    };
  };

  test("B4-10: on a FALLBACK ring, containment inside the bound is UNKNOWN", () => {
    const base = board();
    const settings: PcbBoardSettings = {
      ...base,
      outline: twoLobes,
      designRules: {
        ...base.designRules,
        clearance: { ...base.designRules.clearance, copperToBoardEdgeMm: 0.5 },
      },
    };
    // `inBand` sits in the CHORD SEGMENT the flattening omits: the chord region
    // reads it 0.000126 mm OUTSIDE the board, the exact contour 0.0002 mm
    // inside. Astra run 1 #13 — it must NOT be off-board.
    // `justUnder` is 0.4998 mm from the rim against a 0.5 mm rule: neither end
    // of the interval settles it, and the EXACT answer fails it.
    // `clear` is 0.6 mm out: certified, and unchanged from S12.
    const report = runDrc(
      projection({
        board: settings,
        vias: [
          lobeVia("inBand", 2e-4, (40 * Math.PI) / 180),
          lobeVia("justUnder", 0.4998, (140 * Math.PI) / 180),
          lobeVia("clear", 0.6, (220 * Math.PI) / 180),
        ],
      }),
    );
    const named = (id: string, code: string) =>
      report.violations.some(
        (v) =>
          v.code === code &&
          v.anchors.some((a) => (a as { viaId?: string }).viaId === id),
      );
    expect(named("inBand", "COPPER_OFF_BOARD")).toBe(false);
    expect(named("justUnder", "COPPER_TO_BOARD_EDGE")).toBe(true);
    expect(named("justUnder", "COPPER_OFF_BOARD")).toBe(false);
    expect(named("clear", "COPPER_TO_BOARD_EDGE")).toBe(false);
    // The two enumerations cannot classify the interval differently.
    const p = projection({
      board: settings,
      vias: [
        lobeVia("inBand", 2e-4, (40 * Math.PI) / 180),
        lobeVia("justUnder", 0.4998, (140 * Math.PI) / 180),
        lobeVia("clear", 0.6, (220 * Math.PI) / 180),
      ],
    });
    expect(JSON.stringify(runDrc(p, { broadPhase: "exhaustive" }))).toBe(
      JSON.stringify(runDrc(p)),
    );
  });

  test("B4-11: an exhausted exact budget reports ONE note, never a silent pass", () => {
    // A 1204-primitive comb: every tooth spans the full width, so the
    // simplicity sweep's active list never shortens and the per-run comparison
    // budget runs out. The board is VALID — the note says so and no
    // `BOARD_OUTLINE_INVALID` is invented — and both modes agree byte for byte.
    const teeth = 600;
    const w = 100;
    const segs: PcbBoardContour["segments"] = [];
    let y = 0;
    for (let i = 0; i < teeth; i += 1) {
      const x = i % 2 === 0 ? w : -w;
      segs.push({ type: "line", to: { x, y } });
      y += 0.2;
      segs.push({ type: "line", to: { x, y } });
    }
    segs.push({ type: "line", to: { x: -w - 5, y } });
    segs.push({ type: "line", to: { x: -w - 5, y: -5 } });
    segs.push({ type: "line", to: { x: -w, y: -5 } });
    segs.push({ type: "line", to: { x: -w, y: 0 } });
    const settings: PcbBoardSettings = {
      ...board(),
      outline: {
        kind: "contour",
        widthMm: 2 * w + 10,
        heightMm: y + 10,
        centerMm: { x: 0, y: y / 2 },
        start: { x: -w, y: 0 },
        segments: segs,
      },
    };
    const p = projection({ board: settings });
    const report = runDrc(p);
    expect(
      report.violations.filter((v) => v.code === "OUTLINE_WEB_UNCHECKED"),
    ).toHaveLength(1);
    expect(codes(report)).not.toContain("BOARD_OUTLINE_INVALID");
    expect(JSON.stringify(runDrc(p, { broadPhase: "exhaustive" }))).toBe(
      JSON.stringify(report),
    );
  });

  test("B4-12: the exact budget is PER ITEM, so input order cannot move a verdict", () => {
    // Astra run 2 #B: a SHARED allowance is spent in input order, so reversing
    // the pad array changed which items kept a chord verdict — 52 ids moved on
    // Astra's 2000-segment / 200-pad board. An upper semicircle r = 20 whose
    // bottom edge is split into 1400 segments, with 250 Ø0.2 pads at ~0.501 mm
    // true clearance against a 0.5 mm rule: every one of them is ambiguous, and
    // every one must be judged alone. Sized by re-running this fixture against
    // the pre-fix shared budget until the id multisets diverged — smaller
    // boards do not reproduce, and larger ones only cost more.
    const segments: PcbBoardContour["segments"] = [
      { type: "arc", to: { x: -20, y: 0 }, centerMm: { x: 0, y: 0 }, cw: false },
      { type: "line", to: { x: -20, y: -20 } },
    ];
    const N = 1400;
    for (let i = 1; i <= N; i += 1) {
      segments.push({ type: "line", to: { x: -20 + (40 * i) / N, y: -20 } });
    }
    segments.push({ type: "line", to: { x: 20, y: 0 } });
    const base = board();
    const settings: PcbBoardSettings = {
      ...base,
      outline: {
        kind: "contour",
        widthMm: 40,
        heightMm: 40,
        centerMm: { x: 0, y: -10 },
        start: { x: 20, y: 0 },
        segments,
      },
      designRules: {
        ...base.designRules,
        clearance: { ...base.designRules.clearance, copperToBoardEdgeMm: 0.5 },
      },
    };
    const nm = (v: number) => Math.round(v * 1e6) / 1e6;
    const pads = Array.from({ length: 250 }, (_, i) => {
      const th = 0.2 + (2.7 * i) / 249;
      return freePad(`p${i}`, {
        center: { x: nm(19.399 * Math.cos(th)), y: nm(19.399 * Math.sin(th)) },
        widthMm: 0.2,
        heightMm: 0.2,
        shape: "circle",
      });
    });
    const ids = (fp: typeof pads) =>
      runDrc(projection({ board: settings, freePads: fp }))
        .violations.map((v) => v.id)
        .sort();
    // Two runs only: mode parity on an ambiguous board is B4-10's job, and a
    // third pass over 1400 primitives is three seconds nobody needs.
    expect(ids([...pads].reverse())).toEqual(ids(pads));
    // Two full runs over a 1400-primitive outline: past the 5 s default.
  }, 30_000);

  test("B4-13: a ring that falls back on ONE side only still widens the interval", () => {
    // Astra run 2 #C: the OUTER-biased build fell back on a cutout the inner
    // build did not, so its non-enclosing ring certified a FAIL the exact
    // contour passes (0.5004998 mm reported as 0.4928206 against a 0.5 rule).
    const slot: PcbBoardContour = {
      kind: "contour",
      widthMm: 400,
      heightMm: 200,
      centerMm: { x: 0, y: 100 },
      start: { x: 200, y: 0 },
      segments: [
        { type: "arc", to: { x: -200, y: 0 }, centerMm: { x: 0, y: 0 }, cw: false },
        { type: "line", to: { x: -199.9985, y: 0 } },
        { type: "arc", to: { x: 199.9985, y: 0 }, centerMm: { x: 0, y: 0 }, cw: true },
        { type: "line", to: { x: 200, y: 0 } },
      ],
    };
    const base = board();
    const settings: PcbBoardSettings = {
      ...base,
      outline: { kind: "rect", widthMm: 500, heightMm: 500, centerMm: { x: 0, y: 0 } },
      cutouts: [{ id: "slot", shape: slot }],
      designRules: {
        ...base.designRules,
        clearance: { ...base.designRules.clearance, copperToBoardEdgeMm: 0.5 },
      },
    };
    const p = projection({
      board: settings,
      freePads: [
        freePad("pc", {
          center: { x: 199.095271, y: 1.04247 },
          widthMm: 0.8,
          heightMm: 0.8,
          shape: "circle",
        }),
      ],
    });
    // The exact clearance is 0.5004998 mm: above the rule, so no verdict.
    expect(codes(runDrc(p))).not.toContain("COPPER_TO_BOARD_EDGE");
    expect(JSON.stringify(runDrc(p, { broadPhase: "exhaustive" }))).toBe(
      JSON.stringify(runDrc(p)),
    );
  });

  test("B4-8: full-radius roundrect outline and cutout are valid", () => {
    const outlineReport = runDrc(
      projection({
        board: {
          ...board(),
          outline: {
            kind: "roundrect",
            widthMm: 60,
            heightMm: 40,
            centerMm: { x: 0, y: 0 },
            cornerRadiusMm: 20,
          },
        },
      }),
    );
    expect(codes(outlineReport)).not.toContain("BOARD_OUTLINE_INVALID");

    const cutoutReport = runDrc(
      projection({
        board: board100({
          cutouts: [
            {
              id: "c1",
              shape: {
                kind: "roundrect",
                widthMm: 10,
                heightMm: 4,
                centerMm: { x: 0, y: 0 },
                cornerRadiusMm: 2,
              },
            },
          ],
        }),
      }),
    );
    expect(codes(cutoutReport)).not.toContain("BOARD_OUTLINE_INVALID");
  });

  test("L-board: slot spanning the notch with every vertex on-board is invalid", () => {
    // L outline: 100×100 square minus its top-right quadrant, re-entrant
    // corner at the origin.
    const outline = {
      kind: "polygon" as const,
      widthMm: 100,
      heightMm: 100,
      centerMm: { x: 0, y: 0 },
      pointsMm: [
        { x: -50, y: -50 },
        { x: 50, y: -50 },
        { x: 50, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: -50, y: 50 },
      ],
    };
    // A thin rectangle rotated 45°, offset so all four corners land outside
    // the forbidden (x>0 && y>0) quadrant, but its far edge's midpoint —
    // (0.1, 0.1) — sits inside it. Verified via scratch probe
    // (scratchpad/s2/wp3/probe2.ts "L-board notch"): every vertex individually
    // passes a naive per-vertex containment test, but the edge crosses the
    // outline's re-entrant corner, so only ringStrictlyInside's edge-contact
    // clause (not its vertex clause) catches it.
    const cutout = {
      kind: "contour" as const,
      widthMm: 4,
      heightMm: 4,
      centerMm: { x: -0.3, y: -0.3 },
      start: { x: 1.51421356, y: -1.31421356 },
      segments: [
        { type: "line" as const, to: { x: 0.71421356, y: -2.11421356 } },
        { type: "line" as const, to: { x: -2.11421356, y: 0.71421356 } },
        { type: "line" as const, to: { x: -1.31421356, y: 1.51421356 } },
        { type: "line" as const, to: { x: 1.51421356, y: -1.31421356 } },
      ],
    };
    const report = runDrc(
      projection({
        board: { ...board(), outline, cutouts: [{ id: "c1", shape: cutout }] },
      }),
    );
    expect(codes(report)).toContain("BOARD_OUTLINE_INVALID");
  });

  test("crossing thin cutouts are invalid", () => {
    const report = runDrc(
      projection({
        board: board100({
          cutouts: [
            {
              id: "a",
              shape: {
                kind: "roundrect",
                widthMm: 20,
                heightMm: 0.5,
                centerMm: { x: 0, y: 0 },
                cornerRadiusMm: 0.2,
              },
            },
            {
              id: "b",
              shape: {
                kind: "roundrect",
                widthMm: 0.5,
                heightMm: 20,
                centerMm: { x: 0, y: 0 },
                cornerRadiusMm: 0.2,
              },
            },
          ],
        }),
      }),
    );
    expect(codes(report)).toContain("BOARD_OUTLINE_INVALID");
  });

  test("rectangular cutouts sharing an edge are invalid", () => {
    const c1 = {
      kind: "contour" as const,
      widthMm: 2,
      heightMm: 1,
      centerMm: { x: 1, y: 0.5 },
      start: { x: 0, y: 0 },
      segments: [
        { type: "line" as const, to: { x: 2, y: 0 } },
        { type: "line" as const, to: { x: 2, y: 1 } },
        { type: "line" as const, to: { x: 0, y: 1 } },
        { type: "line" as const, to: { x: 0, y: 0 } },
      ],
    };
    const c2 = {
      kind: "contour" as const,
      widthMm: 2,
      heightMm: 1,
      centerMm: { x: 2, y: 0.5 },
      start: { x: 1, y: 0 },
      segments: [
        { type: "line" as const, to: { x: 3, y: 0 } },
        { type: "line" as const, to: { x: 3, y: 1 } },
        { type: "line" as const, to: { x: 1, y: 1 } },
        { type: "line" as const, to: { x: 1, y: 0 } },
      ],
    };
    const report = runDrc(
      projection({
        board: board100({
          cutouts: [
            { id: "a", shape: c1 },
            { id: "b", shape: c2 },
          ],
        }),
      }),
    );
    expect(codes(report)).toContain("BOARD_OUTLINE_INVALID");

    const s1 = {
      kind: "roundrect" as const,
      widthMm: 2,
      heightMm: 2,
      centerMm: { x: 1, y: 1 },
      cornerRadiusMm: 0,
    };
    const s2 = {
      kind: "roundrect" as const,
      widthMm: 2,
      heightMm: 2,
      centerMm: { x: 3, y: 1 },
      cornerRadiusMm: 0,
    };
    const squaresReport = runDrc(
      projection({
        board: board100({
          cutouts: [
            { id: "a", shape: s1 },
            { id: "b", shape: s2 },
          ],
        }),
      }),
    );
    expect(codes(squaresReport)).toContain("BOARD_OUTLINE_INVALID");
  });

  test("tangent circular cutouts are invalid", () => {
    const report = runDrc(
      projection({
        board: board100({
          cutouts: [
            {
              id: "a",
              shape: {
                kind: "circle",
                widthMm: 10,
                heightMm: 10,
                centerMm: { x: -5, y: 0 },
              },
            },
            {
              id: "b",
              shape: {
                kind: "circle",
                widthMm: 10,
                heightMm: 10,
                centerMm: { x: 5, y: 0 },
              },
            },
          ],
        }),
      }),
    );
    expect(codes(report)).toContain("BOARD_OUTLINE_INVALID");
  });

  test("cutout tangent to the board edge is invalid", () => {
    const tangentReport = runDrc(
      projection({
        board: board100({
          cutouts: [
            {
              id: "a",
              shape: {
                kind: "circle",
                widthMm: 10,
                heightMm: 10,
                centerMm: { x: 45, y: 0 },
              },
            },
          ],
        }),
      }),
    );
    expect(codes(tangentReport)).toContain("BOARD_OUTLINE_INVALID");

    const clearReport = runDrc(
      projection({
        board: board100({
          cutouts: [
            {
              id: "a",
              shape: {
                kind: "circle",
                widthMm: 10,
                heightMm: 10,
                centerMm: { x: 44, y: 0 },
              },
            },
          ],
        }),
      }),
    );
    expect(codes(clearReport)).not.toContain("BOARD_OUTLINE_INVALID");
  });

  test("circular cutout breaching a curved board by 0.005 mm is invalid", () => {
    const outline = {
      kind: "roundrect" as const,
      widthMm: 60,
      heightMm: 40,
      centerMm: { x: 0, y: 0 },
      cornerRadiusMm: 20,
    };
    // Corner arc centre (30-20, 20-20) = (10,0), radius 20; place the cutout
    // centre on the 45° diagonal at distance (20 - 2 + 0.005) from it so its
    // true circle crosses the corner arc by 0.005 mm.
    const cornerCenter = { x: 10, y: 0 };
    const dist = 20 - 2 + 0.005;
    const cutoutCenter = {
      x: cornerCenter.x + dist * Math.cos(Math.PI / 4),
      y: cornerCenter.y + dist * Math.sin(Math.PI / 4),
    };
    const report = runDrc(
      projection({
        board: {
          ...board(),
          outline,
          cutouts: [
            {
              id: "a",
              shape: {
                kind: "circle",
                widthMm: 4,
                heightMm: 4,
                centerMm: cutoutCenter,
              },
            },
          ],
        },
      }),
    );
    expect(codes(report)).toContain("BOARD_OUTLINE_INVALID");
  });

  test("slot hole whose end enters a cutout with centre on-board is an error", () => {
    const report = runDrc(
      projection({
        board: board100({
          cutouts: [
            {
              id: "a",
              shape: {
                kind: "circle",
                widthMm: 4,
                heightMm: 4,
                centerMm: { x: 20, y: 0 },
              },
            },
          ],
        }),
        freeHoles: [
          {
            id: "s",
            centerMm: { x: 16, y: 0 },
            drillMm: 1,
            drillSlot: { lengthMm: 6, widthMm: 1, angleDeg: 0 },
            lockedAt: null,
          },
        ],
      }),
    );
    const v = report.violations.find((x) => x.code === "HOLE_OFF_BOARD");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
  });

  test("copper exactly tangent to the edge is on-board", () => {
    const report = runDrc(
      projection({
        traces: [
          trace("t", "n1", [[-20, 14.9], [20, 14.9]], { widthMm: 0.2 }),
        ],
        netNames: { n1: "SIG" },
      }),
    );
    expect(codes(report)).toContain("COPPER_TO_BOARD_EDGE");
    expect(codes(report)).not.toContain("COPPER_OFF_BOARD");
  });

  // Fixed by the S2 geometry contract (board region built once per context;
  // containment goes through it instead of re-flattening per sampled point).
  test("B4-7: board-region containment reuses the precomputed rings, independent of trace count", () => {
    const polygonPointsMm = Array.from({ length: 20 }, (_, i) => {
      const a = (i / 20) * Math.PI * 2;
      return { x: Math.cos(a) * 10, y: Math.sin(a) * 10 };
    });
    const b: PcbBoardSettings = {
      ...board(),
      outline: {
        kind: "polygon",
        widthMm: 20,
        heightMm: 20,
        centerMm: { x: 0, y: 0 },
        pointsMm: polygonPointsMm,
      },
    };
    const makeTraces = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        trace(`t${i}`, "n1", [
          [i * 0.01, 0],
          [i * 0.01 + 0.005, 0],
        ]),
      );
    // Spy on the REAL kernel module (not the pcb/ shim): buildBoardRegion
    // calls flattenOutline directly from ./outline-geometry within
    // src/shared/pcb-geometry/, so the shim's re-exported binding is never
    // the one invoked.
    const spy = spyOn(realOutlineGeometry, "flattenOutline");
    try {
      runDrc(
        projection({ board: b, traces: makeTraces(50), netNames: { n1: "SIG" } }),
      );
      const count50 = spy.mock.calls.length;
      spy.mockClear();
      runDrc(
        projection({ board: b, traces: makeTraces(500), netNames: { n1: "SIG" } }),
      );
      const count500 = spy.mock.calls.length;
      // Observed: 2 calls (one unbiased "none" flatten, one biased
      // "board-inner" flatten) for the single outline ring, plus the S12b
      // MIRROR region the certified interval needs (exact-geometry contract 12
      // §4: "one extra region + index per runDrc") — all of them per RUN,
      // independent of trace count, which is what this test exists to pin. The
      // old per-sampled-point pointInOutline() re-flatten is gone.
      expect(count500).toBe(count50);
      expect(count50).toBeLessThanOrEqual(6);
    } finally {
      spy.mockRestore();
    }
  });

  // Astra §9.2: with edge clearance measured on the UNBIASED (inscribed)
  // cutout chords, a true 0.4949999 mm gap read 0.5049 mm and passed the
  // 0.5 mm rule at a chord midpoint. Clearance now measures the biased ring.
  test("B4-6c: copper-to-cutout clearance is not over-measured at a chord midpoint", () => {
    const radiusMm = 20;
    const trueGapMm = 0.494999902;
    const halfWidthMm = 0.1;
    const centerlineR = radiusMm + trueGapMm + halfWidthMm;
    const n = arcSegmentCount(radiusMm, Math.PI * 2, "inscribed");
    const midAngle = Math.PI / n;
    const halfLenMm = 0.3;
    const cx = Math.cos(midAngle) * centerlineR;
    const cy = Math.sin(midAngle) * centerlineR;
    const tx = -Math.sin(midAngle);
    const ty = Math.cos(midAngle);
    const report = runDrc(
      projection({
        board: board100({
          cutouts: [
            {
              id: "c1",
              shape: {
                kind: "circle",
                widthMm: radiusMm * 2,
                heightMm: radiusMm * 2,
                centerMm: { x: 0, y: 0 },
              },
            },
          ],
        }),
        traces: [
          trace(
            "t",
            "n1",
            [
              [cx - tx * halfLenMm, cy - ty * halfLenMm],
              [cx + tx * halfLenMm, cy + ty * halfLenMm],
            ],
            { widthMm: halfWidthMm * 2 },
          ),
        ],
        netNames: { n1: "SIG" },
      }),
    );
    expect(codes(report)).toContain("COPPER_TO_BOARD_EDGE");
    expect(codes(report)).not.toContain("COPPER_OFF_BOARD");
  });

  // Astra §9.2: the pairwise cutout loop used to stop at the first partner, so
  // authoring order changed how many BOARD_OUTLINE_INVALID drafts appeared.
  test("cutout authoring order does not change the outline verdict multiset", () => {
    const box = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
      id,
      shape: {
        kind: "contour" as const,
        widthMm: x1 - x0,
        heightMm: y1 - y0,
        centerMm: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
        start: { x: x0, y: y0 },
        segments: [
          { type: "line" as const, to: { x: x1, y: y0 } },
          { type: "line" as const, to: { x: x1, y: y1 } },
          { type: "line" as const, to: { x: x0, y: y1 } },
          { type: "line" as const, to: { x: x0, y: y0 } },
        ],
      },
    });
    const A = box("A", -3, -1, 3, 1);
    const B = box("B", -2, -2, -1, 2);
    const C = box("C", 1, -2, 2, 2);
    const run = (cutouts: PcbBoardSettings["cutouts"]) =>
      runDrc(projection({ board: board100({ cutouts }) }))
        .violations.filter((v) => v.code === "BOARD_OUTLINE_INVALID")
        .map((v) => v.id)
        .sort();
    const abc = run([A, B, C]);
    const bca = run([B, C, A]);
    expect(abc.length).toBe(2);
    expect(bca).toEqual(abc);
  });

  // Astra §9.2 run 2, #1: a sliver-thin OUTER contour whose shallow arc
  // flattens to one chord became a simple triangle on the wrong side of the
  // board; copper 0.001 mm outside the true board passed. Look-ahead
  // refinement (coarse ⊆ fine for an inward ring) now catches it.
  test("sliver outer contour: copper outside the true board is OFF-BOARD", () => {
    const sagitta = 0.005;
    // 2 mm chord: r = (h² + s²) / 2s with half-chord h = 1.
    const r = (1 + sagitta * sagitta) / (2 * sagitta);
    const outline: PcbBoardSettings["outline"] = {
      kind: "contour",
      widthMm: 2,
      heightMm: sagitta,
      centerMm: { x: 1, y: 0.0025 },
      start: { x: 0, y: 0 },
      segments: [
        { type: "arc", to: { x: 2, y: 0 }, centerMm: { x: 1, y: sagitta - r }, cw: true },
        { type: "line", to: { x: 1, y: 0.002 } },
        { type: "line", to: { x: 0, y: 0 } },
      ],
    };
    const report = runDrc(
      projection({
        board: { ...board(), outline },
        placements: [
          placement("P", {
            positionMm: { x: 1, y: 0.001 },
            pads: [pad("1", { x: 0, y: 0 }, 0.2, 0.0004)],
          }),
        ],
        padNets: { "P|1": "n1" },
        netNames: { n1: "SIG" },
      }),
    );
    expect(codes(report)).toContain("COPPER_OFF_BOARD");
    expect(codes(report)).not.toContain("BOARD_OUTLINE_INVALID");
  });

  // Astra §9.2 run 2, #2: two lines cross the TRUE arc but miss its coarse
  // chords, so both flattened rings were simple and validity said nothing.
  test("a contour whose lines cross its true arc is invalid", () => {
    const outline: PcbBoardSettings["outline"] = {
      kind: "contour",
      widthMm: 3,
      heightMm: 3,
      centerMm: { x: 1, y: -0.5 },
      start: { x: 1, y: 0 },
      segments: [
        { type: "arc", to: { x: 0, y: 1 }, centerMm: { x: 0, y: 0 }, cw: false },
        { type: "line", to: { x: 2, y: -2 } },
        { type: "line", to: { x: 1.1, y: 0.2 } },
        { type: "line", to: { x: 0.99, y: 0.1 } },
        { type: "line", to: { x: 1.1, y: 0.05 } },
        { type: "line", to: { x: 1, y: 0 } },
      ],
    };
    const report = runDrc(projection({ board: { ...board(), outline } }));
    expect(codes(report)).toContain("BOARD_OUTLINE_INVALID");
  });

  // Astra §9.2 run 2, #4: a single-point trace skipped both board checks.
  test("a single-point trace outside the board is OFF-BOARD", () => {
    const report = runDrc(
      projection({
        board: board100(),
        traces: [trace("t", "n1", [[60, 0]], { widthMm: 0.2 })],
        netNames: { n1: "SIG" },
      }),
    );
    expect(codes(report)).toContain("COPPER_OFF_BOARD");
  });

  // Astra §9.2 run 2, #5: a zero-area cutout's early return skipped its pair
  // comparisons, so [D, B] and [B, D] reported different counts.
  test("a degenerate cutout does not make the verdict order-dependent", () => {
    const D = {
      id: "D",
      shape: {
        kind: "contour" as const,
        widthMm: 2,
        heightMm: 0,
        centerMm: { x: 1, y: 0 },
        start: { x: 0, y: 0 },
        segments: [
          { type: "line" as const, to: { x: 1, y: 0 } },
          { type: "line" as const, to: { x: 2, y: 0 } },
          { type: "line" as const, to: { x: 0, y: 0 } },
        ],
      },
    };
    const B = {
      id: "B",
      shape: {
        kind: "contour" as const,
        widthMm: 4,
        heightMm: 2,
        centerMm: { x: 1, y: 0 },
        start: { x: -1, y: -1 },
        segments: [
          { type: "line" as const, to: { x: 3, y: -1 } },
          { type: "line" as const, to: { x: 3, y: 1 } },
          { type: "line" as const, to: { x: -1, y: 1 } },
          { type: "line" as const, to: { x: -1, y: -1 } },
        ],
      },
    };
    const run = (cutouts: PcbBoardSettings["cutouts"]) =>
      runDrc(projection({ board: board100({ cutouts }) }))
        .violations.filter((v) => v.code === "BOARD_OUTLINE_INVALID")
        .map((v) => v.id)
        .sort();
    expect(run([D, B])).toEqual(run([B, D]));
  });

  // Astra §9.2 run 2, #7: a NaN vertex made every comparison false and the
  // outline read as valid.
  test("a non-finite outline vertex is invalid", () => {
    const outline: PcbBoardSettings["outline"] = {
      kind: "polygon",
      widthMm: 10,
      heightMm: 10,
      centerMm: { x: 5, y: 5 },
      pointsMm: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: Number.NaN, y: 5 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    const report = runDrc(projection({ board: { ...board(), outline } }));
    expect(codes(report)).toContain("BOARD_OUTLINE_INVALID");
  });
});
