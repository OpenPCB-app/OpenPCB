import type { PcbBoardSettings, PcbDrcRule, PcbDiffPair, PcbLengthMatchGroup } from "../../../../sdks/designer";
import { serializeRawBoardSettings } from "../pcb/board-settings-serialize";
import { asRecord } from "../value-guards";
import { NetIdentityStateInvalidError } from "./types";

const equal = (first: unknown, second: unknown): boolean => JSON.stringify(first) === JSON.stringify(second);
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function requireExact(condition: unknown, path: string, detail: string): asserts condition {
  if (!condition) throw new NetIdentityStateInvalidError(path, detail);
}

function assignmentDelta(raw: unknown, before: Record<string, string> = {}, after: Record<string, string> = {}): Record<string, unknown> | null {
  const removed = Object.keys(before).filter((id) => !own(after, id) || before[id] !== after[id]);
  const inserted = Object.keys(after).filter((id) => !own(before, id) || before[id] !== after[id]);
  if (removed.length === 0 && inserted.length === 0) return null;
  const stored = asRecord(raw);
  requireExact(stored, "board.perNetClassAssignments", "changed assignments require an exact raw map");
  const next = Object.assign(Object.create(null) as Record<string, unknown>, stored);
  for (const id of removed) {
    requireExact(own(stored, id) && stored[id] === before[id], `board.perNetClassAssignments[${JSON.stringify(id)}]`, "raw source does not match the previous assignment");
    delete next[id];
  }
  for (const id of inserted) {
    requireExact(!own(next, id), `board.perNetClassAssignments[${JSON.stringify(id)}]`, "destination collides with a retained raw declaration");
    next[id] = after[id];
  }
  return next;
}

type ReferenceRow = PcbLengthMatchGroup | PcbDiffPair | PcbDrcRule;
type RowKind = "lengthMatchGroups" | "diffPairs" | "drcRules";

function rowReferences(row: ReferenceRow, kind: RowKind): unknown {
  if (kind === "lengthMatchGroups") return (row as PcbLengthMatchGroup).netIds;
  if (kind === "diffPairs") {
    const pair = row as PcbDiffPair;
    return [pair.pNetId, pair.nNetId];
  }
  return (row as PcbDrcRule).scopes.flatMap((scope, index) => scope.kind === "net" ? [[index, scope.netIds]] : []);
}

function patchScopes(raw: Record<string, unknown>, before: PcbDrcRule, after: PcbDrcRule, path: string): Record<string, unknown> {
  const indices = new Set([...before.scopes.keys(), ...after.scopes.keys()]);
  let scopes: unknown[] | null = null;
  for (const index of indices) {
    const previous = before.scopes[index];
    const next = after.scopes[index];
    if (previous?.kind !== "net" && next?.kind !== "net") continue;
    if (previous?.kind === "net" && next?.kind === "net" && equal(previous.netIds, next.netIds)) continue;
    const scopePath = `${path}.scopes[${index}]`;
    requireExact(previous?.kind === "net" && next?.kind === "net", scopePath, "adding, removing or moving a net scope is unsupported");
    requireExact(Array.isArray(raw.scopes), scopePath, "changed scope requires an exact raw scopes array");
    const stored = asRecord((raw.scopes as unknown[])[index]);
    requireExact(stored?.kind === "net" && equal(stored.netIds, previous.netIds), scopePath, "raw scope index or references do not match the previous net scope");
    scopes ??= [...raw.scopes as unknown[]];
    scopes[index] = { ...stored, netIds: [...next.netIds] };
  }
  requireExact(scopes !== null, path, "changed rule has no exactly mapped reference delta");
  return { ...raw, scopes };
}

function patchRow(raw: Record<string, unknown>, before: ReferenceRow, after: ReferenceRow, kind: RowKind, path: string): Record<string, unknown> {
  if (kind === "drcRules") return patchScopes(raw, before as PcbDrcRule, after as PcbDrcRule, path);
  if (kind === "lengthMatchGroups") {
    const previous = before as PcbLengthMatchGroup;
    const next = after as PcbLengthMatchGroup;
    requireExact(equal(raw.netIds, previous.netIds), `${path}.netIds`, "raw references do not match the previous group");
    return { ...raw, netIds: [...next.netIds] };
  }
  const previous = before as PcbDiffPair;
  const next = after as PcbDiffPair;
  requireExact(raw.pNetId === previous.pNetId && raw.nNetId === previous.nNetId, path, "raw references do not match the previous differential pair");
  return { ...raw, pNetId: next.pNetId, nNetId: next.nNetId };
}

function patchRows(raw: unknown, before: readonly ReferenceRow[] = [], after: readonly ReferenceRow[] = [], kind: RowKind): unknown[] | null {
  const ids = new Set([...before, ...after].map((row) => row.id));
  let changed: unknown[] | null = null;
  for (const id of ids) {
    const previous = before.filter((row) => row.id === id);
    const next = after.filter((row) => row.id === id);
    const path = `board.${kind}[${JSON.stringify(id)}]`;
    requireExact(previous.length > 0 && next.length > 0, path, "adding or deleting reference rows is unsupported");
    if (equal(previous.map((row) => rowReferences(row, kind)), next.map((row) => rowReferences(row, kind)))) continue;
    requireExact(previous.length === 1 && next.length === 1, path, "changed typed row id must be unique before and after");
    requireExact(Array.isArray(raw), path, "changed row requires an exact raw array");
    const indices = (raw as unknown[]).flatMap((row, index) => asRecord(row)?.id === id ? [index] : []);
    requireExact(indices.length === 1, path, "changed raw row id must match exactly once");
    const index = indices[0]!;
    const stored = asRecord((raw as unknown[])[index])!;
    const patched = patchRow(stored, previous[0]!, next[0]!, kind, path);
    changed ??= [...raw as unknown[]];
    changed[index] = patched;
  }
  return changed;
}

/** Migration changes references only; typed parser recovery never rewrites raw requirements. */
export function serializeMigratedBoardReferences(
  raw: Record<string, unknown>, before: PcbBoardSettings, after: PcbBoardSettings, timestamp: string,
): string | null {
  const assignments = assignmentDelta(raw.perNetClassAssignments, before.perNetClassAssignments, after.perNetClassAssignments);
  const groups = patchRows(raw.lengthMatchGroups, before.lengthMatchGroups, after.lengthMatchGroups, "lengthMatchGroups");
  const pairs = patchRows(raw.diffPairs, before.diffPairs, after.diffPairs, "diffPairs");
  const rules = patchRows(raw.drcRules, before.drcRules, after.drcRules, "drcRules");
  if (assignments === null && groups === null && pairs === null && rules === null) return null;
  return serializeRawBoardSettings({ ...raw,
    ...(assignments === null ? {} : { perNetClassAssignments: assignments }),
    ...(groups === null ? {} : { lengthMatchGroups: groups }),
    ...(pairs === null ? {} : { diffPairs: pairs }),
    ...(rules === null ? {} : { drcRules: rules }),
    updatedAt: timestamp,
  });
}
