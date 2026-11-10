import { rejectKicadFootprints } from "./unqualified-import";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { and, eq } from "drizzle-orm";
import {
  componentFootprints,
  components,
  footprints,
  symbols,
} from "../schema";
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
  type FootprintWithPads,
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

/** Drill fields the installed `@openpcb/kicad-import` preview represents. */
export interface KicadDrillCapability {
  plating: boolean;
  slots: boolean;
}

// One NPTH pad with an oval (slotted) drill: the preview keeps `plated` /
// `drillSlotMm` only once the package can represent them.
const DRILL_PROBE_FOOTPRINT = `(footprint "openpcb_drill_capability_probe" (layer "F.Cu")
  (pad "" np_thru_hole oval (at 0 0) (size 0.6 1.7) (drill oval 0.6 1.7) (layers "*.Cu" "*.Mask")))`;

let probedDrillCapability: KicadDrillCapability | null = null;
let drillCapabilityOverride: KicadDrillCapability | null = null;

function probeDrillCapability(): KicadDrillCapability {
  try {
    const bundle = parseImportBundle({
      symbolLibrary: null,
      footprints: [
        { fileName: "drill-probe.kicad_mod", content: DRILL_PROBE_FOOTPRINT },
      ],
    });
    const pad = bundle.normalizedFootprints[0]?.preview.pads[0];
    if (!pad) return { plating: false, slots: false };
    return { plating: "plated" in pad, slots: "drillSlotMm" in pad };
  } catch {
    return { plating: false, slots: false };
  }
}

/** Feature-detected once per process (H14 §3.7); fail closed on probe error. */
export function kicadDrillCapability(): KicadDrillCapability {
  if (drillCapabilityOverride) return drillCapabilityOverride;
  probedDrillCapability ??= probeDrillCapability();
  return probedDrillCapability;
}

export function setKicadDrillCapabilityForTesting(
  capability: KicadDrillCapability | null,
): void {
  drillCapabilityOverride = capability;
}

/**
 * Unnumbered pads are mechanical (NPTH pegs, mounting holes) and are only
 * accepted once plating and slots survive into the preview; until then a
 * drilled unnumbered pad would import as a plated round hole, so it is
 * rejected with a reason the import wizard can show as is.
 */
function validateImportedFootprintPads(footprint: FootprintWithPads): void {
  const capability = kicadDrillCapability();
  if (capability.plating && capability.slots) {
    validateFootprintPads(footprint, { allowUnnumberedPads: true });
    return;
  }
  // The pinned parser drops `(drill oval …)` diameters, so a through-hole
  // layer counts as a hole too.
  const drilledUnnumbered = footprint.pads.some(
    (pad) =>
      (pad.number ?? "").trim().length === 0 &&
      ((typeof pad.drillDiameterMm === "number" && pad.drillDiameterMm > 0) ||
        pad.layer === "*.Cu"),
  );
  if (drilledUnnumbered) {
    throw new ImportValidationError(
      `Footprint "${footprint.name}" has non-plated or slotted holes this version can't represent yet.`,
    );
  }
  validateFootprintPads(footprint);
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
  const userTags = dedupeTags(input.component.tags ?? []);

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

  if (selectedFootprint)
    rejectKicadFootprints("kicad_mod", [selectedFootprint.id]);

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
    validateImportedFootprintPads(selectedFootprint.preview);
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
    ...userTags,
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
          sourceId: "user.local",
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
          sourceId: "user.local",
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
        sourceId: "user.local",
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
