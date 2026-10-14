import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import renderingPackage from "../../../../../node_modules/@openpcb/rendering-core/package.json";
import { AppError } from "../../../../core/contracts/errors";
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
import {
  generatorUnavailableReason,
  type IpcGeneratorIdentity,
  type TemplateGeneratorIdentity,
} from "../../shared/generator-policy";

export interface FootprintPayload {
  source: FootprintRenderSource;
  metadata: GeneratedFootprintMetadata;
}

export interface GeneratedFootprintInput {
  generator?: unknown;
  source?: FootprintRenderSource;
  metadata?: GeneratedFootprintMetadata;
}

export class UnqualifiedGeneratorError extends AppError {
  constructor(message: string) {
    super(
      message,
      422,
      "Footprint generator unavailable",
      "https://openpcb.dev/problems/unqualified-generator",
      { code: "UNQUALIFIED_GENERATOR" },
    );
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Electron bundles the generator, so its installed package identity must be baked into that bundle.
const packageIdentity = {
  name: renderingPackage.name,
  version: renderingPackage.version,
};

function resolvePreset(value: unknown) {
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
  const reason = generatorUnavailableReason(family.id);
  if (reason) throw new UnqualifiedGeneratorError(reason);
  const generator: IpcGeneratorIdentity = {
    kind: "ipc7351b",
    family: family.id,
    size: size.label,
    density,
  };
  return { generator, parameters: size.params };
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

function resolveIpc(value: unknown) {
  const { generator, parameters } = resolvePreset(value);
  const result = generateFootprint(
    generator.family,
    generator.size,
    generator.density,
  );
  return {
    ...result,
    provenance: {
      generator,
      generatorPackage: packageIdentity,
      presetParameters: parameters,
      generatedSourceSha256: createHash("sha256")
        .update(JSON.stringify(result.source))
        .digest("hex"),
    },
  };
}

function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function resolveGeneratedFootprint(
  input: GeneratedFootprintInput | undefined,
) {
  const value = input?.generator;
  const result =
    record(value) && value.kind === "template"
      ? resolveTemplate(value)
      : resolveIpc(value);
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
