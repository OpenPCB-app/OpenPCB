import type { NetRebindReceipt } from "../../../../sdks/designer/net-rebind";
import type { RawNetRebindFieldDelta } from "./rebind-history-types";
import { fieldDelta, mappedIds, nonblank, own, record, requireRebind, touchesSource, type RebindIndex } from "./rebind-validation";

type Section = "lengthMatchGroups" | "diffPairs" | "drcRules";
type RawRecord = Record<string, unknown>;

function assignments(raw: RawRecord, index: RebindIndex, receipt: NetRebindReceipt): RawNetRebindFieldDelta | null {
  if (!own(raw, "perNetClassAssignments")) return null;
  const stored = record(raw.perNetClassAssignments);
  requireRebind(stored, "board.perNetClassAssignments: expected an object; cannot inspect malformed assignments safely.");
  const sources = Object.keys(stored).filter((id) => index.ids.has(id));
  if (!sources.length) return null;
  const next = Object.assign(Object.create(null) as RawRecord, stored);
  for (const id of sources) {
    requireRebind(nonblank(stored[id]), `board.perNetClassAssignments[${JSON.stringify(id)}]: affected class must be a nonblank string.`);
    delete next[id];
  }
  for (const id of sources) {
    const target = index.ids.get(id)!;
    if (target === null || own(stored, target)) continue;
    requireRebind(!own(next, target) || next[target] === stored[id], `board.perNetClassAssignments: sources mapping to ${JSON.stringify(target)} have different classes.`);
    next[target] = stored[id];
  }
  receipt.assignments += sources.length;
  return fieldDelta(raw, "perNetClassAssignments", next);
}

function affected(row: RawRecord, section: Section, index: RebindIndex): boolean {
  if (section === "lengthMatchGroups") return touchesSource(row.netIds, index.ids);
  if (section === "diffPairs") return touchesSource(row.pNetId, index.ids) || touchesSource(row.nNetId, index.ids);
  if (!Array.isArray(row.scopes)) return touchesSource(row.scopes, index.ids);
  return row.scopes.some((scope: unknown) => {
    const entry = record(scope);
    return !!entry && touchesSource(entry.netIds, index.ids);
  });
}

function rewritePair(row: RawRecord, index: RebindIndex, path: string): RawRecord | null {
  requireRebind(nonblank(row.pNetId) && nonblank(row.nNetId), `${path}: affected pair requires exact nonblank pNetId and nNetId.`);
  const p = index.ids.has(row.pNetId) ? index.ids.get(row.pNetId)! : row.pNetId;
  const n = index.ids.has(row.nNetId) ? index.ids.get(row.nNetId)! : row.nNetId;
  return p === null || n === null || p === n ? null : { ...row, pNetId: p, nNetId: n };
}

function rewriteRule(row: RawRecord, index: RebindIndex, path: string): RawRecord | null {
  requireRebind(Array.isArray(row.scopes), `${path}.scopes: affected rule requires an exact scopes array.`);
  let remove = false;
  const scopes = row.scopes.map((scope: unknown, scopeIndex: number) => {
    const entry = record(scope);
    if (!entry || !touchesSource(entry.netIds, index.ids)) return scope;
    requireRebind(entry.kind === "net", `${path}.scopes[${scopeIndex}]: affected netIds has an unsupported scope kind.`);
    const netIds = mappedIds(entry.netIds, index, `${path}.scopes[${scopeIndex}].netIds`);
    if (!netIds.length) remove = true;
    return { ...entry, netIds };
  });
  return remove ? null : { ...row, scopes };
}

function rewriteRow(row: RawRecord, section: Section, index: RebindIndex, path: string): RawRecord | null {
  if (section === "diffPairs") return rewritePair(row, index, path);
  if (section === "drcRules") return rewriteRule(row, index, path);
  const netIds = mappedIds(row.netIds, index, `${path}.netIds`);
  return netIds.length ? { ...row, netIds } : null;
}

function ruleArray(raw: RawRecord, section: Section, index: RebindIndex, receipt: NetRebindReceipt): RawNetRebindFieldDelta | null {
  if (!own(raw, section)) return null;
  const stored = raw[section];
  requireRebind(Array.isArray(stored), `board.${section}: expected an array; cannot inspect malformed declarations safely.`);
  const ids = new Map<string, number>();
  for (const entry of stored) {
    const id = record(entry)?.id;
    if (typeof id === "string") ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  let changed = false;
  const next: unknown[] = [];
  for (const [position, entry] of stored.entries()) {
    const row = record(entry), path = `board.${section}[${position}]`;
    if (!row || !affected(row, section, index)) { next.push(entry); continue; }
    requireRebind(nonblank(row.id) && ids.get(row.id) === 1, `${path}.id: affected declaration needs a unique nonblank ID.`);
    const rewritten = rewriteRow(row, section, index, path);
    changed = true;
    const count = section === "lengthMatchGroups" ? "lengthGroups" : section;
    receipt[count]++;
    if (rewritten) next.push(rewritten);
    else receipt[section === "lengthMatchGroups" ? "removedLengthGroups" : section === "diffPairs" ? "removedDiffPairs" : "removedRules"].push(row.id);
  }
  return changed ? fieldDelta(raw, section, next) : null;
}

export function planRebindBoard(raw: RawRecord, index: RebindIndex, receipt: NetRebindReceipt): RawNetRebindFieldDelta[] {
  const fields = [assignments(raw, index, receipt),
    ...(["lengthMatchGroups", "diffPairs", "drcRules"] as const).map((section) => ruleArray(raw, section, index, receipt))];
  return fields.filter((field): field is RawNetRebindFieldDelta => field !== null);
}
