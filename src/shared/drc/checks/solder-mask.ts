/**
 * `MASK_BRIDGE`, `FAB_MASK_BRIDGE`, `MASK_SLIVER`, `FAB_MASK_TO_COPPER`
 * (DFM contract 11 §4).
 *
 * The subject is the solder-mask ARTWORK — `ctx.maskIndex(face)`, the same
 * openings `emitMask` flashes (§1.3) — and the two questions it can answer:
 * is the dam between two openings wide enough to survive, and does an opening
 * expose copper that is not its own.
 *
 * Two rules here are easy to get backwards, and both come from the Astra
 * spec-attack:
 *
 *  - **Openings that overlap or touch have no mask between them at all**
 *    (`gap <= 0`, #9 / #11). If their nets differ that is the bridge hazard in
 *    its worst form; if they share a net, or either is a bare drilled void,
 *    they simply MERGE into one opening — a thermal pad with its untented vias
 *    is one window, not a field of slivers.
 *  - **Net equality is not a mask-to-copper exemption** (#10). An opening is
 *    entitled to expose its OWN copper — the pad it belongs to and whatever
 *    touches that pad — and nothing else. A same-net trace running past a pad
 *    it never reaches is exposed copper the fab row is about.
 */
import type {
  DrcAnchor,
  PcbCopperLayerId,
  PcbPointMm,
} from "../../../sdks/designer";
import {
  arcSegmentCount,
  ellipseChordRing,
} from "../../pcb-geometry/arc-chords";
import { pointInPolygon } from "../../pcb-geometry/pcb-clearance-geometry";
import { segmentToSegmentDistance } from "../../pcb-geometry/pcb-trace-geometry";
import { viaItemKey } from "../../pcb-connectivity/copper-items";
import {
  boundsOfPoints,
  type RingBounds,
} from "../../pcb-geometry/region-rings";
import {
  below,
  CONNECT_EPS_MM,
  GEOM_EPS_MM,
} from "../../pcb-geometry/tolerance";
import type {
  MaskFace,
  MaskOpening,
} from "../../rendering/pcb/artwork/mask-artwork";
import {
  createBroadPhase,
  type BroadPhaseNear,
} from "../broad-phase";
import { anchorKey } from "../violation-id";
import type {
  DrcContext,
  DrcPad,
  DrcTrace,
  DrcViaGeom,
  MaskFaceIndex,
} from "../drc-context";
import { FAB_PRESETS } from "../fab-presets";
import type { DrcViolationDraft } from "../types";
import { ringGapToRing, stadiumGapToRing, type FilledGap } from "./filled-gap";

const FACES: readonly MaskFace[] = ["top", "bottom"];

/** The face as the outer copper layer id — the §7 marker convention. */
function faceLayer(face: MaskFace): PcbCopperLayerId {
  return face === "top" ? "F.Cu" : "B.Cu";
}

// =========================================================================
// Copper candidates and the filled-set gap against an opening ring
// =========================================================================

/** A piece of copper as the mask-to-copper pass measures it. */
type CopperGeom =
  | { kind: "ring"; ring: readonly PcbPointMm[] }
  | { kind: "disc"; center: PcbPointMm; radiusMm: number }
  | { kind: "stroke"; pointsMm: readonly PcbPointMm[]; halfWidthMm: number }
  | {
      kind: "island";
      rings: ReadonlyArray<readonly PcbPointMm[]>;
      /** The island's boundary as segments, with an index over them. */
      segments: ReadonlyArray<readonly [PcbPointMm, PcbPointMm]>;
      nearSegments: BroadPhaseNear;
      bounds: RingBounds;
    };

interface CopperCandidate {
  geom: CopperGeom;
  anchor: DrcAnchor;
  /** S1 item key, or `null` for a pour island (which has no item anchor). */
  key: string | null;
  /** Same-net item keys the island merges with — the pour's own touch answer. */
  memberKeys?: ReadonlySet<string>;
  subject: string;
  bounds: RingBounds;
}

/**
 * Filled-set gap between a piece of copper and a mask opening's ring.
 *
 * An island is judged as outer MINUS holes, so copper inside a thermal or
 * clearance knockout is correctly not copper — measuring a pour by its outer
 * ring alone would report every pad's own opening as exposed foreign copper.
 *
 * `ringBounds` / `haloMm` bound the island body's work: a board-wide plane is
 * tens of thousands of vertices and every opening's bounds meet it, so a body
 * that walked the whole island per opening would be quadratic in the two things
 * a real board has most of (§4).
 */
function copperGapToRing(
  geom: CopperGeom,
  ring: readonly PcbPointMm[],
  ringBounds: RingBounds,
  haloMm: number,
): FilledGap {
  switch (geom.kind) {
    case "ring":
      return ringGapToRing(geom.ring, ring);
    // A degenerate segment swept by `radiusMm` IS the disc, so the stadium body
    // measures a via exactly rather than through a sampled ring.
    case "disc":
      return stadiumGapToRing(geom.center, geom.center, geom.radiusMm, ring);
    case "stroke": {
      let best: FilledGap | null = null;
      for (let i = 1; i < geom.pointsMm.length; i += 1) {
        const hit = stadiumGapToRing(
          geom.pointsMm[i - 1]!,
          geom.pointsMm[i]!,
          geom.halfWidthMm,
          ring,
        );
        if (!best || hit.gapMm < best.gapMm) best = hit;
      }
      return best ?? { gapMm: Infinity, at: geom.pointsMm[0] ?? { x: 0, y: 0 } };
    }
    case "island":
      return islandGapToRing(geom, ring, ringBounds, haloMm);
  }
}

/**
 * Signed gap between a filled pour ISLAND (outer minus holes) and an opening's
 * ring. Three facts decide it, in this order:
 *
 *  1. the island boundary segments within the halo — everything else is too far
 *     to change the verdict, and on a plane that is 99.9 % of the island;
 *  2. an island boundary point inside the opening, or a crossing (distance 0) —
 *     copper inside the window;
 *  3. otherwise the edge distance, with ONE containment probe: an opening that
 *     lies wholly in the material has a positive edge distance and is still
 *     fully exposed copper.
 */
function islandGapToRing(
  island: Extract<CopperGeom, { kind: "island" }>,
  ring: readonly PcbPointMm[],
  ringBounds: RingBounds,
  haloMm: number,
): FilledGap {
  const probe = ring[0] ?? { x: 0, y: 0 };
  const near = island
    .nearSegments("traces", ringBounds, haloMm)
    .map((i) => island.segments[i]!);
  // No island boundary anywhere near: the opening is wholly inside the material
  // or wholly outside it, and one probe settles which.
  if (near.length === 0) {
    return pointInIslandMaterial(island, probe)
      ? { gapMm: 0, at: probe }
      : { gapMm: Infinity, at: probe };
  }
  // A boundary point inside the opening is copper inside the opening: a hole's
  // boundary separates void from material, so material lies arbitrarily close
  // to it on the copper side.
  for (const [a] of near) {
    if (pointInPolygon(a, ring)) return { gapMm: 0, at: a };
  }
  let best = Infinity;
  let at: PcbPointMm = probe;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    for (const [a, b] of near) {
      const d = segmentToSegmentDistance(p, q, a, b);
      if (d < best) {
        best = d;
        at = p;
      }
      if (best === 0) return { gapMm: 0, at };
    }
  }
  // A positive edge distance still means "exposed" when the whole opening sits
  // INSIDE the material — no boundary crosses it, so one probe decides.
  if (pointInIslandMaterial(island, probe)) return { gapMm: 0, at: probe };
  return { gapMm: best, at };
}

/**
 * Is `p` on the island's COPPER (inside the outer ring, outside every hole)?
 *
 * A ray cast to +x with the even-odd rule over EVERY ring — outer and holes
 * alike — which is exactly the material test, and the candidate segments come
 * from the index rather than from the whole island. `pointToIslandDistance`
 * answers the same question but walks all of the island's vertices, and this
 * probe runs once per (opening, island) pair on a board whose plane has tens of
 * thousands of them.
 */
function pointInIslandMaterial(
  island: Extract<CopperGeom, { kind: "island" }>,
  p: PcbPointMm,
): boolean {
  const b = island.bounds;
  if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) return false;
  // The ray's own box: from `p` to the island's right edge, zero height. A
  // segment the ray crosses has a point inside it, so the index's superset
  // property makes this exact.
  const rayBox: RingBounds = {
    minX: p.x,
    maxX: b.maxX,
    minY: p.y,
    maxY: p.y,
  };
  let crossings = 0;
  for (const i of island.nearSegments("traces", rayBox, GEOM_EPS_MM)) {
    const [a, c] = island.segments[i]!;
    if (a.y > p.y === c.y > p.y) continue;
    if (p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x) crossings += 1;
  }
  return crossings % 2 === 1;
}

// =========================================================================
// Entry point
// =========================================================================

export function checkSolderMask(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const preset =
    ctx.fabricator === "custom" ? null : (FAB_PRESETS[ctx.fabricator] ?? null);
  const minBridgeMm = ctx.designRules.solderMask?.minBridgeMm;

  for (const face of FACES) {
    const mask = ctx.maskIndex(face);
    if (mask.openings.length === 0) continue;
    const layer = faceLayer(face);
    // The components are built whatever the rules say: `FAB_MASK_TO_COPPER`
    // reads them too, because an opening is entitled to the copper of every
    // opening it MERGED with, not only to its own.
    const damHalo = Math.max(minBridgeMm ?? 0, preset?.maskDamMm ?? 0);
    const components = buildFaceComponents(mask, damHalo);
    if (damHalo > 0) {
      judgeComponents(ctx, mask, components, { minBridgeMm, preset, layer }, out);
    }
    if (preset?.maskToCopperMm !== undefined) {
      judgeMaskToCopper(
        ctx,
        mask,
        components,
        { rowMm: preset.maskToCopperMm, presetName: preset.name, layer },
        out,
      );
    }
  }
  return out;
}

type Preset = (typeof FAB_PRESETS)[keyof typeof FAB_PRESETS] | null;

function netLabel(ctx: DrcContext, netId: string | null): string {
  if (netId === null) return "unassigned";
  return ctx.netNames[netId] ?? netId.slice(0, 6);
}

/**
 * A null net differs from EVERY net, including another null one (§4): two
 * unassigned pads are two separate pieces of copper the assembler can bridge.
 */
function netsDiffer(a: string | null, b: string | null): boolean {
  return a === null || b === null || a !== b;
}

// =========================================================================
// Merged components, then bridges and slivers between them (§4)
// =========================================================================

/**
 * One MERGED mask window: the openings that overlap or touch, transitively.
 *
 * The merge rule is not pairwise. A copper-less relief that overlaps two
 * different-net pad openings joins them into ONE uninterrupted window with no
 * dam anywhere in it, and every pairwise reading of that board is innocent —
 * relief/pad pairs merge (either side copper-less) and the two pads are far
 * enough apart to clear the minimum (Astra run 2 #3). The mirror image is a
 * false positive: two same-net untented vias inside a thermal pad's opening
 * "have" a 0.05 mm web between them that the pad's own opening removed.
 *
 * So the openings are unioned into components first, and every dam verdict is
 * about components: a web INSIDE one does not exist, and a component that
 * exposes two different nets is a bridge however many openings it took to
 * connect them.
 */
interface MaskComponent {
  /** Opening indices, ascending. */
  members: number[];
  /** Members with `copper`, ascending — the ones a net verdict is about. */
  copperMembers: number[];
  /** Nets of the COPPER members; `null` is a member like any other. */
  copperNets: Set<string | null>;
  /** `ownerKey` of every member — the copper this whole window may expose. */
  ownerKeys: Set<string>;
}

/**
 * Cap on the copper members one component's differing-net search enumerates.
 * A component with more than this many copper members is already a catastrophic
 * board (one window over dozens of pads); the first `n` in canonical order give
 * a deterministic witness without an O(n²) walk of it.
 */
const MAX_BRIDGE_SEARCH_MEMBERS = 64;

interface FaceComponents {
  components: MaskComponent[];
  /** Opening index → component index. */
  componentOf: number[];
  /** Rank of an opening in the canonical (`anchorKey`, index) order. */
  rank: number[];
  /** Evaluated DISJOINT pairs, for the between-component minimum. */
  pairs: Array<{ lead: number; follow: number; hit: FilledGap }>;
}

/**
 * Canonical opening order: `anchorKey`, then the opening's own CENTRE, then the
 * model index. Which of two openings leads decides which penetrating vertex a
 * marker lands on, so it must be a function of the board and not of array
 * order (§7).
 *
 * The centre is what makes it total. One multi-shape pin is several openings
 * under ONE anchor (records carry `occurrence`, anchors do not), so
 * `anchorKey` alone leaves them to be ordered by model index — which reverses
 * when the placement's `pads` array does. The last fallback to the index is for
 * openings that share an anchor AND a centre — a `hole` pad's declared flash
 * and its concentric drill relief — whose relative order is fixed by the
 * emission sequence, not by any input array.
 */
function canonicalOrder(mask: MaskFaceIndex): number[] {
  return mask.openings
    .map((o, index) => ({ index, key: anchorKey(o.anchor), at: o.centerMm }))
    .sort(
      (a, b) =>
        a.key !== b.key
          ? a.key < b.key
            ? -1
            : 1
          : a.at.x !== b.at.x
            ? a.at.x - b.at.x
            : a.at.y !== b.at.y
              ? a.at.y - b.at.y
              : a.index - b.index,
    )
    .map((e) => e.index);
}

/**
 * Union the face's openings into merged components, and keep every disjoint
 * pair the halo offered for the between-component pass.
 *
 * `haloMm` only widens which DISJOINT pairs are measured; the union itself
 * needs no halo at all, because openings that merge have meeting bounds.
 */
function buildFaceComponents(
  mask: MaskFaceIndex,
  haloMm: number,
): FaceComponents {
  const n = mask.openings.length;
  const order = canonicalOrder(mask);
  const rank = new Array<number>(n);
  order.forEach((index, r) => {
    rank[index] = r;
  });

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    let walk = i;
    while (parent[walk] !== root) {
      const next = parent[walk]!;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };

  const pairs: Array<{ lead: number; follow: number; hit: FilledGap }> = [];
  for (const i of order) {
    for (const j of mask.near("pads", mask.bounds[i]!, haloMm + GEOM_EPS_MM)) {
      if (rank[j]! <= rank[i]!) continue;
      const hit = ringGapToRing(mask.rings[i]!, mask.rings[j]!);
      if (hit.gapMm <= 0) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
        continue;
      }
      pairs.push({ lead: i, follow: j, hit });
    }
  }

  // Components in canonical order: by the rank of their lowest-ranked member.
  const byRoot = new Map<number, number[]>();
  for (const i of order) {
    const root = find(i);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(i);
    else byRoot.set(root, [i]);
  }
  const components: MaskComponent[] = [];
  const componentOf = new Array<number>(n).fill(-1);
  for (const members of byRoot.values()) {
    const copperMembers = members.filter((i) => mask.openings[i]!.copper);
    const component: MaskComponent = {
      members: [...members].sort((a, b) => a - b),
      copperMembers,
      copperNets: new Set(copperMembers.map((i) => mask.openings[i]!.netId)),
      ownerKeys: new Set(
        members
          .map((i) => mask.openings[i]!.ownerKey)
          .filter((k): k is string => k !== null),
      ),
    };
    const index = components.length;
    components.push(component);
    for (const i of members) componentOf[i] = index;
  }
  return { components, componentOf, rank, pairs };
}

/**
 * Do two copper NET SETS belong to different nets? The pairwise rule
 * generalised: a null net differs from everything, so a set holding one always
 * differs; otherwise two sets differ exactly when they share no net at all.
 */
function netSetsDiffer(
  a: ReadonlySet<string | null>,
  b: ReadonlySet<string | null>,
): boolean {
  if (a.has(null) || b.has(null)) return true;
  for (const net of a) if (b.has(net)) return false;
  return true;
}

function judgeComponents(
  ctx: DrcContext,
  mask: MaskFaceIndex,
  face: FaceComponents,
  params: { minBridgeMm: number | undefined; preset: Preset; layer: PcbCopperLayerId },
  out: DrcViolationDraft[],
): void {
  for (const component of face.components) {
    judgeMergedComponent(ctx, mask, component, params, out);
  }

  // Between components: the gap is the SMALLEST gap between any two of their
  // members, because that is where the surviving web is narrowest.
  const best = new Map<string, { lead: number; follow: number; hit: FilledGap }>();
  for (const pair of face.pairs) {
    const ca = face.componentOf[pair.lead]!;
    const cb = face.componentOf[pair.follow]!;
    if (ca === cb) continue;
    const key = ca < cb ? `${ca}:${cb}` : `${cb}:${ca}`;
    const held = best.get(key);
    if (!held || pair.hit.gapMm < held.hit.gapMm) best.set(key, pair);
  }
  // Ascending key order is a function of the canonical component order alone.
  for (const key of [...best.keys()].sort()) {
    const pair = best.get(key)!;
    judgeComponentPair(ctx, mask, face, pair, params, out);
  }
}

/**
 * A component that exposes two different nets has no dam between them anywhere
 * — whatever chain of openings connected them (Astra run 2 #3).
 */
function judgeMergedComponent(
  ctx: DrcContext,
  mask: MaskFaceIndex,
  component: MaskComponent,
  params: { minBridgeMm: number | undefined; preset: Preset; layer: PcbCopperLayerId },
  out: DrcViolationDraft[],
): void {
  if (component.copperNets.size < 2) return;
  const search = component.copperMembers.slice(0, MAX_BRIDGE_SEARCH_MEMBERS);
  let witness: { i: number; j: number; hit: FilledGap } | null = null;
  for (let x = 0; x < search.length; x += 1) {
    for (let y = x + 1; y < search.length; y += 1) {
      const i = search[x]!;
      const j = search[y]!;
      if (!netsDiffer(mask.openings[i]!.netId, mask.openings[j]!.netId)) continue;
      const hit = ringGapToRing(mask.rings[i]!, mask.rings[j]!);
      if (!witness || hit.gapMm < witness.hit.gapMm) witness = { i, j, hit };
    }
  }
  if (!witness) return;
  const a = mask.openings[witness.i]!;
  const b = mask.openings[witness.j]!;
  pushBridge(
    ctx,
    a,
    b,
    [a.anchor, b.anchor],
    witness.hit.at,
    0,
    params,
    "openings merge — no dam",
    out,
  );
}

function judgeComponentPair(
  ctx: DrcContext,
  mask: MaskFaceIndex,
  face: FaceComponents,
  pair: { lead: number; follow: number; hit: FilledGap },
  params: { minBridgeMm: number | undefined; preset: Preset; layer: PcbCopperLayerId },
  out: DrcViolationDraft[],
): void {
  const { minBridgeMm, preset, layer } = params;
  const a = mask.openings[pair.lead]!;
  const b = mask.openings[pair.follow]!;
  const ca = face.components[face.componentOf[pair.lead]!]!;
  const cb = face.components[face.componentOf[pair.follow]!]!;
  const anchors: [DrcAnchor, DrcAnchor] = [a.anchor, b.anchor];
  const gapMm = pair.hit.gapMm;
  // The net policy reads the COMPONENTS' copper, not the two openings that
  // happen to be closest: a bare relief facing a pad is still a bridge hazard
  // when the relief's own window exposes another net's copper elsewhere.
  const bridgeHazard =
    ca.copperNets.size > 0 &&
    cb.copperNets.size > 0 &&
    netSetsDiffer(ca.copperNets, cb.copperNets);

  if (bridgeHazard) {
    pushBridge(
      ctx,
      a,
      b,
      anchors,
      pair.hit.at,
      gapMm,
      params,
      `${gapMm.toFixed(4)} mm`,
      out,
    );
    return;
  }
  // Same net, or a window with no copper at all: a web that can lift, never a
  // short.
  const requiredMm = minBridgeMm ?? preset?.maskDamMm;
  if (requiredMm === undefined || !below(gapMm, requiredMm)) return;
  out.push({
    code: "MASK_SLIVER",
    message: `Solder-mask web between two openings is ${gapMm.toFixed(4)} mm < ${requiredMm.toFixed(4)} mm; it can lift during assembly`,
    anchors,
    locationMm: pair.hit.at,
    layer,
    measuredMm: gapMm,
    requiredMm,
  });
}

function pushBridge(
  ctx: DrcContext,
  a: MaskOpening,
  b: MaskOpening,
  anchors: [DrcAnchor, DrcAnchor],
  locationMm: PcbPointMm,
  gapMm: number,
  params: { minBridgeMm: number | undefined; preset: Preset; layer: PcbCopperLayerId },
  measured: string,
  out: DrcViolationDraft[],
): void {
  const { minBridgeMm, preset, layer } = params;
  const nets = `${netLabel(ctx, a.netId)} / ${netLabel(ctx, b.netId)}`;
  if (minBridgeMm !== undefined && below(gapMm, minBridgeMm)) {
    out.push({
      code: "MASK_BRIDGE",
      message: `Solder-mask dam between ${nets} is ${measured} < ${minBridgeMm.toFixed(4)} mm`,
      anchors,
      locationMm,
      layer,
      measuredMm: gapMm,
      requiredMm: minBridgeMm,
    });
  }
  if (preset && below(gapMm, preset.maskDamMm)) {
    out.push({
      code: "FAB_MASK_BRIDGE",
      message: `Solder-mask dam between ${nets} is ${measured} < ${preset.name} min ${preset.maskDamMm.toFixed(4)} mm; reduce solderMaskExpansionMm or accept the fab's dam removal`,
      anchors,
      locationMm,
      layer,
      measuredMm: gapMm,
      requiredMm: preset.maskDamMm,
    });
  }
}

// =========================================================================
// Mask to foreign copper (§4)
// =========================================================================

function judgeMaskToCopper(
  ctx: DrcContext,
  mask: MaskFaceIndex,
  face: FaceComponents,
  params: { rowMm: number; presetName: string; layer: PcbCopperLayerId },
  out: DrcViolationDraft[],
): void {
  const { rowMm, presetName, layer } = params;
  const padByKey = new Map(ctx.pads.map((p) => [p.key, p] as const));
  const viaByKey = new Map(
    ctx.vias.map((v) => [viaItemKey(v.via.id), v] as const),
  );
  const islands = layerIslands(ctx, layer);
  // An opening that MERGED with others is one window over all of their copper,
  // so the exemption is the component's owner set, not the opening's own owner
  // (Astra run 2 #3): the via inside a thermal pad's window is the window's own
  // copper however the two openings were emitted.
  const ownersByComponent = face.components.map((component) =>
    [...component.ownerKeys]
      .sort()
      .map((key) => ({ key, copper: ownerGeom(key, padByKey, viaByKey) }))
      .filter(
        (o): o is { key: string; copper: OwnerCopper } => o.copper !== null,
      ),
  );

  for (let i = 0; i < mask.openings.length; i += 1) {
    const opening = mask.openings[i]!;
    const ring = mask.rings[i]!;
    const bounds = mask.bounds[i]!;
    const component = face.components[face.componentOf[i]!]!;
    const owners = ownersByComponent[face.componentOf[i]!]!;
    const candidates = copperNear(ctx, layer, bounds, rowMm, islands);
    for (const candidate of candidates) {
      // An opening is entitled to its OWN copper and to whatever touches it —
      // the trace entering the pad, the via in the pad. Net equality is NOT the
      // test (Astra run 1 #10).
      if (candidate.key !== null && component.ownerKeys.has(candidate.key)) {
        continue;
      }
      if (
        owners.some((o) => touchesOwner(candidate, o.copper, o.key, layer))
      ) {
        continue;
      }
      const hit = copperGapToRing(candidate.geom, ring, bounds, rowMm + GEOM_EPS_MM);
      if (!below(hit.gapMm, rowMm)) continue;
      const measuredMm = Math.max(hit.gapMm, 0);
      out.push({
        code: "FAB_MASK_TO_COPPER",
        message:
          hit.gapMm <= 0
            ? `Solder-mask opening exposes ${candidate.subject} that is not its own (${presetName} min ${rowMm.toFixed(3)} mm)`
            : `Solder-mask opening is ${hit.gapMm.toFixed(3)} mm from ${candidate.subject} < ${presetName} min ${rowMm.toFixed(3)} mm`,
        anchors: [opening.anchor, candidate.anchor],
        locationMm: hit.at,
        layer,
        measuredMm,
        requiredMm: rowMm,
      });
    }
  }
}

/**
 * The owner's own copper, as the touch test needs it — WITH the copper layers
 * it occupies.
 *
 * The layers are not decoration. An opening's `ownerKey` is a pad or a via
 * wherever the opening came from, INCLUDING a far-face drill relief, whose
 * owner is an `smd` pad with copper on the other face only. Judged on the 2D
 * ring alone, that relief would exempt every piece of copper that happens to
 * run underneath it — a trace on the far face is foreign copper the relief
 * exposes, and it is exactly what the row is about (S1 touch semantics).
 */
interface OwnerCopper {
  geom: CopperGeom;
  layers: readonly PcbCopperLayerId[];
}

function ownerGeom(
  ownerKey: string | null,
  padByKey: ReadonlyMap<string, DrcPad>,
  viaByKey: ReadonlyMap<string, DrcViaGeom>,
): OwnerCopper | null {
  if (!ownerKey) return null;
  const pad = padByKey.get(ownerKey);
  if (pad) {
    return { geom: { kind: "ring", ring: pad.ring }, layers: pad.layers };
  }
  const via = viaByKey.get(ownerKey);
  if (!via) return null;
  // Circumscribed, so the touch test errs towards EXEMPTING — the via in the
  // pad must not be reported as foreign copper over a sampling residue.
  return {
    geom: {
      kind: "ring",
      ring: ellipseChordRing(
        via.center,
        via.radiusMm,
        via.radiusMm,
        arcSegmentCount(via.radiusMm, 2 * Math.PI, "circumscribed"),
        "circumscribed",
      ),
    },
    layers: via.layers,
  };
}

/**
 * Is the candidate the opening's OWN copper by contact? Only on a layer the
 * owner actually has copper on: every candidate here is already resolved on
 * `layer`, so the whole layer test is "does the owner reach this face".
 */
function touchesOwner(
  candidate: CopperCandidate,
  owner: OwnerCopper,
  ownerKey: string | null,
  layer: PcbCopperLayerId,
): boolean {
  if (!owner.layers.includes(layer)) return false;
  // A pour island already knows the same-net copper it merges with — the fill
  // kernel resolved it by polygon intersection (contract 01).
  if (candidate.memberKeys && ownerKey && candidate.memberKeys.has(ownerKey)) {
    return true;
  }
  if (owner.geom.kind !== "ring") return false;
  return (
    copperGapToRing(
      candidate.geom,
      owner.geom.ring,
      boundsOfPoints(owner.geom.ring),
      CONNECT_EPS_MM,
    ).gapMm <= CONNECT_EPS_MM
  );
}

/**
 * One island's boundary as INDEXED segments. A board-wide plane is tens of
 * thousands of vertices whose bounds meet every opening on the board, so an
 * un-indexed body would walk the whole plane once per opening — quadratic in
 * the two things a real board has most of. The index is the SAME grid the
 * context's own broad phase uses (08 §2.1), filing each boundary segment as a
 * zero-width polyline, so a query is a superset of the segments within the halo.
 */
function indexIsland(
  rings: ReadonlyArray<readonly PcbPointMm[]>,
): Extract<CopperGeom, { kind: "island" }> {
  const segments: Array<readonly [PcbPointMm, PcbPointMm]> = [];
  const filed = [];
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 1) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      segments.push([a, b]);
      filed.push({
        pointsMm: [a, b],
        halfWidthMm: 0,
        bounds: boundsOfPoints([a, b]),
      });
    }
  }
  const { near } = createBroadPhase({
    traces: filed,
    pads: [],
    vias: [],
    holes: [],
  });
  return {
    kind: "island",
    rings,
    segments,
    nearSegments: near,
    bounds: boundsOfPoints(rings[0] ?? []),
  };
}

/** The pour islands of one copper layer, of ANY net (§4). */
function layerIslands(
  ctx: DrcContext,
  layer: PcbCopperLayerId,
): CopperCandidate[] {
  const out: CopperCandidate[] = [];
  for (const { zone, result } of ctx.pourResults()) {
    if (zone.layer !== layer) continue;
    for (const island of result.islands) {
      const outer = island.rings[0];
      if (!outer || outer.length < 3) continue;
      out.push({
        geom: indexIsland(island.rings),
        anchor: { kind: "zone", zoneId: zone.id },
        key: null,
        memberKeys: new Set(island.memberKeys),
        subject: "pour copper",
        bounds: boundsOfPoints(outer),
      });
    }
  }
  return out;
}

/**
 * Every trace, pad, via and pour island on `layer` whose copper can be within
 * `rowMm` of `bounds`. The three item kinds come through the context's own grid
 * (a superset of what is within the halo, 08 §2.1); the islands are filtered on
 * their bounds, since the pour is not a grid kind.
 */
function copperNear(
  ctx: DrcContext,
  layer: PcbCopperLayerId,
  bounds: RingBounds,
  rowMm: number,
  islands: readonly CopperCandidate[],
): CopperCandidate[] {
  const halo = rowMm + GEOM_EPS_MM;
  const out: CopperCandidate[] = [];
  for (const i of ctx.near("traces", bounds, halo)) {
    const trace = ctx.traces[i]!;
    if (trace.layer !== layer || trace.pointsMm.length < 2) continue;
    out.push(traceCandidate(trace));
  }
  for (const i of ctx.near("pads", bounds, halo)) {
    const pad = ctx.pads[i]!;
    if (!pad.layers.includes(layer) || pad.ring.length < 3) continue;
    out.push(padCandidate(ctx, pad));
  }
  for (const i of ctx.near("vias", bounds, halo)) {
    const via = ctx.vias[i]!;
    if (!via.layers.includes(layer)) continue;
    out.push(viaCandidate(via));
  }
  for (const island of islands) {
    if (!boundsWithin(island.bounds, bounds, halo)) continue;
    out.push(island);
  }
  return out;
}

function boundsWithin(a: RingBounds, b: RingBounds, haloMm: number): boolean {
  return (
    a.minX - haloMm <= b.maxX &&
    a.maxX + haloMm >= b.minX &&
    a.minY - haloMm <= b.maxY &&
    a.maxY + haloMm >= b.minY
  );
}

function traceCandidate(trace: DrcTrace): CopperCandidate {
  return {
    geom: {
      kind: "stroke",
      pointsMm: trace.pointsMm,
      halfWidthMm: trace.halfWidthMm,
    },
    anchor: { kind: "trace", traceId: trace.id },
    key: `trace:${trace.id}`,
    subject: "a trace",
    bounds: trace.bounds,
  };
}

function padCandidate(ctx: DrcContext, pad: DrcPad): CopperCandidate {
  const subject =
    pad.anchor.kind === "pad"
      ? `pad ${ctx.placementReference(pad.anchor.placementId)}.${pad.anchor.padNumber}`
      : "a pad";
  return {
    geom: { kind: "ring", ring: pad.ring },
    anchor: pad.anchor,
    key: pad.key,
    subject,
    bounds: pad.bounds,
  };
}

function viaCandidate(via: DrcViaGeom): CopperCandidate {
  return {
    geom: { kind: "disc", center: via.center, radiusMm: via.radiusMm },
    anchor: { kind: "via", viaId: via.via.id },
    key: viaItemKey(via.via.id),
    subject: "a via",
    bounds: via.bounds,
  };
}
