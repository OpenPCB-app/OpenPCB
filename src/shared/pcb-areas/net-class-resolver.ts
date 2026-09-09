// Map a net's name to a PcbNetClass id by pattern.
// Used when no explicit per-net assignment UI exists yet.

import type { PcbBoardSettings, PcbNetClass } from "../../sdks/designer";
import { GND_NAMES } from "../../sdks/designer/ground-net";

export { GND_NAMES, findGroundNetId } from "../../sdks/designer/ground-net";
const POWER_NAMES = /^(VCC|VDD|VBAT|VBUS|VIN|VOUT)$/i;
// Matches +3V3, +5V, -12V, +1V8, +0.9V, -0V9, etc.
const POWER_VOLTAGE = /^[+-]\d+(\.\d+)?V\d*$/i;

/**
 * The class a net falls to when no assignment and no name pattern claims it
 * (rule-semantics contract §3 step 3). The stored array order is semantic: the
 * FIRST class is the default. Deliberately not "the class whose id is
 * `default`" — preferring that id would silently reclassify every existing
 * board whose first class is another one (Astra run 1 #8). One helper, so the
 * DRC resolver, the command executor and the canvas cannot drift apart.
 */
export function defaultNetClassId(
  classes: ReadonlyArray<PcbNetClass>,
): string {
  return classes[0]?.id ?? "default";
}

export function classIdForName(
  name: string,
  available: ReadonlyArray<PcbNetClass>,
): string {
  const trimmed = name.trim();
  const has = (id: string): boolean => available.some((c) => c.id === id);
  if (GND_NAMES.test(trimmed) && has("gnd")) return "gnd";
  if (POWER_NAMES.test(trimmed) && has("power")) return "power";
  if (POWER_VOLTAGE.test(trimmed) && has("power")) return "power";
  return defaultNetClassId(available);
}

/**
 * True when the net name matches a class NAME PATTERN (GND/POWER/voltage) that
 * resolves to an existing class — i.e. a genuine name match, NOT the
 * array-order fallback. Lets callers distinguish "user named this GND" from
 * "fell through to the first class".
 */
export function netNameMatchesClassPattern(
  name: string,
  available: ReadonlyArray<PcbNetClass>,
): boolean {
  const trimmed = name.trim();
  const has = (id: string): boolean => available.some((c) => c.id === id);
  if (GND_NAMES.test(trimmed) && has("gnd")) return true;
  if ((POWER_NAMES.test(trimmed) || POWER_VOLTAGE.test(trimmed)) && has("power"))
    return true;
  return false;
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

/**
 * The net class a copper command COMMITS with (rule-semantics contract §3
 * step 3): a per-net assignment upgrades the DEFAULT class the route tool
 * offered, never an explicit non-default choice. One helper for the server
 * builders (`buildPcbTraceForInsert` / `buildPcbViaForInsert`) and the live
 * session mapper (`pendingCopperFromSession`), so the copper the client judges
 * carries the class the server will store (live-parity contract 07 §6).
 */
export function effectiveNetClassId(
  board: PcbBoardSettings,
  netId: string | null,
  requestedClassId: string,
): string {
  if (!netId) return requestedClassId;
  const assigned = board.perNetClassAssignments?.[netId];
  if (!assigned) return requestedClassId;
  const defaultId = defaultNetClassId(board.netClasses);
  if (requestedClassId !== defaultId) return requestedClassId;
  return board.netClasses.some((nc) => nc.id === assigned)
    ? assigned
    : requestedClassId;
}
