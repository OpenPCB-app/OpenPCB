import type { BindInput, BoundNet } from "./bind";
import { compareText, type CanonicalComponent } from "./bind-input";
import { isDurableNetId, seqOf, type ActiveNetRecord, type NetNameSource } from "./types";
import { requireValid } from "./validation";

export function compareNetIds(first: string, second: string): number {
  const category = (id: string): number => isDurableNetId(id) ? 0 : id.startsWith("nc:") ? 1 : 2;
  const rank = category(first) - category(second);
  if (rank) return rank;
  if (isDurableNetId(first)) return seqOf(first)! - seqOf(second)! || compareText(first, second);
  if (first.startsWith("nc:")) return compareText(first.slice(3), second.slice(3));
  return Number(first.slice(8)) - Number(second.slice(8));
}

function generatedName(id: string, component: CanonicalComponent, input: BindInput): string {
  const seq = seqOf(id);
  if (seq !== null) return `Net_${seq}`;
  if (id.startsWith("pending:")) return `Net_pending_${id.slice(8)}`;
  const pinId = component.component.pinIds[0]!;
  const label = input.pinLabel(pinId);
  requireValid(label === undefined || typeof label === "string" && label.trim().length > 0, "pinLabel", "must return a non-blank string or undefined");
  return `unconnected-(${label ?? pinId})`;
}

export function nameBoundNets(
  components: readonly CanonicalComponent[],
  ids: ReadonlyMap<string, string>,
  previous: readonly ActiveNetRecord[],
  input: BindInput,
): BoundNet[] {
  const records = new Map(previous.map((record) => [record.id, record]));
  const candidates = components.map((component) => {
    const source = component.component, id = ids.get(source.key)!;
    const override = records.get(id)?.displayOverride;
    const named = source.derivedName !== null;
    const nameSource: NetNameSource = named ? source.nameSource : override !== undefined ? "override" : "auto";
    const net: BoundNet = {
      id, name: source.derivedName ?? override ?? generatedName(id, component, input),
      autoNamed: nameSource === "auto", nameSource, legacyRoot: source.key,
      pinIds: [...source.pinIds], wireIds: [...source.wireIds],
      labelIds: [...source.labelIds], primitiveIds: [...source.primitiveIds],
    };
    return { net, tier: named ? 0 : override !== undefined ? 1 : 2 };
  }).sort((a, b) => a.tier - b.tier || compareNetIds(a.net.id, b.net.id));
  const used = new Set<string>();
  for (const { net } of candidates) {
    const base = net.name;
    let suffix = 0;
    while (used.has(net.name.toUpperCase())) net.name = `${base}_${++suffix}`;
    used.add(net.name.toUpperCase());
  }
  return candidates.map(({ net }) => net).sort((a, b) => compareNetIds(a.id, b.id));
}

export function activeRecords(
  nets: readonly BoundNet[],
  components: readonly CanonicalComponent[],
  previous: readonly ActiveNetRecord[],
): ActiveNetRecord[] {
  const byRoot = new Map(components.map((entry) => [entry.component.key, entry]));
  const byId = new Map(previous.map((record) => [record.id, record]));
  return nets.filter((net) => isDurableNetId(net.id)).map((net) => ({
    id: net.id, name: net.name, nameSource: net.nameSource,
    members: byRoot.get(net.legacyRoot)!.members.map((member) => ({ ...member })),
    ...(byId.get(net.id)?.displayOverride === undefined ? {} : { displayOverride: byId.get(net.id)!.displayOverride }),
  }));
}
