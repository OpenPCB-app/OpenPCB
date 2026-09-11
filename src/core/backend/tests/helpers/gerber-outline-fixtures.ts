/**
 * The synthetic outline corpus the Profile parity harness runs beside the
 * goldens (exact-geometry contract 12 §6 / §9).
 *
 * Every case exists because a specific reading could go wrong: an axis or a
 * direction convention (the quadrant contours), a quadrant slice that survives
 * quantisation as nothing (Astra run 1 #14 and its sharpened twin), the radius
 * residual a shared quantised centre leaves at micron scale (#15), the derived
 * closing segment of a DXF-shaped contour (§2.1), the ellipse that has no
 * circular form at all (§2.4), and the two shapes that must come out of the
 * writer byte-identical to the pre-arc Profile (rect and polygon).
 */
import type {
  PcbBoardCutout,
  PcbBoardOutline,
  PcbPointMm,
} from "../../../../sdks/designer/types";

/** A point on the circle of radius `r` about the origin at `deg`. */
function polar(r: number, deg: number): PcbPointMm {
  const rad = (deg * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
}

/**
 * A closed contour of four 90° arcs about the origin, each STARTING mid-quadrant
 * so every one of them is split at a quadrant boundary — the four quadrants in
 * both directions, which is where an axis or a sign error shows up.
 */
function quadrantContour(cw: boolean): PcbBoardOutline {
  const r = 10;
  const step = cw ? -90 : 90;
  return {
    kind: "contour",
    widthMm: 2 * r,
    heightMm: 2 * r,
    centerMm: { x: 0, y: 0 },
    start: polar(r, 45),
    segments: [1, 2, 3, 4].map((k) => ({
      type: "arc" as const,
      to: polar(r, 45 + step * k),
      centerMm: { x: 0, y: 0 },
      cw,
    })),
  };
}

export const SYNTHETIC: Array<[string, PcbBoardOutline, PcbBoardCutout[]]> = [
  [
    "rect",
    { kind: "rect", widthMm: 30, heightMm: 20, centerMm: { x: 15, y: 10 } },
    [],
  ],
  [
    "polygon",
    {
      kind: "polygon",
      widthMm: 30,
      heightMm: 20,
      centerMm: { x: 15, y: 10 },
      pointsMm: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 20 },
        { x: 0, y: 20 },
      ],
    },
    [],
  ],
  [
    "roundrect-r15",
    {
      kind: "roundrect",
      widthMm: 80,
      heightMm: 60,
      cornerRadiusMm: 15,
      centerMm: { x: 0, y: 0 },
    },
    [],
  ],
  [
    "circle",
    { kind: "circle", widthMm: 20, heightMm: 20, centerMm: { x: 0, y: 0 } },
    [],
  ],
  ["quadrants-ccw", quadrantContour(false), []],
  ["quadrants-cw", quadrantContour(true), []],
  [
    // Astra run 1 #14: an arc that starts a hair off a quadrant boundary.
    "astra-14",
    {
      kind: "contour",
      widthMm: 4,
      heightMm: 2,
      centerMm: { x: -0.5, y: 0.5 },
      start: { x: -1.999999, y: 1 },
      segments: [
        {
          type: "arc",
          to: { x: 0.000001, y: 1 },
          centerMm: { x: -1, y: 0 },
          cw: true,
        },
        { type: "arc", to: { x: 1, y: 0 }, centerMm: { x: 0, y: 0 }, cw: true },
        { type: "line", to: { x: -1.999999, y: 1 } },
      ],
    },
    [],
  ],
  [
    // The same trap, sharpened: the first slice spans 1e-7 rad, so BOTH its
    // quantised endpoints land on the same nanometre and the piece is dropped.
    "sub-quantum-slice",
    {
      kind: "contour",
      widthMm: 2,
      heightMm: 2,
      centerMm: { x: 0, y: 0 },
      start: {
        x: Math.cos(Math.PI / 2 + 1e-7),
        y: Math.sin(Math.PI / 2 + 1e-7),
      },
      segments: [
        { type: "arc", to: { x: 1, y: 0 }, centerMm: { x: 0, y: 0 }, cw: true },
        { type: "line", to: { x: 0, y: 0 } },
      ],
    },
    [],
  ],
  [
    // Astra run 1 #15: a 2 µm arc, where 1 nm rounding is 0.06 % of the radius.
    "astra-15",
    {
      kind: "contour",
      widthMm: 0.0045,
      heightMm: 0.0045,
      centerMm: { x: 0, y: 0 },
      start: { x: 0.001, y: 0.002005 },
      segments: [
        {
          type: "arc",
          to: { x: 0.0015, y: 0.000559 },
          centerMm: { x: 0, y: 0 },
          cw: false,
        },
      ],
    },
    [],
  ],
  [
    // A DXF-shaped contour: the authored segments stop short of `start`, so the
    // canonical ring carries an explicit closing SEGMENT (12 §2.1).
    "dxf-closing-segment",
    {
      kind: "contour",
      widthMm: 25,
      heightMm: 10,
      centerMm: { x: 12.5, y: 5 },
      start: { x: 0, y: 0 },
      segments: [
        { type: "line", to: { x: 20, y: 0 } },
        {
          type: "arc",
          to: { x: 20, y: 10 },
          centerMm: { x: 20, y: 5 },
          cw: false,
        },
        { type: "line", to: { x: 0, y: 10 } },
      ],
    },
    [],
  ],
  [
    "cutouts-every-kind",
    { kind: "rect", widthMm: 80, heightMm: 60, centerMm: { x: 0, y: 0 } },
    [
      {
        id: "circle",
        shape: {
          kind: "circle",
          widthMm: 6,
          heightMm: 6,
          centerMm: { x: 20, y: 10 },
        },
      },
      {
        id: "roundrect",
        shape: {
          kind: "roundrect",
          widthMm: 10,
          heightMm: 4,
          cornerRadiusMm: 2,
          centerMm: { x: -20, y: 12 },
        },
      },
      {
        // An ELLIPSE has no circular-arc form: chords everywhere, incl. here.
        id: "ellipse",
        shape: {
          kind: "circle",
          widthMm: 12,
          heightMm: 6,
          centerMm: { x: 0, y: -18 },
        },
      },
      {
        id: "contour",
        shape: {
          kind: "contour",
          widthMm: 8,
          heightMm: 8,
          centerMm: { x: -24, y: -14 },
          start: { x: -28, y: -18 },
          segments: [
            { type: "line", to: { x: -20, y: -18 } },
            {
              type: "arc",
              to: { x: -20, y: -10 },
              centerMm: { x: -20, y: -14 },
              cw: false,
            },
            { type: "line", to: { x: -28, y: -10 } },
            { type: "line", to: { x: -28, y: -18 } },
          ],
        },
      },
    ],
  ],
];
