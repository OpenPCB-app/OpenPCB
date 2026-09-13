import type { SublevelInterval } from "../../pcb-geometry/segment-sublevel";

/**
 * Interval algebra over arc-length sets (SI contract 14 §4.2). Every list here
 * is SORTED and DISJOINT; every operation preserves that, and every measure
 * sums in that order because float addition is not associative (06 §7), so two
 * runs over the same geometry cannot disagree in the last digit.
 */

/** Sorted, disjoint (touching intervals fused — the measure is unchanged). */
export function merge(list: readonly SublevelInterval[]): SublevelInterval[] {
  if (list.length === 0) return [];
  const sorted = [...list].sort((x, y) => x.s0 - y.s0 || x.s1 - y.s1);
  const out: SublevelInterval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i += 1) {
    const iv = sorted[i]!;
    const last = out[out.length - 1]!;
    if (iv.s0 <= last.s1) {
      if (iv.s1 > last.s1) last.s1 = iv.s1;
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/** Sums in sorted order — float addition is not associative (06 §7). */
export function measure(list: readonly SublevelInterval[]): number {
  let total = 0;
  for (const iv of list) total += iv.s1 - iv.s0;
  return total;
}

/** `a \ b`, both merged. Degenerate leftovers are dropped, not reported. */
export function subtract(
  a: readonly SublevelInterval[],
  b: readonly SublevelInterval[],
): SublevelInterval[] {
  const out: SublevelInterval[] = [];
  let j = 0;
  for (const iv of a) {
    let cur = iv.s0;
    while (j < b.length && b[j]!.s1 < cur) j += 1;
    for (let k = j; k < b.length && b[k]!.s0 <= iv.s1; k += 1) {
      const hole = b[k]!;
      if (hole.s0 > cur) out.push({ s0: cur, s1: Math.min(hole.s0, iv.s1) });
      if (hole.s1 > cur) cur = hole.s1;
      if (cur >= iv.s1) break;
    }
    if (cur < iv.s1) out.push({ s0: cur, s1: iv.s1 });
  }
  return out.filter((iv) => iv.s1 > iv.s0);
}

export function intersect(
  x: SublevelInterval | null,
  y: SublevelInterval | null,
): SublevelInterval | null {
  if (!x || !y) return null;
  const s0 = Math.max(x.s0, y.s0);
  const s1 = Math.min(x.s1, y.s1);
  return s0 <= s1 ? { s0, s1 } : null;
}

export function intersectLists(
  a: readonly SublevelInterval[],
  b: readonly SublevelInterval[],
): SublevelInterval[] {
  const out: SublevelInterval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s0 = Math.max(a[i]!.s0, b[j]!.s0);
    const s1 = Math.min(a[i]!.s1, b[j]!.s1);
    if (s0 <= s1) out.push({ s0, s1 });
    if (a[i]!.s1 < b[j]!.s1) i += 1;
    else j += 1;
  }
  return out;
}
