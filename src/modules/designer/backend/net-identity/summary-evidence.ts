import type { DesignerSchematicProjection } from "../../../../sdks";
import type { NetReference } from "../../../../shared/electrical-identity/references";
import { netReferenceProvenance, type NetReferenceProvenance } from "./reference-key";
import { isLoneNetId, type NetIdentityQuarantineRecord, type NetIdentityRetiredRecord } from "./types";

interface SuccessorProof { endpoints: string[]; complete: boolean }
export interface SummaryEvidence {
  active: ReadonlySet<string>;
  retired: ReadonlyMap<string, NetIdentityRetiredRecord>;
  quarantine: ReadonlyMap<string, NetIdentityQuarantineRecord>;
  nets: DesignerSchematicProjection["nets"];
}

export function provenanceKey(value: NetReferenceProvenance): string {
  return JSON.stringify([value.refKind, value.refId, value.legacyValue]);
}

function openQuarantine(ref: NetReference, evidence: SummaryEvidence): NetIdentityQuarantineRecord | null {
  const provenance = netReferenceProvenance(ref);
  return provenance ? evidence.quarantine.get(provenanceKey(provenance)) ?? null : null;
}

/** Active IDs end a path even when an old retirement row remains after undo. */
function successorProof(start: string, evidence: SummaryEvidence): SuccessorProof {
  const pending = [{ id: start, exit: false }], colors = new Map<string, number>(), endpoints = new Set<string>();
  let complete = true;
  while (pending.length) {
    const frame = pending.pop()!;
    if (frame.exit) { colors.set(frame.id, 2); continue; }
    if (evidence.active.has(frame.id)) { endpoints.add(frame.id); continue; }
    if (colors.get(frame.id) === 1) { complete = false; continue; }
    if (colors.get(frame.id) === 2) continue;
    colors.set(frame.id, 1);
    pending.push({ id: frame.id, exit: true });
    const next = isLoneNetId(frame.id)
      ? evidence.nets.filter((net) => evidence.active.has(net.id) && net.pinIds.includes(frame.id.slice(3))).map((net) => net.id)
      : evidence.retired.get(frame.id)?.successorIds ?? [];
    if (!next.length) complete = false;
    for (const id of next) pending.push({ id, exit: false });
  }
  return { endpoints: [...endpoints].sort(), complete };
}

function quarantineSuggestion(
  rows: Array<NetIdentityQuarantineRecord | null>, evidence: SummaryEvidence,
): string | null {
  const suggestions = rows.map((row) => row?.suggestedNetId ?? null);
  const first = suggestions[0];
  return first && evidence.active.has(first) && suggestions.every((id) => id === first) ? first : null;
}

export function groupEvidence(refs: NetReference[], evidence: SummaryEvidence) {
  const first = refs[0]!, retired = first.netId !== null ? evidence.retired.get(first.netId) : undefined;
  const hasRetirement = retired !== undefined || first.netId !== null && isLoneNetId(first.netId);
  const proof = hasRetirement ? successorProof(first.netId!, evidence) : { endpoints: [], complete: false };
  const rows = refs.map((ref) => openQuarantine(ref, evidence)), hasQuarantine = rows.some((row) => row !== null);
  const candidates = new Set(proof.endpoints);
  for (const row of rows) for (const id of row?.candidates ?? []) if (evidence.active.has(id)) candidates.add(id);
  let suggestedNetId = proof.complete && proof.endpoints.length === 1 ? proof.endpoints[0]! : null;
  if (hasQuarantine) {
    suggestedNetId = quarantineSuggestion(rows, evidence);
    if (hasRetirement && (!proof.complete || proof.endpoints.length !== 1 || proof.endpoints[0] !== suggestedNetId)) suggestedNetId = null;
  }
  const hints = refs.map((ref) => ref.netName).filter((name): name is string => !!name?.trim()).sort();
  return {
    netName: first.netId === null ? first.netName : retired?.displayName ?? hints[0] ?? null,
    reason: hasRetirement ? "retired" as const : hasQuarantine ? "legacy-quarantine" as const :
      first.netId === null ? "unresolved-name" as const : "unknown" as const,
    successorNetIds: proof.endpoints, suggestedNetId, candidateNetIds: [...candidates].sort(),
  };
}
