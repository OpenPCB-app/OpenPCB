/**
 * Library footprint rows for H15 qualification tests (§3.4): stored pads with
 * arbitrary provenance claims, written straight into `library_footprints` the
 * way an `.opclib` intake, an old build or a forged pack could leave them.
 */
import { getSharedSqlite } from "../../db/sqlite-client";
import { buildFootprintRenderModel } from "../../../../shared/rendering/footprint-preview-builder";
import { generateFootprint } from "../../../../shared/rendering/ipc7351b";
import type {
  FootprintRenderModel,
  FootprintRenderSource,
  FootprintRenderSourcePad,
} from "../../../../shared/rendering/types";
import { getTemplate } from "../../../../shared/rendering/parametric";
import { installedIpcQualification } from "../../../../modules/library/shared/generator-qualification";

/** True while the installed rendering-core is the legacy (≤ v0.1.3, manifest-less) generator. */
export const LEGACY_GENERATOR_INSTALLED = installedIpcQualification() === null;

export function rectPad(
  number: string,
  x: number,
  y: number,
  size = 1,
): FootprintRenderSourcePad {
  return {
    id: `${number}:${x}:${y}`,
    number,
    shape: "rect",
    centerMm: { x, y },
    widthMm: size,
    heightMm: size,
    rotationDeg: 0,
    layer: "F.Cu",
  };
}

export function previewOf(
  pads: readonly FootprintRenderSourcePad[],
  name = "Test footprint",
): FootprintRenderModel {
  const source: FootprintRenderSource = {
    name,
    pads,
    graphics: [],
    labels: [],
    warnings: [],
  };
  return buildFootprintRenderModel(source);
}

/** Preview of a legacy IPC preset: only meaningful while the legacy generator is installed. */
export function legacyIpcPreview(
  family: "chip" | "soic" | "sot" | "qfp" | "qfn",
  size: string,
  density: "most" | "nominal" | "least",
): FootprintRenderModel {
  return buildFootprintRenderModel(generateFootprint(family, size, density).source);
}

export function templatePreview(
  templateId: string,
  params: Record<string, unknown>,
): FootprintRenderModel {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`unknown template ${templateId}`);
  return buildFootprintRenderModel(template.generate(params as never).source);
}

/** Two numbered pads on top of each other: what an overlapping template emits. */
export function overlappingPreview(): FootprintRenderModel {
  return previewOf([rectPad("1", 0, 0), rectPad("2", 0.2, 0)]);
}

/** Two well-separated pads numbered 1 and 2. */
export function plainPreview(): FootprintRenderModel {
  return previewOf([rectPad("1", -2, 0), rectPad("2", 2, 0)]);
}

export const PIN_HEADER_1X2 = {
  rows: 1,
  pinsPerRow: 2,
  pitchMm: 2.54,
  mount: "tht",
  orientation: "vertical",
} as const;

export function footprintDataJson(
  provenance: Record<string, unknown>,
  preview: FootprintRenderModel | null,
): string {
  return JSON.stringify({
    provenance,
    normalized: { name: preview?.name ?? "fp", preview },
  });
}

export function insertFootprintRow(
  id: string,
  dataJson: string,
  name = "Qualification fixture",
): string {
  getSharedSqlite()
    .query(
      "INSERT INTO library_footprints (id, name, data_json, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, name, dataJson, new Date().toISOString());
  return id;
}

export function updateFootprintRow(id: string, dataJson: string): void {
  getSharedSqlite()
    .query("UPDATE library_footprints SET data_json = ? WHERE id = ?")
    .run(dataJson, id);
}

export function deleteFootprintRow(id: string): void {
  getSharedSqlite().query("DELETE FROM library_footprints WHERE id = ?").run(id);
}

/** Provenance claims, as each writer leaves them. */
export const PROVENANCE = {
  /** Generated before d11ce92: no generator identity. */
  legacyGenerated: { sourceKind: "generated", sourceFormat: "ipc-7351b" },
  ipc: (family: string, size: string, density: string, extra: Record<string, unknown> = {}) => ({
    sourceKind: "generated",
    sourceFormat: "ipc-7351b",
    generator: { kind: "ipc7351b", family, size, density },
    ...extra,
  }),
  template: (templateId: string, params: Record<string, unknown>) => ({
    sourceKind: "generated",
    sourceFormat: "ipc-7351b",
    generator: { kind: "template", templateId, params },
    generatorVersion: 1,
  }),
  drawn: { sourceKind: "drawn", sourceFormat: "openpcb-editor" },
  kicad: { sourceKind: "imported", sourceFormat: "kicad_mod" },
  coreLibrary: { source: "kicad-derived", sourceHash: "core-hash" },
} as const;
