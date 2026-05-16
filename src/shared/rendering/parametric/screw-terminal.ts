/**
 * Parametric screw terminal generator. Single-row block, N poles, with the
 * common 3.5 / 3.81 / 5.0 / 5.08 mm pitches plus user-overridable values.
 *
 * Single row only in v1 — multi-row terminals are uncommon and out of scope.
 */

import type {
  FootprintRenderSource,
  FootprintRenderSourcePad,
  PreviewGraphic,
} from "../types";
import type { ParamSchema, ParamValues } from "./param-schema";

export const SCREW_TERMINAL_SCHEMA: ParamSchema = {
  fields: [
    {
      kind: "int",
      key: "poles",
      label: "Poles",
      min: 2,
      max: 24,
      default: 2,
    },
    {
      kind: "float",
      key: "pitchMm",
      label: "Pitch",
      unit: "mm",
      min: 2.54,
      max: 10.16,
      default: 5.08,
      step: 0.01,
    },
    {
      kind: "float",
      key: "drillMm",
      label: "Drill",
      unit: "mm",
      min: 0.8,
      max: 2.5,
      default: 1.3,
      step: 0.05,
    },
  ],
};

export interface ScrewTerminalParams {
  readonly poles: number;
  readonly pitchMm: number;
  readonly drillMm: number;
}

export interface ScrewTerminalResult {
  readonly source: FootprintRenderSource;
  readonly name: string;
  readonly mountType: "through_hole";
  readonly packageCode: string;
  readonly tags: readonly string[];
}

export function paramsFromValues(values: ParamValues): ScrewTerminalParams {
  return {
    poles: values.poles as number,
    pitchMm: values.pitchMm as number,
    drillMm: values.drillMm as number,
  };
}

export function generateScrewTerminal(
  params: ScrewTerminalParams,
): ScrewTerminalResult {
  const { poles, pitchMm, drillMm } = params;
  const padDiameterMm = drillMm + 1.0;
  const xOffset = -((poles - 1) * pitchMm) / 2;
  const pads: FootprintRenderSourcePad[] = [];
  for (let i = 0; i < poles; i++) {
    pads.push({
      id: `pad-${i + 1}`,
      number: String(i + 1),
      shape: i === 0 ? "rect" : "circle",
      centerMm: { x: xOffset + i * pitchMm, y: 0 },
      widthMm: padDiameterMm,
      heightMm: padDiameterMm,
      rotationDeg: 0,
      drillDiameterMm: drillMm,
      layer: "F.Cu",
    });
  }

  // Body height proportional to pitch (real screw terminals ~ 1.5x pitch tall).
  const bodyDepth = pitchMm * 1.8;
  const halfW = ((poles - 1) * pitchMm) / 2 + pitchMm * 0.6;
  const graphics: PreviewGraphic[] = [
    {
      kind: "rect",
      layer: "F.SilkS",
      strokeWidthMm: 0.12,
      x: -halfW,
      y: -bodyDepth / 2,
      width: halfW * 2,
      height: bodyDepth,
      fill: "none",
    },
  ];

  const name = `Screw Terminal ${poles.toString().padStart(2, "0")} ${pitchMm.toFixed(2)}mm`;
  const packageCode = `SCREW_${poles}_${pitchMm.toFixed(2).replace(".", "_")}mm`;
  const tags: readonly string[] = [
    "connector",
    "screw-terminal",
    `${pitchMm.toFixed(2)}mm`,
    `${poles}p`,
  ];

  return {
    source: { name, pads, graphics, labels: [], warnings: [] },
    name,
    mountType: "through_hole",
    packageCode,
    tags,
  };
}
