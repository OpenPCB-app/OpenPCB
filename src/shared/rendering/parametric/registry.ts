/**
 * Parametric template registry. Each built-in template owns:
 *   - a unique id (kebab-case)
 *   - a human label
 *   - a parameter schema (drives form rendering + validation)
 *   - a generator that takes validated values → FootprintRenderSource +
 *     library-side metadata (name, mountType, packageCode, tags)
 *   - a generatorVersion for cache invalidation when geometry rules change
 *
 * v1 templates: pin header, screw terminal, mounting hole array.
 */

import type { FootprintRenderSource } from "../types";
import type { ParamSchema, ParamValues } from "./param-schema";
import {
  PIN_HEADER_SCHEMA,
  generatePinHeader,
  paramsFromValues as pinHeaderParams,
} from "./pin-header";
import {
  MOUNTING_ARRAY_SCHEMA,
  generateMountingArray,
  paramsFromValues as mountingArrayParams,
} from "./mounting-array";
import {
  SCREW_TERMINAL_SCHEMA,
  generateScrewTerminal,
  paramsFromValues as screwTerminalParams,
} from "./screw-terminal";

export interface ParametricGeneratorResult {
  readonly source: FootprintRenderSource;
  readonly name: string;
  readonly mountType: "smd" | "through_hole";
  readonly packageCode: string;
  readonly tags: readonly string[];
}

export interface ParametricTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly schema: ParamSchema;
  readonly generatorVersion: number;
  readonly generate: (values: ParamValues) => ParametricGeneratorResult;
}

export const PARAMETRIC_TEMPLATES: ReadonlyArray<ParametricTemplate> = [
  {
    id: "pin-header",
    label: "Pin Header",
    description: "Standard pin-header strip (THT or SMD, any rows × pins).",
    schema: PIN_HEADER_SCHEMA,
    generatorVersion: 1,
    generate: (values) => generatePinHeader(pinHeaderParams(values)),
  },
  {
    id: "screw-terminal",
    label: "Screw Terminal",
    description: "Single-row screw terminal block, configurable poles + pitch.",
    schema: SCREW_TERMINAL_SCHEMA,
    generatorVersion: 1,
    generate: (values) => generateScrewTerminal(screwTerminalParams(values)),
  },
  {
    id: "mounting-array",
    label: "Mounting Hole Array",
    description: "N×M grid of mechanical mounting holes (plated or NPTH).",
    schema: MOUNTING_ARRAY_SCHEMA,
    generatorVersion: 1,
    generate: (values) => generateMountingArray(mountingArrayParams(values)),
  },
];

export function getTemplate(id: string): ParametricTemplate | null {
  return PARAMETRIC_TEMPLATES.find((t) => t.id === id) ?? null;
}
