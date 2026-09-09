import type { EffectiveCopperZone } from "../pcb-areas";
import type { DrcContext } from "./drc-context";

/**
 * How a zone is named in a violation message. The precedence mirrors the
 * panel's own anchor label (`frontend/pcb/drc/drc-labels.ts`): the user's own
 * name first, then the net (imported zones carry a net but no name), then the
 * id. Shared by `checks/zones.ts` and `checks/copper-pour.ts` so the two codes
 * that anchor on a zone cannot name it differently.
 */
export function zoneDisplayName(
  ctx: DrcContext,
  zone: EffectiveCopperZone,
): string {
  if (zone.name) return zone.name;
  const rowNetName = ctx.projection.zones.find(
    (z) => z.id === zone.id,
  )?.netName;
  if (rowNetName) return rowNetName;
  if (zone.netId) return ctx.netNames[zone.netId] ?? zone.netId;
  return zone.id.slice(0, 6);
}
