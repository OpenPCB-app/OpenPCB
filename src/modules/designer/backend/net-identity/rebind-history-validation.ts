import { AppError } from "../../../../core/contracts/errors";
import type { RawNetRebindDelta, RawNetRebindFieldDelta, RawNetRebindRowDelta, RawNetRebindSlot } from "./rebind-history-types";

const KEYS: Record<RawNetRebindRowDelta["kind"], readonly string[]> = {
  trace: ["netId", "netName"], via: ["netId", "netName"], free_pad: ["netId", "netName"],
  zone: ["netId", "netName", "enabled"],
  board_settings: ["perNetClassAssignments", "lengthMatchGroups", "diffPairs", "drcRules"],
};

export function rawNetRebindConflict(detail: string): never {
  throw new AppError(detail, 409, "Net rebind history conflict", "https://openpcb.dev/problems/net-rebind-history-conflict",
    { code: "NET_REBIND_HISTORY_CONFLICT" });
}

function requireValid(condition: unknown, detail: string): asserts condition {
  if (!condition) rawNetRebindConflict(detail);
}

function record(value: unknown, path: string): Record<string, unknown> {
  requireValid(value !== null && typeof value === "object" && !Array.isArray(value), `${path} must be a JSON object`);
  const prototype = Object.getPrototypeOf(value);
  requireValid(prototype === null || prototype === Object.prototype, `${path} must be a plain JSON object`);
  return value as Record<string, unknown>;
}

function exact(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  const result = record(value, path), ownKeys = Reflect.ownKeys(result);
  requireValid(ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(result, key)), `${path} has unsupported or missing fields`);
  requireValid(ownKeys.every((key) => typeof key === "string" && keys.includes(key) &&
    Object.getOwnPropertyDescriptor(result, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(result, key)!, "value")),
  `${path} must contain enumerable data fields only`);
  return result;
}

function array(value: unknown, path: string): unknown[] {
  requireValid(Array.isArray(value), `${path} must be an array`);
  requireValid(Object.keys(value).length === value.length && Reflect.ownKeys(value).length === value.length + 1,
    `${path} must not be sparse or contain extra fields`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireValid(descriptor && Object.hasOwn(descriptor, "value"), `${path} must contain data values`);
  }
  return value;
}

function jsonValue(value: unknown, ancestors: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { requireValid(Number.isFinite(value), "Slot values must contain finite JSON numbers"); return; }
  requireValid(typeof value === "object", "Slot values must be strict JSON");
  requireValid(!ancestors.has(value), "Slot values must not contain cycles");
  ancestors.add(value);
  if (Array.isArray(value)) {
    requireValid(Object.keys(value).length === value.length && Reflect.ownKeys(value).length === value.length + 1,
      "Slot arrays must not be sparse or contain extra fields");
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      requireValid(descriptor && Object.hasOwn(descriptor, "value"), "Slot arrays must contain data values");
      jsonValue(descriptor.value, ancestors);
    }
  } else {
    const object = record(value, "Slot value");
    requireValid(Reflect.ownKeys(object).length === Object.keys(object).length, "Slot objects must contain enumerable string keys only");
    for (const key of Object.keys(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
      requireValid(Object.hasOwn(descriptor, "value"), "Slot objects must contain data values");
      jsonValue(descriptor.value, ancestors);
    }
  }
  ancestors.delete(value);
}

export function copyRawNetRebindJson(value: unknown): unknown {
  try {
    jsonValue(value, new Set());
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    return rawNetRebindConflict("Slot value cannot be represented as strict JSON");
  }
}

function text(value: unknown, path: string): asserts value is string {
  requireValid(typeof value === "string" && value.trim().length > 0, `${path} must be a non-blank string`);
}

function slot(value: unknown, path: string): RawNetRebindSlot {
  const fields = record(value, path);
  requireValid(fields.exists === true || fields.exists === false, `${path}.exists must be boolean`);
  const parsed = exact(value, fields.exists ? ["exists", "value"] : ["exists"], path);
  return parsed.exists ? { exists: true, value: copyRawNetRebindJson(parsed.value) } : { exists: false };
}

export function rawNetRebindSlotsEqual(first: RawNetRebindSlot, second: RawNetRebindSlot): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function field(value: unknown, kind: RawNetRebindRowDelta["kind"], seen: Set<string>): RawNetRebindFieldDelta {
  const input = exact(value, ["key", "before", "after"], "Field delta");
  text(input.key, "Field key");
  requireValid(KEYS[kind].includes(input.key) && !seen.has(input.key), "Field key is unsupported or repeated");
  seen.add(input.key);
  const before = slot(input.before, "before"), after = slot(input.after, "after");
  for (const candidate of [before, after]) if (candidate.exists && kind !== "board_settings") {
    requireValid(input.key === "enabled" ? typeof candidate.value === "boolean" :
      candidate.value === null || typeof candidate.value === "string", `Invalid copper ${input.key} slot value`);
    if (input.key === "netId" && typeof candidate.value === "string") text(candidate.value, "Copper net ID");
  }
  requireValid(!rawNetRebindSlotsEqual(before, after), "Field delta must change its slot");
  return { key: input.key, before, after };
}

function row(value: unknown, seenRows: Set<string>, seenPayloads: Set<string>): RawNetRebindRowDelta {
  const input = exact(value, ["rowId", "kind", "payloadId", "fields"], "Row delta");
  text(input.rowId, "Row ID");
  requireValid(!seenRows.has(input.rowId), "Row ID is repeated"); seenRows.add(input.rowId);
  requireValid(typeof input.kind === "string" && Object.hasOwn(KEYS, input.kind), "Row kind is unsupported");
  const kind = input.kind as RawNetRebindRowDelta["kind"];
  if (kind === "board_settings") requireValid(input.payloadId === null, "Board payload ID must be null");
  else {
    text(input.payloadId, "Copper payload ID");
    requireValid(!seenPayloads.has(input.payloadId), "Copper payload ID is repeated across rows"); seenPayloads.add(input.payloadId);
  }
  const entries = array(input.fields, "Row fields");
  requireValid(entries.length > 0, "Row fields must be a nonempty array");
  const seenFields = new Set<string>(), fields = entries.map((entry) => field(entry, kind, seenFields));
  return { rowId: input.rowId, kind, payloadId: input.payloadId as string | null, fields };
}

/** Only the narrow reference carrier is replayable; arbitrary payload patches are refused. */
export function validateRawNetRebindDelta(value: unknown, designId: string): RawNetRebindDelta {
  try {
    text(designId, "Design ID");
    const input = exact(value, ["version", "designId", "rows"], "Raw net rebind delta");
    requireValid(input.version === 1 && input.designId === designId, "Delta version or owning design does not match");
    const seenRows = new Set<string>(), seenPayloads = new Set<string>();
    const rows = array(input.rows, "Delta rows").map((entry) => row(entry, seenRows, seenPayloads));
    requireValid(rows.filter((entry) => entry.kind === "board_settings").length <= 1, "Delta must not contain multiple board rows");
    return { version: 1, designId, rows };
  } catch (error) {
    if (error instanceof AppError) throw error;
    return rawNetRebindConflict("Malformed raw net rebind delta");
  }
}
