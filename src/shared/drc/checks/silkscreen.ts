/**
 * `SILK_TO_MASK_CLEARANCE`, `SILK_TO_BOARD_EDGE`, `FAB_SILK_CLEARANCE`,
 * `FAB_SILK_WIDTH`, `FAB_SILK_TEXT_HEIGHT` (DFM contract 11 §3).
 *
 * Every item here comes from `ctx.silkArtwork()` and `ctx.maskIndex()` — the
 * SAME two models the Gerber writer emits (§1). Nothing on this page
 * re-derives a stroke, a transform or an opening: a legend verdict that judged
 * geometry the fab never receives would be worse than no verdict at all.
 *
 * A stroke is the exact union of its segment STADIUMS — a round aperture
 * dragged along the polyline, which is what `D02` / `D01` deposits. It is never
 * approximated by an inscribed polygon (Astra run 1 #17): a 0.15 mm line's
 * inscribed hull is 0.075 mm narrower per side than the ink, which is the whole
 * budget of a 0.15 mm silk-to-pad row.
 *
 * The gap to an opening is the FILLED-SET gap (§3): containment and crossing
 * are tested before any edge distance is trusted, so a stroke that runs THROUGH
 * a pad opening reports the penetration it is, not the zero an unsigned
 * perimeter distance would report.
 */
import type {
  DrcAnchor,
  PcbCopperLayerId,
  PcbPointMm,
} from "../../../sdks/designer";
import {
  polygonInsideRegion,
  polylineInsideRegion,
  regionBoundaryDistancePolyline,
  regionContainsPoint,
} from "../../pcb-geometry/board-region";
import {
  boundsOfPoints,
  type RingBounds,
} from "../../pcb-geometry/region-rings";
import {
  below,
  clearanceViolated,
  GEOM_EPS_MM,
} from "../../pcb-geometry/tolerance";
import type {
  SilkArtwork,
  SilkFace,
  SilkSource,
} from "../../rendering/pcb/artwork/silk-artwork";
import type { DrcContext, DrcPad, MaskFaceIndex } from "../drc-context";
import { ringGapToRing, stadiumGapToRing, type FilledGap } from "./filled-gap";
import { FAB_PRESETS } from "../fab-presets";
import type { DrcViolationDraft } from "../types";

/**
 * Legend ink to a solder-mask opening (mm) when `designRules.silkscreen` says
 * nothing (§6). ZERO on purpose: silk that merely touches an opening's edge is
 * normal on a dense board, and only real penetration — ink printed onto the
 * solderable area — is a defect.
 */
export const DEFAULT_SILK_TO_MASK_MM = 0;

/**
 * Legend ink to the board boundary (mm) when `designRules.silkscreen` says
 * nothing (§6) — OpenPCB's own documented parameter. Ink that runs off the
 * routed edge is scraped off in depanelling.
 */
export const DEFAULT_SILK_TO_EDGE_MM = 0.15;

const FACES: readonly SilkFace[] = ["top", "bottom"];

/** The face as the outer copper layer id — the §7 marker convention. */
function faceLayer(face: SilkFace): PcbCopperLayerId {
  return face === "top" ? "F.Cu" : "B.Cu";
}

// =========================================================================
// Silk items, grouped by SOURCE (§3: one violation per source, or per pair)
// =========================================================================

interface SilkItem {
  /** A stroke's centreline, or a region's ring (closed, half width 0). */
  pointsMm: readonly PcbPointMm[];
  closed: boolean;
  halfWidthMm: number;
  widthMm: number;
  bounds: RingBounds;
}

interface SilkGroup {
  key: string;
  face: SilkFace;
  anchor: DrcAnchor;
  subject: string;
  items: SilkItem[];
  bounds: RingBounds;
  maxHalfWidthMm: number;
  /** Set only for a TEXT source — the cap height the fab row judges. */
  fontSizeMm?: number;
}

function sourceKey(source: SilkSource): string {
  switch (source.kind) {
    case "overlayShape":
      return `os:${source.shapeId}`;
    case "overlayText":
      return `ot:${source.textId}`;
    case "placement":
      return "labelId" in source
        ? `pl:${source.placementId}:l:${source.labelId}`
        : `pl:${source.placementId}:g:${source.graphicIndex}`;
  }
}

function sourceAnchor(source: SilkSource): DrcAnchor {
  switch (source.kind) {
    case "overlayShape":
      return { kind: "overlayShape", shapeId: source.shapeId };
    case "overlayText":
      return { kind: "overlayText", textId: source.textId };
    case "placement":
      return { kind: "placement", placementId: source.placementId };
  }
}

function mergeBounds(a: RingBounds, b: RingBounds): RingBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * The artwork as source groups, in MODEL order. A text is many polylines under
 * one source; a filled graphic is a stroke plus a region under one source — and
 * each must produce at most one verdict per code, or a refdes would report five
 * times for one narrow pen.
 */
function groupArtwork(ctx: DrcContext, artwork: SilkArtwork): SilkGroup[] {
  const groups = new Map<string, SilkGroup>();
  const textSize = textSizeResolver(ctx);

  const add = (source: SilkSource, face: SilkFace, item: SilkItem): void => {
    const key = sourceKey(source);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      existing.bounds = mergeBounds(existing.bounds, item.bounds);
      existing.maxHalfWidthMm = Math.max(
        existing.maxHalfWidthMm,
        item.halfWidthMm,
      );
      return;
    }
    const fontSizeMm = textSize(source);
    groups.set(key, {
      key,
      face,
      anchor: sourceAnchor(source),
      subject: subjectOf(ctx, source),
      items: [item],
      bounds: item.bounds,
      maxHalfWidthMm: item.halfWidthMm,
      ...(fontSizeMm !== undefined ? { fontSizeMm } : {}),
    });
  };

  for (const stroke of artwork.strokes) {
    if (stroke.pointsMm.length < 2) continue;
    add(stroke.source, stroke.face, {
      pointsMm: stroke.pointsMm,
      closed: false,
      halfWidthMm: stroke.widthMm / 2,
      widthMm: stroke.widthMm,
      bounds: boundsOfPoints(stroke.pointsMm),
    });
  }
  for (const region of artwork.regions) {
    if (region.ring.length < 3) continue;
    add(region.source, region.face, {
      pointsMm: region.ring,
      closed: true,
      halfWidthMm: 0,
      widthMm: 0,
      bounds: boundsOfPoints(region.ring),
    });
  }
  return [...groups.values()];
}

/**
 * A text source's authored cap height. The artwork carries only the derived
 * stroke width (`max(0.1, 0.15 · size)`), which is not invertible below
 * 0.667 mm — exactly the range the fab row is about — so the size is read back
 * from the projection the artwork was built from.
 */
function textSizeResolver(
  ctx: DrcContext,
): (source: SilkSource) => number | undefined {
  let overlayById: Map<string, number> | undefined;
  const labelCache = new Map<string, Map<string, number>>();
  return (source) => {
    if (source.kind === "overlayText") {
      if (!overlayById) {
        overlayById = new Map(
          ctx.projection.overlayTexts.map((t) => [t.id, t.fontSizeMm]),
        );
      }
      return overlayById.get(source.textId);
    }
    if (source.kind !== "placement" || !("labelId" in source)) return undefined;
    let labels = labelCache.get(source.placementId);
    if (!labels) {
      const placement = ctx.placements.find((p) => p.id === source.placementId);
      labels = new Map(
        (placement?.footprint.preview?.labels ?? []).map((l) => [
          l.id,
          l.fontSizeMm,
        ]),
      );
      labelCache.set(source.placementId, labels);
    }
    return labels.get(source.labelId);
  };
}

function subjectOf(ctx: DrcContext, source: SilkSource): string {
  switch (source.kind) {
    case "overlayShape":
      return "Board silkscreen drawing";
    case "overlayText":
      return "Board silkscreen text";
    case "placement":
      return "labelId" in source
        ? `Silkscreen text of ${ctx.placementReference(source.placementId)}`
        : `Silkscreen of ${ctx.placementReference(source.placementId)}`;
  }
}

// =========================================================================
// Per-group verdicts
// =========================================================================

/** The worst (smallest) filled-set gap between a group and one ring. */
function groupGapToRing(
  group: SilkGroup,
  ring: readonly PcbPointMm[],
): FilledGap {
  let best: FilledGap | null = null;
  for (const item of group.items) {
    if (item.closed) {
      const hit = ringGapToRing(item.pointsMm, ring);
      if (!best || hit.gapMm < best.gapMm) best = hit;
      continue;
    }
    for (let i = 1; i < item.pointsMm.length; i += 1) {
      const hit = stadiumGapToRing(
        item.pointsMm[i - 1]!,
        item.pointsMm[i]!,
        item.halfWidthMm,
        ring,
      );
      if (!best || hit.gapMm < best.gapMm) best = hit;
    }
  }
  return best ?? { gapMm: Infinity, at: { x: 0, y: 0 } };
}

/**
 * Distance from the group to the board boundary, and whether it is inside.
 *
 * Measured per SEGMENT, not per item: the marker is location-hashed into the
 * violation id, so a metre-long silk polyline whose far end grazes the edge must
 * mark the graze and not the polyline's first vertex — otherwise a waiver keys
 * to a spot the defect is not at.
 */
function groupToBoardEdge(
  ctx: DrcContext,
  group: SilkGroup,
  haloMm: number,
): { gapMm: number; at: PcbPointMm; inside: boolean } {
  const region = ctx.boardRegion;
  const index = ctx.regionIndex;
  let gapMm = Infinity;
  let at: PcbPointMm = group.items[0]?.pointsMm[0] ?? { x: 0, y: 0 };
  let inside = true;
  for (const item of group.items) {
    const pts = item.pointsMm;
    const last = item.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < last; i += 1) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const d =
        regionBoundaryDistancePolyline(region, [a, b], index, haloMm) -
        item.halfWidthMm;
      if (d < gapMm) {
        gapMm = d;
        at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    }
    if (
      inside &&
      !(item.closed
        ? polygonInsideRegion(region, pts, GEOM_EPS_MM, index)
        : polylineInsideRegion(region, pts, GEOM_EPS_MM, index))
    ) {
      inside = false;
      at = outsideWitness(ctx, pts, at);
    }
  }
  return { gapMm, at, inside };
}

/** The first vertex that is not on the board — the marker for off-board ink. */
function outsideWitness(
  ctx: DrcContext,
  pts: readonly PcbPointMm[],
  fallback: PcbPointMm,
): PcbPointMm {
  for (const p of pts) {
    if (!regionContainsPoint(ctx.boardRegion, p, GEOM_EPS_MM, ctx.regionIndex)) {
      return p;
    }
  }
  return pts[0] ?? fallback;
}

// =========================================================================
// Entry point
// =========================================================================

export function checkSilkscreen(ctx: DrcContext): DrcViolationDraft[] {
  const artwork = ctx.silkArtwork();
  if (artwork.strokes.length === 0 && artwork.regions.length === 0) return [];

  const out: DrcViolationDraft[] = [];
  const rules = ctx.designRules.silkscreen;
  const toMaskMm = rules?.silkToMaskClearanceMm ?? DEFAULT_SILK_TO_MASK_MM;
  const toEdgeMm = rules?.silkToBoardEdgeMm ?? DEFAULT_SILK_TO_EDGE_MM;
  const preset = ctx.fabricator === "custom" ? null : FAB_PRESETS[ctx.fabricator];

  const groups = groupArtwork(ctx, artwork);
  // A pad's COPPER can stick out past its own opening when the expansion is
  // negative, so the opening's bounds are not a superset of the copper the fab
  // row also measures against. Widen every query by the largest contraction the
  // board or any free pad declares (§3, Astra run 1 #18).
  const copperOutsetMm = maxCopperOutsetMm(ctx);
  const padByKey = new Map(ctx.pads.map((p) => [p.key, p] as const));

  for (const face of FACES) {
    const faceGroups = groups.filter((g) => g.face === face);
    if (faceGroups.length === 0) continue;
    const layer = faceLayer(face);
    const mask = ctx.maskIndex(face);

    for (const group of faceGroups) {
      judgeFabWidth(group, preset, layer, out);
      judgeFabTextHeight(group, preset, layer, out);
      judgeBoardEdge(ctx, group, toEdgeMm, layer, out);
      judgeOpenings(
        group,
        mask,
        padByKey,
        { toMaskMm, preset, copperOutsetMm, layer },
        out,
      );
    }
  }
  return out;
}

type Preset = (typeof FAB_PRESETS)[keyof typeof FAB_PRESETS] | null;

/** The largest amount a pad's copper can extend past its own mask opening. */
function maxCopperOutsetMm(ctx: DrcContext): number {
  let worst = -(ctx.board.solderMaskExpansionMm ?? 0);
  for (const pad of ctx.projection.freePads) {
    const expansion = pad.solderMaskExpansionMm;
    if (expansion !== undefined && expansion !== null) {
      worst = Math.max(worst, -expansion);
    }
  }
  return Math.max(0, worst);
}

function judgeFabWidth(
  group: SilkGroup,
  preset: Preset,
  layer: PcbCopperLayerId,
  out: DrcViolationDraft[],
): void {
  if (!preset) return;
  let worst: SilkItem | null = null;
  for (const item of group.items) {
    // A filled region carries no pen width; only strokes have one.
    if (item.closed || !(item.widthMm > 0)) continue;
    if (!worst || item.widthMm < worst.widthMm) worst = item;
  }
  if (!worst || !below(worst.widthMm, preset.minSilkLineWidthMm)) return;
  out.push({
    code: "FAB_SILK_WIDTH",
    message: `${group.subject} is ${worst.widthMm.toFixed(3)} mm wide < ${preset.name} min ${preset.minSilkLineWidthMm.toFixed(3)} mm`,
    anchors: [group.anchor],
    locationMm: worst.pointsMm[0]!,
    layer,
    measuredMm: worst.widthMm,
    requiredMm: preset.minSilkLineWidthMm,
  });
}

function judgeFabTextHeight(
  group: SilkGroup,
  preset: Preset,
  layer: PcbCopperLayerId,
  out: DrcViolationDraft[],
): void {
  if (!preset || group.fontSizeMm === undefined) return;
  if (!below(group.fontSizeMm, preset.minSilkTextHeightMm)) return;
  out.push({
    code: "FAB_SILK_TEXT_HEIGHT",
    message: `${group.subject} is ${group.fontSizeMm.toFixed(3)} mm high < ${preset.name} min ${preset.minSilkTextHeightMm.toFixed(3)} mm`,
    anchors: [group.anchor],
    locationMm: group.items[0]!.pointsMm[0]!,
    layer,
    measuredMm: group.fontSizeMm,
    requiredMm: preset.minSilkTextHeightMm,
  });
}

function judgeBoardEdge(
  ctx: DrcContext,
  group: SilkGroup,
  requiredMm: number,
  layer: PcbCopperLayerId,
  out: DrcViolationDraft[],
): void {
  const halo = requiredMm + group.maxHalfWidthMm + GEOM_EPS_MM;
  const hit = groupToBoardEdge(ctx, group, halo);
  if (!hit.inside) {
    // Off-board ink is not a distance verdict: there is no clearance left to
    // measure, so the deficit is the whole requirement.
    out.push({
      code: "SILK_TO_BOARD_EDGE",
      message: `${group.subject} is outside the board`,
      anchors: [group.anchor],
      locationMm: hit.at,
      layer,
      measuredMm: 0,
      requiredMm,
    });
    return;
  }
  if (!(requiredMm > 0) || !below(hit.gapMm, requiredMm)) return;
  out.push({
    code: "SILK_TO_BOARD_EDGE",
    message: `${group.subject} is ${hit.gapMm.toFixed(3)} mm from the board edge < ${requiredMm.toFixed(3)} mm`,
    anchors: [group.anchor],
    locationMm: hit.at,
    layer,
    measuredMm: hit.gapMm,
    requiredMm,
  });
}

function judgeOpenings(
  group: SilkGroup,
  mask: MaskFaceIndex,
  padByKey: ReadonlyMap<string, DrcPad>,
  params: {
    toMaskMm: number;
    preset: Preset;
    copperOutsetMm: number;
    layer: PcbCopperLayerId;
  },
  out: DrcViolationDraft[],
): void {
  const { toMaskMm, preset, copperOutsetMm, layer } = params;
  const fabRowMm = preset?.silkToMaskMm;
  const halo =
    Math.max(toMaskMm, fabRowMm ?? 0) +
    group.maxHalfWidthMm +
    copperOutsetMm +
    GEOM_EPS_MM;
  for (const i of mask.near("pads", group.bounds, halo)) {
    const opening = mask.openings[i]!;
    const ring = mask.rings[i]!;
    const toOpening = groupGapToRing(group, ring);
    if (clearanceViolated(toOpening.gapMm, toMaskMm)) {
      out.push({
        code: "SILK_TO_MASK_CLEARANCE",
        message:
          toOpening.gapMm < 0
            // "≈": for a stroke that crosses clean through, the depth is the
            // one at the middle of the inside run, not the deepest anywhere.
            ? `${group.subject} runs ≈${(-toOpening.gapMm).toFixed(3)} mm into a solder-mask opening`
            : `${group.subject} is ${toOpening.gapMm.toFixed(3)} mm from a solder-mask opening < ${toMaskMm.toFixed(3)} mm`,
        anchors: [group.anchor, opening.anchor],
        locationMm: toOpening.at,
        layer,
        measuredMm: toOpening.gapMm,
        requiredMm: toMaskMm,
      });
    }
    if (fabRowMm === undefined || !preset) continue;
    // The row names a PAD: a bare drill relief and an untented via are not one.
    if (!opening.copper) continue;
    if (opening.anchor.kind !== "pad" && opening.anchor.kind !== "freePad") {
      continue;
    }
    // The page does not say whether the copper or the exposed area is meant, so
    // measure BOTH and keep the smaller — conservative under a positive
    // expansion (the opening is wider) and under a negative one (the copper is).
    const pad = opening.ownerKey ? padByKey.get(opening.ownerKey) : undefined;
    const toCopper = pad ? groupGapToRing(group, pad.ring) : null;
    const bound =
      toCopper && toCopper.gapMm < toOpening.gapMm
        ? { hit: toCopper, what: "copper" }
        : { hit: toOpening, what: "mask opening" };
    if (!below(bound.hit.gapMm, fabRowMm)) continue;
    out.push({
      code: "FAB_SILK_CLEARANCE",
      message: `${group.subject} is ${bound.hit.gapMm.toFixed(3)} mm from a pad's ${bound.what} < ${preset.name} min ${fabRowMm.toFixed(3)} mm`,
      anchors: [group.anchor, opening.anchor],
      locationMm: bound.hit.at,
      layer,
      measuredMm: bound.hit.gapMm,
      requiredMm: fabRowMm,
    });
  }
}
