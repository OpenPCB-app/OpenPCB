/**
 * DFM contract 11 §4 — the solder-mask checks.
 *
 * Two rules carry the session's weight and both are pinned here:
 *
 *  - openings that overlap or touch have NO mask between them, so a
 *    different-net pair is the bridge hazard in its worst form and a same-net
 *    or copper-less pair is simply one merged window (Astra run 1 #9, #11);
 *  - an opening may expose its OWN copper and whatever touches it, and NOTHING
 *    else — net equality is not the exemption (#10).
 */
import { describe, expect, test } from "bun:test";
import type {
  DesignerPcbProjection,
  DrcReport,
  PcbBoardSettings,
  PcbPlacedPart,
  PcbVia,
} from "../../../sdks/designer";
import { checkSolderMask } from "../../../shared/drc/checks/solder-mask";
import { buildDrcContext } from "../../../shared/drc/drc-context";
import { finalizeReport } from "../../../shared/drc/drc-engine";
import { boardWithRules, pad, trace } from "./helpers/drc-fixtures";
import { projection } from "./helpers/drc-fixtures";
import { polygonZoneRow } from "./helpers/pcb-zone-fixtures";

function part(
  id: string,
  pads: unknown[],
  opts: { positionMm?: { x: number; y: number }; layer?: "F.Cu" | "B.Cu" } = {},
): PcbPlacedPart {
  return {
    id,
    partId: id,
    componentId: "c",
    reference: id,
    positionMm: opts.positionMm ?? { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    layer: opts.layer ?? "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads,
        graphics: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
  } as unknown as PcbPlacedPart;
}

/** 60 x 40, `custom` fab (no rows) unless a case asks for one. */
function board60(overrides: Partial<PcbBoardSettings> = {}): PcbBoardSettings {
  return {
    ...boardWithRules({
      outline: { kind: "rect", widthMm: 60, heightMm: 40, centerMm: { x: 0, y: 0 } },
      fabricator: "custom",
    }),
    ...overrides,
  };
}

function maskReport(
  parts: Partial<DesignerPcbProjection>,
  board: PcbBoardSettings,
): DrcReport {
  const ctx = buildDrcContext(projection({ ...parts, board }));
  return finalizeReport(checkSolderMask(ctx), {
    designId: "t",
    revision: 1,
    ignoredRuleClasses: [],
    waivedIds: [],
    severityOverrides: undefined,
  });
}

function codes(report: DrcReport): string[] {
  return report.violations.map((v) => v.code).sort();
}

/**
 * Two 1 x 1 pads whose OPENINGS are `gapMm` apart. With the default 0.075 mm
 * expansion each opening is 1.15 wide, so the centres sit 1.15 + gap apart.
 */
function pairPart(gapMm: number): PcbPlacedPart {
  const dx = (1.15 + gapMm) / 2;
  return part("R1", [
    pad("1", { x: -dx, y: 0 }, 1, 1),
    pad("2", { x: dx, y: 0 }, 1, 1),
  ]);
}

/** A free pad with an explicit mask expansion — the `mk_`-style fixture. */
function freePad(
  id: string,
  at: { x: number; y: number },
  netId: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    centerMm: at,
    rotationDeg: 0,
    padType: "smd" as const,
    shape: "rect" as const,
    widthMm: 1,
    heightMm: 1,
    drillMm: null,
    layer: "F.Cu" as const,
    netId,
    solderMaskExpansionMm: 0.075,
    solderPasteExpansionMm: null,
    lockedAt: null,
    ...overrides,
  };
}

const DIFF_NETS = { "R1|1": "na", "R1|2": "nb" };
const SAME_NET = { "R1|1": "na", "R1|2": "na" };

function withBridgeRule(overrides: Partial<PcbBoardSettings> = {}) {
  const b = board60(overrides);
  b.designRules.solderMask = { minBridgeMm: 0.15 };
  return b;
}

describe("the dam matrix (§4)", () => {
  test("different nets, both copper: the design rule and the fab row both fire", () => {
    const report = maskReport(
      { placements: [pairPart(0.08)], padNets: DIFF_NETS },
      withBridgeRule({ fabricator: "jlcpcb_2l" }),
    );
    expect(codes(report)).toEqual(["FAB_MASK_BRIDGE", "MASK_BRIDGE"]);
    const design = report.violations.find((v) => v.code === "MASK_BRIDGE")!;
    expect(design.severity).toBe("error");
    expect(design.measuredMm).toBeCloseTo(0.08, 4);
    expect(design.requiredMm).toBe(0.15);
    expect(design.layer).toBe("F.Cu");
    const fab = report.violations.find((v) => v.code === "FAB_MASK_BRIDGE")!;
    expect(fab.severity).toBe("warning");
    expect(fab.requiredMm).toBe(0.1);
    expect(fab.message).toContain("reduce solderMaskExpansionMm");
  });

  test("SAME net at the same spacing is a sliver, never a bridge", () => {
    const report = maskReport(
      { placements: [pairPart(0.08)], padNets: SAME_NET },
      withBridgeRule({ fabricator: "jlcpcb_2l" }),
    );
    expect(codes(report)).toEqual(["MASK_SLIVER"]);
    expect(report.violations[0]!.requiredMm).toBe(0.15);
  });

  test("a copper-less drill relief beside a pad is a sliver, not a bridge", () => {
    // A non-plated pad whose copper lies inside its own drill has no record:
    // the relief is the only opening, `copper:false` and net-less (§1.3).
    const p = part("R1", [
      pad("1", { x: 0, y: 0 }, 1, 1, {
        shape: "circle",
        plated: false,
        drillDiameterMm: 1.2,
      }),
      // Relief radius 0.675, neighbour opening half-width 0.575: 0.05 apart.
      pad("2", { x: 1.3, y: 0 }, 1, 1),
    ]);
    const report = maskReport(
      { placements: [p], padNets: { "R1|2": "nb" } },
      withBridgeRule({ fabricator: "jlcpcb_2l" }),
    );
    expect(codes(report)).toContain("MASK_SLIVER");
    expect(codes(report)).not.toContain("MASK_BRIDGE");
  });

  test("two OVERLAPPING different-net openings report with measured 0", () => {
    const report = maskReport(
      { placements: [pairPart(-0.05)], padNets: DIFF_NETS },
      withBridgeRule({ fabricator: "jlcpcb_2l" }),
    );
    // Their COPPER is still 0.1 mm apart, so each opening also exposes the
    // other pad — a separate, correct verdict. The dam codes are the subject.
    expect(codes(report)).toContain("MASK_BRIDGE");
    expect(codes(report)).toContain("FAB_MASK_BRIDGE");
    for (const v of report.violations) {
      if (!v.code.includes("BRIDGE")) continue;
      expect(v.measuredMm).toBe(0);
      expect(v.message).toContain("openings merge — no dam");
    }
  });

  test("two overlapping SAME-net openings merge — no dam verdict (#11)", () => {
    const report = maskReport(
      { placements: [pairPart(-0.05)], padNets: SAME_NET },
      withBridgeRule({ fabricator: "jlcpcb_2l" }),
    );
    // One merged window: not a bridge, and not a sliver either.
    expect(codes(report)).not.toContain("MASK_BRIDGE");
    expect(codes(report)).not.toContain("FAB_MASK_BRIDGE");
    expect(codes(report)).not.toContain("MASK_SLIVER");
  });

  test("a NESTED opening (one inside the other) also merges when same-net", () => {
    const p = part("R1", [
      pad("1", { x: 0, y: 0 }, 4, 4),
      pad("2", { x: 0, y: 0 }, 1, 1),
    ]);
    expect(
      codes(
        maskReport(
          { placements: [p], padNets: SAME_NET },
          withBridgeRule({ fabricator: "jlcpcb_2l" }),
        ),
      ),
    ).toEqual([]);
    // Different nets nested is the worst case there is.
    expect(
      codes(
        maskReport(
          { placements: [p], padNets: DIFF_NETS },
          withBridgeRule({ fabricator: "jlcpcb_2l" }),
        ),
      ),
    ).toEqual(["FAB_MASK_BRIDGE", "MASK_BRIDGE"]);
  });

  test("a null net differs from every net, including another null one", () => {
    const report = maskReport(
      { placements: [pairPart(0.08)], padNets: {} },
      withBridgeRule({ fabricator: "jlcpcb_2l" }),
    );
    expect(codes(report)).toEqual(["FAB_MASK_BRIDGE", "MASK_BRIDGE"]);
  });

  test("custom fab with a design rule: the design verdict only", () => {
    expect(
      codes(
        maskReport(
          { placements: [pairPart(0.08)], padNets: DIFF_NETS },
          withBridgeRule({ fabricator: "custom" }),
        ),
      ),
    ).toEqual(["MASK_BRIDGE"]);
  });

  test("no design rule: the fab row only", () => {
    expect(
      codes(
        maskReport(
          { placements: [pairPart(0.08)], padNets: DIFF_NETS },
          board60({ fabricator: "jlcpcb_2l" }),
        ),
      ),
    ).toEqual(["FAB_MASK_BRIDGE"]);
  });

  test("custom fab AND no design rule: no dam verdict exists", () => {
    expect(
      codes(
        maskReport(
          { placements: [pairPart(0.02)], padNets: DIFF_NETS },
          board60({ fabricator: "custom" }),
        ),
      ),
    ).toEqual([]);
  });

  test("a NEGATIVE expansion widens the dam and clears the pair", () => {
    const b = withBridgeRule({ fabricator: "jlcpcb_2l" });
    // Openings 0.08 apart at +0.075; at −0.075 they are 0.38 apart.
    b.solderMaskExpansionMm = -0.075;
    expect(codes(maskReport({ placements: [pairPart(0.08)], padNets: DIFF_NETS }, b))).toEqual(
      [],
    );
  });

  test("openings on opposite faces never pair", () => {
    const top = part("R1", [pad("1", { x: 0, y: 0 }, 1, 1)], {
      positionMm: { x: 0, y: 0 },
    });
    const bottom = part("R2", [pad("1", { x: 0, y: 0 }, 1, 1)], {
      positionMm: { x: 0.6, y: 0 },
      layer: "B.Cu",
    });
    expect(
      codes(
        maskReport(
          { placements: [top, bottom], padNets: { "R1|1": "na", "R2|1": "nb" } },
          withBridgeRule({ fabricator: "jlcpcb_2l" }),
        ),
      ),
    ).toEqual([]);
  });
});

describe("merged components, not pairs (§4, Astra run 2 #3)", () => {
  test("a copper-less relief that CHAINS two different-net pads is a bridge", () => {
    // Every pairwise reading of this board is innocent: each pad/relief pair
    // merges (the relief is copper-less) and the two pads are 0.35 mm apart,
    // clear of the 0.1 mm minimum. The emitted mask is one uninterrupted
    // window from one net to the other.
    const b = board60({ fabricator: "custom" });
    b.designRules.solderMask = { minBridgeMm: 0.1 };
    const report = maskReport(
      {
        freePads: [
          freePad("padA", { x: -0.75, y: 0 }, "n1"),
          freePad("padB", { x: 0.75, y: 0 }, "n2"),
          // 2 x 0.1 NPTH: its 2.15 x 0.25 opening spans both.
          {
            id: "chain",
            centerMm: { x: 0, y: 0 },
            rotationDeg: 0,
            padType: "hole" as const,
            shape: "rect" as const,
            widthMm: 2,
            heightMm: 0.1,
            drillMm: 0.1,
            layer: "F.Cu" as const,
            netId: null,
            solderMaskExpansionMm: 0.075,
            solderPasteExpansionMm: null,
            lockedAt: null,
          },
        ],
      },
      b,
    );
    expect(codes(report)).toContain("MASK_BRIDGE");
    const v = report.violations.find((x) => x.code === "MASK_BRIDGE")!;
    expect(v.measuredMm).toBe(0);
    expect(v.message).toContain("openings merge — no dam");
    // Anchored on the two DIFFERING-NET copper members, not on the relief.
    expect(v.anchors).toEqual([
      { kind: "freePad", freePadId: "padA" },
      { kind: "freePad", freePadId: "padB" },
    ]);
    expect(v.locationMm!.x).toBeCloseTo(0, 6);
  });

  test("two same-net vias inside a thermal pad's window are not a sliver", () => {
    // The 0.05 mm web between the two via openings is INSIDE the pad's own
    // opening on the TOP face: the mask never had it to lose there. The vias
    // are through vias, so the BOTTOM face has the same two openings with no
    // pad over them — and that web is real, which is the next case.
    const b = board60({ fabricator: "custom" });
    b.designRules.solderMask = { minBridgeMm: 0.1 };
    const via = (id: string, x: number): PcbVia => ({
      id,
      netId: "gnd",
      netClassId: "default",
      centerMm: { x, y: 0 },
      diameterMm: 0.3,
      drillMm: 0.15,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
      viaType: "through",
      protection: "none",
      provenance: "route",
    });
    const report = maskReport(
      {
        placements: [part("R1", [pad("1", { x: 0, y: 0 }, 2, 2)])],
        vias: [via("v1", -0.25), via("v2", 0.25)],
        padNets: { "R1|1": "gnd" },
        netNames: { gnd: "GND" },
      },
      b,
    );
    expect(report.violations.filter((v) => v.layer === "F.Cu")).toEqual([]);
    // The bottom face, where nothing merged them, still reports.
    expect(
      report.violations.map((v) => `${v.code}@${v.layer}`),
    ).toEqual(["MASK_SLIVER@B.Cu"]);
  });

  test("the two vias ALONE, with no pad over them, still report the web", () => {
    // The same geometry without the merging pad: the sliver is real again, so
    // the component rule silences nothing it should not.
    const b = board60({ fabricator: "custom" });
    b.designRules.solderMask = { minBridgeMm: 0.1 };
    const via = (id: string, x: number): PcbVia => ({
      id,
      netId: "gnd",
      netClassId: "default",
      centerMm: { x, y: 0 },
      diameterMm: 0.3,
      drillMm: 0.15,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
      viaType: "through",
      protection: "none",
      provenance: "route",
    });
    const report = maskReport(
      { vias: [via("v1", -0.25), via("v2", 0.25)], netNames: { gnd: "GND" } },
      b,
    );
    // Once per face — a through via is untented on both.
    expect(report.violations.map((v) => `${v.code}@${v.layer}`).sort()).toEqual([
      "MASK_SLIVER@B.Cu",
      "MASK_SLIVER@F.Cu",
    ]);
  });
});

describe("the merged-component witness is a total order (§7)", () => {
  test("reversing a multi-shape pin's pads does not move the marker", () => {
    // One PIN with two copper shapes is two openings under ONE anchor — records
    // carry `occurrence`, anchors do not — so an order keyed on `anchorKey`
    // alone falls through to the model index, which reverses with the
    // placement's `pads` array. The canonical order adds the opening's CENTRE
    // for exactly this, and `ringGapToRing` breaks a witness tie by the smaller
    // (x, y) rather than by the operand order.
    const pads = [
      pad("1", { x: 0, y: 0 }, 1, 1),
      pad("1", { x: 0.04, y: 0 }, 1, 1),
      pad("2", { x: 1.15, y: 0 }, 1, 1),
    ];
    const run = (order: typeof pads) =>
      maskReport(
        {
          placements: [part("U1", order)],
          padNets: { "U1|1": "a", "U1|2": "b" },
          netNames: { a: "A", b: "B" },
        },
        board60({ fabricator: "jlcpcb_2l" }),
      ).violations;
    const forward = run(pads);
    expect(forward.length).toBeGreaterThan(0);
    expect(run([...pads].reverse())).toEqual(forward);
  });
});

describe("the flashed opening decides drill coverage (Astra run 2 #2)", () => {
  // A negative expansion SHRINKS the opening. A 1 x 1 pad over a 0.8 drill at
  // −0.2 flashes 0.6 x 0.6 and the drill pokes out by 0.1 per axis; the
  // DECLARED shape says it is covered and the artwork says it is not.
  for (const padType of ["hole", "std", "smd"] as const) {
    test(`a ${padType} pad's shrunken flash still gets its 0.8 relief`, () => {
      const b = board60();
      b.solderMaskExpansionMm = -0.2;
      const ctx = buildDrcContext(
        projection({
          board: b,
          freePads: [
            {
              id: "fp",
              centerMm: { x: 0, y: 0 },
              rotationDeg: 0,
              padType,
              shape: "rect" as const,
              widthMm: 1,
              heightMm: 1,
              drillMm: 0.8,
              layer: "F.Cu" as const,
              netId: null,
              solderMaskExpansionMm: null,
              solderPasteExpansionMm: null,
              lockedAt: null,
            },
          ],
        }),
      );
      // Every face the pad's shape is flashed on carries the relief too, and
      // the relief is never shrunk by the negative expansion.
      const flashedFaces = (["top", "bottom"] as const).filter((face) =>
        ctx
          .maskIndex(face)
          .openings.some((o) => o.shape.kind === "rect"),
      );
      expect(flashedFaces.length).toBeGreaterThanOrEqual(1);
      for (const face of flashedFaces) {
        const shapes = ctx.maskIndex(face).openings.map((o) => o.shape);
        expect(shapes).toContainEqual({ kind: "rect", widthMm: 0.6, heightMm: 0.6 });
        expect(shapes).toContainEqual({ kind: "circle", diameterMm: 0.8 });
      }
      // The far face of an `smd` pad already had its unconditional relief.
      if (padType === "smd") {
        const bottom = ctx.maskIndex("bottom").openings.map((o) => o.shape);
        expect(bottom).toContainEqual({ kind: "circle", diameterMm: 0.8 });
      }
    });
  }
});

describe("FAB_MASK_TO_COPPER (§4)", () => {
  const jlc = () => board60({ fabricator: "jlcpcb_2l" });

  test("a foreign trace inside the row reports; beyond it does not", () => {
    // Opening edge at x = 0.575. A 0.2 trace centred at x has its edge at
    // x − 0.1, so the gap is x − 0.675.
    const at = (x: number) =>
      maskReport(
        {
          placements: [part("R1", [pad("1", { x: 0, y: 0 }, 1, 1)])],
          traces: [trace("t", "nb", [[x, -3], [x, 3]])],
          padNets: { "R1|1": "na" },
        },
        jlc(),
      );
    expect(codes(at(0.73))).toEqual(["FAB_MASK_TO_COPPER"]); // 0.055
    expect(codes(at(0.8))).toEqual([]); // 0.125
  });

  test("net equality is NOT an exemption (Astra run 1 #10)", () => {
    // Same net as the pad, but it never reaches it: still exposed copper.
    const report = maskReport(
      {
        placements: [part("R1", [pad("1", { x: 0, y: 0 }, 1, 1)])],
        traces: [trace("t", "na", [[0.73, -3], [0.73, 3]])],
        padNets: { "R1|1": "na" },
      },
      jlc(),
    );
    expect(codes(report)).toEqual(["FAB_MASK_TO_COPPER"]);
  });

  test("the trace that ENTERS the pad is its own copper — exempt", () => {
    const report = maskReport(
      {
        placements: [part("R1", [pad("1", { x: 0, y: 0 }, 1, 1)])],
        traces: [trace("t", "na", [[0, 0], [5, 0]])],
        padNets: { "R1|1": "na" },
      },
      jlc(),
    );
    expect(codes(report)).toEqual([]);
  });

  test("… and so is a DIFFERENT-net trace that touches the pad", () => {
    // The exemption is geometric, not electrical: touching copper is one piece
    // of metal, however the nets are labelled.
    const report = maskReport(
      {
        placements: [part("R1", [pad("1", { x: 0, y: 0 }, 1, 1)])],
        traces: [trace("t", "nb", [[0, 0], [5, 0]])],
        padNets: { "R1|1": "na" },
      },
      jlc(),
    );
    expect(codes(report)).toEqual([]);
  });

  test("copper CONTAINED in a foreign opening reports with measured 0", () => {
    const via: PcbVia = {
      id: "v1",
      netId: "nb",
      netClassId: "default",
      centerMm: { x: 0.8, y: 0 },
      diameterMm: 0.4,
      drillMm: 0.2,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
      viaType: "through",
      protection: "tented",
      provenance: "route",
    };
    // A 0.5 mm expansion opens 2 x 2 over a 1 x 1 pad, so the via at x = 0.8
    // sits WHOLLY inside the opening while its copper stays 0.1 mm clear of the
    // pad's — contained foreign copper, not the pad's own.
    const wide = jlc();
    wide.solderMaskExpansionMm = 0.5;
    const report = maskReport(
      {
        placements: [part("R1", [pad("1", { x: 0, y: 0 }, 1, 1)])],
        vias: [via],
        padNets: { "R1|1": "na" },
      },
      wide,
    );
    const v = report.violations.find((x) => x.code === "FAB_MASK_TO_COPPER")!;
    expect(v).toBeDefined();
    expect(v.measuredMm).toBe(0);
    expect(v.anchors).toEqual([
      { kind: "pad", placementId: "R1", padNumber: "1" },
      { kind: "via", viaId: "v1" },
    ]);
  });

  test("the via IN the pad touches its owner and is exempt", () => {
    const via: PcbVia = {
      id: "v1",
      netId: "nb",
      netClassId: "default",
      centerMm: { x: 0, y: 0 },
      diameterMm: 0.4,
      drillMm: 0.2,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
      viaType: "through",
      protection: "tented",
      provenance: "route",
    };
    const report = maskReport(
      {
        placements: [part("R1", [pad("1", { x: 0, y: 0 }, 1, 1)])],
        vias: [via],
        padNets: { "R1|1": "na" },
      },
      jlc(),
    );
    expect(codes(report)).toEqual([]);
  });

  test("POUR copper counts, and its own knockout does not (§4)", () => {
    // A foreign-net plane on F.Cu with a pad inside it. The pour clears the pad
    // by `pourToCopper`, so the pad's own opening sits in the knockout and is
    // clean; a plane poured right up to the opening would not be.
    const clean = maskReport(
      {
        placements: [part("R1", [pad("1", { x: 0, y: 0 }, 1, 1)])],
        zones: [
          polygonZoneRow("z", "F.Cu", "gnd", [
            { x: -8, y: -8 },
            { x: 8, y: -8 },
            { x: 8, y: 8 },
            { x: -8, y: 8 },
          ]),
        ],
        padNets: { "R1|1": "na" },
        netNames: { gnd: "GND", na: "NA" },
      },
      jlc(),
    );
    expect(codes(clean)).toEqual([]);

    // Widen the OPENING past the pour's knockout instead of tightening the
    // pour: the knockout is the pad copper inflated by the resolved pour
    // clearance (~0.26 mm here), so a 0.3 mm mask expansion opens 1.6 mm over a
    // 1 mm pad and the plane's edge lands inside the window.
    const tight = board60({ fabricator: "jlcpcb_2l" });
    tight.solderMaskExpansionMm = 0.3;
    const dirty = maskReport(
      {
        placements: [part("R1", [pad("1", { x: 0, y: 0 }, 1, 1)])],
        zones: [
          polygonZoneRow("z", "F.Cu", "gnd", [
            { x: -8, y: -8 },
            { x: 8, y: -8 },
            { x: 8, y: 8 },
            { x: -8, y: 8 },
          ]),
        ],
        padNets: { "R1|1": "na" },
        netNames: { gnd: "GND", na: "NA" },
      },
      tight,
    );
    const v = dirty.violations.find((x) => x.code === "FAB_MASK_TO_COPPER")!;
    expect(v).toBeDefined();
    expect(v.anchors[1]).toEqual({ kind: "zone", zoneId: "z" });
  });

  test("the exemption is LAYER-aware: a far-face relief exempts nothing", () => {
    // A drilled `smd` pad on F.Cu opens its shape on the top face and its DRILL
    // RELIEF on the bottom one (§1.3). That relief's owner is the pad, whose
    // copper is on F.Cu only — so a B.Cu trace running under the relief is
    // foreign copper it exposes, not "the owner's own".
    const drilled = {
      id: "fp",
      centerMm: { x: 0, y: 0 },
      rotationDeg: 0,
      padType: "smd" as const,
      shape: "rect" as const,
      widthMm: 0.9,
      heightMm: 0.9,
      drillMm: 0.8,
      layer: "F.Cu" as const,
      netId: "n1",
      solderMaskExpansionMm: null,
      solderPasteExpansionMm: null,
      lockedAt: null,
    };
    const under = maskReport(
      {
        freePads: [drilled],
        traces: [trace("t", "n2", [[-3, 0], [3, 0]], { layer: "B.Cu" })],
      },
      jlc(),
    );
    const v = under.violations.find((x) => x.code === "FAB_MASK_TO_COPPER")!;
    expect(v).toBeDefined();
    expect(v.layer).toBe("B.Cu");
    expect(v.anchors).toEqual([
      { kind: "freePad", freePadId: "fp" },
      { kind: "trace", traceId: "t" },
    ]);
    // The SAME trace on the pad's own face touches the pad and is exempt.
    const onTop = maskReport(
      {
        freePads: [drilled],
        traces: [trace("t", "n2", [[-3, 0], [3, 0]], { layer: "F.Cu" })],
      },
      jlc(),
    );
    expect(codes(onTop)).toEqual([]);
  });

  test("a drilled free pad's SLOT is relieved on its own flashed face too", () => {
    // R1 minor: the far face already got an unconditional relief, but the face
    // the pad IS on kept mask over its own routed void whenever the declared
    // shape did not cover the drill.
    const slotted = {
      id: "fp",
      centerMm: { x: 0, y: 0 },
      rotationDeg: 30,
      padType: "smd" as const,
      shape: "rect" as const,
      widthMm: 1.2,
      heightMm: 1.2,
      drillMm: 1.0,
      drillSlot: { lengthMm: 3.0, widthMm: 1.0, angleDeg: 30 },
      layer: "F.Cu" as const,
      netId: null,
      solderMaskExpansionMm: null,
      solderPasteExpansionMm: null,
      lockedAt: null,
    };
    const ctx = buildDrcContext(
      projection({ freePads: [slotted], board: board60() }),
    );
    const top = ctx.maskIndex("top").openings.map((o) => o.shape);
    // The declared 1.2 pad inflated by the board's 0.075 …
    const flash = top.find((sh) => sh.kind === "rect")!;
    expect(flash).toBeDefined();
    expect(flash.widthMm).toBeCloseTo(1.35, 9);
    // … AND the 3.0 x 1.0 routed slot inflated the same way, on the slot axis.
    const relief = top.find((sh) => sh.kind === "obround");
    expect(relief, "the flashed face has no drill relief").toBeDefined();
    expect(relief!.widthMm).toBeCloseTo(3.15, 9);
    expect(relief!.heightMm).toBeCloseTo(1.15, 9);
    expect(relief!.rotationDeg).toBe(30);
  });

  test("a fabricator with no row reaches no verdict at all", () => {
    expect(
      codes(
        maskReport(
          {
            placements: [part("R1", [pad("1", { x: 0, y: 0 }, 1, 1)])],
            traces: [trace("t", "nb", [[0.73, -3], [0.73, 3]])],
            padNets: { "R1|1": "na" },
          },
          board60({ fabricator: "pcbway_std" }),
        ),
      ),
    ).toEqual([]);
  });
});
