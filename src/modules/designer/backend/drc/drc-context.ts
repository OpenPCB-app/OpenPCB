// Precomputed, mm-domain view of a PCB projection for the DRC engine.
//
// Resolves the data-model gotchas once, up front, so the individual checks stay
// simple: trace points are converted nm→mm; footprint/free pads become world
// polygons grouped by the copper layer(s) they occupy (through-hole spans both
// sides — fixes live-drc's "all pads on the active layer" approximation); vias
// become circles spanning their barrel layers; every primitive carries an AABB
// for the O(n²) broad-phase prefilter.

import type {
  DesignerPcbProjection,
  DrcAnchor,
  PcbCopperLayerId,
  PcbDesignRules,
  PcbFabricatorId,
  PcbNetClass,
  PcbPointMm,
  PcbVia,
  RatsnestSegment,
} from "../../../../sdks/designer";
import { resolveNetClassId } from "../pcb/net-class-resolver";
import { flattenCutout, flattenOutline } from "../pcb/outline-geometry";
import {
  freePadOutlineWorldMm,
  padOutlineWorldMm,
  ringBounds,
  type RingBounds,
} from "../pcb/pad-outline";
import { padWorldPositionMm, placementPads } from "../pcb/pad-geometry";
import type { Point } from "../pcb/pcb-trace-geometry";

/** Default minimums when a (pre-DRC) board lacks the optional rule field. */
export const DEFAULT_HOLE_TO_HOLE_MM = 0.25;
export const DEFAULT_BOARD_THICKNESS_MM = 1.6;

const NM_TO_MM = 1 / 1_000_000;
const STACKUP_ORDER: PcbCopperLayerId[] = ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"];

/**
 * Geometric tolerance (mm) for minimum-rule comparisons. Floating-point sums
 * like `(0.3 - 0.1) / 2` land at `0.09999999999999999`, which would falsely
 * fail a `< 0.1` minimum. Treat `value < limit - DRC_EPS_MM` as the breach so
 * exact-spec geometry passes. 1e-6 mm = 1 nm — far below any real DRC value.
 */
export const DRC_EPS_MM = 1e-6;

/** True when `value` is below `limit` by more than the geometric tolerance. */
export function below(value: number, limit: number, eps = DRC_EPS_MM): boolean {
  return value < limit - eps;
}

export interface DrcTrace {
  id: string;
  netId: string | null;
  netClassId: string;
  layer: PcbCopperLayerId;
  widthMm: number;
  halfWidthMm: number;
  pointsMm: Point[];
  bounds: RingBounds;
  mid: PcbPointMm;
}

export interface DrcPad {
  anchor: DrcAnchor;
  netId: string | null;
  layers: PcbCopperLayerId[];
  ring: PcbPointMm[];
  bounds: RingBounds;
  center: PcbPointMm;
}

export interface DrcViaGeom {
  via: PcbVia;
  netId: string | null;
  netClassId: string;
  center: PcbPointMm;
  radiusMm: number;
  layers: PcbCopperLayerId[];
  bounds: RingBounds;
}

/** Any drilled hole (via barrel / TH pad / std-or-NPTH free pad / free hole). */
export interface DrcHole {
  anchor: DrcAnchor;
  /** Net the hole's copper belongs to (null for mechanical / NPTH holes). */
  netId: string | null;
  center: PcbPointMm;
  drillMm: number;
  /**
   * Copper pad outer diameter (mm) for the annular-ring check. Set for plated
   * pads with a defined copper extent (TH footprint pads, free `std` pads);
   * undefined for vias (checked via `DrcViaGeom`) and bare mechanical holes.
   */
  padOdMm?: number;
}

export interface DrcContext {
  projection: DesignerPcbProjection;
  designRules: PcbDesignRules;
  netClasses: PcbNetClass[];
  fabricator: PcbFabricatorId;
  validCopperLayers: Set<PcbCopperLayerId>;
  traces: DrcTrace[];
  pads: DrcPad[];
  vias: DrcViaGeom[];
  /** Every drilled hole on the board, for hole-to-hole spacing. */
  holes: DrcHole[];
  /** Finished board thickness (mm); for via aspect-ratio. */
  boardThicknessMm: number;
  /** Minimum edge-to-edge hole spacing (mm). */
  holeToHoleMm: number;
  /** Flattened board outline ring (mm) + internal cutout rings. */
  outlineRing: Point[];
  cutoutRings: Point[][];
  ratsnest: RatsnestSegment[];
  netNames: Record<string, string>;
  /**
   * Clearance contribution of an item's net class (mm), or 0 when the net /
   * class is unknown. Net class can only *tighten* clearance; the board design
   * rule is the floor (see `requiredClearanceMm` in checks/clearance.ts).
   */
  netClassClearanceMm(netId: string | null, netClassId?: string): number;
}

function copperLayerOf(layer: string): PcbCopperLayerId | null {
  return (STACKUP_ORDER as string[]).includes(layer)
    ? (layer as PcbCopperLayerId)
    : null;
}

function boundsOfPoints(points: readonly Point[], pad = 0): RingBounds {
  const b = ringBounds(points);
  return {
    minX: b.minX - pad,
    minY: b.minY - pad,
    maxX: b.maxX + pad,
    maxY: b.maxY + pad,
  };
}

function viaLayers(
  via: PcbVia,
  valid: Set<PcbCopperLayerId>,
): PcbCopperLayerId[] {
  const fromIdx = STACKUP_ORDER.indexOf(via.fromLayer);
  const toIdx = STACKUP_ORDER.indexOf(via.toLayer);
  if (fromIdx < 0 || toIdx < 0) return [];
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  const out: PcbCopperLayerId[] = [];
  for (let i = lo; i <= hi; i += 1) {
    const layer = STACKUP_ORDER[i]!;
    if (valid.has(layer)) out.push(layer);
  }
  return out;
}

export function buildDrcContext(projection: DesignerPcbProjection): DrcContext {
  const { board } = projection;
  const validCopperLayers = new Set<PcbCopperLayerId>(
    board.layerCount === 4
      ? ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]
      : ["F.Cu", "B.Cu"],
  );

  const classById = new Map(board.netClasses.map((c) => [c.id, c]));
  // Memoize net → clearance resolution: the O(n²) clearance loops query the
  // same net's class repeatedly, and resolveNetClassId re-scans every net class
  // per call. Cache the resolved clearance once per net id.
  const clearanceByNetId = new Map<string, number>();

  const traces: DrcTrace[] = projection.traces.map((t) => {
    const pointsMm = t.pointsNm.map((p) => ({
      x: p.x * NM_TO_MM,
      y: p.y * NM_TO_MM,
    }));
    const half = t.widthMm / 2;
    const raw = ringBounds(pointsMm);
    return {
      id: t.id,
      netId: t.netId,
      netClassId: t.netClassId,
      layer: t.layer,
      widthMm: t.widthMm,
      halfWidthMm: half,
      pointsMm,
      bounds: boundsOfPoints(pointsMm, half),
      mid: { x: (raw.minX + raw.maxX) / 2, y: (raw.minY + raw.maxY) / 2 },
    };
  });

  const pads: DrcPad[] = [];
  const holes: DrcHole[] = [];
  const padNets = projection.padNets ?? {};
  for (const placement of projection.placements) {
    const placementCopper = copperLayerOf(placement.layer) ?? "F.Cu";
    for (const pad of placementPads(placement)) {
      const drill = pad.drillDiameterMm ?? 0;
      const isThroughHole = drill > 0;
      const layers: PcbCopperLayerId[] = isThroughHole
        ? [...validCopperLayers]
        : [copperLayerOf(pad.layer ?? placement.layer) ?? placementCopper];
      const ring = padOutlineWorldMm(placement, pad);
      const center = padWorldPositionMm(placement, pad);
      const anchor: DrcAnchor = {
        kind: "pad",
        placementId: placement.id,
        padNumber: pad.number,
      };
      const padNetId = padNets[`${placement.id}|${pad.number}`] ?? null;
      pads.push({
        anchor,
        netId: padNetId,
        layers,
        ring,
        bounds: ringBounds(ring),
        center,
      });
      if (isThroughHole) {
        holes.push({
          anchor,
          netId: padNetId,
          center,
          drillMm: drill,
          padOdMm: Math.min(pad.widthMm, pad.heightMm),
        });
      }
    }
  }
  for (const freePad of projection.freePads) {
    const drill = freePad.drillMm ?? 0;
    if (
      drill > 0 &&
      (freePad.padType === "std" || freePad.padType === "hole")
    ) {
      const isStd = freePad.padType === "std";
      holes.push({
        anchor: { kind: "freePad", freePadId: freePad.id },
        netId: isStd ? freePad.netId : null,
        center: freePad.centerMm,
        drillMm: drill,
        ...(isStd
          ? { padOdMm: Math.min(freePad.widthMm, freePad.heightMm) }
          : {}),
      });
    }
    if (freePad.padType === "hole") continue; // NPTH: counted above, no copper
    const layers: PcbCopperLayerId[] =
      freePad.padType === "std"
        ? [...validCopperLayers]
        : [copperLayerOf(freePad.layer) ?? "F.Cu"];
    const ring = freePadOutlineWorldMm(freePad);
    pads.push({
      anchor: { kind: "freePad", freePadId: freePad.id },
      netId: freePad.netId,
      layers,
      ring,
      bounds: ringBounds(ring),
      center: freePad.centerMm,
    });
  }
  for (const hole of projection.freeHoles) {
    holes.push({
      anchor: { kind: "freeHole", freeHoleId: hole.id },
      netId: null,
      center: hole.centerMm,
      drillMm: hole.drillMm,
    });
  }

  const vias: DrcViaGeom[] = projection.vias.map((via) => {
    const radius = via.diameterMm / 2;
    return {
      via,
      netId: via.netId,
      netClassId: via.netClassId,
      center: via.centerMm,
      radiusMm: radius,
      layers: viaLayers(via, validCopperLayers),
      bounds: {
        minX: via.centerMm.x - radius,
        minY: via.centerMm.y - radius,
        maxX: via.centerMm.x + radius,
        maxY: via.centerMm.y + radius,
      },
    };
  });

  for (const vg of vias) {
    holes.push({
      anchor: { kind: "via", viaId: vg.via.id },
      netId: vg.netId,
      center: vg.center,
      drillMm: vg.via.drillMm,
    });
  }

  const netNames = projection.netNames ?? {};
  const cutouts = board.cutouts ?? [];

  return {
    projection,
    designRules: board.designRules,
    netClasses: board.netClasses,
    fabricator: board.fabricator,
    validCopperLayers,
    traces,
    pads,
    vias,
    holes,
    boardThicknessMm: board.boardThicknessMm ?? DEFAULT_BOARD_THICKNESS_MM,
    holeToHoleMm:
      board.designRules.minimums.holeToHoleMm ?? DEFAULT_HOLE_TO_HOLE_MM,
    outlineRing: flattenOutline(board.outline),
    cutoutRings: cutouts.map((c) => flattenCutout(c.shape)),
    ratsnest: projection.ratsnest,
    netNames,
    netClassClearanceMm(netId, netClassId) {
      if (netClassId) {
        const c = classById.get(netClassId);
        if (c) return c.clearanceMm;
      }
      if (netId) {
        const cached = clearanceByNetId.get(netId);
        if (cached !== undefined) return cached;
        const name = netNames[netId] ?? "";
        const id = resolveNetClassId(
          name,
          board.netClasses,
          board.perNetClassAssignments,
          netId,
        );
        const c = classById.get(id);
        const value = c ? c.clearanceMm : 0;
        clearanceByNetId.set(netId, value);
        return value;
      }
      return 0;
    },
  };
}

/** AABB-to-AABB minimum gap (0 if overlapping). Broad-phase prefilter. */
export function aabbGap(a: RingBounds, b: RingBounds): number {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
  return Math.sqrt(dx * dx + dy * dy);
}

export function layersOverlap(
  a: readonly PcbCopperLayerId[],
  b: readonly PcbCopperLayerId[],
): boolean {
  for (const layer of a) if (b.includes(layer)) return true;
  return false;
}
