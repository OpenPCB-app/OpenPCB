import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { DesignerDerivedNet, DesignerSchematicProjection } from "../../../sdks/designer";
import type { NetReferenceSource } from "../../../shared/electrical-identity/references";
import { buildNetIdentitySummary } from "../../../modules/designer/backend/net-identity/summary";
import { writeNetIdentityQuarantine, writeNetIdentityRetired, writeNetIdentityState, type NetIdentityDb } from "../../../modules/designer/backend/net-identity/state-store";
import { designNetSalt, formatDurableNetId, type NetIdentityMigrationReport, type NetIdentityReferenceKind, type NetIdentityState } from "../../../modules/designer/backend/net-identity/types";
import { netIdentityQuarantine, netIdentityRetired, netIdentityState } from "../../../modules/designer/backend/schema";

const DESIGN = "summary-design", TS = "2026-10-22T12:00:00.000Z";
const own = (seq: number) => formatDurableNetId(designNetSalt(DESIGN), seq);
const LIVE = own(1), OTHER = own(2), OLD = own(3), ROOT = "pt:old";
const opened: Database[] = [];
afterEach(() => { for (const sqlite of opened.splice(0)) sqlite.close(); });

function state(status: NetIdentityState["status"] = "active"): NetIdentityState {
  return { designId: DESIGN, schemaVersion: 1, status, nextSeq: 100,
    active: status === "active" ? [LIVE, OTHER].map((id, index) => ({ id, name: `Net_${index + 1}`, nameSource: "auto", members: [{ kind: "pin", id: `member-${index}` }] })) : [],
    provenance: { origin: "native", createdAt: TS, migratorVersion: 1 }, lastError: null, updatedAt: TS };
}
function database(initial: NetIdentityState | null = state()): { db: NetIdentityDb; sqlite: Database } {
  const sqlite = new Database(":memory:"); opened.push(sqlite);
  const dir = new URL("../../../modules/designer/backend/migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(new URL(name, dir), "utf8").split("--> statement-breakpoint")) sqlite.exec(statement);
  }
  const db = drizzle(sqlite) as unknown as NetIdentityDb;
  if (initial) writeNetIdentityState(db, initial);
  return { db, sqlite };
}
function net(id: string, name = "SIGNAL", pinIds: string[] = []): DesignerDerivedNet {
  return { id, name, pinIds, wireIds: [], labelIds: [], primitiveIds: [] };
}
function schematic(nets = [net(LIVE, "SIGNAL", ["joined"]), net(OTHER, "OTHER"), net("nc:lone", "Lone", ["lone"])]): DesignerSchematicProjection {
  return { designId: DESIGN, revision: 8, nets, parts: [], wires: [], labels: [], primitives: [], junctions: [] };
}
function source(extra: Partial<NetReferenceSource> = {}): NetReferenceSource {
  return { traces: [], vias: [], zones: [], freePads: [], board: {}, ...extra };
}
function allSites(netId = ROOT): NetReferenceSource {
  return source({ traces: [{ id: "trace", netId, netName: "Z hint" }, { id: "trace", netId, netName: "A hint" }],
    vias: [{ id: "via", netId }], freePads: [{ id: "pad", netId }],
    zones: [{ id: "enabled", netId, netName: null, enabled: true }, { id: "disabled", netId, netName: null, enabled: false }],
    board: { perNetClassAssignments: { [netId]: "default" },
      lengthMatchGroups: [{ id: "length", name: "Length", netIds: [netId, netId], target: { kind: "longest" }, toleranceMm: 0 }],
      diffPairs: [{ id: "pair", name: "Pair", pNetId: netId, nNetId: netId }],
      drcRules: [{ id: "rule", name: "Rule", enabled: true, priority: 0, scopes: [{ kind: "net", netIds: [netId, netId] }, { kind: "net", netIds: [netId] }], constraint: { kind: "clearance", mm: 0.5 } }] } });
}
function retired(db: NetIdentityDb, seq: number, successorIds: string[], displayName: string | null = "Old name"): void {
  writeNetIdentityRetired(db, { designId: DESIGN, netId: own(seq), seq, reason: "history", successorIds, displayName, retiredAtRevision: 7, createdAt: TS, updatedAt: TS });
}
function quarantine(db: NetIdentityDb, refKind: NetIdentityReferenceKind, refId: string, legacyValue = ROOT, candidates = [LIVE], suggestedNetId: string | null = LIVE): void {
  writeNetIdentityQuarantine(db, { designId: DESIGN, refKind, refId, legacyValue, reason: "root_only", candidates, suggestedNetId, createdAt: TS });
}
function raw(sqlite: Database): string {
  return JSON.stringify([sqlite.query("SELECT * FROM designer_net_identity_state ORDER BY design_id").all(),
    sqlite.query("SELECT * FROM designer_net_identity_retired ORDER BY design_id, net_id").all(),
    sqlite.query("SELECT * FROM designer_net_identity_quarantine ORDER BY design_id, ref_kind, ref_id, legacy_value").all()]);
}

describe("authored inactive reference summary", () => {
  test("all eight site kinds deduplicate physical IDs and rule occurrences; disabled zones remain inert", () => {
    const { db, sqlite } = database(), input = allSites(), before = raw(sqlite), authored = JSON.stringify(input);
    const result = buildNetIdentitySummary(db, DESIGN, schematic(), input), group = result.groups[0]!;
    expect(result).toMatchObject({ mode: "durable", status: "active", orphanedCopperCount: 4, inertRuleReferenceCount: 6, exportBlocked: true });
    expect(group).toMatchObject({ netId: ROOT, netName: "A hint", reason: "unknown", successorNetIds: [], suggestedNetId: null, candidateNetIds: [],
      copper: { traceIds: ["trace"], viaIds: ["via"], freePadIds: ["pad"], zoneIds: ["enabled"] }, disabledZoneIds: ["disabled"] });
    expect(group.rules).toEqual([{ kind: "diffPair", pairId: "pair", member: "n" }, { kind: "diffPair", pairId: "pair", member: "p" },
      { kind: "drcRule", ruleId: "rule", scopeIndex: 0 }, { kind: "drcRule", ruleId: "rule", scopeIndex: 1 }, { kind: "lengthGroup", groupId: "length" }, { kind: "netClassAssignment" }]);
    expect(raw(sqlite)).toBe(before); expect(JSON.stringify(input)).toBe(authored);
  });
  test("disabled-only zones never count or block; a rule-only reference blocks", () => {
    const { db } = database();
    const disabled = source({ zones: [{ id: "zone", enabled: false, netId: ROOT, netName: null }] });
    expect(buildNetIdentitySummary(db, DESIGN, schematic(), disabled)).toMatchObject({ orphanedCopperCount: 0, inertRuleReferenceCount: 0, exportBlocked: false, groups: [{ disabledZoneIds: ["zone"], copper: { zoneIds: [] } }] });
    expect(buildNetIdentitySummary(db, DESIGN, schematic(), source({ board: { perNetClassAssignments: { [ROOT]: "default" } } }))).toMatchObject({ orphanedCopperCount: 0, inertRuleReferenceCount: 1, exportBlocked: true });
  });
  test("active schematic IDs win over old ledger and quarantine; unassigned and blank hints are omitted", () => {
    const { db } = database(); retired(db, 1, [OTHER]); quarantine(db, "trace", "trace", LIVE);
    quarantine(db, "via", "closed", ROOT);
    const input = source({ traces: [{ id: "trace", netId: LIVE, netName: "Old hint" }, { id: "unassigned", netId: null }, { id: "blank", netId: null, netName: "  " }],
      vias: [{ id: "via", netId: "nc:lone" }], zones: [{ id: "disabled", netId: OTHER, netName: null, enabled: false }] });
    expect(buildNetIdentitySummary(db, DESIGN, schematic(), input)).toMatchObject({ groups: [], orphanedCopperCount: 0, inertRuleReferenceCount: 0, exportBlocked: false });
  });
  test("non-null IDs group independently of hints; exact authored name strings stay separate without display binding", () => {
    const { db } = database();
    const input = source({ traces: [{ id: "a", netId: ROOT, netName: "SIGNAL" }, { id: "b", netId: ROOT, netName: "A hint" },
      { id: "c", netId: null, netName: " SIGNAL " }, { id: "d", netId: null, netName: "SIGNAL" }, { id: "blank-id", netId: "", netName: "SIGNAL" }] });
    const result = buildNetIdentitySummary(db, DESIGN, schematic(), input);
    expect(result.groups.map((group) => [group.netId, group.netName, group.reason])).toEqual([["", "SIGNAL", "unknown"], [ROOT, "A hint", "unknown"], [null, " SIGNAL ", "unresolved-name"], [null, "SIGNAL", "unresolved-name"]]);
    expect(result.orphanedCopperCount).toBe(5);
  });
  test("one physical item counts once across groups; a rule site referencing two IDs counts twice", () => {
    const { db } = database(), group = { id: "length", name: "Length", target: { kind: "longest" as const }, toleranceMm: 0 };
    const input = source({ traces: [{ id: "same", netId: ROOT }, { id: "same", netId: "other-root" }], board: { lengthMatchGroups: [{ ...group, netIds: [ROOT, "other-root", ROOT] }] } });
    expect(buildNetIdentitySummary(db, DESIGN, schematic(), input)).toMatchObject({ orphanedCopperCount: 1, inertRuleReferenceCount: 2 });
  });
  test("only own durable and lone IDs from schematic are active; ledger and matching display names cannot activate IDs", () => {
    const { db } = database(), foreign = formatDurableNetId(designNetSalt("foreign"), 1);
    retired(db, 3, [LIVE]);
    const input = source({ traces: [foreign, "pending:0", OLD].map((netId, index) => ({ id: String(index), netId, netName: "SIGNAL" })) });
    expect(buildNetIdentitySummary(db, DESIGN, schematic([net(foreign), net("pending:0")]), input)).toMatchObject({ orphanedCopperCount: 3, groups: expect.arrayContaining([expect.objectContaining({ netId: OLD, successorNetIds: [], suggestedNetId: null })]) });
  });
});

describe("successor proof and quarantine suggestions", () => {
  test.each([
    { name: "chain", rows: [[3, [own(4)]], [4, [LIVE]]], endpoints: [LIVE], suggestion: LIVE },
    { name: "lone-pin successor chain", rows: [[3, ["nc:joined"]]], endpoints: [LIVE], suggestion: LIVE },
    { name: "active lone-pin endpoint", rows: [[3, ["nc:lone"]]], endpoints: ["nc:lone"], suggestion: "nc:lone" },
    { name: "removed without successors", rows: [[3, []]], endpoints: [], suggestion: null },
    { name: "branch", rows: [[3, [OTHER, LIVE]]], endpoints: [LIVE, OTHER], suggestion: null },
    { name: "cycle with active branch", rows: [[3, [own(4), LIVE]], [4, [OLD]]], endpoints: [LIVE], suggestion: null },
    { name: "dead branch", rows: [[3, [LIVE, own(99)]]], endpoints: [LIVE], suggestion: null },
    { name: "self cycle", rows: [[3, [OLD]]], endpoints: [], suggestion: null },
    { name: "shared acyclic endpoint", rows: [[3, [own(4), own(5)]], [4, [LIVE]], [5, [LIVE]]], endpoints: [LIVE], suggestion: LIVE },
  ] satisfies Array<{ name: string; rows: Array<[number, string[]]>; endpoints: string[]; suggestion: string | null }>)("$name resolves active endpoints without guessing", ({ rows, endpoints, suggestion }) => {
    const { db } = database(); for (const [seq, ids] of rows) retired(db, seq, ids);
    const result = buildNetIdentitySummary(db, DESIGN, schematic(), source({ traces: [{ id: "trace", netId: OLD, netName: "Hint" }] }));
    expect(result.groups[0]).toMatchObject({ reason: "retired", netName: "Old name", successorNetIds: endpoints, suggestedNetId: suggestion, candidateNetIds: endpoints });
  });
  test("inactive nc uses current pin membership, never its old display name", () => {
    const { db } = database();
    const input = source({ traces: [{ id: "joined", netId: "nc:joined", netName: "OTHER" }, { id: "gone", netId: "nc:gone", netName: "SIGNAL" }] });
    const groups = buildNetIdentitySummary(db, DESIGN, schematic(), input).groups;
    expect(groups.find((group) => group.netId === "nc:joined")).toMatchObject({ reason: "retired", successorNetIds: [LIVE], suggestedNetId: LIVE });
    expect(groups.find((group) => group.netId === "nc:gone")).toMatchObject({ reason: "retired", successorNetIds: [], suggestedNetId: null });
  });
  test("every storage provenance kind matches exactly, including pair members and scope indexes", () => {
    const { db } = database();
    for (const [kind, id] of [["trace", "trace"], ["via", "via"], ["free_pad", "pad"], ["zone", "enabled"], ["zone", "disabled"],
      ["net_class_assignment", "perNetClassAssignments"], ["length_group", "length"], ["diff_pair", JSON.stringify(["pair", "p"])], ["diff_pair", JSON.stringify(["pair", "n"])],
      ["drc_rule", JSON.stringify(["rule", 0])], ["drc_rule", JSON.stringify(["rule", 1])]] as const) quarantine(db, kind, id);
    expect(buildNetIdentitySummary(db, DESIGN, schematic(), allSites()).groups[0]).toMatchObject({ reason: "legacy-quarantine", successorNetIds: [], candidateNetIds: [LIVE], suggestedNetId: LIVE });
  });
  test.each([
    { name: "one missing occurrence", first: LIVE, second: undefined, suggestion: null },
    { name: "conflicting suggestions", first: LIVE, second: OTHER, suggestion: null },
    { name: "singleton candidates without suggestion", first: null, second: null, suggestion: null },
    { name: "all explicitly agree", first: LIVE, second: LIVE, suggestion: LIVE },
    { name: "inactive suggestion", first: OLD, second: OLD, suggestion: null },
  ])("$name stays conservative", ({ first, second, suggestion }) => {
    const { db } = database(); quarantine(db, "trace", "a", ROOT, [LIVE, OLD], first);
    if (second !== undefined) quarantine(db, "trace", "b", ROOT, [LIVE, OLD], second);
    const input = source({ traces: [{ id: "a", netId: ROOT }, { id: "b", netId: ROOT }] });
    expect(buildNetIdentitySummary(db, DESIGN, schematic(), input).groups[0]).toMatchObject({ reason: "legacy-quarantine", candidateNetIds: [LIVE], suggestedNetId: suggestion });
  });
  test("quarantine keys match exact authored values and sites; closed rows never affect new refs", () => {
    const { db } = database(); quarantine(db, "trace", "trace", "SIGNAL"); quarantine(db, "trace", "closed", ROOT);
    const input = source({ traces: [{ id: "trace", netId: null, netName: " SIGNAL " }, { id: "new", netId: ROOT, netName: "SIGNAL" }] });
    let groups = buildNetIdentitySummary(db, DESIGN, schematic(), input).groups;
    expect(groups.map((group) => group.reason)).toEqual(["unknown", "unresolved-name"]);
    quarantine(db, "trace", "trace", " SIGNAL ");
    groups = buildNetIdentitySummary(db, DESIGN, schematic(), input).groups;
    expect(groups[1]).toMatchObject({ netId: null, netName: " SIGNAL ", reason: "legacy-quarantine", suggestedNetId: LIVE });
  });
  test.each([
    { name: "agreed complete proof", successors: [LIVE], candidate: LIVE, expected: LIVE },
    { name: "disagreeing retirement", successors: [LIVE], candidate: OTHER, expected: null },
    { name: "multiple retirement endpoints", successors: [LIVE, OTHER], candidate: LIVE, expected: null },
    { name: "cycle retirement", successors: [OLD, LIVE], candidate: LIVE, expected: null },
    { name: "unresolved retirement", successors: [own(99), LIVE], candidate: LIVE, expected: null },
  ])("open quarantine cannot override $name", ({ successors, candidate, expected }) => {
    const { db } = database(); retired(db, 3, [...successors]); quarantine(db, "trace", "trace", OLD, [candidate], candidate);
    const group = buildNetIdentitySummary(db, DESIGN, schematic(), source({ traces: [{ id: "trace", netId: OLD }] })).groups[0]!;
    expect(group.reason).toBe("retired"); expect(group.suggestedNetId).toBe(expected);
    expect(group.candidateNetIds).toEqual([...new Set([candidate, ...successors.filter((id) => id === LIVE || id === OTHER)])].sort());
  });
  test("mixed retired group with an unproven occurrence never suggests", () => {
    const { db } = database(); retired(db, 3, [LIVE]); quarantine(db, "trace", "a", OLD);
    const input = source({ traces: [{ id: "a", netId: OLD }, { id: "b", netId: OLD }] });
    expect(buildNetIdentitySummary(db, DESIGN, schematic(), input).groups[0]).toMatchObject({ successorNetIds: [LIVE], candidateNetIds: [LIVE], suggestedNetId: null });
  });
});

describe("summary mode, ordering and failure boundaries", () => {
  const migration: NetIdentityMigrationReport = { schemaVersion: 1, migratorVersion: 1, revisionBefore: 1, revisionAfter: 2, netsAllocated: 0,
    references: { total: 0, bound: { rootAndContact: 0, rootAndPour: 0, contact: 0, nameHint: 0, autoNameHint: 0 }, quarantined: {} }, historiesArchived: 7, boardSettings: "absent" };
  test.each(["migration_failed", "legacy_restored"] as const)("legacy %s exposes valid provenance and no groups", (status) => {
    const initial = state(status); initial.lastError = status === "migration_failed" ? "backup: failed" : null;
    initial.provenance = { ...initial.provenance, origin: "legacy-migration", migration };
    const { db, sqlite } = database(initial), before = raw(sqlite);
    expect(buildNetIdentitySummary(db, DESIGN, schematic(), allSites())).toEqual({ status, mode: "legacy", origin: "legacy-migration", lastError: initial.lastError, historiesArchived: 7,
      groups: [], orphanedCopperCount: 0, inertRuleReferenceCount: 0, exportBlocked: true });
    expect(raw(sqlite)).toBe(before);
  });
  test("absent state is unmigrated and never initialized", () => {
    const { db, sqlite } = database(null), before = raw(sqlite);
    expect(buildNetIdentitySummary(db, DESIGN, schematic(), allSites())).toMatchObject({ status: "unmigrated", mode: "legacy", origin: null, lastError: null, historiesArchived: null, groups: [], exportBlocked: true });
    expect(raw(sqlite)).toBe(before);
  });
  test.each(["state-json", "state-version", "ledger-json", "ledger-id", "quarantine-json", "quarantine-kind"])("corrupt %s fails closed without rewriting raw rows", (kind) => {
    const { db, sqlite } = database(); retired(db, 3, [LIVE]); quarantine(db, "trace", "trace");
    if (kind === "state-json") db.update(netIdentityState).set({ activeJson: "{broken" }).run();
    if (kind === "state-version") db.update(netIdentityState).set({ schemaVersion: 2 }).run();
    if (kind === "ledger-json") db.update(netIdentityRetired).set({ successorIdsJson: "{broken" }).run();
    if (kind === "ledger-id") db.update(netIdentityRetired).set({ netId: "foreign" }).run();
    if (kind === "quarantine-json") db.update(netIdentityQuarantine).set({ candidatesJson: "[null]" }).run();
    if (kind === "quarantine-kind") db.update(netIdentityQuarantine).set({ refKind: "future" }).run();
    const before = raw(sqlite), result = buildNetIdentitySummary(db, DESIGN, schematic(), allSites());
    expect(result).toMatchObject({ status: "unmigrated", mode: "legacy", origin: null, groups: [], exportBlocked: true });
    expect(result.lastError).toBeString(); expect(result.lastError).not.toBe(""); expect(raw(sqlite)).toBe(before);
  });
  test("arbitrary database errors propagate instead of becoming absent identity", () => {
    const { db, sqlite } = database(); sqlite.exec("DROP TABLE designer_net_identity_retired");
    expect(() => buildNetIdentitySummary(db, DESIGN, schematic(), source())).toThrow("no such table");
  });
  test("input permutations give deterministic groups/IDs; returned arrays cannot mutate inputs", () => {
    const { db } = database(), input = allSites();
    input.traces = [...input.traces, ...["ä", "a", "Z"].map((id) => ({ id, netId: ROOT }))];
    const result = buildNetIdentitySummary(db, DESIGN, schematic(), input), original = JSON.stringify(input);
    const permuted = { ...input, traces: [...input.traces].reverse(), zones: [...input.zones].reverse() };
    expect(buildNetIdentitySummary(db, DESIGN, schematic(), permuted)).toEqual(result);
    expect(result.groups[0]!.copper.traceIds).toEqual(["Z", "a", "trace", "ä"]);
    result.groups[0]!.copper.traceIds.push("caller mutation"); result.groups[0]!.rules.length = 0;
    expect(JSON.stringify(input)).toBe(original);
    expect(buildNetIdentitySummary(db, DESIGN, schematic(), input).groups[0]!.rules).toHaveLength(6);
  });
});
