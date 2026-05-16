/**
 * Parametric pin header generator.
 *
 * Family covers the bulk of common pin-headers: N rows × M pins per row, at
 * a chosen pitch, in THT or SMD, vertical or horizontal orientation.
 *
 * Output is a `FootprintRenderSource` ready for `buildFootprintRenderModel`,
 * plus metadata (name, mountType, packageCode, tags) that the library module
 * uses to commit a `library_components` row.
 *
 * Pad numbering follows the standard 1-N-2-M-3-... column-major convention
 * (KiCad / Altium default).
 */

import type {
  FootprintRenderSource,
  FootprintRenderSourcePad,
  PreviewGraphic,
  PreviewLabel,
} from "../types";
import type { ParamSchema, ParamValues } from "./param-schema";

export const PIN_HEADER_SCHEMA: ParamSchema = {
  fields: [
    {
      kind: "int",
      key: "rows",
      label: "Rows",
      min: 1,
      max: 4,
      default: 1,
    },
    {
      kind: "int",
      key: "pinsPerRow",
      label: "Pins per row",
      min: 1,
      max: 80,
      default: 4,
    },
    {
      kind: "float",
      key: "pitchMm",
      label: "Pitch",
      unit: "mm",
      min: 0.5,
      max: 5.08,
      default: 2.54,
      step: 0.01,
    },
    {
      kind: "enum",
      key: "mount",
      label: "Mount",
      options: [
        { value: "tht", label: "Through-hole (THT)" },
        { value: "smd", label: "Surface-mount (SMD)" },
      ],
      default: "tht",
    },
    {
      kind: "enum",
      key: "orientation",
      label: "Orientation",
      options: [
        { value: "vertical", label: "Vertical" },
        { value: "horizontal", label: "Horizontal" },
      ],
      default: "vertical",
    },
  ],
};

export interface PinHeaderParams {
  readonly rows: number;
  readonly pinsPerRow: number;
  readonly pitchMm: number;
  readonly mount: "tht" | "smd";
  readonly orientation: "vertical" | "horizontal";
}

export interface PinHeaderResult {
  readonly source: FootprintRenderSource;
  readonly name: string;
  readonly mountType: "smd" | "through_hole";
  readonly packageCode: string;
  readonly tags: readonly string[];
}

export function paramsFromValues(values: ParamValues): PinHeaderParams {
  return {
    rows: values.rows as number,
    pinsPerRow: values.pinsPerRow as number,
    pitchMm: values.pitchMm as number,
    mount: values.mount as "tht" | "smd",
    orientation: values.orientation as "vertical" | "horizontal",
  };
}

function thtPadDimensions(pitchMm: number): {
  width: number;
  height: number;
  drill: number;
} {
  // IPC 2.54 mm pin header: round pad ~1.7 mm with 1.02 mm drill.
  // Scale linearly for non-standard pitches.
  const scale = pitchMm / 2.54;
  return {
    width: Math.max(1.4, 1.7 * scale),
    height: Math.max(1.4, 1.7 * scale),
    drill: Math.max(0.7, 1.02 * scale),
  };
}

function smdPadDimensions(pitchMm: number): { width: number; height: number } {
  const scale = pitchMm / 2.54;
  return {
    width: Math.max(0.6, 0.8 * scale),
    height: Math.max(1.4, 1.8 * scale),
  };
}

export function generatePinHeader(params: PinHeaderParams): PinHeaderResult {
  const { rows, pinsPerRow, pitchMm, mount, orientation } = params;
  const tht = mount === "tht";

  // Pin grid is centered on the origin. For horizontal orientation we keep
  // the same geometry but the silkscreen body sits along Y instead of X.
  const colOffset = -((pinsPerRow - 1) * pitchMm) / 2;
  const rowOffset = -((rows - 1) * pitchMm) / 2;

  const pads: FootprintRenderSourcePad[] = [];
  let n = 1;
  for (let col = 0; col < pinsPerRow; col++) {
    for (let row = 0; row < rows; row++) {
      const xMm = colOffset + col * pitchMm;
      const yMm = rowOffset + row * pitchMm;
      if (tht) {
        const d = thtPadDimensions(pitchMm);
        pads.push({
          id: `pad-${n}`,
          number: String(n),
          // Pin 1 is square-ish for visual identification (industry conv).
          shape: n === 1 ? "rect" : "oval",
          centerMm:
            orientation === "vertical"
              ? { x: xMm, y: yMm }
              : { x: yMm, y: xMm },
          widthMm: d.width,
          heightMm: d.height,
          rotationDeg: 0,
          drillDiameterMm: d.drill,
          layer: "F.Cu",
        });
      } else {
        const d = smdPadDimensions(pitchMm);
        pads.push({
          id: `pad-${n}`,
          number: String(n),
          shape: "rect",
          centerMm:
            orientation === "vertical"
              ? { x: xMm, y: yMm }
              : { x: yMm, y: xMm },
          widthMm: d.width,
          heightMm: d.height,
          rotationDeg: 0,
          layer: "F.Cu",
        });
      }
      n++;
    }
  }

  // Silkscreen body — rectangle inset slightly from the pad grid.
  const bodyMarginMm = pitchMm * 0.4;
  const halfWidth = ((pinsPerRow - 1) * pitchMm) / 2 + bodyMarginMm;
  const halfHeight = ((rows - 1) * pitchMm) / 2 + bodyMarginMm;
  const ox =
    orientation === "vertical"
      ? { x: halfWidth, y: halfHeight }
      : { x: halfHeight, y: halfWidth };
  const graphics: PreviewGraphic[] = [
    {
      kind: "rect",
      layer: "F.SilkS",
      strokeWidthMm: 0.12,
      x: -ox.x,
      y: -ox.y,
      width: ox.x * 2,
      height: ox.y * 2,
      fill: "none",
    },
  ];

  const labels: PreviewLabel[] = [
    {
      id: "ref",
      layer: "F.SilkS",
      text: "${REFERENCE}",
      at: { x: 0, y: -ox.y - 0.6 },
      fontSizeMm: 1.0,
      rotationDeg: 0,
      anchorX: "center",
      anchorY: "bottom",
      role: "reference",
    },
  ];

  const orientationTag = orientation === "horizontal" ? "right-angle" : "vert";
  const mountTag = tht ? "tht" : "smd";
  const sizeLabel = `${rows.toString().padStart(2, "0")}x${pinsPerRow
    .toString()
    .padStart(2, "0")}`;
  const name = `Pin Header ${sizeLabel} ${pitchMm.toFixed(2)}mm ${mountTag.toUpperCase()} ${orientation}`;
  const packageCode = `PIN_HEADER_${sizeLabel}_${pitchMm.toFixed(2).replace(".", "_")}mm`;
  const tags: string[] = [
    "connector",
    "pinheader",
    `${pitchMm.toFixed(2)}mm`,
    sizeLabel,
    mountTag,
    orientationTag,
  ];

  return {
    source: {
      name,
      pads,
      graphics,
      labels,
      warnings: [],
    },
    name,
    mountType: tht ? "through_hole" : "smd",
    packageCode,
    tags,
  };
}
