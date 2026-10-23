import type {
  DesignerNetDependents, DesignerNetIdentityEvent, DesignerNetIdentityOutcome,
} from "../../../../sdks/designer";
import { asRecord } from "../value-guards";

type NamedNet = { netId: string; netName: string };
type CountedNet = NamedNet & { pinCount: number };
type RetiredNet = CountedNet & { dependents: DesignerNetDependents };
type Predecessor = NamedNet & { retired: boolean; dependents: DesignerNetDependents };

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function list<T>(raw: unknown, parse: (value: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: T[] = [];
  for (const value of raw) {
    const parsed = parse(value);
    if (parsed === undefined) return undefined;
    result.push(parsed);
  }
  return result;
}

function unique<T>(values: readonly T[], key: (value: T) => string): boolean {
  return new Set(values.map(key)).size === values.length;
}

function ids(raw: unknown): string[] | undefined {
  const result = list(raw, (value) => nonblank(value) ? value : undefined);
  return result && unique(result, (id) => id) ? result : undefined;
}

function dependents(raw: unknown): DesignerNetDependents | undefined {
  const value = asRecord(raw);
  if (!value || !count(value.traces) || !count(value.vias) || !count(value.zones) ||
    !count(value.freePads) || typeof value.netClassAssignment !== "boolean") return undefined;
  const lengthGroupIds = ids(value.lengthGroupIds);
  const diffPairIds = ids(value.diffPairIds);
  const drcRuleIds = ids(value.drcRuleIds);
  if (!lengthGroupIds || !diffPairIds || !drcRuleIds) return undefined;
  return {
    traces: value.traces, vias: value.vias, zones: value.zones, freePads: value.freePads,
    netClassAssignment: value.netClassAssignment, lengthGroupIds, diffPairIds, drcRuleIds,
  };
}

function hasDependents(value: DesignerNetDependents): boolean {
  return value.traces > 0 || value.vias > 0 || value.zones > 0 || value.freePads > 0 ||
    value.netClassAssignment || value.lengthGroupIds.length > 0 || value.diffPairIds.length > 0 || value.drcRuleIds.length > 0;
}

function namedNet(raw: unknown): NamedNet | undefined {
  const value = asRecord(raw);
  return value && nonblank(value.netId) && nonblank(value.netName)
    ? { netId: value.netId, netName: value.netName } : undefined;
}

function countedNet(raw: unknown): CountedNet | undefined {
  const value = asRecord(raw);
  const net = namedNet(raw);
  return value && net && count(value.pinCount) ? { ...net, pinCount: value.pinCount } : undefined;
}

function retiredNet(raw: unknown): RetiredNet | undefined {
  const value = asRecord(raw);
  const net = countedNet(raw);
  const refs = dependents(value?.dependents);
  return net && refs ? { ...net, dependents: refs } : undefined;
}

function predecessor(raw: unknown): Predecessor | undefined {
  const value = asRecord(raw);
  const net = namedNet(raw);
  const refs = dependents(value?.dependents);
  return value && net && refs && typeof value.retired === "boolean"
    ? { ...net, retired: value.retired, dependents: refs } : undefined;
}

function split(value: Record<string, unknown>): DesignerNetIdentityEvent | undefined {
  const net = namedNet(value);
  const refs = dependents(value.dependents);
  const newNets = list(value.newNets, countedNet);
  if (!net || !refs || !count(value.keptPinCount) || !newNets || typeof value.hasDependents !== "boolean" ||
    !unique(newNets, (item) => item.netId) || newNets.some((item) => item.netId === net.netId) ||
    value.hasDependents !== hasDependents(refs)) return undefined;
  return { kind: "split", ...net, keptPinCount: value.keptPinCount,
    hasDependents: value.hasDependents, newNets, dependents: refs };
}

function merge(value: Record<string, unknown>): DesignerNetIdentityEvent | undefined {
  const retired = list(value.retired, retiredNet);
  if (!nonblank(value.survivorNetId) || !nonblank(value.survivorName) || !retired || typeof value.hasDependents !== "boolean" ||
    !unique(retired, (item) => item.netId) || retired.some((item) => item.netId === value.survivorNetId) ||
    value.hasDependents !== retired.some((item) => hasDependents(item.dependents))) return undefined;
  return { kind: "merge", survivorNetId: value.survivorNetId, survivorName: value.survivorName,
    hasDependents: value.hasDependents, retired };
}

function reconfigure(value: Record<string, unknown>): DesignerNetIdentityEvent | undefined {
  const predecessors = list(value.predecessors, predecessor);
  const successors = list(value.successors, namedNet);
  if (!predecessors || !successors || typeof value.hasDependents !== "boolean" || !unique(predecessors, (item) => item.netId) ||
    !unique(successors, (item) => item.netId) ||
    value.hasDependents !== predecessors.some((item) => item.retired && hasDependents(item.dependents))) return undefined;
  return { kind: "reconfigure", hasDependents: value.hasDependents, predecessors, successors };
}

function event(raw: unknown): DesignerNetIdentityEvent | undefined {
  const value = asRecord(raw);
  if (!value) return undefined;
  if (value.kind === "split") return split(value);
  if (value.kind === "merge") return merge(value);
  if (value.kind === "reconfigure") return reconfigure(value);
  if (value.kind !== "removed") return undefined;
  const net = namedNet(value);
  const refs = dependents(value.dependents);
  return net && refs && value.hasDependents === true && hasDependents(refs)
    ? { kind: "removed", ...net, hasDependents: true, dependents: refs } : undefined;
}

/** Reject incomplete outcomes rather than replaying a misleading subset of net changes. */
export function parseNetIdentityOutcome(raw: unknown): DesignerNetIdentityOutcome | undefined {
  const value = asRecord(raw);
  const events = list(value?.events, event);
  return events ? { events } : undefined;
}
