/**
 * Route-tool keepout guards (zone/keepout contract §13.4). Pure — the caller
 * resolves the via disc (centre, the diameter the preview draws, the span the
 * session would commit) and this module answers only "does a rule area forbid
 * it?", using the same `keepoutAffects` predicate batch DRC runs.
 */
import type { PcbCopperLayerId } from "../../../../../sdks";
import type { EffectiveKeepout } from "../../../../../shared/pcb-areas/copper-zones";
import { keepoutsAffecting } from "../../../../../shared/pcb-areas/keepout-predicates";

export interface RouteViaDisc {
  centerMm: { x: number; y: number };
  /** Copper (pad) diameter, not the drill — the barrel's copper is what the rule forbids. */
  diameterMm: number;
  /** Every copper layer the via spans; all of them when the span is unknown (fail-closed). */
  layers: ReadonlySet<PcbCopperLayerId>;
}

/**
 * The first effective keepout with `restrictions.vias` that the via disc
 * overlaps, or `null` when the via is legal. Input order decides which one is
 * reported; `collectKeepouts` already sorts by id, so the answer is stable.
 */
export function viaKeepoutBlock(
  keepouts: readonly EffectiveKeepout[],
  via: RouteViaDisc,
): EffectiveKeepout | null {
  const ids = keepoutsAffecting(keepouts, {
    kind: "via",
    layers: via.layers,
    centerMm: via.centerMm,
    diameterMm: via.diameterMm,
  });
  if (ids.length === 0) return null;
  return keepouts.find((k) => k.id === ids[0]) ?? null;
}
