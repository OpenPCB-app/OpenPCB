import { exceeds } from "../../pcb-geometry/tolerance";
import { DIFF_PAIR_DEFAULTS } from "../checks/signal-integrity";

type Row = Record<string, unknown>;

function record(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function numericProblem(
  value: unknown,
  field: string,
  positive = false,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${field} must be a finite number`;
  }
  if (positive ? value <= 0 : value < 0) {
    return `${field} must be ${positive ? "> 0" : ">= 0"} (got ${value})`;
  }
  return null;
}

function identityProblem(row: Row, field: string, ids: Set<string>): string | null {
  if (!nonblank(row.id)) return `${field}.id must be a non-empty string`;
  if (ids.has(row.id)) return `${field}.id duplicates id "${row.id}"`;
  ids.add(row.id);
  if (!nonblank(row.name)) return `${field}.name must be a non-empty string`;
  return null;
}

function membersProblem(value: unknown, field: string): string | null {
  if (!Array.isArray(value)) return `${field} must be an array`;
  const seen = new Set<string>();
  for (const [index, member] of value.entries()) {
    if (!nonblank(member)) return `${field}[${index}] must be a non-empty string`;
    if (seen.has(member)) return `${field}[${index}] duplicates net "${member}"`;
    seen.add(member);
  }
  return null;
}

function lengthGroupProblem(row: Row, field: string): string | null {
  const members = membersProblem(row.netIds, `${field}.netIds`);
  if (members) return members;
  const target =
    row.target === undefined ? { kind: "longest" } : record(row.target);
  if (!target) return `${field}.target must be an object`;
  if (target.kind !== "longest" && target.kind !== "absolute") {
    return `${field}.target.kind must be 'longest' or 'absolute'`;
  }
  if (target.kind === "absolute") {
    const problem = numericProblem(target.mm, `${field}.target.mm`, true);
    if (problem) return problem;
  }
  const minimum = target.kind === "absolute" ? 1 : 2;
  if ((row.netIds as unknown[]).length < minimum) {
    return `${field}.netIds must contain at least ${minimum} distinct net${minimum === 1 ? "" : "s"} for ${target.kind} target`;
  }
  return row.toleranceMm === undefined
    ? null
    : numericProblem(row.toleranceMm, `${field}.toleranceMm`);
}

function validateLengthGroups(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "lengthMatchGroups must be an array";
  const ids = new Set<string>();
  for (const [index, valueRow] of value.entries()) {
    const field = `lengthMatchGroups[${index}]`;
    const row = record(valueRow);
    if (!row) return `${field} must be an object`;
    const problem =
      identityProblem(row, field, ids) ?? lengthGroupProblem(row, field);
    if (problem) return problem;
  }
  return null;
}

function pairParametersProblem(row: Row, field: string): string | null {
  for (const key of [
    "gapMm", "gapTolMm", "maxUncoupledMm", "maxSkewMm", "couplingMaxGapMm",
  ]) {
    if (row[key] === undefined) continue;
    const problem = numericProblem(
      row[key], `${field}.${key}`, key === "couplingMaxGapMm",
    );
    if (problem) return problem;
  }
  // Class-derived targets depend on live net identities. The batch rule model
  // diagnoses those; authoring validates only the target explicitly supplied.
  if (row.gapMm === undefined) return null;
  const gap = row.gapMm as number;
  const tolerance =
    (row.gapTolMm as number | undefined) ?? DIFF_PAIR_DEFAULTS.gapTolMm;
  const window =
    (row.couplingMaxGapMm as number | undefined) ??
    DIFF_PAIR_DEFAULTS.couplingMaxGapMm(gap);
  if (!Number.isFinite(window)) {
    return `${field}.couplingMaxGapMm must resolve to a finite number`;
  }
  if (exceeds(gap - tolerance, window) || exceeds(gap + tolerance, window)) {
    return `${field}.couplingMaxGapMm must contain the gap tolerance band (gapMm ${gap}, gapTolMm ${tolerance}, couplingMaxGapMm ${window})`;
  }
  return null;
}

function validatePairs(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "diffPairs must be an array";
  const ids = new Set<string>();
  const pairKeys = new Set<string>();
  const claimedNets = new Set<string>();
  for (const [index, valueRow] of value.entries()) {
    const field = `diffPairs[${index}]`;
    const row = record(valueRow);
    if (!row) return `${field} must be an object`;
    const identity = identityProblem(row, field, ids);
    if (identity) return identity;
    if (!nonblank(row.pNetId)) return `${field}.pNetId must be a non-empty string`;
    if (!nonblank(row.nNetId)) return `${field}.nNetId must be a non-empty string`;
    if (row.pNetId === row.nNetId) return `${field}.nNetId must differ from pNetId`;
    const pairKey = JSON.stringify([row.pNetId, row.nNetId].sort());
    if (pairKeys.has(pairKey)) return `${field} duplicates an explicit net pair`;
    for (const key of ["pNetId", "nNetId"] as const) {
      if (claimedNets.has(row[key] as string)) {
        return `${field}.${key} already belongs to another explicit pair`;
      }
      claimedNets.add(row[key] as string);
    }
    pairKeys.add(pairKey);
    const parameters = pairParametersProblem(row, field);
    if (parameters) return parameters;
  }
  return null;
}

/** Validate new SI writes before tolerant stored-data parsers can lose intent. */
export function validateSiRulesForSave(fields: {
  lengthMatchGroups?: unknown;
  diffPairs?: unknown;
}): string | null {
  return (
    validateLengthGroups(fields.lengthMatchGroups) ?? validatePairs(fields.diffPairs)
  );
}
