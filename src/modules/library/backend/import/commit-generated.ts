/**
 * Commit endpoint for generated (IPC preset) footprints.
 *
 * Accepts a pre-built FootprintRenderSource + metadata directly —
 * no KiCad file parsing needed. Symbol still comes from KiCad import.
 */

import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { and, eq } from "drizzle-orm";
import { buildFootprintRenderModel } from "../../../../shared/rendering/footprint-preview-builder";
import type { FootprintRenderSource } from "../../../../shared/rendering/types";
import {
  componentFootprints,
  components,
  footprints,
  symbols,
} from "../schema";
import { getDb } from "../queries";
import { ImportValidationError, parseImportBundle } from "./inspect-kicad";
import type { CommitKicadResponse } from "./types";
import {
  validateFootprintPads,
  validateSymbolPinsCoverFootprintPads,
} from "./validate-pads";
import { buildIdentityPinMapJson } from "./pinmap";

export interface CommitGeneratedRequest {
  symbolLibrary: { fileName: string; content: string };
  selection: { symbolId: string };
  generatedFootprint: {
    source: FootprintRenderSource;
    metadata: {
      name: string;
      mountType: string;
      packageCode: { imperial: string | null; metric: string | null };
      tags: string[];
    };
  };
  /** "generated" (default) for IPC presets; "drawn" for user-drawn footprints with imported symbol. */
  footprintProvenance?: "generated" | "drawn";
  component: { name: string; description: string; tags?: string[] };
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ImportValidationError(`${field} must not be empty`);
  }
  return trimmed;
}

function dedupeTags(values: readonly string[]): string[] {
  return values
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag, index, all) => tag.length > 0 && all.indexOf(tag) === index);
}

function hashSource(source: FootprintRenderSource): string {
  const content = JSON.stringify({
    name: source.name,
    padCount: source.pads.length,
    pads: source.pads.map((p) => ({
      center: p.centerMm,
      w: p.widthMm,
      h: p.heightMm,
    })),
  });

  // Simple hash — deterministic for same geometry
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return `generated:${(hash >>> 0).toString(16)}`;
}

export function commitGeneratedImport(
  ctx: CoreBackendModuleContext,
  input: CommitGeneratedRequest,
): CommitKicadResponse {
  // Parse symbol from KiCad file (reuses existing pipeline)
  const parsed = parseImportBundle({
    symbolLibrary: input.symbolLibrary,
    footprints: [],
  });

  const selectedSymbolId = requireNonEmpty(
    input.selection.symbolId,
    "selection.symbolId",
  );
  const componentName = requireNonEmpty(input.component.name, "component.name");
  const componentDescription = input.component.description.trim();
  const userTags = dedupeTags(input.component.tags ?? []);

  const selectedSymbol = parsed.normalizedSymbols.find(
    (s) => s.id === selectedSymbolId,
  );
  if (!selectedSymbol) {
    throw new ImportValidationError(
      "Selected symbol is not present in import payload",
    );
  }

  const rawSymbol = parsed.raw.symbolById[selectedSymbolId];
  if (!rawSymbol) {
    throw new ImportValidationError(
      "Failed to map selected symbol raw payload",
    );
  }

  // Build footprint model from source
  const fpSource = input.generatedFootprint.source;
  const fpMeta = input.generatedFootprint.metadata;
  validateFootprintPads(fpSource);
  validateSymbolPinsCoverFootprintPads(selectedSymbol, fpSource);
  const fpModel = buildFootprintRenderModel(fpSource);
  const sourceHash = hashSource(fpSource);
  const pinMapJson = buildIdentityPinMapJson(selectedSymbol, fpSource);

  const now = new Date().toISOString();
  const symbolId = crypto.randomUUID();
  const footprintId = crypto.randomUUID();
  const componentId = crypto.randomUUID();

  const isDrawn = input.footprintProvenance === "drawn";
  const tags = isDrawn
    ? dedupeTags([...userTags, ...fpMeta.tags, "drawn-footprint"])
    : dedupeTags([...userTags, ...fpMeta.tags, "generated", "ipc-7351b"]);

  const symbolDataJson = JSON.stringify({
    provenance: {
      sourceKind: "imported",
      sourceFormat: "kicad_sym",
      fileName: parsed.raw.symbolFileName,
      importedAt: now,
      sourceHash: selectedSymbol.sourceHash,
    },
    parser: {
      warnings: rawSymbol.warnings,
      properties: rawSymbol.properties,
      units: rawSymbol.units,
    },
    normalized: selectedSymbol,
    raw: rawSymbol,
  });

  const footprintDataJson = JSON.stringify({
    provenance: {
      sourceKind: isDrawn ? "drawn" : "generated",
      sourceFormat: isDrawn ? "openpcb-editor" : "ipc-7351b",
      fileName: null,
      importedAt: now,
      sourceHash: sourceHash,
    },
    parser: { warnings: [] },
    normalized: {
      id: footprintId,
      fileName: "",
      name: fpMeta.name,
      description: isDrawn
        ? `Drawn ${fpMeta.name} footprint`
        : `Generated ${fpMeta.name} footprint (IPC-7351B)`,
      mountType: fpMeta.mountType,
      padCount: fpSource.pads.length,
      packageCode: fpMeta.packageCode,
      tags: fpMeta.tags,
      sourceHash,
      warnings: [],
      preview: fpModel,
    },
    raw: { source: fpSource },
  });

  const db = getDb(ctx);

  db.transaction((tx) => {
    const txDb = tx as typeof db;

    txDb
      .insert(symbols)
      .values({
        id: symbolId,
        name: selectedSymbol.name,
        dataJson: symbolDataJson,
        createdAt: now,
      })
      .run();

    txDb
      .insert(footprints)
      .values({
        id: footprintId,
        name: fpMeta.name,
        dataJson: footprintDataJson,
        createdAt: now,
      })
      .run();

    txDb
      .insert(components)
      .values({
        id: componentId,
        name: componentName,
        description:
          componentDescription.length > 0
            ? componentDescription
            : (selectedSymbol.description ?? `${fpMeta.name} component`),
        symbolId,
        footprintId,
        tagsJson: JSON.stringify(tags),
        createdAt: now,
      })
      .run();

    txDb
      .insert(componentFootprints)
      .values({
        componentId,
        footprintId,
        isDefault: 1,
        variantLabel: fpMeta.name,
        sortOrder: 0,
        pinMapJson,
      })
      .run();
  });

  return {
    componentId,
    componentName,
    reused: false,
  };
}
