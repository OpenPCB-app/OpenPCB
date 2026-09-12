/**
 * Audit regression suite B7 — findings registered by the S8 live-parity
 * session (docs/drc/OPEN_FINDINGS.md). Post-fix expectations; flip live per
 * milestone.
 */
import { describe, expect, test } from "bun:test";
import type { DrcViolation, PcbNetClass } from "../../../sdks/designer";
import { runDrc } from "../../../shared/drc/drc-engine";
import { buildDrcItems } from "../../../shared/drc/drc-context";
import {
  checkPendingCopper,
  refusedViolations,
} from "../../../shared/drc/legality";
import {
  boardWithRules,
  freePad,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";
import { polygonZoneRow } from "./helpers/pcb-zone-fixtures";

const NET_CLASSES: PcbNetClass[] = [
  {
    id: "default",
    name: "Default",
    traceWidthMm: 0.25,
    clearanceMm: 0.25,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#e5e7eb",
    defaultViaProtection: "tented",
  },
  {
    id: "hv",
    name: "HV",
    traceWidthMm: 0.25,
    clearanceMm: 2,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#f97316",
    defaultViaProtection: "tented",
  },
];

describe("audit B7 — unassigned copper and the net it extends (S13)", () => {
  // Fixed in S13 (electrical contract 13 §4): the effective-net kernel gives
  // every null-net item the tier of the conductor it physically extends, and
  // the judge resolves on that tier. Before S13 the null-net trace below
  // extended net A (class `hv`, 2 mm) but was judged against net B at the
  // null-net (default) tier, so the 0.5 mm gap passed in batch and at the live
  // / server gates alike.
  test("B7-1: a null-net trace extending a 2 mm-class net is judged against other nets as that net", () => {
    const board = boardWithRules({
      netClasses: NET_CLASSES,
      perNetClassAssignments: { nA: "hv" },
    });
    const boardCopper = [
      // Net A, class hv (2 mm clearance): the null-net trace starts on it.
      trace("a", "nA", [
        [0, -2],
        [0, 0],
      ]),
      // Net B, default class: 0.5 mm edge gap from the null-net trace below.
      trace("b", "nB", [
        [8, 0.7],
        [10, 0.7],
      ]),
    ];
    const pending = trace("x", null, [
      [0, 0],
      [10, 0],
    ]);
    const netNames = { nA: "A", nB: "B" };

    // Batch: the null trace is an extension of A, so its pair with B resolves
    // at A's tier — 0.5 mm measured against 2 mm required.
    const report = runDrc(
      projection({ board, netNames, traces: [...boardCopper, pending] }),
    );
    const batch = report.violations.filter(
      (v) =>
        v.code === "TRACE_TO_TRACE_CLEARANCE" &&
        v.anchors.some((a) => a.kind === "trace" && a.traceId === "x") &&
        v.anchors.some((a) => a.kind === "trace" && a.traceId === "b"),
    );
    expect(batch).toHaveLength(1);
    expect(batch[0]!.requiredMm).toBe(2);
    expect(batch[0]!.measuredMm).toBeCloseTo(0.5, 9);

    // Live: the same verdict for the same copper as pending (07 §1 clause 1).
    const ctx = buildDrcItems(
      projection({ board, netNames, traces: boardCopper }),
    );
    const live = checkPendingCopper(ctx, { traces: [pending], vias: [] }).filter(
      (v) => v.code === "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(live).toHaveLength(1);
    expect(live[0]!.requiredMm).toBe(2);
    expect(live[0]!.measuredMm).toBe(batch[0]!.measuredMm);
  });
});

// --- S13 §4: effective nets, chain shorts and the live overlay -------------

const HV_WIDE: PcbNetClass[] = [
  NET_CLASSES[0]!,
  { ...NET_CLASSES[1]!, traceWidthMm: 0.5 },
];

function shorts(violations: readonly DrcViolation[]): DrcViolation[] {
  return violations.filter((v) => v.code === "NET_SHORT_CIRCUIT");
}

function clearances(violations: readonly DrcViolation[]): DrcViolation[] {
  return violations.filter((v) => v.code === "TRACE_TO_TRACE_CLEARANCE");
}

function currents(violations: readonly DrcViolation[]): DrcViolation[] {
  return violations.filter((v) => v.code === "TRACE_CURRENT_WIDTH");
}

describe("S13 §4 — effective nets for unassigned copper", () => {
  const netNames = { nA: "A", nB: "B", nC: "C" };
  const hvBoard = boardWithRules({
    netClasses: NET_CLASSES,
    perNetClassAssignments: { nA: "hv" },
  });

  test("a chain A–X–Y takes A's tier all the way, batch and live (§4.1)", () => {
    // a ─ x ─ y, and `c` (net B, default class) 0.5 mm from y: y is two hops
    // from A, so only a COMPONENT derivation gives it A's 2 mm tier.
    const boardCopper = [
      trace("a", "nA", [
        [0, -2],
        [0, 0],
      ]),
      trace("x", null, [
        [0, 0],
        [4, 0],
      ]),
      trace("y", null, [
        [4, 0],
        [8, 0],
      ]),
    ];
    const c = trace("c", "nB", [
      [7, 0.7],
      [8, 0.7],
    ]);

    const batch = clearances(
      runDrc(projection({ board: hvBoard, netNames, traces: [...boardCopper, c] }))
        .violations,
    );
    expect(batch).toHaveLength(1);
    expect(batch[0]!.anchors).toEqual([
      { kind: "trace", traceId: "c" },
      { kind: "trace", traceId: "y" },
    ]);
    expect(batch[0]!.requiredMm).toBe(2);
    expect(batch[0]!.measuredMm).toBeCloseTo(0.5, 9);

    const ctx = buildDrcItems(
      projection({ board: hvBoard, netNames, traces: boardCopper }),
    );
    const gate = clearances(
      checkPendingCopper(ctx, { traces: [c], vias: [] }),
    );
    expect(gate).toHaveLength(1);
    expect(gate[0]!.requiredMm).toBe(batch[0]!.requiredMm);
    expect(gate[0]!.measuredMm).toBe(batch[0]!.measuredMm);
    expect(gate[0]!.id).toBe(batch[0]!.id);
  });

  test("A–X–Y–B is ONE chain short naming both nets (§4.3)", () => {
    const traces = [
      trace("a", "nA", [
        [0, -2],
        [0, 0],
      ]),
      trace("x", null, [
        [0, 0],
        [4, 0],
      ]),
      trace("y", null, [
        [4, 0],
        [8, 0],
      ]),
      trace("b", "nB", [
        [8, 0],
        [8, 2],
      ]),
    ];
    const report = runDrc(projection({ board: hvBoard, netNames, traces }));
    const found = shorts(report.violations);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toBe(
      "Short circuit: unassigned copper chain bridges nets A and B",
    );
    // Null members by anchor key, then one net anchor per label, sorted.
    expect(found[0]!.anchors).toEqual([
      { kind: "trace", traceId: "x" },
      { kind: "trace", traceId: "y" },
      { kind: "net", netId: "nA" },
      { kind: "net", netId: "nB" },
    ]);
    expect(found[0]!.measuredMm).toBe(0);

    // Reversal is byte-identical (§4.5).
    const reversed = runDrc(
      projection({ board: hvBoard, netNames, traces: [...traces].reverse() }),
    );
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(report));
  });

  test("a direct bridge plus a chain that brings a third net: two drafts (Astra run 1 #6)", () => {
    // x touches A and B directly (the 06 §4 draft); y brings C in through x,
    // and only the component draft can name all three.
    const boardCopper = [
      trace("a", "nA", [
        [0, -2],
        [0, 0],
      ]),
      trace("x", null, [
        [0, 0],
        [4, 0],
      ]),
      trace("b", "nB", [
        [4, 0],
        [4, 2],
      ]),
      trace("y", null, [
        [2, 0],
        [2, -3],
      ]),
    ];
    const c = trace("c", "nC", [
      [2, -3],
      [5, -3],
    ]);

    const batch = shorts(
      runDrc(projection({ board: hvBoard, netNames, traces: [...boardCopper, c] }))
        .violations,
    );
    expect(batch.map((v) => v.message).sort()).toEqual([
      "Short circuit: unassigned copper chain bridges nets A, B and C",
      "Short circuit: unassigned trace bridges nets A and B",
    ]);

    // Live, with C the pending copper: the chain short is the route's, the
    // pre-existing A/B bridge is the board's and stays out of the gate.
    const ctx = buildDrcItems(
      projection({ board: hvBoard, netNames, traces: boardCopper }),
    );
    const gate = shorts(checkPendingCopper(ctx, { traces: [c], vias: [] }));
    expect(gate.map((v) => v.message)).toEqual([
      "Short circuit: unassigned copper chain bridges nets A, B and C",
    ]);
  });

  test("a null via bridging F.Cu/A and B.Cu/B is a DIRECT short and takes no tier", () => {
    const traces = [
      trace("a", "nA", [
        [-2, 0],
        [0, 0],
      ]),
      trace("b", "nB", [
        [0, 0],
        [2, 0],
      ], { layer: "B.Cu" }),
    ];
    const vias = [via("v", { netId: null, center: { x: 0, y: 0 } })];
    const report = runDrc(projection({ board: hvBoard, netNames, traces, vias }));
    const found = shorts(report.violations);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toBe(
      "Short circuit: unassigned via bridges nets A and B",
    );

    const ctx = buildDrcItems(
      projection({ board: hvBoard, netNames, traces, vias }),
    );
    const item = ctx.vias.find((v) => v.via.id === "v")!;
    // Two labels ⇒ conflict ⇒ no effective net (§4.1 table).
    expect(ctx.tierNetOf(item)).toBeNull();
  });

  test("a null trace close to other copper of the net it extends reports nothing (B7-1's false FAIL)", () => {
    const traces = [
      trace("a", "nA", [
        [0, -2],
        [0, 0],
      ]),
      trace("x", null, [
        [0, 0],
        [4, 0],
      ]),
      // Same net A, 0.2 mm from x — a 2 mm-class breach at the null tier.
      trace("a2", "nA", [
        [1, 0.4],
        [3, 0.4],
      ]),
    ];
    const report = runDrc(projection({ board: hvBoard, netNames, traces }));
    expect(clearances(report.violations)).toEqual([]);
    expect(
      report.violations.filter((v) => v.code === "FAB_CLEARANCE"),
    ).toEqual([]);
  });

  test("pour copper grants no tier: an A pour alone leaves X null, an A trace does not (§4.1)", () => {
    const zoneRect = [
      { x: -1, y: -1 },
      { x: 6, y: -1 },
      { x: 6, y: 3 },
      { x: -1, y: 3 },
    ];
    const x = trace("x", null, [
      [0, 0],
      [4, 0],
    ]);
    // 0.2 mm from x — under the default tier, far under A's 2 mm tier.
    const b = trace("b", "nB", [
      [3, 0.4],
      [3.8, 0.4],
    ]);

    // Only an A POUR over x: x stays null, so the default tier judges the pair.
    const pourOnly = clearances(
      runDrc(
        projection({
          board: hvBoard,
          netNames,
          traces: [x, b],
          zones: [polygonZoneRow("za", "F.Cu", "nA", zoneRect)],
        }),
      ).violations,
    );
    expect(pourOnly).toHaveLength(1);
    expect(pourOnly[0]!.requiredMm).toBe(0.25);

    // An A TRACE touching x, with a B pour over it too: the trace sets the
    // tier, the pour contributes nothing either way.
    const withTrace = clearances(
      runDrc(
        projection({
          board: hvBoard,
          netNames,
          traces: [
            trace("a", "nA", [
              [0, -2],
              [0, 0],
            ]),
            x,
            b,
          ],
          zones: [polygonZoneRow("zb", "F.Cu", "nB", zoneRect)],
        }),
      ).violations,
    );
    expect(withTrace).toHaveLength(1);
    expect(withTrace[0]!.requiredMm).toBe(2);
  });

  test("a bounding-rectangle pad's touch is POSSIBLE only — no tier, no component (Astra run 1 #7)", () => {
    const placements = [
      placement("U1", {
        pads: [pad("1", { x: 0, y: 0 }, 2, 2, { shape: "custom" })],
      }),
    ];
    const freePads = [
      freePad("fx", { center: { x: 2, y: 0 }, widthMm: 2, heightMm: 2 }),
    ];
    const traces = [
      trace("b", "nB", [
        [1.5, 1.3],
        [2.5, 1.3],
      ]),
    ];
    const parts = {
      board: hvBoard,
      netNames,
      placements,
      freePads,
      traces,
      padNets: { "U1|1": "nA" },
    };
    const report = runDrc(projection(parts));
    const row = report.violations.filter(
      (v) =>
        v.code === "TRACE_TO_PAD_CLEARANCE" &&
        v.anchors.some((a) => a.kind === "freePad" && a.freePadId === "fx"),
    );
    expect(row).toHaveLength(1);
    // 0.25, not the hv class's 2 mm: the custom pad never joined the component.
    expect(row[0]!.requiredMm).toBe(0.25);

    const ctx = buildDrcItems(projection(parts));
    const item = ctx.pads.find(
      (p) => p.anchor.kind === "freePad" && p.anchor.freePadId === "fx",
    )!;
    expect(ctx.tierNetOf(item)).toBeNull();
    expect(
      report.violations.some((v) => v.message.includes("copper chain")),
    ).toBe(false);
  });
});

describe("S13 §4.1 — an unplated hole does not conduct between faces", () => {
  // 10 §2.4: two rings, no barrel. §4.1's "a via or a THROUGH pad joins every
  // layer it exists on" is a claim about a PLATED barrel, so the kernel splits
  // an unplated pad into one node per face — otherwise a back-side stub
  // inherits, through copper that does not conduct, the tier of whatever the
  // FRONT ring touches (Astra run 2 #1).
  const HV: PcbNetClass[] = [
    NET_CLASSES[0]!,
    { ...NET_CLASSES[0]!, id: "hv", name: "HV", voltageV: 230 },
  ];
  const netNames = { hv1: "HV1" };

  function parts(plated: boolean) {
    return {
      board: boardWithRules({
        netClasses: HV,
        perNetClassAssignments: { hv1: "hv" },
      }),
      netNames,
      placements: [
        placement("U1", {
          pads: [
            pad("1", { x: 0, y: 0 }, 2, 2, { drillDiameterMm: 0.8, plated }),
          ],
        }),
      ],
      // `f` lands on the FRONT ring; `x` on the BACK one, 0.5 mm from `h`.
      traces: [
        trace("f", "hv1", [
          [-4, 0],
          [-1, 0],
        ]),
        trace("x", null, [
          [1, 0],
          [5, 0],
        ], { layer: "B.Cu" }),
        trace("h", "hv1", [
          [2, 0.7],
          [4, 0.7],
        ], { layer: "B.Cu" }),
      ],
    };
  }

  const xhCreepage = (violations: readonly DrcViolation[]): DrcViolation[] =>
    violations.filter(
      (v) =>
        v.code === "CREEPAGE_DISTANCE" &&
        v.anchors.some((a) => a.kind === "trace" && a.traceId === "x") &&
        v.anchors.some((a) => a.kind === "trace" && a.traceId === "h"),
    );

  test("the back-side stub keeps the null tier, so the 230 V row stands", () => {
    const p = parts(false);
    const ctx = buildDrcItems(projection(p));
    expect(ctx.tierNetOf(ctx.traces.find((t) => t.id === "x")!)).toBeNull();

    const row = xhCreepage(runDrc(projection(p)).violations);
    expect(row).toHaveLength(1);
    expect(row[0]!.requiredMm).toBe(1.25);
    expect(row[0]!.measuredMm).toBeCloseTo(0.5, 9);

    // Live, with the stub as the pending copper: the same verdict.
    const boardOnly = { ...p, traces: p.traces.filter((t) => t.id !== "x") };
    const live = xhCreepage(
      checkPendingCopper(buildDrcItems(projection(boardOnly)), {
        traces: [p.traces.find((t) => t.id === "x")!],
        vias: [],
      }),
    );
    expect(live).toHaveLength(1);
    expect(live[0]!.requiredMm).toBe(1.25);
    expect(live[0]!.id).toBe(row[0]!.id);
  });

  test("a PLATED pad of the same geometry still joins the faces", () => {
    const p = parts(true);
    const ctx = buildDrcItems(projection(p));
    expect(ctx.tierNetOf(ctx.traces.find((t) => t.id === "x")!)).toBe("hv1");
    // Same tier as `h` ⇒ one conductor ⇒ no constituent at all.
    expect(xhCreepage(runDrc(projection(p)).violations)).toEqual([]);

    const boardOnly = { ...p, traces: p.traces.filter((t) => t.id !== "x") };
    expect(
      xhCreepage(
        checkPendingCopper(buildDrcItems(projection(boardOnly)), {
          traces: [p.traces.find((t) => t.id === "x")!],
          vias: [],
        }),
      ),
    ).toEqual([]);
  });
});

describe("S13 §4.4 — the live overlay rejudges existing copper", () => {
  const netNames = { nA: "A", nB: "B" };

  test("a pending A trace re-tiers an existing null item; its row is reported and refused", () => {
    const board = boardWithRules({
      netClasses: NET_CLASSES,
      perNetClassAssignments: { nA: "hv" },
    });
    const boardCopper = [
      trace("x", null, [
        [0, 0],
        [4, 0],
      ]),
      // 0.5 mm from x: silent at the default tier, a breach at A's 2 mm tier.
      trace("c", "nB", [
        [2.5, 0.7],
        [3.5, 0.7],
      ]),
    ];
    const ctx = buildDrcItems(
      projection({ board, netNames, traces: boardCopper }),
    );
    expect(clearances(checkPendingCopper(ctx, { traces: [], vias: [] }))).toEqual(
      [],
    );

    const pending = trace("p", "nA", [
      [0, -2],
      [0, 0],
    ]);
    const gate = checkPendingCopper(ctx, { traces: [pending], vias: [] });
    const row = clearances(gate);
    expect(row).toHaveLength(1);
    expect(row[0]!.requiredMm).toBe(2);
    expect(row[0]!.measuredMm).toBeCloseTo(0.5, 9);
    // No pending anchor — like a bridge that grew because of the route (07 §4).
    expect(row[0]!.anchors).toEqual([
      { kind: "trace", traceId: "c" },
      { kind: "trace", traceId: "x" },
    ]);
    expect(refusedViolations(ctx, gate).map((v) => v.id)).toContain(row[0]!.id);

    // Batch on the same final geometry agrees, to the id (07 §1 clause 1).
    const batch = clearances(
      runDrc(
        projection({ board, netNames, traces: [...boardCopper, pending] }),
      ).violations,
    );
    expect(batch.map((v) => v.id)).toEqual([row[0]!.id]);
    expect(batch[0]!.requiredMm).toBe(2);
  });

  test("a pending 3 A trace re-tiers an existing null trace's CURRENT verdict", () => {
    // The per-item forms that read the tier net must run over the RETIERED
    // existing items too (13 §4.4, §5), not only over the pending copper.
    const board = boardWithRules({
      netClasses: [
        ...NET_CLASSES,
        { ...NET_CLASSES[0]!, id: "hc", name: "HC", currentA: 3 },
      ],
      perNetClassAssignments: { nC: "hc" },
    });
    const names = { nC: "C" };
    const boardCopper = [
      trace("x", null, [
        [0, 0],
        [4, 0],
      ]),
    ];
    const ctx = buildDrcItems(
      projection({ board, netNames: names, traces: boardCopper }),
    );
    // Unassigned copper is unrated: no tier, no class current, no verdict.
    expect(
      currents(checkPendingCopper(ctx, { traces: [], vias: [] })),
    ).toEqual([]);

    // Wide enough for 3 A itself; the 0.2 mm null trace it connects is not.
    const pending = trace(
      "p",
      "nC",
      [
        [0, -2],
        [0, 0],
      ],
      { widthMm: 1.4 },
    );
    const gate = checkPendingCopper(ctx, { traces: [pending], vias: [] });
    const row = currents(gate);
    expect(row).toHaveLength(1);
    expect(row[0]!.anchors).toEqual([{ kind: "trace", traceId: "x" }]);
    expect(row[0]!.requiredMm).toBeCloseTo(1.367, 3);
    // Reported, never refused (13 §3.6).
    expect(row[0]!.severity).toBe("warning");
    expect(refusedViolations(ctx, gate).map((v) => v.id)).not.toContain(
      row[0]!.id,
    );

    // Batch on the same final geometry agrees, to the id (07 §1 clause 1).
    const batch = currents(
      runDrc(
        projection({
          board,
          netNames: names,
          traces: [...boardCopper, pending],
        }),
      ).violations,
    );
    expect(batch.map((v) => v.id)).toEqual([row[0]!.id]);
  });

  test("a pre-existing chain short is the board's, not the route's", () => {
    const board = boardWithRules({
      netClasses: NET_CLASSES,
      perNetClassAssignments: { nA: "hv" },
    });
    const boardCopper = [
      trace("a", "nA", [
        [0, -2],
        [0, 0],
      ]),
      trace("x", null, [
        [0, 0],
        [4, 0],
      ]),
      trace("y", null, [
        [4, 0],
        [8, 0],
      ]),
      trace("b", "nB", [
        [8, 0],
        [8, 2],
      ]),
    ];
    const ctx = buildDrcItems(
      projection({ board, netNames, traces: boardCopper }),
    );
    // The board itself carries the chain short; the batch report owns it.
    expect(ctx.chainShorts).toHaveLength(1);
    const gate = checkPendingCopper(ctx, {
      traces: [
        trace("p", "nB", [
          [10, 10],
          [12, 10],
        ]),
      ],
      vias: [],
    });
    expect(shorts(gate)).toEqual([]);
  });

  test("the live verdict does not follow the board arrays' order", () => {
    const board = boardWithRules({
      netClasses: NET_CLASSES,
      perNetClassAssignments: { nA: "hv" },
    });
    const boardCopper = [
      trace("x", null, [
        [0, 0],
        [4, 0],
      ]),
      trace("y", null, [
        [4, 0],
        [8, 0],
      ]),
      trace("c", "nB", [
        [6.5, 0.7],
        [7.5, 0.7],
      ]),
    ];
    const pending = {
      traces: [
        trace("p", "nA", [
          [0, -2],
          [0, 0],
        ]),
      ],
      vias: [],
    };
    const run = (traces: typeof boardCopper): string =>
      JSON.stringify(
        checkPendingCopper(
          buildDrcItems(projection({ board, netNames, traces })),
          pending,
        ),
      );
    expect(run([...boardCopper].reverse())).toBe(run(boardCopper));
    expect(run(boardCopper)).toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("a route that only reshapes a component re-reports none of the board's own rows (R1 #1)", () => {
    // `a` and `c` are 0.3 mm apart — a PRE-EXISTING 0.5 mm breach the batch
    // report owns. The route is an unassigned stub landing on `a`: it moves
    // nobody's tier (its own is A, and A keeps its own net) and nobody's
    // exposure, so a↔c resolves to exactly what it resolved to on the board.
    const board = boardWithRules({ clearance: { traceToTraceMm: 0.5 } });
    const boardCopper = [
      trace("a", "nA", [
        [0, 0],
        [10, 0],
      ]),
      trace("c", "nB", [
        [0, 0.5],
        [10, 0.5],
      ]),
    ];
    const pre = runDrc(
      projection({ board, netNames, traces: boardCopper }),
    ).violations;
    const preAC = clearances(pre);
    expect(preAC).toHaveLength(1);

    const ctx = buildDrcItems(
      projection({ board, netNames, traces: boardCopper }),
    );
    const gate = checkPendingCopper(ctx, {
      traces: [
        trace("p", null, [
          [5, 0],
          [5, -4],
        ]),
      ],
      vias: [],
    });
    // Exactly the new c↔p row; the board's own a↔c row is NOT the route's.
    expect(clearances(gate).map((v) => v.anchors)).toEqual([
      [
        { kind: "trace", traceId: "c" },
        { kind: "trace", traceId: "p" },
      ],
    ]);
    expect(gate.map((v) => v.id)).not.toContain(preAC[0]!.id);
    expect(refusedViolations(ctx, gate).map((v) => v.id)).not.toContain(
      preAC[0]!.id,
    );
  });

  test("a pure re-id tune does not re-attribute the board's chain short (R1 #3)", () => {
    // `replaces` strips a member from the board-side component too, so the
    // identity on both sides must be built on the copper that SURVIVES.
    const board = boardWithRules({
      netClasses: NET_CLASSES,
      perNetClassAssignments: { nA: "hv" },
    });
    const y = trace("y", null, [
      [4, 0],
      [8, 0],
    ]);
    const boardCopper = [
      trace("a", "nA", [
        [0, -2],
        [0, 0],
      ]),
      trace("x", null, [
        [0, 0],
        [4, 0],
      ]),
      y,
      trace("b", "nB", [
        [8, 0],
        [8, 2],
      ]),
    ];
    const ctx = buildDrcItems(
      projection({ board, netNames, traces: boardCopper }),
    );
    expect(ctx.chainShorts).toHaveLength(1);
    const gate = checkPendingCopper(
      ctx,
      { traces: [y], vias: [] },
      { replaces: ["y"] },
    );
    expect(shorts(gate)).toEqual([]);
  });

  test("the re-tier carries the net class's dimensions to the existing trace", () => {
    const board = boardWithRules({
      netClasses: HV_WIDE,
      perNetClassAssignments: { nA: "hv" },
    });
    const x = trace("x", null, [
      [0, 0],
      [4, 0],
    ]);
    const ctx = buildDrcItems(projection({ board, netNames, traces: [x] }));
    const gate = checkPendingCopper(ctx, {
      traces: [
        trace("p", "nA", [
          [0, -2],
          [0, 0],
        ]),
      ],
      vias: [],
    });
    const width = gate.filter(
      (v) =>
        v.code === "NETCLASS_TRACE_WIDTH" &&
        v.anchors.some((a) => a.kind === "trace" && a.traceId === "x"),
    );
    expect(width).toHaveLength(1);
    expect(width[0]!.requiredMm).toBe(0.5);
    expect(width[0]!.measuredMm).toBeCloseTo(0.2, 9);
  });

  test("a `replaces` that removes X's only connection re-tiers it to the default", () => {
    const board = boardWithRules({
      netClasses: NET_CLASSES,
      perNetClassAssignments: { nA: "hv" },
    });
    const boardCopper = [
      trace("a", "nA", [
        [0, -2],
        [0, 0],
      ]),
      trace("x", null, [
        [0, 0],
        [4, 0],
      ]),
      // 0.2 mm from x: a breach at EITHER tier, but with a different value.
      trace("c", "nB", [
        [1, 0.4],
        [3, 0.4],
      ]),
    ];
    const ctx = buildDrcItems(
      projection({ board, netNames, traces: boardCopper }),
    );
    // Without the replace x keeps A's tier, so the board's own row is not the
    // route's and the gate stays silent about it.
    const far = trace("p", "nB", [
      [10, 10],
      [12, 10],
    ]);
    expect(clearances(checkPendingCopper(ctx, { traces: [far], vias: [] })))
      .toEqual([]);

    const gate = clearances(
      checkPendingCopper(ctx, { traces: [far], vias: [] }, { replaces: ["a"] }),
    );
    expect(gate).toHaveLength(1);
    expect(gate[0]!.requiredMm).toBe(0.25);
    expect(gate[0]!.measuredMm).toBeCloseTo(0.2, 9);

    // Batch on the same final geometry resolves it the same way.
    const batch = clearances(
      runDrc(
        projection({
          board,
          netNames,
          traces: [boardCopper[1]!, boardCopper[2]!, far],
        }),
      ).violations,
    );
    expect(batch.map((v) => v.id)).toEqual([gate[0]!.id]);
    expect(batch[0]!.requiredMm).toBe(0.25);
  });
});
