import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DrcReport,
  DrcRunEvidence,
  DrcRuleClass,
  DrcViolation,
} from "../../../sdks/designer";
import { drcResults } from "./schema";
import {
  parseDrcAnchor,
  parseDrcRunEvidence,
} from "../../../shared/drc/run-evidence";
import { NON_OVERRIDABLE } from "../../../shared/drc/severity";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;
type DrcResultRow = typeof drcResults.$inferSelect;

export interface SaveDrcOptions {
  ignoredRuleClasses: DrcRuleClass[];
  waivedIds: string[];
  severityOverrides?: DrcRunEvidence["severityOverrides"];
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
    optionsJson: JSON.stringify({
      ...options,
      ...(report.evidence ? { evidence: report.evidence } : {}),
    }),
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStoredAnchor(value: unknown): boolean {
  const anchor = parseDrcAnchor(value);
  return anchor !== null && Object.values(anchor).every(
    (entry: unknown) => typeof entry !== "string" || isNonEmptyString(entry),
  );
}

function hasSafeOptionalFields(row: Record<string, unknown>): boolean {
  if (row.measuredMm !== undefined && !isFiniteNumber(row.measuredMm)) return false;
  if (row.requiredMm !== undefined && !isFiniteNumber(row.requiredMm)) return false;
  if (row.waived !== undefined && typeof row.waived !== "boolean") return false;
  if (row.layer !== undefined && typeof row.layer !== "string") return false;
  if (row.locationMm === undefined) return true;
  if (typeof row.locationMm !== "object" || row.locationMm === null || Array.isArray(row.locationMm)) return false;
  const location = row.locationMm as Record<string, unknown>;
  return isFiniteNumber(location.x) && isFiniteNumber(location.y);
}

function isStoredViolation(value: unknown): value is DrcViolation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    isNonEmptyString(row.id) &&
    isNonEmptyString(row.code) &&
    isNonEmptyString(row.ruleClass) &&
    typeof row.message === "string" &&
    (row.severity === "error" || row.severity === "warning" || row.severity === "info") &&
    Array.isArray(row.anchors) &&
    row.anchors.every(isStoredAnchor) &&
    hasSafeOptionalFields(row)
  );
}

function storedEvidence(optionsJson: string): DrcRunEvidence | undefined {
  try {
    const options: unknown = JSON.parse(optionsJson);
    if (typeof options !== "object" || options === null || Array.isArray(options)) return undefined;
    return parseDrcRunEvidence((options as Record<string, unknown>).evidence);
  } catch {
    return undefined;
  }
}

function storedViolations(json: string): DrcViolation[] | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || !parsed.every(isStoredViolation)) return null;
    return parsed.map((violation) => {
      if (!NON_OVERRIDABLE.has(violation.code) || violation.waived === undefined) return violation;
      const { waived: _waived, ...active } = violation;
      return active;
    });
  } catch {
    // Opening a design must not crash on a corrupt persisted report.
    return null;
  }
}

function reportCounts(violations: readonly DrcViolation[]): {
  summary: DrcReport["summary"];
  countsByCode: DrcReport["countsByCode"];
} {
  const summary = { errors: 0, warnings: 0, infos: 0 };
  const countsByCode: DrcReport["countsByCode"] = {};
  for (const violation of violations) {
    const count = Object.hasOwn(countsByCode, violation.code)
      ? countsByCode[violation.code] ?? 0 : 0;
    Object.defineProperty(countsByCode, violation.code, {
      value: count + 1, enumerable: true, configurable: true, writable: true,
    });
    if (violation.waived) continue;
    if (violation.severity === "error") summary.errors += 1;
    else if (violation.severity === "warning") summary.warnings += 1;
    else summary.infos += 1;
  }
  return { summary, countsByCode };
}

/** Reconstruct counts from validated findings; stored counters are not authority. */
export function getDrcResult(
  db: DbClient,
  designId: string,
): StoredDrcResult | null {
  const row = getDrcResultRow(db, designId);
  if (!row) return null;
  const violations = storedViolations(row.violationsJson);
  if (!violations) return null;
  const { summary, countsByCode } = reportCounts(violations);
  const evidence = storedEvidence(row.optionsJson);
  return {
    report: {
      designId,
      revision: row.ranAtRevision,
      violations,
      summary,
      countsByCode,
      ...(evidence ? { evidence } : {}),
    },
    ranAtRevision: row.ranAtRevision,
    ranAt: row.ranAt,
  };
}
