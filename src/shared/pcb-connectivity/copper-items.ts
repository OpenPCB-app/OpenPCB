// Copper items — the nodes of the connectivity graph.
//
// An item is a record mapped through the FAIL-SAFE layer policy: a
// layer-invalid pad or via occupies no layer at all, so it can never
// manufacture a connection that the fabricated board would not have. The worst
// outcome is an extra airwire; DRC reports the defect separately under the
// clamp policy. Keys are stable strings so pour membership (computed in the
// fill kernel) and contact records can reference an item without holding it.

import type { PcbCopperLayerId, PcbPointMm } from "../../sdks/designer";
import { ringBounds, type RingBounds } from "../pcb-geometry/pad-outline";
import type {
  CopperPadAnchor,
  CopperRecords,
  PadCopperRecord,
} from "./copper-records";

/**
 * Key of one physical pad shape. A footprint may carry several pads with the
 * same number (one pin, several copper shapes); each shape is its own item, so
 * the occurrence index (preview order) is part of the key. The triple is
 * JSON-encoded rather than concatenated because pad numbers are free text — a
 * pad literally numbered `1#2` would otherwise collide with the second shape of
 * pad `1`, and a separator character can appear in a placement id too.
 *
 * An UNPLATED pad's shape is keyed by a FOUR-tuple, one item per copper layer
 * (manufacturability contract 10 §2.4): an unplated ring never conducts between
 * faces, so a front trace and a back trace touching the two rings of one hole
 * must land in two components. The DRC pad item and the violation-id anchor
 * stay per pad — only the kernel splits.
 */
export const padItemKey = (
  placementId: string,
  padNumber: string,
  occurrence = 0,
  layer?: PcbCopperLayerId,
): string =>
  `pad:${JSON.stringify(
    layer === undefined
      ? [placementId, padNumber, occurrence]
      : [placementId, padNumber, occurrence, layer],
  )}`;

export const freePadItemKey = (id: string, layer?: PcbCopperLayerId): string =>
  layer === undefined ? `freepad:${id}` : `freepad:${id}:${layer}`;
export const traceItemKey = (id: string): string => `trace:${id}`;
export const viaItemKey = (id: string): string => `via:${id}`;
/**
 * Key of one filled island. Both ordinals are needed: a board can carry several
 * pours of the same net on the same layer (a board-wide fill plus explicit
 * zones), and every one of them numbers its own islands from 0.
 */
export const pourItemKey = (
  layer: PcbCopperLayerId,
  netId: string,
  pourIndex: number,
  islandIndex: number,
): string => `pour:${layer}:${netId}:${pourIndex}:${islandIndex}`;

export interface PadCopperItem {
  kind: "pad";
  key: string;
  netId: string | null;
  layers: readonly PcbCopperLayerId[];
  ring: readonly PcbPointMm[];
  /** Exact disc for a circular pad; see `PadCopperRecord.disc`. */
  disc?: { center: PcbPointMm; radiusMm: number };
  bounds: RingBounds;
  center: PcbPointMm;
  anchor: CopperPadAnchor;
}

export interface TraceCopperItem {
  kind: "trace";
  key: string;
  id: string;
  netId: string | null;
  layer: PcbCopperLayerId;
  pointsMm: readonly PcbPointMm[];
  halfWidthMm: number;
  bounds: RingBounds;
}

export interface ViaCopperItem {
  kind: "via";
  key: string;
  id: string;
  netId: string | null;
  layers: readonly PcbCopperLayerId[];
  center: PcbPointMm;
  radiusMm: number;
  bounds: RingBounds;
}

export interface PourCopperItem {
  kind: "pour";
  key: string;
  netId: string;
  layer: PcbCopperLayerId;
  /**
   * Which pour on this layer/net produced the island. Islands of ONE pour are
   * disjoint by construction; islands of two different pours (overlapping
   * zones, or a zone over a board-wide fill) can overlap and must then merge.
   */
  pourIndex: number;
  /** `[outer, ...holes]`, as returned by the fill kernel. */
  rings: ReadonlyArray<ReadonlyArray<PcbPointMm>>;
  /** Keys of the same-net items whose bare copper intersects this island. */
  memberKeys: ReadonlySet<string>;
  bounds: RingBounds;
}

export type CopperItem =
  | PadCopperItem
  | TraceCopperItem
  | ViaCopperItem
  | PourCopperItem;

/**
 * Item key of one pad record. Exported because the Gerber writer and the mask
 * artwork model index pad SHAPES by the same identity (DFM contract 11 §1.3) —
 * omit `layer` for the per-pad key, pass it for the unplated per-layer split.
 */
export function padRecordKey(
  record: PadCopperRecord,
  layer?: PcbCopperLayerId,
): string {
  return record.anchor.kind === "pad"
    ? padItemKey(
        record.anchor.placementId,
        record.anchor.padNumber,
        record.occurrence,
        layer,
      )
    : freePadItemKey(record.anchor.freePadId, layer);
}

/**
 * Item keys must be unique: they index the graph, and a duplicated trace / via
 * id in persisted data would otherwise make the verdict depend on which copy
 * was written last. Later occurrences of an already-used key get a `#2`, `#3`
 * … suffix in record order. A renamed duplicate no longer matches the fill
 * kernel's membership key (which is built from the raw id), so it simply loses
 * pour membership — fail-safe, an extra airwire at worst.
 */
function uniqueKey(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}#${n}`)) n += 1;
  const key = `${base}#${n}`;
  used.add(key);
  return key;
}

/** Twice the absolute polygon area (shoelace) — zero for a degenerate ring. */
function ringDoubleArea(ring: readonly PcbPointMm[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum);
}

/**
 * Records → fail-safe items. Degenerate copper is not copper: a zero-width
 * trace, a zero-radius via and a pad ring with fewer than three vertices or no
 * area produce no item, so bad data can never bridge two components. DRC still
 * sees them through the records and reports the defect itself.
 */
export function toCopperItems(records: CopperRecords): CopperItem[] {
  const items: CopperItem[] = [];
  const used = new Set<string>();
  for (const pad of records.pads) {
    if (pad.ring.length < 3 || !(ringDoubleArea(pad.ring) > 0)) continue;
    const layers = pad.declaredLayerInvalid ? [] : pad.resolvedLayers;
    const common = {
      kind: "pad" as const,
      ring: pad.ring,
      ...(pad.disc ? { disc: pad.disc } : {}),
      bounds: pad.bounds,
      center: pad.center,
      anchor: pad.anchor,
    };
    if (!pad.plated && layers.length >= 2) {
      // One NULL-net item per copper layer (contract 10 §2.4). The ring may
      // still be an unassigned extension of copper it touches on ITS layer
      // (01 §2), but two rings on different faces are never one node — the
      // previous single item let the ratsnest's logical-pin union hide an open
      // through the barrel that is not there. The split exists ONLY to deny
      // conduction BETWEEN faces: unplated copper on a single layer (a drilled
      // `smd` / `conn` free pad — a test point with a probe hole) has no barrel
      // to fake and keeps its net and its one item (Astra run 2). An unplated
      // pad whose declared layer is off the stackup resolves to NO layer and
      // therefore to no item at all: fail-safe, an extra airwire at worst.
      for (const layer of layers) {
        items.push({
          ...common,
          key: uniqueKey(padRecordKey(pad, layer), used),
          netId: null,
          layers: [layer],
        });
      }
      continue;
    }
    items.push({
      ...common,
      key: uniqueKey(padRecordKey(pad), used),
      netId: pad.netId,
      layers,
    });
  }
  for (const trace of records.traces) {
    if (trace.pointsMm.length < 2 || !(trace.halfWidthMm > 0)) continue;
    items.push({
      kind: "trace",
      key: uniqueKey(traceItemKey(trace.id), used),
      id: trace.id,
      netId: trace.netId,
      layer: trace.layer,
      pointsMm: trace.pointsMm,
      halfWidthMm: trace.halfWidthMm,
      bounds: trace.bounds,
    });
  }
  for (const via of records.vias) {
    if (!(via.radiusMm > 0)) continue;
    items.push({
      kind: "via",
      key: uniqueKey(viaItemKey(via.via.id), used),
      id: via.via.id,
      netId: via.netId,
      layers: via.layerSpanInvalid ? [] : via.span,
      center: via.center,
      radiusMm: via.radiusMm,
      bounds: via.bounds,
    });
  }
  return items;
}

/** One filled pour island as a graph node. */
export function pourCopperItem(input: {
  layer: PcbCopperLayerId;
  netId: string;
  /** Position of the pour among the board's pours. */
  pourIndex: number;
  /** Position of the island within that pour's total order. */
  index: number;
  rings: ReadonlyArray<ReadonlyArray<PcbPointMm>>;
  memberKeys: Iterable<string>;
}): PourCopperItem {
  return {
    kind: "pour",
    key: pourItemKey(input.layer, input.netId, input.pourIndex, input.index),
    netId: input.netId,
    layer: input.layer,
    pourIndex: input.pourIndex,
    rings: input.rings,
    memberKeys: new Set(input.memberKeys),
    bounds: ringBounds(input.rings[0] ?? []),
  };
}
