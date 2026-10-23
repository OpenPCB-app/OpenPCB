import { expect } from "bun:test";
import { eq } from "drizzle-orm";
import type { DrcAnchor, DesignerSchematicProjection } from "../../../../sdks/designer";
import { bindNetIdentity } from "../../../../modules/designer/backend/net-identity/bind";
import { loadNetReferenceSource } from "../../../../modules/designer/backend/net-identity/census-source";
import { readNetIdentityRetired } from "../../../../modules/designer/backend/net-identity/state-store";
import { designNetSalt, isDurableNetIdOf, seqOf } from "../../../../modules/designer/backend/net-identity/types";
import { loadSchematicSource } from "../../../../modules/designer/backend/projection-read";
import { deriveNetComponents } from "../../../../modules/designer/backend/projection-world";
import { sessionHistories } from "../../../../modules/designer/backend/schema";
import { buildDrcContext } from "../../../../shared/drc/drc-context";
import { checkNetBinding } from "../../../../shared/drc/checks/net-binding";
import { anchorKey } from "../../../../shared/drc/violation-id";
import { getSharedDb } from "../../db/sqlite-client";
import { identityState, type IdentityRuntime } from "./net-identity-runtime";
import { rawReferenceSignature } from "./net-identity-property-runtime";

function partition(projection: DesignerSchematicProjection): string {
  return JSON.stringify(projection.nets.map((net) => JSON.stringify([...net.pinIds].sort())).sort());
}

export async function observeIdentity(runtime: IdentityRuntime, designId: string) {
  const schematic = (await runtime.store.getSchematicProjection(designId))!, pcb = (await runtime.store.getPcbProjection(designId))!;
  return { schematic, pcb, state: identityState(designId), references: rawReferenceSignature(designId) };
}
export type IdentityObservation = Awaited<ReturnType<typeof observeIdentity>>;

function orphanAnchors(observation: IdentityObservation): string[] {
  const active = new Set(observation.schematic.nets.map((net) => net.id)), source = loadNetReferenceSource(getSharedDb(), observation.state.designId);
  const expected: DrcAnchor[] = [];
  const inactive = (row: { netId: string | null; netName?: string | null }) => row.netId !== null ? !active.has(row.netId) : !!row.netName?.trim();
  for (const row of source.traces) if (inactive(row)) expected.push({ kind: "trace", traceId: row.id });
  for (const row of source.vias) if (inactive(row)) expected.push({ kind: "via", viaId: row.id });
  for (const row of source.freePads) if (inactive(row)) expected.push({ kind: "freePad", freePadId: row.id });
  for (const row of source.zones) if (row.enabled && inactive(row)) expected.push({ kind: "zone", zoneId: row.id });
  return [...new Set(expected.map(anchorKey))].sort();
}

export function assertIdentityInvariants(observation: IdentityObservation, minimumSeq: number): void {
  const { state, schematic, pcb } = observation, ids = state.active.map((net) => net.id);
  const members = state.active.flatMap((net) => net.members.map((member) => JSON.stringify([member.kind, member.id])));
  const names = schematic.nets.map((net) => net.name.trim().toUpperCase());
  const ledger = readNetIdentityRetired(getSharedDb(), state.designId);
  const histories = getSharedDb().select().from(sessionHistories).where(eq(sessionHistories.designId, state.designId)).all();
  const persisted = JSON.stringify({ state, ledger, histories, references: observation.references });
  expect({ monotonic: state.nextSeq >= minimumSeq, uniqueIds: new Set(ids).size === ids.length,
    durableOnly: ids.every((id) => isDurableNetIdOf(id, state.designId) && seqOf(id)! < state.nextSeq),
    uniqueOwnership: new Set(members).size === members.length, uniqueNames: new Set(names).size === names.length,
    noPending: !persisted.includes("pending:") && !persisted.includes("Net_pending_") }).toEqual({
    monotonic: true, uniqueIds: true, durableOnly: true, uniqueOwnership: true, uniqueNames: true, noPending: true,
  });
  const actual = checkNetBinding(buildDrcContext(pcb)).flatMap((draft) => draft.anchors.map(anchorKey)).sort();
  expect(actual).toEqual(orphanAnchors(observation));
  expect(pcb.netIdentity!.orphanedCopperCount).toBe(actual.length);
}

export function assertIdentityTransition(before: IdentityObservation, after: IdentityObservation, issued: Set<string>, replay: boolean): void {
  assertIdentityInvariants(after, before.state.nextSeq);
  const previous = new Set(before.state.active.map((net) => net.id));
  const added = after.state.active.filter((net) => !previous.has(net.id));
  if (!replay) expect(added.filter((net) => issued.has(net.id) || seqOf(net.id)! < before.state.nextSeq).map((net) => net.id)).toEqual([]);
  for (const net of after.state.active) issued.add(net.id);
  if (!replay && partition(before.schematic) === partition(after.schematic)) {
    const byPins = new Map(after.schematic.nets.map((net) => [JSON.stringify([...net.pinIds].sort()), net.id]));
    const previousDurable = before.schematic.nets.filter((net) => net.pinIds.length && isDurableNetIdOf(net.id, before.state.designId));
    expect(previousDurable.map((net) => byPins.get(JSON.stringify([...net.pinIds].sort())))).toEqual(previousDurable.map((net) => net.id));
  }
  expect(after.references).toBe(before.references);
}

export function assertObservedBinderPermutation(observation: IdentityObservation): void {
  const source = loadSchematicSource(getSharedDb(), observation.state.designId)!;
  const derived = deriveNetComponents(source.parts, source.wires, source.labels, source.primitives);
  const labels = new Map(source.parts.flatMap((part) => part.pins.map((pin) => [pin.id, pin.number ? `${part.reference}-${pin.number}` : pin.id] as const)));
  const bound = bindNetIdentity({ components: [...derived.components].reverse().map((component) => ({ ...component,
    pinIds: [...component.pinIds].reverse(), wireIds: [...component.wireIds].reverse(), labelIds: [...component.labelIds].reverse(), primitiveIds: [...component.primitiveIds].reverse() })),
  previousActive: [...observation.state.active].reverse().map((net) => ({ ...net, members: [...net.members].reverse() })),
  salt: designNetSalt(observation.state.designId), seqWatermark: observation.state.nextSeq, mode: "commit", pinLabel: (id) => labels.get(id),
  dependentCount: () => { throw new Error("observed committed membership must use exact binder fast path"); } });
  expect({ inSync: bound.inSync, created: bound.createdIds, nextSeq: bound.nextSeq }).toEqual({ inSync: true, created: [], nextSeq: observation.state.nextSeq });
  const map = (nets: Array<{ id: string; name: string; pinIds: string[] }>) => nets.map((net) => [net.id, net.name, [...net.pinIds].sort()]).sort((first, second) => String(first[0]) < String(second[0]) ? -1 : 1);
  expect(map(bound.nets)).toEqual(map(observation.schematic.nets));
}
