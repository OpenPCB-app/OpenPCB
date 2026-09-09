import type { PcbDiffPair } from "../../sdks/designer";

/**
 * Resolve differential pairs for a board (P11). Explicit `board.diffPairs`
 * entries win; any net not covered by an explicit entry is matched against the
 * naming convention (suffix `_P`/`_N`, `_+`/`_-`, `+`/`-`, `P`/`N`, case-
 * insensitive) using the net-name map.
 */
export interface ResolvedDiffPair {
  id: string;
  name: string;
  pNetId: string;
  nNetId: string;
  gapMm?: number;
  gapTolMm?: number;
  maxUncoupledMm?: number;
  maxSkewMm?: number;
}

// Ordered suffix pairs (positive, negative). Longest first to avoid P/N eating
// _P/_N.
const SUFFIX_PAIRS: Array<[string, string]> = [
  ["_P", "_N"],
  ["_+", "_-"],
  ["+", "-"],
  ["P", "N"],
];

function stripSuffix(name: string, suffix: string): string | null {
  return name.toUpperCase().endsWith(suffix.toUpperCase())
    ? name.slice(0, name.length - suffix.length)
    : null;
}

export function resolveDiffPairs(
  explicit: readonly PcbDiffPair[] | undefined,
  netNames: Record<string, string>,
): ResolvedDiffPair[] {
  const out: ResolvedDiffPair[] = [];
  const claimed = new Set<string>();

  const seenPairKey = new Set<string>();
  const pairKey = (a: string, b: string) =>
    a < b ? `${a}|${b}` : `${b}|${a}`;
  for (const dp of explicit ?? []) {
    // Skip a duplicate explicit pair (same unordered net set) — duplicates
    // would double-report and, worse, multiply the O(P·N) coupling cost.
    const key = pairKey(dp.pNetId, dp.nNetId);
    if (seenPairKey.has(key) || dp.pNetId === dp.nNetId) continue;
    seenPairKey.add(key);
    out.push({ ...dp });
    claimed.add(dp.pNetId);
    claimed.add(dp.nNetId);
  }

  // Name-convention auto-detection over the remaining nets.
  const byBaseP = new Map<string, string>(); // base → netId (positive)
  const byBaseN = new Map<string, string>();
  for (const [netId, rawName] of Object.entries(netNames)) {
    if (claimed.has(netId)) continue;
    const name = rawName.trim();
    for (const [pos, neg] of SUFFIX_PAIRS) {
      const baseP = stripSuffix(name, pos);
      if (baseP !== null && baseP.length > 0) {
        byBaseP.set(`${baseP.toUpperCase()}|${pos}|${neg}`, netId);
        break;
      }
      const baseN = stripSuffix(name, neg);
      if (baseN !== null && baseN.length > 0) {
        byBaseN.set(`${baseN.toUpperCase()}|${pos}|${neg}`, netId);
        break;
      }
    }
  }
  for (const [key, pNetId] of byBaseP) {
    const nNetId = byBaseN.get(key);
    if (nNetId && !claimed.has(pNetId) && !claimed.has(nNetId)) {
      const base = key.split("|")[0]!;
      out.push({ id: `auto:${pNetId}:${nNetId}`, name: base, pNetId, nNetId });
      claimed.add(pNetId);
      claimed.add(nNetId);
    }
  }

  // Deterministic order: explicit pairs keep input order; auto-detected pairs
  // (id prefixed "auto:") sort by id so output is independent of the
  // `netNames` object/Map insertion order.
  const explicitOut = out.filter((p) => !p.id.startsWith("auto:"));
  const autos = out
    .filter((p) => p.id.startsWith("auto:"))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...explicitOut, ...autos];
}
