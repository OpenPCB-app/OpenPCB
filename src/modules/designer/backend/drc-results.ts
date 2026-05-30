import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DrcReport,
  DrcRuleClass,
  DrcRuleCode,
  DrcViolation,
} from "../../../sdks/designer";
import { drcResults } from "./schema";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;
type DrcResultRow = typeof drcResults.$inferSelect;

export interface SaveDrcOptions {
  ignoredRuleClasses: DrcRuleClass[];
  waivedIds: string[];
}

export interface StoredDrcResult {
  report: DrcReport;
  ranAtRevision: number;
  ranAt: string;
}

/** Upsert the latest DRC result for a design (one row per design). */
export function saveDrcResult(
  db: DbClient,
  designId: string,
  report: DrcReport,
  options: SaveDrcOptions,
  timestamp: string,
): void {
  const existing = db
    .select()
    .from(drcResults)
    .where(eq(drcResults.designId, designId))
    .get();
  const next = {
    designId,
    ranAtRevision: report.revision,
    ranAt: timestamp,
    errorCount: report.summary.errors,
    warningCount: report.summary.warnings,
    infoCount: report.summary.infos,
    violationsJson: JSON.stringify(report.violations),
    optionsJson: JSON.stringify(options),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  if (existing) {
    db.update(drcResults)
      .set(next)
      .where(eq(drcResults.designId, designId))
      .run();
  } else {
    db.insert(drcResults).values(next).run();
  }
}

export function getDrcResultRow(
  db: DbClient,
  designId: string,
): DrcResultRow | null {
  return (
    db
      .select()
      .from(drcResults)
      .where(eq(drcResults.designId, designId))
      .get() ?? null
  );
}

/** Reconstruct the stored DrcReport (recomputes countsByCode from violations). */
export function getDrcResult(
  db: DbClient,
  designId: string,
): StoredDrcResult | null {
  const row = getDrcResultRow(db, designId);
  if (!row) return null;
  let violations: DrcViolation[];
  try {
    violations = JSON.parse(row.violationsJson) as DrcViolation[];
  } catch {
    // Corrupt persisted blob — treat as "no result" rather than throwing, so
    // opening a design never crashes on a malformed DRC row.
    return null;
  }
  const countsByCode: Partial<Record<DrcRuleCode, number>> = {};
  for (const v of violations) {
    countsByCode[v.code] = (countsByCode[v.code] ?? 0) + 1;
  }
  return {
    report: {
      designId,
      revision: row.ranAtRevision,
      violations,
      summary: {
        errors: row.errorCount,
        warnings: row.warningCount,
        infos: row.infoCount,
      },
      countsByCode,
    },
    ranAtRevision: row.ranAtRevision,
    ranAt: row.ranAt,
  };
}
