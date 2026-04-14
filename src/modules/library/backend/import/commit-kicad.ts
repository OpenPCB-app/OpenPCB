import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { components, footprints, symbols } from "../schema";
import { getDb } from "../queries";
import { ImportValidationError, parseImportBundle } from "./inspect-kicad";
import type { CommitKicadRequest, CommitKicadResponse } from "./types";

function trimOrEmpty(value: string): string {
  return value.trim();
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = trimOrEmpty(value);
  if (trimmed.length === 0) {
    throw new ImportValidationError(`${field} must not be empty`);
  }
  return trimmed;
}

export function commitKicadImport(
  ctx: CoreBackendModuleContext,
  input: CommitKicadRequest,
): CommitKicadResponse {
  const parsed = parseImportBundle(input);

  const selectedSymbolId = requireNonEmpty(
    input.selection.symbolId,
    "selection.symbolId",
  );
  const selectedFootprintId = requireNonEmpty(
    input.selection.footprintId,
    "selection.footprintId",
  );
  const componentName = requireNonEmpty(input.component.name, "component.name");
  const componentDescription = trimOrEmpty(input.component.description);

  const selectedSymbol = parsed.normalizedSymbols.find(
    (symbol) => symbol.id === selectedSymbolId,
  );
  if (!selectedSymbol) {
    throw new ImportValidationError(
      "Selected symbol is not present in import payload",
    );
  }

  const selectedFootprint = parsed.normalizedFootprints.find(
    (footprint) => footprint.id === selectedFootprintId,
  );
  if (!selectedFootprint) {
    throw new ImportValidationError(
      "Selected footprint is not present in import payload",
    );
  }

  const rawSymbol = parsed.raw.symbolById[selectedSymbolId];
  if (!rawSymbol) {
    throw new ImportValidationError("Failed to map selected symbol raw payload");
  }

  const rawFootprint = parsed.raw.footprintById[selectedFootprintId];
  if (!rawFootprint) {
    throw new ImportValidationError(
      "Failed to map selected footprint raw payload",
    );
  }

  const now = new Date().toISOString();
  const symbolId = crypto.randomUUID();
  const footprintId = crypto.randomUUID();
  const componentId = crypto.randomUUID();
  const warningCount =
    selectedSymbol.warnings.length + selectedFootprint.warnings.length;

  const tags = [...selectedFootprint.tags, warningCount > 0 ? "has-warnings" : ""]
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag, index, all) => tag.length > 0 && all.indexOf(tag) === index);

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
      sourceKind: "imported",
      sourceFormat: "kicad_mod",
      fileName: parsed.raw.footprintFileByName[selectedFootprint.name],
      importedAt: now,
      sourceHash: selectedFootprint.sourceHash,
    },
    parser: {
      warnings: rawFootprint.warnings,
    },
    normalized: selectedFootprint,
    raw: rawFootprint,
  });

  const db = getDb(ctx);
  db.transaction((tx) => {
    const transactionalDb = tx as typeof db;
    transactionalDb
      .insert(symbols)
      .values({
        id: symbolId,
        name: selectedSymbol.name,
        dataJson: symbolDataJson,
        createdAt: now,
      })
      .run();

    transactionalDb
      .insert(footprints)
      .values({
        id: footprintId,
        name: selectedFootprint.name,
        dataJson: footprintDataJson,
        createdAt: now,
      })
      .run();

    transactionalDb
      .insert(components)
      .values({
        id: componentId,
        name: componentName,
        description:
          componentDescription.length > 0
            ? componentDescription
            : (selectedSymbol.description ?? selectedFootprint.description),
        symbolId,
        footprintId,
        tagsJson: JSON.stringify(tags),
        createdAt: now,
      })
      .run();
  });

  return {
    componentId,
    componentName,
  };
}
