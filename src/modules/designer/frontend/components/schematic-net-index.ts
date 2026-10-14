// Pure helpers for schematic net highlight: element id -> net id lookup built
// from the same projection.nets that ERC/netlist consume.

export interface NetIndexSource {
  nets: ReadonlyArray<{
    id: string;
    pinIds: readonly string[];
    wireIds: readonly string[];
    labelIds: readonly string[];
    primitiveIds: readonly string[];
  }>;
}

export interface SchematicNetIndex {
  pin: ReadonlyMap<string, string>;
  wire: ReadonlyMap<string, string>;
  label: ReadonlyMap<string, string>;
  primitive: ReadonlyMap<string, string>;
  netIds: ReadonlySet<string>;
}

export function buildSchematicNetIndex(
  source: NetIndexSource | null,
): SchematicNetIndex {
  const pin = new Map<string, string>();
  const wire = new Map<string, string>();
  const label = new Map<string, string>();
  const primitive = new Map<string, string>();
  const netIds = new Set<string>();
  for (const net of source?.nets ?? []) {
    netIds.add(net.id);
    for (const id of net.pinIds) pin.set(id, net.id);
    for (const id of net.wireIds) wire.set(id, net.id);
    for (const id of net.labelIds) label.set(id, net.id);
    for (const id of net.primitiveIds) primitive.set(id, net.id);
  }
  return { pin, wire, label, primitive, netIds };
}

/** Synthetic primitive pins use id `primitive:<id>`; resolve them too. */
export function netOfPin(index: SchematicNetIndex, pinId: string): string | null {
  const direct = index.pin.get(pinId);
  if (direct) return direct;
  if (pinId.startsWith("primitive:")) {
    return index.primitive.get(pinId.slice("primitive:".length)) ?? null;
  }
  return null;
}

export interface NetSelection {
  wireIds: ReadonlySet<string>;
  labelIds: ReadonlySet<string>;
  primitiveIds: ReadonlySet<string>;
}

/**
 * Net to pin for a selection: exactly one wire/label/primitive selected (parts
 * ignored) -> its net; otherwise null.
 */
export function netOfSelection(
  index: SchematicNetIndex,
  selection: NetSelection,
): string | null {
  const total =
    selection.wireIds.size + selection.labelIds.size + selection.primitiveIds.size;
  if (total !== 1) return null;
  for (const id of selection.wireIds) return index.wire.get(id) ?? null;
  for (const id of selection.labelIds) return index.label.get(id) ?? null;
  for (const id of selection.primitiveIds) return index.primitive.get(id) ?? null;
  return null;
}
