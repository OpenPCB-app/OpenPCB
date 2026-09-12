// Effective nets for unassigned copper (electrical contract 13 §4).
//
// Unassigned copper that TOUCHES a conductor is an extension of it (01 §2,
// 06 §4) — so it must be JUDGED as it, not as a net-less stranger. This is the
// ONE derivation of that tier: a contact graph over the board's traces, pads
// and vias under the bridge model's predicate, connected components, and the
// label set each component carries.
//
// Pure and injectable on purpose: DRC builds it once per context, the live gate
// builds a per-call overlay from the same function, and the pour will derive the
// same map (§4.1) — one kernel, never three walks that can disagree.
//
// Pour copper is deliberately absent (§4.1): the bridge model excludes it, and
// including it would be circular — the pour is carved with halos that depend on
// tier nets.

import type { DrcAnchor, PcbCopperLayerId, PcbPointMm } from "../../sdks/designer";
// Type-only (erased): `drc/drc-context.ts` imports VALUES from this package, so
// a value import back would be a real cycle. `pair-gap.ts` below is safe — its
// own view of these types is type-only too.
import type { DrcPad, DrcTrace, DrcViaGeom } from "../drc/drc-context";
import {
  padPadGap,
  padViaGap,
  tracePadGap,
  traceTraceGap,
  traceViaGap,
  viaViaGap,
} from "../drc/pair-gap";
import { anchorKey, escapeStructuralIdSegment } from "../drc/violation-id";
import { GEOM_EPS_MM, SHORT_EPS_MM } from "../pcb-geometry/tolerance";

/** Any copper item a tier net can be derived for. Pour copper is not one. */
export type EffectiveNetItem = DrcTrace | DrcPad | DrcViaGeom;

/** The three arrays, named as the broad phase names them. */
export type EffectiveNetKind = "traces" | "pads" | "vias";

export interface EffectiveNetItems {
  traces: readonly DrcTrace[];
  pads: readonly DrcPad[];
  vias: readonly DrcViaGeom[];
}

/**
 * The halo a candidate finder must query with. `SHORT_EPS_MM` is the contact
 * tolerance; the extra geometry epsilon is the SAME grace the judge's
 * `farApart` carries — an AABB gap is mathematically ≤ the true gap but a
 * different float computation, and two items exactly `SHORT_EPS_MM` apart can
 * measure a hair over it in box arithmetic.
 */
export const EFFECTIVE_NET_HALO_MM = SHORT_EPS_MM + GEOM_EPS_MM;

export interface EffectiveNetOptions {
  /**
   * Candidate indices into `items[kind]` for one subject — the DRC grid. A
   * SUPERSET of everything within {@link EFFECTIVE_NET_HALO_MM} is all the
   * exact kernels below need. Omitted: every index, filtered by a bounds scan.
   */
  candidates?: (
    kind: EffectiveNetKind,
    subject: EffectiveNetItem,
  ) => readonly number[];
}

/** One connected piece of copper reached from an unassigned item (§4.1). */
export interface EffectiveComponent {
  /** Members in anchor-key order. */
  members: readonly EffectiveNetItem[];
  /** `anchorKey` of `members[i]`. */
  memberKeys: readonly string[];
  /** The members whose own net is null, in the same order. */
  nullMembers: readonly EffectiveNetItem[];
  /** Named nets of the members, sorted — the component's label set. */
  labels: readonly string[];
  /** Smallest marker among the null members (x, then y) — a draft's location. */
  markerMm: PcbPointMm;
  /** Labels + membership, for the live overlay's affected-set diff (§4.4). */
  signature: string;
}

export interface EffectiveNets {
  /** Null items whose component carries exactly one label (§4.1 table). */
  effectiveNetOf: ReadonlyMap<EffectiveNetItem, string>;
  /** Every component with at least one null member, in `signature` order. */
  components: readonly EffectiveComponent[];
  componentOf: ReadonlyMap<EffectiveNetItem, EffectiveComponent>;
  /** Named nets each null item touches DIRECTLY (proven contacts), sorted. */
  directNetsOf: ReadonlyMap<EffectiveNetItem, readonly string[]>;
  /** Conflict components the direct bridge drafts do not fully name (§4.3). */
  chainShorts: readonly EffectiveComponent[];
}

type ItemKind = "trace" | "pad" | "via";

/** Pair-kind dispatch order; also the canonical argument order of a pair. */
const KIND_RANK: Record<ItemKind, number> = { trace: 0, pad: 1, via: 2 };

export function isTraceItem(item: EffectiveNetItem): item is DrcTrace {
  return "pointsMm" in item;
}

export function copperItemKind(item: EffectiveNetItem): ItemKind {
  if (isTraceItem(item)) return "trace";
  return "ring" in item ? "pad" : "via";
}

/** The item's marker — trace mid, pad / via centre, as every pair kind uses. */
export function copperItemMarker(item: EffectiveNetItem): PcbPointMm {
  return isTraceItem(item) ? item.mid : item.center;
}

export function copperItemAnchor(item: EffectiveNetItem): DrcAnchor {
  if (isTraceItem(item)) return { kind: "trace", traceId: item.id };
  if ("ring" in item) return item.anchor;
  return { kind: "via", viaId: item.via.id };
}

/** Copper layers both items occupy, in the first item's stackup order. */
export function sharedCopperLayers(
  a: EffectiveNetItem,
  b: EffectiveNetItem,
): PcbCopperLayerId[] {
  const la = isTraceItem(a) ? [a.layer] : a.layers;
  const lb = isTraceItem(b) ? [b.layer] : b.layers;
  return la.filter((l) => lb.includes(l));
}

interface Node {
  kind: ItemKind;
  item: EffectiveNetItem;
  /**
   * Set for ONE FACE of an unplated pad. `layers` on the item names every layer
   * the pad's copper exists on, which for a plated pad or a via is also every
   * layer it CONDUCTS between — but an unplated hole is two rings and no barrel
   * (manufacturability contract 10 §2.4), so each ring is its own node and a
   * contact on `B.Cu` cannot reach what the `F.Cu` ring touches.
   */
  layer?: PcbCopperLayerId;
  key: string;
  netId: string | null;
  marker: PcbPointMm;
}

/** The layers this NODE conducts on — one face of a split pad, else the item's. */
function nodeLayers(node: Node): readonly PcbCopperLayerId[] {
  if (node.layer !== undefined) return [node.layer];
  const item = node.item;
  return isTraceItem(item) ? [item.layer] : item.layers;
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

/** `markerBefore`'s rule, inlined: importing the judge here would be a cycle. */
function markerIsBefore(a: PcbPointMm, b: PcbPointMm): boolean {
  return a.x !== b.x ? a.x < b.x : a.y < b.y;
}

/** `aabbGap`'s formula, inlined for the same no-cycle reason as the marker. */
function boundsFarApart(a: EffectiveNetItem, b: EffectiveNetItem): boolean {
  const ba = a.bounds;
  const bb = b.bounds;
  const dx = Math.max(ba.minX - bb.maxX, bb.minX - ba.maxX, 0);
  const dy = Math.max(ba.minY - bb.maxY, bb.minY - ba.maxY, 0);
  return Math.sqrt(dx * dx + dy * dy) > EFFECTIVE_NET_HALO_MM;
}

/** A `custom` / `trapezoid` pad is a bounding rectangle, never proven copper. */
function isInexactPad(item: EffectiveNetItem): boolean {
  return "ring" in item && !(item as DrcPad).exactShape;
}

/**
 * Gap on a shared copper layer, or `null` when the two share none. The pair is
 * ordered by kind rank then anchor key first, so the asymmetric kernels
 * (`padPadGap` measures core against core) cannot make the verdict depend on
 * the input array order (rule-semantics §11).
 */
function contactGap(a: Node, b: Node): number | null {
  const [u, v] =
    KIND_RANK[a.kind] !== KIND_RANK[b.kind]
      ? KIND_RANK[a.kind] < KIND_RANK[b.kind]
        ? [a, b]
        : [b, a]
      : a.key <= b.key
        ? [a, b]
        : [b, a];
  const lv = nodeLayers(v);
  if (!nodeLayers(u).some((l) => lv.includes(l))) return null;
  if (u.kind === "trace") {
    const t = u.item as DrcTrace;
    if (t.pointsMm.length < 2) return null;
    if (v.kind === "trace") {
      const o = v.item as DrcTrace;
      return o.pointsMm.length < 2 ? null : traceTraceGap(t, o).gap;
    }
    if (v.kind === "pad") return tracePadGap(t, v.item as DrcPad).gap;
    return traceViaGap(t, v.item as DrcViaGeom).gap;
  }
  if (u.kind === "pad") {
    const p = u.item as DrcPad;
    if (v.kind === "pad") return padPadGap(p, v.item as DrcPad).gap;
    return padViaGap(p, v.item as DrcViaGeom).gap;
  }
  return viaViaGap(u.item as DrcViaGeom, v.item as DrcViaGeom).gap;
}

/**
 * A PROVEN contact: gap ≤ `SHORT_EPS_MM` on a shared copper layer, with no
 * bounding-rectangle pad on either side. Such a pad's "overlap" is a POSSIBLE
 * contact (§4.1, Astra run 1 #7) — it supports a spacing verdict on a declared
 * superset, never electrical equivalence, so it neither joins a component nor
 * contributes a direct net. The judge's banking of that touch is unchanged.
 */
function provenContact(a: Node, b: Node): boolean {
  if (isInexactPad(a.item) || isInexactPad(b.item)) return false;
  if (boundsFarApart(a.item, b.item)) return false;
  const gap = contactGap(a, b);
  return gap !== null && gap <= SHORT_EPS_MM;
}

function buildNodes(items: EffectiveNetItems): {
  nodes: Node[];
  /** Node indices per array index — several for a split pad (10 §2.4). */
  nodeOf: Record<EffectiveNetKind, number[][]>;
} {
  const nodes: Node[] = [];
  const nodeOf: Record<EffectiveNetKind, number[][]> = {
    traces: [],
    pads: [],
    vias: [],
  };
  const push = (
    kind: ItemKind,
    arr: EffectiveNetKind,
    item: EffectiveNetItem,
    layers?: readonly PcbCopperLayerId[],
  ): void => {
    const own: number[] = [];
    for (const layer of layers ?? [undefined]) {
      own.push(nodes.length);
      nodes.push({
        kind,
        item,
        ...(layer === undefined ? {} : { layer }),
        key: anchorKey(copperItemAnchor(item)),
        netId: item.netId,
        marker: copperItemMarker(item),
      });
    }
    nodeOf[arr].push(own);
  };
  for (const t of items.traces) push("trace", "traces", t);
  for (const p of items.pads) {
    // §4.1's "a via or a THROUGH pad joins every layer it exists on" is a claim
    // about a plated BARREL. An unplated hole has none, so its rings are one
    // node per face; a plated pad, an undrilled pad and every via stay one node.
    push("pad", "pads", p, !p.plated && p.layers.length >= 2 ? p.layers : undefined);
  }
  for (const v of items.vias) push("via", "vias", v);
  return { nodes, nodeOf };
}

const KINDS: readonly EffectiveNetKind[] = ["traces", "pads", "vias"];

/**
 * The subjects, in anchor-key order (§4.5): only NULL-net items are walked —
 * a named item's tier is its own net, and a named item is reached only as some
 * null item's neighbour.
 */
function subjectOrder(nodes: readonly Node[]): number[] {
  const subjects: number[] = [];
  nodes.forEach((n, i) => {
    if (n.netId === null) subjects.push(i);
  });
  return subjects.sort((x, y) => {
    const a = nodes[x]!;
    const b = nodes[y]!;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return KIND_RANK[a.kind] - KIND_RANK[b.kind] || x - y;
  });
}

function componentSignature(
  labels: readonly string[],
  memberKeys: readonly string[],
): string {
  return `${labels.map(escapeStructuralIdSegment).join("|")}#${memberKeys.join("|")}`;
}

/**
 * Effective nets for every unassigned item in `items` (§4.1).
 *
 * The label set of a component is read from the members' OWN nets — the map
 * this function returns is never consulted while it is being built, so a
 * component can never label itself from an assignment it just made.
 */
export function buildEffectiveNets(
  items: EffectiveNetItems,
  opts: EffectiveNetOptions = {},
): EffectiveNets {
  const { nodes, nodeOf } = buildNodes(items);
  const parent = nodes.map((_, i) => i);
  const direct = new Map<EffectiveNetItem, Set<string>>();
  const all: Record<EffectiveNetKind, number[]> = {
    traces: items.traces.map((_, i) => i),
    pads: items.pads.map((_, i) => i),
    vias: items.vias.map((_, i) => i),
  };
  const candidates =
    opts.candidates ?? ((kind: EffectiveNetKind): readonly number[] => all[kind]);

  for (const si of subjectOrder(nodes)) {
    const s = nodes[si]!;
    for (const kind of KINDS) {
      for (const ci of candidates(kind, s.item)) {
        for (const ti of nodeOf[kind][ci]!) {
          if (ti === si) continue;
          const t = nodes[ti]!;
          // Union-find early exit (§4.1, Astra run 1 #13) — but only against a
          // NULL partner. A named partner still has to be measured even inside
          // a proven component, because its net joins this subject's DIRECT
          // set, which is what §4.3 tests the label coverage against; skipping
          // it would make the chain-short verdict depend on the visit order.
          if (t.netId === null && findRoot(parent, si) === findRoot(parent, ti)) {
            continue;
          }
          if (!provenContact(s, t)) continue;
          if (t.netId !== null) {
            const set = direct.get(s.item);
            if (set) set.add(t.netId);
            else direct.set(s.item, new Set([t.netId]));
          }
          unite(parent, si, ti);
        }
      }
    }
  }

  return collect(nodes, parent, direct);
}

/** Roots → components, effective nets and the §4.3 chain-short selection. */
function collect(
  nodes: readonly Node[],
  parent: number[],
  direct: ReadonlyMap<EffectiveNetItem, Set<string>>,
): EffectiveNets {
  const byRoot = new Map<number, number[]>();
  nodes.forEach((_, i) => {
    const root = findRoot(parent, i);
    const group = byRoot.get(root);
    if (group) group.push(i);
    else byRoot.set(root, [i]);
  });

  const effectiveNetOf = new Map<EffectiveNetItem, string>();
  const componentOf = new Map<EffectiveNetItem, EffectiveComponent>();
  /** Item → its single label so far, or `null` once two nodes disagree. */
  const byItem = new Map<EffectiveNetItem, string | null>();
  const directNetsOf = new Map<EffectiveNetItem, readonly string[]>();
  for (const [item, nets] of direct) directNetsOf.set(item, [...nets].sort());

  const components: EffectiveComponent[] = [];
  for (const group of byRoot.values()) {
    // A named item nothing unassigned ever touched is not a component: it is
    // its own conductor and carries no tier question.
    if (!group.some((i) => nodes[i]!.netId === null)) continue;
    group.sort((x, y) => {
      const a = nodes[x]!;
      const b = nodes[y]!;
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      return KIND_RANK[a.kind] - KIND_RANK[b.kind] || x - y;
    });
    const members = group.map((i) => nodes[i]!.item);
    const memberKeys = group.map((i) => nodes[i]!.key);
    const nullNodes = group.filter((i) => nodes[i]!.netId === null);
    const labels = [
      ...new Set(
        group.map((i) => nodes[i]!.netId).filter((n): n is string => n !== null),
      ),
    ].sort();
    let marker = nodes[nullNodes[0]!]!.marker;
    for (const i of nullNodes) {
      if (markerIsBefore(nodes[i]!.marker, marker)) marker = nodes[i]!.marker;
    }
    const component: EffectiveComponent = {
      members,
      memberKeys,
      nullMembers: nullNodes.map((i) => nodes[i]!.item),
      labels,
      markerMm: marker,
      signature: componentSignature(labels, memberKeys),
    };
    components.push(component);
    // Per ITEM, the single label its component carries — or `null` for "no
    // scalar tier". A split pad contributes once per face, and `agree` below
    // keeps the tier only when every face says the same thing.
    const label = labels.length === 1 ? labels[0]! : null;
    for (const item of component.nullMembers) agree(byItem, item, label);
  }
  components.sort((a, b) =>
    a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0,
  );
  // In sorted order, so a split pad whose faces landed in two components
  // reports the first of them whatever the input arrays looked like.
  for (const component of components) {
    for (const item of component.members) {
      if (!componentOf.has(item)) componentOf.set(item, component);
    }
  }
  for (const [item, label] of byItem) {
    if (label !== null) effectiveNetOf.set(item, label);
  }

  return {
    effectiveNetOf,
    components,
    componentOf,
    directNetsOf,
    chainShorts: components.filter((c) => needsChainDraft(c, directNetsOf)),
  };
}

/**
 * Fold one node's verdict into its ITEM's. `tierNetOf` is a scalar per item,
 * and an unplated pad is several nodes: its rings extend whatever each FACE
 * touches, which can differ. One net only when they all agree — a disagreement
 * (or a face that extends nothing) leaves the pad untiered, which over-reports
 * against its copper rather than letting one face's tier speak for the other.
 */
function agree(
  byItem: Map<EffectiveNetItem, string | null>,
  item: EffectiveNetItem,
  label: string | null,
): void {
  if (!byItem.has(item)) byItem.set(item, label);
  else if (byItem.get(item) !== label) byItem.set(item, null);
}

/**
 * A conflict component whose DIRECT bridge drafts do not name every label
 * (§4.3): no member touches two nets directly (the S7 chain limit), or a
 * further net reaches the component only through a chain (Astra run 1 #6 —
 * `A–X–B` direct plus `Y` bringing C).
 */
function needsChainDraft(
  component: EffectiveComponent,
  directNetsOf: ReadonlyMap<EffectiveNetItem, readonly string[]>,
): boolean {
  if (component.labels.length < 2) return false;
  const covered = new Set<string>();
  for (const item of component.nullMembers) {
    const nets = directNetsOf.get(item);
    if (nets && nets.length >= 2) for (const n of nets) covered.add(n);
  }
  return component.labels.some((l) => !covered.has(l));
}
