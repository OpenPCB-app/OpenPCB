import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import renderingPackage from "../../../../../node_modules/@openpcb/rendering-core/package.json";
import { buildFootprintRenderModel } from "../../../../shared/rendering/footprint-preview-builder";
import {
  ALL_FAMILIES,
  generateFootprint,
  type GeneratedFootprintMetadata,
} from "../../../../shared/rendering/ipc7351b";
import type { FootprintRenderSource } from "../../../../shared/rendering/types";
import {
  getTemplate,
  hashParams,
  validateParams,
} from "../../../../shared/rendering/parametric";
import type {
  IpcGeneratorIdentity,
  TemplateGeneratorIdentity,
} from "../../shared/generator-policy";
import {
  acceptedIpcFingerprint,
  ipcFamilyAvailability,
  type InstalledIpcQualification,
} from "../../shared/generator-qualification";
import type { QualifiedIpcFingerprintTable } from "../../shared/qualified-ipc-fingerprints.generated";
import { padGeometryFingerprint } from "../qualification/pad-fingerprint";
import { assertGeneratedGeometry } from "./generated-geometry";
import { UnqualifiedGeneratorError } from "./unqualified-generator-error";

export { UnqualifiedGeneratorError };

export interface FootprintPayload {
  source: FootprintRenderSource;
  metadata: GeneratedFootprintMetadata;
}

export interface GeneratedFootprintInput {
  generator?: unknown;
  source?: FootprintRenderSource;
  metadata?: GeneratedFootprintMetadata;
}

/**
 * Test seam for the qualification inputs: `installed` overrides the installed
 * rendering-core manifest (null = none), `accepted` the accepted-fingerprint
 * table. Production callers pass nothing.
 */
export interface GeneratorQualificationInputs {
  installed?: InstalledIpcQualification | null;
  accepted?: QualifiedIpcFingerprintTable;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Electron bundles the generator, so its installed package identity must be baked into that bundle.
const packageIdentity = {
  name: renderingPackage.name,
  version: renderingPackage.version,
};

function resolvePreset(value: unknown, inputs: GeneratorQualificationInputs) {
  if (
    !record(value) ||
    value.kind !== "ipc7351b" ||
    Object.keys(value).sort().join(",") !== "density,family,kind,size"
  ) {
    throw new UnqualifiedGeneratorError(
      "Generated footprints require explicit IPC family, size and density parameters. Raw geometry and provenance flags cannot verify a generator.",
    );
  }
  const family = ALL_FAMILIES.find((family) => family.id === value.family);
  const size = family?.sizes.find((size) => size.label === value.size);
  const density = (["most", "nominal", "least"] as const).find(
    (density) => density === value.density,
  );
  if (!family || !size || !density) {
    throw new UnqualifiedGeneratorError(
      "Choose an available IPC preset and density, then regenerate the footprint.",
    );
  }
  const availability = ipcFamilyAvailability(
    family.id,
    inputs.installed,
    inputs.accepted,
  );
  if (!availability.available) {
    throw new UnqualifiedGeneratorError(availability.reason);
  }
  const generator: IpcGeneratorIdentity = {
    kind: "ipc7351b",
    family: family.id,
    size: size.label,
    density,
  };
  return { generator, parameters: size.params, revision: availability.revision };
}

/** Parametric templates are re-materialized server-side, like IPC presets. */
function resolveTemplate(value: Record<string, unknown>) {
  if (
    Object.keys(value).sort().join(",") !== "kind,params,templateId" ||
    typeof value.templateId !== "string" ||
    !record(value.params)
  ) {
    throw new UnqualifiedGeneratorError(
      "Template footprints require an explicit templateId and params. Regenerate the footprint.",
    );
  }
  const template = getTemplate(value.templateId);
  if (!template) {
    throw new UnqualifiedGeneratorError(
      `Template '${value.templateId}' is unavailable. Choose another generator.`,
    );
  }
  const validated = validateParams(template.schema, value.params);
  if (!validated.ok) {
    throw new UnqualifiedGeneratorError(
      "Template parameters are invalid. Regenerate the footprint.",
    );
  }
  const generated = template.generate(validated.values);
  assertGeneratedGeometry(generated.source);
  const generator: TemplateGeneratorIdentity = {
    kind: "template",
    templateId: template.id,
    params: validated.values,
  };
  return {
    generator,
    source: generated.source,
    metadata: {
      name: generated.name,
      mountType: generated.mountType,
      packageCode: { imperial: generated.packageCode, metric: null },
      tags: generated.tags,
    } as GeneratedFootprintMetadata,
    provenance: {
      generator,
      generatorVersion: template.generatorVersion,
      paramsHash: hashParams(validated.values),
    },
  };
}

function resolveIpc(value: unknown, inputs: GeneratorQualificationInputs) {
  const { generator, parameters, revision } = resolvePreset(value, inputs);
  const result = generateFootprint(
    generator.family,
    generator.size,
    generator.density,
  );
  assertGeneratedGeometry(result.source);
  // The preview pads are what a placement snapshots and the Gerber writes; a
  // re-pinned or linked generator whose output moved without re-qualification
  // stops here instead of persisting unqualified geometry.
  const padFingerprint = padGeometryFingerprint(
    buildFootprintRenderModel(result.source).pads,
  );
  if (
    padFingerprint !==
    acceptedIpcFingerprint(
      generator.family,
      revision,
      generator.size,
      generator.density,
      inputs.accepted,
    )
  ) {
    throw new UnqualifiedGeneratorError(
      "The installed generator's output differs from its qualification evidence.",
    );
  }
  return {
    ...result,
    provenance: {
      generator,
      generatorPackage: packageIdentity,
      presetParameters: parameters,
      generatedSourceSha256: createHash("sha256")
        .update(JSON.stringify(result.source))
        .digest("hex"),
      // Diagnostic only: qualification is re-derived from geometry, never read from here.
      ipcRevision: revision,
      padFingerprint,
    },
  };
}

function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function resolveGeneratedFootprint(
  input: GeneratedFootprintInput | undefined,
  inputs: GeneratorQualificationInputs = {},
) {
  const value = input?.generator;
  const result =
    record(value) && value.kind === "template"
      ? resolveTemplate(value)
      : resolveIpc(value, inputs);
  // Client payloads crossed JSON; compare against the same normalization.
  if (
    (input?.source !== undefined &&
      !isDeepStrictEqual(input.source, asJson(result.source))) ||
    (input?.metadata !== undefined &&
      !isDeepStrictEqual(input.metadata, asJson(result.metadata)))
  ) {
    throw new UnqualifiedGeneratorError(
      "The generated footprint preview does not match its current parameters. Regenerate it before importing.",
    );
  }
  return result;
}

export function resolveImportedSymbolFootprint(input: {
  generatedFootprint?: GeneratedFootprintInput;
  drawnFootprint?: FootprintPayload;
  footprintProvenance?: unknown;
}) {
  if (
    input.footprintProvenance !== undefined ||
    (input.generatedFootprint && input.drawnFootprint)
  ) {
    throw new UnqualifiedGeneratorError(
      "Use explicit generator parameters or a separate drawnFootprint payload. A provenance flag cannot establish footprint origin.",
    );
  }
  if (input.drawnFootprint) {
    return { ...input.drawnFootprint, isDrawn: true, provenance: {} };
  }
  return {
    ...resolveGeneratedFootprint(input.generatedFootprint),
    isDrawn: false,
  };
}
