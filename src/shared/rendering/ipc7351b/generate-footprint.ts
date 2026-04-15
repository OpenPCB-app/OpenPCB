/**
 * High-level footprint generator.
 *
 * Takes a family + size label + density → produces FootprintRenderSource
 * that feeds directly into buildFootprintRenderModel().
 */

import { buildFootprintRenderModel } from "../footprint-preview-builder";
import type { FootprintRenderModel, FootprintRenderSource } from "../types";
import type { DensityLevel } from "./ipc-dimensions";
import {
  CHIP_ADDITIONS,
  QFN_ADDITIONS,
  QFP_ADDITIONS,
  SOIC_ADDITIONS,
  SOT_ADDITIONS,
} from "./ipc-dimensions";
import {
  calculateChipPads,
  calculateGullWingDualPads,
  calculateQfnPads,
  calculateQuadFlatPads,
  type PadCalculatorResult,
} from "./pad-calculator";
import {
  CHIP_FAMILY,
  QFN_FAMILY,
  QFP_FAMILY,
  SOIC_FAMILY,
  SOT_FAMILY,
  type PackageFamily,
} from "./family-presets";

export interface GeneratedFootprintMetadata {
  readonly name: string;
  readonly mountType: "smd" | "through_hole";
  readonly packageCode: {
    readonly imperial: string | null;
    readonly metric: string | null;
  };
  readonly tags: readonly string[];
}

export interface GeneratedFootprintResult {
  readonly source: FootprintRenderSource;
  readonly model: FootprintRenderModel;
  readonly metadata: GeneratedFootprintMetadata;
}

export function generateFootprint(
  familyId: PackageFamily,
  sizeLabel: string,
  density: DensityLevel,
): GeneratedFootprintResult {
  const { calcResult, name, imperial, metric, tags } = resolvePreset(
    familyId,
    sizeLabel,
    density,
  );

  const source: FootprintRenderSource = {
    name,
    pads: calcResult.pads,
    graphics: calcResult.graphics,
    labels: calcResult.labels,
    warnings: [],
  };

  const model = buildFootprintRenderModel(source);

  const metadata: GeneratedFootprintMetadata = {
    name,
    mountType: "smd",
    packageCode: { imperial, metric },
    tags,
  };

  return { source, model, metadata };
}

// ── Internal dispatch ───────────────────────────────────────────────

interface ResolvedPreset {
  calcResult: PadCalculatorResult;
  name: string;
  imperial: string | null;
  metric: string | null;
  tags: string[];
}

function resolvePreset(
  familyId: PackageFamily,
  sizeLabel: string,
  density: DensityLevel,
): ResolvedPreset {
  switch (familyId) {
    case "chip": {
      const size = CHIP_FAMILY.sizes.find((s) => s.label === sizeLabel);
      if (!size) throw new Error(`Unknown chip size: ${sizeLabel}`);
      const calcResult = calculateChipPads(
        size.params,
        CHIP_ADDITIONS[density],
      );
      return {
        calcResult,
        name: `C_${size.label}_${size.metric ?? ""}Metric`,
        imperial: size.label,
        metric: size.metric,
        tags: ["chip", "passive", "smd", `ipc-${density}`],
      };
    }
    case "sot": {
      const size = SOT_FAMILY.sizes.find((s) => s.label === sizeLabel);
      if (!size) throw new Error(`Unknown SOT size: ${sizeLabel}`);
      const calcResult = calculateGullWingDualPads(
        size.params,
        SOT_ADDITIONS[density],
      );
      return {
        calcResult,
        name: size.label,
        imperial: size.label,
        metric: null,
        tags: ["sot", "transistor", "smd", `ipc-${density}`],
      };
    }
    case "soic": {
      const size = SOIC_FAMILY.sizes.find((s) => s.label === sizeLabel);
      if (!size) throw new Error(`Unknown SOIC size: ${sizeLabel}`);
      const calcResult = calculateGullWingDualPads(
        size.params,
        SOIC_ADDITIONS[density],
      );
      return {
        calcResult,
        name: size.label,
        imperial: size.label,
        metric: null,
        tags: ["soic", "ic", "smd", `ipc-${density}`],
      };
    }
    case "qfp": {
      const size = QFP_FAMILY.sizes.find((s) => s.label === sizeLabel);
      if (!size) throw new Error(`Unknown QFP size: ${sizeLabel}`);
      const calcResult = calculateQuadFlatPads(
        size.params,
        QFP_ADDITIONS[density],
      );
      return {
        calcResult,
        name: size.label,
        imperial: size.label,
        metric: null,
        tags: ["qfp", "ic", "smd", `ipc-${density}`],
      };
    }
    case "qfn": {
      const size = QFN_FAMILY.sizes.find((s) => s.label === sizeLabel);
      if (!size) throw new Error(`Unknown QFN size: ${sizeLabel}`);
      const calcResult = calculateQfnPads(size.params, QFN_ADDITIONS[density]);
      return {
        calcResult,
        name: size.label,
        imperial: size.label,
        metric: null,
        tags: ["qfn", "ic", "smd", `ipc-${density}`],
      };
    }
  }
}
