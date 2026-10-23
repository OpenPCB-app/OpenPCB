import type { DesignerSchematicProjection, PcbTrace, PcbVia, PcbZone } from "../../../../sdks/designer";

interface LegacyCopperRows {
  traces: PcbTrace[];
  vias: PcbVia[];
  zones: PcbZone[];
}

interface LegacyNetBinding extends LegacyCopperRows {
  warnings: string[];
  ambiguousZoneIds: Set<string>;
}

function legacyNameIndex(schematic: DesignerSchematicProjection | null): {
  netIdByName: Map<string, string>; nameCounts: Map<string, number>;
} {
  const netIdByName = new Map<string, string>();
  const netNames = new Map<string, string>();
  if (schematic) {
    for (const net of schematic.nets) {
      netNames.set(net.id, net.name);
      if (!net.name) continue;
      const key = net.name.trim().toUpperCase();
      if (!netIdByName.has(key)) netIdByName.set(key, net.id);
    }
  }
  const nameCounts = new Map<string, number>();
  for (const name of netNames.values()) {
    const key = name.trim().toUpperCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  return { netIdByName, nameCounts };
}

/** Legacy projection-time hints retain their historical asymmetric ambiguity policy. */
export function bindLegacyNetNames(
  schematic: DesignerSchematicProjection | null,
  rows: LegacyCopperRows,
): LegacyNetBinding {
  const { netIdByName, nameCounts } = legacyNameIndex(schematic);
  // Trace/via hints retain first-match binding, including automatically named
  // nets. A present id always wins, even if it is stale.
  const bindNetName = <T extends { netId: string | null; netName?: string | null }>(entity: T): T => {
    if (entity.netId || !entity.netName) return entity;
    const resolved = netIdByName.get(entity.netName.trim().toUpperCase());
    if (!resolved) return entity;
    return { ...entity, netId: resolved };
  };
  const warnings: string[] = [];
  const ambiguousZoneIds = new Set<string>();
  const zones = rows.zones.map((zone) => {
    const key = zone.netName?.trim().toUpperCase() ?? "";
    // Zones stay unbound on a name collision, including disabled zone rows;
    // choosing one here would make their identity depend on schematic order.
    if (!zone.netId && key && (nameCounts.get(key) ?? 0) > 1) {
      ambiguousZoneIds.add(zone.id);
      warnings.push(`zone_net_ambiguous: Zone ${zone.id} net "${zone.netName}" matches more than one schematic net.`);
      return zone;
    }
    return bindNetName(zone);
  });
  return {
    traces: rows.traces.map(bindNetName),
    vias: rows.vias.map(bindNetName),
    zones, warnings, ambiguousZoneIds,
  };
}
