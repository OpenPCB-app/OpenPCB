/**
 * `ZONE_OVERLAP`, `ZONE_INVALID` and `ZONE_EMPTY_FILL` (zone/keepout contract
 * §5, §13.1, §13.2) through the REAL `runDrc`. The structural two are a TOTAL
 * mapping of the derivation's warnings — DRC consumes the derivation and never
 * re-derives — and the overlap code tests EQUAL-PRIORITY polygon overlap only
 * (copper-pour contract §10: §3.3's carve resolves every other pairing).
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import type {
  DesignerPcbProjection,
  DrcReport,
  DrcRuleCode,
  PcbPointMm,
} from "../../../sdks/designer";
import { boardWithRules, projection, trace } from "./helpers/drc-fixtures";
import {
  boardZoneRow,
  keepoutRow,
  polygonZoneRow,
} from "./helpers/pcb-zone-fixtures";

function rect(x0: number, y0: number, x1: number, y1: number): PcbPointMm[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Self-intersecting "bow tie": three finite vertices, no valid interior. */
const BOW_TIE: PcbPointMm[] = [
  { x: 0, y: 0 },
  { x: 8, y: 8 },
  { x: 8, y: 0 },
  { x: 0, y: 8 },
];

const NETS = { n1: "GND", n2: "VCC" };

function of(report: DrcReport, code: DrcRuleCode) {
  return report.violations.filter((v) => v.code === code);
}

function run(parts: Partial<DesignerPcbProjection>): DrcReport {
  return runDrc(projection({ netNames: NETS, ...parts }));
}

describe("ZONE_OVERLAP", () => {
  test("same layer, equal priority, different nets ⇒ one error", () => {
    const report = run({
      zones: [
        polygonZoneRow("za", "F.Cu", "n1", rect(0, 0, 8, 8), { name: "A" }),
        polygonZoneRow("zb", "F.Cu", "n2", rect(4, 4, 12, 12), { name: "B" }),
      ],
    });
    const found = of(report, "ZONE_OVERLAP");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("error");
    expect(found[0]!.ruleClass).toBe("constraint");
    expect(found[0]!.layer).toBe("F.Cu");
    expect(found[0]!.message).toBe(
      'Zones "A" and "B" overlap on F.Cu with different nets and equal priority',
    );
    expect(found[0]!.anchors).toEqual([
      { kind: "zone", zoneId: "za" },
      { kind: "zone", zoneId: "zb" },
    ]);
    // Centre of the intersection rectangle [4,8] x [4,8].
    expect(found[0]!.locationMm).toEqual({ x: 6, y: 6 });
  });

  test("the verdict and the id do not depend on zone order", () => {
    const zones = [
      polygonZoneRow("za", "F.Cu", "n1", rect(0, 0, 8, 8)),
      polygonZoneRow("zb", "F.Cu", "n2", rect(4, 4, 12, 12)),
    ];
    const forward = of(run({ zones }), "ZONE_OVERLAP");
    const reversed = of(run({ zones: [...zones].reverse() }), "ZONE_OVERLAP");
    expect(reversed.map((v) => v.id)).toEqual(forward.map((v) => v.id));
  });

  test("different priorities are silent — the fill carves them (§3.3)", () => {
    const report = run({
      zones: [
        polygonZoneRow("za", "F.Cu", "n1", rect(0, 0, 8, 8)),
        polygonZoneRow("zb", "F.Cu", "n2", rect(4, 4, 12, 12), { priority: 1 }),
      ],
    });
    // S5's precedence carve resolves the contested area in the artwork: the
    // lower zone is filled around the higher one, so there is no ambiguity to
    // report. Only an EQUAL-priority pair stays a defect (§10).
    expect(of(report, "ZONE_OVERLAP")).toEqual([]);
  });

  test("the same net is legal — the fills merge", () => {
    const report = run({
      zones: [
        polygonZoneRow("za", "F.Cu", "n1", rect(0, 0, 8, 8)),
        polygonZoneRow("zb", "F.Cu", "n1", rect(4, 4, 12, 12)),
      ],
    });
    expect(of(report, "ZONE_OVERLAP")).toEqual([]);
  });

  test("two net-less zones are the same 'no net'", () => {
    const report = run({
      zones: [
        polygonZoneRow("za", "F.Cu", null, rect(0, 0, 8, 8)),
        polygonZoneRow("zb", "F.Cu", null, rect(4, 4, 12, 12)),
      ],
    });
    expect(of(report, "ZONE_OVERLAP")).toEqual([]);
  });

  test("null net vs a real net still differ", () => {
    const report = run({
      zones: [
        polygonZoneRow("za", "F.Cu", null, rect(0, 0, 8, 8)),
        polygonZoneRow("zb", "F.Cu", "n2", rect(4, 4, 12, 12)),
      ],
    });
    expect(of(report, "ZONE_OVERLAP")).toHaveLength(1);
  });

  test("different layers never interact", () => {
    const report = run({
      zones: [
        polygonZoneRow("za", "F.Cu", "n1", rect(0, 0, 8, 8)),
        polygonZoneRow("zb", "B.Cu", "n2", rect(4, 4, 12, 12)),
      ],
    });
    expect(of(report, "ZONE_OVERLAP")).toEqual([]);
  });

  test("a board plane of ANOTHER net under a polygon zone is silent (§3.3)", () => {
    const report = run({
      zones: [
        boardZoneRow("F.Cu", "n1"),
        polygonZoneRow("zb", "F.Cu", "n2", rect(0, 0, 8, 8)),
      ],
    });
    // A board zone holds priority −1 and no polygon, so every explicit zone on
    // its layer carves it and it carves nobody: the plane is poured around the
    // zone, which is exactly what the user drew.
    expect(of(report, "ZONE_OVERLAP")).toEqual([]);
  });

  test("zones that only touch at a vertex do not overlap", () => {
    const report = run({
      zones: [
        polygonZoneRow("za", "F.Cu", "n1", rect(0, 0, 8, 8)),
        polygonZoneRow("zb", "F.Cu", "n2", rect(8, 8, 16, 16)),
      ],
    });
    expect(of(report, "ZONE_OVERLAP")).toEqual([]);
  });

  test("zones that share an edge with opposite interiors do not overlap", () => {
    const report = run({
      zones: [
        polygonZoneRow("za", "F.Cu", "n1", rect(0, 0, 8, 8)),
        polygonZoneRow("zb", "F.Cu", "n2", rect(8, 0, 16, 8)),
      ],
    });
    expect(of(report, "ZONE_OVERLAP")).toEqual([]);
  });
});

describe("ZONE_INVALID", () => {
  test("a bow-tie zone ring is refused and reported, non-waivable", () => {
    const report = run({
      zones: [polygonZoneRow("za", "F.Cu", "n1", BOW_TIE)],
    });
    const found = of(report, "ZONE_INVALID");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("error");
    expect(found[0]!.ruleClass).toBe("structural");
    expect(found[0]!.layer).toBe("F.Cu");
    expect(found[0]!.anchors).toEqual([{ kind: "zone", zoneId: "za" }]);
    expect(found[0]!.locationMm).toEqual(BOW_TIE[0]!);
    expect(found[0]!.message).toContain("Zone outline is invalid");
  });

  test("a bow-tie keepout anchors on the keepout", () => {
    const report = run({
      keepouts: [keepoutRow("k1", ["F.Cu"], BOW_TIE)],
    });
    const found = of(report, "ZONE_INVALID");
    expect(found).toHaveLength(1);
    expect(found[0]!.anchors).toEqual([{ kind: "keepout", keepoutId: "k1" }]);
    expect(found[0]!.layer).toBe("F.Cu");
    expect(found[0]!.message).toContain("Keepout outline is invalid");
  });

  test("a keepout whose only layer is off the stackup is refused", () => {
    const report = run({
      keepouts: [keepoutRow("k1", ["In1.Cu"], rect(0, 0, 8, 8))],
    });
    const found = of(report, "ZONE_INVALID");
    expect(found).toHaveLength(1);
    expect(found[0]!.anchors).toEqual([{ kind: "keepout", keepoutId: "k1" }]);
    // A 4-layer board accepts the same row.
    expect(
      of(
        run({
          board: boardWithRules({ layerCount: 4 }),
          keepouts: [keepoutRow("k1", ["In1.Cu"], rect(0, 0, 8, 8))],
        }),
        "ZONE_INVALID",
      ),
    ).toEqual([]);
  });

  test("a polygon zone claiming a reserved board: id is refused", () => {
    const report = run({
      zones: [polygonZoneRow("board:F.Cu", "F.Cu", "n1", rect(0, 0, 8, 8))],
    });
    const found = of(report, "ZONE_INVALID");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("reserved");
  });

  test("disabled rows are intent, not violations", () => {
    const report = run({
      zones: [polygonZoneRow("za", "F.Cu", "n1", BOW_TIE, { enabled: false })],
      keepouts: [keepoutRow("k1", ["F.Cu"], BOW_TIE, {}, { enabled: false })],
    });
    expect(of(report, "ZONE_INVALID")).toEqual([]);
  });

  test("a severity override cannot silence it — a dropped keepout fails open", () => {
    const report = runDrc(
      projection({
        netNames: NETS,
        keepouts: [keepoutRow("k1", ["F.Cu"], BOW_TIE)],
      }),
      { severityOverrides: { ZONE_INVALID: "ignore" } },
    );
    const found = of(report, "ZONE_INVALID");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("error");
  });

  test("a waiver cannot silence it either", () => {
    const first = run({ keepouts: [keepoutRow("k1", ["F.Cu"], BOW_TIE)] });
    const id = of(first, "ZONE_INVALID")[0]!.id;
    const report = runDrc(
      projection({
        netNames: NETS,
        keepouts: [keepoutRow("k1", ["F.Cu"], BOW_TIE)],
      }),
      { waivedIds: [id] },
    );
    expect(of(report, "ZONE_INVALID")[0]!.waived).toBeUndefined();
    expect(report.summary.errors).toBeGreaterThanOrEqual(1);
  });
});

describe("ZONE_EMPTY_FILL", () => {
  test("a zone entirely off the board pours nothing", () => {
    const report = run({
      zones: [polygonZoneRow("za", "F.Cu", "n1", rect(100, 100, 108, 108))],
    });
    const found = of(report, "ZONE_EMPTY_FILL");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("warning");
    expect(found[0]!.ruleClass).toBe("structural");
    expect(found[0]!.anchors).toEqual([{ kind: "zone", zoneId: "za" }]);
    expect(found[0]!.message).toBe('Zone "GND" on F.Cu pours no copper');
  });

  test("a zone entirely inside a copperPour keepout pours nothing", () => {
    const report = run({
      zones: [polygonZoneRow("za", "F.Cu", "n1", rect(0, 0, 4, 4))],
      keepouts: [
        keepoutRow("k1", ["F.Cu"], rect(-2, -2, 6, 6), {
          tracks: false,
          vias: false,
          pads: false,
          footprints: false,
          copperPour: true,
        }),
      ],
    });
    expect(of(report, "ZONE_EMPTY_FILL")).toHaveLength(1);
  });

  test("an unresolved zone net pours nothing", () => {
    const report = run({
      zones: [
        polygonZoneRow("za", "F.Cu", null, rect(0, 0, 8, 8), {
          netName: "MISSING",
        }),
      ],
    });
    const found = of(report, "ZONE_EMPTY_FILL");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("does not resolve");
  });

  test("a stale persisted net id pours nothing", () => {
    const report = run({
      zones: [polygonZoneRow("za", "F.Cu", "deleted", rect(0, 0, 8, 8))],
    });
    const found = of(report, "ZONE_EMPTY_FILL");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("names no current schematic net");
  });

  test("a board zone with no net pours nothing", () => {
    const report = run({ zones: [boardZoneRow("F.Cu", null)] });
    const found = of(report, "ZONE_EMPTY_FILL");
    expect(found).toHaveLength(1);
    expect(found[0]!.anchors).toEqual([{ kind: "zone", zoneId: "board:F.Cu" }]);
  });

  test("a zone that actually pours is silent", () => {
    const report = run({
      zones: [polygonZoneRow("za", "F.Cu", "n1", rect(0, 0, 8, 8))],
    });
    expect(of(report, "ZONE_EMPTY_FILL")).toEqual([]);
  });
});

describe("ZONE_INVALID — every derivation drop reason maps (§13.2)", () => {
  const bowtie = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];

  test("a class-level ignore cannot silence it either", () => {
    const report = runDrc(
      projection({
        netNames: NETS,
        keepouts: [keepoutRow("kb", ["F.Cu"], bowtie)],
      }),
      { ignoredRuleClasses: ["structural"], waivedIds: [], severityOverrides: {} },
    );
    expect(of(report, "ZONE_INVALID")).toHaveLength(1);
  });

  test("two enabled keepouts sharing an id both drop and report once", () => {
    const report = run({
      keepouts: [
        keepoutRow("dup", ["F.Cu"], rect(0, 0, 5, 5)),
        keepoutRow("dup", ["F.Cu"], rect(20, 20, 25, 25)),
      ],
      traces: [trace("t", "n1", [[1, 1], [4, 4]], { layer: "F.Cu", widthMm: 0.3 })],
    });
    const invalid = of(report, "ZONE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.anchors).toEqual([{ kind: "keepout", keepoutId: "dup" }]);
    // Fail-closed for the copper: neither holder protects, and the DRC says so
    // instead of silently emitting two violations with one id.
    expect(of(report, "KEEPOUT_VIOLATION")).toEqual([]);
    const ids = report.violations.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("two enabled polygon zones sharing an id", () => {
    const report = run({
      zones: [
        polygonZoneRow("dz", "F.Cu", "n1", rect(0, 0, 5, 5)),
        polygonZoneRow("dz", "F.Cu", "n2", rect(20, 20, 25, 25)),
      ],
    });
    const invalid = of(report, "ZONE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.anchors).toEqual([{ kind: "zone", zoneId: "dz" }]);
  });

  test("a board zone whose id disagrees with its layer", () => {
    const report = run({
      zones: [boardZoneRow("F.Cu", "n1", { id: "board:B.Cu" })],
    });
    const invalid = of(report, "ZONE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.message).toContain("board:F.Cu");
  });

  test("a polygon zone on an inner layer of a 2-layer board carries no layer", () => {
    const report = run({
      zones: [polygonZoneRow("zi", "In1.Cu", "n1", rect(0, 0, 5, 5))],
    });
    const invalid = of(report, "ZONE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.layer).toBeUndefined();
  });

  test("an off-stackup keepout carries no layer either", () => {
    const report = run({
      keepouts: [keepoutRow("ki", ["In1.Cu", "In2.Cu"], rect(0, 0, 5, 5))],
    });
    const invalid = of(report, "ZONE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.layer).toBeUndefined();
  });
});

describe("ZONE_OVERLAP — a board plane of another net under a polygon zone (carved since S5)", () => {
  test("a VCC polygon zone over a GND plane on the same layer is silent", () => {
    const report = run({
      zones: [
        boardZoneRow("F.Cu", "n1"),
        polygonZoneRow("zv", "F.Cu", "n2", rect(-5, -5, 5, 5)),
      ],
    });
    // The plane is carved around the zone by §3.3, so the pair is no longer a
    // defect — the separate plane-vs-zone loop that reported it is gone.
    expect(of(report, "ZONE_OVERLAP")).toEqual([]);
  });

  test("the same net merges into the plane — silent", () => {
    const report = run({
      zones: [
        boardZoneRow("F.Cu", "n1"),
        polygonZoneRow("zg", "F.Cu", "n1", rect(-5, -5, 5, 5)),
      ],
    });
    expect(of(report, "ZONE_OVERLAP")).toEqual([]);
  });

  test("a plane on the other layer never interacts", () => {
    const report = run({
      zones: [
        boardZoneRow("B.Cu", "n1"),
        polygonZoneRow("zv", "F.Cu", "n2", rect(-5, -5, 5, 5)),
      ],
    });
    expect(of(report, "ZONE_OVERLAP")).toEqual([]);
  });
});

describe("ZONE_INVALID — duplicate ids on different layers keep one order-independent id (Astra S4 #4)", () => {
  test("two keepouts sharing an id on F.Cu and B.Cu", () => {
    const a = keepoutRow("dup", ["F.Cu"], rect(0, 0, 5, 5));
    const b = keepoutRow("dup", ["B.Cu"], rect(0, 0, 5, 5));
    const one = run({ keepouts: [a, b] });
    const two = run({ keepouts: [b, a] });
    const idsOf = (r: DrcReport) => of(r, "ZONE_INVALID").map((v) => v.id);
    expect(idsOf(one)).toHaveLength(1);
    expect(idsOf(one)).toEqual(idsOf(two));
    expect(of(one, "ZONE_INVALID")[0]!.layer).toBeUndefined();
  });

  test("two polygon zones sharing an id on different layers", () => {
    const a = polygonZoneRow("dz", "F.Cu", "n1", rect(0, 0, 5, 5));
    const b = polygonZoneRow("dz", "B.Cu", "n2", rect(0, 0, 5, 5));
    const one = run({ zones: [a, b] });
    const two = run({ zones: [b, a] });
    const idsOf = (r: DrcReport) => of(r, "ZONE_INVALID").map((v) => v.id);
    expect(idsOf(one)).toEqual(idsOf(two));
  });
});

describe("ZONE_INVALID — an unusable zone cutout (copper-pour contract §11)", () => {
  test("`zone_hole_invalid` maps to ZONE_INVALID, anchored on the zone", () => {
    const zone = polygonZoneRow("zh", "F.Cu", "n1", rect(-8, -8, 8, 8), {
      region: {
        kind: "polygon",
        pointsMm: rect(-8, -8, 8, 8),
        // Two cutouts overlapping each other: no exact subtraction exists.
        holesMm: [rect(-4, -4, 1, 1), rect(-1, -1, 4, 4)],
      },
    });
    const report = run({ zones: [zone] });
    const invalid = of(report, "ZONE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.message).toContain("holes_overlap");
    expect(invalid[0]!.anchors[0]).toEqual({ kind: "zone", zoneId: "zh" });
  });
});

