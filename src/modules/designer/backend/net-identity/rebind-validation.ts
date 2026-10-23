import type { DesignerDispatchResult } from "../../../../sdks";
import { AppError } from "../../../../core/contracts/errors";
import type { NetReferenceJudge } from "./command-reference-id";
import type { RawNetRebindFieldDelta } from "./rebind-history-types";
import { copyRawNetRebindJson } from "./rebind-history-validation";
import { NetRebindJsonError, parseLosslessRebindJson } from "./rebind-json";

type Failure = Extract<DesignerDispatchResult, { ok: false }>;
export interface RebindIndex {
  ids: ReadonlyMap<string, string | null>;
  names: ReadonlyMap<string, string | null>;
}

export class NetRebindPlanRefused extends Error {
  constructor(readonly result: Failure) { super("detail" in result ? result.detail : result.code); }
}

export function requireRebind(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new NetRebindPlanRefused({ ok: false, code: "INVALID_PCB_BOARD_SETTINGS", detail });
}

export const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
export const nonblank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
export const same = (first: unknown, second: unknown): boolean => JSON.stringify(first) === JSON.stringify(second);

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function rawPayload(payload: string, path: string): Record<string, unknown> {
  let value: unknown;
  try { value = parseLosslessRebindJson(payload); }
  catch (error) {
    if (!(error instanceof NetRebindJsonError)) throw error;
    requireRebind(false, `${path}: ${error.message}.`);
  }
  const result = record(value);
  requireRebind(result, `${path}: payload must be a JSON object.`);
  try { copyRawNetRebindJson(result); }
  catch (error) {
    if (!(error instanceof AppError) || error.extras?.code !== "NET_REBIND_HISTORY_CONFLICT") throw error;
    requireRebind(false, `${path}: raw payload cannot be preserved as strict JSON (${error.message}).`);
  }
  return result;
}

export function validateRebindBindings(value: unknown, active: ReadonlySet<string>, judge: NetReferenceJudge): RebindIndex {
  requireRebind(Array.isArray(value) && value.length >= 1 && value.length <= 500, "bindings: expected 1..500 entries.");
  const ids = new Map<string, string | null>(), names = new Map<string, string | null>();
  for (const [index, entry] of value.entries()) {
    const binding = record(entry), path = `bindings[${index}]`;
    requireRebind(binding, `${path}: expected an object.`);
    requireRebind(own(binding, "fromNetId") && (binding.fromNetId === null || nonblank(binding.fromNetId)), `${path}.fromNetId: expected null or a nonblank string.`);
    requireRebind(own(binding, "toNetId") && (binding.toNetId === null || nonblank(binding.toNetId)), `${path}.toNetId: expected null or a nonblank string.`);
    requireRebind(!own(binding, "fromNetName") || binding.fromNetName === null || typeof binding.fromNetName === "string", `${path}.fromNetName: expected null or a string.`);
    const from = binding.fromNetId;
    requireRebind(from === null || !active.has(from), `${path}.fromNetId: active sources cannot be rebound.`);
    requireRebind(from !== null || nonblank(binding.fromNetName), `${path}.fromNetName: null source requires an exact nonblank hint.`);
    const map = from === null ? names : ids, key = from === null ? binding.fromNetName as string : from;
    requireRebind(!map.has(key), `${path}: duplicate source reference.`);
    const failure = judge(binding.toNetId, `${path}.toNetId`);
    if (failure) throw new NetRebindPlanRefused(failure);
    requireRebind(binding.toNetId === null || active.has(binding.toNetId), `${path}.toNetId: target must be active or null.`);
    map.set(key, binding.toNetId);
  }
  return { ids, names };
}

export function referenceTarget(raw: Record<string, unknown>, index: RebindIndex, path: string): string | null | undefined {
  requireRebind(!own(raw, "netId") || raw.netId === null || nonblank(raw.netId), `${path}.netId: expected absent, null, or a nonblank string.`);
  requireRebind(!own(raw, "netName") || raw.netName === null || typeof raw.netName === "string", `${path}.netName: expected absent, null, or a string.`);
  // All four canonical copper readers interpret an absent netId as null.
  return own(raw, "netId") && raw.netId !== null ? index.ids.get(raw.netId as string) :
    own(raw, "netName") && typeof raw.netName === "string" ? index.names.get(raw.netName) : undefined;
}

export function fieldDelta(raw: Record<string, unknown>, key: string, after: unknown): RawNetRebindFieldDelta | null {
  if (own(raw, key) && same(raw[key], after)) return null;
  return { key, before: own(raw, key) ? { exists: true, value: raw[key] } : { exists: false }, after: { exists: true, value: after } };
}

/** A malformed known reference field containing a source must not be silently skipped. */
export function touchesSource(value: unknown, ids: RebindIndex["ids"]): boolean {
  const pending = [value];
  while (pending.length) {
    const next = pending.pop();
    if (typeof next === "string" && ids.has(next)) return true;
    if (Array.isArray(next)) for (const entry of next) pending.push(entry);
    else if (record(next)) {
      for (const [key, entry] of Object.entries(next as Record<string, unknown>)) {
        if (ids.has(key)) return true;
        pending.push(entry);
      }
    }
  }
  return false;
}

export function mappedIds(value: unknown, index: RebindIndex, path: string): string[] {
  requireRebind(Array.isArray(value) && value.every(nonblank), `${path}: affected references must be an array of nonblank strings.`);
  const mapped = value.map((id: string) => index.ids.has(id) ? index.ids.get(id)! : id);
  return [...new Set(mapped.filter((id): id is string => id !== null))];
}
