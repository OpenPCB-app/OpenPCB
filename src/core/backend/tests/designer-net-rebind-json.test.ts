import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { AppError } from "../../contracts/errors";
import { applyRawNetRebindDelta } from "../../../modules/designer/backend/net-identity/rebind-history";
import type { RawNetRebindDelta } from "../../../modules/designer/backend/net-identity/rebind-history-types";
import { NetRebindJsonError, parseLosslessRebindJson } from "../../../modules/designer/backend/net-identity/rebind-json";
import { pcbEntities } from "../../../modules/designer/backend/schema";
import { getSharedDb } from "../db/sqlite-client";
import { setupRuntimeCleanup } from "./helpers/net-identity-runtime";
import { allDesignerRows, copper, OLD, rawState, readPayload, rebindRuntime, repair, REPAIR_SESSION } from "./helpers/net-rebind-runtime";

setupRuntimeCleanup();

const LOSSY = ["9007199254740993", "-9007199254740993", "0.123456789012345678901", "1.00000000000000000001", "1e-9999", "1e309"];
const EXACT = ["9007199254740992", "-9007199254740992", "1.2300e2", "1e-7", "0", "-0", "-0.000",
  "0e999999999999999999999999999999999999", "1e20", "100000000000000000000", "123000e-3", "0.00000100", "5e-324"];

function rawPayload(rowId: string): string {
  return getSharedDb().select().from(pcbEntities).where(eq(pcbEntities.id, rowId)).get()!.payloadJson;
}

function writeRaw(rowId: string, payloadJson: string): void {
  getSharedDb().update(pcbEntities).set({ payloadJson }).where(eq(pcbEntities.id, rowId)).run();
}

function addNumber(rowId: string, token: string): void {
  const raw = rawPayload(rowId);
  writeRaw(rowId, `${raw.slice(0, -1)},"futureCounter":${token}}`);
}

async function historyConflict(work: () => Promise<unknown>): Promise<void> {
  let caught: unknown;
  try { await work(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(AppError);
  expect(caught as AppError).toMatchObject({ status: 409, extras: { code: "NET_REBIND_HISTORY_CONFLICT" } });
}

describe("reference repair decimal round trips", () => {
  test.each(EXACT)("exact decimal value %s stays accepted", (token) => {
    expect(parseLosslessRebindJson(`{"future":${token}}`)).toEqual(JSON.parse(`{"future":${token}}`));
  });

  test.each(LOSSY)("lossy decimal value %s refuses before normalization", (token) => {
    expect(() => parseLosslessRebindJson(`{"future":${token}}`)).toThrow(NetRebindJsonError);
  });

  test("string tokens, escaped quotes and numeric property names never count as numbers", () => {
    const raw = String.raw`{"text":"escaped quote: \"9007199254740993\" and slash \\1e9999","9007199254740993":"1e-9999"}`;
    expect(parseLosslessRebindJson(raw)).toEqual(JSON.parse(raw));
  });

  test("huge exponents never expand and leading exponent zeros retain exact decimal semantics", () => {
    expect(parseLosslessRebindJson(`{"future":1e+${"0".repeat(10_000)}2}`)).toEqual({ future: 100 });
    expect(parseLosslessRebindJson(`{"future":-0e-${"9".repeat(10_000)}}`)).toEqual({ future: -0 });
    expect(() => parseLosslessRebindJson(`{"future":1e${"9".repeat(10_000)}}`)).toThrow(NetRebindJsonError);
  });

  test("JSON syntax validation remains authoritative", () => {
    for (const raw of ['{"future":01}', '{"future":NaN}', '{"future":1.}', '{"text":"unterminated}']) {
      expect(() => parseLosslessRebindJson(raw)).toThrow(NetRebindJsonError);
    }
  });

  test.each(LOSSY)("planner/store refuses raw %s without writing earlier rows, head or history", async (token) => {
    const runtime = await rebindRuntime();
    copper(runtime, "a"); const late = copper(runtime, "z");
    addNumber(late, token);
    const before = rawState(runtime.designId), authored = rawPayload(late);
    expect(await repair(runtime)).toMatchObject({ ok: false, code: "INVALID_PCB_BOARD_SETTINGS", detail: expect.stringContaining("decimal value cannot be preserved") });
    expect(rawState(runtime.designId)).toBe(before);
    expect(rawPayload(late)).toBe(authored);
  });

  test.each(LOSSY)("raw replay preflights every selected row before writes for %s", async (token) => {
    const runtime = await rebindRuntime();
    const first = copper(runtime, "a"), late = copper(runtime, "z");
    addNumber(late, token);
    const delta: RawNetRebindDelta = { version: 1, designId: runtime.designId, rows: [first, late].map((id) => ({
      rowId: id, kind: "trace", payloadId: id, fields: [{ key: "netId", before: { exists: true, value: OLD }, after: { exists: true, value: runtime.target } }],
    })) };
    const before = allDesignerRows();
    expect(() => applyRawNetRebindDelta(getSharedDb(), runtime.designId, delta, "2026-10-22T00:00:00.000Z")).toThrow(AppError);
    expect(allDesignerRows()).toBe(before);
  });

  test.each(["undo", "redo"] as const)("lossy current row refuses %s without consuming persisted history", async (direction) => {
    const runtime = await rebindRuntime();
    copper(runtime, "a"); const late = copper(runtime, "z");
    expect((await repair(runtime)).ok).toBe(true);
    if (direction === "redo") expect((await runtime.store.undo(runtime.designId, REPAIR_SESSION)).ok).toBe(true);
    addNumber(late, "9007199254740993");
    const before = allDesignerRows();
    await historyConflict(() => runtime.store[direction](runtime.designId, REPAIR_SESSION));
    expect(allDesignerRows()).toBe(before);
  });

  test("selected board row cannot normalize opaque numeric data during repair or replay", async () => {
    const runtime = await rebindRuntime(), db = getSharedDb();
    const boardId = db.select().from(pcbEntities).where(eq(pcbEntities.kind, "board_settings")).get()!.id;
    writeRaw(boardId, `{"perNetClassAssignments":{"${OLD}":"default"},"future":9007199254740993}`);
    const before = rawState(runtime.designId);
    expect((await repair(runtime)).ok).toBe(false);
    expect(rawState(runtime.designId)).toBe(before);
    writeRaw(boardId, `{"perNetClassAssignments":{"${OLD}":"default"},"future":9007199254740992}`);
    const repairedResult = await repair(runtime);
    if (!repairedResult.ok) throw new Error(JSON.stringify({ result: repairedResult, errors: runtime.errors }));
    addNumber(boardId, "1e-9999");
    const repaired = allDesignerRows();
    await historyConflict(() => runtime.store.undo(runtime.designId, REPAIR_SESSION));
    expect(allDesignerRows()).toBe(repaired);
  });

  test("unrelated lossy row stays untouched but still participates in duplicate identity claims", async () => {
    const runtime = await rebindRuntime(), first = copper(runtime, "a"), unrelated = copper(runtime, "b", "another-root");
    expect((await repair(runtime)).ok).toBe(true);
    addNumber(unrelated, "9007199254740993");
    const authored = rawPayload(unrelated);
    expect((await runtime.store.undo(runtime.designId, REPAIR_SESSION)).ok).toBe(true);
    expect((await runtime.store.redo(runtime.designId, REPAIR_SESSION)).ok).toBe(true);
    expect(rawPayload(unrelated)).toBe(authored);
    writeRaw(unrelated, authored.replace('"id":"b"', '"id":"a"'));
    expect(readPayload(first).id).toBe("a");
    const before = allDesignerRows();
    await historyConflict(() => runtime.store.undo(runtime.designId, REPAIR_SESSION));
    expect(allDesignerRows()).toBe(before);
  });

  test("exact large integer, decimal/exponent values and escaped numeric text survive complete history", async () => {
    const runtime = await rebindRuntime(), rowId = copper(runtime, "exact");
    const text = JSON.stringify('escaped quote: "9007199254740993" and \\1e9999');
    writeRaw(rowId, `{"id":"exact","netId":"${OLD}","futureCounter":9007199254740992,"fraction":1.2300e2,"tiny":1e-7,"text":${text}}`);
    const original = readPayload(rowId);
    expect((await repair(runtime)).ok).toBe(true);
    expect(readPayload(rowId)).toEqual({ ...original, netId: runtime.target });
    expect((await runtime.store.undo(runtime.designId, REPAIR_SESSION)).ok).toBe(true);
    expect(readPayload(rowId)).toEqual(original);
    expect((await runtime.store.redo(runtime.designId, REPAIR_SESSION)).ok).toBe(true);
    expect(readPayload(rowId)).toEqual({ ...original, netId: runtime.target });
  });
});
