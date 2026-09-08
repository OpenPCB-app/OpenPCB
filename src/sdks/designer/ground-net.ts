/**
 * Ground-net naming convention shared by the backend (net-class resolution,
 * the legacy board-fill policy) and the frontend (the same policy applied to
 * the live view-state slice), so every consumer derives the same board zones.
 */
export const GND_NAMES = /^(GND|GROUND|AGND|DGND|EARTH|VSS|VEE)$/i;

export function isGroundNetName(name: string): boolean {
  return GND_NAMES.test(name.trim());
}

/** First net id (in map order) whose name is a ground name, or null. */
export function findGroundNetId(
  netNames: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): string | null {
  const entries =
    netNames instanceof Map ? netNames.entries() : Object.entries(netNames);
  for (const [netId, name] of entries) {
    if (isGroundNetName(name)) return netId;
  }
  return null;
}
