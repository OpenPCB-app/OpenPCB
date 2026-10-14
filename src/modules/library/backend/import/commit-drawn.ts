/**
 * Commit endpoint for drawn (editor-created) symbols.
 *
 * Accepts a SymbolRenderSource directly — no KiCad parsing needed for the symbol.
 * Footprint can be imported (KiCad) or generated (IPC preset).
 */

import { rejectKicadFootprints } from "./unqualified-import";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { buildSymbolRenderModel } from "../../../../shared/rendering/symbol-preview-builder";
import type {
  FootprintRenderSource,
  SymbolRenderSource,
} from "../../../../shared/rendering/types";
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
import { buildAuthoredFootprintRecord, hashString } from "./footprint-record";
import {
  PLACEHOLDER_FOOTPRINT_NAME,
  ensurePlaceholderFootprint,
} from "../builtins/placeholder-footprint";
import {
  resolveGeneratedFootprint,
  UnqualifiedGeneratorError,
  type FootprintPayload,
  type GeneratedFootprintInput,
} from "./resolve-generated-footprint";

export interface CommitDrawnRequest {
  drawnSymbol: {
    source: SymbolRenderSource;
    referencePrefix: string;
  };
  footprintMode: "import" | "generated" | "drawn" | "none";
  // For import mode
  footprintFiles?: { fileName: string; content: string }[];
  footprintSelection?: { footprintId: string };
  generatedFootprint?: GeneratedFootprintInput;
  drawnFootprint?: FootprintPayload;
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

export function commitDrawnImport(
  ctx: CoreBackendModuleContext,
  input: CommitDrawnRequest,
): CommitKicadResponse {
  if (input.footprintMode === "import") {
    rejectKicadFootprints("kicad_mod", [
      input.footprintSelection?.footprintId ?? "unselected",
    ]);
  }
  const generated =
    input.footprintMode === "generated"
      ? resolveGeneratedFootprint(input.generatedFootprint)
      : null;
  if (
    input.footprintMode === "drawn" &&
    (!input.drawnFootprint || input.generatedFootprint)
  ) {
    throw new UnqualifiedGeneratorError(
      "Drawn mode requires a separate drawnFootprint payload; generated geometry must use explicit generator parameters.",
    );
  }
  const componentName = requireNonEmpty(input.component.name, "component.name");
  const componentDescription = input.component.description.trim();
  const userTags = dedupeTags(input.component.tags ?? []);

  // Build symbol model from drawn source
  const symbolSource = input.drawnSymbol.source;
  if (!symbolSource.pins || symbolSource.pins.length === 0) {
    throw new ImportValidationError("Drawn symbol must have at least one pin");
  }

  const symbolModel = buildSymbolRenderModel(symbolSource, {
    preserveOrigin: true,
  });
  const symbolHash = hashString(JSON.stringify(symbolSource));
  const now = new Date().toISOString();

  const symbolId = crypto.randomUUID();
  let footprintId: string = crypto.randomUUID();
  const componentId = crypto.randomUUID();

  const symbolDataJson = JSON.stringify({
    provenance: {
      sourceKind: "drawn",
      sourceFormat: "openpcb-editor",
      fileName: null,
      importedAt: now,
      sourceHash: symbolHash,
    },
    parser: { warnings: [] },
    normalized: {
      id: symbolId,
      name: symbolSource.name,
      referencePrefix: input.drawnSymbol.referencePrefix,
      description: componentDescription,
      sourceHash: symbolHash,
      pins: symbolSource.pins.map((p) => ({
        originPinKey: `u1:${p.number ?? p.id}`,
        number: p.number,
        name: p.name,
        localPosition: p.positionMm,
        electricalType: p.electricalType,
        unit: 1,
      })),
      warnings: [],
      preview: symbolModel,
    },
    raw: { source: symbolSource },
  });

  // Resolve footprint
  let footprintDataJson: string | null = null;
  let footprintName: string;
  let tags: string[];
  let pinMapJson: string | null = null;

  if (generated || (input.footprintMode === "drawn" && input.drawnFootprint)) {
    const authored = (generated ?? input.drawnFootprint)!;
    const record = buildAuthoredFootprintRecord({
      mode: generated ? "generated" : "drawn",
      source: authored.source,
      metadata: authored.metadata,
      symbol: symbolSource,
      footprintId,
      now,
      provenance: generated?.provenance,
    });
    footprintDataJson = record.footprintDataJson;
    pinMapJson = record.pinMapJson;
    footprintName = record.footprintName;
    tags = dedupeTags([
      ...userTags,
      ...authored.metadata.tags,
      "drawn-symbol",
      generated ? "generated" : "drawn-footprint",
    ]);
  } else if (
    input.footprintMode === "import" &&
    input.footprintFiles &&
    input.footprintSelection
  ) {
    // Parse footprint from KiCad files (no symbol library — drawn-symbol flow)
    const parsed = parseImportBundle({
      symbolLibrary: null,
      footprints: input.footprintFiles,
    });
    const selectedFp = parsed.normalizedFootprints.find(
      (fp) => fp.id === input.footprintSelection!.footprintId,
    );
    if (!selectedFp) {
      throw new ImportValidationError("Selected footprint not found in files");
    }
    validateFootprintPads(selectedFp.preview);
    validateSymbolPinsCoverFootprintPads(symbolSource, selectedFp.preview);
    const rawFp = parsed.raw.footprintById[selectedFp.id];
    pinMapJson = buildIdentityPinMapJson(symbolSource, selectedFp.preview);
    footprintName = selectedFp.name;
    tags = dedupeTags([...userTags, ...selectedFp.tags, "drawn-symbol"]);

    footprintDataJson = JSON.stringify({
      provenance: {
        sourceKind: "imported",
        sourceFormat: "kicad_mod",
        fileName: parsed.raw.footprintFileByName[selectedFp.name],
        importedAt: now,
        sourceHash: selectedFp.sourceHash,
      },
      parser: { warnings: rawFp?.warnings ?? [] },
      normalized: selectedFp,
      raw: rawFp,
    });
  } else {
    // No footprint — link the shared placeholder row (created in the tx below).
    footprintName = PLACEHOLDER_FOOTPRINT_NAME;
    tags = dedupeTags([
      ...userTags,
      "drawn-symbol",
      "placeholder-footprint",
      "virtual",
    ]);
  }

  const db = getDb(ctx);

  db.transaction((tx) => {
    const txDb = tx as typeof db;

    txDb
      .insert(symbols)
      .values({
        id: symbolId,
        name: symbolSource.name,
        dataJson: symbolDataJson,
        createdAt: now,
        sourceId: "user.local",
      })
      .run();

    if (footprintDataJson === null) {
      footprintId = ensurePlaceholderFootprint(ctx, now, txDb);
    } else {
      txDb
        .insert(footprints)
        .values({
          id: footprintId,
          name: footprintName,
          dataJson: footprintDataJson,
          createdAt: now,
          sourceId: "user.local",
        })
        .run();
    }

    txDb
      .insert(components)
      .values({
        id: componentId,
        name: componentName,
        description:
          componentDescription.length > 0
            ? componentDescription
            : `${symbolSource.name} component`,
        symbolId,
        footprintId,
        tagsJson: JSON.stringify(tags),
        createdAt: now,
        sourceId: "user.local",
      })
      .run();

    txDb
      .insert(componentFootprints)
      .values({
        componentId,
        footprintId,
        isDefault: 1,
        variantLabel: footprintName,
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
