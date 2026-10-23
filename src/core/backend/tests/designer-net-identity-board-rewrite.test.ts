import { describe, expect, test } from "bun:test";
import type { PcbBoardSettings } from "../../../sdks/designer";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import { BOARD_SETTINGS_SCHEMA_VERSION } from "../../../modules/designer/backend/pcb/board-settings-serialize";
import { serializeMigratedBoardReferences } from "../../../modules/designer/backend/net-identity/migration-board-rewrite";
import { NetIdentityStateInvalidError } from "../../../modules/designer/backend/net-identity/types";

const STAMP = "2026-10-22T00:00:00.000Z";
const NOW = "2026-10-22T01:00:00.000Z";
const source = "pt:0:0";
const destination = "net:aaaaaaaaaa:1";
const other = "pt:10:0";

function beforeBoard(): PcbBoardSettings {
  return {
    ...createDefaultPcbBoardSettings(STAMP),
    perNetClassAssignments: { [source]: "default", retained: "default" },
    lengthMatchGroups: [{ id: "group", name: "Group", netIds: [source, other], target: { kind: "longest" }, toleranceMm: 0 }],
    diffPairs: [{ id: "pair", name: "Pair", pNetId: source, nNetId: other }],
    drcRules: [{ id: "rule", name: "Rule", enabled: true, priority: 1,
      scopes: [{ kind: "layer", layers: ["F.Cu"] }, { kind: "net", netIds: [source, other] }],
      constraint: { kind: "clearance", mm: 0.5 } }],
  };
}

function afterBoard(before: PcbBoardSettings): PcbBoardSettings {
  return {
    ...structuredClone(before),
    perNetClassAssignments: { [destination]: "default", retained: "default" },
    lengthMatchGroups: [{ ...before.lengthMatchGroups![0]!, netIds: [destination, other] }],
    diffPairs: [{ ...before.diffPairs![0]!, pNetId: destination }],
    drcRules: [{ ...before.drcRules![0]!, scopes: [{ kind: "layer", layers: ["F.Cu"] }, { kind: "net", netIds: [destination, other] }] }],
  };
}

function rawBoard(before: PcbBoardSettings): Record<string, unknown> {
  return JSON.parse(JSON.stringify(before)) as Record<string, unknown>;
}

function rewrite(raw: Record<string, unknown>, before: PcbBoardSettings, after: PcbBoardSettings): Record<string, unknown> {
  const result = serializeMigratedBoardReferences(raw, before, after, NOW);
  expect(result).not.toBeNull();
  return JSON.parse(result!) as Record<string, unknown>;
}

describe("raw board net-reference migration", () => {
  test("rewrites valid assignments, groups, pairs and indexed net scopes only", () => {
    const before = beforeBoard();
    const after = afterBoard(before);
    const raw = rawBoard(before);
    const rewritten = rewrite(raw, before, after);
    expect(rewritten).toEqual({ ...raw, perNetClassAssignments: after.perNetClassAssignments,
      lengthMatchGroups: after.lengthMatchGroups, diffPairs: after.diffPairs, drcRules: after.drcRules,
      updatedAt: NOW, schemaVersion: BOARD_SETTINGS_SCHEMA_VERSION });
  });

  test("malformed known values and non-record rows survive unrelated reference changes", () => {
    const before = beforeBoard();
    const raw = rawBoard(before);
    raw.designRules = { clearance: "future-policy", minimums: { traceWidthMm: "bad-but-stored" }, electrical: { deltaTC: -7 } };
    raw.boardThicknessMm = "not-a-number";
    raw.netClasses = [null, 7, { id: "new-class", currentLimitA: "unknown" }];
    raw.drcRules = [null, 17, "future-rule", ...before.drcRules!, { id: "unparsed", strange: [1, 2] }];
    raw.diffPairs = ["bad", ...before.diffPairs!, null];
    const rewritten = rewrite(raw, before, afterBoard(before));
    expect(rewritten.designRules).toEqual(raw.designRules);
    expect(rewritten.boardThicknessMm).toBe(raw.boardThicknessMm);
    expect(rewritten.netClasses).toEqual(raw.netClasses);
    expect(rewritten.drcRules).toEqual([null, 17, "future-rule", ...afterBoard(before).drcRules!, { id: "unparsed", strange: [1, 2] }]);
    expect(rewritten.diffPairs).toEqual(["bad", ...afterBoard(before).diffPairs!, null]);
  });

  test("unknown row, scope and constraint metadata survive changed net IDs", () => {
    const before = beforeBoard();
    const raw = rawBoard(before);
    raw.lengthMatchGroups = [{ ...before.lengthMatchGroups![0]!, future: { limit: "keep" }, target: { kind: "longest", extra: 8 } }];
    raw.diffPairs = [{ ...before.diffPairs![0]!, policy: ["unknown"] }];
    raw.drcRules = [{ ...before.drcRules![0]!, version: "future", constraint: { kind: "clearance", mm: "malformed", future: true },
      scopes: [{ kind: "layer", layers: ["F.Cu"], untouched: "a" }, { kind: "net", netIds: [source, other], extension: { opaque: true } }, null, { kind: "future", data: [1] }] }];
    const rewritten = rewrite(raw, before, afterBoard(before));
    expect(rewritten.lengthMatchGroups).toEqual([{ ...before.lengthMatchGroups![0]!, netIds: [destination, other], future: { limit: "keep" }, target: { kind: "longest", extra: 8 } }]);
    expect(rewritten.diffPairs).toEqual([{ ...before.diffPairs![0]!, pNetId: destination, policy: ["unknown"] }]);
    expect(rewritten.drcRules).toEqual([{ ...before.drcRules![0]!, version: "future", constraint: { kind: "clearance", mm: "malformed", future: true },
      scopes: [{ kind: "layer", layers: ["F.Cu"], untouched: "a" }, { kind: "net", netIds: [destination, other], extension: { opaque: true } }, null, { kind: "future", data: [1] }] }]);
  });

  test("unchanged duplicate raw and typed rows remain untouched", () => {
    const before = beforeBoard();
    before.diffPairs = [...before.diffPairs!, ...before.diffPairs!];
    const after = { ...before, perNetClassAssignments: { [destination]: "default", retained: "default" } };
    const raw = rawBoard(before);
    raw.lengthMatchGroups = [null, { id: "unparsed", value: "preserve" }];
    const rewritten = rewrite(raw, before, after);
    expect(rewritten.diffPairs).toEqual(raw.diffPairs);
    expect(rewritten.lengthMatchGroups).toEqual(raw.lengthMatchGroups);
  });

  test("after parser defaults and row order never replace untouched raw fields", () => {
    const before = beforeBoard();
    const after = { ...before, boardThicknessMm: 9,
      lengthMatchGroups: [...before.lengthMatchGroups!].reverse(), updatedAt: "wrong" };
    expect(serializeMigratedBoardReferences({ malformed: true }, before, after, NOW)).toBeNull();
    expect(serializeMigratedBoardReferences({}, createDefaultPcbBoardSettings(STAMP), createDefaultPcbBoardSettings(NOW), NOW)).toBeNull();
  });

  test("only changed source assignments are validated or deleted", () => {
    const before = beforeBoard();
    const raw = rawBoard(before);
    raw.perNetClassAssignments = { [source]: "default", retained: { malformed: true }, unknown: "future-class" };
    const after = { ...before, perNetClassAssignments: { [destination]: "default", retained: "default" } };
    expect(rewrite(raw, before, after).perNetClassAssignments).toEqual({ retained: { malformed: true }, unknown: "future-class", [destination]: "default" });
    expect(rewrite(raw, before, { ...before, perNetClassAssignments: { retained: "default" } }).perNetClassAssignments)
      .toEqual({ retained: { malformed: true }, unknown: "future-class" });
  });

  test("raw assignment destination collisions refuse instead of overwriting hidden declarations", () => {
    const before = beforeBoard();
    for (const hidden of ["future-class", "default", { future: true }]) {
      const raw = { ...rawBoard(before), perNetClassAssignments: { ...before.perNetClassAssignments, [destination]: hidden } };
      expect(() => serializeMigratedBoardReferences(raw, before, afterBoard(before), NOW)).toThrow(NetIdentityStateInvalidError);
      expect((raw.perNetClassAssignments as Record<string, unknown>)[destination]).toEqual(hidden);
    }
  });

  test("normalized or mismatched raw source assignments refuse", () => {
    const before = beforeBoard();
    for (const raw of [{ ...rawBoard(before), perNetClassAssignments: null },
      { ...rawBoard(before), perNetClassAssignments: { [source]: " default ", retained: "default" } }]) {
      expect(() => serializeMigratedBoardReferences(raw, before, afterBoard(before), NOW)).toThrow(NetIdentityStateInvalidError);
    }
  });

  test("exact raw reference mismatches and normalized row IDs refuse", () => {
    const before = beforeBoard();
    for (const patch of [
      { lengthMatchGroups: [{ ...before.lengthMatchGroups![0]!, netIds: [other, source] }] },
      { lengthMatchGroups: [{ ...before.lengthMatchGroups![0]!, id: " group " }] },
      { diffPairs: [{ ...before.diffPairs![0]!, pNetId: "different" }] },
      { drcRules: [{ ...before.drcRules![0]!, scopes: [{ kind: "net", netIds: [source, other] }] }] },
      { drcRules: [{ ...before.drcRules![0]!, scopes: [{ kind: "layer", layers: ["F.Cu"] }, { kind: "net", netIds: [source.trim(), "different"] }] }] },
    ]) expect(() => serializeMigratedBoardReferences({ ...rawBoard(before), ...patch }, before, afterBoard(before), NOW)).toThrow(NetIdentityStateInvalidError);
  });

  test("touched duplicate raw or typed IDs refuse", () => {
    const before = beforeBoard();
    const after = afterBoard(before);
    const raw = rawBoard(before);
    expect(() => serializeMigratedBoardReferences({ ...raw, diffPairs: [...before.diffPairs!, ...before.diffPairs!] }, before, after, NOW)).toThrow(NetIdentityStateInvalidError);
    expect(() => serializeMigratedBoardReferences(raw, { ...before, diffPairs: [...before.diffPairs!, ...before.diffPairs!] }, after, NOW)).toThrow(NetIdentityStateInvalidError);
    expect(() => serializeMigratedBoardReferences(raw, before, { ...after, diffPairs: [...after.diffPairs!, ...after.diffPairs!] }, NOW)).toThrow(NetIdentityStateInvalidError);
  });

  test("unexpected row deletion, insertion and scope movement refuse explicitly", () => {
    const before = beforeBoard();
    const raw = rawBoard(before);
    for (const after of [
      { ...before, lengthMatchGroups: [] }, { ...before, diffPairs: [] }, { ...before, drcRules: [] },
      { ...before, diffPairs: [...before.diffPairs!, { ...before.diffPairs![0]!, id: "new" }] },
      { ...before, drcRules: [{ ...before.drcRules![0]!, scopes: [...before.drcRules![0]!.scopes].reverse() }] },
    ]) expect(() => serializeMigratedBoardReferences(raw, before, after, NOW)).toThrow(NetIdentityStateInvalidError);
  });

  test("schema versions follow the existing raw writer policy only on actual changes", () => {
    const before = beforeBoard();
    for (const [version, expected] of [[9, 9], [0, BOARD_SETTINGS_SCHEMA_VERSION], ["future", BOARD_SETTINGS_SCHEMA_VERSION], [undefined, BOARD_SETTINGS_SCHEMA_VERSION]]) {
      const raw = { ...rawBoard(before), schemaVersion: version };
      expect(rewrite(raw, before, afterBoard(before)).schemaVersion).toBe(expected);
      expect(serializeMigratedBoardReferences(raw, before, before, NOW)).toBeNull();
    }
  });

  test("frozen inputs stay unchanged on success and late refusal", () => {
    const freeze = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      Object.freeze(value);
      for (const child of Object.values(value)) freeze(child);
    };
    const before = beforeBoard();
    const after = afterBoard(before);
    const raw = rawBoard(before);
    const snapshot = structuredClone({ raw, before, after });
    freeze(raw); freeze(before); freeze(after);
    rewrite(raw, before, after);
    expect({ raw, before, after }).toEqual(snapshot);
    const bad = { ...raw, drcRules: [{ id: "rule", scopes: [] }] };
    expect(() => serializeMigratedBoardReferences(bad, before, after, NOW)).toThrow(NetIdentityStateInvalidError);
    expect({ raw, before, after }).toEqual(snapshot);
  });
});
