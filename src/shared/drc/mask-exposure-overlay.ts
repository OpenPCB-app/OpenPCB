// The live gate's EXPOSURE overlay (electrical contract 13 §1.2, §4.4).
//
// Exposure is a property of the FINAL artwork, not of the committed board: an
// untented pending via adds an opening on both faces, and `replaces` takes the
// replaced vias' openings away. Either can uncover — or re-cover — an EXISTING
// item's copper, which moves that item's IPC-2221 column from B4 to B2 or back
// (Astra run 1 #5). So the overlay recomputes exposure over board-minus-
// `replaces`-plus-pending, and every existing item whose answer moved joins the
// rejudge set.
//
// Only a COATED board can have an exposure question at all — uncoated, the
// outer column is B2 whatever the mask does — and only a board with a declared
// voltage reads the column. Both gates are checked first, so an ordinary board
// pays nothing.

import type { DrcAnchor, PcbCopperLayerId } from "../../sdks/designer";
import type { EffectiveNetItem } from "../pcb-connectivity/effective-nets";
import { buildCopperRecords } from "../pcb-connectivity/copper-records";
import { boundsOfPoints } from "../pcb-geometry/region-rings";
import { GEOM_EPS_MM } from "../pcb-geometry/tolerance";
import { apertureShapeRing } from "../rendering/pcb/artwork/aperture-shape";
import {
  buildMaskOpenings,
  type MaskFace,
  type MaskOpening,
} from "../rendering/pcb/artwork/mask-artwork";
import { createBroadPhase } from "./broad-phase";
import type {
  DrcItems,
  LegalityContext,
  MaskFaceIndex,
} from "./drc-context";
import { itemExposedOnFace } from "./mask-exposure";

/** The two mask faces and the copper layer each one covers. */
const OUTER: ReadonlyArray<{ face: MaskFace; layer: PcbCopperLayerId }> = [
  { face: "top", layer: "F.Cu" },
  { face: "bottom", layer: "B.Cu" },
];

export interface ExposureOverlay {
  /** `exposedOn` over the FINAL artwork, for the overlay context. */
  exposedOn: LegalityContext["exposedOn"];
  /** Existing items whose exposure on some outer face moved (§4.4). */
  changed: readonly EffectiveNetItem[];
}

function itemOnLayer(item: EffectiveNetItem, layer: PcbCopperLayerId): boolean {
  return "pointsMm" in item
    ? item.layer === layer
    : item.layers.includes(layer);
}

/** The opening belongs to a via this commit removes. */
function replacedVia(anchor: DrcAnchor, replaces: ReadonlySet<string>): boolean {
  return anchor.kind === "via" && replaces.has(anchor.viaId);
}

function indexOf(openings: readonly MaskOpening[]): MaskFaceIndex {
  const rings = openings.map((o) => apertureShapeRing(o.shape, o.centerMm));
  const bounds = rings.map((ring) => boundsOfPoints(ring));
  const { near } = createBroadPhase({
    traces: [],
    pads: bounds,
    vias: [],
    holes: [],
  });
  return { openings, rings, bounds, near };
}

/**
 * The overlay, or `null` when the board can have no exposure question — in
 * which case the caller keeps `ctx.exposedOn` and its memo untouched.
 */
export function buildExposureOverlay(
  ctx: LegalityContext,
  pending: DrcItems,
  replaces: ReadonlySet<string>,
): ExposureOverlay | null {
  if (ctx.board.designRules.electrical?.outerConductors !== "coated") return null;
  if (!ctx.resolver.hasVoltageTerms) return null;

  // A route commits no pads, so only VIAS can add an opening — and only an
  // untented one, which `buildMaskOpenings` decides, not this module.
  const added =
    pending.vias.length === 0
      ? []
      : buildMaskOpenings({
          solderMaskExpansionMm: ctx.board.solderMaskExpansionMm,
          layerCount: ctx.layerCount,
          placements: [],
          freePads: [],
          vias: pending.vias.map((v) => v.via),
          records: buildCopperRecords({
            layerCount: ctx.layerCount,
            placements: [],
            padNetIds: new Map(),
            freePads: [],
            traces: [],
            vias: pending.vias.map((v) => v.via),
          }),
          padShapes: new Map(),
        });

  const byFace = new Map<MaskFace, MaskFaceIndex>();
  /** Rings this commit ADDS or REMOVES on a face — the only exposure movers. */
  const movedByFace = new Map<MaskFace, Array<readonly { x: number; y: number }[]>>();
  let moved = false;
  for (const { face } of OUTER) {
    const board = ctx.maskIndex(face);
    const extra = added.filter((o) => o.face === face);
    const dropped: number[] = [];
    board.openings.forEach((o, i) => {
      if (replacedVia(o.anchor, replaces)) dropped.push(i);
    });
    if (extra.length === 0 && dropped.length === 0) {
      byFace.set(face, board);
      movedByFace.set(face, []);
      continue;
    }
    moved = true;
    const dropSet = new Set(dropped);
    const kept = board.openings.filter((_, i) => !dropSet.has(i));
    byFace.set(face, indexOf([...kept, ...extra]));
    movedByFace.set(face, [
      ...dropped.map((i) => board.rings[i]!),
      ...extra.map((o) => apertureShapeRing(o.shape, o.centerMm)),
    ]);
  }
  // Nothing about the artwork moved, so nothing about exposure can: the board's
  // own memoised verdicts are the final ones.
  if (!moved) return null;

  const cache = new Map<MaskFace, Map<EffectiveNetItem, boolean>>();
  const exposedOn = (
    item: EffectiveNetItem,
    layer: PcbCopperLayerId,
  ): boolean => {
    const entry = OUTER.find((o) => o.layer === layer);
    if (!entry) return false;
    let memo = cache.get(entry.face);
    if (!memo) {
      memo = new Map<EffectiveNetItem, boolean>();
      cache.set(entry.face, memo);
    }
    const hit = memo.get(item);
    if (hit !== undefined) return hit;
    const value = itemExposedOnFace(item, byFace.get(entry.face)!);
    memo.set(item, value);
    return value;
  };

  return {
    exposedOn,
    changed: collectChanged(ctx, replaces, movedByFace, exposedOn),
  };
}

/**
 * Existing items whose exposure moved. An item's answer can only change where
 * an opening was ADDED or REMOVED, so the search is seeded from those rings
 * through the board grid — never a walk over every item on the board.
 */
function collectChanged(
  ctx: LegalityContext,
  replaces: ReadonlySet<string>,
  movedByFace: ReadonlyMap<MaskFace, ReadonlyArray<readonly { x: number; y: number }[]>>,
  exposedOn: (item: EffectiveNetItem, layer: PcbCopperLayerId) => boolean,
): EffectiveNetItem[] {
  const changed: EffectiveNetItem[] = [];
  const seen = new Set<EffectiveNetItem>();
  const consider = (item: EffectiveNetItem, layer: PcbCopperLayerId): void => {
    if (seen.has(item)) return;
    if (!itemOnLayer(item, layer)) return;
    if (ctx.exposedOn(item, layer) === exposedOn(item, layer)) return;
    seen.add(item);
    changed.push(item);
  };
  for (const { face, layer } of OUTER) {
    for (const ring of movedByFace.get(face) ?? []) {
      if (ring.length < 3) continue;
      const bounds = boundsOfPoints(ring);
      for (const i of ctx.near("traces", bounds, GEOM_EPS_MM)) {
        const t = ctx.traces[i]!;
        if (!replaces.has(t.id)) consider(t, layer);
      }
      for (const i of ctx.near("pads", bounds, GEOM_EPS_MM)) {
        consider(ctx.pads[i]!, layer);
      }
      for (const i of ctx.near("vias", bounds, GEOM_EPS_MM)) {
        const v = ctx.vias[i]!;
        if (!replaces.has(v.via.id)) consider(v, layer);
      }
    }
  }
  return changed;
}
