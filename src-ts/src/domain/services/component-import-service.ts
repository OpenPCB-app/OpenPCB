/**
 * Component Import Service
 *
 * Orchestrates KiCad file parsing, grouping heuristics,
 * provenance tracking, and preview/confirm flow.
 */

import { parseKicadSymbolLib } from "../../infrastructure/parsers/kicad/kicad-symbol-parser";
import { parseKicadFootprint } from "../../infrastructure/parsers/kicad/kicad-footprint-parser";
import { classifyModel3DLinks } from "../../infrastructure/parsers/kicad/kicad-model-linker";
import {
  groupFootprints,
  type FootprintFileInfo,
} from "./component-import-heuristics";
import type { ImportWarning } from "../../core/schemas/component-semantics";

export interface ImportFileInput {
  fileName: string;
  content: string;
}

export interface ImportPreviewResult {
  groups: ImportPreviewGroup[];
  ungroupedFiles: string[];
  totalWarnings: number;
  totalBlockers: number;
}

export interface ImportPreviewGroup {
  suggestedFamilyLabel: string;
  suggestedCanonicalKey: string;
  variants: ImportPreviewVariant[];
  warnings: ImportWarning[];
  symbolFileName: string | null;
}

export interface ImportPreviewVariant {
  suggestedCanonicalCode: string;
  suggestedHumanLabel: string;
  footprintFileNames: string[];
  model3dFileNames: string[];
  confidence: number;
}

export interface IComponentImportService {
  generatePreview(
    files: ImportFileInput[],
    availableModelFiles: string[],
  ): ImportPreviewResult;
}

export class ComponentImportService implements IComponentImportService {
  generatePreview(
    files: ImportFileInput[],
    availableModelFiles: string[],
  ): ImportPreviewResult {
    const symbolFiles = files.filter((f) => f.fileName.endsWith(".kicad_sym"));
    const footprintFiles = files.filter((f) =>
      f.fileName.endsWith(".kicad_mod"),
    );
    const ungroupedFiles: string[] = [];
    const allWarnings: ImportWarning[] = [];

    // Parse symbols
    const parsedSymbols = symbolFiles.flatMap((f) => {
      try {
        const result = parseKicadSymbolLib(f.content);
        return result.symbols.map((s) => ({ ...s, sourceFile: f.fileName }));
      } catch {
        ungroupedFiles.push(f.fileName);
        allWarnings.push({
          code: "import_ambiguity",
          message: `Failed to parse symbol file: ${f.fileName}`,
          severity: "warning",
          context: { fileName: f.fileName },
        });
        return [];
      }
    });

    // Parse footprints
    const parsedFootprints: FootprintFileInfo[] = [];
    for (const f of footprintFiles) {
      try {
        const parsed = parseKicadFootprint(f.content);
        const modelFileNames = parsed.model3dRefs.map(
          (ref) => ref.resolvedFileName,
        );
        parsedFootprints.push({
          fileName: f.fileName,
          name: parsed.name,
          model3dFileNames: modelFileNames,
        });

        // Collect parser warnings
        for (const w of parsed.warnings) {
          allWarnings.push({
            code: "unsupported_construct",
            message: w.message,
            severity: "warning",
            context: { fileName: f.fileName },
          });
        }
      } catch {
        ungroupedFiles.push(f.fileName);
        allWarnings.push({
          code: "import_ambiguity",
          message: `Failed to parse footprint file: ${f.fileName}`,
          severity: "warning",
          context: { fileName: f.fileName },
        });
      }
    }

    // Classify 3D links
    const model3dClassifications = classifyModel3DLinks(
      parsedFootprints.map((fp) => ({
        name: fp.name,
        model3dRefs: fp.model3dFileNames.map((f) => ({
          resolvedFileName: f,
        })),
      })),
      availableModelFiles,
    );

    // Add 3D warnings
    for (const cl of model3dClassifications) {
      if (cl.status === "missing_target") {
        allWarnings.push({
          code: "missing_3d_model",
          message: `Footprint "${cl.footprintName}" references missing 3D model: ${cl.modelFileName}`,
          severity: "warning",
          context: {
            footprintName: cl.footprintName,
            modelFileName: cl.modelFileName,
          },
        });
      } else if (cl.status === "orphan_asset") {
        allWarnings.push({
          code: "orphan_model_file",
          message: `3D model "${cl.modelFileName}" is not referenced by any footprint`,
          severity: "warning",
          context: { modelFileName: cl.modelFileName },
        });
      }
    }

    // Group footprints using heuristics
    const groupingSuggestions = groupFootprints(parsedFootprints);

    // Build preview groups
    const groups: ImportPreviewGroup[] = groupingSuggestions.map((g) => {
      // Try to match a symbol to this group (by reference prefix or name pattern)
      const matchedSymbol = parsedSymbols.find((s) => {
        const prefix = s.properties["Reference"] ?? "";
        if (g.suggestedCanonicalKey.startsWith("c_") && prefix === "C")
          return true;
        if (g.suggestedCanonicalKey.startsWith("cp_") && prefix === "C")
          return true;
        return false;
      });

      const groupWarnings = allWarnings.filter((w) =>
        g.variants.some(
          (v) =>
            v.footprintFileNames.some((fn) => w.context["fileName"] === fn) ||
            v.model3dFileNames.some((mn) => w.context["modelFileName"] === mn),
        ),
      );

      return {
        suggestedFamilyLabel: g.suggestedFamilyLabel,
        suggestedCanonicalKey: g.suggestedCanonicalKey,
        variants: g.variants.map((v) => ({
          suggestedCanonicalCode: v.suggestedCanonicalCode,
          suggestedHumanLabel: v.suggestedHumanLabel,
          footprintFileNames: v.footprintFileNames,
          model3dFileNames: v.model3dFileNames,
          confidence: v.confidence,
        })),
        warnings: groupWarnings,
        symbolFileName: matchedSymbol
          ? (matchedSymbol as { sourceFile: string }).sourceFile
          : null,
      };
    });

    const blockerCount = allWarnings.filter(
      (w) => w.severity === "blocker",
    ).length;

    return {
      groups,
      ungroupedFiles,
      totalWarnings: allWarnings.length - blockerCount,
      totalBlockers: blockerCount,
    };
  }
}
