// Board settings are ONE JSON blob, and every parser that reads it is a strict
// whitelist. Before this module every writer re-serialised the TYPED projection,
// so a key written by a NEWER build survived exactly until the next save and was
// then erased — silently, with no way back.
//
// THE RULE: every board-settings write goes through `serializeBoardSettings`; a
// new persisted field needs a parser arm, a `routes.ts` arm and a
// `board-content-digest.ts` entry; unknown data is preserved, never interpreted.
//
// "Unknown" means: present in the stored blob, absent from the freshly
// serialized `next` at the same position. Known-ness comes from the explicit key
// lists in `board-settings-known-keys.ts` — never from `Object.keys(next)` —
// because `next` omits a known optional key the user has just EMPTIED, and reading known-ness off the runtime
// object would resurrect it. The lists carry a compile-time exhaustiveness
// assertion, so adding a field to `PcbBoardSettings` / `PcbDesignRules` /
// `PcbViewState` / `AutoLayoutConfig` / a row type without listing it here
// fails `tsc`.
//
// THE CARRY-OVER POSITIONS, exactly:
//
//  1. Top level — every stored key that is not a known `PcbBoardSettings` key
//     and is not `schemaVersion`.
//  2. `designRules` — unknown keys at its top level, and unknown keys inside
//     each KNOWN sub-block (`clearance`, `minimums`, `electrical`, `silkscreen`,
//     `solderMask`, `dfm`, `outline`). An UNKNOWN sub-block is carried whole by
//     rule 1's `designRules` arm; a known sub-block absent from `next` was
//     cleared and is not revived.
//  3. `viewState` — unknown keys at its top level, and one level deeper inside
//     `autoLayoutConfig` and its `place` / `route` blocks (all closed object
//     types). `perLayerOpacity` and the id arrays stay opaque leaves.
//  4. The id-keyed row arrays `netClasses`, `diffPairs`, `lengthMatchGroups`,
//     `drcRules` — per row, matched by `id` against the PARSEABLE stored rows
//     (first occurrence wins). A row's nested `target` / `constraint` carry
//     unknown keys only when the two `kind` discriminants agree; its `scopes`
//     are paired by CONTENT, never by array index (see `mergeScopes`).
//
// THE RESCUE RULE: every stored row of those four arrays that this build's
// parser REJECTS is appended raw after the typed rows, in stored order —
// whatever its `id` is, including none, a non-string one, or one it shares with
// a kept row. Such a row was never shown to the user, so its absence from `next`
// cannot mean the user deleted it. A row that PARSES and is absent from `next`
// WAS deleted and stays deleted. Non-record array entries are never rescued.
// Rescued rows do not multiply: they fail the parser again on the next save and
// are never in `next`, so each is appended exactly once.
// A `perNetClassAssignments` entry pointing at a RESCUED net-class id is carried
// too, unless `next` assigns that net itself — the class survives, so the
// assignment the user could never see must survive with it.
//
// KNOWN LIMITS, deliberate: a known key whose VALUE this build cannot parse is
// still normalised by the parser (only the key's presence is protected), and a
// non-integer stored `schemaVersion` is replaced by this build's.

import type { PcbBoardSettings } from "../../../../sdks/designer";
import {
  DESIGN_RULE_BLOCKS,
  KNOWN_AUTO_LAYOUT,
  KNOWN_AUTO_LAYOUT_PLACE,
  KNOWN_AUTO_LAYOUT_ROUTE,
  KNOWN_DESIGN_RULES,
  KNOWN_TOP_LEVEL,
  KNOWN_VIEW_STATE,
  NESTED_ROW_OBJECTS,
  ROW_ARRAYS,
  SCHEMA_VERSION_KEY,
} from "./board-settings-known-keys";
import { asNumber, asRecord, asString } from "../value-guards";

export const BOARD_SETTINGS_SCHEMA_VERSION = 1;

/**
 * Does a stored row parse under THIS build's row parser? Supplied by
 * `pcb-store.ts`, which owns the parsers — passing them in is what keeps this
 * module free of a circular import back into the store.
 */
export interface BoardSettingsRowParsers {
  netClasses(row: unknown): boolean;
  diffPairs(row: unknown): boolean;
  lengthMatchGroups(row: unknown): boolean;
  drcRules(row: unknown): boolean;
}

// ───────────────────────────── serialization ─────────────────────────────

/**
 * The board-settings payload to persist: the unknown data in `storedRaw` first,
 * the typed `next` on top (a known key ALWAYS wins), `schemaVersion` last.
 *
 * Deterministic — same inputs, same string — and neither argument is mutated.
 * Pass `storedRaw = undefined` when the row is being created.
 */
export function serializeBoardSettings(
  storedRaw: unknown,
  next: PcbBoardSettings,
  rowParsers: BoardSettingsRowParsers,
): string {
  const nextJson = toJsonRecord(next);
  const stored = asRecord(storedRaw);
  if (!stored) {
    return JSON.stringify({
      ...nextJson,
      [SCHEMA_VERSION_KEY]: BOARD_SETTINGS_SCHEMA_VERSION,
    });
  }
  const merged: Record<string, unknown> = {
    ...carryUnknown(stored, KNOWN_TOP_LEVEL),
    ...nextJson,
  };
  const designRules = mergeDesignRules(stored.designRules, merged.designRules);
  if (designRules) merged.designRules = designRules;
  const viewState = mergeViewState(stored.viewState, merged.viewState);
  if (viewState) merged.viewState = viewState;
  let rescuedNetClassIds: ReadonlySet<string> = EMPTY_IDS;
  for (const [key, knownRowKeys] of ROW_ARRAYS) {
    const result = mergeRows(
      stored[key],
      merged[key],
      knownRowKeys,
      rowParsers[key],
    );
    if (result.rows) merged[key] = result.rows;
    if (key === "netClasses") rescuedNetClassIds = result.rescuedIds;
  }
  const assignments = mergeAssignments(
    stored.perNetClassAssignments,
    merged.perNetClassAssignments,
    rescuedNetClassIds,
  );
  if (assignments) merged.perNetClassAssignments = assignments;
  merged[SCHEMA_VERSION_KEY] = resolveSchemaVersion(stored[SCHEMA_VERSION_KEY]);
  return JSON.stringify(merged);
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * A write of a RAW board-settings record — the legacy fill→zone migration,
 * which edits the stored payload in place and must keep even the keys this
 * build's parsers never look at. Shares the one version policy above.
 */
export function serializeRawBoardSettings(
  raw: Record<string, unknown>,
): string {
  const out = emptyRecord();
  for (const key of Object.keys(raw)) {
    if (key !== SCHEMA_VERSION_KEY) out[key] = raw[key];
  }
  out[SCHEMA_VERSION_KEY] = resolveSchemaVersion(raw[SCHEMA_VERSION_KEY]);
  return JSON.stringify(out);
}

/**
 * A null-prototype accumulator. Assigning `out["__proto__"] = …` on an ordinary
 * object hits `Object.prototype`'s setter and the key vanishes instead of
 * becoming an own property — which would silently lose a stored key literally
 * named `__proto__`. With no prototype the assignment is an ordinary data
 * property, and object spread and `JSON.stringify` both carry it through.
 */
function emptyRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

/**
 * A stored version AHEAD of this build is preserved, not refused: the payload
 * still loads through the whitelist parsers, and downgrading the stamp would
 * tell the newer build its own data had been rewritten by its schema.
 */
function resolveSchemaVersion(stored: unknown): number {
  const version = asNumber(stored);
  return version !== null && Number.isInteger(version)
    ? Math.max(BOARD_SETTINGS_SCHEMA_VERSION, version)
    : BOARD_SETTINGS_SCHEMA_VERSION;
}

/** `next` exactly as JSON will see it — `undefined` keys already dropped. */
function toJsonRecord(next: PcbBoardSettings): Record<string, unknown> {
  return asRecord(JSON.parse(JSON.stringify(next)) as unknown) ?? {};
}

function carryUnknown(
  stored: Record<string, unknown>,
  known: ReadonlySet<string>,
): Record<string, unknown> {
  const out = emptyRecord();
  for (const key of Object.keys(stored)) {
    if (known.has(key)) continue;
    out[key] = cloneJson(stored[key]);
  }
  return out;
}

function mergeDesignRules(
  storedValue: unknown,
  nextValue: unknown,
): Record<string, unknown> | null {
  const stored = asRecord(storedValue);
  const next = asRecord(nextValue);
  if (!stored || !next) return null;
  const merged: Record<string, unknown> = {
    ...carryUnknown(stored, KNOWN_DESIGN_RULES),
    ...next,
  };
  for (const [block, known] of DESIGN_RULE_BLOCKS) {
    // A known sub-block absent from `next` was CLEARED, so it is not revived;
    // an UNKNOWN sub-block was already carried by the rule above.
    const sub = mergeRecord(stored[block], merged[block], known);
    if (sub) merged[block] = sub;
  }
  return merged;
}

/**
 * `viewState` is where the next persisted display field is most likely to land
 * (`autoLayoutConfig` is the precedent), so its unknown keys are carried too —
 * at its top level and one level down through `autoLayoutConfig` and its two
 * closed sub-blocks. `perLayerOpacity` and the id arrays stay opaque leaves.
 */
function mergeViewState(
  storedValue: unknown,
  nextValue: unknown,
): Record<string, unknown> | null {
  const merged = mergeRecord(storedValue, nextValue, KNOWN_VIEW_STATE);
  if (!merged) return null;
  const stored = asRecord(storedValue) ?? {};
  const config = mergeAutoLayoutConfig(
    stored.autoLayoutConfig,
    merged.autoLayoutConfig,
  );
  if (config) merged.autoLayoutConfig = config;
  return merged;
}

function mergeAutoLayoutConfig(
  storedValue: unknown,
  nextValue: unknown,
): Record<string, unknown> | null {
  const merged = mergeRecord(storedValue, nextValue, KNOWN_AUTO_LAYOUT);
  if (!merged) return null;
  const stored = asRecord(storedValue) ?? {};
  const place = mergeRecord(
    stored.place,
    merged.place,
    KNOWN_AUTO_LAYOUT_PLACE,
  );
  if (place) merged.place = place;
  const route = mergeRecord(
    stored.route,
    merged.route,
    KNOWN_AUTO_LAYOUT_ROUTE,
  );
  if (route) merged.route = route;
  return merged;
}

/**
 * A net → class assignment pointing at a RESCUED class id. The user never saw
 * it (`parsePerNetClassAssignments` drops any entry whose class is not in the
 * parsed class table), so deleting it alongside a class that itself survives
 * would be the same silent erasure this module exists to stop. `next` wins for
 * any net it assigns itself.
 */
function mergeAssignments(
  storedValue: unknown,
  nextValue: unknown,
  rescuedClassIds: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (rescuedClassIds.size === 0) return null;
  const stored = asRecord(storedValue);
  if (!stored) return null;
  const next = asRecord(nextValue);
  const carried = emptyRecord();
  for (const netId of Object.keys(stored)) {
    if (next && Object.prototype.hasOwnProperty.call(next, netId)) continue;
    const classId = asString(stored[netId]);
    if (classId !== null && rescuedClassIds.has(classId)) {
      carried[netId] = classId;
    }
  }
  if (Object.keys(carried).length === 0) return null;
  return { ...carried, ...(next ?? {}) };
}

function mergeRecord(
  storedValue: unknown,
  nextValue: unknown,
  known: ReadonlySet<string>,
): Record<string, unknown> | null {
  const stored = asRecord(storedValue);
  const next = asRecord(nextValue);
  if (!stored || !next) return null;
  return { ...carryUnknown(stored, known), ...next };
}

interface MergedRows {
  /** `null` leaves the key exactly as `next` had it (absent, or untouched). */
  rows: unknown[] | null;
  /** Ids of the rescued rows that had a usable string id. */
  rescuedIds: ReadonlySet<string>;
}

/**
 * One id-keyed row array. Rows in `next` keep the unknown keys of the PARSEABLE
 * stored row with the same id; every stored row this build's parser rejects is
 * appended raw after them, in stored order.
 *
 * The rescue deliberately ignores the row's id — including an id it shares with
 * a row `next` keeps. Two rows under one id is itself something only a newer
 * build can have written, and the one this build cannot read is the one it must
 * not judge. A row that PARSES and is gone from `next` WAS deleted by the user
 * and stays deleted.
 */
function mergeRows(
  storedValue: unknown,
  nextValue: unknown,
  known: ReadonlySet<string>,
  parses: (row: unknown) => boolean,
): MergedRows {
  const stored = Array.isArray(storedValue) ? (storedValue as unknown[]) : null;
  if (!stored) return { rows: null, rescuedIds: EMPTY_IDS };
  const nextRows = Array.isArray(nextValue) ? (nextValue as unknown[]) : null;
  const byId = new Map<string, unknown>();
  const rescued: unknown[] = [];
  const rescuedIds = new Set<string>();
  for (const row of stored) {
    const record = asRecord(row);
    if (!record) continue; // a number / string / null was never a row
    if (parses(row)) {
      const id = asString(record.id);
      if (id !== null && !byId.has(id)) byId.set(id, row);
      continue;
    }
    rescued.push(row);
    const id = asString(record.id);
    if (id !== null) rescuedIds.add(id);
  }
  const out: unknown[] = [];
  for (const row of nextRows ?? []) {
    const id = rowId(row);
    out.push(mergeRow(id === null ? null : byId.get(id), row, known));
  }
  for (const row of rescued) out.push(cloneJson(row));
  // The key was absent from `next` (emptied by the user) and nothing had to be
  // rescued — leave it absent rather than writing an empty array.
  const rows = nextRows === null && out.length === 0 ? null : out;
  return { rows, rescuedIds };
}

function rowId(value: unknown): string | null {
  const record = asRecord(value);
  return record ? asString(record.id) : null;
}

function mergeRow(
  storedValue: unknown,
  nextValue: unknown,
  known: ReadonlySet<string>,
): unknown {
  const merged = mergeRecord(storedValue, nextValue, known);
  if (!merged) return cloneJson(nextValue);
  const stored = asRecord(storedValue) ?? {};
  for (const key of NESTED_ROW_OBJECTS) {
    const nested = mergeDiscriminated(stored[key], merged[key]);
    if (nested) merged[key] = nested;
  }
  const scopes = mergeScopes(stored.scopes, merged.scopes);
  if (scopes) merged.scopes = scopes;
  return merged;
}

/** Unknown keys cross only when the two `kind` discriminants agree. */
function mergeDiscriminated(
  storedValue: unknown,
  nextValue: unknown,
): Record<string, unknown> | null {
  const stored = asRecord(storedValue);
  const next = asRecord(nextValue);
  if (!stored || !next || stored.kind !== next.kind) return null;
  return mergeRecord(stored, next, new Set(Object.keys(next)));
}

/**
 * Scopes carry no id, so stored and next are paired by CONTENT: a next scope
 * takes the unknown keys of an as-yet-unused stored scope that agrees with it on
 * every key the next scope has. No agreeing scope means no carry-over.
 *
 * NEVER by array index. Deleting or reordering a scope then MOVES a newer
 * build's per-scope key onto a different scope, and a rule that silently means
 * something else is worse than one that has lost a key.
 */
function mergeScopes(storedValue: unknown, nextValue: unknown): unknown[] | null {
  const stored = Array.isArray(storedValue) ? (storedValue as unknown[]) : null;
  const next = Array.isArray(nextValue) ? (nextValue as unknown[]) : null;
  if (!stored || !next) return null;
  const used = new Set<number>();
  return next.map((scope) => {
    const match = matchStoredScope(stored, scope, used);
    if (match === null) return cloneJson(scope);
    used.add(match);
    const own = new Set(Object.keys(asRecord(scope) ?? {}));
    return mergeRecord(stored[match], scope, own) ?? cloneJson(scope);
  });
}

/** Index of the first unused stored scope equal to `scope` on its own keys. */
function matchStoredScope(
  stored: readonly unknown[],
  scope: unknown,
  used: ReadonlySet<number>,
): number | null {
  const next = asRecord(scope);
  if (!next) return null;
  const keys = Object.keys(next);
  const wanted = projectionSignature(next, keys);
  for (let index = 0; index < stored.length; index += 1) {
    if (used.has(index)) continue;
    const candidate = asRecord(stored[index]);
    if (candidate && projectionSignature(candidate, keys) === wanted) {
      return index;
    }
  }
  return null;
}

/** Canonical JSON of exactly `keys` of `record`, key-sorted at every depth. */
function projectionSignature(
  record: Record<string, unknown>,
  keys: readonly string[],
): string {
  const projected = emptyRecord();
  for (const key of [...keys].sort()) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      projected[key] = record[key];
    }
  }
  return JSON.stringify(projected, sortKeysReplacer);
}

function sortKeysReplacer(_key: string, value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const sorted = emptyRecord();
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return sorted;
}

/** Structural copy of a JSON value, so nothing carried aliases `storedRaw`. */
function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return (value as unknown[]).map(cloneJson);
  const record = asRecord(value);
  if (!record) return value;
  const out = emptyRecord();
  for (const key of Object.keys(record)) out[key] = cloneJson(record[key]);
  return out;
}
