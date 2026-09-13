import type { PcbDiffPair } from "../../sdks/designer";

/**
 * The ONE differential-pair identity (SI contract 14 §5). Explicit
 * `board.diffPairs` rows win; the remaining nets are matched on the suffix
 * table below.
 *
 * The bare `P` / `N` suffixes were REMOVED (Decision 4): they paired `VIP`
 * with `VIN`, and no naming convention in the wild writes a pair without a
 * separator. Matching is case-insensitive; partner-NAME generation
 * (`diffPairPartnerName`) is case-preserving, so `lvds0_p` answers `lvds0_n`.
 *
 * What the resolver REFUSES it reports rather than resolving by insertion
 * order, so the SI check can say so instead of going quietly inert:
 * - `ambiguous` — a base name with more than one positive or more than one
 *   negative candidate under case folding (`CLK_P`, `clk_p`, `CLK_N`).
 * - `conflicts` — two explicit rows over the same unordered net set with
 *   DIFFERENT parameters. Identical duplicates dedupe silently.
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
  couplingMaxGapMm?: number;
}

/**
 * One refused explicit table entry (contract §5, Astra #14, R2).
 *
 * - `self-pair` — one row naming the same net twice. A pair needs two nets.
 * - `duplicate` — a second row over the SAME unordered net set with different
 *   parameters. The FIRST row stays in force; only the later one is refused.
 * - `shared-net` — two rows over DIFFERENT net sets that share a net, so that
 *   net would belong to two pairs at once. NEITHER row is resolved: there is
 *   no non-arbitrary way to pick the one the designer meant.
 *
 * Identical duplicates are not conflicts — they dedupe silently.
 */
export interface DiffPairConflict {
  reason: "self-pair" | "duplicate" | "shared-net";
  /** The rows the refusal is about, in table order. */
  ids: readonly string[];
  /** The net two rows fight over (`shared-net` only). */
  netId: string | null;
  /** The offending row's net pair, for the message. */
  pNetId: string;
  nNetId: string;
}

export interface DiffPairResolution {
  pairs: ResolvedDiffPair[];
  /** Base names rejected for having several positive or negative candidates. */
  ambiguous: string[];
  conflicts: DiffPairConflict[];
}

/**
 * Ordered suffix pairs (positive, negative), longest first so `_+` is tried
 * before the bare trailing `+`.
 */
const SUFFIX_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["_P", "_N"],
  ["_+", "_-"],
  ["+", "-"],
];

function stripSuffix(name: string, suffix: string): string | null {
  return name.toUpperCase().endsWith(suffix.toUpperCase())
    ? name.slice(0, name.length - suffix.length)
    : null;
}

/**
 * The partner NAME of a diff-pair net name, or null when the name carries no
 * pair suffix. Pure and case-preserving (contract §5): the frontend
 * `tools/diff-pair.ts` re-exports this, so there is one suffix table on both
 * sides of the wire. A bare suffix (`P`, `+`) has an empty stem and is not a
 * pair name.
 */
export function diffPairPartnerName(name: string): string | null {
  const trimmed = name.trim();
  for (const [pos, neg] of SUFFIX_PAIRS) {
    for (const [from, to] of [
      [pos, neg],
      [neg, pos],
    ] as const) {
      const base = stripSuffix(trimmed, from);
      if (base === null || base.length === 0) continue;
      // Case-preserving: keep the author's spelling of the suffix wherever the
      // suffix has a case at all (`_p` → `_n`, `_P` → `_N`, `+` → `-`).
      const written = trimmed.slice(trimmed.length - from.length);
      return base + (written === written.toLowerCase() ? to.toLowerCase() : to);
    }
  }
  return null;
}

/** The full resolution, refusals included (contract §5). */
export function resolveDiffPairsFull(
  explicit: readonly PcbDiffPair[] | undefined,
  netNames: Record<string, string>,
): DiffPairResolution {
  const out: ResolvedDiffPair[] = [];
  const conflicts: DiffPairConflict[] = [];
  const claimed = new Set<string>();

  const byPairKey = new Map<string, PcbDiffPair>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const survivors: PcbDiffPair[] = [];
  for (const dp of explicit ?? []) {
    // EVERY explicit row claims the nets it names, refused or not (R2 / Astra
    // run 2): a table that names a net, however brokenly, must not hand it
    // back to the name heuristic — inference would resolve the same pair with
    // DIFFERENT (default) parameters and report against a rule nobody wrote.
    claimed.add(dp.pNetId);
    claimed.add(dp.nNetId);
    // A row naming one net twice is not a pair. It used to vanish silently,
    // which is a stored rule that does nothing and says nothing (R2).
    if (dp.pNetId === dp.nNetId) {
      conflicts.push({
        reason: "self-pair",
        ids: [dp.id],
        netId: dp.pNetId,
        pNetId: dp.pNetId,
        nNetId: dp.nNetId,
      });
      continue;
    }
    const key = pairKey(dp.pNetId, dp.nNetId);
    const kept = byPairKey.get(key);
    if (kept) {
      // A duplicate row over the same net set: identical parameters are a
      // harmless copy, different ones are two rules fighting over one pair and
      // the check reports them (`DRC_RULE_INVALID`). Either way the FIRST row
      // stays, so the resolved table never depends on which one is refused.
      if (!sameParameters(kept, dp)) {
        conflicts.push({
          reason: "duplicate",
          ids: [dp.id, kept.id],
          netId: null,
          pNetId: dp.pNetId,
          nNetId: dp.nNetId,
        });
      }
      continue;
    }
    byPairKey.set(key, dp);
    survivors.push(dp);
  }

  // A net in TWO surviving rows would belong to two pairs at once, and every
  // measure here is per pair: the same copper would be judged against two
  // targets and anchored twice. Refuse both rows rather than pick one (R2).
  const rowsOfNet = new Map<string, PcbDiffPair[]>();
  for (const dp of survivors) {
    for (const netId of [dp.pNetId, dp.nNetId]) {
      const bucket = rowsOfNet.get(netId);
      if (bucket) bucket.push(dp);
      else rowsOfNet.set(netId, [dp]);
    }
  }
  const rejected = new Set<string>();
  // Sorted by net id so the report does not follow table order for a fault
  // that is about a net, not a row (§7).
  for (const netId of [...rowsOfNet.keys()].sort()) {
    const rows = rowsOfNet.get(netId)!;
    if (rows.length < 2) continue;
    conflicts.push({
      reason: "shared-net",
      ids: rows.map((r) => r.id).sort(),
      netId,
      pNetId: rows[0]!.pNetId,
      nNetId: rows[0]!.nNetId,
    });
    for (const row of rows) rejected.add(row.id);
  }

  for (const dp of survivors) {
    if (rejected.has(dp.id)) continue;
    out.push({ ...dp });
  }

  // Name-convention auto-detection over the remaining nets. Candidates are
  // COLLECTED per (base, suffix table row) before any pair is formed: a base
  // with two positives or two negatives is ambiguous and must be refused
  // whole, not resolved by whichever net the object happened to list first.
  const posCandidates = new Map<string, string[]>();
  const negCandidates = new Map<string, string[]>();
  for (const [netId, rawName] of Object.entries(netNames)) {
    if (claimed.has(netId)) continue;
    const name = rawName.trim();
    for (const [pos, neg] of SUFFIX_PAIRS) {
      const baseP = stripSuffix(name, pos);
      if (baseP !== null && baseP.length > 0) {
        pushCandidate(posCandidates, `${baseP.toUpperCase()}|${pos}|${neg}`, netId);
        break;
      }
      const baseN = stripSuffix(name, neg);
      if (baseN !== null && baseN.length > 0) {
        pushCandidate(negCandidates, `${baseN.toUpperCase()}|${pos}|${neg}`, netId);
        break;
      }
    }
  }
  const ambiguous = new Set<string>();
  for (const key of [...posCandidates.keys()]) {
    const positives = posCandidates.get(key)!;
    const negatives = negCandidates.get(key) ?? [];
    // Nothing on the other side is no inferred pair at all, ambiguous or not —
    // two unpaired positives are just two nets, and reporting them would be
    // noise. A base that WOULD have been inferred is the one we refuse.
    if (negatives.length === 0) continue;
    if (positives.length > 1 || negatives.length > 1) {
      ambiguous.add(key.split("|")[0]!);
      continue;
    }
    const pNetId = positives[0]!;
    const nNetId = negatives[0]!;
    out.push({
      id: `auto:${pNetId}:${nNetId}`,
      name: key.split("|")[0]!,
      pNetId,
      nNetId,
    });
  }

  // Deterministic order: explicit pairs keep input order; auto-detected pairs
  // (id prefixed "auto:") sort by id so output is independent of the
  // `netNames` object/Map insertion order.
  const explicitOut = out.filter((p) => !p.id.startsWith("auto:"));
  const autos = out
    .filter((p) => p.id.startsWith("auto:"))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    pairs: [...explicitOut, ...autos],
    ambiguous: [...ambiguous].sort(),
    conflicts,
  };
}

/** The resolved pairs alone — the shape every pre-S14 caller expects. */
export function resolveDiffPairs(
  explicit: readonly PcbDiffPair[] | undefined,
  netNames: Record<string, string>,
): ResolvedDiffPair[] {
  return resolveDiffPairsFull(explicit, netNames).pairs;
}

function pushCandidate(
  map: Map<string, string[]>,
  key: string,
  netId: string,
): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(netId);
  else map.set(key, [netId]);
}

/** Every judged parameter, plus the orientation the message names. */
function sameParameters(a: PcbDiffPair, b: PcbDiffPair): boolean {
  return (
    a.pNetId === b.pNetId &&
    a.nNetId === b.nNetId &&
    a.gapMm === b.gapMm &&
    a.gapTolMm === b.gapTolMm &&
    a.maxUncoupledMm === b.maxUncoupledMm &&
    a.maxSkewMm === b.maxSkewMm &&
    a.couplingMaxGapMm === b.couplingMaxGapMm
  );
}
