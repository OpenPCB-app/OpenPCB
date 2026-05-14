/**
 * Commit endpoint for drawn (editor-created) symbols.
 *
 * Accepts a SymbolRenderSource directly — no KiCad parsing needed for the symbol.
 * Footprint can be imported (KiCad) or generated (IPC preset).
 */

import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { buildSymbolRenderModel } from "../../../../shared/rendering/symbol-preview-builder";
import { buildFootprintRenderModel } from "../../../../shared/rendering/footprint-preview-builder";
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

export interface CommitDrawnRequest {
  drawnSymbol: {
    source: SymbolRenderSource;
    referencePrefix: string;
  };
  footprintMode: "import" | "generated" | "drawn" | "none";
  // For import mode
  footprintFiles?: { fileName: string; content: string }[];
  footprintSelection?: { footprintId: string };
  // For generated or drawn mode
  generatedFootprint?: {
    source: FootprintRenderSource;
    metadata: {
      name: string;
      mountType: string;
      packageCode: { imperial: string | null; metric: string | null };
      tags: string[];
    };
  };
  // For drawn mode (identical shape to generatedFootprint)
  drawnFootprint?: {
    source: FootprintRenderSource;
    metadata: {
      name: string;
      mountType: string;
      packageCode: { imperial: string | null; metric: string | null };
      tags: string[];
    };
  };
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

function hashString(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return `drawn:${(hash >>> 0).toString(16)}`;
}

export function commitDrawnImport(
  ctx: CoreBackendModuleContext,
  input: CommitDrawnRequest,
): CommitKicadResponse {
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
  const footprintId = crypto.randomUUID();
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
  let footprintDataJson: string;
  let footprintName: string;
  let tags: string[];
  let pinMapJson: string | null = null;

  if (input.footprintMode === "generated" && input.generatedFootprint) {
    const fpSource = input.generatedFootprint.source;
    const fpMeta = input.generatedFootprint.metadata;
    validateFootprintPads(fpSource);
    validateSymbolPinsCoverFootprintPads(symbolSource, fpSource);
    const fpModel = buildFootprintRenderModel(fpSource);
    const fpHash = hashString(JSON.stringify(fpSource));
    pinMapJson = buildIdentityPinMapJson(symbolSource, fpSource);
    footprintName = fpMeta.name;
    tags = dedupeTags([
      ...userTags,
      ...fpMeta.tags,
      "drawn-symbol",
      "generated",
    ]);

    footprintDataJson = JSON.stringify({
      provenance: {
        sourceKind: "generated",
        sourceFormat: "ipc-7351b",
        fileName: null,
        importedAt: now,
        sourceHash: fpHash,
      },
      parser: { warnings: [] },
      normalized: {
        id: footprintId,
        fileName: "",
        name: fpMeta.name,
        description: `Generated ${fpMeta.name} footprint`,
        mountType: fpMeta.mountType,
        padCount: fpSource.pads.length,
        packageCode: fpMeta.packageCode,
        tags: fpMeta.tags,
        sourceHash: fpHash,
        warnings: [],
        preview: fpModel,
      },
      raw: { source: fpSource },
    });
  } else if (input.footprintMode === "drawn" && input.drawnFootprint) {
    const fpSource = input.drawnFootprint.source;
    const fpMeta = input.drawnFootprint.metadata;
    validateFootprintPads(fpSource);
    validateSymbolPinsCoverFootprintPads(symbolSource, fpSource);
    const fpModel = buildFootprintRenderModel(fpSource);
    const fpHash = hashString(JSON.stringify(fpSource));
    pinMapJson = buildIdentityPinMapJson(symbolSource, fpSource);
    footprintName = fpMeta.name;
    tags = dedupeTags([
      ...userTags,
      ...fpMeta.tags,
      "drawn-symbol",
      "drawn-footprint",
    ]);

    footprintDataJson = JSON.stringify({
      provenance: {
        sourceKind: "drawn",
        sourceFormat: "openpcb-editor",
        fileName: null,
        importedAt: now,
        sourceHash: fpHash,
      },
      parser: { warnings: [] },
      normalized: {
        id: footprintId,
        fileName: "",
        name: fpMeta.name,
        description: `Drawn ${fpMeta.name} footprint`,
        mountType: fpMeta.mountType,
        padCount: fpSource.pads.length,
        packageCode: fpMeta.packageCode,
        tags: fpMeta.tags,
        sourceHash: fpHash,
        warnings: [],
        preview: fpModel,
      },
      raw: { source: fpSource },
    });
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
    // No footprint — use placeholder
    footprintName = "No footprint yet";
    tags = dedupeTags([
      ...userTags,
      "drawn-symbol",
      "placeholder-footprint",
      "virtual",
    ]);

    footprintDataJson = JSON.stringify({
      provenance: {
        sourceKind: "system",
        sourceFormat: "placeholder",
        fileName: null,
        importedAt: now,
        sourceHash: "placeholder:no-footprint-yet",
      },
      parser: { warnings: [] },
      normalized: {
        id: footprintId,
        fileName: "",
        name: footprintName,
        description: "Component was created without a real PCB footprint.",
        mountType: "virtual",
        padCount: 0,
        packageCode: { imperial: null, metric: null },
        tags: ["placeholder-footprint", "virtual"],
        sourceHash: "placeholder:no-footprint-yet",
        warnings: [],
        preview: null,
      },
      raw: { kind: "placeholder-footprint", name: footprintName },
    });
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
      })
      .run();

    txDb
      .insert(footprints)
      .values({
        id: footprintId,
        name: footprintName,
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
            : `${symbolSource.name} component`,
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
