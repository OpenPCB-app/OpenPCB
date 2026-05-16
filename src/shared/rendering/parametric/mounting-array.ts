/**
 * Parametric mounting hole array generator.
 *
 * Lays out an N×M grid of mechanical mounting holes. Pads are non-electrical
 * (no copper / no number); each hole is a plated-through pad with a drill if
 * `plated=true`, otherwise an unplated hole rendered via the drill list.
 *
 * No symbol is generated — mounting arrays exist on the PCB side only.
 */

import type {
  FootprintRenderSource,
  FootprintRenderSourcePad,
  PreviewGraphic,
} from "../types";
import type { ParamSchema, ParamValues } from "./param-schema";

export const MOUNTING_ARRAY_SCHEMA: ParamSchema = {
  fields: [
    { kind: "int", key: "rows", label: "Rows", min: 1, max: 6, default: 2 },
    {
      kind: "int",
      key: "cols",
      label: "Columns",
      min: 1,
      max: 6,
      default: 2,
    },
    {
      kind: "float",
      key: "pitchXMm",
      label: "Pitch X",
      unit: "mm",
      min: 1,
      max: 100,
      default: 20,
      step: 0.1,
    },
    {
      kind: "float",
      key: "pitchYMm",
      label: "Pitch Y",
      unit: "mm",
      min: 1,
      max: 100,
      default: 20,
      step: 0.1,
    },
    {
      kind: "float",
      key: "drillMm",
      label: "Drill",
      unit: "mm",
      min: 0.8,
      max: 8,
      default: 3.2,
      step: 0.1,
    },
    {
      kind: "bool",
      key: "plated",
      label: "Plated",
      default: false,
    },
  ],
};

export interface MountingArrayParams {
  readonly rows: number;
  readonly cols: number;
  readonly pitchXMm: number;
  readonly pitchYMm: number;
  readonly drillMm: number;
  readonly plated: boolean;
}

export interface MountingArrayResult {
  readonly source: FootprintRenderSource;
  readonly name: string;
  readonly mountType: "through_hole";
  readonly packageCode: string;
  readonly tags: readonly string[];
}

export function paramsFromValues(values: ParamValues): MountingArrayParams {
  return {
    rows: values.rows as number,
    cols: values.cols as number,
    pitchXMm: values.pitchXMm as number,
    pitchYMm: values.pitchYMm as number,
    drillMm: values.drillMm as number,
    plated: values.plated as boolean,
  };
}

export function generateMountingArray(
  params: MountingArrayParams,
): MountingArrayResult {
  const { rows, cols, pitchXMm, pitchYMm, drillMm, plated } = params;
  const padDiameterMm = drillMm + (plated ? 1.0 : 0.4);
  const xOffset = -((cols - 1) * pitchXMm) / 2;
  const yOffset = -((rows - 1) * pitchYMm) / 2;
  const pads: FootprintRenderSourcePad[] = [];
  let n = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pads.push({
        id: `hole-${n}`,
        number: "",
        shape: "circle",
        centerMm: { x: xOffset + c * pitchXMm, y: yOffset + r * pitchYMm },
        widthMm: padDiameterMm,
        heightMm: padDiameterMm,
        rotationDeg: 0,
        drillDiameterMm: drillMm,
        layer: plated ? "F.Cu" : "Edge.Cuts",
      });
      n++;
    }
  }

  // Silkscreen courtyard rectangle.
  const halfW = ((cols - 1) * pitchXMm) / 2 + padDiameterMm / 2 + 0.5;
  const halfH = ((rows - 1) * pitchYMm) / 2 + padDiameterMm / 2 + 0.5;
  const graphics: PreviewGraphic[] = [
    {
      kind: "rect",
      layer: "F.SilkS",
      strokeWidthMm: 0.12,
      x: -halfW,
      y: -halfH,
      width: halfW * 2,
      height: halfH * 2,
      fill: "none",
    },
  ];

  const name = `Mounting Array ${rows}x${cols} ${drillMm.toFixed(1)}mm`;
  const packageCode = `MOUNT_${rows}x${cols}_${drillMm.toFixed(1).replace(".", "_")}mm`;
  const tags: readonly string[] = [
    "mechanical",
    "mounting",
    plated ? "plated" : "unplated",
    `${drillMm.toFixed(1)}mm`,
    `${rows}x${cols}`,
  ];

  return {
    source: { name, pads, graphics, labels: [], warnings: [] },
    name,
    mountType: "through_hole",
    packageCode,
    tags,
  };
}
