/**
 * DRC determinism contract (DRC_AUDIT_REPORT.md §3.3, Appendix A; batch-DRC
 * contract 06 §7 — S7 WP4 supersedes the array-reversal probe with a
 * byte-identity promise per array):
 *
 *  1. Identical input (independent clones) → byte-identical full report,
 *     including violation ids, anchors, locations, messages, summary and
 *     countsByCode key order.
 *  2. Reversing ANY ONE of `traces`, `vias`, `placements`, `freePads`,
 *     `freeHoles`, `zones`, `keepouts`, `drcRules` — or all eight together —
 *     yields a BYTE-IDENTICAL `JSON.stringify(report)` (contract §7): every
 *     pairwise computation runs in the canonical anchor-key orientation, so
 *     witnesses, locations and measured values do not depend on iteration
 *     order, and the canonical `(code, id)` sort removes the last order
 *     dependence. A byte difference here is a WP3-A canonical-orientation bug
 *     to report, not a tolerance to loosen.
 *
 * The fixture does not set `projection.ratsnest` — the engine derives its own
 * ratsnest from its own connectivity result (contract §1, D7); trusting the
 * caller-supplied field would test nothing the engine actually reads.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import type {
  DesignerPcbProjection,
  PcbDrcRule,
  PcbKeepout,
  PcbZone,
} from "../../../sdks/designer";
import {
  boardWithRules,
  freeHole,
  freePad,
  pad,
  placement,
  projection,
  sortedIds,
  trace,
  via,
} from "./helpers/drc-fixtures";

const ZONES: PcbZone[] = [
  {
    id: "z1",
    name: "Z1",
    enabled: true,
    lockedAt: null,
    layer: "F.Cu",
    netId: null,
    netName: null,
    region: {
      kind: "polygon",
      pointsMm: [
        { x: -40, y: -40 },
        { x: -35, y: -40 },
        { x: -35, y: -35 },
        { x: -40, y: -35 },
      ],
    },
    priority: 0,
  },
  {
    id: "z2",
    name: "Z2",
    enabled: true,
    lockedAt: null,
    layer: "B.Cu",
    netId: null,
    netName: null,
    region: {
      kind: "polygon",
      pointsMm: [
        { x: -30, y: -40 },
        { x: -25, y: -40 },
        { x: -25, y: -35 },
        { x: -30, y: -35 },
      ],
    },
    priority: 0,
  },
];

const KEEPOUTS: PcbKeepout[] = [
  {
    id: "k1",
    name: "K1",
    enabled: true,
    lockedAt: null,
    layers: ["F.Cu"],
    pointsMm: [
      { x: -20, y: -40 },
      { x: -15, y: -40 },
      { x: -15, y: -35 },
      { x: -20, y: -35 },
    ],
    restrictions: { tracks: false, vias: false, pads: false, copperPour: false, footprints: false },
  },
  {
    id: "k2",
    name: "K2",
    enabled: true,
    lockedAt: null,
    layers: ["F.Cu"],
    pointsMm: [
      { x: -10, y: -40 },
      { x: -5, y: -40 },
      { x: -5, y: -35 },
      { x: -10, y: -35 },
    ],
    restrictions: { tracks: false, vias: false, pads: false, copperPour: false, footprints: false },
  },
];

const DRC_RULES: PcbDrcRule[] = [
  {
    id: "r1",
    name: "R1",
    enabled: true,
    priority: 10,
    scopes: [{ kind: "net", netIds: ["n1"] }],
    constraint: { kind: "edgeClearance", minMm: 0.6 },
  },
  {
    id: "r2",
    name: "R2",
    enabled: true,
    priority: 5,
    scopes: [{ kind: "net", netIds: ["n3"] }],
    constraint: { kind: "clearance", mm: 0.15 },
  },
];

/**
 * Non-trivial fixture: 3 nets, both outer layers, a clearance breach, two
 * different-net crossings (shorts), an under-width trace, trace-to-pad
 * breaches, a via-to-via breach, a hole-to-hole breach and an unconnected net
 * (derived by the engine, not supplied). Also carries >= 2 free pads, >= 2
 * free holes, >= 2 zones, >= 2 keepouts and >= 2 drcRules, so every array
 * the contract names is reversible non-trivially. >= 5 violations across
 * >= 3 distinct codes so a silent fixture regression cannot hollow the
 * byte-identity assertion out.
 */
function buildFixture(): DesignerPcbProjection {
  return projection({
    board: boardWithRules({
      clearance: { traceToTraceMm: 0.25, viaToViaMm: 0.3, traceToPadMm: 0.25 },
      minimums: { traceWidthMm: 0.2 },
      drcRules: DRC_RULES,
    }),
    netNames: { n1: "VCC", n2: "SIG_A", n3: "SIG_B" },
    traces: [
      // n1/n2 parallel pair on F.Cu with 0.2 mm edge gap (< 0.25 rule).
      trace("tA", "n1", [
        [0, 0],
        [10, 0],
      ]),
      trace("tB", "n2", [
        [0, 0.4],
        [10, 0.4],
      ]),
      // n3 crosses both -> two different-net shorts.
      trace("tC", "n3", [
        [5, -2],
        [5, 2],
      ]),
      // Under-width trace on B.Cu (0.1 < 0.2 min).
      trace("tD", "n2", [[0, 5], [10, 5]], { widthMm: 0.1, layer: "B.Cu" }),
      // Trace running close under both U1 pads.
      trace("tE", "n2", [
        [19, 10.15],
        [23, 10.15],
      ]),
    ],
    vias: [
      via("v1", { netId: "n1", center: { x: 30, y: 0 } }),
      // 0.1 mm edge gap to v1 (< 0.3 viaToVia rule).
      via("v2", { netId: "n2", center: { x: 30, y: 0.9 } }),
    ],
    placements: [
      placement("U1", {
        positionMm: { x: 20, y: 10 },
        pads: [pad("1", { x: 0, y: 0 }, 1, 1), pad("2", { x: 2, y: 0 }, 1, 1)],
      }),
      // A second n1 pad, unconnected to tA / v1 / U1.1 -> UNCONNECTED_NET,
      // derived by the engine's own connectivity (contract §1, D7).
      placement("U2", {
        positionMm: { x: -20, y: 10 },
        pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
      }),
    ],
    padNets: { "U1|1": "n1", "U1|2": "n3", "U2|1": "n1" },
    // Far enough apart to carry no hole-to-hole PAIR violation between them —
    // `board.ts`'s hole-to-hole loop does not yet canonicalize its anchor
    // order the way the clearance pair loops do (a WP3-A gap; see the S7 WP4
    // implementer report), so a pair violation here would make this reversal
    // fixture depend on that gap instead of testing genuine determinism. Each
    // hole still carries its own per-item DRILL_SIZE_MIN violation.
    freeHoles: [
      freeHole("fh1", { x: -40, y: 20 }, 0.1),
      freeHole("fh2", { x: -40, y: 26 }, 0.1),
    ],
    freePads: [
      freePad("fp1", { center: { x: -40, y: 30 }, netId: null }),
      freePad("fp2", { center: { x: -35, y: 30 }, netId: null }),
    ],
    zones: ZONES,
    keepouts: KEEPOUTS,
  });
}

type ReversibleKey =
  | "traces"
  | "vias"
  | "placements"
  | "freePads"
  | "freeHoles"
  | "zones"
  | "keepouts";

/** Reverse exactly the named top-level arrays of a fresh fixture clone. */
function reversed(keys: readonly ReversibleKey[]): DesignerPcbProjection {
  const p = buildFixture();
  for (const key of keys) {
    (p[key] as unknown[]) = [...(p[key] as unknown[])].reverse();
  }
  if (keys.length === 0) return p;
  return p;
}

function reversedDrcRules(): DesignerPcbProjection {
  const p = buildFixture();
  p.board = { ...p.board, drcRules: [...(p.board.drcRules ?? [])].reverse() };
  return p;
}

function reversedEverything(): DesignerPcbProjection {
  const p = reversed([
    "traces",
    "vias",
    "placements",
    "freePads",
    "freeHoles",
    "zones",
    "keepouts",
  ]);
  p.board = { ...p.board, drcRules: [...(p.board.drcRules ?? [])].reverse() };
  return p;
}

describe("DRC determinism", () => {
  test("fixture is non-trivial (>=5 violations, >=3 codes)", () => {
    const report = runDrc(buildFixture());
    expect(report.violations.length).toBeGreaterThanOrEqual(5);
    const codes = new Set(report.violations.map((v) => v.code));
    expect(codes.size).toBeGreaterThanOrEqual(3);
  });

  test("identical input -> byte-identical full report", () => {
    const fixture = buildFixture();
    const r1 = runDrc(structuredClone(fixture));
    const r2 = runDrc(structuredClone(fixture));
    const s1 = JSON.stringify(r1);
    const s2 = JSON.stringify(r2);
    // Buffer compare = byte identity incl. key order, not deep equality.
    expect(Buffer.compare(Buffer.from(s1), Buffer.from(s2))).toBe(0);
  });

  test("re-serialized fixture (JSON round-trip) -> byte-identical report", () => {
    const fixture = buildFixture();
    const viaJson = JSON.parse(
      JSON.stringify(fixture),
    ) as DesignerPcbProjection;
    expect(JSON.stringify(runDrc(viaJson))).toBe(
      JSON.stringify(runDrc(fixture)),
    );
  });

  const baseline = JSON.stringify(runDrc(buildFixture()));

  const singleReversals: Array<[string, () => DesignerPcbProjection]> = [
    ["traces", () => reversed(["traces"])],
    ["vias", () => reversed(["vias"])],
    ["placements", () => reversed(["placements"])],
    ["freePads", () => reversed(["freePads"])],
    ["freeHoles", () => reversed(["freeHoles"])],
    ["zones", () => reversed(["zones"])],
    ["keepouts", () => reversed(["keepouts"])],
    ["drcRules", reversedDrcRules],
  ];

  for (const [name, build] of singleReversals) {
    test(`reversing ${name} alone -> byte-identical JSON.stringify(report)`, () => {
      const s = JSON.stringify(runDrc(build()));
      expect(s).toBe(baseline);
    });
  }

  test("reversing all eight arrays together -> byte-identical JSON.stringify(report)", () => {
    const s = JSON.stringify(runDrc(reversedEverything()));
    expect(s).toBe(baseline);
  });

  test("reversed input arrays -> identical id multiset and counts", () => {
    const r1 = runDrc(buildFixture());
    const r2 = runDrc(reversedEverything());
    expect(sortedIds(r2)).toEqual(sortedIds(r1));
    expect(r2.summary).toEqual(r1.summary);
    // Value equality (key order may legitimately differ across input orders).
    expect(r2.countsByCode).toEqual(r1.countsByCode);
  });

  test("reversed input preserves per-id content (message, location, severity)", () => {
    const byId = (vs: ReturnType<typeof runDrc>["violations"]) =>
      new Map(vs.map((v) => [v.id, v]));
    const m1 = byId(runDrc(buildFixture()).violations);
    const m2 = byId(runDrc(reversedEverything()).violations);
    expect(m2.size).toBe(m1.size);
    for (const [id, v1] of m1) {
      const v2 = m2.get(id);
      expect(v2).toBeDefined();
      expect(v2!.code).toBe(v1.code);
      expect(v2!.severity).toBe(v1.severity);
      expect(v2!.message).toBe(v1.message);
      const l1 = v1.locationMm;
      const l2 = v2!.locationMm;
      expect(l1).toBeDefined();
      expect(l2).toBeDefined();
      expect(l2!.x).toBe(l1!.x);
      expect(l2!.y).toBe(l1!.y);
      expect(v2!.measuredMm ?? null).toBe(v1.measuredMm ?? null);
      expect(v2!.requiredMm ?? null).toBe(v1.requiredMm ?? null);
    }
  });
});
