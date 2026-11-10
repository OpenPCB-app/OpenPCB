import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  DRC_RULE_CLASSES,
  type DrcReport,
  type DrcRuleClass,
  type DrcRuleCode,
  type DrcViolation,
  type ManufacturingDrcEvidence,
} from "../../../sdks/designer";
import { drcResults } from "./schema";
import { asRecord } from "./value-guards";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;
type DrcResultRow = typeof drcResults.$inferSelect;

export interface SaveDrcOptions {
  ignoredRuleClasses: DrcRuleClass[];
  waivedIds: string[];
  /** Recorded for the export evidence (H19 §3.5); absent on older rows. */
  severityOverrides?: ManufacturingDrcEvidence["severityOverrides"];
  ruleSeverities?: ManufacturingDrcEvidence["ruleSeverities"];
}

export interface StoredDrcResult {
  report: DrcReport;
  ranAtRevision: number;
  ranAt: string;
}

/**
 * What a stored result was computed over (H19 / OPENPCB-67 §3.5), persisted as
 * ONE JSON column so it is written atomically with the counts it describes.
 */
export interface DrcResultProvenance {
  v: 1;
  /**
   * Copies of the row's own `ran_at` / `ran_at_revision`. A binary that does
   * not stamp rewrites those columns but not this one, so its row fails the
   * comparison and reads as "no provenance" (downgrade/upgrade safety).
   */
  ranAt: string;
  ranAtRevision: number;
  /** `computeBoardContentDigest` of the run's projection. */
  contentDigest: string;
  /** `computeDrcOptionsDigest` of the run's projection. */
  optionsDigest: string;
  /** `drcEngineVersion(appVersion)`. */
  engineVersion: string;
  /** `digestRawFootprintEntries` of the entries the worker received. */
  rawFootprintDigest: string;
}

/** The part of the stamp the caller supplies; the row supplies the rest. */
export type DrcResultStamp = Omit<
  DrcResultProvenance,
  "v" | "ranAt" | "ranAtRevision"
>;

/**
 * Upsert the latest DRC result for a design (one row per design). Without a
 * stamp the column is written NULL, never left holding an older run's stamp.
 */
export function saveDrcResult(
  db: DbClient,
  designId: string,
  report: DrcReport,
  options: SaveDrcOptions,
  timestamp: string,
  provenance: DrcResultStamp | null = null,
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
    provenanceJson:
      provenance === null
        ? null
        : JSON.stringify(stampFor(provenance, timestamp, report.revision)),
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

/** Explicit fields only: nothing the caller's object carries besides them leaks in. */
function stampFor(
  provenance: DrcResultStamp,
  ranAt: string,
  ranAtRevision: number,
): DrcResultProvenance {
  return {
    v: 1,
    ranAt,
    ranAtRevision,
    contentDigest: provenance.contentDigest,
    optionsDigest: provenance.optionsDigest,
    engineVersion: provenance.engineVersion,
    rawFootprintDigest: provenance.rawFootprintDigest,
  };
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

/**
 * The stored result as manufacturing-export evidence (H19 / OPENPCB-67 §3.5).
 * `provenance` is null for a legacy row, an unparsable stamp, or a stamp that
 * does not describe this row — the export gate treats all three as stale.
 */
export interface StoredDrcGateEvidence extends ManufacturingDrcEvidence {
  provenance: DrcResultProvenance | null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const STAMP_STRING_FIELDS = [
  "ranAt",
  "contentDigest",
  "optionsDigest",
  "engineVersion",
  "rawFootprintDigest",
] as const;

function parseProvenance(row: DrcResultRow): DrcResultProvenance | null {
  if (row.provenanceJson === null) return null;
  const stamp = asRecord(parseJson(row.provenanceJson));
  if (!stamp || stamp.v !== 1) return null;
  if (STAMP_STRING_FIELDS.some((field) => typeof stamp[field] !== "string")) {
    return null;
  }
  if (stamp.ranAt !== row.ranAt || stamp.ranAtRevision !== row.ranAtRevision) {
    return null;
  }
  return stampFor(
    stamp as unknown as DrcResultStamp,
    row.ranAt,
    row.ranAtRevision,
  );
}

const RULE_CLASSES: ReadonlySet<string> = new Set(DRC_RULE_CLASSES);
const SEVERITIES: ReadonlySet<string> = new Set(["error", "warning", "info"]);

function ruleClassesFrom(value: unknown): DrcRuleClass[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is DrcRuleClass =>
      typeof item === "string" && RULE_CLASSES.has(item),
  );
}

function severityOverridesFrom(
  value: unknown,
): ManufacturingDrcEvidence["severityOverrides"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = asRecord(item);
    if (
      !entry ||
      typeof entry.code !== "string" ||
      typeof entry.severity !== "string" ||
      !(SEVERITIES.has(entry.severity) || entry.severity === "ignore") ||
      typeof entry.defaultSeverity !== "string" ||
      !SEVERITIES.has(entry.defaultSeverity)
    ) {
      return [];
    }
    return [
      {
        code: entry.code as DrcRuleCode,
        severity: entry.severity as DrcViolation["severity"] | "ignore",
        defaultSeverity: entry.defaultSeverity as DrcViolation["severity"],
      },
    ];
  });
}

function ruleSeveritiesFrom(
  value: unknown,
): ManufacturingDrcEvidence["ruleSeverities"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = asRecord(item);
    if (
      !entry ||
      typeof entry.ruleId !== "string" ||
      typeof entry.severity !== "string" ||
      !SEVERITIES.has(entry.severity)
    ) {
      return [];
    }
    return [{ ruleId: entry.ruleId, severity: entry.severity as DrcViolation["severity"] }];
  });
}

/**
 * Corrupt violations or options JSON → null (as `getDrcResult`): a row that
 * cannot be read is "not run", never a pass. `severityOverrides` /
 * `ruleSeverities` are display data the run recorded; the gate re-derives the
 * suppressions it judges from its own snapshot, and the stamp's digests bind.
 */
export function getDrcGateEvidence(
  db: DbClient,
  designId: string,
): StoredDrcGateEvidence | null {
  const row = getDrcResultRow(db, designId);
  if (!row) return null;
  const violations = parseJson(row.violationsJson);
  const options = asRecord(parseJson(row.optionsJson));
  if (!Array.isArray(violations) || !options) return null;
  let waived = 0;
  let unchecked = 0;
  for (const item of violations) {
    const violation = asRecord(item);
    if (!violation) return null;
    if (violation.waived === true) waived += 1;
    else if (
      typeof violation.code === "string" &&
      violation.code.endsWith("_UNCHECKED")
    ) {
      unchecked += 1;
    }
  }
  const provenance = parseProvenance(row);
  return {
    ranAtRevision: row.ranAtRevision,
    ranAt: row.ranAt,
    errors: row.errorCount,
    warnings: row.warningCount,
    infos: row.infoCount,
    waived,
    unchecked,
    ignoredRuleClasses: ruleClassesFrom(options.ignoredRuleClasses),
    severityOverrides: severityOverridesFrom(options.severityOverrides),
    ruleSeverities: ruleSeveritiesFrom(options.ruleSeverities),
    engineVersion: provenance?.engineVersion ?? "unknown",
    provenance,
  };
}
