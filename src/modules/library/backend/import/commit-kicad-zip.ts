import { createHash } from "node:crypto";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { eq } from "drizzle-orm";
import type {
  ArchiveImportWarning,
  CommitKicadZipResponse,
  ImportFileInput,
  Model3DCandidate,
  ModelConversionMetadata,
} from "../../contracts/import";
import { components, footprintModels, footprints } from "../schema";
import { getDb } from "../queries";
import {
  deleteModel,
  writeSourceStep,
} from "../services/footprint-model-store";
import { commitKicadImport } from "./commit-kicad";
import {
  ImportValidationError,
  parseImportBundle,
  type NormalizedImportedFootprint,
  type NormalizedImportedSymbol,
} from "./inspect-kicad";
import {
  decodeTextEntry,
  extractZipEntries,
  type ZipEntryContent,
} from "./archive/extract-zip";

type Confidence = "high" | "medium" | "low";

interface ModelSelection {
  fileName: string;
  association:
    | "footprint-model-ref"
    | "symbol-name"
    | "archive-name"
    | "single-model";
}

interface ArchiveImportMetadata {
  archiveFileName: string;
  provider: "snapeda" | "ultra-librarian" | "kicad" | "unknown";
  selectedModel: ModelSelection | null;
  modelFiles: string[];
  warnings: ArchiveImportWarning[];
}

const MODEL_EXTENSIONS = new Set([".step", ".stp", ".wrl"]);
const STEP_EXTENSIONS = new Set([".step", ".stp"]);
const IGNORED_BASE_NAMES = new Set([".ds_store", "thumbs.db"]);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(0, dot) : name;
}

function normalizeName(value: string): string {
  return withoutExtension(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function basenameFromFootprintProperty(
  value: string | undefined,
): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\/g, "/");
  const colon = normalized.lastIndexOf(":");
  const slash = normalized.lastIndexOf("/");
  const start = Math.max(colon, slash) + 1;
  const raw = normalized.slice(start).trim();
  return raw.length > 0 ? withoutExtension(raw) : null;
}

function warning(code: string, message: string): ArchiveImportWarning {
  return { code, message };
}

function modelCandidate(
  fileName: string,
  extension: string,
  association: Model3DCandidate["association"],
): Model3DCandidate {
  return { fileName, extension, association };
}

function detectProvider(
  entries: ZipEntryContent[],
  symbolProperties: Record<string, string> | null,
): ArchiveImportMetadata["provider"] {
  const hasSnapedaDoc = entries.some((entry) =>
    entry.baseName.toLowerCase().includes("how-to-import"),
  );
  const propertyBlob = JSON.stringify(symbolProperties ?? {}).toLowerCase();
  if (
    hasSnapedaDoc ||
    propertyBlob.includes("snapeda") ||
    propertyBlob.includes("snapmagic")
  ) {
    return "snapeda";
  }
  const names = entries.map((entry) => entry.path.toLowerCase()).join("\n");
  if (names.includes("ultralibrarian") || names.includes("ultra-librarian")) {
    return "ultra-librarian";
  }
  if (entries.some((entry) => entry.path.includes(".pretty/"))) {
    return "kicad";
  }
  return "unknown";
}

function pinPadCompatible(
  symbol: NormalizedImportedSymbol,
  footprint: NormalizedImportedFootprint,
): boolean {
  const padNumbers = new Set(
    footprint.preview.pads.map((pad) => pad.number.trim()),
  );
  if (padNumbers.size === 0) return false;
  return symbol.pins.every((pin) => {
    const number = pin.number?.trim() ?? "";
    return number.length === 0 || padNumbers.has(number);
  });
}

function chooseSymbol(
  symbols: NormalizedImportedSymbol[],
  archiveBase: string,
): { symbol: NormalizedImportedSymbol; confidence: Confidence } {
  if (symbols.length === 0) {
    throw new ImportValidationError(
      "ZIP archive does not contain a KiCad symbol",
    );
  }
  const archiveKey = normalizeName(archiveBase);
  let best = symbols[0]!;
  let bestScore = symbols.length === 1 ? 80 : 0;
  for (const symbol of symbols) {
    let score = symbols.length === 1 ? 80 : 0;
    if (normalizeName(symbol.name) === archiveKey) score += 40;
    if (
      normalizeName(symbol.name).includes(archiveKey) &&
      archiveKey.length > 0
    )
      score += 20;
    if (score > bestScore) {
      best = symbol;
      bestScore = score;
    }
  }
  return {
    symbol: best,
    confidence: bestScore >= 80 ? "high" : bestScore >= 40 ? "medium" : "low",
  };
}

function chooseFootprint(
  footprintsList: NormalizedImportedFootprint[],
  symbol: NormalizedImportedSymbol,
  footprintProperty: string | null,
  archiveBase: string,
): {
  footprint: NormalizedImportedFootprint;
  confidence: Confidence;
  warnings: ArchiveImportWarning[];
} {
  if (footprintsList.length === 0) {
    throw new ImportValidationError(
      "ZIP archive does not contain a KiCad footprint",
    );
  }

  const expectedFootprint = normalizeName(footprintProperty ?? "");
  const archiveKey = normalizeName(archiveBase);
  const warnings: ArchiveImportWarning[] = [];
  let best = footprintsList[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const footprint of footprintsList) {
    let score = footprintsList.length === 1 ? 25 : 0;
    const footprintKey = normalizeName(footprint.name);
    const fileKey = normalizeName(footprint.fileName);
    if (
      expectedFootprint &&
      (footprintKey === expectedFootprint || fileKey === expectedFootprint)
    ) {
      score += 120;
    }
    if (pinPadCompatible(symbol, footprint)) score += 60;
    if (
      archiveKey &&
      (footprintKey.includes(archiveKey) || fileKey.includes(archiveKey))
    )
      score += 15;
    if (score > bestScore) {
      best = footprint;
      bestScore = score;
    }
  }

  if (!pinPadCompatible(symbol, best)) {
    throw new ImportValidationError(
      `No footprint in ZIP matches the selected symbol pins (${symbol.name})`,
    );
  }
  if (!expectedFootprint) {
    warnings.push(
      warning(
        "missing_symbol_footprint_property",
        "Symbol has no Footprint property; footprint was selected by compatibility heuristics",
      ),
    );
  } else if (bestScore < 120) {
    warnings.push(
      warning(
        "footprint_property_not_matched",
        "Symbol Footprint property did not exactly match an imported footprint; selected a compatible footprint",
      ),
    );
  }

  const confidence: Confidence =
    bestScore >= 140 ? "high" : bestScore >= 80 ? "medium" : "low";
  return { footprint: best, confidence, warnings };
}

function chooseModel(
  models: ZipEntryContent[],
  rawFootprint: { model3dRefs: Array<{ resolvedFileName: string }> },
  symbolName: string,
  archiveBase: string,
): { selection: ModelSelection | null; warnings: ArchiveImportWarning[] } {
  const warnings: ArchiveImportWarning[] = [];
  if (models.length === 0) return { selection: null, warnings };

  const byBase = new Map(
    models.map((entry) => [entry.baseName.toLowerCase(), entry]),
  );
  for (const ref of rawFootprint.model3dRefs) {
    const match = byBase.get(ref.resolvedFileName.toLowerCase());
    if (match) {
      return {
        selection: {
          fileName: match.baseName,
          association: "footprint-model-ref",
        },
        warnings,
      };
    }
  }

  const symbolKey = normalizeName(symbolName);
  const symbolMatch = models.find(
    (entry) => normalizeName(entry.baseName) === symbolKey,
  );
  if (symbolMatch) {
    warnings.push(
      warning(
        "model_associated_by_symbol_name",
        "3D model was associated by symbol/archive filename because footprint has no matching model reference",
      ),
    );
    return {
      selection: { fileName: symbolMatch.baseName, association: "symbol-name" },
      warnings,
    };
  }

  const archiveKey = normalizeName(archiveBase);
  const archiveMatch = models.find(
    (entry) => normalizeName(entry.baseName) === archiveKey,
  );
  if (archiveMatch) {
    warnings.push(
      warning(
        "model_associated_by_archive_name",
        "3D model was associated by archive filename because footprint has no matching model reference",
      ),
    );
    return {
      selection: {
        fileName: archiveMatch.baseName,
        association: "archive-name",
      },
      warnings,
    };
  }

  if (models.length === 1) {
    warnings.push(
      warning(
        "model_associated_as_single_candidate",
        "Only one 3D model was found; associated it with the selected footprint",
      ),
    );
    return {
      selection: { fileName: models[0]!.baseName, association: "single-model" },
      warnings,
    };
  }

  warnings.push(
    warning(
      "model_not_selected",
      "Multiple 3D models were found, but none matched the selected footprint",
    ),
  );
  return { selection: null, warnings };
}

function buildModel3dCandidates(
  modelEntries: ZipEntryContent[],
  selection: ModelSelection | null,
): Model3DCandidate[] {
  return modelEntries.map((entry) => {
    if (entry.extension === ".wrl") {
      return modelCandidate(
        entry.baseName,
        entry.extension,
        "unsupported_format",
      );
    }
    if (selection?.fileName === entry.baseName) {
      return modelCandidate(
        entry.baseName,
        entry.extension,
        selection.association,
      );
    }
    return modelCandidate(entry.baseName, entry.extension, "orphan_asset");
  });
}

function getCommittedFootprintId(
  ctx: CoreBackendModuleContext,
  componentId: string,
): string | null {
  const db = getDb(ctx);
  const component = db
    .select({ footprintId: components.footprintId })
    .from(components)
    .where(eq(components.id, componentId))
    .get();
  return component?.footprintId ?? null;
}

function findSelectedModelRef(
  rawFootprint: { model3dRefs: Array<{ resolvedFileName: string }> },
  selectedFileName: string,
): unknown | null {
  return (
    rawFootprint.model3dRefs.find(
      (ref) =>
        ref.resolvedFileName.toLowerCase() === selectedFileName.toLowerCase(),
    ) ?? null
  );
}

function mergeConfidence(a: Confidence, b: Confidence): Confidence {
  if (a === "low" || b === "low") return "low";
  if (a === "medium" || b === "medium") return "medium";
  return "high";
}

async function persistPendingSourceStep(
  ctx: CoreBackendModuleContext,
  footprintId: string,
  selectedEntry: ZipEntryContent,
  rawFootprint: { model3dRefs: Array<{ resolvedFileName: string }> },
  selectedCandidate: Model3DCandidate,
): Promise<ModelConversionMetadata> {
  const db = getDb(ctx);
  const now = new Date().toISOString();
  const sourceSha256 = sha256(selectedEntry.bytes);
  const source = await writeSourceStep(selectedEntry.bytes, sourceSha256);

  try {
    const existing = db
      .select({ createdAt: footprintModels.createdAt })
      .from(footprintModels)
      .where(eq(footprintModels.footprintId, footprintId))
      .get();
    const selectedRef = findSelectedModelRef(rawFootprint, selectedEntry.baseName);
    // Persist the selected model ref only; retries and previews need the same
    // transform that was used for conversion.
    const modelRefJson = JSON.stringify(selectedRef);

    db.transaction((tx) => {
      const txDb = tx as typeof db;
      txDb
        .delete(footprintModels)
        .where(eq(footprintModels.footprintId, footprintId))
        .run();
      txDb
        .insert(footprintModels)
        .values({
          footprintId,
          status: "pending_client_conversion",
          glbPath: null,
          glbSha256: null,
          sourceStepPath: source.relativePath,
          sourceStepSha256: source.sha256,
          sourceFilename: selectedEntry.baseName,
          sourceByteSize: source.byteSize,
          modelRefJson,
          tessellationParamsJson: null,
          converterVersion: null,
          byteSize: null,
          errorMessage: null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        })
        .run();
    });

    return {
      footprintId,
      sourceStepSha256: source.sha256,
      sourceStepUrl: `/footprints/${footprintId}/model/source`,
      sourceFilename: selectedEntry.baseName,
      selectedModel: selectedCandidate,
      modelRef: selectedRef,
      status: "pending_client_conversion",
    };
  } catch (error) {
    // Roll back the on-disk STEP if the DB upsert fails. Skip when the file was
    // a dedup hit (it pre-existed and may be referenced elsewhere).
    if (!source.deduped) {
      await deleteModel(source.sha256).catch(() => undefined);
    }
    throw error;
  }
}

function attachArchiveMetadata(
  ctx: CoreBackendModuleContext,
  componentId: string,
  metadata: ArchiveImportMetadata,
): void {
  const db = getDb(ctx);
  const component = db
    .select({ footprintId: components.footprintId })
    .from(components)
    .where(eq(components.id, componentId))
    .get();
  if (!component) return;

  const footprint = db
    .select({ dataJson: footprints.dataJson })
    .from(footprints)
    .where(eq(footprints.id, component.footprintId))
    .get();
  if (!footprint) return;

  const data = JSON.parse(footprint.dataJson) as Record<string, unknown>;
  const provenance =
    data.provenance && typeof data.provenance === "object"
      ? (data.provenance as Record<string, unknown>)
      : {};
  data.provenance = {
    ...provenance,
    sourceFormat: "kicad_zip",
    archiveFileName: metadata.archiveFileName,
  };
  data.archiveImport = metadata;

  db.update(footprints)
    .set({ dataJson: JSON.stringify(data) })
    .where(eq(footprints.id, component.footprintId))
    .run();
}

export async function commitKicadZipImport(
  ctx: CoreBackendModuleContext,
  archiveFileName: string,
  archiveBytes: Uint8Array,
): Promise<CommitKicadZipResponse> {
  const entries = extractZipEntries(archiveBytes).filter(
    (entry) => !IGNORED_BASE_NAMES.has(entry.baseName.toLowerCase()),
  );
  const legacySymbols = entries.filter(
    (entry) => entry.extension === ".lib" || entry.extension === ".dcm",
  );
  if (legacySymbols.length > 0) {
    throw new ImportValidationError(
      "Legacy KiCad .lib/.dcm archives are not supported yet. Please use KiCad v6+ .kicad_sym ZIPs.",
    );
  }

  const symbolEntries = entries.filter(
    (entry) => entry.extension === ".kicad_sym",
  );
  const footprintEntries = entries.filter(
    (entry) => entry.extension === ".kicad_mod",
  );
  const modelEntries = entries.filter((entry) =>
    MODEL_EXTENSIONS.has(entry.extension),
  );
  const stepModelEntries = modelEntries.filter((entry) =>
    STEP_EXTENSIONS.has(entry.extension),
  );

  if (symbolEntries.length === 0)
    throw new ImportValidationError(
      "ZIP archive does not contain a .kicad_sym file",
    );
  if (footprintEntries.length === 0)
    throw new ImportValidationError(
      "ZIP archive does not contain a .kicad_mod file",
    );

  const symbolLibrary: ImportFileInput = {
    fileName: symbolEntries[0]!.baseName,
    content: decodeTextEntry(symbolEntries[0]!),
  };
  const footprintsPayload = footprintEntries.map((entry) => ({
    fileName: entry.baseName,
    content: decodeTextEntry(entry),
  }));
  const parsed = parseImportBundle({
    symbolLibrary,
    footprints: footprintsPayload,
  });
  const archiveBase = withoutExtension(archiveFileName);
  const symbolChoice = chooseSymbol(parsed.normalizedSymbols, archiveBase);
  const rawSymbol = parsed.raw.symbolById[symbolChoice.symbol.id];
  const footprintProperty = basenameFromFootprintProperty(
    rawSymbol?.properties.Footprint,
  );
  const footprintChoice = chooseFootprint(
    parsed.normalizedFootprints,
    symbolChoice.symbol,
    footprintProperty,
    archiveBase,
  );
  const rawFootprint = parsed.raw.footprintById[footprintChoice.footprint.id];
  if (!rawFootprint)
    throw new ImportValidationError(
      "Failed to map selected footprint raw payload",
    );

  const modelChoice = chooseModel(
    stepModelEntries,
    rawFootprint,
    symbolChoice.symbol.name,
    archiveBase,
  );
  const warnings = [
    ...parsed.warnings.map((item) => warning(item.code, item.message)),
    ...footprintChoice.warnings,
    ...modelChoice.warnings,
  ];
  for (const entry of modelEntries) {
    if (entry.extension === ".wrl") {
      warnings.push(
        warning(
          "unsupported_wrl_model",
          `${entry.baseName} is a VRML model; ZIP import only queues STEP/STP source models for conversion`,
        ),
      );
    }
  }
  const provider = detectProvider(entries, rawSymbol?.properties ?? null);
  const confidence = mergeConfidence(
    symbolChoice.confidence,
    footprintChoice.confidence,
  );

  if (confidence !== "high") {
    warnings.push(
      warning(
        "low_confidence_selection",
        `ZIP import selected symbol/footprint with ${confidence} confidence`,
      ),
    );
  }

  const result = commitKicadImport(ctx, {
    symbolLibrary,
    footprints: footprintsPayload,
    selection: {
      symbolId: symbolChoice.symbol.id,
      footprintId: footprintChoice.footprint.id,
    },
    component: {
      name: symbolChoice.symbol.name,
      description:
        symbolChoice.symbol.description ??
        rawSymbol?.properties.Description ??
        `${symbolChoice.symbol.name} imported from ZIP`,
    },
  });

  if (!result.reused) {
    attachArchiveMetadata(ctx, result.componentId, {
      archiveFileName,
      provider,
      selectedModel: modelChoice.selection,
      modelFiles: modelEntries.map((entry) => entry.baseName),
      warnings,
    });
  }

  const model3dCandidates = buildModel3dCandidates(
    modelEntries,
    modelChoice.selection,
  );
  const footprintId = getCommittedFootprintId(ctx, result.componentId);
  const selectedEntry = modelChoice.selection
    ? (stepModelEntries.find(
        (entry) => entry.baseName === modelChoice.selection?.fileName,
      ) ?? null)
    : null;
  const selectedCandidate = selectedEntry
    ? (model3dCandidates.find(
        (candidate) => candidate.fileName === selectedEntry.baseName,
      ) ?? null)
    : null;
  const modelConversion =
    footprintId && selectedEntry && selectedCandidate
      ? await persistPendingSourceStep(
          ctx,
          footprintId,
          selectedEntry,
          rawFootprint,
          selectedCandidate,
        )
      : null;

  return {
    ...result,
    warnings,
    model3dCandidates,
    modelConversion,
    selected: {
      symbolName: symbolChoice.symbol.name,
      footprintName: footprintChoice.footprint.name,
      modelFileName: modelChoice.selection?.fileName ?? null,
      confidence,
    },
  };
}
