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
  generatorUnavailableReason,
  type IpcGeneratorIdentity,
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

export function resolveGeneratedFootprint(
  input: GeneratedFootprintInput | undefined,
) {
  const { generator, parameters } = resolvePreset(input?.generator);
  const result = generateFootprint(
    generator.family,
    generator.size,
    generator.density,
  );
  if (
    (input?.source !== undefined &&
      !isDeepStrictEqual(input.source, result.source)) ||
    (input?.metadata !== undefined &&
      !isDeepStrictEqual(input.metadata, result.metadata))
  ) {
    throw new UnqualifiedGeneratorError(
      "The generated footprint preview does not match its current parameters. Regenerate it before importing.",
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
    },
  };
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
