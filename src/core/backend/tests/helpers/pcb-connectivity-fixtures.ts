/**
 * Shared fixture helpers for the pcb-connectivity test suite
 * (pcb-connectivity-touch/-contacts/-graph.test.ts). No test code here.
 */
import {
  buildCopperRecords,
  copperTouch,
  endCapTouches,
  sharedLayers,
  toCopperItems,
  viaTouchesOnLayer,
  type ConnectivityResult,
  type CopperPadAnchor,
  type CopperItem,
  type CopperRecordsInput,
} from "../../../../shared/pcb-connectivity";
import { CONNECT_EPS_MM } from "../../../../shared/pcb-geometry/tolerance";
import type {
  PcbCopperLayerId,
  PcbFreePad,
  PcbLayerCount,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../../sdks/designer";
import { freePad, pad, placement, trace, via } from "./drc-fixtures";

export function input(parts: Partial<CopperRecordsInput> = {}): CopperRecordsInput {
  return {
    layerCount: (parts.layerCount ?? 2) as PcbLayerCount,
    placements: parts.placements ?? [],
    padNetIds: parts.padNetIds ?? new Map(),
    freePads: parts.freePads ?? [],
    traces: parts.traces ?? [],
    vias: parts.vias ?? [],
  };
}

export function buildItems(parts: Partial<CopperRecordsInput> = {}): CopperItem[] {
  return toCopperItems(buildCopperRecords(input(parts)));
}

export function byKey(items: CopperItem[], key: string): CopperItem {
  const found = items.find((i) => i.key === key);
  if (!found) throw new Error(`missing item ${key}`);
  return found;
}

/** Square pad `id|1` of `size` mm centred at (x, y), net `n1` unless given. */
export function padPart(
  id: string,
  x: number,
  y: number,
  size = 1,
  opts: { layer?: string; drillDiameterMm?: number; placementLayer?: PcbPlacedPart["layer"] } = {},
): PcbPlacedPart {
  return placement(id, {
    positionMm: { x, y },
    ...(opts.placementLayer ? { layer: opts.placementLayer } : {}),
    pads: [
      pad("1", { x: 0, y: 0 }, size, size, {
        ...(opts.layer !== undefined ? { layer: opts.layer } : {}),
        ...(opts.drillDiameterMm !== undefined
          ? { drillDiameterMm: opts.drillDiameterMm }
          : {}),
      }),
    ],
  });
}

export function padAnchorOf(item: CopperItem): CopperPadAnchor {
  if (item.kind !== "pad") throw new Error(`${item.key} is not a pad item`);
  return item.anchor;
}

export function componentKeys(result: ConnectivityResult): string[][] {
  return result.components.map((c) => [...c.itemKeys]);
}

export function square(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): PcbPointMm[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export function serialize(result: ConnectivityResult): string {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return JSON.stringify({
    components: result.components,
    componentOf: [...result.componentOf.entries()].sort((a, b) => cmp(a[0], b[0])),
    endpointContacts: [...result.endpointContacts.entries()]
      .sort((a, b) => cmp(a[0], b[0]))
      .map(([key, caps]) => [key, [...caps[0]].sort(), [...caps[1]].sort()]),
    viaLayerContacts: [...result.viaLayerContacts.entries()]
      .sort((a, b) => cmp(a[0], b[0]))
      .map(([key, perLayer]) => [
        key,
        [...perLayer.entries()]
          .sort((a, b) => cmp(a[0], b[0]))
          .map(([layer, keys]) => [layer, [...keys].sort()]),
      ]),
  });
}

/** Deterministic PRNG so a failure is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBoard(seed: number): CopperItem[] {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const coord = () => Math.round(rnd() * 2000) / 100; // 0..20 mm, 10 µm grid
  const netIds = ["n1", "n2", null] as const;
  const layers: PcbCopperLayerId[] = ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"];

  const placements: PcbPlacedPart[] = [];
  const padNetIds = new Map<string, string>();
  for (let i = 0; i < 20; i += 1) {
    const id = `U${i}`;
    const drilled = rnd() < 0.3;
    placements.push(
      placement(id, {
        positionMm: { x: coord(), y: coord() },
        rotationDeg: pick([0, 45, 90, 180]),
        layer: pick(["F.Cu", "B.Cu"] as const),
        pads: [
          pad("1", { x: 0, y: 0 }, 1.2, 0.8, {
            shape: pick(["rect", "circle", "oval"] as const),
            ...(drilled ? { drillDiameterMm: 0.5 } : {}),
          }),
        ],
      }),
    );
    const net = pick(netIds);
    if (net) padNetIds.set(`${id}|1`, net);
  }

  const freePads: PcbFreePad[] = [];
  for (let i = 0; i < 5; i += 1) {
    freePads.push(
      freePad(`fp${i}`, {
        padType: pick(["smd", "std", "conn"] as const),
        center: { x: coord(), y: coord() },
        widthMm: 1,
        heightMm: 1,
        drillMm: 0.5,
        layer: pick(layers),
        netId: pick(netIds),
      }),
    );
  }

  const traces: PcbTrace[] = [];
  for (let i = 0; i < 25; i += 1) {
    const pts: Array<[number, number]> = [[coord(), coord()], [coord(), coord()]];
    if (rnd() < 0.4) pts.push([coord(), coord()]);
    traces.push(
      trace(`t${i}`, pick(netIds), pts, {
        widthMm: pick([0.15, 0.25, 0.5]),
        layer: pick(layers),
      }),
    );
  }

  const vias: PcbVia[] = [];
  for (let i = 0; i < 10; i += 1) {
    const from = pick(layers.slice(0, 3));
    const to = pick(layers.slice(layers.indexOf(from) + 1));
    vias.push(
      via(`v${i}`, {
        netId: pick(netIds),
        center: { x: coord(), y: coord() },
        diameterMm: pick([0.6, 0.8, 1.2]),
        fromLayer: from,
        toLayer: to,
      }),
    );
  }

  return buildItems({ layerCount: 4, placements, padNetIds, freePads, traces, vias });
}

export const netsCompatible = (a: string | null, b: string | null): boolean =>
  a === b || a === null || b === null;

/**
 * Reference fold-back test, written straight from the contract: the cap at
 * `points[0]` contacts its own body when some non-incident segment carries a
 * point within `2·hw + eps` that is more than `2·hw` further along the
 * conductor than it is through the air.
 */
export function foldsBack(
  points: readonly PcbPointMm[],
  halfWidthMm: number,
  eps: number,
): boolean {
  const p = points[0]!;
  let arc = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (i > 0) {
      // Sample the segment densely instead of projecting — an independent way
      // of finding the closest point, so a projection bug cannot hide here.
      const steps = Math.max(200, Math.ceil(length * 2000));
      for (let k = 0; k <= steps; k += 1) {
        const t = k / steps;
        const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d <= 2 * halfWidthMm + eps && arc + length * t - d > 2 * halfWidthMm) {
          return true;
        }
      }
    }
    arc += length;
  }
  return false;
}

/** All-pairs reference: no bounds prefilter, no sweep window. */
export function bruteForce(items: readonly CopperItem[]): ConnectivityResult {
  const eps = CONNECT_EPS_MM;
  const sorted = [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    return r;
  };
  const endpointContacts = new Map<string, [Set<string>, Set<string>]>();
  const viaLayerContacts = new Map<string, Map<PcbCopperLayerId, Set<string>>>();
  for (const item of sorted) {
    if (item.kind === "trace") endpointContacts.set(item.key, [new Set(), new Set()]);
    if (item.kind === "via") {
      viaLayerContacts.set(
        item.key,
        new Map(item.layers.map((l) => [l, new Set<string>()])),
      );
    }
  }
  const record = (a: CopperItem, b: CopperItem, layer: PcbCopperLayerId) => {
    if (a.netId !== null && a.netId !== b.netId) return;
    if (a.kind === "trace") {
      const caps = endpointContacts.get(a.key)!;
      if (endCapTouches(a, 0, b, eps)) caps[0].add(b.key);
      if (endCapTouches(a, 1, b, eps)) caps[1].add(b.key);
    } else if (a.kind === "via" && viaTouchesOnLayer(a, b, layer, eps)) {
      viaLayerContacts.get(a.key)!.get(layer)!.add(b.key);
    }
  };
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (!netsCompatible(a.netId, b.netId)) continue;
      for (const layer of sharedLayers(a, b)) {
        record(a, b, layer);
        record(b, a, layer);
      }
      if (sharedLayers(a, b).length === 0) continue;
      if (a.netId !== null && a.netId === b.netId && copperTouch(a, b, eps)) {
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
      }
    }
  }
  for (const item of sorted) {
    if (item.kind !== "pour") continue;
    const index = sorted.indexOf(item);
    for (const memberKey of item.memberKeys) {
      const other = sorted.findIndex((i) => i.key === memberKey);
      if (other < 0 || sorted[other]!.netId !== item.netId) continue;
      const ra = find(index);
      const rb = find(other);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  for (const item of sorted) {
    if (item.kind !== "trace" || item.pointsMm.length < 3) continue;
    const caps = endpointContacts.get(item.key)!;
    if (foldsBack(item.pointsMm, item.halfWidthMm, eps)) caps[0].add(item.key);
    if (foldsBack([...item.pointsMm].reverse(), item.halfWidthMm, eps)) {
      caps[1].add(item.key);
    }
  }
  const byRoot = new Map<number, { netId: string; itemKeys: string[] }>();
  sorted.forEach((item, index) => {
    if (item.netId === null) return;
    const root = find(index);
    const entry = byRoot.get(root);
    if (entry) entry.itemKeys.push(item.key);
    else byRoot.set(root, { netId: item.netId, itemKeys: [item.key] });
  });
  const components = [...byRoot.values()]
    .map((c) => ({ netId: c.netId, itemKeys: c.itemKeys.sort() }))
    .sort((a, b) =>
      a.netId !== b.netId
        ? a.netId < b.netId
          ? -1
          : 1
        : a.itemKeys[0]! < b.itemKeys[0]!
          ? -1
          : 1,
    )
    .map((c, id) => ({ id, ...c }));
  const componentOf = new Map<string, number>();
  for (const component of components) {
    for (const key of component.itemKeys) componentOf.set(key, component.id);
  }
  return { components, componentOf, endpointContacts, viaLayerContacts };
}
