import type { ActiveNetRecord } from "./types";
import { seqOf } from "./types";
import { compareText, memberToken } from "./bind-input";

export interface SanitizedMember {
  token: string;
  keptId: string;
  droppedFrom: string[];
}

export function sanitizePreviousActive(
  previous: readonly ActiveNetRecord[],
  priorOwner?: ReadonlyMap<string, string>,
): { previous: ActiveNetRecord[]; sanitized: SanitizedMember[] } {
  const claims = new Map<string, ActiveNetRecord[]>();
  for (const record of previous) for (const member of record.members) {
    const token = memberToken(member), owners = claims.get(token) ?? [];
    owners.push(record);
    claims.set(token, owners);
  }
  const preferred = new Set(priorOwner?.values() ?? []), kept = new Map<string, string>();
  const sanitized: SanitizedMember[] = [];
  for (const [token, owners] of [...claims].sort(([a], [b]) => compareText(a, b))) {
    const exact = priorOwner?.get(token);
    // Valid own-salt records have unique sequences; text also orders defensive standalone inputs.
    owners.sort((a, b) => Number(b.id === exact) - Number(a.id === exact) ||
      Number(preferred.has(b.id)) - Number(preferred.has(a.id)) ||
      (seqOf(a.id) ?? Infinity) - (seqOf(b.id) ?? Infinity) || compareText(a.id, b.id));
    kept.set(token, owners[0]!.id);
    if (owners.length > 1) sanitized.push({
      token, keptId: owners[0]!.id, droppedFrom: owners.slice(1).map((record) => record.id).sort(compareText),
    });
  }
  return {
    previous: previous.flatMap((record) => {
      const members = record.members.filter((member) => kept.get(memberToken(member)) === record.id);
      return members.length === 0 ? [] : [{ ...record, members }];
    }),
    sanitized,
  };
}
