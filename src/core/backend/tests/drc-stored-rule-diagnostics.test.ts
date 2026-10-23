import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { getSharedSqlite } from "../db/sqlite-client";
import {
  ensurePcbBoardSettings,
  readRawBoardSettingsRow,
  readStoredPcbRuleDiagnostics,
  updatePcbActiveLayer,
  updatePcbDesignRules,
} from "../../../modules/designer/backend/pcb/pcb-store";
import { collectStoredRuleDiagnostics } from "../../../modules/designer/backend/pcb/stored-rule-diagnostics";
import { pcbEntities } from "../../../modules/designer/backend/schema";
import { runDrc } from "../../../shared/drc/drc-engine";
import type { PcbRuleReadDiagnostic } from "../../../sdks/designer";
import { board, projection, FIXTURE_TS } from "./helpers/drc-fixtures";
import { bootDesignerRuntime } from "./helpers/designer-runtime";

const GROUP = { id: "group", name: "Bus", netIds: ["a", "b"], target: { kind: "longest" as const }, toleranceMm: 0 };
const PAIR = { id: "pair", name: "Pair", pNetId: "p", nNetId: "n" };
const RULE = { id: "rule", name: "Clearance", constraint: { kind: "clearance" as const, mm: 0.2 } };
type PcbDb = Parameters<typeof ensurePcbBoardSettings>[0];

function seededDb(raw: Record<string, unknown>): PcbDb {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE designer_pcb_entities (
    id TEXT PRIMARY KEY, design_id TEXT, kind TEXT, payload_json TEXT,
    created_at TEXT, updated_at TEXT
  )`);
  const db = drizzle(sqlite) as unknown as PcbDb;
  db.insert(pcbEntities).values({
    id: "settings", designId: "design", kind: "board_settings",
    payloadJson: JSON.stringify(raw), createdAt: FIXTURE_TS, updatedAt: FIXTURE_TS,
  }).run();
  return db;
}

function invalidRows(diagnostics: PcbRuleReadDiagnostic[]) {
  const scene = projection();
  scene.ruleReadDiagnostics = diagnostics;
  return runDrc(scene).violations.filter((row) => row.code === "DRC_RULE_INVALID");
}

describe("stored rule read diagnostics", () => {
  test.each([
    ["lengthMatchGroups", {}], ["diffPairs", null], ["drcRules", "future"],
  ])("present malformed %s list is reported", (field, value) => {
    expect(collectStoredRuleDiagnostics({ [field]: value })).toEqual([{
      path: field, reason: "malformed", message: expect.any(String),
    }]);
  });

  test.each(["lengthMatchGroups", "diffPairs", "drcRules"])("%s malformed rows retain deterministic paths without ids", (field) => {
    const diagnostics = collectStoredRuleDiagnostics({ [field]: [null, 7, [], "row"] });
    expect(diagnostics.map((row) => row.path)).toEqual([0, 1, 2, 3].map((index) => `${field}[${index}]`));
    expect(diagnostics.every((row) => row.reason === "malformed" && row.ruleId === undefined)).toBe(true);
    const violations = invalidRows(diagnostics);
    expect(violations).toHaveLength(4);
    expect(new Set(violations.map((row) => row.id)).size).toBe(4);
    expect(invalidRows(structuredClone(diagnostics))).toEqual(violations);
  });

  test.each([
    ["lengthMatchGroups", { ...GROUP, target: { kind: "delay", ps: 100 } }, "target.kind"],
    ["drcRules", { ...RULE, constraint: { kind: "future", mm: 1 } }, "constraint.kind"],
    ["drcRules", { ...RULE, scopes: [{ kind: "future", value: 1 }] }, "scopes[0].kind"],
    ["drcRules", { ...RULE, severity: "future" }, "severity"],
    ["drcRules", { ...RULE, scopes: [{ kind: "layer", layers: ["F.Future"] }] }, "scopes[0].layers[0]"],
    ["drcRules", { ...RULE, scopes: [{ kind: "pairKind", pairKinds: ["future"] }] }, "scopes[0].pairKinds[0]"],
  ])("unknown %s variant produces unsupported diagnostic at %s", (field, row, suffix) => {
    const diagnostics = collectStoredRuleDiagnostics({ [field]: [row] });
    expect(diagnostics).toEqual([{
      path: `${field}[0].${suffix}`, ruleId: row.id, reason: "unsupported", message: expect.any(String),
    }]);
    const violations = invalidRows(diagnostics);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain(`${field}[0].${suffix} (unsupported)`);
  });

  test.each([
    ["lengthMatchGroups", { ...GROUP, id: "" }, "id"],
    ["lengthMatchGroups", { ...GROUP, name: null }, "name"],
    ["lengthMatchGroups", { ...GROUP, netIds: null }, "netIds"],
    ["lengthMatchGroups", { ...GROUP, netIds: ["a", 7] }, "netIds[1]"],
    ["lengthMatchGroups", { ...GROUP, netIds: ["a", ""] }, "netIds[1]"],
    ["lengthMatchGroups", { ...GROUP, target: null }, "target"],
    ["lengthMatchGroups", { ...GROUP, target: {} }, "target.kind"],
    ["lengthMatchGroups", { ...GROUP, target: { kind: "absolute" } }, "target.mm"],
    ["lengthMatchGroups", { ...GROUP, target: { kind: "absolute", mm: 0 } }, "target.mm"],
    ["lengthMatchGroups", { ...GROUP, toleranceMm: -1 }, "toleranceMm"],
    ["diffPairs", { ...PAIR, pNetId: null }, "pNetId"],
    ["diffPairs", { ...PAIR, nNetId: "" }, "nNetId"],
    ["drcRules", { ...RULE, constraint: null }, "constraint"],
    ["drcRules", { ...RULE, constraint: { kind: "clearance", mm: -1 } }, "constraint.mm"],
    ["drcRules", { ...RULE, constraint: { kind: "trackWidth" } }, "constraint.minMm"],
    ["drcRules", { ...RULE, priority: "10" }, "priority"],
    ["drcRules", { ...RULE, enabled: 0 }, "enabled"],
    ["drcRules", { ...RULE, severity: ["error"] }, "severity"],
    ["drcRules", { ...RULE, scopes: null }, "scopes"],
    ["drcRules", { ...RULE, scopes: [null] }, "scopes[0]"],
    ["drcRules", { ...RULE, scopes: [{ kind: "net" }] }, "scopes[0].netIds"],
    ["drcRules", { ...RULE, scopes: [{ kind: "netClass", netClassIds: [1] }] }, "scopes[0].netClassIds[0]"],
    ["drcRules", { ...RULE, scopes: [{ kind: "area", polygonMm: [{ x: 0, y: 0 }] }] }, "scopes[0].polygonMm"],
    ["drcRules", { ...RULE, scopes: [{ kind: "area", polygonMm: [{ x: 0, y: 0 }, { x: 1, y: 0 }, null, { x: 0, y: 1 }] }] }, "scopes[0].polygonMm[2]"],
  ])("malformed %s data at %s is reported", (field, row, suffix) => {
    expect(collectStoredRuleDiagnostics({ [field]: [row] })).toEqual([{
      path: `${field}[0].${suffix}`, ...(row.id ? { ruleId: row.id } : {}),
      reason: "malformed", message: expect.any(String),
    }]);
  });

  for (const key of ["gapMm", "gapTolMm", "maxUncoupledMm", "maxSkewMm", "couplingMaxGapMm"]) {
    test.each([-1, null, "1", NaN, Infinity])(`present invalid ${key} fallback is reported: %s`, (value) => {
      expect(collectStoredRuleDiagnostics({ diffPairs: [{ ...PAIR, [key]: value }] })[0]?.path)
        .toBe(`diffPairs[0].${key}`);
    });
  }

  test("zero coupling window is invalid; other zero thresholds remain valid", () => {
    const raw = { diffPairs: [{ ...PAIR, gapMm: 0, gapTolMm: 0, maxUncoupledMm: 0, maxSkewMm: 0, couplingMaxGapMm: 0 }] };
    expect(collectStoredRuleDiagnostics(raw).map((row) => row.path)).toEqual(["diffPairs[0].couplingMaxGapMm"]);
  });

  test("omitted legacy defaults and unknown extra keys produce no diagnostics", () => {
    const raw = {
      ...board(),
      lengthMatchGroups: [{ id: "legacy", name: "Legacy", future: 7 }],
      diffPairs: [{ ...PAIR, future: { kind: "phase" } }],
      drcRules: [{ ...RULE, future: true, constraint: { ...RULE.constraint, future: 1 } }],
    };
    expect(collectStoredRuleDiagnostics({})).toEqual([]);
    expect(collectStoredRuleDiagnostics({ lengthMatchGroups: [], diffPairs: [], drcRules: [] })).toEqual([]);
    expect(collectStoredRuleDiagnostics(raw)).toEqual([]);
    const settings = ensurePcbBoardSettings(seededDb(raw), "design", FIXTURE_TS);
    expect(settings.lengthMatchGroups).toEqual([{ id: "legacy", name: "Legacy", netIds: [], target: { kind: "longest" }, toleranceMm: 0 }]);
    expect(settings.diffPairs).toEqual([PAIR]);
    expect(settings.drcRules).toEqual([{ ...RULE, priority: 0, enabled: true, scopes: [] }]);
  });

  test("collecting diagnostics never mutates raw payload or stored rows", () => {
    const raw = { ...board(), lengthMatchGroups: [null, { ...GROUP, toleranceMm: -1 }], diffPairs: [{ ...PAIR, gapMm: -1 }] };
    const before = structuredClone(raw);
    collectStoredRuleDiagnostics(raw);
    expect(raw).toEqual(before);
    const db = seededDb(raw);
    const rowsBefore = db.select().from(pcbEntities).all();
    expect(readStoredPcbRuleDiagnostics(db, "design")).toHaveLength(3);
    expect(db.select().from(pcbEntities).all()).toEqual(rowsBefore);
    expect(readStoredPcbRuleDiagnostics(db, "absent")).toEqual([]);
    expect(db.select().from(pcbEntities).all()).toEqual(rowsBefore);
  });

  test("parser fallback output remains unchanged", () => {
    const db = seededDb({
      ...board(), lengthMatchGroups: [{ ...GROUP, target: null, netIds: ["a", null], toleranceMm: -1 }],
      diffPairs: [{ ...PAIR, gapMm: -1, couplingMaxGapMm: 0 }],
      drcRules: [{ ...RULE, priority: null, enabled: 7, severity: "future" }],
    });
    expect(readStoredPcbRuleDiagnostics(db, "design")).toHaveLength(8);
    const settings = ensurePcbBoardSettings(db, "design", FIXTURE_TS);
    expect(settings.lengthMatchGroups).toEqual([{ ...GROUP, netIds: ["a"], toleranceMm: 0 }]);
    expect(settings.diffPairs).toEqual([PAIR]);
    expect(settings.drcRules).toEqual([{ ...RULE, priority: 0, enabled: true, scopes: [] }]);
  });
});

describe("stored diagnostics in batch DRC", () => {
  test("diagnostics share one row per stored id, with namespace and stable ids across reorder", () => {
    const raw = {
      lengthMatchGroups: [{ ...GROUP, id: "same", toleranceMm: -1, target: { kind: "future" } }],
      diffPairs: [{ ...PAIR, id: "same", gapMm: -1 }],
      drcRules: [{ ...RULE, id: "same", constraint: null }],
    };
    const rows = invalidRows(collectStoredRuleDiagnostics(raw));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    const moved = { ...raw, diffPairs: [PAIR, ...raw.diffPairs] };
    expect(invalidRows(collectStoredRuleDiagnostics(moved)).map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(rows.find((row) => row.anchors.some((anchor) => anchor.kind === "rule" && anchor.ruleId === "stored:lengthMatchGroups:same"))!.message)
      .toContain("lengthMatchGroups[0].toleranceMm (malformed)");
  });

  test("class ignore, severity ignore, severity downgrade and waiver cannot suppress reader losses", () => {
    const scene = projection();
    scene.ruleReadDiagnostics = collectStoredRuleDiagnostics({ lengthMatchGroups: [null] });
    const row = runDrc(scene).violations.find((row) => row.code === "DRC_RULE_INVALID")!;
    for (const severity of ["ignore", "info", "warning"] as const) {
      scene.board.drcSeverityOverrides = { DRC_RULE_INVALID: severity };
      scene.board.viewState = { ...scene.board.viewState!, drcIgnoredRuleClasses: ["structural"], drcWaivedViolationIds: [row.id] };
      const next = runDrc(scene, { ignoredRuleClasses: ["structural"], waivedIds: [row.id] }).violations.find((row) => row.code === "DRC_RULE_INVALID")!;
      expect(next).toEqual(row);
      expect(next.severity).toBe("error");
      expect(next.waived).toBeUndefined();
    }
  });

  test("unparseable rows remain rescued after unrelated writes and clearing known rows", () => {
    const futureGroup = { ...GROUP, id: "future-group", target: { kind: "delay", ps: 100 } };
    const futurePair = { ...PAIR, id: "future-pair", pNetId: 7 };
    const futureRule = { ...RULE, id: "future-rule", scopes: [{ kind: "future" }] };
    const malformedGroup = { ...GROUP, id: "malformed-group", name: null };
    const raw = { ...board(), lengthMatchGroups: [GROUP, futureGroup, malformedGroup], diffPairs: [PAIR, futurePair], drcRules: [RULE, futureRule] };
    const db = seededDb(raw);
    const before = readStoredPcbRuleDiagnostics(db, "design");
    updatePcbActiveLayer({ db, designId: "design", layer: "B.Cu", timestamp: FIXTURE_TS });
    expect(readRawBoardSettingsRow(db, "design")!.raw.lengthMatchGroups).toEqual(raw.lengthMatchGroups);
    expect(readStoredPcbRuleDiagnostics(db, "design")).toEqual(before);
    updatePcbDesignRules({ db, designId: "design", lengthMatchGroups: [], diffPairs: [], drcRules: [], timestamp: FIXTURE_TS });
    const saved = readRawBoardSettingsRow(db, "design")!.raw;
    expect(saved.lengthMatchGroups).toEqual([futureGroup, malformedGroup]);
    expect(saved.diffPairs).toEqual([futurePair]);
    expect(saved.drcRules).toEqual([futureRule]);
    expect(saved.ruleReadDiagnostics).toBeUndefined();
    expect(readStoredPcbRuleDiagnostics(db, "design")).toHaveLength(4);
    expect(invalidRows(readStoredPcbRuleDiagnostics(db, "design")).map((row) => row.id).filter((id) => rowsByStoredId(before).has(id))).toHaveLength(4);
  });

  test.each([
    ["outline", null], ["activeLayer", "future"], ["updatedAt", null],
  ])("invalid required %s recovers only in memory and keeps declared rules", (field, value) => {
    const raw = { ...board(), [field]: value, lengthMatchGroups: [GROUP], diffPairs: [PAIR], drcRules: [RULE] };
    const db = seededDb(raw);
    const before = db.select().from(pcbEntities).all();
    for (let read = 0; read < 2; read++) {
      const recovered = ensurePcbBoardSettings(db, "design", FIXTURE_TS);
      expect(recovered.lengthMatchGroups).toEqual([GROUP]);
      expect(recovered.diffPairs).toEqual([PAIR]);
      expect(recovered.drcRules).toEqual([{ ...RULE, priority: 0, enabled: true, scopes: [] }]);
      expect(readStoredPcbRuleDiagnostics(db, "design")).toEqual([{
        path: `boardSettings.${field}`, reason: "malformed", message: expect.any(String),
      }]);
      expect(db.select().from(pcbEntities).all()).toEqual(before);
    }
  });

  test("repeated projections preserve raw malformed outline and valid rules beside it", async () => {
    const { sdk } = await bootDesignerRuntime("stored-rule-projection");
    const design = await sdk.createDesign({ name: "Stored rule projection" });
    await sdk.getPcbProjection(design.id);
    const raw = {
      ...board(), outline: null,
      lengthMatchGroups: [GROUP, { ...GROUP, id: "future", target: { kind: "future" } }],
      diffPairs: [PAIR], drcRules: [RULE],
    };
    const sqlite = getSharedSqlite();
    sqlite.query("UPDATE designer_pcb_entities SET payload_json = ? WHERE design_id = ? AND kind = 'board_settings'")
      .run(JSON.stringify(raw), design.id);
    const query = sqlite.query("SELECT * FROM designer_pcb_entities WHERE design_id = ? AND kind = 'board_settings'");
    const before = query.all(design.id);
    for (let read = 0; read < 2; read++) {
      const loaded = (await sdk.getPcbProjection(design.id))!;
      expect(loaded.ruleReadDiagnostics).toEqual([
        { path: "boardSettings.outline", reason: "malformed", message: expect.any(String) },
        ...collectStoredRuleDiagnostics(raw),
      ]);
      expect(loaded.board.outline).not.toBeNull();
      expect(loaded.board.lengthMatchGroups).toEqual([GROUP]);
      expect(loaded.board.diffPairs).toEqual([PAIR]);
      expect(loaded.board.drcRules).toEqual([{ ...RULE, priority: 0, enabled: true, scopes: [] }]);
      expect(runDrc(loaded).violations.filter((row) => row.code === "DRC_RULE_INVALID")).toHaveLength(2);
      expect(Object.hasOwn(loaded.board, "ruleReadDiagnostics")).toBe(false);
      expect(query.all(design.id)).toEqual(before);
    }
  });

  test("malformed JSON and non-object settings remain stored across repeated projections", async () => {
    const { sdk } = await bootDesignerRuntime("stored-rule-malformed-json");
    const design = await sdk.createDesign({ name: "Malformed settings" });
    await sdk.getPcbProjection(design.id);
    const sqlite = getSharedSqlite();
    const query = sqlite.query("SELECT * FROM designer_pcb_entities WHERE design_id = ? AND kind = 'board_settings'");
    for (const json of ["{broken", "null", "[]", "42", '"settings"']) {
      sqlite.query("UPDATE designer_pcb_entities SET payload_json = ? WHERE design_id = ? AND kind = 'board_settings'")
        .run(json, design.id);
      const before = query.all(design.id);
      for (let read = 0; read < 2; read++) {
        const loaded = (await sdk.getPcbProjection(design.id))!;
        expect(loaded.ruleReadDiagnostics).toEqual([{
          path: "boardSettings", reason: "malformed", message: expect.any(String),
        }]);
        expect(loaded.board.outline).toEqual(board().outline);
        expect(runDrc(loaded).violations.filter((row) => row.code === "DRC_RULE_INVALID")).toHaveLength(1);
        expect(query.all(design.id)).toEqual(before);
      }
    }
  });
});

function rowsByStoredId(diagnostics: PcbRuleReadDiagnostic[]): Set<string> {
  return new Set(invalidRows(diagnostics.filter((row) => row.ruleId !== undefined)).map((row) => row.id));
}
