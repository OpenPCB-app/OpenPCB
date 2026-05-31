/**
 * Deterministic schematic auto-placement (role-based slot/channel model).
 *
 * Given parts + intended net connectivity, produce grid-snapped origins that
 * read like a hand-drawn schematic: net-connected parts grouped into blocks,
 * generous routing channels between groups, no body overlaps. Power/ground
 * flags (per-pin primitives) and wire routing are handled elsewhere.
 *
 * Design notes (informed by an adversarial algorithm review):
 *  - Clustering uses NON-power, NON-hub nets only; GND/rails and high-fanout
 *    buses would otherwise collapse every block into one component.
 *  - Each cluster is laid out in its OWN near-square grid (cluster-local
 *    dimensions, not a global sqrt), then shelf-packed left→right into bands.
 *  - Per-column / per-row pitch sized to the largest body so a wide connector
 *    only widens its own block.
 *  - Fully deterministic: no Math.random / Date.now, canonical input ordering,
 *    integer-nm grid snapping, and a final AABB verifier that makes the
 *    no-overlap guarantee an executed invariant.
 */
import { SCHEMATIC_GRID_NM } from "@openpcb/rendering-core";
import type { BodyExtentNm } from "./body-extent";

export type LayoutRole = "anchor" | "connector" | "passive";

export interface AutoplacePart {
  partId: string;
  reference: string;
  role: LayoutRole;
  extent: BodyExtentNm;
  pinCount: number;
}

export interface AutoplaceNet {
  netId: string;
  name: string;
  /** Parts incident on this net (raw; deduped + filtered internally). */
  partIds: string[];
  /** GND or a power rail — excluded from clustering, used for orphan attach. */
  isPower: boolean;
}

export interface AutoplaceInput {
  parts: AutoplacePart[];
  nets: AutoplaceNet[];
  gridNm?: number;
  channelNm?: number;
  originNm?: { x: number; y: number };
  maxBandWidthNm?: number;
}

export interface AutoplaceResult {
  positions: Map<string, { x: number; y: number }>;
}

const DEFAULT_CHANNEL_STEPS = 4; // 4 grid steps = 8 mm gutter
const HUB_THRESHOLD = 6; // nets with more members are buses → skip clustering
const MAX_CLUSTER_COLS = 6; // cap per-cluster grid width
// Wrap cluster blocks into a fresh band past this width so a power-dominated
// circuit (many small/singleton blocks) forms a compact 2-D grid instead of
// one long horizontal row.
const DEFAULT_MAX_BAND_WIDTH_NM = 140_000_000; // 140 mm
const CONNECTOR_PREFIXES = new Set(["J", "P", "CN", "CON"]);

// ───────────────────────── deterministic ref ordering ─────────────────────

function refParts(ref: string): { prefix: string; num: number; rest: string } {
  const match = /^([^0-9]*)(\d*)(.*)$/.exec(ref);
  if (!match) return { prefix: ref, num: -1, rest: "" };
  return {
    prefix: match[1] ?? "",
    num: match[2] ? Number.parseInt(match[2], 10) : -1,
    rest: match[3] ?? "",
  };
}

/** Natural order so `C2 < C10` and `C9 < R1`; final tie-break on the raw string. */
export function compareRef(a: string, b: string): number {
  const pa = refParts(a);
  const pb = refParts(b);
  if (pa.prefix !== pb.prefix) return pa.prefix < pb.prefix ? -1 : 1;
  if (pa.num !== pb.num) return pa.num - pb.num;
  if (pa.rest !== pb.rest) return pa.rest < pb.rest ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function classifyPartForLayout(
  reference: string,
  pinCount: number,
): LayoutRole {
  const prefix = (refParts(reference).prefix || reference).toUpperCase();
  if (CONNECTOR_PREFIXES.has(prefix)) return "connector";
  if (pinCount >= 3) return "anchor";
  return "passive";
}

// ───────────────────────────── union-find ─────────────────────────────────

class UnionFind {
  private readonly parent = new Map<string, string>();
  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }
  find(key: string): string {
    let root = this.parent.get(key) ?? key;
    while (root !== (this.parent.get(root) ?? root)) {
      root = this.parent.get(root) ?? root;
    }
    this.parent.set(key, root);
    return root;
  }
  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

// ─────────────────────────────── helpers ──────────────────────────────────

function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

function netMembers(
  net: AutoplaceNet,
  byId: Map<string, AutoplacePart>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of net.partIds) {
    if (byId.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out.sort((a, b) =>
    compareRef(byId.get(a)!.reference, byId.get(b)!.reference),
  );
}

/** Cluster + build BFS adjacency from non-power, non-hub nets. */
function buildClusters(
  parts: AutoplacePart[],
  nets: AutoplaceNet[],
  byId: Map<string, AutoplacePart>,
): { uf: UnionFind; adjacency: Map<string, Set<string>> } {
  const uf = new UnionFind();
  for (const p of parts) uf.add(p.partId);
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  };

  for (const net of nets) {
    if (net.isPower) continue;
    const members = netMembers(net, byId);
    if (members.length < 2 || members.length > HUB_THRESHOLD) continue;
    for (let i = 1; i < members.length; i += 1)
      uf.union(members[0]!, members[i]!);
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1)
        link(members[i]!, members[j]!);
    }
  }

  // Orphan decoupler attach: a singleton passive (touches only power nets)
  // joins the smallest-reference anchor it shares a power net with. Power-net
  // order is canonical (by name) so the choice is deterministic and the first
  // matching net wins.
  const rootCount = new Map<string, number>();
  for (const p of parts) {
    const r = uf.find(p.partId);
    rootCount.set(r, (rootCount.get(r) ?? 0) + 1);
  }
  const isSingleton = (id: string) => rootCount.get(uf.find(id)) === 1;
  const attached = new Set<string>();
  const powerNets = nets
    .filter((n) => n.isPower)
    .sort(
      (a, b) => a.name.localeCompare(b.name) || a.netId.localeCompare(b.netId),
    );
  for (const net of powerNets) {
    const members = netMembers(net, byId);
    const anchor = members.find((id) => byId.get(id)!.role === "anchor");
    if (!anchor) continue;
    for (const id of members) {
      const part = byId.get(id)!;
      if (part.role !== "passive" || part.pinCount > 2) continue;
      if (!isSingleton(id) || attached.has(id)) continue;
      uf.union(anchor, id);
      attached.add(id);
    }
  }

  return { uf, adjacency };
}

/** BFS ordering within a cluster from the highest-pin anchor; orphans appended. */
function orderCluster(
  members: AutoplacePart[],
  adjacency: Map<string, Set<string>>,
): AutoplacePart[] {
  const byId = new Map(members.map((m) => [m.partId, m]));
  const ids = new Set(members.map((m) => m.partId));
  const ranked = [...members].sort(
    (a, b) => b.pinCount - a.pinCount || compareRef(a.reference, b.reference),
  );
  const start = ranked[0]!;
  const visited = new Set<string>([start.partId]);
  const queue = [start.partId];
  const order: AutoplacePart[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(byId.get(cur)!);
    const neighbours = [...(adjacency.get(cur) ?? [])]
      .filter((n) => ids.has(n) && !visited.has(n))
      .sort((a, b) =>
        compareRef(byId.get(a)!.reference, byId.get(b)!.reference),
      );
    for (const n of neighbours) {
      visited.add(n);
      queue.push(n);
    }
  }
  for (const m of ranked) if (!visited.has(m.partId)) order.push(m);
  return order;
}

/** Lay one ordered cluster into a near-square block; returns block extent. */
function placeBlock(
  ordered: AutoplacePart[],
  baseX: number,
  baseY: number,
  channel: number,
  grid: number,
  positions: Map<string, { x: number; y: number }>,
): { width: number; height: number } {
  const cols = Math.max(
    1,
    Math.min(MAX_CLUSTER_COLS, Math.ceil(Math.sqrt(ordered.length))),
  );
  const rows = Math.ceil(ordered.length / cols);
  const colW = new Array<number>(cols).fill(0);
  const rowH = new Array<number>(rows).fill(0);
  ordered.forEach((p, idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    colW[c] = Math.max(colW[c]!, 2 * p.extent.halfW);
    rowH[r] = Math.max(rowH[r]!, 2 * p.extent.halfH);
  });
  const colX: number[] = [];
  let acc = baseX;
  for (let c = 0; c < cols; c += 1) {
    colX[c] = acc;
    acc += colW[c]! + channel;
  }
  const rowY: number[] = [];
  acc = baseY;
  for (let r = 0; r < rows; r += 1) {
    rowY[r] = acc;
    acc += rowH[r]! + channel;
  }
  ordered.forEach((p, idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    positions.set(p.partId, {
      x: snap(colX[c]! + colW[c]! / 2, grid),
      y: snap(rowY[r]! + rowH[r]! / 2, grid),
    });
  });
  const width = colW.reduce((s, w) => s + w, 0) + channel * (cols - 1);
  const height = rowH.reduce((s, h) => s + h, 0) + channel * (rows - 1);
  return { width, height };
}

/**
 * Safety-net AABB verifier (executed invariant). Block math already keeps
 * regions disjoint, so this almost never moves anything — but if two bodies
 * ever overlap it nudges the later part downward by whole grid steps until
 * clear, in canonical order, keeping the result deterministic.
 */
function resolveOverlaps(
  parts: AutoplacePart[],
  positions: Map<string, { x: number; y: number }>,
  channel: number,
  grid: number,
): void {
  const byId = new Map(parts.map((p) => [p.partId, p]));
  const ordered = [...positions.keys()].sort((a, b) => {
    const pa = positions.get(a)!;
    const pb = positions.get(b)!;
    return (
      pa.y - pb.y ||
      pa.x - pb.x ||
      compareRef(byId.get(a)?.reference ?? a, byId.get(b)?.reference ?? b)
    );
  });
  const placed: Array<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }> = [];
  const pad = channel / 2;
  for (const id of ordered) {
    const part = byId.get(id);
    const pos = positions.get(id)!;
    if (!part) continue;
    let { x, y } = pos;
    let guard = 0;
    const box = () => ({
      minX: x - part.extent.halfW - pad,
      minY: y - part.extent.halfH - pad,
      maxX: x + part.extent.halfW + pad,
      maxY: y + part.extent.halfH + pad,
    });
    let aabb = box();
    while (
      guard < 10_000 &&
      placed.some(
        (o) =>
          aabb.minX < o.maxX &&
          aabb.maxX > o.minX &&
          aabb.minY < o.maxY &&
          aabb.maxY > o.minY,
      )
    ) {
      y += grid;
      aabb = box();
      guard += 1;
    }
    positions.set(id, { x, y });
    placed.push(aabb);
  }
}

export function autoplaceSchematic(input: AutoplaceInput): AutoplaceResult {
  const grid = input.gridNm ?? SCHEMATIC_GRID_NM;
  const channel = input.channelNm ?? DEFAULT_CHANNEL_STEPS * grid;
  const origin = input.originNm ?? { x: 0, y: 0 };
  const maxBandWidth = input.maxBandWidthNm ?? DEFAULT_MAX_BAND_WIDTH_NM;
  const positions = new Map<string, { x: number; y: number }>();

  const parts = [...input.parts].sort((a, b) =>
    compareRef(a.reference, b.reference),
  );
  if (parts.length === 0) return { positions };
  const byId = new Map(parts.map((p) => [p.partId, p]));
  const nets = [...input.nets].sort((a, b) => a.netId.localeCompare(b.netId));

  const { uf, adjacency } = buildClusters(parts, nets, byId);

  // Group into clusters; order by (size desc, total pins desc, smallest ref).
  const clusters = new Map<string, AutoplacePart[]>();
  for (const p of parts) {
    const root = uf.find(p.partId);
    (clusters.get(root) ?? clusters.set(root, []).get(root)!).push(p);
  }
  const sumPins = (c: AutoplacePart[]) => c.reduce((s, p) => s + p.pinCount, 0);
  const minRef = (c: AutoplacePart[]) =>
    c.reduce(
      (m, p) => (compareRef(p.reference, m) < 0 ? p.reference : m),
      c[0]!.reference,
    );
  const clusterList = [...clusters.values()].sort(
    (a, b) =>
      b.length - a.length ||
      sumPins(b) - sumPins(a) ||
      compareRef(minRef(a), minRef(b)),
  );

  // Shelf-pack cluster blocks left→right, wrapping into bands.
  let bandX = origin.x;
  let bandY = origin.y;
  let bandHeight = 0;
  for (const cluster of clusterList) {
    const ordered = orderCluster(cluster, adjacency);
    // Pre-measure block width to decide on wrapping before placing.
    const cols = Math.max(
      1,
      Math.min(MAX_CLUSTER_COLS, Math.ceil(Math.sqrt(ordered.length))),
    );
    let probeWidth = 0;
    const colW = new Array<number>(cols).fill(0);
    ordered.forEach((p, idx) => {
      const c = idx % cols;
      colW[c] = Math.max(colW[c]!, 2 * p.extent.halfW);
    });
    probeWidth = colW.reduce((s, w) => s + w, 0) + channel * (cols - 1);
    if (bandX > origin.x && bandX + probeWidth > origin.x + maxBandWidth) {
      bandX = origin.x;
      bandY = bandY + bandHeight + channel;
      bandHeight = 0;
    }
    const block = placeBlock(ordered, bandX, bandY, channel, grid, positions);
    bandX += block.width + channel;
    bandHeight = Math.max(bandHeight, block.height);
  }

  resolveOverlaps(parts, positions, channel, grid);
  return { positions };
}
