// The copper connectivity graph: items in, components + contact records out.
//
// Two items are joined when they share a net, share a copper layer, and their
// copper overlaps within `epsMm` (`CONNECT_EPS_MM` by default). Nothing else
// connects — no net-name special case, no cross-layer contact without a via,
// no bounding-box stand-in for a pad ring.
//
// Alongside the components the graph records CONTACTS: which items each trace
// end cap and each via span layer actually touches. Components alone cannot
// answer "is this endpoint a stub?", because a trace crossing another trace
// mid-body is electrically continuous yet still dangling at both ends.
//
// Complexity: candidates come from a per-layer sweep over bounds sorted by
// `minX`, so the exact (expensive) predicates only run on overlapping bounds.

import type { PcbCopperLayerId, PcbPointMm } from "../../sdks/designer";
import { CONNECT_EPS_MM } from "../pcb-geometry/tolerance";
import type { CopperItem } from "./copper-items";
import {
  boundsOverlap,
  copperTouch,
  endCapTouches,
  itemLayers,
  occupiesLayer,
  viaTouchesOnLayer,
} from "./touch";

export interface ConnectivityComponent {
  id: number;
  netId: string;
  /** Item keys, sorted. */
  itemKeys: readonly string[];
}

export interface ConnectivityResult {
  /** Sorted by `(netId, itemKeys[0])`; ids assigned in that order. */
  components: readonly ConnectivityComponent[];
  /** Item key → component id. Null-net items are absent. */
  componentOf: ReadonlyMap<string, number>;
  /** Trace key → keys touched by the start cap and by the end cap. */
  endpointContacts: ReadonlyMap<
    string,
    readonly [ReadonlySet<string>, ReadonlySet<string>]
  >;
  /** Via key → span layer → keys the barrel touches on that layer. */
  viaLayerContacts: ReadonlyMap<
    string,
    ReadonlyMap<PcbCopperLayerId, ReadonlySet<string>>
  >;
}

interface Contacts {
  endpoints: Map<string, [Set<string>, Set<string>]>;
  viaLayers: Map<string, Map<PcbCopperLayerId, Set<string>>>;
}

/** Same net, or at least one side unassigned — the gate for evaluating a pair. */
function netsCompatible(a: string | null, b: string | null): boolean {
  return a === b || a === null || b === null;
}

function findRoot(parent: number[], i: number): number {
  let root = i;
  while (parent[root] !== root) root = parent[root]!;
  let walk = i;
  while (parent[walk] !== root) {
    const next = parent[walk]!;
    parent[walk] = root;
    walk = next;
  }
  return root;
}

function unite(parent: number[], a: number, b: number): void {
  const ra = findRoot(parent, a);
  const rb = findRoot(parent, b);
  if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
}

function emptyContacts(items: readonly CopperItem[]): Contacts {
  const endpoints = new Map<string, [Set<string>, Set<string>]>();
  const viaLayers = new Map<string, Map<PcbCopperLayerId, Set<string>>>();
  for (const item of items) {
    if (item.kind === "trace") {
      endpoints.set(item.key, [new Set(), new Set()]);
    } else if (item.kind === "via") {
      const perLayer = new Map<PcbCopperLayerId, Set<string>>();
      for (const layer of item.layers) perLayer.set(layer, new Set());
      viaLayers.set(item.key, perLayer);
    }
  }
  return { endpoints, viaLayers };
}

/** Layer → indices of the items whose copper reaches it, sorted by `minX`. */
function groupByLayer(
  items: readonly CopperItem[],
): Map<PcbCopperLayerId, number[]> {
  const byLayer = new Map<PcbCopperLayerId, number[]>();
  items.forEach((item, index) => {
    for (const layer of itemLayers(item)) {
      const bucket = byLayer.get(layer);
      if (bucket) bucket.push(index);
      else byLayer.set(layer, [index]);
    }
  });
  for (const bucket of byLayer.values()) {
    bucket.sort((a, b) => {
      const d = items[a]!.bounds.minX - items[b]!.bounds.minX;
      return d !== 0 ? d : a - b;
    });
  }
  return byLayer;
}

/**
 * Record whichever contacts this candidate pair produces on `layer`. The rule
 * is ASYMMETRIC (contract §2): unassigned copper is in contact with anything it
 * touches, but a named-net end cap or via barrel is in contact only with copper
 * of its own net — null-net copper never rescues a named-net stub.
 */
function recordContacts(
  a: CopperItem,
  b: CopperItem,
  layer: PcbCopperLayerId,
  eps: number,
  contacts: Contacts,
): void {
  if (a.netId !== null && a.netId !== b.netId) return;
  if (a.kind === "trace") {
    const caps = contacts.endpoints.get(a.key)!;
    if (endCapTouches(a, 0, b, eps)) caps[0].add(b.key);
    if (endCapTouches(a, 1, b, eps)) caps[1].add(b.key);
  } else if (a.kind === "via") {
    if (viaTouchesOnLayer(a, b, layer, eps)) {
      contacts.viaLayers.get(a.key)!.get(layer)!.add(b.key);
    }
  }
}

function sweepLayer(
  items: readonly CopperItem[],
  bucket: readonly number[],
  layer: PcbCopperLayerId,
  eps: number,
  parent: number[],
  contacts: Contacts,
): void {
  for (let i = 0; i < bucket.length; i += 1) {
    const ai = bucket[i]!;
    const a = items[ai]!;
    for (let j = i + 1; j < bucket.length; j += 1) {
      const bi = bucket[j]!;
      const b = items[bi]!;
      if (b.bounds.minX > a.bounds.maxX + eps) break;
      if (!boundsOverlap(a.bounds, b.bounds, eps)) continue;
      if (!netsCompatible(a.netId, b.netId)) continue;
      // Contacts are recorded for every candidate, not only for pairs that
      // union: an end cap resting on a pour island it is not a member of, or
      // on unassigned copper, still means the endpoint is not a stub.
      recordContacts(a, b, layer, eps, contacts);
      recordContacts(b, a, layer, eps, contacts);
      if (a.netId !== null && a.netId === b.netId && copperTouch(a, b, eps)) {
        unite(parent, ai, bi);
      }
    }
  }
}

/**
 * Largest `t ∈ [0, 1]` at which segment `a→b` is still within `reach` of `p`,
 * or null when no point of the segment is. Solves |a + t·(b−a) − p|² = reach².
 */
function farthestWithinReach(
  p: PcbPointMm,
  a: PcbPointMm,
  b: PcbPointMm,
  reach: number,
): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - p.x;
  const fy = a.y - p.y;
  const qa = dx * dx + dy * dy;
  const qc = fx * fx + fy * fy - reach * reach;
  if (qa === 0) return qc <= 0 ? 0 : null;
  const qb = 2 * (fx * dx + fy * dy);
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const lo = Math.max(0, (-qb - root) / (2 * qa));
  const hi = Math.min(1, (-qb + root) / (2 * qa));
  return hi < lo ? null : hi;
}

/**
 * Does the end cap at `points[0]` rest on a FOLD-BACK of its own trace?
 *
 * Proximity alone is not enough: on `[[0,0],[0.2,0],[5,0]]` or a Manhattan
 * corner the next segment's copper is trivially within `2·hw` of the endpoint,
 * yet the trace is still a stub. What distinguishes a real fold-back is that
 * the copper the cap reaches is far away ALONG the conductor: for a point `q`
 * on a non-incident segment, with `d = |q − p|` and `s` the arc length from `p`
 * to `q`, the cap self-contacts when `d ≤ 2·hw + ε` and `s − d > 2·hw`.
 *
 * The witness is the FARTHEST point of the segment still within reach, not its
 * nearest point: `s − d` is non-decreasing along a segment (arc length grows at
 * |b−a| per unit t while `d` can grow no faster), so the far end of the
 * reachable interval maximises it. Testing only the nearest point misses a
 * U-turn whose closest approach is early on the return leg — Astra 7.
 */
function capTouchesOwnBody(
  points: readonly PcbPointMm[],
  halfWidthMm: number,
  eps: number,
): boolean {
  const p = points[0]!;
  const reach = 2 * halfWidthMm + eps;
  let arc = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (i > 0) {
      const t = farthestWithinReach(p, a, b, reach);
      if (t !== null) {
        const qx = a.x + (b.x - a.x) * t;
        const qy = a.y + (b.y - a.y) * t;
        const d = Math.hypot(qx - p.x, qy - p.y);
        if (arc + length * t - d > 2 * halfWidthMm) return true;
      }
    }
    arc += length;
  }
  return false;
}

/**
 * A trace's end cap may rest on the trace's OWN body — a closed loop or a
 * fold-back is not a stub. The segment incident to the endpoint is always
 * excluded, so a two-point trace can never self-contact.
 */
function recordSelfContacts(
  items: readonly CopperItem[],
  eps: number,
  contacts: Contacts,
): void {
  for (const item of items) {
    if (item.kind !== "trace") continue;
    const points = item.pointsMm;
    if (points.length < 3) continue;
    const caps = contacts.endpoints.get(item.key)!;
    if (capTouchesOwnBody(points, item.halfWidthMm, eps)) caps[0].add(item.key);
    const reversed = [...points].reverse();
    if (capTouchesOwnBody(reversed, item.halfWidthMm, eps)) caps[1].add(item.key);
  }
}

/** Sort every contact set so iteration order does not depend on sweep order. */
function freezeContacts(contacts: Contacts): void {
  for (const caps of contacts.endpoints.values()) {
    caps[0] = new Set([...caps[0]].sort());
    caps[1] = new Set([...caps[1]].sort());
  }
  for (const perLayer of contacts.viaLayers.values()) {
    for (const [layer, keys] of perLayer) {
      perLayer.set(layer, new Set([...keys].sort()));
    }
  }
}

function buildComponents(
  items: readonly CopperItem[],
  parent: number[],
): { components: ConnectivityComponent[]; componentOf: Map<string, number> } {
  const byRoot = new Map<number, { netId: string; itemKeys: string[] }>();
  items.forEach((item, index) => {
    if (item.netId === null) return;
    const root = findRoot(parent, index);
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
    .map((c, id): ConnectivityComponent => ({ id, ...c }));
  const componentOf = new Map<string, number>();
  for (const component of components) {
    for (const key of component.itemKeys) componentOf.set(key, component.id);
  }
  return { components, componentOf };
}

export function computeConnectivity(
  items: ReadonlyArray<CopperItem>,
  opts?: { epsMm?: number },
): ConnectivityResult {
  const eps = opts?.epsMm ?? CONNECT_EPS_MM;
  const sorted = [...items].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const indexByKey = new Map<string, number>();
  sorted.forEach((item, index) => indexByKey.set(item.key, index));
  const parent = sorted.map((_, i) => i);
  const contacts = emptyContacts(sorted);

  // A pour island is one node whose members the fill kernel already resolved
  // by polygon intersection; that membership IS the geometric touch test. The
  // net and layer are re-checked here rather than trusted: the fill kernel
  // tests via spans without a board layer count, so it lists a via whose span
  // is invalid for this stackup as crossing the poured layer.
  sorted.forEach((item, index) => {
    if (item.kind !== "pour") return;
    for (const memberKey of item.memberKeys) {
      const other = indexByKey.get(memberKey);
      if (other === undefined) continue;
      const member = sorted[other]!;
      if (member.netId !== item.netId) continue;
      if (!occupiesLayer(member, item.layer)) continue;
      unite(parent, index, other);
    }
  });

  for (const [layer, bucket] of groupByLayer(sorted)) {
    sweepLayer(sorted, bucket, layer, eps, parent, contacts);
  }
  recordSelfContacts(sorted, eps, contacts);
  freezeContacts(contacts);

  const { components, componentOf } = buildComponents(sorted, parent);
  return {
    components,
    componentOf,
    endpointContacts: contacts.endpoints,
    viaLayerContacts: contacts.viaLayers,
  };
}
