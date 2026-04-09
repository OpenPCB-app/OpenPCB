import { createHash } from "node:crypto";
import type {
  ComponentWithVariants,
  ComponentRepository,
  CreateComponentInput,
  CreateVariantInput,
} from "../../db/repositories/component-repository";
import { UniqueConstraintError } from "../../db/errors";
import {
  parseKicadSymbolLib,
  type ParsedKicadSymbol,
} from "../../infrastructure/parsers/kicad/kicad-symbol-parser";
import {
  parseKicadFootprint,
  type ParsedKicadFootprint,
} from "../../infrastructure/parsers/kicad/kicad-footprint-parser";
import { classifyModel3DLinks } from "../../infrastructure/parsers/kicad/kicad-model-linker";
import {
  groupFootprints,
  type FootprintFileInfo,
} from "./component-import-heuristics";
import type { ImportWarning } from "../../core/schemas/component-semantics";

export interface ImportFileInput {
  fileName: string;
  content?: string;
}

export interface ImportedComponentSummary {
  componentId: string;
  displayLabel: string;
  canonicalKey: string;
  variantCount: number;
  sourceFileNames: string[];
}

export interface ComponentImportResult {
  components: ImportedComponentSummary[];
  warnings: ImportWarning[];
  ungroupedFiles: string[];
}

export interface IComponentImportService {
  importFiles(files: ImportFileInput[]): Promise<ComponentImportResult>;
}

type ImportRepository = Pick<ComponentRepository, "createComponent">;

type ParsedImportSymbol = {
  sourceFileName: string;
  sourceHash: string;
  symbol: ParsedKicadSymbol;
};

type ParsedImportFootprint = {
  sourceFileName: string;
  sourceHash: string;
  footprint: ParsedKicadFootprint;
};

type GroupSuggestion = ReturnType<typeof groupFootprints>[number];

type ImportPlan = {
  displayLabel: string;
  canonicalKey: string;
  description: string;
  categoryPath: string | null;
  tags: string[];
  symbolData: Record<string, unknown>;
  variants: CreateVariantInput[];
  sourceFileNames: string[];
};

export class ComponentImportService implements IComponentImportService {
  constructor(private readonly repo: ImportRepository) {}

  async importFiles(files: ImportFileInput[]): Promise<ComponentImportResult> {
    const kicadFiles = files.filter((file) => isKicadFile(file.fileName));
    if (kicadFiles.length === 0) {
      throw new Error("No KiCad symbol or footprint files provided");
    }

    const warnings: ImportWarning[] = [];
    const ungroupedFiles: string[] = [];
    const symbols = this.parseSymbols(files, warnings, ungroupedFiles);
    const footprints = this.parseFootprints(files, warnings, ungroupedFiles);
    const modelFiles = files
      .map((file) => file.fileName)
      .filter((fileName) => isModelFile(fileName));

    this.collectModelWarnings(footprints, modelFiles, warnings);

    const plans = this.buildImportPlans(symbols, footprints, warnings);
    if (plans.length === 0) {
      throw new Error("No importable components found in the provided files");
    }

    const createdComponents: ImportedComponentSummary[] = [];
    const usedCanonicalKeys = new Set<string>();

    for (const plan of plans) {
      const created = await this.createComponent(plan, usedCanonicalKeys);
      createdComponents.push({
        componentId: created.component.id,
        displayLabel: created.component.displayLabel,
        canonicalKey: created.component.canonicalKey,
        variantCount: created.variants.length,
        sourceFileNames: plan.sourceFileNames,
      });
    }

    return {
      components: createdComponents,
      warnings,
      ungroupedFiles,
    };
  }

  private parseSymbols(
    files: ImportFileInput[],
    warnings: ImportWarning[],
    ungroupedFiles: string[],
  ): ParsedImportSymbol[] {
    const parsedSymbols: ParsedImportSymbol[] = [];

    for (const file of files) {
      if (!file.fileName.endsWith(".kicad_sym")) {
        continue;
      }

      if (!file.content) {
        ungroupedFiles.push(file.fileName);
        warnings.push({
          code: "import_ambiguity",
          message: `Missing content for symbol file: ${file.fileName}`,
          severity: "warning",
          context: { fileName: file.fileName },
        });
        continue;
      }

      try {
        const parsed = parseKicadSymbolLib(file.content);
        for (const symbol of parsed.symbols) {
          parsedSymbols.push({
            sourceFileName: file.fileName,
            sourceHash: hashContent(file.content),
            symbol,
          });
        }
      } catch {
        ungroupedFiles.push(file.fileName);
        warnings.push({
          code: "import_ambiguity",
          message: `Failed to parse symbol file: ${file.fileName}`,
          severity: "warning",
          context: { fileName: file.fileName },
        });
      }
    }

    return parsedSymbols;
  }

  private parseFootprints(
    files: ImportFileInput[],
    warnings: ImportWarning[],
    ungroupedFiles: string[],
  ): ParsedImportFootprint[] {
    const parsedFootprints: ParsedImportFootprint[] = [];

    for (const file of files) {
      if (!file.fileName.endsWith(".kicad_mod")) {
        continue;
      }

      if (!file.content) {
        ungroupedFiles.push(file.fileName);
        warnings.push({
          code: "import_ambiguity",
          message: `Missing content for footprint file: ${file.fileName}`,
          severity: "warning",
          context: { fileName: file.fileName },
        });
        continue;
      }

      try {
        const footprint = parseKicadFootprint(file.content);
        parsedFootprints.push({
          sourceFileName: file.fileName,
          sourceHash: hashContent(file.content),
          footprint,
        });

        for (const warning of footprint.warnings) {
          warnings.push({
            code: "unsupported_construct",
            message: warning.message,
            severity: "warning",
            context: { fileName: file.fileName },
          });
        }
      } catch {
        ungroupedFiles.push(file.fileName);
        warnings.push({
          code: "import_ambiguity",
          message: `Failed to parse footprint file: ${file.fileName}`,
          severity: "warning",
          context: { fileName: file.fileName },
        });
      }
    }

    return parsedFootprints;
  }

  private collectModelWarnings(
    footprints: ParsedImportFootprint[],
    modelFiles: string[],
    warnings: ImportWarning[],
  ): void {
    const classifications = classifyModel3DLinks(
      footprints.map(({ footprint }) => ({
        name: footprint.name,
        model3dRefs: footprint.model3dRefs,
      })),
      modelFiles,
    );

    for (const classification of classifications) {
      if (classification.status === "missing_target") {
        warnings.push({
          code: "missing_3d_model",
          message: `Footprint "${classification.footprintName}" references missing 3D model: ${classification.modelFileName}`,
          severity: "warning",
          context: {
            footprintName: classification.footprintName,
            modelFileName: classification.modelFileName,
          },
        });
      }

      if (classification.status === "orphan_asset") {
        warnings.push({
          code: "orphan_model_file",
          message: `3D model "${classification.modelFileName}" is not referenced by any footprint`,
          severity: "warning",
          context: { modelFileName: classification.modelFileName },
        });
      }
    }
  }

  private buildImportPlans(
    symbols: ParsedImportSymbol[],
    footprints: ParsedImportFootprint[],
    warnings: ImportWarning[],
  ): ImportPlan[] {
    if (footprints.length === 0) {
      return symbols.map((symbol) => this.buildSymbolOnlyPlan(symbol));
    }

    const footprintLookup = new Map<string, ParsedImportFootprint>(
      footprints.map((footprint) => [footprint.sourceFileName, footprint]),
    );
    const remainingSymbols = [...symbols];
    const suggestions = groupFootprints(
      footprints.map(
        ({ sourceFileName, footprint }) =>
          ({
            fileName: sourceFileName,
            name: footprint.name,
            model3dFileNames: footprint.model3dRefs.map(
              (ref) => ref.resolvedFileName,
            ),
          }) satisfies FootprintFileInfo,
      ),
    );

    const plans = suggestions.map((suggestion) => {
      const matchedSymbol = this.pickSymbolForGroup(
        suggestion,
        remainingSymbols,
      );
      const variants = this.buildVariantsFromSuggestion(
        suggestion,
        footprintLookup,
      );
      const primaryFootprint = (variants[0]?.footprintOptions?.[0]
        ?.kicadPayload ?? null) as Record<string, unknown> | null;

      if (!matchedSymbol) {
        warnings.push({
          code: "missing_symbol_data",
          message: `Importing ${suggestion.suggestedFamilyLabel} without a matched symbol file`,
          severity: "warning",
          context: { familyLabel: suggestion.suggestedFamilyLabel },
        });
      }

      return {
        displayLabel:
          suggestion.suggestedFamilyLabel ||
          matchedSymbol?.symbol.name ||
          "Imported Component",
        canonicalKey:
          suggestion.suggestedCanonicalKey ||
          generateCanonicalKey(
            suggestion.suggestedFamilyLabel ||
              matchedSymbol?.symbol.name ||
              "component",
          ),
        description:
          getSymbolDescription(matchedSymbol?.symbol) ||
          getFootprintDescription(primaryFootprint) ||
          "",
        categoryPath: getCategoryPath(matchedSymbol?.symbol),
        tags: this.collectTagsForSuggestion(suggestion, footprintLookup),
        symbolData: this.buildSymbolData(matchedSymbol, suggestion),
        variants,
        sourceFileNames: uniqueStrings([
          ...(matchedSymbol ? [matchedSymbol.sourceFileName] : []),
          ...suggestion.variants.flatMap(
            (variant) => variant.footprintFileNames,
          ),
        ]),
      } satisfies ImportPlan;
    });

    for (const symbol of remainingSymbols) {
      plans.push(this.buildSymbolOnlyPlan(symbol));
    }

    return plans.filter((plan) => plan.variants.length > 0);
  }

  private buildSymbolOnlyPlan(symbol: ParsedImportSymbol): ImportPlan {
    const displayLabel = symbol.symbol.name || "Imported Symbol";
    return {
      displayLabel,
      canonicalKey: generateCanonicalKey(displayLabel),
      description: getSymbolDescription(symbol.symbol),
      categoryPath: getCategoryPath(symbol.symbol),
      tags: [],
      symbolData: this.buildSymbolData(symbol, null),
      variants: [
        {
          canonicalCode: "default",
          humanLabel: "Default",
          imperialAlias: null,
          metricAlias: null,
          mountType: "virtual",
          dimensions: null,
          isDefault: true,
          pinRemapTable: null,
          footprintOptions: [],
          defaultFootprintOptionId: null,
        },
      ],
      sourceFileNames: [symbol.sourceFileName],
    };
  }

  private buildVariantsFromSuggestion(
    suggestion: GroupSuggestion,
    footprintLookup: Map<string, ParsedImportFootprint>,
  ): CreateVariantInput[] {
    const variants: CreateVariantInput[] = [];

    for (const suggestedVariant of suggestion.variants) {
      const matchedFootprints = suggestedVariant.footprintFileNames
        .map((fileName) => footprintLookup.get(fileName))
        .filter((footprint): footprint is ParsedImportFootprint =>
          Boolean(footprint),
        );

      for (let index = 0; index < matchedFootprints.length; index += 1) {
        const matchedFootprint = matchedFootprints[index]!;
        const suffix = matchedFootprints.length > 1 ? `${index + 1}` : "";
        const footprintOptionId = crypto.randomUUID();
        variants.push({
          canonicalCode: buildVariantCode(
            suggestedVariant.suggestedCanonicalCode,
            matchedFootprint.footprint.name,
            suffix,
          ),
          humanLabel: buildVariantLabel(
            suggestedVariant.suggestedHumanLabel,
            matchedFootprint.footprint.name,
            matchedFootprints.length > 1
              ? matchedFootprint.footprint.name
              : undefined,
          ),
          imperialAlias: null,
          metricAlias: null,
          mountType: resolveMountType(matchedFootprint.footprint),
          dimensions: null,
          isDefault: variants.length === 0,
          pinRemapTable: null,
          footprintOptions: [
            {
              id: footprintOptionId,
              label: "Default",
              isDefault: true,
              kicadPayload: buildFootprintPayload(matchedFootprint),
              model3dOptions: [],
              densityLevel: null,
              ipcName: null,
            },
          ],
          defaultFootprintOptionId: footprintOptionId,
        });
      }
    }

    return variants;
  }

  private buildSymbolData(
    symbol: ParsedImportSymbol | undefined,
    suggestion: GroupSuggestion | null,
  ): Record<string, unknown> {
    if (!symbol) {
      return {
        referencePrefix: inferReferencePrefix(
          suggestion?.suggestedCanonicalKey,
          suggestion?.suggestedFamilyLabel,
        ),
        pinDefinitions: [],
        properties: {},
        unitCount: 1,
        bodyGraphics: [],
        rawKicadSource: null,
        importProvenance: {
          source: "footprint-only",
          importedFromFiles:
            suggestion?.variants.flatMap(
              (variant) => variant.footprintFileNames,
            ) ?? [],
        },
      };
    }

    return {
      referencePrefix:
        symbol.symbol.properties.Reference ||
        inferReferencePrefix(
          symbol.symbol.name,
          suggestion?.suggestedFamilyLabel,
        ),
      pinDefinitions: symbol.symbol.pins.map((pin) => ({
        number: pin.number,
        name: pin.name,
        electricalType: pin.electricalType,
        unit: pin.unit,
      })),
      properties: symbol.symbol.properties,
      unitCount: symbol.symbol.units,
      bodyGraphics: symbol.symbol.bodyGraphics,
      rawKicadSource: symbol.symbol.rawSource,
      importProvenance: {
        source: "kicad_symbol",
        sourceFileName: symbol.sourceFileName,
        sourceHash: symbol.sourceHash,
        originalName: symbol.symbol.name,
        kicadIdentifier: symbol.symbol.kicadId ?? symbol.symbol.name,
      },
    };
  }

  private collectTagsForSuggestion(
    suggestion: GroupSuggestion,
    footprintLookup: Map<string, ParsedImportFootprint>,
  ): string[] {
    return uniqueStrings(
      suggestion.variants.flatMap((variant) =>
        variant.footprintFileNames.flatMap((fileName) => {
          const footprint = footprintLookup.get(fileName);
          return footprint ? footprint.footprint.tags : [];
        }),
      ),
    );
  }

  private pickSymbolForGroup(
    suggestion: GroupSuggestion,
    remainingSymbols: ParsedImportSymbol[],
  ): ParsedImportSymbol | undefined {
    if (remainingSymbols.length === 0) {
      return undefined;
    }

    if (remainingSymbols.length === 1) {
      return remainingSymbols.splice(0, 1)[0];
    }

    const suggestionText = `${suggestion.suggestedFamilyLabel} ${suggestion.suggestedCanonicalKey}`;
    let bestIndex = -1;
    let bestScore = -1;

    remainingSymbols.forEach((symbol, index) => {
      const score = scoreSymbolForGroup(symbol.symbol, suggestionText);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex < 0) {
      return undefined;
    }

    return remainingSymbols.splice(bestIndex, 1)[0];
  }

  private async createComponent(
    plan: ImportPlan,
    usedCanonicalKeys: Set<string>,
  ): Promise<ComponentWithVariants> {
    let canonicalKey = ensureBatchUnique(plan.canonicalKey, usedCanonicalKeys);
    const input: CreateComponentInput = {
      canonicalKey,
      displayLabel: plan.displayLabel,
      description: plan.description,
      symbolData: plan.symbolData,
      categoryPath: plan.categoryPath,
      tags: plan.tags,
      variants: plan.variants,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const created = await this.repo.createComponent(input);
        usedCanonicalKeys.add(created.component.canonicalKey);
        return created;
      } catch (error) {
        if (!(error instanceof UniqueConstraintError)) {
          throw error;
        }

        canonicalKey = `${plan.canonicalKey}-${attempt + 2}`;
        input.canonicalKey = ensureBatchUnique(canonicalKey, usedCanonicalKeys);
      }
    }

    input.canonicalKey = `${plan.canonicalKey}-${crypto.randomUUID().slice(0, 8)}`;
    const created = await this.repo.createComponent(input);
    usedCanonicalKeys.add(created.component.canonicalKey);
    return created;
  }
}

function buildVariantCode(
  baseCode: string,
  fallbackName: string,
  suffix: string,
): string {
  const base = generateCanonicalKey(baseCode || fallbackName || "default");
  return suffix ? `${base}-${suffix}` : base;
}

function buildVariantLabel(
  baseLabel: string,
  fallbackName: string,
  extraLabel?: string,
): string {
  const label = baseLabel || fallbackName || "Default";
  return extraLabel ? `${label} (${extraLabel})` : label;
}

function buildFootprintPayload(
  footprint: ParsedImportFootprint,
): Record<string, unknown> {
  return {
    name: footprint.footprint.name,
    description: footprint.footprint.description,
    tags: footprint.footprint.tags,
    pads: footprint.footprint.pads,
    graphics: footprint.footprint.graphics,
    attributes: footprint.footprint.attributes,
    model3dRefs: footprint.footprint.model3dRefs,
    rawKicadSource: footprint.footprint.rawSource,
    importProvenance: {
      source: "kicad_footprint",
      sourceFileName: footprint.sourceFileName,
      sourceHash: footprint.sourceHash,
      originalName: footprint.footprint.name,
      referencedModelFiles: footprint.footprint.model3dRefs.map(
        (ref) => ref.resolvedFileName,
      ),
    },
  };
}

function scoreSymbolForGroup(
  symbol: ParsedKicadSymbol,
  suggestionText: string,
): number {
  const normalizedSuggestion = normalizeTokens(suggestionText);
  const normalizedSymbol = normalizeTokens(
    `${symbol.name} ${symbol.kicadId ?? ""}`,
  );
  let score = 0;

  for (const token of normalizedSymbol) {
    if (normalizedSuggestion.has(token)) {
      score += 2;
    }
  }

  const reference = symbol.properties.Reference;
  if (reference) {
    const inferredPrefix = inferReferencePrefix(suggestionText);
    if (reference.toUpperCase() === inferredPrefix) {
      score += 3;
    }
  }

  return score;
}

function normalizeTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0),
  );
}

function getSymbolDescription(symbol?: ParsedKicadSymbol): string {
  if (!symbol) {
    return "";
  }

  return symbol.properties.Description || symbol.properties.description || "";
}

function getFootprintDescription(
  payload: Record<string, unknown> | null | undefined,
): string {
  return typeof payload?.description === "string" ? payload.description : "";
}

function getCategoryPath(symbol?: ParsedKicadSymbol): string | null {
  const value = symbol?.properties.__openpcbCategoryPath;
  return typeof value === "string" ? value : null;
}

function resolveMountType(
  footprint: ParsedKicadFootprint,
): "smd" | "through_hole" | "virtual" {
  if (footprint.attributes.type === "smd") {
    return "smd";
  }

  if (footprint.attributes.type === "through_hole") {
    return "through_hole";
  }

  return "virtual";
}

function generateCanonicalKey(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `component-${crypto.randomUUID().slice(0, 8)}`;
}

function ensureBatchUnique(
  canonicalKey: string,
  usedCanonicalKeys: Set<string>,
): string {
  if (!usedCanonicalKeys.has(canonicalKey)) {
    return canonicalKey;
  }

  let suffix = 2;
  while (usedCanonicalKeys.has(`${canonicalKey}-${suffix}`)) {
    suffix += 1;
  }

  return `${canonicalKey}-${suffix}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function inferReferencePrefix(
  ...values: Array<string | undefined | null>
): string {
  const text = values.join(" ").toLowerCase();

  if (text.includes("capacitor")) return "C";
  if (text.includes("resistor")) return "R";
  if (text.includes("inductor")) return "L";
  if (text.includes("diode")) return "D";
  if (text.includes("transistor")) return "Q";
  if (text.includes("connector")) return "J";
  if (text.includes("switch")) return "SW";
  return "U";
}

function isModelFile(fileName: string): boolean {
  return /\.(step|stp|wrl)$/i.test(fileName);
}

function isKicadFile(fileName: string): boolean {
  return fileName.endsWith(".kicad_sym") || fileName.endsWith(".kicad_mod");
}
