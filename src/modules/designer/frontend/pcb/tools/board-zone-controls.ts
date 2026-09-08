/**
 * Pure helpers behind the layers-panel per-layer copper-fill toggle, which
 * *is* a board zone's lifecycle control (contract §12.3): the toggle adds a
 * board-region zone row when none exists for the layer, or flips `enabled`
 * on the existing row.
 */
import type { PcbCopperLayerId, PcbZone } from "../../../../../sdks";

/** The board zone for `layer`, or null when none is persisted yet. */
export function boardZoneForLayer(
  zones: readonly PcbZone[],
  layer: PcbCopperLayerId,
): PcbZone | null {
  return (
    zones.find(
      (zone) => zone.region.kind === "board" && zone.layer === layer,
    ) ?? null
  );
}

export type BoardZoneToggleAction =
  | { kind: "add"; layer: PcbCopperLayerId }
  | { kind: "update"; zoneId: string; enabled: boolean };

/** What toggling the layers-panel fill control for `layer` should do. */
export function boardZoneToggleAction(
  zones: readonly PcbZone[],
  layer: PcbCopperLayerId,
): BoardZoneToggleAction {
  const row = boardZoneForLayer(zones, layer);
  if (!row) return { kind: "add", layer };
  return { kind: "update", zoneId: row.id, enabled: !row.enabled };
}

/** True when any layer has an enabled board zone (used for a summary badge). */
export function hasEnabledBoardZone(zones: readonly PcbZone[]): boolean {
  return zones.some((zone) => zone.region.kind === "board" && zone.enabled);
}
