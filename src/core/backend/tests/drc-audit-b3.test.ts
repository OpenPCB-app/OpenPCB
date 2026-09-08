/**
 * Audit regression suite B3 — connectivity, copper pour, net-class resolution
 * (DRC_AUDIT_REPORT.md §4). Post-fix expectations; flip live per milestone.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { computeRatsnest } from "../../../modules/designer/backend/pcb/ratsnest";
import { boardZoneRow } from "./helpers/pcb-zone-fixtures";
import type {
  PcbFreePad,
  PcbNetClass,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  RatsnestSegment,
} from "../../../sdks/designer";
import {
  board,
  codes,
  freePad,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

const NET_CLASSES: PcbNetClass[] = [
  {
    id: "default",
    name: "Default",
    traceWidthMm: 0.25,
    clearanceMm: 0.2,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#e5e7eb",
    defaultViaProtection: "tented",
  },
];

/**
 * Two real single-pad placements on `netId`. Ringless centre-only pads would
 * make every case below pass vacuously — the kernel connects copper, not
 * coordinates — so each pad carries an actual 1x1 mm ring.
 */
function pads2(
  netId: string,
  a = { x: 0, y: 0 },
  b = { x: 10, y: 0 },
  opts: { tht?: boolean } = {},
): { placements: PcbPlacedPart[]; padNetIds: Map<string, string> } {
  const part = (id: string, at: { x: number; y: number }): PcbPlacedPart =>
    placement(id, {
      positionMm: at,
      pads: [
        pad("1", { x: 0, y: 0 }, 1, 1, {
          ...(opts.tht ? { drillDiameterMm: 0.5 } : {}),
        }),
      ],
    });
  return {
    placements: [part("A", a), part("B", b)],
    padNetIds: new Map([
      ["A|1", netId],
      ["B|1", netId],
    ]),
  };
}

function rats(input: {
  netId: string;
  netName: string;
  pads: { placements: PcbPlacedPart[]; padNetIds: Map<string, string> };
  traces?: PcbTrace[];
  vias?: PcbVia[];
  freePads?: PcbFreePad[];
}): RatsnestSegment[] {
  return computeRatsnest({
    layerCount: board().layerCount,
    netNames: new Map([[input.netId, input.netName]]),
    netClasses: NET_CLASSES,
    placements: input.pads.placements,
    padNetIds: input.pads.padNetIds,
    freePads: input.freePads ?? [],
    traces: input.traces ?? [],
    vias: input.vias ?? [],
  }).filter((s) => s.netId === input.netId);
}

function rtrace(
  id: string,
  pts: Array<[number, number]>,
  layer: "F.Cu" | "B.Cu" = "F.Cu",
  netId = "n1",
): PcbTrace {
  return {
    id,
    netId,
    netClassId: "default",
    layer,
    widthMm: 0.25,
    pointsNm: pts.map(([x, y]) => ({
      x: Math.round(x * 1_000_000),
      y: Math.round(y * 1_000_000),
    })),
    segmentMode: "manhattan-90",
  };
}

describe("audit B3 — connectivity / pour / net classes", () => {
  // Fix: P5 (GND suppression must be pour-aware, not name-unconditional).
  test("B3-1: unrouted GND with NO pour still produces airwires", () => {
    // No fill context — the default board has copper fill disabled.
    const segments = rats({
      netId: "n-gnd",
      netName: "GND",
      pads: pads2("n-gnd"),
    });
    expect(segments).toHaveLength(1);
  });

  // Fixed in P2d (live netclass resolution — trace and pad verdicts agree).
  test("B3-2: reassigned net class applies to traces AND pads alike", () => {
    const wide = {
      id: "wide",
      name: "Wide",
      traceWidthMm: 0.25,
      clearanceMm: 2.0,
      viaDiameterMm: 0.8,
      viaDrillMm: 0.4,
      color: "#fff",
      defaultViaProtection: "tented" as const,
    };
    const base = board();
    const report = runDrc(
      projection({
        board: {
          ...base,
          netClasses: [...base.netClasses, wide],
          perNetClassAssignments: { n1: "wide" },
        },
        netNames: { n1: "A", n2: "B" },
        traces: [
          trace("t1", "n1", [[0, 0], [10, 0]], { netClassId: "default" }),
          // 0.4 mm gap to BOTH t1 and U1 pad 1 (same net n1).
          trace("t2", "n2", [[0, 0.6], [10, 0.6]]),
        ],
        placements: [
          placement("U1", {
            positionMm: { x: 20, y: 0.6 + 0.1 + 0.5 + 0.4 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "U1|1": "n1" },
      }),
    );
    // Same net, same 0.4 mm gap, same required 2.0 — BOTH must flag.
    expect(codes(report)).toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  // Fix: P5 (cross-layer endpoint chaining requires a via).
  test("B3-3: exact endpoint touch across layers does NOT connect", () => {
    const segments = rats({
      netId: "n1",
      netName: "SIG",
      pads: pads2("n1", { x: 0, y: 0 }, { x: 10, y: 0 }, { tht: true }),
      traces: [
        rtrace("t1", [[0, 0], [5, 0]], "F.Cu"),
        rtrace("t2", [[5, 0], [10, 0]], "B.Cu"), // no via at (5,0)!
      ],
    });
    // Electrically open — the airwire must remain.
    expect(segments).toHaveLength(1);
  });

  // Fix: P5 (pad/via↔trace unions become layer-aware; PadRef gains a layer).
  test("B3-4: B.Cu trace ending on an F.Cu-only pad does not connect", () => {
    // Both pads are SMD F.Cu-only; the B.Cu trace touches their XY but not
    // their copper.
    const segments = rats({
      netId: "n1",
      netName: "SIG",
      pads: pads2("n1"),
      traces: [rtrace("t1", [[0, 0], [10, 0]], "B.Cu")],
    });
    expect(segments).toHaveLength(1);
  });

  // Fix: P5 (via on a trace INTERIOR joins the union, like the T-junction pass).
  test("B3-5: mid-segment stitching via connects both layers", () => {
    const segments = rats({
      netId: "n1",
      netName: "SIG",
      pads: pads2("n1", { x: 0, y: 0 }, { x: 5, y: 5 }, { tht: true }),
      traces: [
        rtrace("t1", [[0, 0], [10, 0]], "F.Cu"), // via sits mid-interior
        rtrace("t2", [[5, 0], [5, 5]], "B.Cu"), // endpoint on via center
      ],
      vias: [via("v1", { netId: "n1", center: { x: 5, y: 0 } })],
    });
    expect(segments).toHaveLength(0);
  });

  // Fix: P5 (free pads join the connectivity graph — TODO.md 1.7).
  test("B3-6: net stitched through a free pad's copper is connected", () => {
    // t1 ends at (4.8,0), t2 starts at (5.2,0), both under a 1.0 mm std free
    // pad on the same net at (5,0).
    const segments = rats({
      netId: "n1",
      netName: "SIG",
      pads: pads2("n1"),
      traces: [
        rtrace("t1", [[0, 0], [4.8, 0]]),
        rtrace("t2", [[5.2, 0], [10, 0]]),
      ],
      freePads: [
        freePad("fp1", {
          padType: "std",
          center: { x: 5, y: 0 },
          widthMm: 1,
          heightMm: 1,
          drillMm: 0.5,
          netId: "n1",
        }),
      ],
    });
    expect(segments).toHaveLength(0);
  });

  // Fixed in P3 (violation-id v2 hashes the layer).
  test("B3-7: isolated islands on different layers get distinct ids", () => {
    // n2 square loop encloses a pocket with no GND copper inside → the pour
    // pocket is isolated, on BOTH layers. GND pad outside anchors the rest.
    const loop = (layer: "F.Cu" | "B.Cu") =>
      trace(
        `loop-${layer}`,
        "n2",
        [
          [-2, -2],
          [2, -2],
          [2, 2],
          [-2, 2],
          [-2, -2],
        ],
        { layer, widthMm: 0.3 },
      );
    const report = runDrc(
      projection({
        board: board(),
        zones: [boardZoneRow("F.Cu", "gnd"), boardZoneRow("B.Cu", "gnd")],
        netNames: { gnd: "GND", n2: "SIG" },
        traces: [loop("F.Cu"), loop("B.Cu")],
        placements: [
          placement("U1", {
            positionMm: { x: -10, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1.5, 1.5, { drillDiameterMm: 0.8 })],
          }),
        ],
        padNets: { "U1|1": "gnd" },
      }),
    );
    const islands = report.violations.filter(
      (v) => v.code === "ISOLATED_COPPER_ISLAND",
    );
    expect(islands).toHaveLength(2);
    expect(new Set(islands.map((v) => v.id)).size).toBe(2);
  });

  // Fixed in P5c (explicit zones run through the pour check).
  test("B3-8: floating island inside an explicit zone is flagged", () => {
    const report = runDrc(
      projection({
        netNames: { n1: "GND" },
        zones: [
          {
            id: "z1",
            name: null,
            enabled: true,
            lockedAt: null,
            netName: "GND",
            netId: "n1",
            layer: "F.Cu",
            region: {
              kind: "polygon",
              pointsMm: [
                { x: -5, y: -5 },
                { x: 5, y: -5 },
                { x: 5, y: 5 },
                { x: -5, y: 5 },
              ],
            },
            priority: 0,
          },
        ],
        // No n1 copper anywhere inside the zone → the whole fill floats.
      }),
    );
    expect(codes(report)).toContain("ISOLATED_COPPER_ISLAND");
  });

  // S5: `measuredMm` is contractually a LENGTH; the area moved to the message.
  test("B3-9: island violation does not report area in the mm field", () => {
    // Post-fix: measuredMm is undefined (or a genuine length) for
    // ISOLATED_COPPER_ISLAND; the area moves to the message/a dedicated field.
    // Reuses the B3-8 explicit-zone island fixture — same as above, no n1
    // copper anywhere inside the zone, so the whole fill floats.
    const report = runDrc(
      projection({
        netNames: { n1: "GND" },
        zones: [
          {
            id: "z1",
            name: null,
            enabled: true,
            lockedAt: null,
            netName: "GND",
            netId: "n1",
            layer: "F.Cu",
            region: {
              kind: "polygon",
              pointsMm: [
                { x: -5, y: -5 },
                { x: 5, y: -5 },
                { x: 5, y: 5 },
                { x: -5, y: 5 },
              ],
            },
            priority: 0,
          },
        ],
      }),
    );
    const islands = report.violations.filter(
      (v) => v.code === "ISOLATED_COPPER_ISLAND",
    );
    expect(islands.length).toBeGreaterThan(0);
    for (const v of islands) {
      // If a dedicated areaMm2 field is added later, this assertion should
      // be relaxed to check that field carries the area instead of mm.
      expect(v.measuredMm).toBeUndefined();
      // The area still reaches the user — in the message, where the unit is
      // written out.
      expect(v.message).toContain("mm² total");
    }
  });

  // S5: the verdict is the island's COMPONENT reaching a pad, not `attached`.
  test("B3-10: island anchored only by dead same-net copper still flags", () => {
    // An island touching a floating same-net trace stub is still dead copper.
    //
    // 100x100 board, F.Cu board-wide gnd fill. A full-width sig trace at
    // y=0 (width 2.0, x from -60 to 60) splits the pour into a bottom
    // island (y < -1) and a top island (y > 1). The bottom island touches
    // a gnd pad — live. The top island contains ONLY a floating gnd trace
    // stub with no pad: `CopperFillIsland.attached` is TRUE for it (S1
    // membership is "touches ANY same-net bare copper", the island-REMOVAL
    // criterion), so the pre-S5 check stayed silent. The verdict is now the
    // island's connectivity COMPONENT reaching a `pad:`/`freepad:` item.
    const report = runDrc(
      projection({
        board: {
          ...board(),
          outline: {
            kind: "rect",
            widthMm: 100,
            heightMm: 100,
            centerMm: { x: 0, y: 0 },
          },
        },
        zones: [boardZoneRow("F.Cu", "gnd")],
        netNames: { gnd: "GND", sig: "SIG" },
        traces: [
          trace("splitter", "sig", [[-60, 0], [60, 0]], { widthMm: 2.0 }),
          // Floating stub with no pad — dead copper sitting in the top
          // island only.
          trace("stub", "gnd", [[0, 30], [10, 30]], { widthMm: 0.2 }),
        ],
        placements: [
          placement("U1", {
            positionMm: { x: 0, y: -30 },
            pads: [pad("1", { x: 0, y: 0 }, 2, 2, { drillDiameterMm: 1 })],
          }),
        ],
        padNets: { "U1|1": "gnd" },
      }),
    );
    expect(codes(report)).toContain("ISOLATED_COPPER_ISLAND");
  });
});
