/**
 * Pure helpers for closing a zone / keepout sketch into a command payload
 * (contract §12.2 / §12.3). `checkAreaRing` is a thin mapper over the same
 * `zoneRingValidity` the executor runs — the tool never carries its own ring
 * rule. `buildZoneAdd` / `buildKeepoutAdd` shape the sketch into the
 * `pcb_add_zone` / `pcb_add_keepout` command fields; the command executor
 * (owned by another agent) does the actual validation and persistence.
 */
import type { PcbPointMm, PcbZonePadConnection } from "../../../../../sdks";
import {
  zoneRegionValidity,
  zoneRingValidity,
  type ZoneRegionValidity,
  type ZoneRingValidity,
} from "../../../../../shared/pcb-areas/zone-parse";
import type { AreaNetRef, KeepoutToolOptions, ZoneToolOptions } from "./area-tool-options";

export type AreaRingCheck =
  | { ok: true }
  | { ok: false; reason: ZoneRegionValidity; message: string };

const RING_MESSAGES: Record<Exclude<ZoneRegionValidity, "ok">, string> = {
  tooFewPoints: "Draw at least three vertices",
  selfIntersecting: "Outline crosses itself",
  zeroArea: "Outline has no area",
  nonFinite: "Outline has an invalid vertex",
  hole_ring_invalid: "Cutout outline is not a usable ring",
  hole_outside_outer: "Cutout must lie inside the zone",
  hole_touches_outer: "Cutout touches the zone outline",
  holes_overlap: "Cutouts overlap",
  holes_nested: "Cutout is inside another cutout",
};

function checkFailure(reason: Exclude<ZoneRegionValidity, "ok">): AreaRingCheck {
  return { ok: false, reason, message: RING_MESSAGES[reason] };
}

export function checkAreaRing(points: readonly PcbPointMm[]): AreaRingCheck {
  const reason: ZoneRingValidity = zoneRingValidity(points);
  return reason === "ok" ? { ok: true } : checkFailure(reason);
}

/**
 * Pre-check one new cutout against the zone it is being cut from — the SAME
 * `zoneRegionValidity` the executor runs (copper-pour contract §11), so a
 * rejected cutout keeps the sketch open instead of round-tripping for the
 * identical verdict.
 */
export function checkZoneHole(
  outerMm: readonly PcbPointMm[],
  existingHolesMm: readonly (readonly PcbPointMm[])[],
  ringMm: readonly PcbPointMm[],
): AreaRingCheck {
  const reason = zoneRegionValidity({
    kind: "polygon",
    pointsMm: [...outerMm],
    holesMm: [...existingHolesMm.map((h) => [...h]), [...ringMm]],
  });
  return reason === "ok" ? { ok: true } : checkFailure(reason);
}

export interface ZoneAddInput {
  layer: ZoneToolOptions["layer"];
  net: AreaNetRef;
  region: { kind: "polygon"; pointsMm: PcbPointMm[] };
  padConnection: PcbZonePadConnection;
  priority: 0;
  enabled: true;
}

export function buildZoneAdd(
  points: readonly PcbPointMm[],
  options: ZoneToolOptions,
): ZoneAddInput {
  return {
    layer: options.layer,
    net: options.net,
    region: {
      kind: "polygon",
      pointsMm: points.map((p) => ({ x: p.x, y: p.y })),
    },
    padConnection: options.padConnection,
    priority: 0,
    enabled: true,
  };
}

export interface KeepoutAddInput {
  layers: KeepoutToolOptions["layers"];
  pointsMm: PcbPointMm[];
  restrictions: KeepoutToolOptions["restrictions"];
  enabled: true;
}

export function buildKeepoutAdd(
  points: readonly PcbPointMm[],
  options: KeepoutToolOptions,
): KeepoutAddInput {
  return {
    layers: [...options.layers],
    pointsMm: points.map((p) => ({ x: p.x, y: p.y })),
    restrictions: { ...options.restrictions },
    enabled: true,
  };
}
