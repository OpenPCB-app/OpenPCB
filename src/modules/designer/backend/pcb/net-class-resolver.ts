// Map a net's name to a PcbNetClass id by pattern.
// Used when no explicit per-net assignment UI exists yet.

import type { PcbNetClass } from "../../../../sdks/designer";

const GND_NAMES = /^(GND|GROUND|AGND|DGND|EARTH|VSS|VEE)$/i;
const POWER_NAMES = /^(VCC|VDD|VBAT|VBUS|VIN|VOUT)$/i;
// Matches +3V3, +5V, -12V, +1V8, +0.9V, -0V9, etc.
const POWER_VOLTAGE = /^[+-]\d+(\.\d+)?V\d*$/i;

function classIdForName(
  name: string,
  available: ReadonlyArray<PcbNetClass>,
): string {
  const trimmed = name.trim();
  const has = (id: string): boolean => available.some((c) => c.id === id);
  if (GND_NAMES.test(trimmed) && has("gnd")) return "gnd";
  if (POWER_NAMES.test(trimmed) && has("power")) return "power";
  if (POWER_VOLTAGE.test(trimmed) && has("power")) return "power";
  return available[0]?.id ?? "default";
}

export function resolveNetClassId(
  netName: string,
  netClasses: ReadonlyArray<PcbNetClass>,
  assignments?: Record<string, string>,
  netId?: string | null,
): string {
  // An explicit per-net assignment wins over the name-pattern heuristic, but
  // only if it points at a class that still exists.
  if (netId && assignments) {
    const assigned = assignments[netId];
    if (assigned && netClasses.some((c) => c.id === assigned)) {
      return assigned;
    }
  }
  return classIdForName(netName, netClasses);
}
