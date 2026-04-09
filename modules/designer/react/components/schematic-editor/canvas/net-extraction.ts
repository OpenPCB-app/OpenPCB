import type {
  EditorSchematicSymbol,
  NetLabelEntity,
  Point,
  WireEntity,
} from "../types";
import { transformSymbolLocalPoint } from "./symbols";
import { UnionFind } from "../../../lib/union-find";

export interface ExtractedNet {
  id: string;
  name: string | null;
  pinIds: string[];
  symbolIds: string[];
  wireIds: string[];
  labelIds: string[];
}

interface PinInfo {
  id: string;
  symbolId: string;
  position: Point;
  isPowerSymbol: boolean;
  powerNetName: string | null;
}

function makePosKey(point: Point): string {
  return `${point.x}:${point.y}`;
}

function buildPinIndex(symbols: EditorSchematicSymbol[]): {
  pins: PinInfo[];
  pinIdToIndex: Map<string, number>;
  positionToPinIndices: Map<string, number[]>;
} {
  const pins: PinInfo[] = [];
  const pinIdToIndex = new Map<string, number>();
  const positionToPinIndices = new Map<string, number[]>();

  for (const symbol of symbols) {
    const isPowerSymbol =
      symbol.componentId?.startsWith("builtin:gnd") === true ||
      symbol.componentId?.startsWith("builtin:vcc") === true ||
      symbol.reference?.startsWith("#PWR") === true;

    let powerNetName: string | null = null;
    if (isPowerSymbol) {
      if (symbol.componentId?.startsWith("builtin:gnd")) {
        powerNetName = "GND";
      } else if (symbol.componentId?.startsWith("builtin:vcc")) {
        powerNetName = "VCC";
      }
    }

    for (const pin of symbol.pins) {
      const worldPos = transformSymbolLocalPoint(symbol, pin.position);
      const pinId = `${symbol.id}-${pin.id}`;
      const index = pins.length;

      pins.push({
        id: pinId,
        symbolId: symbol.id,
        position: worldPos,
        isPowerSymbol,
        powerNetName,
      });

      pinIdToIndex.set(pinId, index);

      const posKey = makePosKey(worldPos);
      const existing = positionToPinIndices.get(posKey) ?? [];
      existing.push(index);
      positionToPinIndices.set(posKey, existing);
    }
  }

  return { pins, pinIdToIndex, positionToPinIndices };
}

function buildWireEndpointIndex(wires: WireEntity[]): {
  wireIdToEndpoints: Map<string, Point[]>;
  positionToWireIds: Map<string, string[]>;
} {
  const wireIdToEndpoints = new Map<string, Point[]>();
  const positionToWireIds = new Map<string, string[]>();

  for (const wire of wires) {
    const endpoints: Point[] = [];

    const firstPoint = wire.points[0];
    const lastPoint = wire.points[wire.points.length - 1];

    if (firstPoint) endpoints.push(firstPoint);
    if (lastPoint && wire.points.length > 1) endpoints.push(lastPoint);

    wireIdToEndpoints.set(wire.id, endpoints);

    for (const point of endpoints) {
      const posKey = makePosKey(point);
      const existing = positionToWireIds.get(posKey) ?? [];
      existing.push(wire.id);
      positionToWireIds.set(posKey, existing);
    }
  }

  return { wireIdToEndpoints, positionToWireIds };
}

export function extractNets(
  symbols: EditorSchematicSymbol[],
  wires: WireEntity[],
  netLabels: NetLabelEntity[],
): ExtractedNet[] {
  const { pins, pinIdToIndex, positionToPinIndices } = buildPinIndex(symbols);
  const { positionToWireIds } = buildWireEndpointIndex(wires);

  if (pins.length === 0) {
    return [];
  }

  const uf = new UnionFind(pins.length);

  // Step 1: Union pins connected by wire pin ID references
  for (const wire of wires) {
    const sourceIndex = wire.sourcePinId
      ? pinIdToIndex.get(wire.sourcePinId)
      : undefined;
    const targetIndex = wire.targetPinId
      ? pinIdToIndex.get(wire.targetPinId)
      : undefined;

    if (sourceIndex !== undefined && targetIndex !== undefined) {
      uf.union(sourceIndex, targetIndex);
    }
  }

  // Step 2: Union pins at wire endpoints (coordinate matching)
  // If a wire endpoint is at a pin position, that pin is connected to the wire
  for (const wire of wires) {
    const firstPoint = wire.points[0];
    const lastPoint = wire.points[wire.points.length - 1];
    const endpoints = [firstPoint, lastPoint].filter(Boolean) as Point[];

    const wirePinIndices: number[] = [];

    // Collect pins connected by pin ID references
    if (wire.sourcePinId) {
      const idx = pinIdToIndex.get(wire.sourcePinId);
      if (idx !== undefined) wirePinIndices.push(idx);
    }
    if (wire.targetPinId) {
      const idx = pinIdToIndex.get(wire.targetPinId);
      if (idx !== undefined) wirePinIndices.push(idx);
    }

    // Collect pins at wire endpoints by coordinate
    for (const endpoint of endpoints) {
      const posKey = makePosKey(endpoint);
      const pinIndicesAtPos = positionToPinIndices.get(posKey);
      if (pinIndicesAtPos) {
        for (const idx of pinIndicesAtPos) {
          if (!wirePinIndices.includes(idx)) {
            wirePinIndices.push(idx);
          }
        }
      }
    }

    // Union all pins connected to this wire
    for (let i = 1; i < wirePinIndices.length; i++) {
      uf.union(wirePinIndices[0]!, wirePinIndices[i]!);
    }
  }

  // Step 3: Union wire junctions (multiple wire endpoints at same coordinate)
  // Connect pins that share a common wire endpoint position
  for (const [posKey, wireIds] of positionToWireIds) {
    if (wireIds.length < 2) continue;

    // Find all pins connected to any of these wires
    const connectedPinIndices: number[] = [];
    const pinIndicesAtPos = positionToPinIndices.get(posKey) ?? [];
    connectedPinIndices.push(...pinIndicesAtPos);

    // Also check wire pin IDs
    for (const wireId of wireIds) {
      const wire = wires.find((w) => w.id === wireId);
      if (!wire) continue;

      if (wire.sourcePinId) {
        const idx = pinIdToIndex.get(wire.sourcePinId);
        if (idx !== undefined && !connectedPinIndices.includes(idx)) {
          connectedPinIndices.push(idx);
        }
      }
      if (wire.targetPinId) {
        const idx = pinIdToIndex.get(wire.targetPinId);
        if (idx !== undefined && !connectedPinIndices.includes(idx)) {
          connectedPinIndices.push(idx);
        }
      }
    }

    // Union all connected pins
    for (let i = 1; i < connectedPinIndices.length; i++) {
      uf.union(connectedPinIndices[0]!, connectedPinIndices[i]!);
    }
  }

  // Step 4: Track net label names per group
  const labelNamesByRoot = new Map<
    number,
    { name: string; labelIds: string[] }
  >();
  const labelNameToRoots = new Map<string, number[]>();

  for (const label of netLabels) {
    const posKey = makePosKey(label.position);
    const pinIndicesAtPos = positionToPinIndices.get(posKey);

    let rootForLabel: number | null = null;

    if (pinIndicesAtPos && pinIndicesAtPos.length > 0) {
      rootForLabel = uf.find(pinIndicesAtPos[0]!);
    } else {
      // Check if label is at a wire endpoint (not directly on a pin)
      const wireIdsAtPos = positionToWireIds.get(posKey);
      if (wireIdsAtPos && wireIdsAtPos.length > 0) {
        // Find any pin connected to these wires
        for (const wireId of wireIdsAtPos) {
          const wire = wires.find((w) => w.id === wireId);
          if (!wire) continue;

          if (wire.sourcePinId) {
            const idx = pinIdToIndex.get(wire.sourcePinId);
            if (idx !== undefined) {
              rootForLabel = uf.find(idx);
              break;
            }
          }
          if (wire.targetPinId) {
            const idx = pinIdToIndex.get(wire.targetPinId);
            if (idx !== undefined) {
              rootForLabel = uf.find(idx);
              break;
            }
          }
        }
      }
    }

    if (rootForLabel !== null && label.text) {
      const existing = labelNamesByRoot.get(rootForLabel);
      if (existing) {
        existing.labelIds.push(label.id);
      } else {
        labelNamesByRoot.set(rootForLabel, {
          name: label.text,
          labelIds: [label.id],
        });
      }

      const existingRoots = labelNameToRoots.get(label.text) ?? [];
      if (!existingRoots.includes(rootForLabel)) {
        existingRoots.push(rootForLabel);
        labelNameToRoots.set(label.text, existingRoots);
      }
    }
  }

  // Step 5: Merge groups with the same net label name
  for (const [, roots] of labelNameToRoots) {
    for (let i = 1; i < roots.length; i++) {
      // Find representative pins from each root group
      const groups = uf.groups();
      const group0 = groups.get(roots[0]!);
      const groupI = groups.get(roots[i]!);

      if (group0 && group0.length > 0 && groupI && groupI.length > 0) {
        uf.union(group0[0]!, groupI[0]!);
      }
    }
  }

  // Step 6: Handle power symbols - merge all GND pins, all VCC pins
  const powerNetRoots = new Map<string, number[]>();
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i]!;
    if (pin.powerNetName) {
      const root = uf.find(i);
      const existing = powerNetRoots.get(pin.powerNetName) ?? [];
      if (!existing.includes(root)) {
        existing.push(root);
        powerNetRoots.set(pin.powerNetName, existing);
      }
    }
  }

  for (const [, roots] of powerNetRoots) {
    for (let i = 1; i < roots.length; i++) {
      const groups = uf.groups();
      const group0 = groups.get(roots[0]!);
      const groupI = groups.get(roots[i]!);

      if (group0 && group0.length > 0 && groupI && groupI.length > 0) {
        uf.union(group0[0]!, groupI[0]!);
      }
    }
  }

  // Step 7: Collect final groups and build ExtractedNet[]
  const finalGroups = uf.groups();
  const extractedNets: ExtractedNet[] = [];
  let autoNetCounter = 1;

  for (const [root, pinIndices] of finalGroups) {
    const netPinIds: string[] = [];
    const netSymbolIds = new Set<string>();
    let netName: string | null = null;
    const netLabelIds: string[] = [];

    for (const pinIndex of pinIndices) {
      const pin = pins[pinIndex]!;
      netPinIds.push(pin.id);
      netSymbolIds.add(pin.symbolId);

      // Check for power net name
      if (pin.powerNetName && !netName) {
        netName = pin.powerNetName;
      }
    }

    // Check for label name
    const labelInfo = labelNamesByRoot.get(root);
    if (labelInfo) {
      netName = labelInfo.name;
      netLabelIds.push(...labelInfo.labelIds);
    }

    // Also check all label roots - after merging, old roots may belong to this group
    for (const [oldRoot, info] of labelNamesByRoot) {
      if (oldRoot === root) continue;
      const currentRoot = uf.find(oldRoot);
      if (currentRoot === uf.find(root)) {
        if (!netName) netName = info.name;
        for (const lid of info.labelIds) {
          if (!netLabelIds.includes(lid)) {
            netLabelIds.push(lid);
          }
        }
      }
    }

    // Collect wire IDs for this net
    const netWireIds = new Set<string>();
    for (const pinIndex of pinIndices) {
      const pin = pins[pinIndex]!;

      // Find wires connected to this pin by ID
      for (const wire of wires) {
        if (wire.sourcePinId === pin.id || wire.targetPinId === pin.id) {
          netWireIds.add(wire.id);
        }
      }

      // Find wires at this pin's position
      const posKey = makePosKey(pin.position);
      const wireIdsAtPos = positionToWireIds.get(posKey);
      if (wireIdsAtPos) {
        for (const wireId of wireIdsAtPos) {
          netWireIds.add(wireId);
        }
      }
    }

    // Auto-name if no explicit name
    const finalName = netName ?? `Net_${autoNetCounter++}`;

    extractedNets.push({
      id: `net:${finalName}`,
      name: finalName,
      pinIds: netPinIds.sort(),
      symbolIds: [...netSymbolIds].sort(),
      wireIds: [...netWireIds].sort(),
      labelIds: netLabelIds.sort(),
    });
  }

  // Sort nets by name for deterministic output
  extractedNets.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return extractedNets;
}
