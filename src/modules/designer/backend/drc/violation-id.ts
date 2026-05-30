import type { DrcAnchor, DrcRuleCode } from "../../../../sdks/designer";

/**
 * Escape the structural separators used by the id scheme (`:` inside a key, `|`
 * between sorted keys, `#` between code and keys) in every dynamic id segment.
 * Without this, distinct anchor sets could alias to the same hash input — e.g.
 * pad `("x","1:2")` vs `("x:1","2")`, or a net id that literally contains `|`.
 */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\p")
    .replace(/#/g, "\\h")
    .replace(/:/g, "\\c");
}

function anchorKey(a: DrcAnchor): string {
  switch (a.kind) {
    case "trace":
      return `t:${esc(a.traceId)}`;
    case "segment":
      return `s:${esc(a.traceId)}:${a.index}`;
    case "via":
      return `v:${esc(a.viaId)}`;
    case "pad":
      return `p:${esc(a.placementId)}:${esc(a.padNumber)}`;
    case "freePad":
      return `fp:${esc(a.freePadId)}`;
    case "freeHole":
      return `fh:${esc(a.freeHoleId)}`;
    case "placement":
      return `pl:${esc(a.placementId)}`;
    case "net":
      return `n:${esc(a.netId)}`;
    case "boardEdge":
      return "be";
  }
}

/**
 * 64-bit FNV-1a (canonical basis/prime), emitted as 16 hex chars. Wider than
 * the prior 32-bit lane so dense boards keep negligible id-collision odds.
 */
function fnv1a64(s: string): string {
  const PRIME = 0x100000001b3n;
  const MASK = (1n << 64n) - 1n;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i += 1) {
    h = (h ^ BigInt(s.charCodeAt(i))) & MASK;
    h = (h * PRIME) & MASK;
  }
  return h.toString(16).padStart(16, "0");
}

/**
 * Stable, order-independent violation id. Anchor keys are sorted so a pairwise
 * violation (A,B) hashes identically to (B,A), and the id survives re-runs — so
 * a persisted waiver keeps matching the same violation. NB: the 64-bit hash
 * change invalidates waiver ids persisted under the old 32-bit scheme; waivers
 * are advisory and recomputed on the next run, so this is acceptable.
 */
export function computeViolationId(
  code: DrcRuleCode,
  anchors: readonly DrcAnchor[],
): string {
  const keys = anchors.map(anchorKey).sort().join("|");
  return `${code}-${fnv1a64(`${code}#${keys}`)}`;
}
