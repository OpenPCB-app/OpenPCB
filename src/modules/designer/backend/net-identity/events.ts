import type { DesignerNetIdentityEvent } from "../../../../sdks/designer/net-identity";
import type { ElectricalNetTransition } from "../../../../shared/electrical-identity";
import type { BindResult, BoundNet } from "./bind";
import type { NetDependentsCensus } from "./census";
import { isDurableNetId, type ActiveNetRecord } from "./types";
import { requireValid } from "./validation";

interface EventContext {
  previous: ReadonlyMap<string, ActiveNetRecord>;
  nets: ReadonlyMap<string, BoundNet>;
  nextActive: ReadonlySet<string>;
  census: NetDependentsCensus;
}

function ordered(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function previous(context: EventContext, id: string): ActiveNetRecord {
  const record = context.previous.get(id);
  requireValid(record, "events.predecessor", `missing previous record ${id}`);
  return record;
}

function successor(context: EventContext, id: string): BoundNet {
  const net = context.nets.get(id);
  requireValid(net, "events.successor", `missing bound net ${id}`);
  return net;
}

function pinCount(record: ActiveNetRecord): number {
  return record.members.filter((member) => member.kind === "pin").length;
}

function splitEvent(transition: ElectricalNetTransition, context: EventContext): DesignerNetIdentityEvent {
  requireValid(transition.predecessorIds.length === 1 && transition.successorIds.length >= 2,
    "events.split", "requires one predecessor and at least two successors");
  const netId = transition.predecessorIds[0]!;
  const old = previous(context, netId);
  const kept = context.nets.get(netId);
  const newNets = ordered(transition.successorIds.filter((id) => id !== netId)).map((id) => {
    const net = successor(context, id);
    return { netId: id, netName: net.name, pinCount: net.pinIds.length };
  });
  return {
    kind: "split", netId, netName: old.name, keptPinCount: kept?.pinIds.length ?? 0,
    hasDependents: context.census.count(netId) > 0, newNets,
    dependents: context.census.get(netId),
  };
}

function mergeEvent(transition: ElectricalNetTransition, context: EventContext): DesignerNetIdentityEvent {
  requireValid(transition.predecessorIds.length >= 2 && transition.successorIds.length === 1,
    "events.merge", "requires at least two predecessors and one successor");
  const retained = transition.predecessorIds.filter((id) =>
    context.nextActive.has(id) && transition.successorIds.includes(id));
  const inherited = transition.inherited.map((row) => row.fromId).filter((id) =>
    context.nextActive.has(id) && transition.successorIds.includes(id));
  const survivors = [...new Set([...retained, ...inherited])];
  requireValid(survivors.length === 1 && transition.predecessorIds.includes(survivors[0]!),
    "events.merge", "requires exactly one inherited durable survivor");
  const survivorNetId = survivors[0]!;
  const survivorName = successor(context, survivorNetId).name;
  const retired = ordered(transition.predecessorIds.filter((id) => !context.nextActive.has(id))).map((netId) => {
    const old = previous(context, netId);
    return {
      netId, netName: old.name, pinCount: pinCount(old), dependents: context.census.get(netId),
    };
  });
  return {
    kind: "merge", survivorNetId, survivorName,
    hasDependents: retired.some((row) => context.census.count(row.netId) > 0), retired,
  };
}

function reconfigureEvent(transition: ElectricalNetTransition, context: EventContext): DesignerNetIdentityEvent {
  requireValid(transition.predecessorIds.length >= 2 && transition.successorIds.length >= 2,
    "events.reconfigure", "requires at least two predecessors and successors");
  const predecessors = ordered(transition.predecessorIds).map((netId) => ({
    netId, netName: previous(context, netId).name, retired: !context.nextActive.has(netId),
    dependents: context.census.get(netId),
  }));
  const successors = ordered(transition.successorIds).map((netId) => ({
    netId, netName: successor(context, netId).name,
  }));
  return {
    kind: "reconfigure", predecessors, successors,
    hasDependents: predecessors.some((row) => row.retired && context.census.count(row.netId) > 0),
  };
}

/** Durable transitions remain visible even when they have no dependent copper or rules. */
export function buildNetIdentityEvents(
  records: readonly ActiveNetRecord[], result: BindResult, census: NetDependentsCensus,
): DesignerNetIdentityEvent[] {
  const context: EventContext = {
    previous: new Map(records.map((record) => [record.id, record])),
    nets: new Map(result.nets.map((net) => [net.id, net])),
    nextActive: new Set(result.nextActive.map((record) => record.id)), census,
  };
  const events: DesignerNetIdentityEvent[] = [];
  for (const transition of result.transitions) {
    if (!transition.predecessorIds.some(isDurableNetId)) continue;
    switch (transition.kind) {
      case "split": events.push(splitEvent(transition, context)); break;
      case "merge": events.push(mergeEvent(transition, context)); break;
      case "reconfigure": events.push(reconfigureEvent(transition, context)); break;
    }
  }
  const transitioned = new Set(result.transitions.flatMap((transition) => [...transition.predecessorIds]));
  const removed = result.retirements.filter((row) => row.reason === "removed" &&
    isDurableNetId(row.id) && !transitioned.has(row.id));
  removed.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const row of removed) {
    if (census.count(row.id) === 0) continue;
    events.push({
      kind: "removed", netId: row.id, netName: previous(context, row.id).name,
      hasDependents: true, dependents: census.get(row.id),
    });
  }
  return events;
}
