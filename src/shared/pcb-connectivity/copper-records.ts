// Geometry records for every piece of copper on a board, in the mm domain.
//
// This is the ONE place pad / via / trace copper geometry is resolved from a
// PCB projection. Both consumers build on it: connectivity maps records to
// fail-safe items (`copper-items.ts`), DRC maps the same records to its
// clamp-policy primitives. Records carry the *resolved* layer set plus the
// invalidity flags; the layer policy is applied by the consumer, never here.

import type {
  PcbCopperLayerId,
  PcbFreePad,
  PcbLayerCount,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../sdks/designer";
import { copperLayersForCount, isCopperLayerId, viaSpanLayers } from "../../sdks/designer";
import {
  freePadCopperLayers,
  resolvePadCopperLayers,
} from "../rendering/pad-copper-layers";
import {
  footprintPadDrill,
  freePadDrill,
  padDrillFields,
} from "../rendering/pcb/pcb-drills";
import { copperInsideDrill } from "../pcb-geometry/pad-annular";
import {
  padCopperShape,
  padWorldPositionMm,
  placementMirrorX,
  placementPads,
} from "../pcb-geometry/pad-geometry";
import {
  freePadOutlineWorldMm,
  padOutlineWorldMm,
  ringBounds,
  type RingBounds,
} from "../pcb-geometry/pad-outline";

const NM_TO_MM = 1 / 1_000_000;

export type CopperPadAnchor =
  | { kind: "pad"; placementId: string; padNumber: string }
  | { kind: "freePad"; freePadId: string };

export interface PadCopperRecord {
  anchor: CopperPadAnchor;
  /**
   * Index of this copper shape among the placement's pads carrying the same
   * `padNumber` (preview order). One pin can own several shapes; the anchor
   * stays logical, the item key disambiguates. Always 0 for a free pad.
   */
  occurrence: number;
  netId: string | null;
  /** Layers the pad's copper resolves to, before any layer policy. */
  resolvedLayers: PcbCopperLayerId[];
  /** The pad named an explicit copper layer that is off this stackup. */
  declaredLayerInvalid: boolean;
  ring: PcbPointMm[];
  /**
   * World rotation of the pad's own frame (deg, CCW). A mirrored placement
   * conjugates the pad rotation — `padOutlineWorldMm` mirrors X and THEN
   * rotates, and `M·R(θ) = R(−θ)·M` — so the composition is
   * `placement ± pad`, not `−(placement + pad)`. Consumers that place
   * geometry ON the pad's axes (thermal spokes, copper-pour contract §6) read
   * this instead of recomposing the transform.
   */
  rotationDeg: number;
  /** The placement is on the bottom side: the pad's local frame is reflected. */
  mirrored: boolean;
  /**
   * Exact disc for a circular pad. `padOutlineWorldMm` CIRCUMSCRIBES arcs (it
   * inflates by sec(π/48) so DRC over-reports rather than missing a short),
   * which for connectivity would fuse two circular pads across a real 1 µm
   * gap. Connectivity uses this disc whenever it is present and falls back to
   * the ring otherwise. Only true circles qualify — an ellipse (w ≠ h), oval or
   * roundrect keeps the circumscribed polygon, a residual bias of ~0.2 % of the
   * arc radius recorded for S2.
   */
  disc?: { center: PcbPointMm; radiusMm: number };
  /**
   * False when `ring` is only a bounding-rectangle SUPERSET of the copper
   * (`custom` / `trapezoid` — the render source carries no true outline). A
   * consumer that would turn "these overlap" into a hard verdict (the DRC short
   * tier) must not trust such a ring; the circumscribed arcs of ovals /
   * roundrects (≤ 0.2 %·r) still count as exact.
   */
  exactShape: boolean;
  bounds: RingBounds;
  center: PcbPointMm;
  widthMm: number;
  heightMm: number;
  /** Drill diameter (mm); 0 = no drill. */
  drillMm: number;
  /**
   * The drill wall is plated (manufacturability contract 10 §2). An UNPLATED
   * pad's copper is mechanical: it keeps whatever net `padNets` binds — so DRC
   * clearance and the pour still see it as that net's copper — but the
   * connectivity kernel gives it one NULL-net item per copper layer, because
   * two rings of one unplated hole are never one node (§2.4).
   */
  plated: boolean;
}

export interface ViaCopperRecord {
  via: PcbVia;
  netId: string | null;
  center: PcbPointMm;
  radiusMm: number;
  span: PcbCopperLayerId[];
  /** The declared span resolves to fewer than two valid copper layers. */
  layerSpanInvalid: boolean;
  bounds: RingBounds;
}

export interface TraceCopperRecord {
  id: string;
  netId: string | null;
  layer: PcbCopperLayerId;
  widthMm: number;
  halfWidthMm: number;
  pointsMm: PcbPointMm[];
  bounds: RingBounds;
  mid: PcbPointMm;
}

export interface CopperRecordsInput {
  layerCount: PcbLayerCount;
  placements: ReadonlyArray<PcbPlacedPart>;
  /** `${placementId}|${padNumber}` → netId (schematic correlation). */
  padNetIds: ReadonlyMap<string, string>;
  freePads: ReadonlyArray<PcbFreePad>;
  traces: ReadonlyArray<PcbTrace>;
  vias: ReadonlyArray<PcbVia>;
}

export interface CopperRecords {
  validCopperLayers: ReadonlySet<PcbCopperLayerId>;
  pads: PadCopperRecord[];
  vias: ViaCopperRecord[];
  traces: TraceCopperRecord[];
}

function inflate(bounds: RingBounds, pad: number): RingBounds {
  return {
    minX: bounds.minX - pad,
    minY: bounds.minY - pad,
    maxX: bounds.maxX + pad,
    maxY: bounds.maxY + pad,
  };
}

/**
 * Exact disc for a circle; nothing for any other shape (see `disc`). A `circle`
 * pad is a disc of `widthMm` whatever `heightMm` says — the ONE interpretation
 * (contract 10 §7). It used to require `widthMm === heightMm`, which left an
 * unequal circle judged as an ellipse RING by DRC while the Gerber flashed
 * `widthMm` (B6-1's second half).
 */
function discOf(
  shape: string,
  widthMm: number,
  center: PcbPointMm,
): { disc?: { center: PcbPointMm; radiusMm: number } } {
  if (shape !== "circle" || !(widthMm > 0)) return {};
  return { disc: { center, radiusMm: widthMm / 2 } };
}

function footprintPadRecords(
  input: CopperRecordsInput,
  valid: ReadonlySet<PcbCopperLayerId>,
): PadCopperRecord[] {
  const out: PadCopperRecord[] = [];
  for (const placement of input.placements) {
    const occurrenceByNumber = new Map<string, number>();
    for (const pad of placementPads(placement)) {
      const occurrence = occurrenceByNumber.get(pad.number) ?? 0;
      occurrenceByNumber.set(pad.number, occurrence + 1);
      const drill = pad.drillDiameterMm ?? 0;
      const { plated } = padDrillFields(pad);
      // A copper-LESS non-plated pad (contract 10 §2.3): its copper shape lies
      // entirely inside the drilled void, so there is no copper to record — no
      // flash, no net, no ratsnest endpoint. The HOLE still exists; it is
      // derived from the drilled object, never from this record (§1.3).
      if (!plated) {
        const holeDrill = footprintPadDrill(pad, placement);
        if (
          holeDrill &&
          copperInsideDrill(padCopperShape(placement, pad), {
            centerMm: holeDrill.centerMm,
            radiusMm: holeDrill.drillMm / 2,
            ...(holeDrill.slot
              ? { slot: { a: holeDrill.slot.a, b: holeDrill.slot.b } }
              : {}),
          })
        ) {
          continue;
        }
      }
      const resolved = resolvePadCopperLayers(pad, placement, valid);
      const declaredLayerInvalid =
        drill <= 0 &&
        pad.layer !== undefined &&
        pad.layer !== "*.Cu" &&
        isCopperLayerId(pad.layer) &&
        !valid.has(pad.layer);
      const ring = padOutlineWorldMm(placement, pad);
      const center = padWorldPositionMm(placement, pad);
      out.push({
        anchor: {
          kind: "pad",
          placementId: placement.id,
          padNumber: pad.number,
        },
        occurrence,
        netId: input.padNetIds.get(`${placement.id}|${pad.number}`) ?? null,
        resolvedLayers: [...resolved],
        declaredLayerInvalid,
        ring,
        rotationDeg: placementMirrorX(placement)
          ? placement.rotationDeg - pad.rotationDeg
          : placement.rotationDeg + pad.rotationDeg,
        mirrored: placementMirrorX(placement),
        ...discOf(pad.shape, pad.widthMm, center),
        exactShape: pad.shape !== "custom" && pad.shape !== "trapezoid",
        bounds: ringBounds(ring),
        center,
        widthMm: pad.widthMm,
        heightMm: pad.heightMm,
        drillMm: drill,
        plated,
      });
    }
  }
  return out;
}

function freePadRecords(
  input: CopperRecordsInput,
  valid: ReadonlySet<PcbCopperLayerId>,
): PadCopperRecord[] {
  const out: PadCopperRecord[] = [];
  for (const freePad of input.freePads) {
    // The ONE free-pad layer model (`freePadCopperLayers`): a `hole` resolves to
    // no layers at all, which is exactly the "NPTH: no copper, no record" skip.
    const { layers: resolvedLayers, declaredLayerInvalid } = freePadCopperLayers(
      freePad,
      valid,
    );
    if (resolvedLayers.length === 0) continue;
    const ring = freePadOutlineWorldMm(freePad);
    // The ONE free-pad drill derivation (`freePadDrill`): a non-positive or
    // absent drill is no drill, whatever the pad type declares.
    const drill = freePadDrill(freePad);
    out.push({
      anchor: { kind: "freePad", freePadId: freePad.id },
      occurrence: 0,
      netId: freePad.netId,
      resolvedLayers,
      declaredLayerInvalid,
      ring,
      // Free pads carry no placement transform — the ring is already world.
      rotationDeg: freePad.rotationDeg,
      mirrored: false,
      ...discOf(freePad.shape, freePad.widthMm, freePad.centerMm),
      // Free pads have no `custom` / `trapezoid` shape (SDK `PcbFreePadShape`).
      exactShape: true,
      bounds: ringBounds(ring),
      center: freePad.centerMm,
      widthMm: freePad.widthMm,
      heightMm: freePad.heightMm,
      drillMm: drill?.drillMm ?? 0,
      // A free pad has no unplated-WITH-copper case except an `smd` / `conn`
      // pad that persists a drill: that hit reaches the fab non-plated
      // (contract 06 §2), so its copper is mechanical too. An undrilled pad —
      // and a `hole`, which never gets here — is plated by definition.
      plated: !(drill && !drill.plated),
    });
  }
  return out;
}

/**
 * Resolve a projection's copper into geometry records. Output order is input
 * order (placements × preview pads, then free pads; traces; vias) — consumers
 * rely on it for byte-identical results across runs.
 */
export function buildCopperRecords(input: CopperRecordsInput): CopperRecords {
  const validCopperLayers = new Set<PcbCopperLayerId>(
    copperLayersForCount(input.layerCount),
  );

  const traces: TraceCopperRecord[] = input.traces.map((t) => {
    const pointsMm = t.pointsNm.map((p) => ({
      x: p.x * NM_TO_MM,
      y: p.y * NM_TO_MM,
    }));
    const half = t.widthMm / 2;
    const raw = ringBounds(pointsMm);
    return {
      id: t.id,
      netId: t.netId,
      layer: t.layer,
      widthMm: t.widthMm,
      halfWidthMm: half,
      pointsMm,
      bounds: inflate(raw, half),
      mid: { x: (raw.minX + raw.maxX) / 2, y: (raw.minY + raw.maxY) / 2 },
    };
  });

  const vias: ViaCopperRecord[] = input.vias.map((via) => {
    const radiusMm = via.diameterMm / 2;
    const span = viaSpanLayers(via.fromLayer, via.toLayer, input.layerCount);
    return {
      via,
      netId: via.netId,
      center: via.centerMm,
      radiusMm,
      span,
      layerSpanInvalid: span.length < 2,
      bounds: {
        minX: via.centerMm.x - radiusMm,
        minY: via.centerMm.y - radiusMm,
        maxX: via.centerMm.x + radiusMm,
        maxY: via.centerMm.y + radiusMm,
      },
    };
  });

  return {
    validCopperLayers,
    pads: [
      ...footprintPadRecords(input, validCopperLayers),
      ...freePadRecords(input, validCopperLayers),
    ],
    vias,
    traces,
  };
}
