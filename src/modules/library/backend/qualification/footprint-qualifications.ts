/**
 * Library-row and placed-snapshot classification (H15 §3.4) over the shared
 * SQLite database. Rows are read through `json_extract` (provenance + preview
 * pads only), never a full `data_json` parse; malformed JSON reads as
 * not-generated.
 */
import { and, inArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  FootprintGenerationStamp,
  LibraryFootprintPlacementSnapshot,
  LibraryFootprintQualification,
} from "../../../../sdks/library";
import { footprints } from "../schema";
import {
  classifyFootprintGeometry,
  fingerprintPads,
  generationFromProvenance,
  geometricQualification,
  NO_LONGER_MATCHES_REASON,
  NOT_GENERATED,
  type QualificationInputs,
} from "./classify";

type Db = BetterSQLite3Database<Record<string, unknown>>;

const CHUNK = 500;

function parseJson(text: unknown): unknown {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function padArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One stored row: its provenance claim + its stored preview pads. */
export function classifyStoredFootprint(
  provenance: unknown,
  pads: unknown,
  inputs: QualificationInputs = {},
): LibraryFootprintQualification {
  return classifyFootprintGeometry(
    { pads: padArray(pads), generation: generationFromProvenance(provenance) },
    inputs,
  );
}

/** A full `data_json` already in hand (variant lists, the default-footprint guard). */
export function classifyFootprintDataJson(
  dataJson: string,
  inputs: QualificationInputs = {},
): LibraryFootprintQualification {
  const data = record(parseJson(dataJson));
  if (!data) return NOT_GENERATED;
  const preview = record(record(data.normalized)?.preview);
  return classifyStoredFootprint(data.provenance, preview?.pads, inputs);
}

const PROVENANCE = sql<
  string | null
>`CASE WHEN json_valid(${footprints.dataJson}) THEN json_extract(${footprints.dataJson}, '$.provenance') END`;
const PADS = sql<
  string | null
>`CASE WHEN json_valid(${footprints.dataJson}) THEN json_extract(${footprints.dataJson}, '$.normalized.preview.pads') END`;

interface StoredRow {
  id: string;
  prov: string | null;
  pads: string | null;
}

function loadRows(
  db: Db,
  ids: readonly string[],
  generatedOnly: boolean,
): StoredRow[] {
  const rows: StoredRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const where = generatedOnly
      ? and(
          inArray(footprints.id, chunk),
          sql`json_valid(${footprints.dataJson}) AND json_extract(${footprints.dataJson}, '$.provenance.sourceKind') = 'generated'`,
        )
      : inArray(footprints.id, chunk);
    rows.push(
      ...db
        .select({ id: footprints.id, prov: PROVENANCE, pads: PADS })
        .from(footprints)
        .where(where)
        .all(),
    );
  }
  return rows;
}

/** Stored rows by id; unknown ids are absent. */
export function getFootprintQualifications(
  db: Db,
  footprintIds: readonly string[],
  inputs: QualificationInputs = {},
): Record<string, LibraryFootprintQualification> {
  const ids = [...new Set(footprintIds)];
  const out: Record<string, LibraryFootprintQualification> = {};
  for (const row of loadRows(db, ids, false)) {
    out[row.id] = classifyStoredFootprint(
      parseJson(row.prov),
      parseJson(row.pads),
      inputs,
    );
  }
  return out;
}

interface PendingSnapshot {
  readonly key: string;
  readonly footprintId: string;
  readonly pads: readonly unknown[] | null;
  readonly fingerprint: string | null;
}

/**
 * Placed footprints, from each snapshot's own pads. A stamped snapshot is
 * classified on its own geometry + stamp. A stampless one (not generated, or
 * built before the stamp) is decided by rules 1–2 when geometry alone can; otherwise one
 * batched lookup of its GENERATED library rows decides: same pads ⇒ that
 * row's claim applies, different pads ⇒ "no longer matches", no generated row
 * ⇒ not-generated (the documented residual, §3.4).
 */
export function classifyPlacedFootprints(
  db: Db,
  items: readonly {
    key: string;
    snapshot: LibraryFootprintPlacementSnapshot;
  }[],
  inputs: QualificationInputs = {},
): Record<string, LibraryFootprintQualification> {
  const out: Record<string, LibraryFootprintQualification> = {};
  const pending: PendingSnapshot[] = [];
  for (const { key, snapshot } of items) {
    const snap = record(snapshot);
    if (!snap) {
      out[key] = NOT_GENERATED;
      continue;
    }
    const pads = padArray(record(snap.preview)?.pads);
    const fingerprint = fingerprintPads(pads);
    // A stamp can only add checks: a malformed one counts as absent.
    const stamp = stampOf(snap.generation);
    if (stamp) {
      out[key] = classifyFootprintGeometry(
        { pads, generation: stamp },
        inputs,
        fingerprint,
      );
      continue;
    }
    const geometric = geometricQualification(fingerprint, inputs);
    if (geometric) {
      out[key] = geometric;
    } else if (typeof snap.footprintId === "string") {
      pending.push({ key, footprintId: snap.footprintId, pads, fingerprint });
    } else {
      out[key] = NOT_GENERATED;
    }
  }
  if (pending.length === 0) return out;

  const rows = new Map(
    loadRows(db, [...new Set(pending.map((p) => p.footprintId))], true).map(
      (row) => [row.id, row],
    ),
  );
  const rowFingerprints = new Map<string, string | null>();
  for (const item of pending) {
    const row = rows.get(item.footprintId);
    if (!row) {
      out[item.key] = NOT_GENERATED;
      continue;
    }
    let rowFingerprint = rowFingerprints.get(row.id);
    if (rowFingerprint === undefined) {
      rowFingerprint = fingerprintPads(padArray(parseJson(row.pads)));
      rowFingerprints.set(row.id, rowFingerprint);
    }
    const generation = generationFromProvenance(parseJson(row.prov));
    if (rowFingerprint === null || rowFingerprint !== item.fingerprint) {
      out[item.key] = {
        status: "unqualified-generator",
        reason: NO_LONGER_MATCHES_REASON,
        generatorKind: generation?.kind ?? "legacy-generated",
        generatorLabel: generation?.label ?? null,
      };
      continue;
    }
    out[item.key] = classifyFootprintGeometry(
      { pads: item.pads, generation },
      inputs,
      item.fingerprint,
    );
  }
  return out;
}

/** A stamp read from persisted JSON; null when absent or malformed. */
function stampOf(value: unknown): FootprintGenerationStamp | null {
  const stamp = record(value);
  if (
    stamp &&
    (stamp.kind === "ipc7351b" ||
      stamp.kind === "template" ||
      stamp.kind === "legacy-generated") &&
    (stamp.label === null || typeof stamp.label === "string")
  ) {
    return { kind: stamp.kind, label: stamp.label };
  }
  return null;
}
