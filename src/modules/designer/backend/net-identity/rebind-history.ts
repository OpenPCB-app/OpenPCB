import { eq } from "drizzle-orm";
import { serializeRawBoardSettings } from "../pcb/board-settings-serialize";
import { pcbEntities } from "../schema";
import type { NetIdentityDb } from "./state-store";
import type { RawNetRebindDelta, RawNetRebindRowDelta, RawNetRebindSlot } from "./rebind-history-types";
import { NetRebindJsonError, parseLosslessRebindJson } from "./rebind-json";
import {
  copyRawNetRebindJson, rawNetRebindConflict, rawNetRebindSlotsEqual, validateRawNetRebindDelta,
} from "./rebind-history-validation";

export { validateRawNetRebindDelta } from "./rebind-history-validation";

type PcbRow = typeof pcbEntities.$inferSelect;
interface CurrentRows {
  byRowId: Map<string, { row: PcbRow; payload: Record<string, unknown> | null }>;
  copperClaims: Map<string, number>;
  boardCount: number;
}

function payload(row: PcbRow): Record<string, unknown> | null {
  try {
    const value = JSON.parse(row.payloadJson) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function currentSlot(raw: Record<string, unknown>, key: string): RawNetRebindSlot {
  return Object.hasOwn(raw, key) ? { exists: true, value: raw[key] } : { exists: false };
}

function indexRows(rows: readonly PcbRow[]): CurrentRows {
  const result: CurrentRows = { byRowId: new Map(), copperClaims: new Map(), boardCount: 0 };
  for (const row of rows) {
    const raw = payload(row);
    result.byRowId.set(row.id, { row, payload: raw });
    if (row.kind === "board_settings") result.boardCount++;
    if (["trace", "via", "free_pad", "zone"].includes(row.kind) && raw && Object.hasOwn(raw, "id") && typeof raw.id === "string") {
      result.copperClaims.set(raw.id, (result.copperClaims.get(raw.id) ?? 0) + 1);
    }
  }
  return result;
}

function planRow(row: RawNetRebindRowDelta, currentRows: CurrentRows, timestamp: string): { rowId: string; payloadJson: string } {
  const current = currentRows.byRowId.get(row.rowId);
  if (!current || current.row.kind !== row.kind) rawNetRebindConflict(`Raw row ${row.rowId} is absent or its design/kind changed`);
  const parsed = current.payload;
  if (!parsed) rawNetRebindConflict(`Raw row ${row.rowId} has an unreadable object payload`);
  try { parseLosslessRebindJson(current.row.payloadJson); }
  catch (error) {
    if (!(error instanceof NetRebindJsonError)) throw error;
    rawNetRebindConflict(`Raw row ${row.rowId}: ${error.message}`);
  }
  if (row.kind === "board_settings" && currentRows.boardCount !== 1) {
    rawNetRebindConflict("Current board settings row is ambiguous");
  }
  if (row.kind !== "board_settings") {
    if (!Object.hasOwn(parsed, "id") || parsed.id !== row.payloadId || currentRows.copperClaims.get(row.payloadId!) !== 1) {
      rawNetRebindConflict(`Copper payload identity ${row.payloadId} is changed or ambiguous`);
    }
  }
  const next = copyRawNetRebindJson(parsed) as Record<string, unknown>;
  for (const field of row.fields) {
    if (!rawNetRebindSlotsEqual(currentSlot(parsed, field.key), field.before)) {
      rawNetRebindConflict(`Raw row ${row.rowId} field ${field.key} no longer matches its expected slot`);
    }
    if (field.after.exists) next[field.key] = field.after.value;
    else delete next[field.key];
  }
  const payloadJson = row.kind === "board_settings"
    ? serializeRawBoardSettings({ ...next, updatedAt: timestamp }) : JSON.stringify(next);
  return { rowId: row.rowId, payloadJson };
}

/** Field inversion preserves absence, opaque metadata and raw section ordering. */
export function invertRawNetRebindDelta(delta: RawNetRebindDelta): RawNetRebindDelta {
  const validated = validateRawNetRebindDelta(delta, delta?.designId);
  return { ...validated, rows: validated.rows.map((row) => ({
    ...row, fields: row.fields.map((field) => ({ key: field.key, before: field.after, after: field.before })),
  })) };
}

/** Preflight all rows before writing; the caller owns transaction and history lifetime. */
export function applyRawNetRebindDelta(db: NetIdentityDb, designId: string, value: unknown, timestamp: string): void {
  const delta = validateRawNetRebindDelta(value, designId);
  if (typeof timestamp !== "string" || !timestamp.trim()) rawNetRebindConflict("Repair timestamp must be a non-blank string");
  if (delta.rows.length === 0) return;
  const current = indexRows(db.select().from(pcbEntities).where(eq(pcbEntities.designId, designId)).all());
  const plans = delta.rows.map((row) => planRow(row, current, timestamp));
  for (const plan of plans) db.update(pcbEntities).set({ payloadJson: plan.payloadJson, updatedAt: timestamp })
    .where(eq(pcbEntities.id, plan.rowId)).run();
}
