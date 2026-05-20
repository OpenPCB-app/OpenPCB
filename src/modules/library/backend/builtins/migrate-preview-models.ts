import { eq, sql } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { buildSymbolRenderModel } from "../../../../shared/rendering/symbol-preview-builder";
import type {
  PreviewGraphic,
  PreviewLabel,
  SymbolRenderModel,
  SymbolRenderModelPin,
  SymbolRenderSource,
  SymbolRenderSourceGraphic,
  SymbolRenderSourcePin,
} from "../../../../shared/rendering/types";
import { getDb } from "../queries";
import { symbols } from "../schema";

const TRACKING_TABLE = "openpcb_migrations";
const MODULE_ID = "library";
const MIGRATION_NAME = "2026_05_07_text_rev2";
const STALE_FONT_THRESHOLD_MM = 1.0;
const REBUILT_HASH_SUFFIX = ":text-rev2";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isStalePreview(preview: unknown): boolean {
  const record = asRecord(preview);
  if (!record) return false;
  const labels = record.labels;
  if (!Array.isArray(labels)) return false;
  return labels.some((label) => {
    const labelRecord = asRecord(label);
    const fontSize = asNumber(labelRecord?.fontSizeMm);
    return fontSize !== null && fontSize < STALE_FONT_THRESHOLD_MM;
  });
}

type LibraryDb = ReturnType<typeof getDb>;

function ensureTrackingTable(db: LibraryDb): void {
  db.run(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
         module_id TEXT NOT NULL,
         migration_name TEXT NOT NULL,
         applied_at TEXT NOT NULL,
         PRIMARY KEY (module_id, migration_name)
       )`,
    ),
  );
}

function readSentinel(db: LibraryDb): boolean {
  ensureTrackingTable(db);
  const tableId = sql.identifier(TRACKING_TABLE);
  const row = db.get<{ migration_name: string } | undefined>(
    sql`SELECT migration_name FROM ${tableId} WHERE module_id = ${MODULE_ID} AND migration_name = ${MIGRATION_NAME}`,
  );
  return Boolean(row);
}

function writeSentinel(db: LibraryDb): void {
  const tableId = sql.identifier(TRACKING_TABLE);
  db.run(
    sql`INSERT OR IGNORE INTO ${tableId} (module_id, migration_name, applied_at) VALUES (${MODULE_ID}, ${MIGRATION_NAME}, ${new Date().toISOString()})`,
  );
}

/** Round to nearest of 0/90/180/270, with a ±1° tolerance for float drift. */
function snapRotation(deg: number): 0 | 90 | 180 | 270 {
  const normalized = ((deg % 360) + 360) % 360;
  const candidates: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  let best: 0 | 90 | 180 | 270 = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const delta = Math.min(
      Math.abs(normalized - candidate),
      360 - Math.abs(normalized - candidate),
    );
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return best;
}

function pinFromPreviewPin(
  pin: SymbolRenderModelPin,
): SymbolRenderSourcePin | null {
  const dx = pin.bodyEnd.x - pin.anchor.x;
  const dy = pin.bodyEnd.y - pin.anchor.y;
  let lengthMm = Math.hypot(dx, dy);
  let rotationDeg: 0 | 90 | 180 | 270;
  if (lengthMm < 1e-6) {
    // Zero-length pin (rare/corrupt) — fall back to KiCad default 2.54 mm.
    lengthMm = 2.54;
    rotationDeg = 0;
  } else {
    rotationDeg = snapRotation((Math.atan2(dy, dx) * 180) / Math.PI);
  }

  return {
    id: pin.id,
    name: pin.name,
    number: pin.number,
    electricalType: pin.electricalType,
    positionMm: { x: pin.anchor.x, y: pin.anchor.y },
    lengthMm,
    rotationDeg,
    unit: pin.unit ?? 1,
    hidden: false,
  };
}

function rebuildSourceFromPreview(
  preview: SymbolRenderModel,
  fallbackName: string,
): SymbolRenderSource | null {
  const pins = preview.pins
    .map(pinFromPreviewPin)
    .filter((p): p is SymbolRenderSourcePin => p !== null);
  if (pins.length === 0) return null;

  const graphics: SymbolRenderSourceGraphic[] = preview.graphics.map(
    (graphic) => ({
      unit: 1,
      graphic: graphic as PreviewGraphic,
    }),
  );

  const referenceLabel = preview.labels.find((l) => l.role === "reference");
  const valueLabel = preview.labels.find((l) => l.role === "value");

  return {
    name: preview.name || fallbackName,
    unitCount: 1,
    referenceText: referenceLabel?.text ?? fallbackName,
    valueText: valueLabel?.text ?? fallbackName,
    pins,
    graphics,
    warnings: [],
  };
}

interface RebuildResult {
  rebuiltSymbols: number;
  skippedFresh: number;
  skippedMalformed: number;
  ms: number;
}

/**
 * One-shot rebuild for symbols whose stored preview labels still use the
 * pre-KLC font sizes (< 1 mm). Detects stale rows, reconstructs a
 * `SymbolRenderSource` from the stored preview pins/graphics, runs it through
 * `buildSymbolRenderModel` (which now applies KLC text), and writes back the
 * refreshed preview. Sentinel in `openpcb_migrations` prevents repeat runs.
 */
export function rebuildPreviewModelsIfStale(
  ctx: CoreBackendModuleContext,
): RebuildResult {
  const start = performance.now();
  const result: RebuildResult = {
    rebuiltSymbols: 0,
    skippedFresh: 0,
    skippedMalformed: 0,
    ms: 0,
  };

  const db = getDb(ctx);

  // Wrap the entire rebuild + sentinel write in one transaction. Two
  // concurrent boots cannot both run the loop: BEGIN IMMEDIATE serializes
  // them, the second sees the sentinel set by the first and exits early.
  // A crash mid-loop rolls back partial UPDATEs along with the sentinel,
  // so the next boot retries from a consistent baseline rather than leaving
  // a mix of rebuilt and stale rows.
  db.transaction((tx) => {
    const transactionalDb = tx as typeof db;
    if (readSentinel(transactionalDb)) {
      return;
    }

    const rows = transactionalDb
      .select({
        id: symbols.id,
        name: symbols.name,
        dataJson: symbols.dataJson,
      })
      .from(symbols)
      .all();

    const now = new Date().toISOString();

    for (const row of rows) {
      let parsed: Record<string, unknown>;
      try {
        const candidate = JSON.parse(row.dataJson) as unknown;
        const record = asRecord(candidate);
        if (!record) {
          result.skippedMalformed += 1;
          continue;
        }
        parsed = record;
      } catch {
        result.skippedMalformed += 1;
        continue;
      }

    const provenance = asRecord(parsed.provenance);

      const normalized = asRecord(parsed.normalized);
      const previewRaw = normalized?.preview;
      if (!isStalePreview(previewRaw)) {
        result.skippedFresh += 1;
        continue;
      }

      const preview = previewRaw as SymbolRenderModel;
      const source = rebuildSourceFromPreview(preview, row.name);
      if (!source) {
        result.skippedMalformed += 1;
        continue;
      }

      let rebuilt: SymbolRenderModel;
      try {
        rebuilt = buildSymbolRenderModel(source, { preserveOrigin: true });
      } catch (error) {
        ctx.logger.warn("preview rebuild failed", {
          symbolId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
        result.skippedMalformed += 1;
        continue;
      }

      if (normalized) {
        (normalized as { preview: PreviewLabel | SymbolRenderModel }).preview =
          rebuilt;
      }
      if (provenance) {
        const existingHash = asString(provenance.sourceHash) ?? "";
        if (!existingHash.endsWith(REBUILT_HASH_SUFFIX)) {
          (provenance as { sourceHash: string }).sourceHash =
            existingHash + REBUILT_HASH_SUFFIX;
        }
        (provenance as { rebuiltAt?: string }).rebuiltAt = now;
      }

      transactionalDb
        .update(symbols)
        .set({ dataJson: JSON.stringify(parsed) })
        .where(eq(symbols.id, row.id))
        .run();
      result.rebuiltSymbols += 1;
    }

    writeSentinel(transactionalDb);
  });

  result.ms = Math.round(performance.now() - start);
  return result;
}
