/**
 * THE solder-mask artwork model (DFM contract 11 §1.3): every opening the fab
 * receives on either mask face, built once from the PCB projection. The Gerber
 * writer flashes this list in order and the DFM checks measure it, so a bridge
 * or sliver verdict is about the mask the board actually ships with.
 *
 * The rules are S11's (contract 10 §6.1 / §6.4), lifted out of the writer
 * unchanged — with one fix (06 §9, §1.3 below): a DRILLED `smd` / `conn` free
 * pad now relieves its FAR face, which previously kept solder mask stretched
 * over an open NPTH.
 */
import type {
  PcbCopperLayerId,
  PcbFreePad,
  PcbLayerCount,
  PcbPlacedPart,
  PcbPointMm,
  PcbVia,
  DrcAnchor,
} from "../../../../sdks/designer";
import { copperLayersForCount } from "../../../../sdks/designer/stackup";
import {
  freePadItemKey,
  padItemKey,
  padRecordKey,
  viaItemKey,
  type CopperRecords,
} from "../../../pcb-connectivity";
import type { PadCopperShape } from "../../../pcb-geometry/pad-annular";
import {
  freePadCopperShape,
  padCopperShape,
  placementPads,
} from "../../../pcb-geometry/pad-geometry";
import { freePadCopperLayers } from "../../pad-copper-layers";
import {
  footprintPadDrill,
  freePadDrill,
  type FootprintPadDrill,
} from "../pcb-drills";
import {
  apertureFromShape,
  inflateShape,
  type ApertureShape,
} from "./aperture-shape";

export type MaskFace = "top" | "bottom";

/** Both mask faces, in the order `buildMaskOpenings` emits them. */
const MASK_FACES: readonly MaskFace[] = ["top", "bottom"];

/** The typical 50 µm default when the board declares no expansion. */
const DEFAULT_MASK_EXPANSION_MM = 0.05;

export interface MaskOpening {
  face: MaskFace;
  centerMm: PcbPointMm;
  /** Already inflated by the applicable expansion — this IS the flash. */
  shape: ApertureShape;
  anchor: DrcAnchor;
  netId: string | null;
  /** The opening exposes COPPER (a pad or via), not a bare drilled void. */
  copper: boolean;
  /**
   * S1 item key of the copper this opening belongs to, or `null` for a
   * copper-less footprint drill relief. The solder-mask check reads it to
   * exempt an opening's OWN copper: an opening always overlaps the pad it
   * exposes, which is not a mask-to-copper violation.
   */
  ownerKey: string | null;
}

export interface MaskArtworkInput {
  /** Board-level expansion per side; a free pad may override it. */
  solderMaskExpansionMm: number | null | undefined;
  layerCount: PcbLayerCount;
  placements: readonly PcbPlacedPart[];
  freePads: readonly PcbFreePad[];
  vias: readonly PcbVia[];
  /** The S1 copper records — the ONE resolution of which layers carry copper. */
  records: CopperRecords;
  /**
   * Pad world frame + shape per record key. Records carry the geometry but not
   * the shape KIND (`circle` / `rect` / …) or the roundrect ratio, and the
   * aperture needs both.
   */
  padShapes: ReadonlyMap<string, PadCopperShape>;
  /**
   * Sink for data errors that cost an opening — a drill relief with no positive
   * size (§1.3). Never flashing beats flashing a degenerate aperture, but the
   * board owner has to be told.
   */
  warnings?: string[];
}

function faceLayer(face: MaskFace): PcbCopperLayerId {
  return face === "top" ? "F.Cu" : "B.Cu";
}

/**
 * The `padShapes` index this builder takes: every pad's world frame + shape,
 * keyed by the SAME item key `padRecordKey` assigns. Walks the pads in the
 * order and with the per-number occurrence counter `footprintPadRecords` uses,
 * so a record's key always resolves (a pad with no record is exactly a
 * copper-less unplated pad, whose drill relief this module derives itself).
 *
 * It lives here, beside the only consumer of the index, because the mask model
 * has two callers now — the Gerber writer and the DFM context — and they must
 * feed it the same map or the openings DRC judges are not the openings the fab
 * receives (DFM contract 11 §1).
 */
export function buildPadShapeIndex(
  placements: readonly PcbPlacedPart[],
  freePads: readonly PcbFreePad[],
): Map<string, PadCopperShape> {
  const padShapes = new Map<string, PadCopperShape>();
  for (const placement of placements) {
    const occurrenceByNumber = new Map<string, number>();
    for (const pad of placementPads(placement)) {
      const occurrence = occurrenceByNumber.get(pad.number) ?? 0;
      occurrenceByNumber.set(pad.number, occurrence + 1);
      padShapes.set(
        padItemKey(placement.id, pad.number, occurrence),
        padCopperShape(placement, pad),
      );
    }
  }
  for (const freePad of freePads) {
    padShapes.set(freePadItemKey(freePad.id), freePadCopperShape(freePad));
  }
  return padShapes;
}

/**
 * Openings for both faces, in the writer's emission order: footprint records,
 * copper-less unplated footprint drills, free pads (pad opening then drill
 * relief), untented vias — per face, so a file's flashes are the model's
 * openings for that face, 1:1 and in order (§1.4 / §1.5).
 */
export function buildMaskOpenings(input: MaskArtworkInput): MaskOpening[] {
  const expansionDefault =
    input.solderMaskExpansionMm ?? DEFAULT_MASK_EXPANSION_MM;
  const maskOnly = maskOnlyDrills(input.placements, input.records);
  const stackup = new Set(copperLayersForCount(input.layerCount));
  const recordByKey = new Map(
    input.records.pads.map((record) => [padRecordKey(record), record] as const),
  );
  const out: MaskOpening[] = [];

  /**
   * THE one drill-relief emission path. A relief that cannot be built is a data
   * error (a non-positive or non-finite drill), reported and skipped — the
   * alternative is a degenerate aperture in the file.
   */
  const pushRelief = (
    face: MaskFace,
    drill: FootprintPadDrill,
    expansionMm: number,
    anchor: DrcAnchor,
    netId: string | null,
    ownerKey: string | null,
  ): void => {
    const shape = drillReliefShape(drill, expansionMm);
    if (!shape) {
      input.warnings?.push(
        `Solder-mask relief for the drill at (${drill.centerMm.x}, ${drill.centerMm.y}) has no positive size (drill ${drill.drillMm} mm); no opening was flashed`,
      );
      return;
    }
    out.push({
      face,
      centerMm: drill.centerMm,
      shape,
      anchor,
      netId,
      copper: false,
      ownerKey,
    });
  };

  for (const face of MASK_FACES) {
    const layer = faceLayer(face);

    // Footprint pads: the opening follows the RECORD's copper (contract §6.1),
    // so a mirrored placement's explicit-layer SMD pad opens on the same face
    // its copper flashed on — reading `pad.layer` unflipped opened the wrong
    // side.
    for (const record of input.records.pads) {
      if (record.anchor.kind !== "pad") continue;
      if (!record.resolvedLayers.includes(layer)) continue;
      const shape = input.padShapes.get(padRecordKey(record));
      const base = shape ? apertureFromShape(shape, record.rotationDeg) : null;
      if (!base) continue;
      out.push({
        face,
        centerMm: record.center,
        shape: inflateShape(base, expansionDefault),
        anchor: record.anchor,
        netId: record.netId,
        copper: true,
        ownerKey: padRecordKey(record),
      });
    }

    // A copper-LESS unplated footprint pad has no record to inflate, but its
    // drill still wants relief on BOTH faces (§6.4) — the `hole` free-pad rule.
    for (const entry of maskOnly) {
      pushRelief(face, entry.drill, expansionDefault, entry.anchor, null, null);
    }

    // A mask opening follows the copper (the one derivation) — a `conn` / `smd`
    // pad opens the mask on its own layer only. The one exception is an NPTH
    // `hole` pad: it carries no copper (and therefore no record), but the drill
    // still wants its mask relief on BOTH faces (KiCad flashes an NPTH pad's
    // mask aperture the same way), so the mask edge is not torn by the drill.
    for (const pad of input.freePads) {
      const record = recordByKey.get(freePadItemKey(pad.id));
      const opens =
        pad.padType === "hole"
          ? true
          : (
              record?.resolvedLayers ?? freePadCopperLayers(pad, stackup).layers
            ).includes(layer);
      const expansion = pad.solderMaskExpansionMm ?? expansionDefault;
      const anchor: DrcAnchor = { kind: "freePad", freePadId: pad.id };
      const ownerKey = freePadItemKey(pad.id);
      if (!opens) {
        // §1.3 (06 §9). The pad shape is not flashed on this face, so nothing
        // here can cover the drill: relieve it UNCONDITIONALLY. `freePadDrill`
        // has no pad-type gate — the Excellon and the DRC hole set already
        // carry this drill — so the mask must not pretend the hole is absent.
        const drill = freePadDrill(pad);
        if (!drill) continue;
        pushRelief(
          face,
          freePadDrillAt(pad, drill),
          expansion,
          anchor,
          pad.netId,
          ownerKey,
        );
        continue;
      }
      const shape = input.padShapes.get(freePadItemKey(pad.id));
      if (!shape) continue;
      // A `hole` free pad owns no record (§2.3), so its own frame is the
      // aperture's — a free pad is never mirrored and never placed, which is
      // why the two rotations agree wherever both exist.
      const base = apertureFromShape(
        shape,
        record ? record.rotationDeg : shape.rotationDeg,
      );
      if (!base) continue;
      // THE flash. Everything below reasons about this, not about the declared
      // shape: a negative expansion SHRINKS it.
      const flashed = inflateShape(base, expansion);
      out.push({
        face,
        centerMm: pad.centerMm,
        shape: flashed,
        anchor,
        netId: pad.netId,
        copper: record !== undefined,
        ownerKey,
      });
      // A drilled free pad's opening must also cover its DRILL (§6.4): a slot,
      // or a drill the FLASH does not span, would otherwise leave mask over the
      // void for the router to tear. The declared pad shape above
      // stays — it IS the authored opening (§1.3, Astra 2b #3). This applies to
      // EVERY drilled free pad on a face where its shape is flashed, not only
      // to `hole`: a slotted `smd` paddle keeps mask over its own routed slot
      // otherwise, and the far face's unconditional relief above does not help
      // the face the pad is actually on.
      const uncovered = uncoveredFreePadDrill(pad, flashed);
      if (uncovered) {
        pushRelief(face, uncovered, expansion, anchor, pad.netId, ownerKey);
      }
    }

    // Vias on this side: only when not tented. v0 defaults to tented vias
    // (no mask opening). Skip unless explicitly untented.
    for (const via of input.vias) {
      if (via.protection !== "none") continue;
      if (!viaTouchesLayer(via, layer)) continue;
      out.push({
        face,
        centerMm: via.centerMm,
        shape: {
          kind: "circle",
          diameterMm: via.diameterMm + expansionDefault * 2,
        },
        anchor: { kind: "via", viaId: via.id },
        netId: via.netId,
        copper: true,
        ownerKey: viaItemKey(via.id),
      });
    }
  }
  return out;
}

/** A drilled footprint pad whose copper lies entirely inside the drill (§2.3). */
interface MaskOnlyDrill {
  drill: FootprintPadDrill;
  anchor: DrcAnchor;
}

/**
 * Copper-less unplated footprint drills: no copper record, but the mask still
 * opens on BOTH faces so the drill cannot tear the mask edge (§6.4). Walks the
 * pads in the SAME order `footprintPadRecords` does, so a pad with no record is
 * exactly a copper-less unplated pad.
 */
function maskOnlyDrills(
  placements: readonly PcbPlacedPart[],
  records: CopperRecords,
): MaskOnlyDrill[] {
  const recorded = new Set(records.pads.map((r) => padRecordKey(r)));
  const out: MaskOnlyDrill[] = [];
  for (const placement of placements) {
    const occurrenceByNumber = new Map<string, number>();
    for (const pad of placementPads(placement)) {
      const occurrence = occurrenceByNumber.get(pad.number) ?? 0;
      occurrenceByNumber.set(pad.number, occurrence + 1);
      if (recorded.has(padItemKey(placement.id, pad.number, occurrence))) {
        continue;
      }
      // No record ⇒ copper-less (§2.3). Its drill is still real.
      const drill = footprintPadDrill(pad, placement);
      if (!drill || drill.plated) continue;
      out.push({
        drill,
        anchor: {
          kind: "pad",
          placementId: placement.id,
          padNumber: pad.number,
        },
      });
    }
  }
  return out;
}

/** A free pad's drill in the `FootprintPadDrill` frame the relief builder takes. */
function freePadDrillAt(
  pad: PcbFreePad,
  drill: NonNullable<ReturnType<typeof freePadDrill>>,
): FootprintPadDrill {
  return {
    centerMm: pad.centerMm,
    drillMm: drill.drillMm,
    ...(drill.slot ? { slot: drill.slot } : {}),
    plated: false,
  };
}

/**
 * The drill of a free pad that its FLASHED opening does not already cover: a
 * routed slot always (the declared size is a single hit's), or a round drill
 * the flash does not span. `null` when the opening covers the drill — the
 * `covered` short-circuit §1.3 names, which is only sound on a face where that
 * opening is actually flashed.
 *
 * `flashed` is the aperture AFTER expansion, not the declared shape. A negative
 * `solderMaskExpansionMm` contracts the opening, so a 1 x 1 pad over a 0.8 drill
 * at −0.2 flashes 0.6 x 0.6 and the drill pokes out by 0.1 per axis — the
 * declared shape "covers" a drill the artwork does not (Astra run 2 #2). The
 * relief itself is unaffected: `drillReliefShape` floors the expansion at zero,
 * so it always contains the drill (Astra run 1 #12).
 *
 * No pad-TYPE gate: `freePadDrill` has none either (contract 10 §1.1), so a
 * drilled `smd` / `conn` / `std` pad is as capable of leaving mask over its own
 * void as a `hole` pad is.
 */
export function uncoveredFreePadDrill(
  pad: PcbFreePad,
  flashed: ApertureShape,
): FootprintPadDrill | null {
  const drill = freePadDrill(pad);
  if (!drill) return null;
  const covered =
    !drill.slot && drill.drillMm <= apertureMinSpanMm(flashed) + 1e-9;
  return covered ? null : freePadDrillAt(pad, drill);
}

/** The narrowest span of a flashed aperture — the round drill it can cover. */
function apertureMinSpanMm(shape: ApertureShape): number {
  return shape.kind === "circle"
    ? shape.diameterMm
    : Math.min(shape.widthMm, shape.heightMm);
}

/**
 * Mask relief of a drilled void (§6.4): the drilled hole plus the mask
 * expansion per side — a disc for a round hit, the routed stadium as an obround
 * rotated to the slot axis. It comes from the DRILLED object because there is
 * no copper record to inflate.
 *
 * **A relief always CONTAINS its drill** (§1.3, Astra run 1 #12): the expansion
 * is floored at zero, because a negative `solderMaskExpansionMm` is authored to
 * contract a copper PAD's opening and must never shrink the mask back over an
 * open void. `null` when the computed size is not positive — a data error the
 * caller reports rather than flashing a degenerate aperture.
 */
export function drillReliefShape(
  drill: FootprintPadDrill,
  expansionMm: number,
): ApertureShape | null {
  const across = drill.drillMm + 2 * Math.max(expansionMm, 0);
  if (!(across > 0)) return null;
  if (!drill.slot) return { kind: "circle", diameterMm: across };
  const dx = drill.slot.b.x - drill.slot.a.x;
  const dy = drill.slot.b.y - drill.slot.a.y;
  const along = Math.hypot(dx, dy) + across;
  if (!(along > 0) || !Number.isFinite(along)) return null;
  const angle = ((((Math.atan2(dy, dx) * 180) / Math.PI) % 360) + 360) % 360;
  if (angle % 90 === 0) {
    const swap = angle === 90 || angle === 270;
    return {
      kind: "obround",
      widthMm: swap ? across : along,
      heightMm: swap ? along : across,
    };
  }
  return {
    kind: "obround",
    widthMm: along,
    heightMm: across,
    rotationDeg: angle,
  };
}

// Stackup order used to determine which copper layers a via spans.
// Indices are increasing from top to bottom of the board.
const COPPER_LAYER_ORDER: ReadonlyArray<PcbCopperLayerId> = [
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
];

/**
 * Does a via's barrel reach `layer`? Through / blind / buried vias all span a
 * contiguous range [fromLayer, toLayer] in stackup order. Lives beside the mask
 * model because the mask asks it per FACE and the copper artwork asks it per
 * layer — one answer, or an untented via could open a face its annulus never
 * reached.
 */
export function viaTouchesLayer(
  via: PcbVia,
  layer: PcbCopperLayerId,
): boolean {
  const fromIdx = COPPER_LAYER_ORDER.indexOf(via.fromLayer);
  const toIdx = COPPER_LAYER_ORDER.indexOf(via.toLayer);
  const layerIdx = COPPER_LAYER_ORDER.indexOf(layer);
  if (fromIdx === -1 || toIdx === -1 || layerIdx === -1) {
    // Unknown layer ids — fall back to endpoint match so we never silently
    // drop the via's annulus.
    return layer === via.fromLayer || layer === via.toLayer;
  }
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  return layerIdx >= lo && layerIdx <= hi;
}
