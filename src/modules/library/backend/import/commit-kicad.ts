import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { and, eq } from "drizzle-orm";
import { componentFootprints, components, footprints, symbols } from "../schema";
import { getDb } from "../queries";
import {
  PLACEHOLDER_FOOTPRINT_ID,
  PLACEHOLDER_FOOTPRINT_NAME,
  PLACEHOLDER_TAGS,
  buildPlaceholderFootprintDataJson,
  findPlaceholderFootprintId,
} from "../builtins/placeholder-footprint";
import { ImportValidationError, parseImportBundle } from "./inspect-kicad";
import type { CommitKicadRequest, CommitKicadResponse } from "./types";
import {
  validateFootprintPads,
  validateSymbolPinsCoverFootprintPads,
} from "./validate-pads";
import { buildIdentityPinMapJson } from "./pinmap";

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

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function findExistingSymbolId(
  ctx: CoreBackendModuleContext,
  sourceHash: string,
  normalizedSymbolId: string,
  symbolName: string,
): string | null {
  const db = getDb(ctx);
  const rows = db
    .select({ id: symbols.id, dataJson: symbols.dataJson })
    .from(symbols)
    .where(eq(symbols.name, symbolName))
    .all();

  for (const row of rows) {
    const data = parseJsonObject(row.dataJson);
    const provenance = asRecord(data.provenance);
    const normalized = asRecord(data.normalized);
    const rowSourceHash = asString(provenance?.sourceHash);
    const rowNormalizedId = asString(normalized?.id);

    if (
      rowSourceHash === sourceHash &&
      rowNormalizedId === normalizedSymbolId
    ) {
      return row.id;
    }
  }
  return null;
}

function findExistingFootprintId(
  ctx: CoreBackendModuleContext,
  sourceHash: string,
  normalizedFootprintId: string,
  footprintName: string,
): string | null {
  const db = getDb(ctx);
  const rows = db
    .select({ id: footprints.id, dataJson: footprints.dataJson })
    .from(footprints)
    .where(eq(footprints.name, footprintName))
    .all();

  for (const row of rows) {
    const data = parseJsonObject(row.dataJson);
    const provenance = asRecord(data.provenance);
    const normalized = asRecord(data.normalized);
    const rowSourceHash = asString(provenance?.sourceHash);
    const rowNormalizedId = asString(normalized?.id);

    if (
      rowSourceHash === sourceHash &&
      rowNormalizedId === normalizedFootprintId
    ) {
      return row.id;
    }
  }
  return null;
}

function dedupeTags(values: readonly string[]): string[] {
  return values
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag, index, all) => tag.length > 0 && all.indexOf(tag) === index);
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
  const selectedFootprintId = trimOrEmpty(input.selection.footprintId ?? "");
  const symbolOnlyImport = selectedFootprintId.length === 0;
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

  const selectedFootprint = symbolOnlyImport
    ? null
    : (parsed.normalizedFootprints.find(
        (footprint) => footprint.id === selectedFootprintId,
      ) ?? null);
  if (!symbolOnlyImport && !selectedFootprint) {
    throw new ImportValidationError(
      "Selected footprint is not present in import payload",
    );
  }

  const rawSymbol = parsed.raw.symbolById[selectedSymbolId];
  if (!rawSymbol) {
    throw new ImportValidationError(
      "Failed to map selected symbol raw payload",
    );
  }

  const rawFootprint = selectedFootprint
    ? parsed.raw.footprintById[selectedFootprint.id]
    : null;
  if (selectedFootprint && !rawFootprint) {
    throw new ImportValidationError(
      "Failed to map selected footprint raw payload",
    );
  }

  // Strict pad validation — empty pad numbers or zero-pad footprints fail at
  // import time, not later on the PCB tab. Pin↔pad subset enforced when both
  // a symbol and footprint are selected (skipped for symbol-only import).
  if (selectedFootprint) {
    validateFootprintPads(selectedFootprint.preview);
    validateSymbolPinsCoverFootprintPads(
      selectedSymbol,
      selectedFootprint.preview,
    );
  }

  const now = new Date().toISOString();
  const existingSymbolId = findExistingSymbolId(
    ctx,
    selectedSymbol.sourceHash,
    selectedSymbol.id,
    selectedSymbol.name,
  );
  const existingFootprintId = selectedFootprint
    ? findExistingFootprintId(
        ctx,
        selectedFootprint.sourceHash,
        selectedFootprint.id,
        selectedFootprint.name,
      )
    : findPlaceholderFootprintId(ctx);

  const symbolId = existingSymbolId ?? crypto.randomUUID();
  const footprintId = selectedFootprint
    ? (existingFootprintId ?? crypto.randomUUID())
    : (existingFootprintId ?? PLACEHOLDER_FOOTPRINT_ID);
  const componentId = crypto.randomUUID();
  const warningCount =
    selectedSymbol.warnings.length + (selectedFootprint?.warnings.length ?? 0);

  const footprintTags = selectedFootprint
    ? selectedFootprint.tags
    : ([...PLACEHOLDER_TAGS] as string[]);
  const pinMapJson = selectedFootprint
    ? buildIdentityPinMapJson(selectedSymbol, selectedFootprint.preview)
    : null;

  const tags = dedupeTags([
    ...footprintTags,
    warningCount > 0 ? "has-warnings" : "",
  ]);

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

  const footprintDataJson = selectedFootprint
    ? JSON.stringify({
        provenance: {
          sourceKind: "imported",
          sourceFormat: "kicad_mod",
          fileName: parsed.raw.footprintFileByName[selectedFootprint.name],
          importedAt: now,
          sourceHash: selectedFootprint.sourceHash,
        },
        parser: {
          warnings: rawFootprint?.warnings ?? [],
        },
        normalized: selectedFootprint,
        raw: rawFootprint,
      })
    : buildPlaceholderFootprintDataJson(now);

  const db = getDb(ctx);

  if (existingSymbolId && existingFootprintId) {
    const existingComponent = db
      .select({ id: components.id, name: components.name })
      .from(components)
      .where(
        and(
          eq(components.symbolId, existingSymbolId),
          eq(components.footprintId, existingFootprintId),
        ),
      )
      .get();
    if (existingComponent) {
      return {
        componentId: existingComponent.id,
        componentName: existingComponent.name,
        reused: true,
      };
    }
  }

  db.transaction((tx) => {
    const transactionalDb = tx as typeof db;
    if (!existingSymbolId) {
      transactionalDb
        .insert(symbols)
        .values({
          id: symbolId,
          name: selectedSymbol.name,
          dataJson: symbolDataJson,
          createdAt: now,
        })
        .run();
    }

    if (!existingFootprintId) {
      transactionalDb
        .insert(footprints)
        .values({
          id: footprintId,
          name: selectedFootprint?.name ?? PLACEHOLDER_FOOTPRINT_NAME,
          dataJson: footprintDataJson,
          createdAt: now,
        })
        .run();
    }

    transactionalDb
      .insert(components)
      .values({
        id: componentId,
        name: componentName,
        description:
          componentDescription.length > 0
            ? componentDescription
            : (selectedSymbol.description ??
              selectedFootprint?.description ??
              "No footprint yet"),
        symbolId,
        footprintId,
        tagsJson: JSON.stringify(tags),
        createdAt: now,
      })
      .run();

    transactionalDb
      .insert(componentFootprints)
      .values({
        componentId,
        footprintId,
        isDefault: 1,
        variantLabel: selectedFootprint?.name ?? PLACEHOLDER_FOOTPRINT_NAME,
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
