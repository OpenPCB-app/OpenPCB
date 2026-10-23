import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { DesignerCommand, NetRebindReceipt } from "../../../sdks/designer";
import { parseDispatchResultJson } from "../../../modules/designer/backend/results";
import { parseNetRebindReceipt } from "../../../modules/designer/backend/net-identity/rebind-result-parse";
import { writeNetIdentityState } from "../../../modules/designer/backend/net-identity/state-store";
import { netIdentityState, pcbEntities } from "../../../modules/designer/backend/schema";
import { getSharedDb, getSharedSqlite } from "../db/sqlite-client";
import { body, identityState, placed, setupRuntimeCleanup } from "./helpers/net-identity-runtime";
import { command, copper, fullReferences, identityRows, OLD, rawState, readPayload, rebindRuntime, repair, REPAIR_SESSION } from "./helpers/net-rebind-runtime";

setupRuntimeCleanup();

const zero: NetRebindReceipt = { traces: 0, vias: 0, zones: 0, freePads: 0, assignments: 0,
  lengthGroups: 0, diffPairs: 0, drcRules: 0, removedRules: [], removedDiffPairs: [], removedLengthGroups: [], disabledZones: [] };

describe("native raw net reference repair", () => {
  test("all eight sites repair together with exact receipts, preserved provenance, removals and disabled zones", async () => {
    const runtime = await rebindRuntime(), rows = fullReferences(runtime), identity = identityRows(runtime.designId);
    expect(await repair(runtime)).toMatchObject({ ok: true, netRebind: { traces: 2, vias: 1, freePads: 1, zones: 3,
      assignments: 2, lengthGroups: 2, diffPairs: 2, drcRules: 2, removedRules: ["drop-rule"], removedDiffPairs: ["drop-pair"],
      removedLengthGroups: ["drop-length"], disabledZones: ["clear-zone"] } });
    for (const id of [rows.trace, rows.via, rows.pad, rows.zone, rows.disabled, rows.hinted]) expect(readPayload(id).netId).toBe(runtime.target);
    expect(readPayload(rows.trace)).toMatchObject({ netName: "Provenance", future: { keep: [1, 2] } });
    expect(readPayload(rows.pad).netName).toBe("Pad hint");
    expect(readPayload(rows.hinted).netName).toBe(" Exact Hint ");
    expect(readPayload(rows.unmatched).netId).toBeNull();
    expect(readPayload(rows.disabled).enabled).toBe(false);
    expect(readPayload(rows.cleared)).toMatchObject({ netId: null, netName: null, enabled: false, future: "clear" });
    expect(readPayload(rows.board)).toMatchObject({ perNetClassAssignments: { [runtime.target]: "destination-class" },
      drcRules: [{ id: "keep-rule", scopes: [{ kind: "net", netIds: [runtime.target], vendor: { keep: 7 } }], future: "rule" }, 13] });
    expect(identityRows(runtime.designId)).toBe(identity);
    expect(await runtime.store.getHistory(runtime.designId, REPAIR_SESSION)).toMatchObject({ undoDepth: 1 });
  });

  test("unmatched source bumps revision once with no PCB defaults/history; idempotency replays exact receipt before ensure", async () => {
    const runtime = await rebindRuntime(), beforeRows = getSharedDb().select().from(pcbEntities).all();
    const envelope = body(runtime.designId, command(runtime), REPAIR_SESSION);
    const result = await runtime.store.dispatchCommand(runtime.designId, envelope);
    expect(result).toMatchObject({ ok: true, revision: envelope.baseRevision! + 1, netRebind: zero });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(getSharedDb().select().from(pcbEntities).all()).toEqual(beforeRows);
    expect(await runtime.store.getHistory(runtime.designId, REPAIR_SESSION)).toMatchObject({ undoDepth: 0 });
    getSharedDb().delete(netIdentityState).where(eq(netIdentityState.designId, runtime.designId)).run();
    const prior = rawState(runtime.designId);
    expect(await runtime.store.dispatchCommand(runtime.designId, envelope)).toEqual({ ...result, idempotent: true });
    expect(rawState(runtime.designId)).toBe(prior);
  });

  test("inactive nc and foreign sources repair to current nc target or null", async () => {
    const runtime = await rebindRuntime(), part = await placed(runtime, runtime.designId, 0, 0), target = `nc:${part.pinId}`;
    const oldNc = copper(runtime, "inactive-nc", "nc:missing-pin"), foreign = copper(runtime, "foreign", "net:aaaaaaaaaa:5");
    expect(await repair(runtime, { type: "pcb_rebind_net_references", bindings: [
      { fromNetId: "nc:missing-pin", toNetId: target }, { fromNetId: "net:aaaaaaaaaa:5", toNetId: null },
    ] })).toMatchObject({ ok: true, netRebind: { traces: 2 } });
    expect(readPayload(oldNc).netId).toBe(target);
    expect(readPayload(foreign)).toMatchObject({ netId: null, netName: null });
  });

  test.each(["migration_failed", "legacy_restored"] as const)("%s refuses before adding PCB defaults", async (status) => {
    const runtime = await rebindRuntime();
    writeNetIdentityState(getSharedDb(), { ...identityState(runtime.designId), status, active: [], lastError: "blocked" });
    const before = rawState(runtime.designId);
    expect(await repair(runtime)).toMatchObject({ ok: false, code: "INVALID_PCB_BOARD_SETTINGS", detail: expect.stringContaining("Retry net identity migration") });
    expect(rawState(runtime.designId)).toBe(before);
  });

  test("active durable and lone-pin sources, bad targets and malformed entries refuse before writes", async () => {
    const runtime = await rebindRuntime(), part = await placed(runtime, runtime.designId, 0, 0);
    copper(runtime, "source");
    const invalid: unknown[] = [[], null, [{ fromNetId: runtime.target, toNetId: null }], [{ fromNetId: `nc:${part.pinId}`, toNetId: null }],
      [{ fromNetId: OLD, toNetId: "unknown" }], [{ fromNetId: " ", toNetId: null }], [{ fromNetId: OLD }], [null]];
    for (const bindings of invalid) {
      const before = rawState(runtime.designId);
      const result = await repair(runtime, { type: "pcb_rebind_net_references", bindings } as DesignerCommand);
      expect(result.ok).toBe(false);
      expect(rawState(runtime.designId)).toBe(before);
    }
  });

  test("batch refuses repair before executing an earlier ordinary step", async () => {
    const runtime = await rebindRuntime(), before = rawState(runtime.designId);
    const batch = { type: "batch_commands", commands: [{ type: "pcb_add_free_hole", centerMm: { x: 4, y: 4 }, drillMm: 1 }, command(runtime)] } as unknown as DesignerCommand;
    expect((await repair(runtime, batch)).ok).toBe(false);
    expect(rawState(runtime.designId)).toBe(before);
  });

  test("mid-apply database failure rolls back PCB rows, head, identity, command log and history", async () => {
    const runtime = await rebindRuntime();
    copper(runtime, "one"); copper(runtime, "two");
    const sql = getSharedSqlite();
    sql.exec("CREATE TEMP TABLE update_counter (value INTEGER); INSERT INTO update_counter VALUES (0)");
    sql.exec("CREATE TEMP TRIGGER fail_rebind BEFORE UPDATE ON designer_pcb_entities BEGIN UPDATE update_counter SET value = value + 1; SELECT CASE WHEN (SELECT value FROM update_counter) = 2 THEN RAISE(ABORT, 'mid-apply failure') END; END");
    const before = rawState(runtime.designId, ["design_heads", "pcb_entities", "session_histories", "net_identity_state", "net_identity_retired", "command_log"]);
    expect((await repair(runtime)).ok).toBe(false);
    expect(rawState(runtime.designId, ["design_heads", "pcb_entities", "session_histories", "net_identity_state", "net_identity_retired", "command_log"])).toBe(before);
    expect(JSON.stringify(runtime.errors)).toContain("mid-apply failure");
  });
});

describe("stored repair receipts", () => {
  const result = { ok: true as const, revision: 9, createdEntityId: null, legality: { refused: 0, warnings: 2 } };
  test("direct receipt parser rejects sparse arrays and nonfinite counts", () => {
    expect(parseNetRebindReceipt({ ...zero, removedRules: Array(1), drcRules: 1 })).toBeNull();
    expect(parseNetRebindReceipt({ ...zero, traces: Number.NaN })).toBeNull();
    expect(parseNetRebindReceipt({ ...zero, vias: Number.POSITIVE_INFINITY })).toBeNull();
  });
  test("exact counts/order replay with independent cloned arrays and unknown fields stripped", () => {
    const receipt = { ...zero, traces: 1, zones: 2, drcRules: 2, removedRules: ["z", "a"], disabledZones: ["off"], extra: true };
    const parsed = parseNetRebindReceipt(receipt)!;
    expect(parsed).toEqual({ ...zero, traces: 1, zones: 2, drcRules: 2, removedRules: ["z", "a"], disabledZones: ["off"] });
    receipt.removedRules.push("later");
    expect(parsed.removedRules).toEqual(["z", "a"]);
    expect(parseDispatchResultJson(JSON.stringify({ ...result, netRebind: parsed }))).toEqual({ ...result, idempotent: true, netRebind: parsed });
    expect(parseDispatchResultJson(JSON.stringify(result))).toEqual({ ...result, idempotent: true });
  });
  test.each([null, {}, { ...zero, traces: -1 }, { ...zero, vias: 0.5 }, { ...zero, zones: Number.MAX_SAFE_INTEGER + 1 },
    { ...zero, removedRules: ["missing-count"] }, { ...zero, zones: 1, disabledZones: ["dup", "dup"] },
    { ...zero, drcRules: 1, removedRules: [" "] }, { ...zero, removedDiffPairs: "pair" }].map((receipt) => ({ receipt })))(
    "malformed receipt drops entire stored success %j", ({ receipt }) => {
      expect(parseDispatchResultJson(JSON.stringify({ ...result, netRebind: receipt }))).toBeNull();
    });
});
