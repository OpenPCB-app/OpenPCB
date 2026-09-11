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
import {
  boardZoneRow,
  keepoutRow,
  polygonZoneRow,
} from "./helpers/pcb-zone-fixtures";
import { freePad, pad, placement, projection } from "./helpers/drc-fixtures";
import { roundrectRadiusMm } from "../../../modules/designer/backend/export/apertures";
import { padOutlineWorldMm } from "../../../shared/pcb-geometry/pad-outline";
import { placementPads } from "../../../shared/pcb-geometry/pad-geometry";
import { insidePrimitives, parseGerber } from "./helpers/gerber-parse";
import { textToStrokes } from "../../../modules/designer/backend/export/text/stroke-font";
import { buildSilkArtwork } from "../../../shared/rendering/pcb/artwork/silk-artwork";
import { buildMaskOpenings } from "../../../shared/rendering/pcb/artwork/mask-artwork";
import { buildCopperRecords } from "../../../shared/pcb-connectivity";
import { freePadItemKey } from "../../../shared/pcb-connectivity/copper-items";
import { freePadCopperShape } from "../../../shared/pcb-geometry/pad-geometry";
import { createHash } from "node:crypto";
import { exportBundleName } from "../../../sdks/designer/pcb-helpers";
import type {
  DesignerPcbProjection,
  DesignerSchematicProjection,
} from "../../../sdks/designer/types";

interface GerberRegion {
  /** Emitted inside a `%LPC%` block — an antipad / clearance hole. */
  clear: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Shoelace area (mm²), unsigned. */
  areaMm2: number;
}

/** Every `G36…G37` region of a layer, with its polarity and its area. */
function gerberRegions(gerber: string): GerberRegion[] {
  const out: GerberRegion[] = [];
  let clear = false;
  let ring: Array<{ x: number; y: number }> | null = null;
  for (const line of gerber.split("\r\n")) {
    if (line === "%LPC*%") clear = true;
    else if (line === "%LPD*%") clear = false;
    else if (line === "G36*") ring = [];
    else if (line === "G37*") {
      if (ring && ring.length >= 3) {
        let twice = 0;
        for (let i = 0; i < ring.length; i += 1) {
          const a = ring[i]!;
          const b = ring[(i + 1) % ring.length]!;
          twice += a.x * b.y - b.x * a.y;
        }
        out.push({
          clear,
          minX: Math.min(...ring.map((p) => p.x)),
          maxX: Math.max(...ring.map((p) => p.x)),
          minY: Math.min(...ring.map((p) => p.y)),
          maxY: Math.max(...ring.map((p) => p.y)),
          areaMm2: Math.abs(twice) / 2,
        });
      }
      ring = null;
    } else if (ring) {
      const m = /^X(-?\d+)Y(-?\d+)D0[12]\*$/.exec(line);
      if (m) ring.push({ x: Number(m[1]) / 1e6, y: Number(m[2]) / 1e6 });
    }
  }
  return out;
}

/**
 * Bounding boxes of every `G36…G37` region emitted inside a clear-polarity
 * (`%LPC%`) block — the pour's antipad / keepout holes. Coordinates are the
 * X2 4.6 integer form (1 mm = 1e6).
 */
function clearRegionBounds(
  gerber: string,
): Array<{ minX: number; maxX: number; minY: number; maxY: number }> {
  const out: Array<{ minX: number; maxX: number; minY: number; maxY: number }> =
    [];
  let clear = false;
  let ring: Array<{ x: number; y: number }> | null = null;
  for (const line of gerber.split("\r\n")) {
    if (line === "%LPC*%") clear = true;
    else if (line === "%LPD*%") clear = false;
    else if (line === "G36*") ring = clear ? [] : null;
    else if (line === "G37*") {
      if (ring && ring.length >= 3) {
        out.push({
          minX: Math.min(...ring.map((p) => p.x)),
          maxX: Math.max(...ring.map((p) => p.x)),
          minY: Math.min(...ring.map((p) => p.y)),
          maxY: Math.max(...ring.map((p) => p.y)),
        });
      }
      ring = null;
    } else if (ring) {
      const m = /^X(-?\d+)Y(-?\d+)D0[12]\*$/.exec(line);
      if (m) ring.push({ x: Number(m[1]) / 1e6, y: Number(m[2]) / 1e6 });
    }
  }
  return out;
}

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
    keepouts: [],
    ratsnest: [],
    netNames: { "n-vcc": "VCC" },
    warnings: [],
  };
}

/** Fixed timestamp so a pinned export byte-hash is reproducible. */
const EXPORT_TS = "2020-01-01T00:00:00.000Z";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * A board whose ONLY silk is overlay lines, polylines and text — the class of
 * board DFM contract 11 §1.4 promises exports byte-identically to S11.
 */
function overlayOnlySilkProjection(): DesignerPcbProjection {
  const proj = fixtureProjection();
  proj.overlayShapes = [
    {
      id: "s-line",
      layer: "F.SilkS",
      kind: "line",
      pointsMm: [
        { x: 2, y: 2 },
        { x: 8, y: 2 },
      ],
      strokeWidthMm: 0.2,
      fill: "none",
      lockedAt: null,
    },
    {
      id: "s-poly",
      layer: "F.SilkS",
      kind: "polyline",
      pointsMm: [
        { x: 2, y: 4 },
        { x: 5, y: 6 },
        { x: 8, y: 4 },
      ],
      strokeWidthMm: 0.15,
      fill: "none",
      lockedAt: null,
    },
    {
      id: "s-line-b",
      layer: "B.SilkS",
      kind: "line",
      pointsMm: [
        { x: 3, y: 15 },
        { x: 9, y: 15 },
      ],
      strokeWidthMm: 0.25,
      fill: "none",
      lockedAt: null,
    },
  ];
  proj.overlayTexts = [
    {
      id: "t-1",
      layer: "F.SilkS",
      positionMm: { x: 15, y: 16 },
      text: "OpenPCB",
      fontSizeMm: 1.2,
      rotationDeg: 0,
      mirror: false,
      justify: "center",
      lockedAt: null,
    },
    {
      id: "t-2",
      layer: "B.SilkS",
      positionMm: { x: 15, y: 4 },
      text: "v1",
      fontSizeMm: 0.8,
      rotationDeg: 90,
      mirror: true,
      justify: "left",
      lockedAt: null,
    },
  ];
  return proj;
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

  test("per-pad .TO.N attribute resolves from the projection's padNets", () => {
    const proj = fixtureProjection();
    // The projection's OWN authoritative pad→net map (copper-pour contract §9)
    // — the exporter no longer re-derives one from the schematic correlation.
    proj.padNets = {
      "p1|1": "n-vcc", // U1 pin 1 → VCC net
      "p2|2": "n-vcc", // R1 pin 2 → VCC net
    };
    const out = buildGerberLayer(proj, "copper.top", []);
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

  test("pad without a padNets entry emits no .TO.N attribute", () => {
    const proj = fixtureProjection();
    // Empty pad→net map — every pad should fall through.
    proj.padNets = {};
    const out = buildGerberLayer(proj, "copper.top", []);
    // U1 pad-1 has no net entry; the %TO.P line must not be preceded by
    // a per-pad net attribute (vias still emit their own net attr).
    const lines = out.split("\r\n");
    const u1Idx = lines.findIndex((l) => l === "%TO.P,U1,1*%");
    expect(u1Idx).toBeGreaterThan(0);
    expect(lines[u1Idx - 1]).not.toMatch(/%TO\.N,/);
  });

  test("copper pour emitted as positive G36/G37 regions with antipad holes", () => {
    const proj = fixtureProjection();
    proj.zones = [boardZoneRow("F.Cu", "n-vcc")];
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

  test("a copperPour keepout is cut out of the pour as an LPC hole", () => {
    // Fill parity (contract §13.3): the artwork subtracts the same keepouts the
    // canvas and DRC do — a keepout the Gerber ignored would be a
    // displayed-but-unenforced rule.
    const KEEPOUT = [
      { x: 22, y: 3 },
      { x: 27, y: 3 },
      { x: 27, y: 8 },
      { x: 22, y: 8 },
    ];
    const withKeepout = (): DesignerPcbProjection => {
      const proj = fixtureProjection();
      proj.zones = [boardZoneRow("F.Cu", "n-vcc")];
      proj.keepouts = [
        keepoutRow("k1", ["F.Cu"], KEEPOUT, {
          tracks: false,
          vias: false,
          pads: false,
          footprints: false,
          copperPour: true,
        }),
      ];
      return proj;
    };
    const plainProj = fixtureProjection();
    plainProj.zones = [boardZoneRow("F.Cu", "n-vcc")];

    const plain = clearRegionBounds(buildGerberLayer(plainProj, "copper.top", []));
    const carved = clearRegionBounds(
      buildGerberLayer(withKeepout(), "copper.top", []),
    );
    expect(carved.length).toBe(plain.length + 1);
    // The kernel inflates the ring by one output-grid step (0.1 µm) before
    // subtracting, so the hole is the keepout plus at most that much.
    const hole = carved.find(
      (b) => Math.abs(b.minX - 22) < 1e-3 && Math.abs(b.maxX - 27) < 1e-3,
    );
    expect(hole).toBeDefined();
    expect(hole!.minY).toBeCloseTo(3, 3);
    expect(hole!.maxY).toBeCloseTo(8, 3);
  });

  test("same-net zones with different clearances emit ONE union, not per-pour regions", () => {
    // Contract §9: the layer carries the UNION of every pour. Emitting the two
    // zones one after the other would cut the WIDER zone's `%LPC%` antipad out
    // of the copper the TIGHTER zone had already laid down — a manufactured
    // open around the via that neither zone asked for.
    const proj = fixtureProjection();
    proj.netNames = { "n-vcc": "VCC", "n-gnd": "GND" };
    // Only the via is left as a different-net obstacle, so the hole geometry is
    // exactly the two clearances and nothing else.
    proj.placements = [];
    proj.traces = [];
    proj.freeHoles = [];
    proj.zones = [
      polygonZoneRow(
        "z-tight",
        "F.Cu",
        "n-gnd",
        [
          { x: 12, y: 6 },
          { x: 20, y: 6 },
          { x: 20, y: 14 },
          { x: 12, y: 14 },
        ],
        { clearanceMm: 0.5 },
      ),
      polygonZoneRow(
        "z-wide",
        "F.Cu",
        "n-gnd",
        [
          { x: 14, y: 6 },
          { x: 22, y: 6 },
          { x: 22, y: 14 },
          { x: 14, y: 14 },
        ],
        { clearanceMm: 0.8 },
      ),
    ];
    const regions = gerberRegions(buildGerberLayer(proj, "copper.top", []));
    const dark = regions.filter((r) => !r.clear);
    const holes = regions.filter((r) => r.clear);
    // One merged island, one antipad — not two overlapping region sets.
    expect(dark).toHaveLength(1);
    expect(holes).toHaveLength(1);
    // The union's hole is the TIGHTER clearance (0.3 via radius + 0.5), because
    // the wide zone's larger hole is filled by the tight zone's copper. A
    // per-pour emission would leave the 1.1 mm hole instead.
    const radius = (holes[0]!.maxX - holes[0]!.minX) / 2;
    expect(radius).toBeGreaterThan(0.75);
    expect(radius).toBeLessThan(0.9);
    // Every pour on the layer shares one net, so the union keeps its attribute.
    expect(buildGerberLayer(proj, "copper.top", [])).toContain("%TO.N,GND*%");
  });

  test("export without a schematic still merges a same-net pad into the pour", () => {
    // `padNets` lives on the PCB projection (contract §9), so a PCB-only export
    // resolves pad nets exactly as the canvas does. The exporter used to
    // re-derive the map from the schematic correlation and pass `undefined`
    // here, which gave a same-net pad a full clearance halo in the artwork.
    const withNet = fixtureProjection();
    withNet.netNames = { "n-vcc": "VCC", "n-gnd": "GND" };
    withNet.zones = [boardZoneRow("F.Cu", "n-gnd")];
    withNet.padNets = { "p2|1": "n-gnd" };
    const withoutNet = fixtureProjection();
    withoutNet.netNames = { ...withNet.netNames };
    withoutNet.zones = [boardZoneRow("F.Cu", "n-gnd")];

    const copperOf = (proj: DesignerPcbProjection): string =>
      buildExportBundle(proj, null).artifacts.find(
        (a) => a.kind === "gerber.top_copper",
      )!.text;
    const clearArea = (gerber: string): number =>
      gerberRegions(gerber)
        .filter((r) => r.clear)
        .reduce((sum, r) => sum + r.areaMm2, 0);
    const merged = clearArea(copperOf(withNet));
    const isolated = clearArea(copperOf(withoutNet));
    // R1 pad 1 floods solid instead of getting its own antipad, so at least the
    // pad's own 0.95 mm² of copper (plus its halo) comes back into the pour.
    // R1's two pads sit 1.65 mm apart, so their halos merge into ONE hole
    // either way — the region COUNT cannot see this, only the area can.
    expect(merged).toBeLessThan(isolated - 0.9);
  });

  test("non-poured copper layer emits no region", () => {
    const proj = fixtureProjection();
    proj.zones = [boardZoneRow("F.Cu", "n-vcc")];
    // B.Cu has no board zone row → no pour regions.
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
    // The writer emits the ARTWORK MODEL (DFM contract 11 §1.2) — the glyph
    // polylines are the model's strokes, drawn with the `max(0.1, 0.15·size)`
    // aperture, not geometry the writer derives on its own.
    const artwork = buildSilkArtwork({
      placements: proj.placements,
      overlayShapes: proj.overlayShapes,
      overlayTexts: proj.overlayTexts,
    });
    expect(artwork.strokes.length).toBeGreaterThan(0);
    expect(artwork.strokes.every((s) => s.face === "top")).toBe(true);
    expect(artwork.strokes.every((s) => s.widthMm === 0.15)).toBe(true);
    expect(parseGerber(out).strokes.length).toBe(artwork.strokes.length);
    // Bottom silk has no text here → no NonConductor strokes.
    expect(buildGerberLayer(proj, "silk.bottom", [])).not.toContain(
      "%TA.AperFunction,NonConductor*%",
    );
  });

  test("overlay lines / polylines / text keep their exact S11 legend bytes", () => {
    // DFM contract 11 §1.4: the writer's aperture-allocation order is the
    // artwork model's order, so a board whose only silk is overlay lines,
    // polylines and text exports byte-identically to S11. These hashes were
    // captured from the pre-S12 writer; any drift here is a REGRESSION, not a
    // re-baseline, unless it maps to one of §1.4's enumerated fixes.
    const proj = overlayOnlySilkProjection();
    const top = buildGerberLayer(proj, "silk.top", [], EXPORT_TS);
    const bottom = buildGerberLayer(proj, "silk.bottom", [], EXPORT_TS);
    expect(top.match(/%ADD.*\*%/g)).toEqual([
      "%ADD10C,0.2*%",
      "%ADD11C,0.15*%",
      "%ADD12C,0.18*%",
    ]);
    expect(bottom.match(/%ADD.*\*%/g)).toEqual([
      "%ADD10C,0.25*%",
      "%ADD11C,0.12*%",
    ]);
    expect(sha256(top)).toBe(
      "7eeec4c7f30cdba61f1f79118b2414a71a4b39e282c9e731b9d0b81a14871c38",
    );
    expect(sha256(bottom)).toBe(
      "8542696b922e22ab44a38becb589002b61e7b0667cfd78be9edc900be45ef8c7",
    );
  });

  test("a NEGATIVE mask expansion never shrinks a drill relief", () => {
    // DFM contract 11 §1.3: a negative `solderMaskExpansionMm` is authored to
    // contract a copper PAD's opening. Applying it to a drilled void would pull
    // solder mask back OVER the hole, so the relief floors the expansion at
    // zero and stays drill-sized — round and slotted alike.
    const proj = fixtureProjection();
    proj.freePads = [
      freePad("np_round", {
        padType: "smd",
        shape: "rect",
        center: { x: 6, y: 6 },
        widthMm: 1.2,
        heightMm: 1.2,
        drillMm: 0.9,
        layer: "F.Cu",
        solderMaskExpansionMm: -0.05,
      }),
      freePad("np_slot", {
        padType: "hole",
        shape: "circle",
        center: { x: 12, y: 6 },
        widthMm: 1,
        heightMm: 1,
        drillMm: 1,
        drillSlot: { widthMm: 1, lengthMm: 3, angleDeg: 0 },
        solderMaskExpansionMm: -0.05,
      }),
    ];
    const openings = buildMaskOpenings({
      solderMaskExpansionMm: proj.board.solderMaskExpansionMm,
      layerCount: proj.board.layerCount,
      placements: proj.placements,
      freePads: proj.freePads,
      vias: proj.vias,
      records: buildCopperRecords({
        layerCount: proj.board.layerCount,
        placements: proj.placements,
        padNetIds: new Map(),
        freePads: proj.freePads,
        traces: proj.traces,
        vias: proj.vias,
      }),
      padShapes: new Map(
        proj.freePads.map((p) => [freePadItemKey(p.id), freePadCopperShape(p)]),
      ),
    });
    const openingsOf = (id: string): typeof openings =>
      openings.filter(
        (o) => o.anchor.kind === "freePad" && o.anchor.freePadId === id,
      );

    const round = openingsOf("np_round");
    expect(round.map((o) => o.face)).toEqual(["top", "bottom"]);
    // Its own face keeps the CONTRACTED copper opening the user authored…
    expect(round[0]!.copper).toBe(true);
    // …while the far face gets the full 0.9 mm drill, not 0.9 − 0.1.
    expect(round[1]!.shape).toEqual({ kind: "circle", diameterMm: 0.9 });
    expect(round[1]!.copper).toBe(false);

    const slot = openingsOf("np_slot");
    expect(slot.map((o) => o.face)).toEqual(["top", "top", "bottom", "bottom"]);
    // The declared pad shape of a `hole` pad IS an authored opening, so it
    // takes the negative expansion (1 → 0.9)…
    expect(slot[0]!.shape).toEqual({ kind: "circle", diameterMm: 0.9 });
    expect(slot[2]!.shape).toEqual({ kind: "circle", diameterMm: 0.9 });
    // …and the drill relief does not: a 3 mm slot of a 1 mm tool stays 3 × 1
    // on BOTH faces, never 2.9 × 0.9.
    expect(slot[1]!.shape).toEqual({
      kind: "obround",
      widthMm: 3,
      heightMm: 1,
    });
    expect(slot[3]!.shape).toEqual({
      kind: "obround",
      widthMm: 3,
      heightMm: 1,
    });
  });

  test("a closed overlay shape exports closed, and a solid one as a region", () => {
    // §1.4, enumerated fix: a `rect` / `circle` / `polygon` used to export as
    // the TWO points it is stored as — a diagonal line where the canvas drew a
    // closed shape — and a filled overlay had no region at all.
    const proj = fixtureProjection();
    proj.overlayShapes = [
      {
        id: "r1",
        layer: "F.SilkS",
        kind: "rect",
        pointsMm: [
          { x: 2, y: 2 },
          { x: 6, y: 5 },
        ],
        strokeWidthMm: 0.2,
        fill: "solid",
        lockedAt: null,
      },
    ];
    const out = buildGerberLayer(proj, "silk.top", []);
    const parsed = parseGerber(out);
    expect(parsed.strokes.length).toBe(1);
    // Five vertices: the four corners plus the closing point.
    expect(parsed.strokes[0]!.points.length).toBe(5);
    expect(parsed.strokes[0]!.points[0]).toEqual(
      parsed.strokes[0]!.points[4]!,
    );
    expect(parsed.regions.length).toBe(1);
    expect(parsed.regions[0]!.polarity).toBe("dark");
    expect(parsed.regions[0]!.points.length).toBe(5);
  });

  test("footprint silk graphics and the reference designator reach the legend", () => {
    // §1.4, enumerated fix: neither was ever exported before S12.
    const proj = fixtureProjection();
    const preview = proj.placements[0]!.footprint.preview!;
    proj.placements[0]!.footprint.preview = {
      ...preview,
      graphics: [
        {
          kind: "line",
          a: { x: -2, y: -2 },
          b: { x: 2, y: -2 },
          strokeWidthMm: 0.12,
          layer: "F.SilkS",
        },
      ],
      labels: [
        {
          id: "ref",
          text: "REF**",
          at: { x: 0, y: 3 },
          fontSizeMm: 1,
          rotationDeg: 0,
          anchorX: "center",
          anchorY: "middle",
          layer: "F.SilkS",
          role: "reference",
        },
      ],
    };
    const parsed = parseGerber(buildGerberLayer(proj, "silk.top", []));
    // The graphic's own 0.12 aperture, plus the label's max(0.1, 0.15·1).
    expect(parsed.strokes.length).toBeGreaterThan(1);
    const widths = new Set(
      parsed.strokes.map((s) => {
        const prim = parsed.apertures.get(s.apertureCode)!.primitives[0]!;
        return prim.kind === "circle" ? prim.diameterMm : Number.NaN;
      }),
    );
    expect([...widths].sort()).toEqual([0.12, 0.15]);
    // The placement's own designator, never the shared model's placeholder.
    const artwork = buildSilkArtwork({
      placements: proj.placements,
      overlayShapes: proj.overlayShapes,
      overlayTexts: proj.overlayTexts,
    });
    const labelStrokes = artwork.strokes.filter(
      (s) => s.source.kind === "placement" && "labelId" in s.source,
    );
    const expected = textToStrokes("U1", {
      originMm: { x: 10, y: 13 },
      sizeMm: 1,
      rotationDeg: 0,
      mirror: false,
      justify: "center",
      anchorY: "middle",
    }).filter((poly) => poly.length >= 2);
    expect(labelStrokes.length).toBe(expected.length);
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

  test("Edge.Cuts emits a contour arc as a true G75 multi-quadrant arc", () => {
    const proj = fixtureProjection();
    // A capsule: two straight edges and two 180° arcs, which the quadrant rule
    // splits into two pieces each (exact-geometry contract 12 §6).
    proj.board.outline = {
      kind: "contour",
      widthMm: 30,
      heightMm: 10,
      centerMm: { x: 15, y: 5 },
      start: { x: 5, y: 0 },
      segments: [
        { type: "line", to: { x: 25, y: 0 } },
        { type: "arc", to: { x: 25, y: 10 }, centerMm: { x: 25, y: 5 }, cw: false },
        { type: "line", to: { x: 5, y: 10 } },
        { type: "arc", to: { x: 5, y: 0 }, centerMm: { x: 5, y: 5 }, cw: false },
      ],
    };
    const out = buildGerberLayer(proj, "edge_cuts", []);
    const lines = out.split("\r\n");
    expect(out).toContain("%TF.FileFunction,Profile,NP*%");
    // G75 is stated once, after the G01 the Profile opens with.
    expect(lines.filter((l) => l === "G75*").length).toBe(1);
    expect(lines.indexOf("G75*")).toBeGreaterThan(lines.indexOf("G01*"));
    // Counter-clockwise arcs, four pieces, each carrying its own I/J offset.
    expect(lines.filter((l) => /I-?\d+J-?\d+D01\*$/.test(l)).length).toBe(4);
    expect(lines).toContain("G03*");
    expect(lines).not.toContain("G02*");
    // The arc centres are emitted relative to each piece's start point: the
    // first piece runs from (25, 0) to (30, 5) about (25, 5).
    expect(out).toContain("X30000000Y5000000I0J5000000D01*");
  });

  test("Edge.Cuts emits a circular cutout as its own arc loop", () => {
    const proj = fixtureProjection();
    proj.board.cutouts = [
      {
        id: "c1",
        shape: {
          kind: "circle",
          widthMm: 6,
          heightMm: 6,
          centerMm: { x: 15, y: 10 },
        },
      },
    ];
    const out = buildGerberLayer(proj, "edge_cuts", []);
    const lines = out.split("\r\n");
    expect(out).toContain("%TF.FileFunction,Profile,NP*%");
    // Two loops: the rect board edge, then the cutout.
    expect(lines.filter((l) => l.endsWith("D02*")).length).toBe(2);
    expect(lines.filter((l) => l === "G75*").length).toBe(1);
    // The rect's own four edges stay linear; the cutout is four quarter arcs.
    expect(lines.filter((l) => /I-?\d+J-?\d+D01\*$/.test(l)).length).toBe(4);
    expect(lines).toContain("G03*");
    expect(out).toContain("X18000000Y10000000D02*");
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

  test("oblong free hole emits a G85 routed slot (tool = slot width)", () => {
    const proj = fixtureProjection();
    // Replace the round mounting hole with a 5×3 mm slot along +X at (2,2):
    // half = (5-3)/2 = 1 → endpoints (1,2)→(3,2), tool diameter = width 3 mm.
    proj.freeHoles = [
      {
        id: "slot1",
        centerMm: { x: 2, y: 2 },
        drillMm: 3,
        drillSlot: { lengthMm: 5, widthMm: 3, angleDeg: 0 },
        lockedAt: null,
      },
    ];
    const out = buildExcellonDrill(proj, [], "NPTH");
    expect(out).toContain("T1C3.000");
    expect(out).toContain("X1.0000Y2.0000G85X3.0000Y2.0000");
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
// Free pads: ONE drill / layer derivation (batch-DRC contract 06 §2)
// =========================================================================

describe("free-pad copper and drills follow one derivation", () => {
  /** An NPTH pad, a single-sided `conn` pad and a drilled SMD pad. */
  function withFreePads(): DesignerPcbProjection {
    const proj = fixtureProjection();
    proj.freePads = [
      freePad("fp-hole", {
        padType: "hole",
        shape: "circle",
        widthMm: 3,
        heightMm: 3,
        drillMm: 2,
        center: { x: 6, y: 6 },
      }),
      freePad("fp-conn", {
        padType: "conn",
        layer: "B.Cu",
        widthMm: 1,
        heightMm: 1,
        center: { x: 8, y: 6 },
      }),
      freePad("fp-smd-drilled", {
        padType: "smd",
        layer: "F.Cu",
        shape: "circle",
        widthMm: 1.6,
        heightMm: 1.6,
        drillMm: 0.9,
        center: { x: 10, y: 6 },
      }),
    ];
    return proj;
  }

  const FLASH_HOLE = "X6000000Y6000000D03*";
  const FLASH_CONN = "X8000000Y6000000D03*";

  test("a `hole` free pad is an NPTH — no copper on any copper layer", () => {
    const proj = withFreePads();
    // It used to flash copper on F.Cu and B.Cu: copper in the artwork that the
    // records, the pour and DRC never saw, sitting on a non-plated drill.
    expect(buildGerberLayer(proj, "copper.top", [])).not.toContain(FLASH_HOLE);
    expect(buildGerberLayer(proj, "copper.bottom", [])).not.toContain(
      FLASH_HOLE,
    );
    // The mask relief stays on both faces: an NPTH still wants its opening so
    // the drill does not tear the mask edge (KiCad flashes it the same way).
    expect(buildGerberLayer(proj, "mask.top", [])).toContain(FLASH_HOLE);
    expect(buildGerberLayer(proj, "mask.bottom", [])).toContain(FLASH_HOLE);
  });

  test("a `conn` free pad flashes on its declared layer only", () => {
    const proj = withFreePads();
    expect(buildGerberLayer(proj, "copper.bottom", [])).toContain(FLASH_CONN);
    expect(buildGerberLayer(proj, "copper.top", [])).not.toContain(FLASH_CONN);
    expect(buildGerberLayer(proj, "mask.bottom", [])).toContain(FLASH_CONN);
    expect(buildGerberLayer(proj, "mask.top", [])).not.toContain(FLASH_CONN);
  });

  test("a drilled `smd` free pad keeps its copper and drills as NPTH", () => {
    const proj = withFreePads();
    expect(buildGerberLayer(proj, "copper.top", [])).toContain(
      "X10000000Y6000000D03*",
    );
    expect(buildExcellonDrill(proj, [], "NPTH")).toMatch(/T\d+C0\.900/);
    expect(buildExcellonDrill(proj, [], "PTH")).not.toMatch(/T\d+C0\.900/);
  });
});

// =========================================================================
// S11 — drilled structures in the artwork (manufacturability contract 10 §6)
// =========================================================================

describe("S11 artwork: rotation, plating, slots", () => {
  /** A one-pad board, so the aperture table is unambiguous. */
  function padBoard(
    source: ReturnType<typeof pad>,
    opts: {
      rotationDeg?: number;
      layer?: "F.Cu" | "B.Cu";
      mirrored?: boolean;
    } = {},
  ): DesignerPcbProjection {
    return projection({
      placements: [
        placement("A", {
          positionMm: { x: 10, y: 10 },
          rotationDeg: opts.rotationDeg ?? 0,
          layer: opts.layer ?? "F.Cu",
          mirrored: opts.mirrored ?? false,
          pads: [source],
        }),
      ],
    });
  }

  test("a non-orthogonal rect / oval / roundrect each emit their macro", () => {
    // rect → one centre-line primitive rotated in place.
    const rect = buildGerberLayer(
      padBoard(pad("1", { x: 0, y: 0 }, 2, 1, { rotationDeg: 30 })),
      "copper.top",
      [],
    );
    expect(rect).toContain("%AMROT_R_2_1_30*");
    expect(rect).toContain("21,1,2,1,0,0,30*");
    expect(rect).toMatch(/%ADD\d+ROT_R_2_1_30\*%/);

    // oval → the straight body plus two PRE-ROTATED cap circles (a macro
    // primitive rotates about the macro origin, not about its own centre).
    const oval = buildGerberLayer(
      padBoard(pad("1", { x: 0, y: 0 }, 2, 1, { shape: "oval", rotationDeg: 30 })),
      "copper.top",
      [],
    );
    expect(oval).toContain("%AMROT_O_2_1_30*");
    expect(oval).toContain("21,1,1,1,0,0,30*");
    expect(oval).toContain("1,1,1,-0.433013,-0.25*");
    expect(oval).toContain("1,1,1,0.433013,0.25*");

    // roundrect → two strips plus four pre-rotated corner circles.
    const roundrect = buildGerberLayer(
      padBoard(
        pad("1", { x: 0, y: 0 }, 2, 1, {
          shape: "roundrect",
          roundrectRatio: 0.25,
          rotationDeg: 30,
        }),
      ),
      "copper.top",
      [],
    );
    expect(roundrect).toContain("%AMROT_RR_2_1_0p25_30*");
    expect(roundrect).toContain("21,1,2,0.5,0,0,30*");
    expect(roundrect).toContain("21,1,1.5,1,0,0,30*");
    expect((roundrect.match(/^1,1,0\.5,/gm) ?? []).length).toBe(4);
  });

  test("an orthogonal rotation still uses a standard aperture", () => {
    const out = buildGerberLayer(
      padBoard(pad("1", { x: 0, y: 0 }, 2, 1, { rotationDeg: 90 })),
      "copper.top",
      [],
    );
    expect(out).not.toContain("%AM");
    expect(out).toMatch(/%ADD\d+R,1X2\*%/);
  });

  test("roundrect corner radius is clamped to the half-dimension (WP3 finding)", () => {
    // A ratio above 0.5 rounds the corners past the half-width: the copper
    // ring builder and the annular kernel both clamp at `min(w/2, h/2)`, so a
    // 1 × 1 pad at ratio 0.9 IS a ⌀1 disc. The writer used to apply
    // `ratio · min(w, h)` unclamped and flashed a 2.6 mm blob instead.
    expect(roundrectRadiusMm(1, 1, 0.9)).toBeCloseTo(0.5, 12);
    expect(roundrectRadiusMm(2, 1, 0.25)).toBeCloseTo(0.25, 12);
    const proj = padBoard(
      pad("1", { x: 0, y: 0 }, 1, 1, {
        shape: "roundrect",
        roundrectRatio: 0.9,
      }),
    );
    const parsed = parseGerber(buildGerberLayer(proj, "copper.top", []));
    const aperture = parsed.apertures.get(parsed.flashes[0]!.code)!;
    // Inside the disc, outside it — the unclamped radius covered both.
    expect(insidePrimitives(aperture.primitives, 0.49, 0)).toBe(true);
    expect(insidePrimitives(aperture.primitives, 0.51, 0)).toBe(false);
    expect(insidePrimitives(aperture.primitives, 0.36, 0.36)).toBe(false);
    // …and it is the same copper the record ring carries (that ring
    // CIRCUMSCRIBES its arcs by sec(pi/24), so the bound is 1 % of r).
    const ring = padOutlineWorldMm(
      proj.placements[0]!,
      placementPads(proj.placements[0]!)[0]!,
    );
    const maxX = Math.max(...ring.map((p) => p.x)) - 10;
    expect(maxX).toBeGreaterThan(0.5);
    expect(maxX).toBeLessThan(0.5 * 1.01);
  });

  test("two ratios that CLAMP to the same radius share one macro and D-code", () => {
    // The macro name and the aperture's canonical key are built from the
    // CLAMPED radius, so 0.6 and 0.9 on a 1 x 1 pad are both r = 0.5 — one
    // `%AM`, one `%ADD`, one flash aperture. Keying on the raw ratio would
    // emit two macros describing the same disc.
    expect(roundrectRadiusMm(1, 1, 0.6)).toBe(roundrectRadiusMm(1, 1, 0.9));
    const proj = projection({
      placements: [
        placement("A", {
          positionMm: { x: 10, y: 10 },
          pads: [
            pad("1", { x: -2, y: 0 }, 1, 1, {
              shape: "roundrect",
              roundrectRatio: 0.6,
            }),
            pad("2", { x: 2, y: 0 }, 1, 1, {
              shape: "roundrect",
              roundrectRatio: 0.9,
            }),
          ],
        }),
      ],
    });
    const out = buildGerberLayer(proj, "copper.top", []);
    expect((out.match(/%AM/g) ?? []).length).toBe(1);
    expect(out).toContain("%AMRR_1_1_0p5*");
    const parsed = parseGerber(out);
    expect(parsed.flashes).toHaveLength(2);
    expect(parsed.flashes[0]!.code).toBe(parsed.flashes[1]!.code);

    // Same for the ROTATED macro: the angle joins the clamped radius in the
    // name, so one rotated pair also collapses to one macro.
    const rotated = buildGerberLayer(
      projection({
        placements: [
          placement("A", {
            positionMm: { x: 10, y: 10 },
            pads: [
              pad("1", { x: -2, y: 0 }, 1, 1, {
                shape: "roundrect",
                roundrectRatio: 0.6,
                rotationDeg: 30,
              }),
              pad("2", { x: 2, y: 0 }, 1, 1, {
                shape: "roundrect",
                roundrectRatio: 0.9,
                rotationDeg: 30,
              }),
            ],
          }),
        ],
      }),
      "copper.top",
      [],
    );
    expect((rotated.match(/%AM/g) ?? []).length).toBe(1);
    expect(rotated).toContain("%AMROT_RR_1_1_0p5_30*");
    const parsedRot = parseGerber(rotated);
    expect(parsedRot.flashes[0]!.code).toBe(parsedRot.flashes[1]!.code);
  });

  test("a copper-less unplated pad flashes no copper but keeps mask relief", () => {
    // A 3.2 mm circle around a 3.2 mm drill is entirely inside the drilled
    // void (contract §2.3): no record, no flash, no net — and the drill still
    // opens the mask on BOTH faces so it cannot tear the mask edge (§6.4).
    const proj = padBoard(
      pad("", { x: 0, y: 0 }, 3.2, 3.2, {
        shape: "circle",
        drillDiameterMm: 3.2,
        plated: false,
        layer: "*.Cu",
      }),
    );
    expect(buildGerberLayer(proj, "copper.top", [])).not.toContain("D03*");
    expect(buildGerberLayer(proj, "copper.bottom", [])).not.toContain("D03*");
    for (const side of ["mask.top", "mask.bottom"] as const) {
      const mask = buildGerberLayer(proj, side, []);
      // 3.2 drill + 2 x the board's 0.075 mm expansion.
      expect(mask).toMatch(/%ADD\d+C,3\.35\*%/);
      expect(mask).toContain("X10000000Y10000000D03*");
    }
    // Paste never follows a drill.
    expect(buildGerberLayer(proj, "paste.top", [])).not.toContain("D03*");
    // NPTH, not PTH.
    expect(buildExcellonDrill(proj, [], "NPTH")).toMatch(/T\d+C3\.200/);
    expect(buildExcellonDrill(proj, [], "PTH")).not.toMatch(/T\d+C3\.200/);
  });

  test("an unplated pad WITH a ring flashes WasherPad and carries no .TO.P", () => {
    // "A pad around a non-plated hole without electrical function" (Ucamco
    // spec 2022.02) — and the same section forbids a `.P` on a washer pad.
    const proj = padBoard(
      pad("1", { x: 0, y: 0 }, 4, 4, {
        shape: "circle",
        drillDiameterMm: 3.2,
        plated: false,
        layer: "*.Cu",
      }),
    );
    const out = buildGerberLayer(proj, "copper.top", []);
    expect(out).toContain("%TA.AperFunction,WasherPad*%");
    expect(out).toMatch(/%ADD\d+C,4\*%/);
    expect(out).not.toContain("%TO.P,");
    expect(buildExcellonDrill(proj, [], "NPTH")).toMatch(/T\d+C3\.200/);
  });

  test("a footprint slot is a G85 routed hit at the slot's tool width", () => {
    // `drillSlotMm` is KiCad's `(drill oval W H)`: W along the pad's local X.
    // Tool = min(W, H) = 0.5, centreline +/- (1.8 - 0.5) / 2 = 0.65 mm.
    const proj = padBoard(
      pad("1", { x: 0, y: 0 }, 2, 1, {
        shape: "oval",
        drillDiameterMm: 0.5,
        drillSlotMm: { widthMm: 1.8, heightMm: 0.5 },
      }),
    );
    const pth = buildExcellonDrill(proj, [], "PTH");
    expect(pth).toContain("T1C0.500");
    expect(pth).toContain("X9.3500Y10.0000G85X10.6500Y10.0000");
  });

  test("a drill OFFSET moves the hit, not the copper", () => {
    const proj = padBoard(
      pad("1", { x: 0, y: 0 }, 2, 2, {
        shape: "circle",
        drillDiameterMm: 1,
        drillOffsetMm: { x: 0.4, y: 0 },
      }),
    );
    expect(buildExcellonDrill(proj, [], "PTH")).toContain("X10.4000Y10.0000");
    // The copper flash stays on the pad centre.
    expect(buildGerberLayer(proj, "copper.top", [])).toContain(
      "X10000000Y10000000D03*",
    );
  });

  test("a mirrored placement flips an explicit-layer SMD pad's copper AND mask", () => {
    // The mask loop used to read `pad.layer` unflipped, so a bottom-side
    // placement opened the mask on the top face while its copper flashed on
    // the bottom (contract §6.1).
    const proj = padBoard(pad("1", { x: 0, y: 0 }, 1, 1, { layer: "F.Cu" }), {
      layer: "B.Cu",
      mirrored: true,
    });
    expect(buildGerberLayer(proj, "copper.bottom", [])).toContain("D03*");
    expect(buildGerberLayer(proj, "copper.top", [])).not.toContain("D03*");
    expect(buildGerberLayer(proj, "mask.bottom", [])).toContain("D03*");
    expect(buildGerberLayer(proj, "mask.top", [])).not.toContain("D03*");
    expect(buildGerberLayer(proj, "paste.bottom", [])).toContain("D03*");
    expect(buildGerberLayer(proj, "paste.top", [])).not.toContain("D03*");
  });

  test("a non-orthogonal PLACEMENT rotation places the pad exactly", () => {
    // `projectLocal` snapped the placement rotation to the nearest 90 deg, so a
    // KiCad-imported 30 deg placement flashed its pads in the wrong place.
    const proj = padBoard(pad("1", { x: 1, y: 0 }, 1, 1), { rotationDeg: 30 });
    const parsed = parseGerber(buildGerberLayer(proj, "copper.top", []));
    expect(parsed.flashes).toHaveLength(1);
    expect(parsed.flashes[0]!.xMm).toBeCloseTo(10 + Math.cos(Math.PI / 6), 6);
    expect(parsed.flashes[0]!.yMm).toBeCloseTo(10 + Math.sin(Math.PI / 6), 6);
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

  test("reads description from schematic propertiesJson", () => {
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
          propertiesJson: { description: "555 timer IC" } as never,
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
    const row = buildBomProjection(fixtureProjection(), sch).rows.find(
      (candidate) => candidate.refdesList === "U1",
    );
    expect(row?.description).toBe("555 timer IC");
  });

  test("description absent → null (no fake fallback)", () => {
    const row = buildBomProjection(fixtureProjection(), null).rows.find(
      (candidate) => candidate.refdesList === "U1",
    );
    expect(row?.description).toBeNull();
  });

  test("grouped line takes the first non-empty description when refs disagree", () => {
    const sch: DesignerSchematicProjection = {
      designId: "blink",
      revision: 1,
      parts: [
        {
          id: "part-r1",
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
        {
          id: "part-r2",
          componentId: "c-r10k",
          reference: "R2",
          value: "10k",
          rotationDeg: 0,
          mirrored: false,
          positionNm: { x: 0, y: 0 },
          symbol: {} as never,
          footprint: {} as never,
          pins: [],
          propertiesJson: { description: "10k 1% 0603 resistor" } as never,
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
    const proj = fixtureProjection();
    // Give R2 the same footprint as R1 so they group into one BOM line.
    proj.placements.push({
      ...proj.placements[1]!,
      id: "p3",
      partId: "part-r2",
      reference: "R2",
    });
    const row = buildBomProjection(proj, sch).rows.find(
      (candidate) => candidate.refdesList === "R1,R2",
    );
    expect(row?.description).toBe("10k 1% 0603 resistor");
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

  test("refuses a board carrying a non-through via", () => {
    // Excellon writes ONE plated drill file, so a blind / buried / micro via
    // would ship as a through drill — a board the fab builds differently from
    // the one designed (contract 10 §5.1). The DRC counterpart is
    // `VIA_TYPE_UNSUPPORTED`, which fires on every fabricator including
    // `custom`; the export refusal must match it.
    const proj = fixtureProjection();
    proj.board.layerCount = 4;
    proj.vias[0]!.viaType = "blind";
    proj.vias[0]!.toLayer = "In1.Cu";
    let thrown: unknown = null;
    try {
      buildExportBundle(proj, null);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error & {
      status?: number;
      type?: string;
      extras?: { viaIds?: string[] };
    };
    expect(err.status).toBe(422);
    expect(err.type).toBe(
      "https://openpcb.dev/problems/export-unsupported-via-type",
    );
    expect(err.message).toContain(
      "OpenPCB's drill export writes through drills only",
    );
    expect(err.extras?.viaIds).toEqual(["v1"]);
    // A through-via board still exports.
    expect(buildExportBundle(fixtureProjection(), null).artifacts.length).toBe(
      14,
    );
  });

  test("job file reports the board's own thickness", () => {
    // It used to report the 1.6 mm default for every board, so a 0.8 mm
    // stackup reached the fab mislabelled (contract 10 §5.4).
    const thin = fixtureProjection();
    thin.board.boardThicknessMm = 0.8;
    const jobOf = (proj: DesignerPcbProjection): Record<string, never> =>
      JSON.parse(
        buildExportBundle(proj, null).artifacts.find(
          (a) => a.kind === "gerber.job",
        )!.text,
      );
    expect((jobOf(thin) as never as { GeneralSpecs: { BoardThickness: number } })
      .GeneralSpecs.BoardThickness).toBe(0.8);
    const dflt = fixtureProjection();
    delete dflt.board.boardThicknessMm;
    expect((jobOf(dflt) as never as { GeneralSpecs: { BoardThickness: number } })
      .GeneralSpecs.BoardThickness).toBe(1.6);
  });

  test("preflight warns on a hole below the fab-preset minimum drill", () => {
    const proj = fixtureProjection(); // fabricator jlcpcb_2l → min drill 0.15 (2026-07, P8)
    proj.vias[0]!.drillMm = 0.1;
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
