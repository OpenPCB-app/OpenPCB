/**
 * S13 — the electrical constituents (electrical contract 13).
 *
 * The IPC-2221 conductor spacing is no longer a check of its own: it is a
 * non-relaxable CONSTITUENT of the rule resolver, reported by the pair judge as
 * its own `CREEPAGE_DISTANCE` row beside the ordinary clearance row (§3.3), and
 * inherited by the copper pour (§3.2) and the route-obstacle builder (§3.2 c).
 */
import { describe, expect, test } from "bun:test";
import { buildDrcContext, buildDrcItems } from "../../../shared/drc/drc-context";
import { runDrc } from "../../../shared/drc/drc-engine";
import {
  checkPendingCopper,
  refusedViolations,
} from "../../../shared/drc/legality";
import {
  ipc2221SpacingMm,
  requiredTraceWidthMm,
  spacingColumn,
} from "../../../shared/drc/ipc2221-spacing";
import {
  MAX_COPPER_WEIGHT_OZ,
  MAX_DECLARED_CURRENT_A,
  MAX_DECLARED_VOLTAGE_V,
  MAX_TEMP_RISE_C,
} from "../../../shared/drc/voltage-term";
import {
  pourParamsForZone,
  zonePourNets,
} from "../../../shared/pcb-areas";
import { buildCopperFillIslands } from "../../../shared/rendering/copper-fill/copper-fill-geometry";
import { buildRouteObstacles } from "../../../shared/pcb-routing/route-obstacles";
import { pointInPolygon } from "../../../shared/pcb-geometry/pcb-clearance-geometry";
import type {
  DesignerPcbProjection,
  DrcReport,
  DrcViolation,
  PcbBoardSettings,
  PcbDrcRule,
  PcbNetClass,
  PcbPointMm,
} from "../../../sdks/designer";
import {
  board,
  boardWithRules,
  codes,
  freePad,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

const NM = 1_000_000;

function cls(id: string, extra: Partial<PcbNetClass> = {}): PcbNetClass {
  return {
    id,
    name: id.toUpperCase(),
    traceWidthMm: 0.2,
    clearanceMm: 0.2,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#f00",
    defaultViaProtection: "tented",
    ...extra,
  };
}

const HV230 = cls("hv", { voltageV: 230 });

/** A floor-free board with no fabricator tier, so only the rules speak. */
function hvBoard(opts: {
  netClasses: PcbNetClass[];
  perNetClassAssignments?: Record<string, string>;
  drcRules?: PcbDrcRule[];
  layerCount?: PcbBoardSettings["layerCount"];
  clearance?: Parameters<typeof boardWithRules>[0]["clearance"];
}): PcbBoardSettings {
  return boardWithRules({
    fabricator: "custom",
    ...(opts.clearance ? { clearance: opts.clearance } : {}),
    netClasses: [...board().netClasses, ...opts.netClasses],
    ...(opts.perNetClassAssignments
      ? { perNetClassAssignments: opts.perNetClassAssignments }
      : {}),
    ...(opts.drcRules ? { drcRules: opts.drcRules } : {}),
    ...(opts.layerCount ? { layerCount: opts.layerCount } : {}),
  });
}

/** The board with `electrical` merged in (no fixture helper takes it). */
function withElectrical(
  b: PcbBoardSettings,
  electrical: NonNullable<PcbBoardSettings["designRules"]["electrical"]>,
): PcbBoardSettings {
  return {
    ...b,
    designRules: { ...b.designRules, electrical },
  };
}

function of(report: DrcReport, code: string): DrcViolation[] {
  return report.violations.filter((v) => v.code === code);
}

/** Two parallel F.Cu traces `gapMm` apart edge to edge, 0.2 mm wide. */
function parallelPair(
  b: PcbBoardSettings,
  gapMm: number,
  netB: string | null = "sig",
): DesignerPcbProjection {
  const dy = gapMm + 0.2;
  return projection({
    board: b,
    netNames: { hvn: "HV_RAIL", sig: "SIG", lvn: "LV_RAIL" },
    traces: [
      trace("t_hv", "hvn", [[0, 0], [10, 0]]),
      trace("t_sig", netB, [[0, dy], [10, dy]]),
    ],
  });
}

describe("IPC-2221B Table 6-1 (§6.2)", () => {
  test("the three columns at the pinned band values", () => {
    expect(ipc2221SpacingMm(10, "B2")).toBe(0.1);
    expect(ipc2221SpacingMm(10, "B1")).toBe(0.05);
    expect(ipc2221SpacingMm(10, "B4")).toBe(0.05);
    expect(ipc2221SpacingMm(230, "B2")).toBe(1.25);
    expect(ipc2221SpacingMm(230, "B1")).toBe(0.2);
    expect(ipc2221SpacingMm(230, "B4")).toBe(0.4);
    expect(ipc2221SpacingMm(400, "B2")).toBe(2.5);
  });

  test("bands are stepped, never interpolated (`Δ <= maxV`)", () => {
    // 15.5 V falls in the 16–30 row, which carries the same 0.1 mm as 0–15;
    // 30.5 V falls in 31–50, which steps straight to 0.6 mm.
    expect(ipc2221SpacingMm(15, "B2")).toBe(0.1);
    expect(ipc2221SpacingMm(15.5, "B2")).toBe(0.1);
    expect(ipc2221SpacingMm(30, "B2")).toBe(0.1);
    expect(ipc2221SpacingMm(30.5, "B2")).toBe(0.6);
  });

  test("above 500 V is the 500 V value plus the slope times the excess", () => {
    // Distinguishable from `slope × V` only in B1 and B4 (§6.2): at 600 V the
    // alternative reading would give 1.5 mm in B1, not 0.5.
    expect(ipc2221SpacingMm(600, "B1")).toBeCloseTo(0.5, 12);
    expect(ipc2221SpacingMm(600, "B4")).toBeCloseTo(0.8 + 0.00305 * 100, 12);
    expect(ipc2221SpacingMm(1000, "B2")).toBeCloseTo(5, 12);
    expect(ipc2221SpacingMm(1000, "B1")).toBeCloseTo(1.5, 12);
  });

  test("B2 dominates B1 and B4 in every band (the `clearanceBound` claim)", () => {
    for (const v of [0, 15, 30, 50, 100, 150, 170, 250, 300, 500, 600, 1000]) {
      expect(ipc2221SpacingMm(v, "B2")).toBeGreaterThanOrEqual(
        ipc2221SpacingMm(v, "B1"),
      );
      expect(ipc2221SpacingMm(v, "B2")).toBeGreaterThanOrEqual(
        ipc2221SpacingMm(v, "B4"),
      );
    }
  });

  test("a non-finite or negative differential THROWS (§2, Astra run 1 #12)", () => {
    expect(() => ipc2221SpacingMm(NaN, "B2")).toThrow();
    expect(() => ipc2221SpacingMm(-230, "B2")).toThrow();
  });

  test("the column follows the layer, the coating and the exposure (§1.2)", () => {
    expect(spacingColumn("In1.Cu", { coated: true, exposed: false })).toBe("B1");
    expect(spacingColumn("F.Cu", { coated: false, exposed: false })).toBe("B2");
    expect(spacingColumn("F.Cu", { coated: true, exposed: false })).toBe("B4");
    // An exposed conductor is an uncoated one whatever the board declares.
    expect(spacingColumn("F.Cu", { coated: true, exposed: true })).toBe("B2");
  });

  test("a non-positive current, rise or weight THROWS (§5, Astra run 1 #9)", () => {
    expect(() => requiredTraceWidthMm(1, 0, 1, false)).toThrow();
    expect(() => requiredTraceWidthMm(1, 10, 0, false)).toThrow();
    expect(() => requiredTraceWidthMm(0, 10, 1, false)).toThrow();
    expect(requiredTraceWidthMm(1, 10, 1, false)).toBeGreaterThan(0.2);
  });
});

describe("the two constituents are independent rows (§3.3)", () => {
  test("a pair below BOTH yields both rows, with independent ids", () => {
    // 0.15 mm gap: below the 0.25 mm ordinary tier AND below 1.25 mm.
    const p = parallelPair(
      hvBoard({ netClasses: [HV230], perNetClassAssignments: { hvn: "hv" } }),
      0.15,
    );
    const report = runDrc(p);
    const clearance = of(report, "TRACE_TO_TRACE_CLEARANCE");
    const creepage = of(report, "CREEPAGE_DISTANCE");
    expect(clearance).toHaveLength(1);
    expect(creepage).toHaveLength(1);
    expect(clearance[0]!.id).not.toBe(creepage[0]!.id);
    expect(clearance[0]!.requiredMm).toBeCloseTo(0.25, 9);
    expect(creepage[0]!.requiredMm).toBeCloseTo(1.25, 9);
  });

  test("waiving one row leaves the other reason standing", () => {
    const p = parallelPair(
      hvBoard({ netClasses: [HV230], perNetClassAssignments: { hvn: "hv" } }),
      0.15,
    );
    const base = runDrc(p);
    const clearanceId = of(base, "TRACE_TO_TRACE_CLEARANCE")[0]!.id;
    const creepageId = of(base, "CREEPAGE_DISTANCE")[0]!.id;

    const waivedClearance = runDrc(p, { waivedIds: [clearanceId] });
    expect(of(waivedClearance, "TRACE_TO_TRACE_CLEARANCE")[0]!.waived).toBe(true);
    expect(of(waivedClearance, "CREEPAGE_DISTANCE")[0]!.waived).toBeUndefined();

    const waivedCreepage = runDrc(p, { waivedIds: [creepageId] });
    expect(of(waivedCreepage, "CREEPAGE_DISTANCE")[0]!.waived).toBe(true);
    expect(
      of(waivedCreepage, "TRACE_TO_TRACE_CLEARANCE")[0]!.waived,
    ).toBeUndefined();
  });

  test("a pair below only the voltage term yields only CREEPAGE_DISTANCE", () => {
    // 0.5 mm: clears the 0.25 mm ordinary tier, well under 1.25 mm.
    const report = runDrc(
      parallelPair(
        hvBoard({ netClasses: [HV230], perNetClassAssignments: { hvn: "hv" } }),
        0.5,
      ),
    );
    expect(codes(report)).toContain("CREEPAGE_DISTANCE");
    expect(codes(report)).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("an explicit scoped rule can never relax below the table (§3.1)", () => {
    const relax: PcbDrcRule = {
      id: "loose",
      name: "Loose",
      enabled: true,
      priority: 10,
      scopes: [{ kind: "net", netIds: ["hvn"] }],
      constraint: { kind: "clearance", mm: 0.05 },
    };
    const report = runDrc(
      parallelPair(
        hvBoard({
          netClasses: [HV230],
          perNetClassAssignments: { hvn: "hv" },
          drcRules: [relax],
        }),
        0.15,
      ),
    );
    // The ordinary row is gone (0.15 > 0.05), the IPC row is not.
    expect(codes(report)).not.toContain("TRACE_TO_TRACE_CLEARANCE");
    const creepage = of(report, "CREEPAGE_DISTANCE");
    expect(creepage).toHaveLength(1);
    expect(creepage[0]!.requiredMm).toBeCloseTo(1.25, 9);
  });

  test("a same-net HV pair carries no constituent at all (§2)", () => {
    const report = runDrc(
      projection({
        board: hvBoard({
          netClasses: [HV230],
          perNetClassAssignments: { hvn: "hv" },
        }),
        netNames: { hvn: "HV_RAIL" },
        traces: [
          trace("t1", "hvn", [[0, 0], [10, 0]]),
          trace("t2", "hvn", [[0, 0.35], [10, 0.35]]),
        ],
      }),
    );
    expect(codes(report)).not.toContain("CREEPAGE_DISTANCE");
  });
});

describe("intra-footprint pads (§3.3)", () => {
  /** Two 1 mm pads of ONE placement, 0.4 mm apart, at 230 V and 0 V. */
  function oneFootprint(shape: "rect" | "custom"): DesignerPcbProjection {
    return projection({
      board: hvBoard({
        netClasses: [HV230],
        perNetClassAssignments: { hvn: "hv" },
      }),
      netNames: { hvn: "HV_RAIL", sig: "SIG" },
      placements: [
        placement("U1", {
          positionMm: { x: 0, y: 0 },
          pads: [
            pad("1", { x: 0, y: 0 }, 1, 1, { shape }),
            pad("2", { x: 1.4, y: 0 }, 1, 1, { shape }),
          ],
        }),
      ],
      padNets: { "U1|1": "hvn", "U1|2": "sig" },
    });
  }

  test("exact pads: the voltage row only — the library owns the geometry", () => {
    const report = runDrc(oneFootprint("rect"));
    expect(of(report, "CREEPAGE_DISTANCE")).toHaveLength(1);
    expect(of(report, "PAD_TO_PAD_CLEARANCE")).toHaveLength(0);
    expect(of(report, "FAB_CLEARANCE")).toHaveLength(0);
  });

  test("a `custom` pad still gets the voltage row, on its bounding rect", () => {
    // The inexact-shape guard drops the short / clearance / fab tiers (R1 #4)
    // but the declared superset supports a spacing verdict (false-fail).
    const report = runDrc(oneFootprint("custom"));
    expect(of(report, "CREEPAGE_DISTANCE")).toHaveLength(1);
    expect(of(report, "PAD_TO_PAD_CLEARANCE")).toHaveLength(0);
    expect(of(report, "NET_SHORT_CIRCUIT")).toHaveLength(0);
  });
});

describe("the voltage model (§2)", () => {
  test("an interval on TWO DISTINCT nets of one class gives Δ = 600 V", () => {
    // Astra run 1 #1: class membership never establishes correlation.
    const bipolar = cls("ac", { voltageMinV: -300, voltageMaxV: 300 });
    const report = runDrc(
      projection({
        board: hvBoard({
          netClasses: [bipolar],
          perNetClassAssignments: { n1: "ac", n2: "ac" },
        }),
        netNames: { n1: "AC1", n2: "AC2" },
        traces: [
          trace("t1", "n1", [[0, 0], [10, 0]]),
          trace("t2", "n2", [[0, 3], [10, 3]]),
        ],
      }),
    );
    const creepage = of(report, "CREEPAGE_DISTANCE");
    expect(creepage).toHaveLength(1);
    // 600 V, B2: 2.5 + 0.005·100 = 3 mm.
    expect(creepage[0]!.requiredMm).toBeCloseTo(ipc2221SpacingMm(600, "B2"), 9);
    expect(creepage[0]!.message).toContain("600 V");
  });

  test("an interval against an UNDECLARED net gives Δ = 400 V", () => {
    const bipolar = cls("ac", { voltageMinV: -400, voltageMaxV: 400 });
    const report = runDrc(
      parallelPair(
        hvBoard({ netClasses: [bipolar], perNetClassAssignments: { hvn: "ac" } }),
        0.5,
      ),
    );
    const creepage = of(report, "CREEPAGE_DISTANCE");
    expect(creepage).toHaveLength(1);
    expect(creepage[0]!.requiredMm).toBeCloseTo(ipc2221SpacingMm(400, "B2"), 9);
  });

  test("Δ is rounded to 1 µV before the band is chosen (Astra run 1 #10)", () => {
    // −9.95 − (−39.95) = 30.000000000000004 in floats; the decimals name 30,
    // which is the 16–30 band (0.1 mm B2), not the 31–50 one (0.6 mm).
    expect(-9.95 - -39.95).toBeGreaterThan(30);
    const report = runDrc(
      parallelPair(
        hvBoard({
          netClasses: [cls("a", { voltageV: -9.95 }), cls("b", { voltageV: -39.95 })],
          perNetClassAssignments: { hvn: "a", sig: "b" },
        }),
        0.05,
      ),
    );
    const creepage = of(report, "CREEPAGE_DISTANCE");
    expect(creepage).toHaveLength(1);
    expect(creepage[0]!.requiredMm).toBeCloseTo(0.1, 12);
  });

  test("600 V on an INNER layer takes the B1 column", () => {
    const report = runDrc(
      projection({
        board: hvBoard({
          layerCount: 4,
          netClasses: [cls("hv600", { voltageV: 600 })],
          perNetClassAssignments: { hvn: "hv600" },
        }),
        netNames: { hvn: "HV_RAIL", sig: "SIG" },
        traces: [
          trace("t1", "hvn", [[0, 0], [10, 0]], { layer: "In1.Cu" }),
          trace("t2", "sig", [[0, 0.45], [10, 0.45]], { layer: "In1.Cu" }),
        ],
      }),
    );
    const creepage = of(report, "CREEPAGE_DISTANCE");
    expect(creepage).toHaveLength(1);
    expect(creepage[0]!.requiredMm).toBeCloseTo(0.5, 12);
    expect(creepage[0]!.message).toContain("(B1)");
  });

  test("a NaN voltage is REPORTED and never assessed (Astra run 1 #12)", () => {
    const p = parallelPair(
      hvBoard({
        netClasses: [cls("bad", { voltageV: NaN })],
        perNetClassAssignments: { hvn: "bad" },
      }),
      0.5,
    );
    const report = runDrc(p);
    const invalid = of(report, "DRC_RULE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.message).toContain("voltageV");
    expect(codes(report)).not.toContain("CREEPAGE_DISTANCE");
    // …and the halo stays infinite: a full scan is correct, only slow (§3.4).
    expect(buildDrcItems(p).maxCreepageBoundMm).toBe(Infinity);
    expect(buildDrcItems(p).maxClearanceBoundMm).toBe(Infinity);
  });

  test("an endpoint past the declared-voltage limit is reported, never thrown", () => {
    // `asNumber` in the store accepts any finite double, and two endpoints near
    // MAX_VALUE overflow `|a.min − b.max|` to Infinity, which the table refuses.
    // The class is malformed data: reported, and judged by nobody.
    const p = parallelPair(
      hvBoard({
        netClasses: [
          cls("huge", { voltageMinV: -1e308, voltageMaxV: 1e308 }),
          cls("alsohuge", { voltageV: 1e308 }),
        ],
        perNetClassAssignments: { hvn: "huge", sig: "alsohuge" },
      }),
      0.5,
    );
    const report = runDrc(p);
    const invalid = of(report, "DRC_RULE_INVALID");
    expect(invalid).toHaveLength(3); // two endpoints + the constant potential
    expect(invalid.map((v) => v.message).join(" ")).toContain(
      `past the ${MAX_DECLARED_VOLTAGE_V} V limit`,
    );
    expect(codes(report)).not.toContain("CREEPAGE_DISTANCE");

    // …and none of the three consumers of the term throws on that board.
    const ctx = buildDrcItems(p);
    expect(() =>
      ctx.resolver.clearanceBound("traceToTrace", "hvn", "sig"),
    ).not.toThrow();
    expect(() =>
      ctx.resolver.maxVoltageTermMm("F.Cu", "hvn", true),
    ).not.toThrow();
    expect(() =>
      checkPendingCopper(ctx, {
        traces: [trace("pt", "sig", [[0, 5], [10, 5]])],
        vias: [],
      }),
    ).not.toThrow();
    expect(Number.isFinite(ctx.maxCreepageBoundMm)).toBe(true);
  });

  test("one malformed endpoint does not claim the whole class is unassessed", () => {
    // The class keeps a valid `voltageV`, so the per-FIELD problem must say the
    // endpoint is ignored — not that nets of the class carry no requirement.
    const report = runDrc(
      parallelPair(
        hvBoard({
          netClasses: [cls("half", { voltageV: 230, voltageMaxV: NaN })],
          perNetClassAssignments: { hvn: "half" },
        }),
        0.5,
      ),
    );
    const invalid = of(report, "DRC_RULE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.message).toContain("voltageMaxV");
    expect(invalid[0]!.message).toContain("judged at 230 … 230 V instead");
    expect(invalid[0]!.message).not.toContain("no IPC-2221 spacing requirement");
    // …and the class IS judged at 230 V.
    const creepage = of(report, "CREEPAGE_DISTANCE");
    expect(creepage).toHaveLength(1);
    expect(creepage[0]!.requiredMm).toBeCloseTo(1.25, 9);
  });

  test("a bad VOLTAGE keeps the class's current verdict (§5)", () => {
    // The skip is scoped to the current inputs: a malformed voltage endpoint
    // costs the class its spacing constituent, nothing else.
    const report = runDrc(
      projection({
        board: hvBoard({
          netClasses: [cls("hc", { currentA: 3, voltageV: Infinity })],
          perNetClassAssignments: { p: "hc" },
        }),
        netNames: { p: "PWR" },
        traces: [trace("t", "p", [[0, 0], [10, 0]])],
      }),
    );
    const invalid = of(report, "DRC_RULE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.message).toContain("voltageV");
    expect(codes(report)).toContain("TRACE_CURRENT_WIDTH");
  });

  test("an INVERTED interval is reported and drops the class's term", () => {
    const report = runDrc(
      parallelPair(
        hvBoard({
          netClasses: [cls("bad", { voltageMinV: 300, voltageMaxV: -300 })],
          perNetClassAssignments: { hvn: "bad" },
        }),
        0.5,
      ),
    );
    const invalid = of(report, "DRC_RULE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.message).toContain("no IPC-2221 spacing requirement");
    expect(codes(report)).not.toContain("CREEPAGE_DISTANCE");
  });
});

describe("the comparison regime is the clearance one (§3.5)", () => {
  /** `clearanceViolated(gap, required) = gap < required − 5e-7`. */
  function creepageAt(gapMm: number): boolean {
    const report = runDrc(
      parallelPair(
        hvBoard({ netClasses: [HV230], perNetClassAssignments: { hvn: "hv" } }),
        gapMm,
      ),
    );
    return codes(report).includes("CREEPAGE_DISTANCE");
  }

  test("the voltage constituent flips at required − 5e-7", () => {
    expect(creepageAt(1.25 - 5e-7 - 1e-9)).toBe(true);
    expect(creepageAt(1.25 - 5e-7 + 1e-9)).toBe(false);
  });

  test("the ordinary constituent keeps the same regime", () => {
    const at = (gapMm: number): boolean =>
      codes(
        runDrc(
          parallelPair(
            hvBoard({ netClasses: [], clearance: { traceToTraceMm: 0.3 } }),
            gapMm,
            "sig2",
          ),
        ),
      ).includes("TRACE_TO_TRACE_CLEARANCE");
    expect(at(0.3 - 5e-7 - 1e-9)).toBe(true);
    expect(at(0.3 - 5e-7 + 1e-9)).toBe(false);
  });
});

describe("exposure and the B4 column (§1.2)", () => {
  const coatedBoard = (): PcbBoardSettings =>
    withElectrical(
      hvBoard({ netClasses: [HV230], perNetClassAssignments: { hvn: "hv" } }),
      { outerConductors: "coated" },
    );

  test("a covered trace pair on a coated board takes B4 (0.4 mm at 230 V)", () => {
    // No pads, no untented vias — nothing opens the mask over these traces.
    const report = runDrc(parallelPair(coatedBoard(), 0.3));
    const creepage = of(report, "CREEPAGE_DISTANCE");
    expect(creepage).toHaveLength(1);
    expect(creepage[0]!.requiredMm).toBeCloseTo(0.4, 9);
    expect(creepage[0]!.message).toContain("B4, coated per design rule");
    // …and 0.5 mm clears B4 while it would still breach B2.
    expect(codes(runDrc(parallelPair(coatedBoard(), 0.5)))).not.toContain(
      "CREEPAGE_DISTANCE",
    );
  });

  test("a PAD pair is exposed by its own openings, so it stays in B2", () => {
    const report = runDrc(
      projection({
        board: coatedBoard(),
        netNames: { hvn: "HV_RAIL", sig: "SIG" },
        freePads: [
          freePad("fp1", { center: { x: 0, y: 0 }, netId: "hvn" }),
          freePad("fp2", { center: { x: 1.5, y: 0 }, netId: "sig" }),
        ],
      }),
    );
    const creepage = of(report, "CREEPAGE_DISTANCE");
    expect(creepage).toHaveLength(1);
    expect(creepage[0]!.requiredMm).toBeCloseTo(1.25, 9);
    // The DECISION, not just the column: B4 was available and exposure took it
    // away (§7).
    expect(creepage[0]!.message).toContain("(B2, exposed conductor)");
  });

  test("a TENTED via a neighbouring pad's opening reaches is exposed too", () => {
    // Astra run 1 #4: tenting says the via contributes no opening, never that
    // no other opening covers it. The pad's own opening (1 mm pad + 0.05 mm
    // expansion per side) reaches x = 0.55, past the via's copper at x >= 0.5.
    const p = projection({
      board: coatedBoard(),
      netNames: { hvn: "HV_RAIL", sig: "SIG" },
      freePads: [freePad("fp1", { center: { x: 0, y: 0 }, netId: "sig" })],
      vias: [
        {
          ...via("v1", { netId: "hvn", center: { x: 0.9, y: 0 }, diameterMm: 0.8 }),
          protection: "tented",
        },
      ],
    });
    const creepage = of(runDrc(p), "CREEPAGE_DISTANCE");
    expect(creepage).toHaveLength(1);
    expect(creepage[0]!.requiredMm).toBeCloseTo(1.25, 9);
    // The context agrees per item: the via is exposed on F.Cu.
    const ctx = buildDrcContext(p);
    expect(ctx.exposedOn(ctx.vias[0]!, "F.Cu")).toBe(true);
    expect(ctx.exposedOn(ctx.vias[0]!, "In1.Cu")).toBe(false);
  });

  test("a PENDING untented via that uncovers an existing trace re-judges it", () => {
    // Astra run 1 #5 / §4.4: exposure is a property of the FINAL artwork. The
    // board's two traces sit 0.5 mm apart — legal in B4 (0.4 mm at 230 V) while
    // the mask covers them. A pending untented via on the HV trace's own net
    // opens the mask over it, which makes the PAIR an uncoated one (B2,
    // 1.25 mm), and the gate must report that against the route.
    const p = parallelPair(coatedBoard(), 0.5);
    expect(codes(runDrc(p))).not.toContain("CREEPAGE_DISTANCE");

    const ctx = buildDrcItems(p);
    const pendingVia = {
      ...via("pv", {
        netId: "hvn",
        center: { x: 5, y: -0.6 },
        diameterMm: 1,
      }),
      protection: "none" as const,
    };
    const live = checkPendingCopper(ctx, { traces: [], vias: [pendingVia] });
    const onTracePair = live.filter(
      (v) =>
        v.code === "CREEPAGE_DISTANCE" &&
        v.anchors.every((a) => a.kind === "trace"),
    );
    expect(onTracePair).toHaveLength(1);
    expect(onTracePair[0]!.requiredMm).toBeCloseTo(1.25, 9);

    // …and BATCH on the committed geometry says the same thing (07 §1 clause 1).
    const committed = runDrc({ ...p, vias: [pendingVia] });
    expect(
      of(committed, "CREEPAGE_DISTANCE").filter((v) =>
        v.anchors.every((a) => a.kind === "trace"),
      ),
    ).toHaveLength(1);
  });

  test("an uncoated board never computes exposure at all", () => {
    const p = parallelPair(
      hvBoard({ netClasses: [HV230], perNetClassAssignments: { hvn: "hv" } }),
      0.3,
    );
    const ctx = buildDrcContext(p);
    expect(ctx.exposedOn(ctx.traces[0]!, "F.Cu")).toBe(false);
  });
});

describe("the current verdict (§5)", () => {
  const HC = cls("hc", { currentA: 3 });

  test("a 3 A net routed at 0.3 mm is too narrow", () => {
    const report = runDrc(
      projection({
        board: hvBoard({ netClasses: [HC], perNetClassAssignments: { p: "hc" } }),
        netNames: { p: "PWR" },
        traces: [trace("t", "p", [[0, 0], [10, 0]], { widthMm: 0.3 })],
      }),
    );
    expect(codes(report)).toContain("TRACE_CURRENT_WIDTH");
  });

  test("a zero temperature rise is reported, and NO trace is judged", () => {
    // Astra run 1 #9: the pre-S13 helper answered 0 mm, which every trace passed.
    const report = runDrc(
      projection({
        board: withElectrical(
          hvBoard({ netClasses: [HC], perNetClassAssignments: { p: "hc" } }),
          { tempRiseC: 0, copperWeightOz: 1 },
        ),
        netNames: { p: "PWR" },
        traces: [trace("t", "p", [[0, 0], [10, 0]], { widthMm: 0.3 })],
      }),
    );
    const invalid = of(report, "DRC_RULE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.message).toContain("tempRiseC");
    expect(codes(report)).not.toContain("TRACE_CURRENT_WIDTH");
  });

  test("a non-positive class current is reported, and that class is not judged", () => {
    const report = runDrc(
      projection({
        board: hvBoard({
          netClasses: [cls("hc", { currentA: 0 })],
          perNetClassAssignments: { p: "hc" },
        }),
        netNames: { p: "PWR" },
        traces: [trace("t", "p", [[0, 0], [10, 0]], { widthMm: 0.3 })],
      }),
    );
    const invalid = of(report, "DRC_RULE_INVALID");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.message).toContain("currentA");
    expect(codes(report)).not.toContain("TRACE_CURRENT_WIDTH");
  });

  test("finite but absurd inputs are reported, never silently passed", () => {
    // Astra run 2: 1e225 A on 1.7e308 oz overflowed the area AND the thickness,
    // so the quotient was `NaN` and `below()` read it as "not narrower" — a
    // silent pass on a trace whose true requirement is ≈ 39 mm.
    const board = withElectrical(
      hvBoard({
        netClasses: [cls("hc", { currentA: 1e225 })],
        perNetClassAssignments: { p: "hc" },
      }),
      { tempRiseC: 10, copperWeightOz: 1.7e308 },
    );
    const names = { p: "PWR" };
    const pending = trace("pending:0", "p", [
      [0, 0],
      [10, 0],
    ]);
    const report = runDrc(
      projection({ board, netNames: names, traces: [pending] }),
    );
    const invalid = of(report, "DRC_RULE_INVALID").map((v) => v.message);
    expect(invalid).toHaveLength(2);
    expect(invalid.some((m) => m.includes("currentA"))).toBe(true);
    expect(invalid.some((m) => m.includes("copperWeightOz"))).toBe(true);
    expect(codes(report)).not.toContain("TRACE_CURRENT_WIDTH");

    // The live gate answers the same way, and neither path throws.
    const ctx = buildDrcItems(projection({ board, netNames: names }));
    const live = checkPendingCopper(ctx, { traces: [pending], vias: [] });
    expect(live.some((v) => v.code === "TRACE_CURRENT_WIDTH")).toBe(false);
  });

  test("a declaration AT the magnitude caps is still judged", () => {
    const report = runDrc(
      projection({
        board: withElectrical(
          hvBoard({
            netClasses: [cls("hc", { currentA: MAX_DECLARED_CURRENT_A })],
            perNetClassAssignments: { p: "hc" },
          }),
          {
            tempRiseC: MAX_TEMP_RISE_C,
            copperWeightOz: MAX_COPPER_WEIGHT_OZ,
          },
        ),
        netNames: { p: "PWR" },
        traces: [trace("t", "p", [[0, 0], [10, 0]])],
      }),
    );
    expect(of(report, "DRC_RULE_INVALID")).toHaveLength(0);
    const row = of(report, "TRACE_CURRENT_WIDTH");
    expect(row).toHaveLength(1);
    expect(Number.isFinite(row[0]!.requiredMm)).toBe(true);
  });

  test("an inner layer is judged at the inner copper weight", () => {
    const report = runDrc(
      projection({
        board: withElectrical(
          hvBoard({
            netClasses: [HC],
            perNetClassAssignments: { p: "hc" },
            layerCount: 4,
          }),
          { copperWeightOz: 1, innerCopperWeightOz: 0.5 },
        ),
        netNames: { p: "PWR" },
        traces: [
          trace("t_outer", "p", [[0, 0], [10, 0]]),
          trace("t_inner", "p", [[0, 5], [10, 5]], { layer: "In1.Cu" }),
        ],
      }),
    );
    const rows = of(report, "TRACE_CURRENT_WIDTH");
    const inner = rows.find((v) => v.layer === "In1.Cu")!;
    const outer = rows.find((v) => v.layer === "F.Cu")!;
    // Half the copper for the same current: the internal constant alone would
    // not explain the inner requirement being the wider of the two.
    expect(inner.requiredMm!).toBeGreaterThan(outer.requiredMm!);
    expect(inner.message).toContain("0.5 oz inner copper");
    expect(outer.message).toContain("1 oz outer copper");
  });

  test("a null trace extending a 3 A net is judged as that net (§4.2)", () => {
    const report = runDrc(
      projection({
        board: hvBoard({ netClasses: [HC], perNetClassAssignments: { p: "hc" } }),
        netNames: { p: "PWR" },
        traces: [
          trace("t_p", "p", [[0, 0], [10, 0]], { widthMm: 0.3 }),
          trace("t_null", null, [[10, 0], [20, 0]], { widthMm: 0.3 }),
        ],
      }),
    );
    const anchored = of(report, "TRACE_CURRENT_WIDTH")
      .flatMap((v) => v.anchors)
      .map((a) => (a.kind === "trace" ? a.traceId : a.kind))
      .sort();
    expect(anchored).toEqual(["t_null", "t_p"]);
  });
});

describe("the live gate (§3.6)", () => {
  const HC = cls("hc", { currentA: 3 });

  /** A committed 0 V, 0.2 mm trace along y = 0 to judge pending copper against. */
  function gateCtx(netClasses: PcbNetClass[], assign: Record<string, string>) {
    return buildDrcItems(
      projection({
        board: hvBoard({ netClasses, perNetClassAssignments: assign }),
        netNames: { hvn: "HV_RAIL", sig: "SIG", p: "PWR" },
        traces: [trace("t_board", "sig", [[0, 0], [10, 0]])],
      }),
    );
  }

  test("a pending 3 A trace warns and is NOT refused", () => {
    const ctx = gateCtx([HC], { p: "hc" });
    const violations = checkPendingCopper(ctx, {
      traces: [trace("pending:0", "p", [[0, 5], [10, 5]], { widthMm: 0.3 })],
      vias: [],
    });
    const row = violations.find((v) => v.code === "TRACE_CURRENT_WIDTH")!;
    expect(row.severity).toBe("warning");
    expect(refusedViolations(ctx, violations)).toHaveLength(0);
  });

  test("a pending 230 V trace 0.3 mm from a 0 V trace IS refused", () => {
    const ctx = gateCtx([HV230], { hvn: "hv" });
    const pending = {
      traces: [trace("pending:0", "hvn", [[0, 0.5], [10, 0.5]])],
      vias: [],
    };
    const refusedCodes = refusedViolations(
      ctx,
      checkPendingCopper(ctx, pending),
    ).map((v) => v.code);
    expect(refusedCodes).toContain("CREEPAGE_DISTANCE");

    // A downgrade is a severity, not a suppression: the refuse set is a code
    // allow-list, so the gate still blocks the commit (§3.6).
    const downgraded = checkPendingCopper(ctx, pending, {
      severityOverrides: { CREEPAGE_DISTANCE: "warning" },
    });
    expect(
      downgraded.find((v) => v.code === "CREEPAGE_DISTANCE")!.severity,
    ).toBe("warning");
    expect(refusedViolations(ctx, downgraded).map((v) => v.code)).toContain(
      "CREEPAGE_DISTANCE",
    );
  });
});

describe("the pour inherits the term (§3.2)", () => {
  /** The F.Cu board zone of `proj`, filled through the ONE kernel. */
  function fillBoardZone(proj: DesignerPcbProjection) {
    const ctx = buildDrcContext(proj);
    const zone = ctx.copperZones.find((z) => z.id === "board:F.Cu")!;
    return buildCopperFillIslands({
      layerCount: proj.board.layerCount,
      outline: proj.board.outline,
      placements: proj.placements,
      traces: proj.traces,
      vias: proj.vias,
      padNetIds: new Map(Object.entries(proj.padNets ?? {})),
      copperToBoardEdgeMm: proj.board.designRules.clearance.copperToBoardEdgeMm,
      cutouts: proj.board.cutouts,
      freeHoles: proj.freeHoles,
      freePads: proj.freePads,
      ...pourParamsForZone(
        zone,
        proj.board.designRules,
        ctx.keepouts,
        ctx.copperZones,
        zonePourNets(proj.board, ctx.netNames),
      ),
    });
  }

  /** Smallest distance from any poured vertex to `pointMm`. */
  function gapToPoint(proj: DesignerPcbProjection, pointMm: PcbPointMm): number {
    const fill = fillBoardZone(proj);
    if (fill.status !== "ok") throw new Error("pour failed");
    let min = Infinity;
    for (const island of fill.islands) {
      for (const ring of island.rings) {
        for (const p of ring) {
          min = Math.min(min, Math.hypot(p.x - pointMm.x, p.y - pointMm.y));
        }
      }
    }
    return min;
  }

  /** Is `pointMm` inside the poured copper (outer ring, outside every hole)? */
  function pourCovers(proj: DesignerPcbProjection, pointMm: PcbPointMm): boolean {
    const fill = fillBoardZone(proj);
    if (fill.status !== "ok") throw new Error("pour failed");
    return fill.islands.some((island) => {
      const [outer, ...holes] = island.rings;
      if (!outer || !pointInPolygon(pointMm, outer)) return false;
      return !holes.some((h) => pointInPolygon(pointMm, h));
    });
  }

  /** The persisted board-zone ROW every consumer's pour is derived from. */
  function boardZone(netId: string | null) {
    return {
      id: "board:F.Cu",
      name: null,
      enabled: true,
      lockedAt: null,
      layer: "F.Cu" as const,
      netId,
      netName: null,
      region: { kind: "board" as const },
      priority: 0,
      padConnection: "solid" as const,
    };
  }

  /** `gnd` is the 230 V class; `sig` and `hvn` below are explicit per test. */
  function zonedBoard(): PcbBoardSettings {
    return hvBoard({
      netClasses: [HV230],
      perNetClassAssignments: { gnd: "hv" },
    });
  }

  test("an HV zone carves a 0 V trace at the IPC spacing", () => {
    // The zone is on `gnd`, classed HV (230 V); the trace is undeclared (0 V).
    const proj = projection({
      board: zonedBoard(),
      zones: [boardZone("gnd")],
      netNames: { gnd: "GND", sig: "SIG" },
      traces: [trace("t", "sig", [[-10, 0], [10, 0]])],
    });
    // 1.25 mm to the trace CENTRELINE plus its 0.1 mm half width.
    expect(gapToPoint(proj, { x: 0, y: 0 })).toBeGreaterThanOrEqual(1.35 - 1e-6);
  });

  test("a same-net HV zone does not moat itself (§2)", () => {
    const proj = projection({
      board: zonedBoard(),
      zones: [boardZone("gnd")],
      netNames: { gnd: "GND" },
      traces: [trace("t", "gnd", [[-10, 0], [10, 0]])],
    });
    // Same net: the trace merges into the plane — no moat, so the pour COVERS
    // the trace's own centreline instead of standing 1.35 mm off it.
    expect(pourCovers(proj, { x: 0, y: 0 })).toBe(true);
  });

  test("two zones at 230 V apart carve each other in B2, coated or not", () => {
    // The zone<->zone exclusion carries the SAME conservative exposure every
    // obstacle does (§3.2): the fill has no mask model either way, so a coated
    // board must not quietly drop the pair into B4 (0.4 mm) while every other
    // pour operand on it is held at B2 (1.25 mm).
    const zones = [
      { ...boardZone("gnd"), id: "z_hv", region: { kind: "polygon" as const, pointsMm: [
        { x: -20, y: -10 }, { x: -2, y: -10 }, { x: -2, y: 10 }, { x: -20, y: 10 },
      ] }, netId: "hvn", priority: 1 },
      { ...boardZone("gnd"), id: "z_lv", region: { kind: "polygon" as const, pointsMm: [
        { x: 2, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 10 }, { x: 2, y: 10 },
      ] }, netId: "sig", priority: 1 },
    ];
    const mutual = (b: PcbBoardSettings): number[] => {
      const proj = projection({
        board: b,
        zones: zones as never,
        netNames: { hvn: "HV_RAIL", sig: "SIG" },
      });
      const ctx = buildDrcContext(proj);
      const zone = ctx.copperZones.find((z) => z.id === "z_hv")!;
      return (
        pourParamsForZone(
          zone,
          proj.board.designRules,
          ctx.keepouts,
          ctx.copperZones,
          zonePourNets(proj.board, ctx.netNames),
        ).excludeZonesMm ?? []
      ).map((e) => e.clearanceMm);
    };
    const base = hvBoard({
      netClasses: [HV230],
      perNetClassAssignments: { hvn: "hv" },
    });
    expect(mutual(base)).toEqual([1.25]);
    expect(mutual(withElectrical(base, { outerConductors: "coated" }))).toEqual([
      1.25,
    ]);
  });

  test("a NULL trace extending a 230 V pad is carved at 1.25 mm (Astra run 1 #2)", () => {
    // The pad is on `hvn` (230 V); the trace carries no net but TOUCHES it, so
    // its tier net is `hvn` and the 0 V zone must carve it like HV copper.
    // The ZONE is on `gnd`, which declares nothing (the reference potential);
    // the pad is on `hvn`, the 230 V class.
    const proj = projection({
      board: hvBoard({
        netClasses: [HV230],
        perNetClassAssignments: { hvn: "hv" },
      }),
      zones: [boardZone("gnd")],
      netNames: { hvn: "HV_RAIL", gnd: "GND" },
      freePads: [freePad("fp1", { center: { x: -6, y: 0 }, netId: "hvn" })],
      traces: [trace("t", null, [[-6, 0], [0, 0]])],
    });
    const ctx = buildDrcContext(proj);
    const zone = ctx.copperZones.find((z) => z.id === "board:F.Cu")!;
    const forItem = pourParamsForZone(
      zone,
      proj.board.designRules,
      ctx.keepouts,
      ctx.copperZones,
      zonePourNets(proj.board, ctx.netNames),
    ).clearanceForItem;
    expect(
      forItem({ kind: "trace", netId: null, tierNetId: "hvn", pointMm: { x: -3, y: 0 } }),
    ).toBeCloseTo(1.25, 9);
    // …and the fill really keeps it (centreline + 0.1 mm half width).
    expect(gapToPoint(proj, { x: -3, y: 0 })).toBeGreaterThanOrEqual(1.35 - 1e-6);
  });
});

describe("the router inherits the term (§3.2 c)", () => {
  const ROUTE = { layer: "F.Cu" as const, routeWidthMm: 0.2 };

  function obstacleCtx(netClasses: PcbNetClass[], assign: Record<string, string>) {
    return buildDrcItems(
      projection({
        board: hvBoard({ netClasses, perNetClassAssignments: assign }),
        netNames: { hvn: "HV_RAIL", sig: "SIG" },
        traces: [trace("t_hv", "hvn", [[0, 0], [10, 0]])],
      }),
    );
  }

  test("a 230 V obstacle widens a 0 V route's rect to the IPC spacing", () => {
    const ctx = obstacleCtx([HV230], { hvn: "hv" });
    const rects = buildRouteObstacles({ ...ROUTE, ctx, netId: "sig" });
    const rect = rects.find((r) => r.id === "trace:t_hv:0")!;
    // required 1.25 + obstacle half 0.1 + route half 0.1 = 1.45 mm.
    expect(rect.maxY / NM).toBeGreaterThanOrEqual(1.45 - 1e-6);
    expect(rect.maxY / NM).toBeLessThan(1.5);
  });

  test("a NULL route net takes the conservative bound over every class", () => {
    // The obstacle is UNDECLARED; the route could be assigned the 230 V class,
    // so the rect must already keep 1.25 mm (§3.2 c).
    const ctx = buildDrcItems(
      projection({
        board: hvBoard({ netClasses: [HV230], perNetClassAssignments: { hvn: "hv" } }),
        netNames: { hvn: "HV_RAIL", sig: "SIG" },
        traces: [trace("t_sig", "sig", [[0, 0], [10, 0]])],
      }),
    );
    const named = buildRouteObstacles({ ...ROUTE, ctx, netId: "sig2" });
    const nullNet = buildRouteObstacles({ ...ROUTE, ctx, netId: null });
    const namedRect = named.find((r) => r.id === "trace:t_sig:0")!;
    const nullRect = nullNet.find((r) => r.id === "trace:t_sig:0")!;
    expect(nullRect.maxY).toBeGreaterThan(namedRect.maxY);
    expect(nullRect.maxY / NM).toBeGreaterThanOrEqual(1.45 - 1e-6);
  });
});

describe("determinism", () => {
  test("a board with both constituents runs byte-identical twice", () => {
    const p = parallelPair(
      hvBoard({ netClasses: [HV230, cls("hc", { currentA: 3 })], perNetClassAssignments: { hvn: "hv", sig: "hc" } }),
      0.15,
    );
    expect(JSON.stringify(runDrc(structuredClone(p)))).toBe(
      JSON.stringify(runDrc(structuredClone(p))),
    );
  });
});
