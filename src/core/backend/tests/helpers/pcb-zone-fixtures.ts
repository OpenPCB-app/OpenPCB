/**
 * Board zone, polygon zone and keepout row fixtures. The per-layer copper fill
 * is a persisted zone row since S3b (zone/keepout contract §12.1), so every
 * test that used to set `viewState.copperFill*` pushes one of these into
 * `projection.zones` instead.
 */
import type {
  PcbCopperLayerId,
  PcbKeepout,
  PcbKeepoutRestrictions,
  PcbPointMm,
  PcbZone,
} from "../../../../sdks/designer";
import { boardZoneId } from "../../../../shared/pcb-areas/copper-zones";

export function boardZoneRow(
  layer: PcbCopperLayerId,
  netId: string | null,
  overrides: Partial<PcbZone> = {},
): PcbZone {
  return {
    id: boardZoneId(layer),
    name: null,
    enabled: true,
    lockedAt: null,
    layer,
    netId,
    netName: null,
    region: { kind: "board" },
    priority: 0,
    padConnection: "solid",
    ...overrides,
  };
}

/** An explicit polygon zone row (the shape the zone tool persists). */
export function polygonZoneRow(
  id: string,
  layer: PcbCopperLayerId,
  netId: string | null,
  pointsMm: PcbPointMm[],
  overrides: Partial<PcbZone> = {},
): PcbZone {
  return {
    id,
    name: null,
    enabled: true,
    lockedAt: null,
    layer,
    netId,
    netName: null,
    region: { kind: "polygon", pointsMm },
    priority: 0,
    padConnection: "solid",
    ...overrides,
  };
}

/** A keepout row. Restrictions default to ALL forbidden — the fail-closed shape. */
export function keepoutRow(
  id: string,
  layers: PcbCopperLayerId[],
  pointsMm: PcbPointMm[],
  restrictions: Partial<PcbKeepoutRestrictions> = {},
  overrides: Partial<PcbKeepout> = {},
): PcbKeepout {
  return {
    id,
    name: null,
    enabled: true,
    lockedAt: null,
    layers,
    pointsMm,
    restrictions: {
      tracks: true,
      vias: true,
      pads: true,
      copperPour: true,
      footprints: true,
      ...restrictions,
    },
    ...overrides,
  };
}
