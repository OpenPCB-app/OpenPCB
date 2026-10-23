import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { DesignerCommand, DesignerDerivedNet, DesignerPcbAddTraceCommand, DesignerPcbAddViaCommand, DesignerPcbCandidateRouteOperation, DesignerSchematicProjection, PcbBoardSettings } from "../../../sdks/designer";
import { normalizeCommandNetReferences } from "../../../modules/designer/backend/net-identity/command-references";
import { writeNetIdentityRetired, type NetIdentityDb } from "../../../modules/designer/backend/net-identity/state-store";
import { designNetSalt, formatDurableNetId } from "../../../modules/designer/backend/net-identity/types";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import { parseDispatchResultJson } from "../../../modules/designer/backend/results";
import { pcbEntities } from "../../../modules/designer/backend/schema";

const DESIGN = "boundary-design", TS = "2026-10-22T12:00:00.000Z";
const own = (seq: number) => formatDurableNetId(designNetSalt(DESIGN), seq);
const LIVE = own(1), OTHER = own(2), RETIRED = own(3), UNKNOWN = own(4);
const FOREIGN = formatDurableNetId(designNetSalt("other-design"), 1);
const opened: Database[] = [];
afterEach(() => { for (const sqlite of opened.splice(0)) sqlite.close(); });

function database(): { db: NetIdentityDb; sqlite: Database } {
  const sqlite = new Database(":memory:");
  opened.push(sqlite);
  const dir = new URL("../../../modules/designer/backend/migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(new URL(name, dir), "utf8").split("--> statement-breakpoint")) sqlite.exec(statement);
  }
  const db = drizzle(sqlite) as unknown as NetIdentityDb;
  writeNetIdentityRetired(db, { designId: DESIGN, netId: RETIRED, seq: 3, reason: "split",
    successorIds: [OTHER, "nc:split-pin"], displayName: "Old", retiredAtRevision: 7, createdAt: TS, updatedAt: TS });
  return { db, sqlite };
}

function net(id: string, name: string, extra: Partial<DesignerDerivedNet> = {}): DesignerDerivedNet {
  return { id, name, pinIds: [], wireIds: [], labelIds: [], primitiveIds: [], ...extra };
}
function projection(nets = [net(LIVE, "SIGNAL", { pinIds: ["joined"] }), net(OTHER, "Net_2", { autoNamed: true }), net("nc:lone", "unconnected-(U1-1)")]): DesignerSchematicProjection {
  return { designId: DESIGN, revision: 8, parts: [], wires: [], labels: [], primitives: [], junctions: [], nets };
}
function trace(netId: string | null): DesignerPcbAddTraceCommand {
  return { type: "pcb_add_trace", layer: "F.Cu", pointsNm: [{ x: 0, y: 0 }, { x: 1_000_000, y: 0 }], widthMm: 0.2, netId, netClassId: "default", segmentMode: "manhattan-45" };
}
function via(netId: string | null): DesignerPcbAddViaCommand {
  return { type: "pcb_add_via", centerMm: { x: 1, y: 1 }, netId, netClassId: "default" };
}
function autolayout(routeOperations: DesignerPcbCandidateRouteOperation[]): DesignerCommand {
  return { type: "pcb_apply_autolayout_candidate", jobId: "job", candidateId: "candidate", snapshotDigest: "digest", placementOperations: [], routeOperations, provenance: {} };
}
function zone(netId: string | null, netName: string | null): DesignerCommand {
  return { type: "pcb_add_zone", layer: "F.Cu", region: { kind: "board" }, net: { netId, netName }, enabled: false };
}
function normalize(db: NetIdentityDb, command: DesignerCommand, schematic = projection(), mode: "legacy" | "durable" = "durable") {
  return normalizeCommandNetReferences({ tx: db, command, projection: schematic, mode, designId: DESIGN });
}
function raw(sqlite: Database): string {
  return JSON.stringify([sqlite.query("SELECT * FROM designer_pcb_entities ORDER BY id").all(),
    sqlite.query("SELECT * FROM designer_net_identity_retired ORDER BY net_id").all()]);
}
function stored(db: NetIdentityDb, kind: string, payload: unknown, id = kind): void {
  db.insert(pcbEntities).values({ id, designId: DESIGN, kind, payloadJson: JSON.stringify(payload), createdAt: TS, updatedAt: TS }).run();
}
function rules(): PcbBoardSettings {
  return { ...createDefaultPcbBoardSettings(TS), perNetClassAssignments: { [RETIRED]: "default" },
    lengthMatchGroups: [{ id: "group:|", name: "Group", netIds: [RETIRED, LIVE], target: { kind: "longest" }, toleranceMm: 0 }],
    diffPairs: [{ id: "pair:|", name: "Pair", pNetId: RETIRED, nNetId: LIVE }],
    drcRules: [{ id: "rule:|", name: "Rule", enabled: true, priority: 1,
      scopes: [{ kind: "net", netIds: [RETIRED] }, { kind: "net", netIds: [LIVE] }], constraint: { kind: "clearance", mm: 0.5 } }] };
}

describe("command net-reference IDs", () => {
  test.each([
    ["pending:anything", "pending", []], [FOREIGN, "foreign-design", []],
    [RETIRED, "retired", [OTHER, "nc:split-pin"]], [UNKNOWN, "unknown", []],
    ["nc:joined", "retired", [LIVE]], ["nc:gone", "retired", []],
    ["pt:0:0", "foreign", []], ["", "foreign", []], ["net:bad:1", "foreign", []],
  ] as const)("%s produces %s with exact successors", (netId, reason, successorIds) => {
    const { db, sqlite } = database(), before = raw(sqlite), command = trace(netId);
    const result = normalize(db, command);
    expect(result).toMatchObject({ ok: false, result: { code: "NET_REFERENCE_DANGLING", field: "netId", netId, reason, successorIds } });
    expect(command.netId).toBe(netId); expect(raw(sqlite)).toBe(before);
  });

  test.each([null, LIVE, "nc:lone"])("active or null %s passes unchanged without DB access", (netId) => {
    const command = trace(netId);
    const forbidden = new Proxy({}, { get: () => { throw new Error("unexpected database access"); } }) as NetIdentityDb;
    expect(normalize(forbidden, command)).toEqual({ ok: true, command });
    const result = normalize(forbidden, command);
    expect(result.ok && result.command).toBe(command);
  });

  test("foreign and pending projection entries are never persistable active IDs", () => {
    const { db } = database();
    const schematic = projection([net(FOREIGN, "Foreign"), net("pending:0", "New")]);
    expect(normalize(db, trace(FOREIGN), schematic)).toMatchObject({ ok: false, result: { reason: "foreign-design" } });
    expect(normalize(db, trace("pending:0"), schematic)).toMatchObject({ ok: false, result: { reason: "pending" } });
  });

  test("legacy and durable non-reference commands access no database", () => {
    const forbidden = new Proxy({}, { get: () => { throw new Error("unexpected database access"); } }) as NetIdentityDb;
    for (const command of [trace(RETIRED), zone(null, "missing"), { type: "pcb_set_design_rules", perNetClassAssignments: { stale: "default" } }] satisfies DesignerCommand[]) {
      const result = normalize(forbidden, command, projection(), "legacy");
      expect(result.ok && result.command).toBe(command);
    }
    const command: DesignerCommand = { type: "pcb_delete_trace", traceId: "trace" };
    const result = normalize(forbidden, command);
    expect(result.ok && result.command).toBe(command);
  });
});

describe("all copper command reference paths", () => {
  const pair = (p: string | null, n: string | null): DesignerPcbCandidateRouteOperation => ({ type: "pcb_add_trace_via", trace: trace(p), via: via(n) });
  const cases: [string, DesignerCommand][] = [
    ["netId", trace(RETIRED)], ["netId", via(RETIRED)],
    ["netId", { ...via(RETIRED), type: "pcb_add_manual_via" }],
    ["trace.netId", pair(RETIRED, LIVE)], ["via.netId", pair(LIVE, RETIRED)],
    ["traces[1].netId", { type: "pcb_commit_route", traces: [trace(LIVE), trace(RETIRED)], vias: [via(LIVE)] }],
    ["vias[1].netId", { type: "pcb_commit_route", traces: [trace(LIVE)], vias: [via(LIVE), via(RETIRED)] }],
    ["routeOperations[1].netId", autolayout([trace(LIVE), trace(RETIRED)])],
    ["routeOperations[1].netId", autolayout([trace(LIVE), via(RETIRED)])],
    ["routeOperations[1].trace.netId", autolayout([via(LIVE), pair(RETIRED, LIVE)])],
    ["routeOperations[1].via.netId", autolayout([via(LIVE), pair(LIVE, RETIRED)])],
    ["netId", { type: "pcb_add_free_pad", centerMm: { x: 0, y: 0 }, rotationDeg: 0, padType: "smd", shape: "circle", widthMm: 1, heightMm: 1, layer: "F.Cu", netId: RETIRED }],
    ["netId", { type: "pcb_update_free_pad", freePadId: "pad", netId: RETIRED }],
  ];
  test.each(cases)("%s is checked in each copper command shape", (field, command) => {
    const { db } = database(), before = JSON.stringify(command);
    expect(normalize(db, command)).toMatchObject({ ok: false, result: { field, netId: RETIRED, reason: "retired" } });
    expect(JSON.stringify(command)).toBe(before);
  });
  test("omitted free-pad net and null route references remain unchanged", () => {
    const { db } = database();
    for (const command of [{ type: "pcb_update_free_pad", freePadId: "pad" },
      { type: "pcb_commit_route", traces: [trace(null)], vias: [via(null)] },
      autolayout([pair(null, null)])] satisfies DesignerCommand[]) {
      const result = normalize(db, command);
      expect(result.ok && result.command).toBe(command);
    }
  });
});

describe("zone boundary resolution", () => {
  test.each([[" signal ", LIVE], [" net_2 ", OTHER], ["unconnected-(U1-1)", "nc:lone"]])("display name %s resolves once", (name, id) => {
    const { db, sqlite } = database(), command = zone(null, name), before = raw(sqlite);
    expect(normalize(db, command)).toMatchObject({ ok: true, command: { enabled: false, net: { netId: id, netName: null } } });
    expect(command).toMatchObject({ net: { netId: null, netName: name } }); expect(raw(sqlite)).toBe(before);
  });
  test("nonnull ID precedes hint; null/blank clears both fields", () => {
    const { db } = database();
    expect(normalize(db, zone(LIVE, "unknown"))).toMatchObject({ ok: true, command: { net: { netId: LIVE, netName: null } } });
    expect(normalize(db, zone(RETIRED, "SIGNAL"))).toMatchObject({ ok: false, result: { field: "net.netId", netId: RETIRED } });
    for (const name of [null, "", "  "]) expect(normalize(db, zone(null, name))).toMatchObject({ ok: true, command: { net: { netId: null, netName: null } } });
  });
  test("override spelling wins and matching pending name is refused", () => {
    const { db } = database(), schematic = projection([net(LIVE, "User override"), net("pending:5", "Net_pending_5", { autoNamed: true })]);
    expect(normalize(db, zone(null, " user OVERRIDE "), schematic)).toMatchObject({ ok: true, command: { net: { netId: LIVE, netName: null } } });
    expect(normalize(db, zone(null, "Net_pending_5"), schematic)).toMatchObject({ ok: false, result: { reason: "pending", netId: "pending:5", netName: "Net_pending_5" } });
  });
  test("unknown and ambiguous names preserve authored hint with codeunit-sorted candidates", () => {
    const { db } = database(), schematic = projection([net(OTHER, " Same "), net(LIVE, "same")]);
    expect(normalize(db, zone(null, " Missing "), schematic)).toMatchObject({ ok: false, result: { code: "NET_REFERENCE_DANGLING", field: "net.netName", netId: null, netName: " Missing ", reason: "unknown-name", successorIds: [] } });
    expect(normalize(db, zone(null, " sAME "), schematic)).toMatchObject({ ok: false, result: { code: "NET_REFERENCE_AMBIGUOUS", field: "net.netName", netName: " sAME ", candidates: [LIVE, OTHER].sort() } });
  });
  test("enabling disabled zone checks omitted effective reference and keeps other fields", () => {
    const { db, sqlite } = database();
    stored(db, "zone", { id: "zone", layer: "F.Cu", region: { kind: "board" }, enabled: false, netId: RETIRED, netName: "SIGNAL" });
    const command: DesignerCommand = { type: "pcb_update_zone", zoneId: "zone", enabled: true, name: "Updated" }, before = raw(sqlite);
    expect(normalize(db, command)).toMatchObject({ ok: false, result: { reason: "retired", netId: RETIRED } });
    expect(raw(sqlite)).toBe(before); expect(command).not.toHaveProperty("net");
    stored(db, "zone", { id: "hint", layer: "F.Cu", region: { kind: "board" }, enabled: false, netId: null, netName: " SIGNAL " }, "hint-row");
    expect(normalize(db, { ...command, zoneId: "hint" })).toMatchObject({ ok: true, command: { zoneId: "hint", enabled: true, name: "Updated", net: { netId: LIVE, netName: null } } });
    expect(normalize(db, { ...command, zoneId: "missing" })).toEqual({ ok: true, command: { ...command, zoneId: "missing" } });
  });
  test("disabling and unrelated edits do not read or revalidate omitted references", () => {
    const forbidden = new Proxy({}, { get: () => { throw new Error("unexpected database access"); } }) as NetIdentityDb;
    for (const command of [{ type: "pcb_update_zone", zoneId: "stale", enabled: false },
      { type: "pcb_update_zone", zoneId: "stale", name: "Rename" }] satisfies DesignerCommand[]) {
      expect(normalize(forbidden, command)).toEqual({ ok: true, command });
    }
  });
  test("enabling an already enabled zone does not introduce its existing reference again", () => {
    const { db } = database();
    stored(db, "zone", { id: "zone", layer: "F.Cu", region: { kind: "board" }, enabled: true, netId: RETIRED });
    const command: DesignerCommand = { type: "pcb_update_zone", zoneId: "zone", enabled: true };
    const result = normalize(db, command); expect(result.ok && result.command).toBe(command);
  });
});

describe("rule references compare declaration owner and exact ID", () => {
  test("same stale refs may be saved and scope order changed; removed refs need no validation", () => {
    const { db, sqlite } = database(), board = rules(); stored(db, "board_settings", board);
    const before = raw(sqlite);
    for (const command of [{ type: "pcb_set_design_rules", perNetClassAssignments: board.perNetClassAssignments, lengthMatchGroups: board.lengthMatchGroups, diffPairs: board.diffPairs, drcRules: [{ ...board.drcRules![0]!, scopes: [...board.drcRules![0]!.scopes].reverse() }] },
      { type: "pcb_set_design_rules", perNetClassAssignments: {}, lengthMatchGroups: [], diffPairs: [], drcRules: [] }] satisfies DesignerCommand[]) {
      const result = normalize(db, command); expect(result.ok && result.command).toBe(command);
    }
    expect(raw(sqlite)).toBe(before);
  });
  test.each(["length", "pair", "member", "rule", "assignment"])("new %s owner cannot copy stale reference", (kind) => {
    const { db, sqlite } = database(), board = rules(); stored(db, "board_settings", board);
    const command: DesignerCommand = kind === "length" ? { type: "pcb_set_design_rules", lengthMatchGroups: [{ ...board.lengthMatchGroups![0]!, id: "copy" }] } :
      kind === "pair" ? { type: "pcb_set_design_rules", diffPairs: [{ ...board.diffPairs![0]!, id: "copy" }] } :
      kind === "member" ? { type: "pcb_set_design_rules", diffPairs: [{ ...board.diffPairs![0]!, pNetId: LIVE, nNetId: RETIRED }] } :
      kind === "rule" ? { type: "pcb_set_design_rules", drcRules: [{ ...board.drcRules![0]!, id: "copy" }] } :
      { type: "pcb_set_design_rules", perNetClassAssignments: { [UNKNOWN]: "default" } };
    const before = raw(sqlite), authored = JSON.stringify(command);
    const field = kind === "length" ? "lengthMatchGroups[0].netIds[0]" : kind === "pair" ? "diffPairs[0].pNetId" :
      kind === "member" ? "diffPairs[0].nNetId" : kind === "rule" ? "drcRules[0].scopes[0].netIds[0]" : `perNetClassAssignments[${JSON.stringify(UNKNOWN)}]`;
    expect(normalize(db, command)).toMatchObject({ ok: false, result: { code: "NET_REFERENCE_DANGLING", netId: kind === "assignment" ? UNKNOWN : RETIRED, field } });
    expect(raw(sqlite)).toBe(before); expect(JSON.stringify(command)).toBe(authored);
  });
  test("absent and malformed board rows do not create or repair defaults", () => {
    const { db, sqlite } = database();
    for (const malformed of [false, true]) {
      if (malformed) stored(db, "board_settings", { outline: false, future: "retain" });
      const before = raw(sqlite);
      expect(normalize(db, { type: "pcb_set_design_rules", perNetClassAssignments: { [LIVE]: "default" } })).toMatchObject({ ok: true });
      expect(raw(sqlite)).toBe(before);
    }
  });
  test("malformed sections and rows pass intact to strict validator without TypeError", () => {
    const { db } = database();
    const malformed: unknown[] = [null, 7, "future", {}, [null, 7, "future", {}, { id: 7 }, { id: "bad", netIds: null, scopes: [null, { kind: "net", netIds: false }] }]];
    for (const field of ["perNetClassAssignments", "lengthMatchGroups", "diffPairs", "drcRules"]) for (const value of malformed) {
      const command = { type: "pcb_set_design_rules", [field]: value } as unknown as DesignerCommand;
      const before = JSON.stringify(command), result = normalize(db, command);
      expect(result.ok && result.command).toBe(command); expect(JSON.stringify(command)).toBe(before);
    }
  });
  test("invalid SI declarations retain structural validation priority over reference errors", () => {
    const { db, sqlite } = database(), before = raw(sqlite);
    const commands: DesignerCommand[] = [
      { type: "pcb_set_design_rules", lengthMatchGroups: [{ id: "blank", name: "Blank", netIds: [LIVE, "  "], target: { kind: "longest" }, toleranceMm: 0 }] },
      { type: "pcb_set_design_rules", diffPairs: [{ id: "blank", name: "Blank", pNetId: "", nNetId: LIVE }] },
      { type: "pcb_set_design_rules", diffPairs: [{ id: "self", name: "Self", pNetId: UNKNOWN, nNetId: UNKNOWN }] },
    ];
    for (const command of commands) {
      const result = normalize(db, command);
      expect(result.ok && result.command).toBe(command);
    }
    expect(raw(sqlite)).toBe(before);
  });
  test("canonical recovered settings retain same-owner stale declarations beside malformed outline", () => {
    const { db, sqlite } = database(), board = rules();
    stored(db, "board_settings", { ...board, outline: false, unknown: { retained: true } });
    const before = raw(sqlite), command: DesignerCommand = { type: "pcb_set_design_rules", lengthMatchGroups: board.lengthMatchGroups, diffPairs: board.diffPairs, drcRules: board.drcRules };
    const result = normalize(db, command); expect(result.ok && result.command).toBe(command); expect(raw(sqlite)).toBe(before);
  });
  test("only supplied sections are checked and exact owner separators do not collide", () => {
    const { db } = database(), board = rules(); stored(db, "board_settings", board);
    expect(normalize(db, { type: "pcb_set_design_rules", boardThicknessMm: 2 })).toMatchObject({ ok: true });
    expect(normalize(db, { type: "pcb_set_design_rules", lengthMatchGroups: [{ ...board.lengthMatchGroups![0]!, id: 'group:|","' }] })).toMatchObject({ ok: false, result: { field: "lengthMatchGroups[0].netIds[0]" } });
  });
});

describe("command-log boundary failure parsing", () => {
  test("both failure variants roundtrip exactly", () => {
    const { db } = database();
    for (const result of [normalize(db, trace(RETIRED)), normalize(db, zone(null, " same "), projection([net(LIVE, "Same"), net(OTHER, "SAME")]))]) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected refusal");
      expect(parseDispatchResultJson(JSON.stringify(result.result))).toEqual(result.result);
    }
  });
  test.each(["unknown", "retired", "pending", "foreign", "foreign-design", "unknown-name"])("dangling reason %s and original optional name survive retries", (reason) => {
    const result = { ok: false as const, code: "NET_REFERENCE_DANGLING" as const, field: "net.netName", netId: null, netName: " Authored ", reason, successorIds: [], detail: "Cannot bind" };
    const parsed = parseDispatchResultJson(JSON.stringify(result));
    expect(parsed).toEqual(result); expect(parseDispatchResultJson(JSON.stringify(parsed))).toEqual(result);
  });
  test("malformed reasons, fields, nullable IDs and arrays are refused", () => {
    const dangling = { ok: false, code: "NET_REFERENCE_DANGLING", field: "netId", netId: null, reason: "unknown", successorIds: [], detail: "Missing" };
    const ambiguous = { ok: false, code: "NET_REFERENCE_AMBIGUOUS", field: "net.netName", netName: "X", candidates: [LIVE, OTHER], detail: "Several" };
    const invalid = [{ ...dangling, reason: "new-reason" }, { ...dangling, netId: 1 }, { ...dangling, netId: undefined },
      { ...dangling, netName: null }, { ...dangling, successorIds: [1] }, { ...dangling, successorIds: {} },
      { ...dangling, field: null }, { ...dangling, detail: "" }, { ...dangling, ok: "false" },
      { ...ambiguous, netName: null }, { ...ambiguous, candidates: [false] }, { ...ambiguous, candidates: undefined }];
    for (const result of invalid) expect(parseDispatchResultJson(JSON.stringify(result))).toBeNull();
  });
});
