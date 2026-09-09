import { pourItemKey } from "../../../../../shared/pcb-connectivity";
import type { EffectiveCopperZone } from "../../../../../shared/pcb-areas";
import type { CopperFillIsland } from "../../../../../shared/rendering/copper-fill/copper-fill-geometry";
import type { PcbPointMm } from "../../../../../sdks/designer";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";
import { zoneDisplayName } from "../zone-label";

const ORIGIN: PcbPointMm = { x: 0, y: 0 };

/** Where a zone's own violations are marked: its first vertex, else the board. */
function zoneLocation(ctx: DrcContext, zone: EffectiveCopperZone): PcbPointMm {
  if (zone.region.kind === "polygon") {
    return zone.region.pointsMm[0] ?? ctx.outlineRing[0] ?? ORIGIN;
  }
  return ctx.outlineRing[0] ?? ORIGIN;
}

/**
 * Copper-pour DRC (copper-pour contract §10): the pours are filled ONCE per run
 * by `ctx.pourResults()`, so the islands judged here are exactly the islands
 * connectivity, the Gerber and the snapshot ship. Three verdicts:
 *
 *  - `ZONE_FILL_FAILED` — the kernel bailed (§8). The zone ships no copper for
 *    a reason that is not its geometry, so this is an error and never waivable.
 *  - `ZONE_EMPTY_FILL` — `ok` with zero islands: a legitimate "this zone pours
 *    nothing" (off-board, swallowed by clearance, eroded by min width).
 *  - `ISOLATED_COPPER_ISLAND` — a kept island whose S1 COMPONENT contains no
 *    pad (audit B3-10). The kernel's `attached` flag is the island-REMOVAL
 *    criterion — it says the island touches same-net bare copper, which a
 *    floating trace stub satisfies. Electrical deadness is a question about the
 *    component, and only `ctx.connectivity()` can answer it.
 *
 * Net-less zones (§3.2) pour manufactured copper that joins no net graph: they
 * can be empty or failed, never isolated.
 */
export function checkCopperPour(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  // Net-bound zones in derivation order — the same list `ensureConnectivity`
  // builds its pour nodes from, so `pourIndex` below is the connectivity one.
  let pourIndex = -1;
  for (const { zone, result } of ctx.pourResults()) {
    if (zone.netId !== null) pourIndex += 1;
    if (result.status === "failed") {
      out.push({
        code: "ZONE_FILL_FAILED",
        message: `Zone "${zoneDisplayName(ctx, zone)}" on ${zone.layer} could not be filled (${result.reason}) — it ships no copper`,
        anchors: [{ kind: "zone", zoneId: zone.id }],
        locationMm: zoneLocation(ctx, zone),
        layer: zone.layer,
      });
      continue;
    }
    if (result.islands.length === 0) {
      out.push({
        code: "ZONE_EMPTY_FILL",
        message: `Zone "${zoneDisplayName(ctx, zone)}" on ${zone.layer} pours no copper`,
        anchors: [{ kind: "zone", zoneId: zone.id }],
        locationMm: zoneLocation(ctx, zone),
        layer: zone.layer,
      });
      continue;
    }
    const netId = zone.netId;
    if (netId === null) continue;
    const dead = deadIslands(ctx, zone, netId, pourIndex, result.islands);
    if (dead.length === 0) continue;
    out.push(deadCopperDraft(ctx, zone, netId, dead));
  }
  return out;
}

/**
 * The islands of this pour whose component reaches no pad. An island absent
 * from `componentOf` is dead too: the map holds every net-bound item, so a
 * missing key means the island produced no connectivity node at all — copper
 * that is manufactured and connected to nothing.
 */
function deadIslands(
  ctx: DrcContext,
  zone: EffectiveCopperZone,
  netId: string,
  pourIndex: number,
  islands: readonly CopperFillIsland[],
): CopperFillIsland[] {
  const { components, componentOf } = ctx.connectivity();
  const dead: CopperFillIsland[] = [];
  islands.forEach((island, index) => {
    const key = pourItemKey(zone.layer, netId, pourIndex, index);
    const componentId = componentOf.get(key);
    if (componentId === undefined) {
      dead.push(island);
      return;
    }
    const itemKeys = components[componentId]?.itemKeys ?? [];
    const reachesPad = itemKeys.some(
      (k) => k.startsWith("pad:") || k.startsWith("freepad:"),
    );
    if (!reachesPad) dead.push(island);
  });
  return dead;
}

/**
 * One aggregated warning per zone. The violation id hashes code + anchors, so
 * per-island drafts sharing an anchor would collide; the count and the total
 * area go in the message and `measuredMm` is OMITTED (audit B3-9 — that field
 * is contractually a length, and an area is not one).
 */
function deadCopperDraft(
  ctx: DrcContext,
  zone: EffectiveCopperZone,
  netId: string,
  dead: readonly CopperFillIsland[],
): DrcViolationDraft {
  const largest = dead.reduce((a, b) => (b.areaMm2 > a.areaMm2 ? b : a));
  const totalMm2 = dead.reduce((sum, i) => sum + i.areaMm2, 0);
  const netName = ctx.netNames[netId] ?? netId;
  // The anchor decides the violation id and therefore the user's waivers: a
  // board zone is anchored on its net (there is at most one per layer), an
  // explicit zone on the zone itself so ids don't collide across zones.
  const isBoardZone = zone.sourceKind === "board";
  const noun = isBoardZone ? "copper" : "zone";
  return {
    code: "ISOLATED_COPPER_ISLAND",
    message: `${dead.length} isolated ${netName} ${noun} island${dead.length > 1 ? "s" : ""} on ${zone.layer} (${totalMm2.toFixed(1)} mm² total) reach no pad — dead copper`,
    anchors: [
      isBoardZone ? { kind: "net", netId } : { kind: "zone", zoneId: zone.id },
    ],
    locationMm: largest.centerMm,
    layer: zone.layer,
  };
}
