import { and, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  BomOverride,
  BomOverridePatch,
} from "../../../sdks/designer/types";
import { bomOverrides, schematicParts } from "./schema";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

type BomOverrideRow = typeof bomOverrides.$inferSelect;

/**
 * Overrides are bound to the schematic part that carried the reference when
 * they were written, so a rename (or its undo/redo, which bypasses command
 * handlers) never strands them. A bound row reports its part's CURRENT
 * reference; the BOM/PnP writers match it by `partId` only.
 */
export function listBomOverrides(
  db: DbClient,
  designId: string,
): BomOverride[] {
  const referenceByPartId = new Map(
    partReferences(db, designId).map((part) => [part.id, part.reference]),
  );
  return db
    .select()
    .from(bomOverrides)
    .where(eq(bomOverrides.designId, designId))
    .all()
    .map((row) =>
      toDto(row, row.partId ? referenceByPartId.get(row.partId) : undefined),
    );
}

/**
 * `refdes` is the reference the user sees now. It resolves to the part that
 * carries it; that part's bound row is updated, else an unbound row under the
 * same reference is adopted (bound), else a new row is written. A reference no
 * schematic part carries (e.g. a PCB-only placement) keeps an unbound row.
 */
export function upsertBomOverride(
  db: DbClient,
  designId: string,
  refdes: string,
  patch: BomOverridePatch,
  timestamp: string,
): BomOverride {
  const partId =
    db
      .select({ id: schematicParts.id })
      .from(schematicParts)
      .where(
        and(
          eq(schematicParts.designId, designId),
          eq(schematicParts.reference, refdes),
        ),
      )
      .get()?.id ?? null;
  const existing = findOverrideRow(db, designId, partId, refdes);
  const next = {
    id: existing?.id ?? crypto.randomUUID(),
    designId,
    partId,
    refdes,
    manufacturer:
      patch.manufacturer !== undefined ? normalizeString(patch.manufacturer) : existing?.manufacturer ?? null,
    manufacturerPartNumber:
      patch.manufacturerPartNumber !== undefined
        ? normalizeString(patch.manufacturerPartNumber)
        : existing?.manufacturerPartNumber ?? null,
    lcscPartNumber:
      patch.lcscPartNumber !== undefined
        ? normalizeString(patch.lcscPartNumber)
        : existing?.lcscPartNumber ?? null,
    supplier:
      patch.supplier !== undefined ? normalizeString(patch.supplier) : existing?.supplier ?? null,
    unitPriceMicros:
      patch.unitPrice !== undefined
        ? priceToMicros(patch.unitPrice)
        : existing?.unitPriceMicros ?? null,
    currency:
      patch.currency !== undefined
        ? normalizeString(patch.currency)?.toUpperCase() ?? null
        : existing?.currency ?? null,
    dnp: patch.dnp !== undefined ? (patch.dnp ? 1 : 0) : existing?.dnp ?? 0,
    assemblySide:
      patch.assemblySide !== undefined ? patch.assemblySide : existing?.assemblySide ?? null,
    notes:
      patch.notes !== undefined ? normalizeString(patch.notes) : existing?.notes ?? null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  if (existing) {
    db.update(bomOverrides)
      .set(next)
      .where(eq(bomOverrides.id, existing.id))
      .run();
  } else {
    db.insert(bomOverrides).values(next).run();
  }
  return toDto(next);
}

function partReferences(
  db: DbClient,
  designId: string,
): Array<{ id: string; reference: string }> {
  return db
    .select({ id: schematicParts.id, reference: schematicParts.reference })
    .from(schematicParts)
    .where(eq(schematicParts.designId, designId))
    .all();
}

function findOverrideRow(
  db: DbClient,
  designId: string,
  partId: string | null,
  refdes: string,
): BomOverrideRow | undefined {
  if (partId) {
    const bound = db
      .select()
      .from(bomOverrides)
      .where(
        and(eq(bomOverrides.designId, designId), eq(bomOverrides.partId, partId)),
      )
      .get();
    if (bound) return bound;
  }
  return db
    .select()
    .from(bomOverrides)
    .where(
      and(
        eq(bomOverrides.designId, designId),
        isNull(bomOverrides.partId),
        eq(bomOverrides.refdes, refdes),
      ),
    )
    .get();
}

function toDto(row: BomOverrideRow, currentRefdes?: string): BomOverride {
  return {
    designId: row.designId,
    partId: row.partId,
    refdes: currentRefdes ?? row.refdes,
    manufacturer: row.manufacturer,
    manufacturerPartNumber: row.manufacturerPartNumber,
    lcscPartNumber: row.lcscPartNumber,
    supplier: row.supplier,
    unitPrice:
      row.unitPriceMicros === null ? null : row.unitPriceMicros / 1_000_000,
    currency: row.currency,
    dnp: row.dnp === 1,
    assemblySide: parseAssemblySide(row.assemblySide),
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

function parseAssemblySide(value: string | null): "top" | "bottom" | null {
  return value === "top" || value === "bottom" ? value : null;
}

function normalizeString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function priceToMicros(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 1_000_000);
}
