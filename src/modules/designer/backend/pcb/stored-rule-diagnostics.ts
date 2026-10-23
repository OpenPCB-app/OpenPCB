import type { PcbRuleReadDiagnostic } from "../../../../sdks/designer";
import { isCopperLayerId } from "../../../../sdks/designer";
import { ALL_PAIR_KINDS } from "../../../../shared/drc/rule-compile";
import { asNumber, asRecord, asString } from "../value-guards";

type Row = Record<string, unknown>;
type Reporter = (path: string, message: string, unsupported?: boolean) => void;
type RowReader = (row: Row, path: string, report: Reporter) => void;

const SCALAR_KINDS = [
  "trackWidth",
  "viaDiameter",
  "viaDrill",
  "annularRing",
  "holeToHole",
  "edgeClearance",
];

/**
 * Mirrors only the legacy readers' losses, not the stricter authoring rules.
 * Missing defaulted fields and unknown extra keys remain valid legacy data.
 * This inspection never mutates the payload or decides serializer rescue.
 */
export function collectStoredRuleDiagnostics(
  raw: unknown,
): PcbRuleReadDiagnostic[] {
  const record = asRecord(raw);
  if (!record) return [];
  const diagnostics: PcbRuleReadDiagnostic[] = [];
  for (const [field, read] of [
    ["lengthMatchGroups", readLengthGroup],
    ["diffPairs", readDiffPair],
    ["drcRules", readDrcRule],
  ] as const) {
    if (!Object.hasOwn(record, field)) continue;
    const rows = record[field];
    if (!Array.isArray(rows)) {
      diagnostics.push({
        path: field,
        reason: "malformed",
        message: "Expected an array; stored rules were dropped.",
      });
      continue;
    }
    rows.forEach((value, index) =>
      readRow(value, `${field}[${index}]`, read, diagnostics),
    );
  }
  return diagnostics;
}

function readRow(
  value: unknown,
  path: string,
  read: RowReader,
  diagnostics: PcbRuleReadDiagnostic[],
): void {
  const row = asRecord(value);
  const ruleId = asString(row?.id);
  const report: Reporter = (at, message, unsupported = false) => {
    diagnostics.push({
      path: at,
      ...(ruleId ? { ruleId } : {}),
      reason: unsupported ? "unsupported" : "malformed",
      message,
    });
  };
  if (!row) {
    report(path, "Expected a rule object; stored row was dropped.");
    return;
  }
  for (const key of ["id", "name"]) {
    requiredString(row[key], `${path}.${key}`, report);
  }
  read(row, path, report);
}

function requiredString(value: unknown, path: string, report: Reporter): void {
  if (!asString(value)) {
    report(path, "Expected a non-empty string; stored row was dropped.");
  }
}

function numberField(
  row: Row,
  field: string,
  path: string,
  report: Reporter,
  positive = false,
  required = false,
): void {
  if (!required && !Object.hasOwn(row, field)) return;
  const value = asNumber(row[field]);
  if (value === null || (positive ? value <= 0 : value < 0)) {
    report(
      `${path}.${field}`,
      `Expected a finite ${positive ? "positive" : "non-negative"} number; stored value was dropped or defaulted.`,
    );
  }
}

function kindOf(
  row: Row,
  path: string,
  known: readonly string[],
  report: Reporter,
): string | null {
  const kind = asString(row.kind);
  if (kind && known.includes(kind)) return kind;
  report(
    `${path}.kind`,
    kind
      ? `Unsupported kind "${kind}"; stored rule data was not applied.`
      : "Expected a kind string; stored rule data was not applied.",
    !!kind,
  );
  return null;
}

function stringList(
  value: unknown,
  path: string,
  report: Reporter,
  nonEmpty = false,
  supported?: (value: string) => boolean,
): void {
  if (!Array.isArray(value)) {
    report(path, "Expected an array; stored list was dropped or defaulted.");
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || (nonEmpty && entry.length === 0)) {
      report(`${path}[${index}]`, "Expected a string; stored list entry was dropped.");
    } else if (supported && !supported(entry)) {
      report(
        `${path}[${index}]`,
        `Unsupported value "${entry}"; stored scope cannot be fully applied.`,
        true,
      );
    }
  });
}

function readLengthGroup(row: Row, path: string, report: Reporter): void {
  if (Object.hasOwn(row, "netIds")) {
    stringList(row.netIds, `${path}.netIds`, report, true);
  }
  numberField(row, "toleranceMm", path, report);
  if (!Object.hasOwn(row, "target")) return;
  const target = asRecord(row.target);
  if (!target) {
    report(
      `${path}.target`,
      "Expected a target object; stored target was replaced with longest.",
    );
    return;
  }
  if (kindOf(target, `${path}.target`, ["longest", "absolute"], report) === "absolute") {
    numberField(target, "mm", `${path}.target`, report, true, true);
  }
}

function readDiffPair(row: Row, path: string, report: Reporter): void {
  for (const key of ["pNetId", "nNetId"]) {
    requiredString(row[key], `${path}.${key}`, report);
  }
  for (const key of [
    "gapMm", "gapTolMm", "maxUncoupledMm", "maxSkewMm", "couplingMaxGapMm",
  ]) {
    numberField(row, key, path, report, key === "couplingMaxGapMm");
  }
}

function readDrcRule(row: Row, path: string, report: Reporter): void {
  if (Object.hasOwn(row, "priority") && asNumber(row.priority) === null) {
    report(
      `${path}.priority`,
      "Expected a finite number; stored priority was replaced with zero.",
    );
  }
  if (Object.hasOwn(row, "enabled") && typeof row.enabled !== "boolean") {
    report(
      `${path}.enabled`,
      "Expected a boolean; stored enabled flag was replaced with true.",
    );
  }
  if (Object.hasOwn(row, "severity") && (
    typeof row.severity !== "string" ||
    !["error", "warning", "info"].includes(row.severity)
  )) {
    const unsupported = typeof row.severity === "string" && row.severity.length > 0;
    report(`${path}.severity`, "Unrecognized severity; stored override was dropped.", unsupported);
  }
  const constraint = asRecord(row.constraint);
  if (!constraint) {
    report(`${path}.constraint`, "Expected a constraint object; stored row was dropped.");
  } else {
    const kind = kindOf(
      constraint, `${path}.constraint`, ["clearance", ...SCALAR_KINDS], report,
    );
    if (kind) {
      numberField(
        constraint, kind === "clearance" ? "mm" : "minMm",
        `${path}.constraint`, report, false, true,
      );
    }
  }
  if (Object.hasOwn(row, "scopes")) {
    readScopes(row.scopes, `${path}.scopes`, report);
  }
}

function readScopes(value: unknown, path: string, report: Reporter): void {
  if (!Array.isArray(value)) {
    report(path, "Expected a scope array; stored row was dropped.");
    return;
  }
  value.forEach((value, index) => {
    const at = `${path}[${index}]`;
    const scope = asRecord(value);
    if (!scope) {
      report(at, "Expected a scope object; stored row was dropped.");
      return;
    }
    const kind = kindOf(
      scope, at, ["net", "netClass", "layer", "pairKind", "area"], report,
    );
    if (kind === "net") stringList(scope.netIds, `${at}.netIds`, report);
    if (kind === "netClass") stringList(scope.netClassIds, `${at}.netClassIds`, report);
    if (kind === "layer") {
      stringList(scope.layers, `${at}.layers`, report, false, isCopperLayerId);
    }
    if (kind === "pairKind") {
      stringList(scope.pairKinds, `${at}.pairKinds`, report, false,
        (entry) => (ALL_PAIR_KINDS as readonly string[]).includes(entry));
    }
    if (kind === "area") readPolygon(scope.polygonMm, `${at}.polygonMm`, report);
  });
}

function readPolygon(value: unknown, path: string, report: Reporter): void {
  if (!Array.isArray(value) || value.length < 3) {
    report(path, "Expected at least three polygon points; stored row was dropped.");
    return;
  }
  value.forEach((point, index) => {
    const row = asRecord(point);
    if (!row || asNumber(row.x) === null || asNumber(row.y) === null) {
      report(
        `${path}[${index}]`,
        "Expected finite x and y coordinates; stored point was dropped.",
      );
    }
  });
}
