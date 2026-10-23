import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { DrcReport } from "../../../sdks/designer";
import { getDrcResult, getDrcResultRow, saveDrcResult } from "../../../modules/designer/backend/drc-results";
import { drcOptionsFromProjection, runDrc } from "../../../shared/drc/drc-engine";
import { board, projection, trace } from "./helpers/drc-fixtures";

let sqlite: Database;
let db: Parameters<typeof getDrcResult>[0];
let report: DrcReport;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  sqlite.exec(await Bun.file(new URL("../../../modules/designer/backend/migrations/0013_drc_results.sql", import.meta.url)).text());
  db = drizzle(sqlite) as unknown as Parameters<typeof getDrcResult>[0];
  const input = projection({
    board: board({ drcSeverityOverrides: { TRACE_WIDTH_MIN: "warning" } }),
    traces: [trace("t1", null, [[0, 0], [1, 0]], { widthMm: 0.01 })],
  });
  report = runDrc(input);
  saveDrcResult(db, input.designId, report, drcOptionsFromProjection(input), "2026-10-22T12:00:00.000Z");
});
afterEach(() => sqlite.close());

function replaceOptions(value: string): void {
  sqlite.query("UPDATE designer_drc_results SET options_json = ? WHERE design_id = ?").run(value, report.designId);
}

function replaceViolations(value: unknown[]): void {
  sqlite.query("UPDATE designer_drc_results SET violations_json = ? WHERE design_id = ?")
    .run(JSON.stringify(value), report.designId);
}

function storedFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "finding", code: "TRACE_WIDTH_MIN", ruleClass: "manufacturability",
    severity: "error", message: "Trace too narrow", anchors: [{ kind: "boardEdge" }],
    ...overrides,
  };
}

test("persisted reports round-trip execution evidence, overrides, and violation bytes", () => {
  const stored = getDrcResult(db, report.designId);
  expect(JSON.stringify(stored?.report)).toBe(JSON.stringify(report));
  const options = JSON.parse(getDrcResultRow(db, report.designId)!.optionsJson);
  expect(options.severityOverrides).toEqual({ TRACE_WIDTH_MIN: "warning" });
  expect(options.evidence).toEqual(report.evidence);
  saveDrcResult(db, report.designId, report, { ignoredRuleClasses: [], waivedIds: [] }, "2026-10-22T13:00:00.000Z");
  expect(getDrcResult(db, report.designId)?.ranAt).toBe("2026-10-22T13:00:00.000Z");
  expect(getDrcResultRow(db, report.designId)?.createdAt).toBe("2026-10-22T12:00:00.000Z");
});

test.each([
  "{}", "null", "[]", "{ invalid json",
  JSON.stringify({ evidence: { version: 2 } }),
  JSON.stringify({ evidence: { version: 1, scope: "batch", limitations: [] } }),
  JSON.stringify({ evidence: { ...runDrc(projection()).evidence, severityOverrides: { TRACE_WIDTH_MIN: ["ignore"] } } }),
])("old or malformed evidence stays absent: %s", (options) => {
  replaceOptions(options);
  const stored = getDrcResult(db, report.designId);
  expect(stored?.report.violations).toEqual(report.violations);
  expect(stored?.report).not.toHaveProperty("evidence");
});

test.each(["null", "{}", "4", '[null]', '[3]', '["bad"]', '[{}]', '[{"id":"v","code":"TRACE_WIDTH_MIN","message":"bad","severity":"future","anchors":[]}]'])(
  "malformed stored violation shape is unavailable: %s", (json) => {
    sqlite.query("UPDATE designer_drc_results SET violations_json = ? WHERE design_id = ?").run(json, report.designId);
    expect(getDrcResult(db, report.designId)).toBeNull();
  },
);

test("unknown future violation codes remain visible when their shape is sound", () => {
  const violation = {
    id: "future-id", code: "FUTURE_RULE_CODE", ruleClass: "constraint",
    severity: "error", message: "Future rule failed", anchors: [{ kind: "boardEdge" }],
  };
  sqlite.query("UPDATE designer_drc_results SET violations_json = ? WHERE design_id = ?").run(JSON.stringify([violation]), report.designId);
  expect(JSON.stringify(getDrcResult(db, report.designId)?.report.violations)).toBe(JSON.stringify([violation]));
});

test.each([
  { measuredMm: "x" }, { measuredMm: null }, { requiredMm: "x" },
  { requiredMm: null }, { waived: "true" }, { waived: 1 }, { layer: {} },
  { layer: null }, { locationMm: null }, { locationMm: [] },
  { locationMm: { x: "1", y: 2 } }, { locationMm: { x: 1 } },
  { id: "" }, { id: " " }, { code: "" }, { ruleClass: null },
  { anchors: [{ kind: "net", netId: "" }] },
])("corrupt renderer fields make a stored report unavailable: %j", (fields) => {
  replaceViolations([storedFinding(fields)]);
  expect(getDrcResult(db, report.designId)).toBeNull();
});

test.each(["measuredMm", "requiredMm", "locationMm"])(
  "nonfinite %s values make a stored report unavailable", (field) => {
    const fields = field === "locationMm"
      ? { locationMm: { x: "nonfinite", y: 0 } }
      : { [field]: "nonfinite" };
    const json = JSON.stringify([storedFinding(fields)]).replace('"nonfinite"', "1e999");
    sqlite.query("UPDATE designer_drc_results SET violations_json = ? WHERE design_id = ?")
      .run(json, report.designId);
    expect(getDrcResult(db, report.designId)).toBeNull();
  },
);

test("valid optional fields and a future rule class remain unchanged", () => {
  const violation = storedFinding({
    ruleClass: "future-class", measuredMm: -0.1, requiredMm: 0.2,
    locationMm: { x: 0, y: -2 }, waived: false, layer: "Future.Cu",
  });
  replaceViolations([violation]);
  expect(JSON.stringify(getDrcResult(db, report.designId)?.report.violations)).toBe(JSON.stringify([violation]));
});

test("summary is rebuilt from findings rather than inconsistent stored counters", () => {
  replaceViolations([
    storedFinding({ id: "active-error" }),
    storedFinding({ id: "waived-warning", severity: "warning", waived: true }),
    storedFinding({ id: "active-warning", severity: "warning" }),
    storedFinding({ id: "active-info", severity: "info" }),
  ]);
  sqlite.query("UPDATE designer_drc_results SET error_count = 0, warning_count = 99, info_count = 99 WHERE design_id = ?")
    .run(report.designId);
  const stored = getDrcResult(db, report.designId);
  expect(stored?.report.summary).toEqual({ errors: 1, warnings: 1, infos: 1 });
  expect(stored?.report.countsByCode).toEqual({ TRACE_WIDTH_MIN: 4 });
});

test.each(["NET_SHORT_CIRCUIT", "DRC_RULE_INVALID"])(
  "forged %s waiver flags are removed before counting and exposure", (code) => {
    replaceViolations([storedFinding({ code, waived: true })]);
    const stored = getDrcResult(db, report.designId);
    expect(stored?.report.violations[0]).not.toHaveProperty("waived");
    expect(stored?.report.summary).toEqual({ errors: 1, warnings: 0, infos: 0 });
  },
);

test("future code names cannot alter the counts object prototype", () => {
  replaceViolations([
    storedFinding({ id: "a", code: "__proto__" }),
    storedFinding({ id: "b", code: "__proto__" }),
    storedFinding({ id: "c", code: "constructor" }),
  ]);
  const stored = getDrcResult(db, report.designId);
  expect(stored?.report.violations.map((violation): string => violation.code)).toEqual(["__proto__", "__proto__", "constructor"]);
  expect(Object.getPrototypeOf(stored!.report.countsByCode)).toBe(Object.prototype);
  expect(Object.hasOwn(stored!.report.countsByCode, "__proto__")).toBe(true);
  expect(JSON.stringify(stored!.report.countsByCode)).toBe('{"__proto__":2,"constructor":1}');
  expect(stored?.report.summary).toEqual({ errors: 3, warnings: 0, infos: 0 });
});
