import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { getDb } from "../queries";
import { footprints } from "../schema";

type LibraryDb = BunSQLiteDatabase<Record<string, unknown>>;

export const PLACEHOLDER_FOOTPRINT_ID = "fp-no-footprint-yet";
export const PLACEHOLDER_FOOTPRINT_NAME = "No footprint yet";
export const PLACEHOLDER_SOURCE_HASH = "placeholder:no-footprint-yet";
export const PLACEHOLDER_TAGS = [
  "placeholder-footprint",
  "virtual",
  "no-footprint-yet",
] as const;

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

export function findPlaceholderFootprintId(
  ctx: CoreBackendModuleContext,
  txDb?: LibraryDb,
): string | null {
  const db = txDb ?? getDb(ctx);
  const byId = db
    .select({ id: footprints.id })
    .from(footprints)
    .where(eq(footprints.id, PLACEHOLDER_FOOTPRINT_ID))
    .get();
  if (byId) {
    return byId.id;
  }

  const rows = db
    .select({ id: footprints.id, dataJson: footprints.dataJson })
    .from(footprints)
    .where(eq(footprints.name, PLACEHOLDER_FOOTPRINT_NAME))
    .all();

  for (const row of rows) {
    const data = parseJsonObject(row.dataJson);
    const normalized = asRecord(data.normalized);
    if (asString(normalized?.id) === PLACEHOLDER_FOOTPRINT_ID) {
      return row.id;
    }
  }
  return null;
}

export function buildPlaceholderFootprintDataJson(now: string): string {
  return JSON.stringify({
    provenance: {
      sourceKind: "system",
      sourceFormat: "placeholder",
      fileName: null,
      importedAt: now,
      sourceHash: PLACEHOLDER_SOURCE_HASH,
    },
    parser: {
      warnings: [],
    },
    normalized: {
      id: PLACEHOLDER_FOOTPRINT_ID,
      fileName: "",
      name: PLACEHOLDER_FOOTPRINT_NAME,
      description: "Component was imported without a real PCB footprint.",
      mountType: "virtual",
      padCount: 0,
      packageCode: {
        imperial: null,
        metric: null,
      },
      tags: [...PLACEHOLDER_TAGS],
      sourceHash: PLACEHOLDER_SOURCE_HASH,
      warnings: [],
      preview: null,
    },
    raw: {
      kind: "placeholder-footprint",
      name: PLACEHOLDER_FOOTPRINT_NAME,
    },
  });
}

/**
 * Idempotent: inserts the placeholder footprint row if missing. Used by both
 * the builtin seeder (so symbol-only builtins have a stable footprint to
 * reference at boot) and the KiCad importer (preserves prior behavior).
 */
export function ensurePlaceholderFootprint(
  ctx: CoreBackendModuleContext,
  now: string,
  txDb?: LibraryDb,
): string {
  const existing = findPlaceholderFootprintId(ctx, txDb);
  if (existing) {
    return existing;
  }
  const db = txDb ?? getDb(ctx);
  db.insert(footprints)
    .values({
      id: PLACEHOLDER_FOOTPRINT_ID,
      name: PLACEHOLDER_FOOTPRINT_NAME,
      dataJson: buildPlaceholderFootprintDataJson(now),
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();
  return PLACEHOLDER_FOOTPRINT_ID;
}
