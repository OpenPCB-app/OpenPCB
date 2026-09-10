import type {
  PcbDrillSlot,
  PcbFreeHole,
  PcbFreePad,
  PcbPlacedPart,
  PcbPointMm,
  PcbVia,
} from "../../../sdks";
import { placementMirrorX } from "../../../sdks/designer/pcb-helpers";
import {
  padWorldPositionMm,
  placementPads,
  transformPadCenterMm,
} from "../../pcb-geometry/pad-geometry";
import type { FootprintRenderSourcePad } from "../types";

/**
 * Centreline of an oblong drill: the routed stadium runs from `a` to `b` with
 * radius `widthMm / 2`. Same interpretation as the Excellon writer's `G85`
 * slot and the DRC's `DrcHole.slot` — every consumer reads it from HERE, or the
 * fab routes something the board never cleared for.
 */
export interface DrillSlotCenterline {
  a: PcbPointMm;
  b: PcbPointMm;
  widthMm: number;
}

export interface DrillInstance {
  centerMm: PcbPointMm;
  radiusMm: number;
  /**
   * Present when the drill is a routed slot rather than a round hit. Consumers
   * that model a drill as a disc may ignore it; anything that must not overhang
   * the real hole (the pour's apertures) has to clear the whole stadium.
   */
  slot?: DrillSlotCenterline;
}

/**
 * The slot a `drillSlot` describes, or `null` for a round hole. `lengthMm` is
 * the overall long dimension along `angleDeg`, so the cap centres are inset by
 * `widthMm / 2`; `lengthMm <= widthMm` degenerates to a round hole.
 */
export function drillSlotCenterline(
  centerMm: PcbPointMm,
  drillSlot: PcbDrillSlot | null | undefined,
): DrillSlotCenterline | null {
  if (!drillSlot || drillSlot.lengthMm <= drillSlot.widthMm) return null;
  const half = (drillSlot.lengthMm - drillSlot.widthMm) / 2;
  const rad = (drillSlot.angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  return {
    a: { x: centerMm.x - dx, y: centerMm.y - dy },
    b: { x: centerMm.x + dx, y: centerMm.y + dy },
    widthMm: drillSlot.widthMm,
  };
}

/** A free pad's drill, as every consumer must see it. */
export interface FreePadDrill {
  drillMm: number;
  /** Present when the drill is a routed slot rather than a round hit. */
  slot?: DrillSlotCenterline;
  /** Plated (`std`) — an `smd` / `conn` / `hole` drill is NPTH. */
  plated: boolean;
}

/**
 * THE one derivation of a free pad's drill — DRC holes, the pour apertures, the
 * Excellon writer and the snapshot all read it (contract 06 §2). A drill is a
 * drill whatever the pad type says: `smd` / `conn` pads persist one too, and it
 * reaches the fab as a non-plated hit, so no consumer may filter on `padType`
 * before asking this.
 */
export function freePadDrill(pad: PcbFreePad): FreePadDrill | null {
  // `!(x > 0)` also rejects NaN / undefined from non-store producers (R1 #8).
  if (pad.drillMm === null || !(pad.drillMm > 0)) return null;
  const slot = drillSlotCenterline(pad.centerMm, pad.drillSlot);
  return {
    // `drillMm` IS the tool: for a routed slot that is the slot width, whatever
    // the row's `drillMm` says (contract 10 §1.2 — the hydrator makes the two
    // equal, and a row that predates it must not be judged on the wrong
    // number: S11 R1 #3).
    drillMm: slot ? slot.widthMm : pad.drillMm,
    ...(slot ? { slot } : {}),
    plated: pad.padType === "std",
  };
}

/**
 * The three drill attributes a `FootprintRenderSourcePad` may carry. They are
 * declared on `@openpcb/rendering-core`'s pad in the sibling checkout but NOT
 * in the pinned package, so every read goes through {@link padDrillFields},
 * which narrows structurally and behaves identically either way (contract 10
 * §2.1). No consumer may read `plated` / `drillSlotMm` / `drillOffsetMm`
 * directly.
 */
export interface FootprintPadDrillFields {
  readonly plated?: boolean;
  readonly drillSlotMm?: {
    readonly widthMm: number;
    readonly heightMm: number;
  };
  readonly drillOffsetMm?: { readonly x: number; readonly y: number };
}

export interface ResolvedPadDrillFields {
  /** ABSENT means plated — every pad that exists today keeps its meaning. */
  readonly plated: boolean;
  /** KiCad `(drill oval W H)`, pad-local axes; `null` when unusable. */
  readonly drillSlotMm: { readonly widthMm: number; readonly heightMm: number } | null;
  /** KiCad `(drill … (offset X Y))`, pad-local; `null` at the origin. */
  readonly drillOffsetMm: { readonly x: number; readonly y: number } | null;
}

/** THE one narrowing read of a pad's drill attributes (contract 10 §2.1). */
export function padDrillFields(
  pad: FootprintRenderSourcePad,
): ResolvedPadDrillFields {
  const ext = pad as FootprintRenderSourcePad & FootprintPadDrillFields;
  const slot = ext.drillSlotMm;
  const offset = ext.drillOffsetMm;
  const slotUsable =
    slot !== undefined &&
    Number.isFinite(slot.widthMm) &&
    Number.isFinite(slot.heightMm) &&
    slot.widthMm > 0 &&
    slot.heightMm > 0;
  // A (0, 0) offset is no offset: it must not perturb a centred drill.
  const offsetUsable =
    offset !== undefined &&
    Number.isFinite(offset.x) &&
    Number.isFinite(offset.y) &&
    (offset.x !== 0 || offset.y !== 0);
  return {
    // `plated` is meaningless without a drill (the field's own doc): an
    // undrilled pad is copper on its layers and nothing else — it must not lose
    // its net to the unplated per-layer split (S11 R1 #4).
    plated:
      ext.plated !== false ||
      !(pad.drillDiameterMm !== undefined && pad.drillDiameterMm > 0),
    drillSlotMm: slotUsable
      ? { widthMm: slot.widthMm, heightMm: slot.heightMm }
      : null,
    drillOffsetMm: offsetUsable ? { x: offset.x, y: offset.y } : null,
  };
}

/** A footprint pad's drill, as every consumer must see it (contract 10 §1.1). */
export interface FootprintPadDrill {
  centerMm: PcbPointMm;
  /** Tool diameter — the NARROW axis of a slot. */
  drillMm: number;
  /** Present when the drill is a routed slot rather than a round hit. */
  slot?: DrillSlotCenterline;
  plated: boolean;
}

/**
 * THE one derivation of a footprint pad's drill — DRC holes, the pour
 * apertures, the Excellon writer, `collectDrills` and the snapshot all read it
 * (contract 10 §1.1). Returns `null` when the pad has no positive drill.
 *
 * Frame (§1.2): the drill offset and the slot axis are PAD-local, so they are
 * mapped with the pad's composed world rotation (`placement ± pad`, conjugated
 * when mirrored) after the X reflection — the exact composition
 * `padOutlineWorldMm` applies to the copper, so a mirrored placement mirrors
 * the slot together with the copper. `padWorldPositionMm` supplies the centre,
 * so the drill and the copper record can never sit at two different points.
 */
export function footprintPadDrill(
  pad: FootprintRenderSourcePad,
  placement: PcbPlacedPart,
): FootprintPadDrill | null {
  const diameter = pad.drillDiameterMm;
  // `!(x > 0)` also rejects NaN / undefined from non-store producers.
  if (diameter === undefined || !(diameter > 0)) return null;
  const { plated, drillSlotMm, drillOffsetMm } = padDrillFields(pad);
  const mirrored = placementMirrorX(placement);
  const worldRotDeg = mirrored
    ? placement.rotationDeg - pad.rotationDeg
    : placement.rotationDeg + pad.rotationDeg;
  const base = padWorldPositionMm(placement, pad);
  const offset = drillOffsetMm
    ? transformPadCenterMm(drillOffsetMm, worldRotDeg, mirrored)
    : { x: 0, y: 0 };
  const centerMm = { x: base.x + offset.x, y: base.y + offset.y };

  // A slot's TOOL is its narrow axis whether or not the slot is degenerate: a
  // square `(drill oval 0.8 0.8)` is routed with a 0.8 bit, not drilled with
  // whatever `drillDiameterMm` says (Astra run 2b #2).
  const tool = drillSlotMm
    ? Math.min(drillSlotMm.widthMm, drillSlotMm.heightMm)
    : diameter;
  if (drillSlotMm) {
    const span = Math.max(drillSlotMm.widthMm, drillSlotMm.heightMm) - tool;
    if (span > 0) {
      // Long axis: X when W > H, else Y — mapped as a pad-local VECTOR.
      const u = transformPadCenterMm(
        drillSlotMm.widthMm > drillSlotMm.heightMm
          ? { x: 1, y: 0 }
          : { x: 0, y: 1 },
        worldRotDeg,
        mirrored,
      );
      const half = span / 2;
      return {
        centerMm,
        drillMm: tool,
        slot: {
          a: { x: centerMm.x - half * u.x, y: centerMm.y - half * u.y },
          b: { x: centerMm.x + half * u.x, y: centerMm.y + half * u.y },
          widthMm: tool,
        },
        plated,
      };
    }
    // `max(W, H) <= min(W, H)` degenerates to a ROUND hole of the slot tool
    // (§1.2) — the centreline vanishes, the tool does not.
  }
  return { centerMm, drillMm: tool, plated };
}

/** A free hole's drill, as every consumer must see it (contract 10 §1.1). */
export interface FreeHoleDrill {
  centerMm: PcbPointMm;
  /** Tool diameter — the slot WIDTH whenever a slot is declared. */
  drillMm: number;
  /** Present when the drill is a routed slot rather than a round hit. */
  slot?: DrillSlotCenterline;
}

/**
 * THE one derivation of a free hole's drill — DRC holes, the pour halo, the
 * Excellon writer, `collectDrills` and the snapshot all read it. The tool is
 * the slot width whenever a slot is declared (a degenerate slot is a round hit
 * of that width, never of the row's `drillMm` — Astra run 2b #1); the hydrator
 * makes the two equal for persisted rows (§1.2).
 */
export function freeHoleDrill(hole: PcbFreeHole): FreeHoleDrill | null {
  const slotWidth = hole.drillSlot?.widthMm;
  const drillMm =
    slotWidth !== undefined && slotWidth > 0 ? slotWidth : hole.drillMm;
  if (!(drillMm > 0)) return null;
  const slot = drillSlotCenterline(hole.centerMm, hole.drillSlot);
  return { centerMm: hole.centerMm, drillMm, ...(slot ? { slot } : {}) };
}

/**
 * Unified drill list across every drilled object on the board:
 * - Through vias (`via.drillMm`)
 * - Plated/unplated pad drills on every placed footprint
 * - Free-standing mechanical holes (F5 — mounting / tooling)
 *
 * Single source of truth consumed by:
 *  - `DrillLayer` (lime outline rings)
 *  - `BoardFill` (`ShapeGeometry.holes[]` cutouts in the substrate)
 *  - Future Gerber/Excellon export
 */
export function collectDrills(
  vias: ReadonlyArray<PcbVia>,
  placements: ReadonlyArray<PcbPlacedPart>,
  freeHoles: ReadonlyArray<PcbFreeHole> = [],
  freePads: ReadonlyArray<PcbFreePad> = [],
): DrillInstance[] {
  const out: DrillInstance[] = [];
  for (const via of vias) {
    if (via.drillMm > 0) {
      out.push({ centerMm: via.centerMm, radiusMm: via.drillMm / 2 });
    }
  }
  for (const placement of placements) {
    // The ONE footprint-drill derivation: slots, drill offsets and the pad's
    // composed world frame all come from it (contract 10 §1.1, §8).
    for (const pad of placementPads(placement)) {
      const drill = footprintPadDrill(pad, placement);
      if (!drill) continue;
      out.push({
        centerMm: drill.centerMm,
        radiusMm: drill.drillMm / 2,
        ...(drill.slot ? { slot: drill.slot } : {}),
      });
    }
  }
  for (const hole of freeHoles) {
    const drill = freeHoleDrill(hole);
    if (!drill) continue;
    out.push({
      centerMm: drill.centerMm,
      radiusMm: drill.drillMm / 2,
      ...(drill.slot ? { slot: drill.slot } : {}),
    });
  }
  for (const pad of freePads) {
    const drill = freePadDrill(pad);
    if (drill) {
      out.push({
        centerMm: pad.centerMm,
        radiusMm: drill.drillMm / 2,
        ...(drill.slot ? { slot: drill.slot } : {}),
      });
    }
  }
  return out;
}
