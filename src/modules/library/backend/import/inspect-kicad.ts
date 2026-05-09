import { createHash } from "node:crypto";
import { ValidationError } from "../../../../core/contracts/errors";
import type {
  FootprintRenderModel,
  SymbolRenderModel,
} from "../../../../shared/rendering";
import { extractPackageCode } from "../infrastructure/parsers/kicad/heuristics";
import {
  parseKicadFootprint,
  type ParsedKicadFootprint,
} from "../infrastructure/parsers/kicad/kicad-footprint-parser";
import { classifyModel3DLinks } from "../infrastructure/parsers/kicad/kicad-model-linker";
import {
  parseKicadSymbolLib,
  type ParsedKicadSymbol,
} from "../infrastructure/parsers/kicad/kicad-symbol-parser";
import {
  buildFootprintPreviewFromParsed,
  buildSymbolPreviewFromParsed,
} from "./build-preview-models";
import type {
  ImportWarning,
  InspectKicadRequest,
  InspectKicadResponse,
  Model3DCandidate,
} from "./types";

export class ImportValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
  }
}

export interface NormalizedImportedSymbol {
  id: string;
  name: string;
  referencePrefix: string;
  description: string | null;
  sourceHash: string;
  pins: Array<{
    originPinKey: string;
    number: string | null;
    name: string;
    localPosition: { x: number; y: number };
    electricalType: string;
    unit: number;
  }>;
  warnings: Array<{ code: string; message: string }>;
  preview: SymbolRenderModel;
}

export interface NormalizedImportedFootprint {
  id: string;
  fileName: string;
  name: string;
  description: string;
  mountType: string;
  padCount: number;
  packageCode: {
    imperial: string | null;
    metric: string | null;
  };
  tags: string[];
  sourceHash: string;
  warnings: Array<{ code: string; message: string }>;
  preview: FootprintRenderModel;
}

export interface ParsedImportBundle {
  normalizedSymbols: NormalizedImportedSymbol[];
  normalizedFootprints: NormalizedImportedFootprint[];
  model3dCandidates: Model3DCandidate[];
  warnings: ImportWarning[];
  raw: {
    symbolFileName: string;
    symbolLibrary: ReturnType<typeof parseKicadSymbolLib>;
    symbolById: Record<string, ParsedKicadSymbol>;
    footprintByName: Record<string, ParsedKicadFootprint>;
    footprintById: Record<string, ParsedKicadFootprint>;
    footprintFileByName: Record<string, string>;
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function stableId(prefix: string, entropy: string): string {
  return `${prefix}_${sha256(entropy).slice(0, 16)}`;
}

function requireNonEmptyText(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new ImportValidationError(`${field} must not be empty`);
  }
}

function uniqueTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeSymbol(
  symbol: ParsedKicadSymbol,
  sourceHash: string,
  index: number,
): NormalizedImportedSymbol {
  const preview = buildSymbolPreviewFromParsed(symbol);
  const referencePrefix = (symbol.properties.Reference ?? symbol.name)
    .replace(/[^A-Za-z#]/g, "")
    .slice(0, 8);

  const pins = symbol.pins.map((pin, pinIndex) => {
    const originPinKey =
      pin.number.trim().length > 0
        ? `u${pin.unit}:${pin.number}`
        : `u${pin.unit}:idx${pinIndex + 1}`;
    return {
      originPinKey,
      number: pin.number.trim().length > 0 ? pin.number : null,
      name: pin.name,
      localPosition: {
        x: pin.position.x,
        y: pin.position.y,
      },
      electricalType: pin.electricalType,
      unit: pin.unit,
    };
  });

  return {
    id: stableId("sym", `${sourceHash}:${index}:${symbol.name}`),
    name: symbol.name,
    referencePrefix: referencePrefix.length > 0 ? referencePrefix : "U",
    description: symbol.properties.Description ?? null,
    sourceHash,
    pins,
    warnings: preview.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    })),
    preview,
  };
}

function normalizeFootprint(
  footprint: ParsedKicadFootprint,
  sourceHash: string,
  fileName: string,
  index: number,
): NormalizedImportedFootprint {
  const preview = buildFootprintPreviewFromParsed(footprint);
  const pkg = extractPackageCode(footprint.name);
  const mountType = footprint.attributes.type;
  const tags = uniqueTags([
    ...footprint.tags,
    mountType,
    pkg.imperial ?? "",
    pkg.metric ?? "",
  ]);

  return {
    id: stableId("fp", `${sourceHash}:${index}:${fileName}:${footprint.name}`),
    fileName,
    name: footprint.name,
    description: footprint.description,
    mountType,
    padCount: footprint.pads.length,
    packageCode: {
      imperial: pkg.imperial,
      metric: pkg.metric,
    },
    tags,
    sourceHash,
    warnings: preview.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    })),
    preview,
  };
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

function basenameOf(fileName: string): string {
  const normalized = fileName.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export function parseImportBundle(
  input: InspectKicadRequest,
): ParsedImportBundle {
  const hasSymbolLibrary =
    input.symbolLibrary !== null && input.symbolLibrary !== undefined;

  let symbolLibrary: ReturnType<typeof parseKicadSymbolLib> = {
    symbols: [],
    version: null,
    generator: null,
  };
  let normalizedSymbols: NormalizedImportedSymbol[] = [];
  let symbolFileName = "";

  if (hasSymbolLibrary) {
    const lib = input.symbolLibrary!;
    requireNonEmptyText(lib.fileName, "symbolLibrary.fileName");
    requireNonEmptyText(lib.content, "symbolLibrary.content");

    symbolLibrary = parseKicadSymbolLib(lib.content);
    if (symbolLibrary.symbols.length === 0) {
      throw new ImportValidationError(
        "Symbol library does not contain any symbols",
      );
    }

    const symbolSourceHash = sha256(lib.content);
    normalizedSymbols = symbolLibrary.symbols.map((symbol, index) =>
      normalizeSymbol(symbol, symbolSourceHash, index),
    );
    symbolFileName = lib.fileName;
  }

  const normalizedFootprints: NormalizedImportedFootprint[] = [];
  const warnings: ImportWarning[] = [];
  const symbolById: Record<string, ParsedKicadSymbol> = {};
  const footprintByName: Record<string, ParsedKicadFootprint> = {};
  const footprintById: Record<string, ParsedKicadFootprint> = {};
  const footprintFileByName: Record<string, string> = {};
  const availableModelFiles = (input.model3dFiles ?? []).map((item) =>
    basenameOf(item.fileName),
  );

  for (let index = 0; index < normalizedSymbols.length; index += 1) {
    const normalized = normalizedSymbols[index];
    const raw = symbolLibrary.symbols[index];
    if (!normalized || !raw) {
      continue;
    }
    symbolById[normalized.id] = raw;
  }

  for (let index = 0; index < input.footprints.length; index += 1) {
    const footprintFile = input.footprints[index];
    if (!footprintFile) {
      continue;
    }
    requireNonEmptyText(footprintFile.fileName, "footprints[].fileName");
    requireNonEmptyText(footprintFile.content, "footprints[].content");
    const parsed = parseKicadFootprint(footprintFile.content);
    const normalized = normalizeFootprint(
      parsed,
      sha256(footprintFile.content),
      footprintFile.fileName,
      index,
    );
    normalizedFootprints.push(normalized);
    footprintByName[parsed.name] = parsed;
    footprintById[normalized.id] = parsed;
    footprintFileByName[parsed.name] = footprintFile.fileName;

    for (const warning of normalized.warnings) {
      warnings.push({
        scope: "footprint",
        itemId: normalized.id,
        itemName: parsed.name,
        code: warning.code,
        message: warning.message,
      });
    }
  }

  for (let index = 0; index < normalizedSymbols.length; index += 1) {
    const normalized = normalizedSymbols[index];
    if (!normalized) {
      continue;
    }
    for (const warning of normalized.warnings) {
      warnings.push({
        scope: "symbol",
        itemId: normalized.id,
        itemName: normalized.name,
        code: warning.code,
        message: warning.message,
      });
    }
  }

  const modelClassifications = classifyModel3DLinks(
    Object.values(footprintByName),
    availableModelFiles,
  );
  const model3dCandidates = modelClassifications.map((item) => {
    const extension = extensionOf(item.modelFileName);
    return {
      fileName: item.modelFileName,
      extension,
      association: extension === ".wrl" ? "unsupported_format" : item.status,
    } satisfies Model3DCandidate;
  });

  for (const classification of modelClassifications) {
    if (classification.status === "valid" && extensionOf(classification.modelFileName) !== ".wrl") {
      continue;
    }
    const normalizedFootprint = parsedFootprintByName(
      normalizedFootprints,
      classification.footprintName,
    );
    warnings.push({
      scope: "footprint",
      itemId: normalizedFootprint?.id ?? "",
      itemName: classification.footprintName || classification.modelFileName,
      code: extensionOf(classification.modelFileName) === ".wrl"
        ? "model3d_unsupported_format"
        : `model3d_${classification.status}`,
      message: extensionOf(classification.modelFileName) === ".wrl"
        ? `3D model file ${classification.modelFileName} is a VRML model; STEP/STP is required for import conversion`
        : modelClassificationMessage(classification.status, classification.modelFileName),
    });
  }

  return {
    normalizedSymbols,
    normalizedFootprints,
    model3dCandidates,
    warnings,
    raw: {
      symbolFileName,
      symbolLibrary,
      symbolById,
      footprintByName,
      footprintById,
      footprintFileByName,
    },
  };
}

function parsedFootprintByName(
  footprintsList: NormalizedImportedFootprint[],
  name: string,
): NormalizedImportedFootprint | null {
  return footprintsList.find((footprint) => footprint.name === name) ?? null;
}

function modelClassificationMessage(status: string, fileName: string): string {
  if (status === "missing_target") {
    return `3D model reference ${fileName} was not found in the import payload`;
  }
  if (status === "orphan_asset") {
    return `3D model file ${fileName} is present but not referenced by any footprint`;
  }
  if (status === "shared_body") {
    return `3D model file ${fileName} is shared by multiple footprints`;
  }
  return `3D model file ${fileName} has status ${status}`;
}

export function buildInspectResponse(
  input: InspectKicadRequest,
): InspectKicadResponse {
  const parsed = parseImportBundle(input);
  return {
    symbols: parsed.normalizedSymbols.map((symbol) => ({
      id: symbol.id,
      name: symbol.name,
      referencePrefix: symbol.referencePrefix,
      pinCount: symbol.pins.length,
      description: symbol.description,
      warningCount: symbol.warnings.length,
      preview: symbol.preview,
    })),
    footprints: parsed.normalizedFootprints.map((footprint) => ({
      id: footprint.id,
      fileName: footprint.fileName,
      name: footprint.name,
      mountType: footprint.mountType,
      padCount: footprint.padCount,
      packageCode: footprint.packageCode,
      warningCount: footprint.warnings.length,
      preview: footprint.preview,
    })),
    model3dCandidates: parsed.model3dCandidates,
    warnings: parsed.warnings,
  };
}
