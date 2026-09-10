/**
 * S11 review fixes (manufacturability contract 10 §12.3 — R1 #1/#2/#3/#4/#5).
 * Each test pins a defect the adversarial review found in the first S11 tree,
 * so the fix cannot silently regress.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { toCopperItems } from "../../../shared/pcb-connectivity/copper-items";
import { buildCopperRecords } from "../../../shared/pcb-connectivity/copper-records";
import {
  padOutlineWorldMm,
  ringBounds,
} from "../../../shared/pcb-geometry/pad-outline";
import { buildDrcItems } from "../../../shared/drc/drc-context";
import { buildExcellonDrill } from "../../../modules/designer/backend/export/excellon/writer";
import { buildGerberLayer } from "../../../modules/designer/backend/export/gerber/writer";
import { withLegacyPlating } from "../../../modules/library/backend/queries";
import {
  footprintPadDrill,
  freePadDrill,
} from "../../../shared/rendering/pcb/pcb-drills";
import type { FootprintRenderSourcePad } from "../../../shared/rendering/types";
import {
  boardWithRules,
  freeHole,
  freePad,
  pad,
  placement,
  projection,
  via,
} from "./helpers/drc-fixtures";

const codes = (report: ReturnType<typeof runDrc>) =>
  report.violations.map((v) => v.code);

describe("S11 R1 #1/#2 — a circle pad is a disc of widthMm in the ring too", () => {
  test("the ring builder ignores an unequal heightMm", () => {
    const p = placement("U1", {
      pads: [pad("1", { x: 0, y: 0 }, 1, 3, { shape: "circle" })],
    });
    const bounds = ringBounds(padOutlineWorldMm(p, p.footprint.preview!.pads[0]!));
    // A ⌀1 disc, circumscribed by ≤ sec(π/48): never the 3 mm ellipse.
    expect(bounds.maxY).toBeLessThan(0.51);
    expect(bounds.minY).toBeGreaterThan(-0.51);
    expect(bounds.maxX).toBeLessThan(0.51);
  });

  test("two unequal circles 3.1 mm apart are discs 2.1 mm apart, not ellipses 0.1 mm apart", () => {
    const report = runDrc(
      projection({
        board: boardWithRules({ clearance: { padToPadMm: 0.4 } }),
        placements: [
          placement("A", {
            positionMm: { x: 0, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 3, { shape: "circle" })],
          }),
          placement("B", {
            positionMm: { x: 3.1, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 3, { shape: "circle" })],
          }),
        ],
        padNets: { "A|1": "n1", "B|1": "n2" },
        netNames: { n1: "A", n2: "B" },
      }),
    );
    expect(codes(report)).not.toContain("PAD_TO_PAD_CLEARANCE");
  });
});

describe("S11 R1 #3 — a free-pad slot's tool is the slot width", () => {
  test("freePadDrill reports the slot width as drillMm whatever the row says", () => {
    const drill = freePadDrill(
      freePad("fp", {
        padType: "std",
        shape: "oval",
        widthMm: 4,
        heightMm: 1.2,
        drillMm: 0.8,
        drillSlot: { lengthMm: 3, widthMm: 0.3, angleDeg: 0 },
      }),
    );
    expect(drill).not.toBeNull();
    expect(drill!.drillMm).toBe(0.3);
    expect(drill!.slot?.widthMm).toBe(0.3);
  });

  test("the fab row judges the 0.3 mm plated slot, not the row's 0.8 mm drill", () => {
    const report = runDrc(
      projection({
        board: boardWithRules({ fabricator: "jlcpcb_2l" }),
        freePads: [
          freePad("fp", {
            padType: "std",
            shape: "oval",
            widthMm: 4,
            heightMm: 1.2,
            drillMm: 0.8,
            drillSlot: { lengthMm: 3, widthMm: 0.3, angleDeg: 0 },
          }),
        ],
      }),
    );
    const fab = report.violations.filter((v) => v.code === "FAB_DRILL");
    expect(fab.length).toBeGreaterThanOrEqual(1);
    expect(fab[0]!.message).toContain("minPlatedSlotWidthMm");
  });
});

describe("S11 R1 #4 — `plated: false` is meaningless without a drill", () => {
  test("an undrilled `*.Cu` pad keeps its net and one connectivity item", () => {
    const p: FootprintRenderSourcePad & { plated?: boolean } = {
      ...pad("1", { x: 0, y: 0 }, 1, 1, { layer: "*.Cu" }),
      plated: false,
    };
    const proj = projection({
      placements: [placement("U1", { pads: [p] })],
      padNets: { "U1|1": "n1" },
      netNames: { n1: "N" },
    });
    const records = buildCopperRecords({
      layerCount: proj.board.layerCount,
      placements: proj.placements,
      padNetIds: new Map(Object.entries(proj.padNets ?? {})),
      freePads: [],
      traces: [],
      vias: [],
    });
    expect(records.pads).toHaveLength(1);
    expect(records.pads[0]!.plated).toBe(true);
    const items = toCopperItems(records).filter((i) => i.kind === "pad");
    expect(items).toHaveLength(1);
    expect(items[0]!.netId).toBe("n1");
    expect(codes(runDrc(proj))).not.toContain("NPTH_PAD_NET");
  });
});

describe("S11 R1 #5 — a non-finite ring is bad data, not a breakout", () => {
  test("a NaN pad dimension raises no ANNULAR_RING_MIN", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("U1", {
            pads: [
              pad("1", { x: 0, y: 0 }, Number.NaN, 2, {
                drillDiameterMm: 0.8,
              }),
            ],
          }),
        ],
      }),
    );
    expect(codes(report)).not.toContain("ANNULAR_RING_MIN");
  });
});

describe("S11 Astra run 2 (partial, quota-cut) — a net on copper that cannot carry it", () => {
  test("a numbered copper-less NPTH pad bound to a net is reported, not silently unroutable", () => {
    const p: FootprintRenderSourcePad & { plated?: boolean } = {
      ...pad("1", { x: 0, y: 0 }, 3.2, 3.2, {
        shape: "circle",
        layer: "*.Cu",
        drillDiameterMm: 3.2,
      }),
      plated: false,
    };
    const report = runDrc(
      projection({
        placements: [placement("MH", { pads: [p] })],
        padNets: { "MH|1": "n1" },
        netNames: { n1: "GND" },
      }),
    );
    expect(codes(report)).toContain("NPTH_PAD_NET");
  });

  test("a `hole` free pad bound to a net is reported", () => {
    const report = runDrc(
      projection({
        freePads: [
          freePad("h", {
            padType: "hole",
            shape: "circle",
            widthMm: 3.2,
            heightMm: 3.2,
            drillMm: 3.2,
            netId: "n1",
          }),
        ],
        netNames: { n1: "GND" },
      }),
    );
    expect(codes(report)).toContain("NPTH_PAD_NET");
  });

  test("a drilled `smd` free pad keeps its net: single-layer copper has no barrel to fake", () => {
    const tp = freePad("tp", {
      padType: "smd",
      shape: "circle",
      widthMm: 1.2,
      heightMm: 1.2,
      drillMm: 0.5,
      layer: "F.Cu",
      netId: "n1",
    });
    const proj = projection({ freePads: [tp], netNames: { n1: "TP" } });
    const records = buildCopperRecords({
      layerCount: proj.board.layerCount,
      placements: [],
      padNetIds: new Map(),
      freePads: [tp],
      traces: [],
      vias: [],
    });
    expect(records.pads[0]!.plated).toBe(false);
    const items = toCopperItems(records).filter((i) => i.kind === "pad");
    expect(items).toHaveLength(1);
    expect(items[0]!.netId).toBe("n1");
    expect(codes(runDrc(proj))).not.toContain("NPTH_PAD_NET");
  });
});

describe("S11 Astra run 2b — the six verified findings", () => {
  test("#1 a free hole's tool is the slot width in DRC and Excellon alike, degenerate slots included", () => {
    const slotted = { ...freeHole("h", { x: 10, y: 10 }, 1.2), drillSlot: { lengthMm: 2, widthMm: 0.8, angleDeg: 0 } };
    const proj = projection({ board: boardWithRules({ fabricator: "jlcpcb_2l", minimums: { drillSizeMm: 1 } }), freeHoles: [slotted] });
    const hole = buildDrcItems(proj).holes.find((h) => h.anchor.kind === "freeHole")!;
    expect(hole.drillMm).toBe(0.8);
    expect(hole.slot?.widthMm).toBe(0.8);
    const report = runDrc(proj);
    expect(codes(report)).toContain("DRILL_SIZE_MIN");
    expect(report.violations.some((v) => v.code === "FAB_DRILL" && v.message.includes("minNpthSlotWidthMm"))).toBe(true);
    expect(buildExcellonDrill(proj, [], "NPTH")).toContain("T1C0.800");
    const degenerate = { ...slotted, drillSlot: { lengthMm: 0.8, widthMm: 0.8, angleDeg: 0 } };
    const proj2 = projection({ freeHoles: [degenerate] });
    const hole2 = buildDrcItems(proj2).holes.find((h) => h.anchor.kind === "freeHole")!;
    expect(hole2.drillMm).toBe(0.8);
    expect(hole2.slot).toBeUndefined();
    const npth = buildExcellonDrill(proj2, [], "NPTH");
    expect(npth).toContain("T1C0.800");
    expect(npth).not.toContain("G85");
  });

  test("#2 a square footprint slot keeps the slot tool, not drillDiameterMm", () => {
    const p = { ...pad("1", { x: 0, y: 0 }, 1, 1, { shape: "circle", drillDiameterMm: 0.2 }), drillSlotMm: { widthMm: 0.8, heightMm: 0.8 } };
    const drill = footprintPadDrill(p, placement("U", { pads: [p] }))!;
    expect(drill.drillMm).toBe(0.8);
    expect(drill.slot).toBeUndefined();
    const report = runDrc(projection({ board: boardWithRules({ minimums: { annularRingMm: 0.2, drillSizeMm: 0.1 } }), placements: [placement("U", { pads: [p] })] }));
    expect(codes(report)).toContain("ANNULAR_RING_MIN");
  });

  test("#3 a slotted `hole` free pad opens the mask over the whole slot", () => {
    const proj = projection({
      freePads: [freePad("h", { padType: "hole", shape: "circle", widthMm: 1, heightMm: 1, drillMm: 1, drillSlot: { lengthMm: 3, widthMm: 1, angleDeg: 30 } })],
    });
    const mask = buildGerberLayer(proj, "mask.top", []);
    // 3 + 2·0.075 (the fixture board's mask expansion) along the slot, 1 + 0.15 across.
    expect(mask).toContain("%AMROT_O_3p15_1p15_30*");
    expect(buildGerberLayer(proj, "mask.bottom", [])).toContain("%AMROT_O_3p15_1p15_30*");
  });

  test("#4 a via with zero annular ring breaks out whatever the minimum says", () => {
    const report = runDrc(projection({ board: boardWithRules({ minimums: { annularRingMm: 0 } }), vias: [via("v", { diameterMm: 0.6, drillMm: 0.6 })] }));
    const hit = report.violations.find((v) => v.code === "ANNULAR_RING_MIN");
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("breaks out");
  });

  test("#5 an empty legacy index token binds nothing", () => {
    const preview = {
      kind: "footprint" as const, units: "mm" as const, name: "fp",
      pads: [{ id: "edited:", number: "1", shape: "circle" as const, centerMm: { x: 0, y: 0 }, widthMm: 1, heightMm: 1, rotationDeg: 0, drillDiameterMm: 1 }],
      graphics: [], labels: [], bounds: null, warnings: [],
    };
    const raw = [{ number: "1", type: "np_thru_hole", drillDiameter: 1, position: { x: 0, y: 0 } }];
    const out = withLegacyPlating(preview, raw);
    expect("plated" in out.pads[0]!).toBe(false);
  });

  test("#6 two copper-less NPTH occurrences of one pad number: byte-identical under pad reversal", () => {
    const mk = (x: number) => ({ ...pad("1", { x, y: 0 }, 1, 1, { shape: "circle", layer: "*.Cu", drillDiameterMm: 1 }), id: `pad-1-${x}`, plated: false });
    const a = mk(0), b = mk(3);
    const run = (pads: typeof a[]) => JSON.stringify(runDrc(projection({ placements: [placement("MH", { pads })], padNets: { "MH|1": "n1" }, netNames: { n1: "GND" } })));
    expect(run([a, b])).toBe(run([b, a]));
    expect(run([a, b])).toContain("NPTH_PAD_NET");
  });
});
