/**
 * Programmatic 555 astable LED-blinker fixture for fab-export validation.
 *
 * A small but realistic 2-layer board exercising every export artifact:
 *  - through-hole parts (NE555 DIP-8, 2-pin power header) → PTH drills
 *  - SMD parts (3× 0603 resistors, 0805 cap, 0603 cap, 0805 LED) → paste layer
 *  - copper traces on both F.Cu and B.Cu joined by a through via
 *  - 2 mounting holes → NPTH drills
 *  - a matching schematic projection (refdes + value) → BOM rows
 *
 * Built as plain projection objects (mirrors the surrogate in
 * designer-export.test.ts) so the fixture is deterministic, diff-friendly, and
 * needs no DB. Consumed by designer-555-export.test.ts and reusable for manual
 * GerbView validation (see docs/validation/555-blinker-gerbview.md).
 */
import type {
  DesignerPcbProjection,
  DesignerSchematicProjection,
} from "../../../../sdks/designer/types";

const MM = 1_000_000; // nm per mm

interface Pad {
  id: string;
  number: string;
  shape: string;
  centerMm: { x: number; y: number };
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
  drillDiameterMm?: number;
  layer?: string;
}

function footprint(
  name: string,
  mountType: "through_hole" | "smd",
  pads: Pad[],
) {
  return {
    footprintId: `fp-${name}`,
    name,
    mountType,
    sourceHash: null,
    preview: {
      kind: "footprint" as const,
      units: "mm" as const,
      name,
      pads,
      graphics: [],
      labels: [],
      bounds: null,
      warnings: [],
    },
  };
}

/** N-pad DIP, two rows, 2.54 mm pitch, 7.62 mm row spacing, circular THT pads. */
function dipFootprint(pinCount: number) {
  const perRow = pinCount / 2;
  const pads: Pad[] = [];
  const pitch = 2.54;
  const halfSpan = ((perRow - 1) * pitch) / 2;
  for (let i = 0; i < perRow; i += 1) {
    pads.push({
      id: `pad-${i + 1}`,
      number: `${i + 1}`,
      shape: i === 0 ? "rect" : "circle",
      centerMm: { x: -halfSpan + i * pitch, y: -3.81 },
      widthMm: 1.6,
      heightMm: 1.6,
      rotationDeg: 0,
      drillDiameterMm: 0.8,
    });
  }
  for (let i = 0; i < perRow; i += 1) {
    const number = pinCount - i;
    pads.push({
      id: `pad-${number}`,
      number: `${number}`,
      shape: "circle",
      centerMm: { x: -halfSpan + i * pitch, y: 3.81 },
      widthMm: 1.6,
      heightMm: 1.6,
      rotationDeg: 0,
      drillDiameterMm: 0.8,
    });
  }
  return footprint(`DIP-${pinCount}`, "through_hole", pads);
}

/** 2-terminal SMD chip footprint (resistor / cap / LED). */
function chipFootprint(
  name: string,
  padWmm: number,
  padHmm: number,
  pitchMm: number,
) {
  const half = pitchMm / 2;
  return footprint(name, "smd", [
    {
      id: "pad-1",
      number: "1",
      shape: "rect",
      centerMm: { x: -half, y: 0 },
      widthMm: padWmm,
      heightMm: padHmm,
      rotationDeg: 0,
      layer: "F.Cu",
    },
    {
      id: "pad-2",
      number: "2",
      shape: "rect",
      centerMm: { x: half, y: 0 },
      widthMm: padWmm,
      heightMm: padHmm,
      rotationDeg: 0,
      layer: "F.Cu",
    },
  ]);
}

/** 1×2 through-hole pin header, 2.54 mm pitch. */
function header2Footprint() {
  return footprint("PinHeader_1x02_P2.54mm", "through_hole", [
    {
      id: "pad-1",
      number: "1",
      shape: "rect",
      centerMm: { x: -1.27, y: 0 },
      widthMm: 1.7,
      heightMm: 1.7,
      rotationDeg: 0,
      drillDiameterMm: 1.0,
    },
    {
      id: "pad-2",
      number: "2",
      shape: "circle",
      centerMm: { x: 1.27, y: 0 },
      widthMm: 1.7,
      heightMm: 1.7,
      rotationDeg: 0,
      drillDiameterMm: 1.0,
    },
  ]);
}

const r0603 = () => chipFootprint("R_0603_1608Metric", 0.95, 1.0, 1.65);
const c0603 = () => chipFootprint("C_0603_1608Metric", 0.95, 1.0, 1.65);
const c0805 = () => chipFootprint("C_0805_2012Metric", 1.15, 1.4, 2.0);
const led0805 = () => chipFootprint("LED_0805_2012Metric", 1.15, 1.4, 2.0);

interface PartSpec {
  id: string;
  componentId: string;
  reference: string;
  value: string;
  pos: { x: number; y: number };
  rotationDeg: number;
  footprint: ReturnType<typeof footprint>;
}

const PARTS: PartSpec[] = [
  {
    id: "p-u1",
    componentId: "c-ne555",
    reference: "U1",
    value: "NE555P",
    pos: { x: 20, y: 15 },
    rotationDeg: 0,
    footprint: dipFootprint(8),
  },
  {
    id: "p-r1",
    componentId: "c-r-100k",
    reference: "R1",
    value: "100k",
    pos: { x: 12, y: 6 },
    rotationDeg: 0,
    footprint: r0603(),
  },
  {
    id: "p-r2",
    componentId: "c-r-100k",
    reference: "R2",
    value: "100k",
    pos: { x: 12, y: 9 },
    rotationDeg: 0,
    footprint: r0603(),
  },
  {
    id: "p-r3",
    componentId: "c-r-330",
    reference: "R3",
    value: "330",
    pos: { x: 30, y: 6 },
    rotationDeg: 0,
    footprint: r0603(),
  },
  {
    id: "p-c1",
    componentId: "c-c-10u",
    reference: "C1",
    value: "10uF",
    pos: { x: 12, y: 22 },
    rotationDeg: 90,
    footprint: c0805(),
  },
  {
    id: "p-c2",
    componentId: "c-c-100n",
    reference: "C2",
    value: "100nF",
    pos: { x: 28, y: 22 },
    rotationDeg: 90,
    footprint: c0603(),
  },
  {
    id: "p-d1",
    componentId: "c-led-red",
    reference: "D1",
    value: "LED",
    pos: { x: 34, y: 6 },
    rotationDeg: 0,
    footprint: led0805(),
  },
  {
    id: "p-j1",
    componentId: "c-hdr-1x02",
    reference: "J1",
    value: "Conn_01x02",
    pos: { x: 5, y: 15 },
    rotationDeg: 90,
    footprint: header2Footprint(),
  },
];

export function build555BlinkerPcb(): DesignerPcbProjection {
  return {
    designId: "blink555",
    revision: 1,
    board: {
      outline: {
        kind: "rect",
        widthMm: 40,
        heightMm: 30,
        centerMm: { x: 20, y: 15 },
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
      tracePresets: [0.25],
      fabricator: "jlcpcb_2l",
      layerCount: 2,
      displayMode: "normal",
      solderMaskExpansionMm: 0.05,
      solderPasteExpansionMm: 0,
      updatedAt: new Date(0).toISOString(),
    },
    placements: PARTS.map((p) => ({
      id: p.id,
      partId: p.id,
      componentId: p.componentId,
      reference: p.reference,
      positionMm: p.pos,
      rotationDeg: p.rotationDeg,
      mirrored: false,
      layer: "F.Cu",
      footprint: p.footprint,
    })) as unknown as DesignerPcbProjection["placements"],
    traces: [
      // VCC rail on F.Cu: header → U1 pin 8.
      {
        id: "t-vcc",
        netId: "n-vcc",
        netClassId: "nc-default",
        layer: "F.Cu",
        widthMm: 0.3,
        pointsNm: [
          { x: 5 * MM, y: 13.73 * MM },
          { x: 5 * MM, y: 11 * MM },
          { x: 25.08 * MM, y: 11 * MM },
        ],
        segmentMode: "manhattan-90",
      },
      // OUT → R3 on F.Cu (45° elbow).
      {
        id: "t-out",
        netId: "n-out",
        netClassId: "nc-default",
        layer: "F.Cu",
        widthMm: 0.25,
        pointsNm: [
          { x: 22.54 * MM, y: 11.19 * MM },
          { x: 27 * MM, y: 6 * MM },
          { x: 29.175 * MM, y: 6 * MM },
        ],
        segmentMode: "manhattan-45",
      },
      // GND return routed on B.Cu (exercises bottom copper).
      {
        id: "t-gnd",
        netId: "n-gnd",
        netClassId: "nc-default",
        layer: "B.Cu",
        widthMm: 0.3,
        pointsNm: [
          { x: 5 * MM, y: 16.27 * MM },
          { x: 5 * MM, y: 25 * MM },
          { x: 35 * MM, y: 25 * MM },
        ],
        segmentMode: "manhattan-90",
      },
    ],
    vias: [
      {
        id: "v-gnd",
        netId: "n-gnd",
        netClassId: "nc-default",
        centerMm: { x: 16.19, y: 18.81 },
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
      { id: "mh1", centerMm: { x: 3, y: 3 }, drillMm: 3.2, lockedAt: null },
      { id: "mh2", centerMm: { x: 37, y: 27 }, drillMm: 3.2, lockedAt: null },
    ],
    freePads: [],
    overlayTexts: [],
    overlayShapes: [],
    zones: [],
    ratsnest: [],
    netNames: { "n-vcc": "VCC", "n-gnd": "GND", "n-out": "OUT" },
    warnings: [],
  } as unknown as DesignerPcbProjection;
}

export function build555BlinkerSchematic(): DesignerSchematicProjection {
  return {
    designId: "blink555",
    revision: 1,
    parts: PARTS.map((p) => ({
      id: p.id,
      componentId: p.componentId,
      reference: p.reference,
      value: p.value,
      rotationDeg: 0,
      mirrored: false,
      positionNm: { x: 0, y: 0 },
      symbol: {} as never,
      footprint: {} as never,
      pins: [],
      propertiesJson: {} as never,
    })),
    wires: [],
    labels: [],
    primitives: [],
    junctions: [],
    nets: [],
    derivedNets: [],
    designName: "555 LED Blinker",
    sheetSize: "A4",
    updatedAt: new Date(0).toISOString(),
  } as unknown as DesignerSchematicProjection;
}

/** Distinct component count (BOM line groups). */
export const BLINKER_REFERENCES = PARTS.map((p) => p.reference);
