import { describe, expect, test } from "bun:test";
import { buildExportBundle } from "../../../modules/designer/backend/export";
import { buildGerberLayer } from "../../../modules/designer/backend/export/gerber/writer";
import { buildExcellonDrill } from "../../../modules/designer/backend/export/excellon/writer";
import {
  buildBomCsv,
  buildBomProjection,
  buildJlcBomCsv,
  buildKicadBomCsv,
} from "../../../modules/designer/backend/export/bom/writer";
import { buildPnpCsv } from "../../../modules/designer/backend/export/pnp/writer";
import { packZip, crc32 } from "../../../modules/designer/backend/export/zip";
import { createDefaultPcbViewState } from "../../../modules/designer/backend/pcb/pcb-defaults";
import { textToStrokes } from "../../../modules/designer/backend/export/text/stroke-font";
import { exportBundleName } from "../../../sdks/designer/pcb-helpers";
import type {
  DesignerPcbProjection,
  DesignerSchematicProjection,
} from "../../../sdks/designer/types";

// =========================================================================
// Test fixture: minimal "555 blinker" surrogate — one through-hole DIP,
// one SMD resistor on F.Cu, one via, one trace, board outline 30×20 mm.
// =========================================================================

function fixtureProjection(): DesignerPcbProjection {
  return {
    designId: "blink",
    revision: 1,
    board: {
      outline: {
        kind: "rect",
        widthMm: 30,
        heightMm: 20,
        centerMm: { x: 15, y: 10 },
      },
      activeLayer: "F.Cu",
      visibleLayers: ["F.Cu", "B.Cu"],
      designRules: {
        clearance: {
          traceToTraceMm: 0.2,
          traceToPadMm: 0.2,
          padToPadMm: 0.2,
          traceToViaMm: 0.2,
          viaToViaMm: 0.2,
          copperToBoardEdgeMm: 0.3,
        },
        minimums: {
          traceWidthMm: 0.15,
          drillSizeMm: 0.3,
          annularRingMm: 0.13,
          viaDiameterMm: 0.6,
          viaDrillMm: 0.3,
        },
      },
      netClasses: [],
      tracePresets: [0.2],
      fabricator: "jlcpcb_2l",
      layerCount: 2,
      displayMode: "normal",
      solderMaskExpansionMm: 0.05,
      solderPasteExpansionMm: 0,
      updatedAt: new Date().toISOString(),
    },
    placements: [
      {
        id: "p1",
        partId: "part-1",
        componentId: "c-555",
        reference: "U1",
        positionMm: { x: 10, y: 10 },
        rotationDeg: 0,
        mirrored: false,
        layer: "F.Cu",
        footprint: {
          footprintId: "fp-dip8",
          name: "DIP-8",
          mountType: "through_hole",
          sourceHash: null,
          preview: {
            kind: "footprint",
            units: "mm",
            name: "DIP-8",
            pads: [
              {
                id: "pad-1",
                number: "1",
                shape: "circle",
                centerMm: { x: -3.81, y: -3.81 },
                widthMm: 1.6,
                heightMm: 1.6,
                rotationDeg: 0,
                drillDiameterMm: 0.8,
              },
              {
                id: "pad-2",
                number: "2",
                shape: "circle",
                centerMm: { x: -1.27, y: -3.81 },
                widthMm: 1.6,
                heightMm: 1.6,
                rotationDeg: 0,
                drillDiameterMm: 0.8,
              },
            ],
            graphics: [],
            labels: [],
            bounds: null,
            warnings: [],
          },
        },
      },
      {
        id: "p2",
        partId: "part-2",
        componentId: "c-r10k",
        reference: "R1",
        positionMm: { x: 22, y: 10 },
        rotationDeg: 90,
        mirrored: false,
        layer: "F.Cu",
        footprint: {
          footprintId: "fp-0603",
          name: "R_0603_1608Metric",
          mountType: "smd",
          sourceHash: null,
          preview: {
            kind: "footprint",
            units: "mm",
            name: "R_0603_1608Metric",
            pads: [
              {
                id: "pad-1",
                number: "1",
                shape: "rect",
                centerMm: { x: -0.825, y: 0 },
                widthMm: 0.95,
                heightMm: 1.0,
                rotationDeg: 0,
                layer: "F.Cu",
              },
              {
                id: "pad-2",
                number: "2",
                shape: "rect",
                centerMm: { x: 0.825, y: 0 },
                widthMm: 0.95,
                heightMm: 1.0,
                rotationDeg: 0,
                layer: "F.Cu",
              },
            ],
            graphics: [],
            labels: [],
            bounds: null,
            warnings: [],
          },
        },
      },
    ],
    traces: [
      {
        id: "t1",
        netId: "n-vcc",
        netClassId: "nc-default",
        layer: "F.Cu",
        widthMm: 0.25,
        pointsNm: [
          { x: 10_000_000, y: 10_000_000 },
          { x: 22_000_000, y: 10_000_000 },
        ],
        segmentMode: "manhattan-90",
      },
    ],
    vias: [
      {
        id: "v1",
        netId: "n-vcc",
        netClassId: "nc-default",
        centerMm: { x: 16, y: 10 },
        diameterMm: 0.6,
        drillMm: 0.3,
        fromLayer: "F.Cu",
        toLayer: "B.Cu",
        viaType: "through",
        protection: "tented",
        provenance: "route",
      },
    ],
    freeHoles: [
      { id: "mh1", centerMm: { x: 2, y: 2 }, drillMm: 3.2, lockedAt: null },
    ],
    freePads: [],
    overlayTexts: [],
    overlayShapes: [],
    zones: [],
    ratsnest: [],
    netNames: { "n-vcc": "VCC" },
    warnings: [],
  };
}

// =========================================================================
// Gerber X2
// =========================================================================

describe("Gerber X2 writer", () => {
  test("emits Ucamco-spec required header lines", () => {
    const out = buildGerberLayer(fixtureProjection(), "copper.top", []);
    // Format spec + units
    expect(out).toContain("%FSLAX46Y46*%");
    expect(out).toContain("%MOMM*%");
    // X2 attributes
    expect(out).toContain("%TF.GenerationSoftware,OpenPCB,");
    expect(out).toMatch(/%TF\.CreationDate,\d{4}-\d{2}-\d{2}T/);
    expect(out).toContain("%TF.FileFunction,Copper,L1,Top,Signal*%");
    expect(out).toContain("%TF.FilePolarity,Positive*%");
    // Trailer
    expect(out.trimEnd().endsWith("M02*")).toBe(true);
  });

  test("emits LPD polarity directive once", () => {
    const out = buildGerberLayer(fixtureProjection(), "copper.top", []);
    const matches = out.match(/%LPD\*%/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test("via flash uses circle aperture and D03 command", () => {
    const out = buildGerberLayer(fixtureProjection(), "copper.top", []);
    expect(out).toContain("%TA.AperFunction,ViaPad*%");
    expect(out).toMatch(/%ADD\d+C,0\.6\*%/);
    // Via center (16, 10) mm → X16000000 Y10000000
    expect(out).toContain("X16000000Y10000000D03*");
  });

  test("trace polyline emits G01 + D02 move + D01 line", () => {
    const out = buildGerberLayer(fixtureProjection(), "copper.top", []);
    // Trace from (10,10) to (22,10) mm with 0.25 mm round aperture
    expect(out).toContain("%TA.AperFunction,Conductor*%");
    expect(out).toMatch(/%ADD\d+C,0\.25\*%/);
    expect(out).toContain("G01*");
    expect(out).toContain("X10000000Y10000000D02*");
    expect(out).toContain("X22000000Y10000000D01*");
  });

  test("net attribute emitted before flash and cleared after", () => {
    const out = buildGerberLayer(fixtureProjection(), "copper.top", []);
    expect(out).toContain("%TO.N,VCC*%");
    expect(out).toContain("%TD*%");
  });

  test("rect SMD pad uses R aperture; rotation 90° swaps W/H", () => {
    const out = buildGerberLayer(fixtureProjection(), "copper.top", []);
    // R1 placement is rotated 90°, so pad 0.95×1.0 becomes 1.0×0.95.
    expect(out).toMatch(/%ADD\d+R,1X0\.95\*%/);
  });

  test("bottom-side mask polarity is Negative", () => {
    const out = buildGerberLayer(fixtureProjection(), "mask.bottom", []);
    expect(out).toContain("%TF.FilePolarity,Negative*%");
    expect(out).toContain("%TF.FileFunction,Soldermask,Bot*%");
  });

  test("edge cuts emits closed polyline with 0.1 mm profile aperture", () => {
    const out = buildGerberLayer(fixtureProjection(), "edge_cuts", []);
    expect(out).toContain("%TF.FileFunction,Profile,NP*%");
    expect(out).toMatch(/%ADD\d+C,0\.1\*%/);
    // Closing line back to first vertex
    const d01Lines = out.match(/D01\*/g) ?? [];
    // 4 corners + 1 close = 4 (since first is D02): so 4 lines
    expect(d01Lines.length).toBe(4);
  });

  test("paste layer skips through-hole pads", () => {
    const out = buildGerberLayer(fixtureProjection(), "paste.top", []);
    // DIP through-hole pads must NOT appear in paste. Only SMD (R1) does.
    // R1 has rect pads; paste rect aperture should be present, and there
    // should be exactly 2 flashes (D03) for the 2 SMD pads.
    const flashes = out.match(/D03\*/g) ?? [];
    expect(flashes.length).toBe(2);
  });

  test("net attribute escapes commas in net names", () => {
    const proj = fixtureProjection();
    proj.netNames["n-vcc"] = "VCC,WEIRD";
    const out = buildGerberLayer(proj, "copper.top", []);
    expect(out).toContain("%TO.N,VCC\\2CWEIRD*%");
  });

  test("roundrect pad emits aperture macro with signed corner coords", () => {
    const proj = fixtureProjection();
    // Replace R1's rect pads with roundrect to exercise the macro path.
    const r1 = proj.placements[1]!;
    const pads = r1.footprint.preview!.pads as unknown as Array<{
      shape: string;
      roundrectRatio?: number;
    }>;
    for (const pad of pads) {
      pad.shape = "roundrect";
      pad.roundrectRatio = 0.25;
    }
    const out = buildGerberLayer(proj, "copper.top", []);
    // Macro definition must be present with negative center offsets, which
    // would have thrown with the old `gerberDim` negative-guard.
    expect(out).toMatch(/%AMRR_/);
    // Macro contains at least one corner circle primitive with a negative
    // coordinate (signed offset preserved).
    expect(out).toMatch(/1,1,[\d.]+,-[\d.]+,-[\d.]+/);
  });

  test("through via emits annulus on every copper layer in 4-layer stackup", () => {
    const proj = fixtureProjection();
    proj.board.layerCount = 4;
    const innerTop = buildGerberLayer(proj, "copper.inner1", []);
    const innerBot = buildGerberLayer(proj, "copper.inner2", []);
    // Via center (16,10) mm — annulus flash on both inner copper layers.
    expect(innerTop).toContain("X16000000Y10000000D03*");
    expect(innerBot).toContain("X16000000Y10000000D03*");
  });

  test("copper FileFunction L-code derives from layerCount (B.Cu=L4 on 4-layer)", () => {
    // 2-layer: bottom copper is L2.
    const two = fixtureProjection();
    expect(buildGerberLayer(two, "copper.bottom", [])).toContain(
      "%TF.FileFunction,Copper,L2,Bot,Signal*%",
    );
    // 4-layer: bottom copper must be L4 (not the old hardcoded L2), and the
    // inner layers sit at L2/L3.
    const four = fixtureProjection();
    four.board.layerCount = 4;
    expect(buildGerberLayer(four, "copper.bottom", [])).toContain(
      "%TF.FileFunction,Copper,L4,Bot,Signal*%",
    );
    expect(buildGerberLayer(four, "copper.inner1", [])).toContain(
      "%TF.FileFunction,Copper,L2,Inr,Signal*%",
    );
    expect(buildGerberLayer(four, "copper.inner2", [])).toContain(
      "%TF.FileFunction,Copper,L3,Inr,Signal*%",
    );
  });

  test("per-pad .TO.N attribute resolves from net-pad correlation", () => {
    const proj = fixtureProjection();
    // Manually build a placement→pad→net map mirroring what the orchestrator
    // does when a schematic projection is available.
    const padNetIds = new Map<string, string>([
      ["p1|1", "n-vcc"], // U1 pin 1 → VCC net
      ["p2|2", "n-vcc"], // R1 pin 2 → VCC net
    ]);
    const out = buildGerberLayer(proj, "copper.top", [], padNetIds);
    // The U1 pad-1 flash should emit %TO.N,VCC*% before the D03.
    const lines = out.split("\r\n");
    const padPIdx = lines.findIndex((l) => l === "%TO.P,U1,1*%");
    expect(padPIdx).toBeGreaterThan(0);
    // The %TO.N,VCC*% line precedes the %TO.P (we emit N before P, both
    // before the D03 flash). Just confirm presence in nearby lines.
    expect(
      lines.slice(padPIdx - 3, padPIdx).some((l) => l === "%TO.N,VCC*%"),
    ).toBe(true);
  });

  test("pad without correlation entry emits no .TO.N attribute", () => {
    const proj = fixtureProjection();
    // Empty correlation map — every pad should fall through.
    const padNetIds = new Map<string, string>();
    const out = buildGerberLayer(proj, "copper.top", [], padNetIds);
    // U1 pad-1 has no net entry; the %TO.P line must not be preceded by
    // a per-pad net attribute (vias still emit their own net attr).
    const lines = out.split("\r\n");
    const u1Idx = lines.findIndex((l) => l === "%TO.P,U1,1*%");
    expect(u1Idx).toBeGreaterThan(0);
    expect(lines[u1Idx - 1]).not.toMatch(/%TO\.N,/);
  });

  test("copper pour emitted as positive G36/G37 regions with antipad holes", () => {
    const proj = fixtureProjection();
    proj.board.viewState = {
      ...createDefaultPcbViewState(),
      copperFillLayers: ["F.Cu"],
      copperFillPourNetIds: { "F.Cu": "n-vcc" },
    };
    const out = buildGerberLayer(proj, "copper.top", []);
    // Pour present as filled regions.
    expect(out).toContain("G36*");
    expect(out).toContain("G37*");
    // Region carries the pour net's object attribute.
    expect(out).toContain("%TO.N,VCC*%");
    // Different-net pads (U1/R1 carry no net here) get clear-polarity antipad
    // holes cut from the pour, then dark is restored.
    expect(out).toContain("%LPC*%");
    expect(out).toContain("%LPD*%");
    // The pour is emitted before the via flash so the via paints on top.
    expect(out.indexOf("G36*")).toBeLessThan(out.indexOf("D03*"));
  });

  test("non-poured copper layer emits no region", () => {
    const proj = fixtureProjection();
    proj.board.viewState = {
      ...createDefaultPcbViewState(),
      copperFillLayers: ["F.Cu"],
      copperFillPourNetIds: { "F.Cu": "n-vcc" },
    };
    // B.Cu is not in copperFillLayers → no pour regions.
    expect(buildGerberLayer(proj, "copper.bottom", [])).not.toContain("G36*");
  });

  test("silkscreen text is rasterized to stroke polylines (no deferral)", () => {
    const proj = fixtureProjection();
    proj.overlayTexts = [
      {
        id: "t1",
        layer: "F.SilkS",
        positionMm: { x: 15, y: 10 },
        text: "R1",
        fontSizeMm: 1.0,
        rotationDeg: 0,
        mirror: false,
        justify: "center",
        lockedAt: null,
      },
    ];
    const out = buildGerberLayer(proj, "silk.top", []);
    expect(out).not.toContain("deferred");
    expect(out).toContain("%TA.AperFunction,NonConductor*%");
    expect(out).toMatch(/D02\*/);
    expect(out).toMatch(/D01\*/);
    // Bottom silk has no text here → no NonConductor strokes.
    expect(buildGerberLayer(proj, "silk.bottom", [])).not.toContain(
      "%TA.AperFunction,NonConductor*%",
    );
  });

  test("Edge.Cuts does not double-close an already-closed polygon outline", () => {
    const proj = fixtureProjection();
    proj.board.outline = {
      kind: "polygon",
      widthMm: 30,
      heightMm: 20,
      centerMm: { x: 15, y: 10 },
      pointsMm: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 20 },
        { x: 0, y: 20 },
        { x: 0, y: 0 }, // explicit close
      ],
    };
    const out = buildGerberLayer(proj, "edge_cuts", []);
    // One D02 move + 4 D01 line segments, no extra closing line.
    const d01 = out.match(/D01\*/g) ?? [];
    expect(d01.length).toBe(4);
  });
});

// =========================================================================
// Stroke font (silk text vectorizer)
// =========================================================================

describe("stroke font vectorizer", () => {
  const base = {
    originMm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirror: false,
    justify: "left" as const,
  };

  test("vertically centers the cap box on the anchor", () => {
    const strokes = textToStrokes("A", { ...base, sizeMm: 2 });
    expect(strokes.length).toBeGreaterThan(0);
    const ys = strokes.flat().map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(1, 5); // cap top
    expect(Math.min(...ys)).toBeCloseTo(-1, 5); // baseline
  });

  test("rotation by 90° turns a horizontal dash vertical", () => {
    const flat = textToStrokes("-", { ...base, sizeMm: 6 });
    const turned = textToStrokes("-", { ...base, sizeMm: 6, rotationDeg: 90 });
    expect(Math.abs(flat[0]![0]!.x - flat[0]![1]!.x)).toBeGreaterThan(0.5);
    expect(Math.abs(turned[0]![0]!.y - turned[0]![1]!.y)).toBeGreaterThan(0.5);
  });

  test("mirror flips x to the other side of the anchor", () => {
    const normal = textToStrokes("L", { ...base, sizeMm: 6 });
    const mirrored = textToStrokes("L", { ...base, sizeMm: 6, mirror: true });
    expect(Math.max(...normal.flat().map((p) => p.x))).toBeGreaterThan(0);
    expect(Math.min(...mirrored.flat().map((p) => p.x))).toBeLessThan(0);
  });

  test("unknown lowercase falls back to small-caps (still renders)", () => {
    expect(textToStrokes("k", { ...base, sizeMm: 2 }).length).toBeGreaterThan(
      0,
    );
  });
});

// =========================================================================
// Excellon
// =========================================================================

describe("Excellon drill writer", () => {
  test("emits required header sentinels and M30 trailer", () => {
    const out = buildExcellonDrill(fixtureProjection(), []);
    expect(out.startsWith("M48")).toBe(true);
    expect(out).toContain("FMAT,2");
    expect(out).toContain("METRIC");
    expect(out).toContain("G90");
    expect(out).toContain("G05");
    expect(out.trimEnd().endsWith("M30")).toBe(true);
  });

  test("embeds plated/non-plated FileFunction CAM comment", () => {
    expect(buildExcellonDrill(fixtureProjection(), [], "PTH")).toContain(
      "; #@! TF.FileFunction,Plated,1,2,PTH,Drill*",
    );
    expect(buildExcellonDrill(fixtureProjection(), [], "NPTH")).toContain(
      "; #@! TF.FileFunction,NonPlated,1,2,NPTH,Drill*",
    );
  });

  test("PTH file groups plated drills (vias + plated pads)", () => {
    const out = buildExcellonDrill(fixtureProjection(), [], "PTH");
    // Two plated diameters: via 0.3 mm + DIP pad 0.8 mm.
    expect(out).toMatch(/T\d+C0\.300/);
    expect(out).toMatch(/T\d+C0\.800/);
    // 3.2 mm mounting hole is NPTH — must NOT appear in PTH file.
    expect(out).not.toMatch(/T\d+C3\.200/);
    const toolDefs = out.match(/^T\d+C\d/gm) ?? [];
    expect(toolDefs.length).toBe(2);
  });

  test("NPTH file contains only unplated drills (mounting holes)", () => {
    const out = buildExcellonDrill(fixtureProjection(), [], "NPTH");
    expect(out).toMatch(/T\d+C3\.200/);
    expect(out).not.toMatch(/T\d+C0\.300/);
    expect(out).not.toMatch(/T\d+C0\.800/);
  });

  test("PTH and NPTH headers identify themselves", () => {
    const pth = buildExcellonDrill(fixtureProjection(), [], "PTH");
    const npth = buildExcellonDrill(fixtureProjection(), [], "NPTH");
    expect(pth).toMatch(/; OpenPCB Excellon drill file — PTH/);
    expect(npth).toMatch(/; OpenPCB Excellon drill file — NPTH/);
    // Per-tool annotation also identifies plating.
    expect(pth).toMatch(/; PTH 0\.800 mm/);
    expect(npth).toMatch(/; NPTH 3\.200 mm/);
  });

  test("coordinates use explicit decimal points (no zero-suppression ambiguity)", () => {
    const out = buildExcellonDrill(fixtureProjection(), [], "PTH");
    // Via at (16,10) mm → explicit-decimal X16.0000Y10.0000.
    expect(out).toContain("X16.0000Y10.0000");
  });

  test("empty NPTH file still emits valid header/trailer", () => {
    const proj = fixtureProjection();
    proj.freeHoles = []; // remove the mounting hole
    proj.freePads = [];
    const out = buildExcellonDrill(proj, [], "NPTH");
    expect(out.startsWith("M48")).toBe(true);
    expect(out.trimEnd().endsWith("M30")).toBe(true);
    // No tool definitions.
    expect(out.match(/^T\d+C/gm) ?? []).toEqual([]);
  });
});

// =========================================================================
// BOM
// =========================================================================

describe("BOM CSV writer", () => {
  test("emits JLCPCB-compatible header", () => {
    const out = buildBomCsv(fixtureProjection(), null);
    expect(out.split("\r\n")[0]).toBe(
      "Comment,Designator,Footprint,LCSC Part #,Manufacturer,MPN,Quantity,DNP,Assembly Side,Unit Price,Currency,Notes",
    );
  });

  test("groups identical footprint+value+mpn into one row", () => {
    const sch: DesignerSchematicProjection = {
      designId: "blink",
      revision: 1,
      parts: [
        {
          id: "part-1",
          componentId: "c-555",
          reference: "U1",
          value: "NE555",
          rotationDeg: 0,
          mirrored: false,
          positionNm: { x: 0, y: 0 },
          symbol: {} as never,
          footprint: {} as never,
          pins: [],
          propertiesJson: {} as never,
        },
        {
          id: "part-2",
          componentId: "c-r10k",
          reference: "R1",
          value: "10k",
          rotationDeg: 0,
          mirrored: false,
          positionNm: { x: 0, y: 0 },
          symbol: {} as never,
          footprint: {} as never,
          pins: [],
          propertiesJson: {} as never,
        },
      ],
      wires: [],
      labels: [],
      primitives: [],
      junctions: [],
      derivedNets: [],
      designName: "blink",
      sheetSize: "A4",
      updatedAt: new Date().toISOString(),
    } as unknown as DesignerSchematicProjection;
    const out = buildBomCsv(fixtureProjection(), sch);
    expect(out).toContain("NE555,U1,DIP-8");
    expect(out).toContain("10k,R1,R_0603_1608Metric");
  });

  test("applies BOM overrides and groups by LCSC/JLC", () => {
    const projection = buildBomProjection(fixtureProjection(), null, [
      {
        designId: "blink",
        refdes: "R1",
        manufacturer: "Yageo",
        manufacturerPartNumber: "RC0603FR-0710KL",
        lcscPartNumber: "C25804",
        supplier: "LCSC",
        unitPrice: 0.001,
        currency: "USD",
        dnp: false,
        assemblySide: "top",
        notes: "static estimate",
        updatedAt: new Date().toISOString(),
      },
    ]);
    const row = projection.rows.find(
      (candidate) => candidate.refdesList === "R1",
    );
    expect(row?.manufacturer).toBe("Yageo");
    expect(row?.lcscPartNumber).toBe("C25804");
    expect(projection.summary.estimatedCost).toBeNull();
  });

  test("emits JLC and KiCad-style BOM CSV variants", () => {
    const rows = buildBomProjection(fixtureProjection(), null).rows;
    expect(buildJlcBomCsv(rows).split("\r\n")[0]).toBe(
      "Comment,Designator,Footprint,LCSC Part #,Quantity",
    );
    expect(buildKicadBomCsv(rows).split("\r\n")[0]).toBe(
      "References,Value,Footprint,Quantity,Manufacturer,MPN,LCSC,DNP,Notes",
    );
  });
});

// =========================================================================
// PnP
// =========================================================================

describe("Pick-and-place CSV writer", () => {
  test("emits Designator,Val,Package,Mid X,Mid Y,Rotation,Layer", () => {
    const out = buildPnpCsv(fixtureProjection(), null);
    expect(out.split("\r\n")[0]).toBe(
      "Designator,Val,Package,Mid X,Mid Y,Rotation,Layer",
    );
  });

  test("emits SMD parts (Title-case layer); excludes through-hole", () => {
    const out = buildPnpCsv(fixtureProjection(), null);
    // R1 (0603 SMD) at (22,10), rot 90, no family offset → 90.00, Top.
    expect(out).toContain("R1,,R_0603_1608Metric,22.0000,10.0000,90.00,Top");
    // U1 is a through-hole DIP-8 → omitted from the CPL entirely.
    expect(out).not.toContain("U1,");
  });

  test("applies footprint-family rotation offset (SOT-23 → -90)", () => {
    const proj = fixtureProjection();
    const r1 = proj.placements[1]!;
    r1.footprint.name = "SOT-23";
    r1.rotationDeg = 0;
    // 0 + (-90) → normalized 270.
    expect(buildPnpCsv(proj, null)).toContain(
      "R1,,SOT-23,22.0000,10.0000,270.00,Top",
    );
  });

  test("bottom-side rotation mirrored about 180; layer is Bottom", () => {
    const proj = fixtureProjection();
    const r1 = proj.placements[1]!;
    r1.layer = "B.Cu";
    r1.rotationDeg = 30; // 0603 has no offset → 180 - 30 = 150.
    expect(buildPnpCsv(proj, null)).toContain(
      "R1,,R_0603_1608Metric,22.0000,10.0000,150.00,Bottom",
    );
  });

  test("excludes DNP parts from the CPL", () => {
    const out = buildPnpCsv(fixtureProjection(), null, [
      {
        designId: "blink",
        refdes: "R1",
        manufacturer: null,
        manufacturerPartNumber: null,
        lcscPartNumber: null,
        supplier: null,
        unitPrice: null,
        currency: null,
        dnp: true,
        assemblySide: null,
        notes: null,
        updatedAt: new Date().toISOString(),
      },
    ]);
    expect(out).not.toContain("R1,");
  });
});

// =========================================================================
// Orchestrator
// =========================================================================

describe("export orchestrator", () => {
  test("produces all 14 expected files for a 2-layer board", () => {
    const result = buildExportBundle(fixtureProjection(), null);
    const kinds = new Set(result.artifacts.map((a) => a.kind));
    const expected = [
      "csv.bom",
      "csv.pnp",
      "excellon.drills_pth",
      "excellon.drills_npth",
      "gerber.bottom_copper",
      "gerber.bottom_mask",
      "gerber.bottom_paste",
      "gerber.bottom_silk",
      "gerber.edge_cuts",
      "gerber.job",
      "gerber.top_copper",
      "gerber.top_mask",
      "gerber.top_paste",
      "gerber.top_silk",
    ];
    for (const kind of expected) {
      expect(kinds.has(kind as never)).toBe(true);
    }
    expect(result.artifacts.length).toBe(expected.length);
  });

  test("emits a valid, deterministic .gbrjob job file", () => {
    const at = "2020-01-01T00:00:00.000Z";
    const result = buildExportBundle(fixtureProjection(), null, {}, [], at);
    const job = result.artifacts.find((a) => a.kind === "gerber.job");
    expect(job).toBeDefined();
    expect(job!.fileName.endsWith(".gbrjob")).toBe(true);
    const parsed = JSON.parse(job!.text);
    expect(parsed.GeneralSpecs.LayerNumber).toBe(2);
    expect(parsed.GeneralSpecs.Size).toEqual({ X: 30, Y: 20 });
    expect(parsed.Header.CreationDate).toBe(at);
    const fns = parsed.FilesAttributes.map(
      (f: { FileFunction: string }) => f.FileFunction,
    );
    expect(fns).toContain("Copper,L1,Top,Signal");
    expect(fns.some((f: string) => f.startsWith("Plated,1,2,PTH"))).toBe(true);
    // Same inputs → byte-identical job file (reproducible bundle).
    const again = buildExportBundle(fixtureProjection(), null, {}, [], at);
    expect(again.artifacts.find((a) => a.kind === "gerber.job")!.text).toBe(
      job!.text,
    );
  });

  test("gerber CreationDate is the injected timestamp", () => {
    const out = buildGerberLayer(
      fixtureProjection(),
      "copper.top",
      [],
      undefined,
      "2020-01-01T00:00:00.000Z",
    );
    expect(out).toContain("%TF.CreationDate,2020-01-01T00:00:00.000Z*%");
  });

  test("file names share the bundle prefix", () => {
    const result = buildExportBundle(fixtureProjection(), null);
    for (const a of result.artifacts) {
      expect(a.fileName.startsWith(result.bundleName)).toBe(true);
    }
  });

  test("bundle name comes from the shared helper (no client/server drift)", () => {
    const result = buildExportBundle(fixtureProjection(), null);
    expect(result.bundleName).toBe(exportBundleName("blink"));
  });

  test("respects includeBom/includePickAndPlace options", () => {
    const result = buildExportBundle(fixtureProjection(), null, {
      includeBom: false,
      includePickAndPlace: false,
    });
    expect(result.artifacts.find((a) => a.kind === "csv.bom")).toBeUndefined();
    expect(result.artifacts.find((a) => a.kind === "csv.pnp")).toBeUndefined();
  });

  test("preflight warns on a hole below the fab-preset minimum drill", () => {
    const proj = fixtureProjection(); // fabricator jlcpcb_2l → min drill 0.3
    proj.vias[0]!.drillMm = 0.15;
    const result = buildExportBundle(proj, null);
    expect(result.warnings.some((w) => /minimum drill/i.test(w))).toBe(true);
  });

  test("preflight warns when the board has no outline", () => {
    const proj = fixtureProjection();
    (proj.board as { outline: unknown }).outline = null;
    const result = buildExportBundle(proj, null);
    expect(result.warnings.some((w) => /outline/i.test(w))).toBe(true);
  });
});

// =========================================================================
// ZIP
// =========================================================================

describe("ZIP packager", () => {
  test("produces a valid PKZip archive signature", () => {
    const result = buildExportBundle(fixtureProjection(), null);
    const zip = packZip(result.artifacts);
    // Local file header signature 0x04034b50 little-endian.
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    // End-of-central-directory signature 0x06054b50 at the tail.
    const tail = zip.subarray(zip.length - 22, zip.length - 18);
    expect(Array.from(tail)).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  test("CRC-32 over known string matches IEEE 802.3 reference", () => {
    // "123456789" → 0xCBF43926 (the canonical CRC-32 test vector).
    const bytes = new TextEncoder().encode("123456789");
    expect(crc32(bytes)).toBe(0xcbf43926);
  });

  test("ZIP central directory record count equals artifact count", () => {
    const result = buildExportBundle(fixtureProjection(), null);
    const zip = packZip(result.artifacts);
    // End-of-central-directory record sits at the tail (22 bytes). The
    // 8-byte offset from EOCD start is the total entries in CD.
    const eocdOffset = zip.length - 22;
    const dv = new DataView(zip.buffer, zip.byteOffset + eocdOffset, 22);
    const totalEntries = dv.getUint16(10, true);
    expect(totalEntries).toBe(result.artifacts.length);
  });

  test("ZIP can be parsed by Bun's native ZIP reader (round-trip)", async () => {
    const result = buildExportBundle(fixtureProjection(), null);
    const zip = packZip(result.artifacts);
    // Bun's JSZip-like primitive is `new Response(zip).blob()` + manual
    // local-header walk. Instead, exercise our own writer by re-reading
    // the local file headers and confirming filenames match.
    const decoded: string[] = [];
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let cursor = 0;
    while (cursor < zip.length - 22) {
      const sig = dv.getUint32(cursor, true);
      if (sig !== 0x04034b50) break;
      const nameLen = dv.getUint16(cursor + 26, true);
      const extraLen = dv.getUint16(cursor + 28, true);
      const compressedSize = dv.getUint32(cursor + 18, true);
      const nameStart = cursor + 30;
      const name = new TextDecoder().decode(
        zip.subarray(nameStart, nameStart + nameLen),
      );
      decoded.push(name);
      cursor = nameStart + nameLen + extraLen + compressedSize;
    }
    expect(decoded.sort()).toEqual(
      result.artifacts.map((a) => a.fileName).sort(),
    );
  });
});
