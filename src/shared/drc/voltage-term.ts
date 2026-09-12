/**
 * The IPC-2221 spacing constituent of the rule resolver (electrical contract 13
 * §2, §3.1). ONE derivation of every board's voltage model: which classes
 * declare a potential, what interval it occupies, what a pair's differential is
 * and what the table then requires.
 *
 * It is a CONSTITUENT, not a check: `rule-resolver.ts` folds it into every
 * `ResolvedValue`, so the pair judge, the copper pour, the route obstacles and
 * the live gate inherit it by construction with no second derivation (§3.2).
 */
import type {
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbNetClass,
} from "../../sdks/designer";
import {
  ipc2221SpacingMm,
  spacingColumn,
  type IpcSpacingColumn,
} from "./ipc2221-spacing";
import type { RuleProblem } from "./rule-compile";

/** The interval a net's potential occupies, in volts, relative to the board reference. */
export interface VoltageInterval {
  minV: number;
  maxV: number;
}

/**
 * An UNDECLARED net is assumed at the board reference potential (§2). This is
 * an assumption the report states; it is never "unassessed".
 */
const REFERENCE: VoltageInterval = { minV: 0, maxV: 0 };

/**
 * Largest magnitude a declared potential may carry (V). `asNumber` in the store
 * accepts any FINITE double, and two endpoints near `Number.MAX_VALUE` make
 * `|a.min − b.max|` overflow to `Infinity`, which `ipc2221SpacingMm` refuses —
 * a throw out of batch DRC, the live gate and `clearanceBound` alike. A million
 * volts is orders of magnitude past anything a PCB carries, so a declaration
 * beyond it is malformed data, reported and never assessed (§2).
 */
export const MAX_DECLARED_VOLTAGE_V = 1e6;

/**
 * Magnitude limits a declared CURRENT-side input may carry. The width formula
 * raises the current to the power 1/0.725 and divides by the copper thickness,
 * so finite, store-accepted extremes overflow it: 1e225 A on 1.7e308 oz made
 * both the area and the thickness `Infinity` and their quotient `NaN`, which
 * `below()` answered "not narrower" — a silent pass on a trace whose true
 * requirement is 39 mm (Astra run 2). A declaration is usable only inside
 * `[1 / cap, cap]`; the reciprocal floor is what keeps `requiredTraceWidthMm`'s
 * overflow guard unreachable from board data, and both ends sit orders of
 * magnitude outside anything a PCB carries, so a value past either is malformed
 * data, reported and never assessed (§2, §5).
 */
export const MAX_DECLARED_CURRENT_A = 1e6;
/** Copper-weight twin of {@link MAX_DECLARED_CURRENT_A} (oz/ft²). */
export const MAX_COPPER_WEIGHT_OZ = 1e3;
/** Temperature-rise twin of {@link MAX_DECLARED_CURRENT_A} (°C). */
export const MAX_TEMP_RISE_C = 1e4;

/** The spacing requirement one pair's declared potentials impose (§3.1). */
export interface VoltageTerm {
  mm: number;
  diffV: number;
  column: IpcSpacingColumn;
  /** Either item is exposed on this pair's face — the B4 gate (§1.2). */
  exposed: boolean;
  /**
   * The board declares a permanent polymer coating, so B4 was AVAILABLE for
   * this pair and a B2 column means exposure demoted it. The report says which
   * (§7); on an uncoated board there is no decision to state.
   */
  coated: boolean;
  /**
   * One side declares no potential and is ASSUMED at the board reference (§2).
   * The verdict states the assumption rather than presenting it as measured.
   */
  undeclared: boolean;
}

export interface VoltageModel {
  /**
   * The pair's constituent (§3.1), or `null`. It exists only when at least one
   * side DECLARES a potential and the two nets DIFFER: a conductor has no
   * spacing requirement to itself, and a board with no declared voltage is
   * byte-identical to the pre-S13 one and pays nothing.
   */
  termFor(
    layer: PcbCopperLayerId,
    aNetId: string | null,
    bNetId: string | null,
    exposedA: boolean,
    exposedB: boolean,
  ): VoltageTerm | null;
  /**
   * The widest term ANY declared class could impose against `netId` — what a
   * route whose own net is not yet assigned must keep (§3.2 c).
   */
  widestTermAgainstMm(
    layer: PcbCopperLayerId,
    netId: string | null,
    exposed: boolean,
  ): number;
  /**
   * No class declares a usable potential, so NO pair carries the constituent —
   * the opt-in gate of the pre-S13 check (§2).
   */
  hasDeclaredVoltage: boolean;
  /** `electrical.outerConductors === "coated"` — the user's B4 claim (§1.2). */
  coated: boolean;
  /**
   * Non-finite / inverted voltages, a non-positive class current, temperature
   * rise or copper weight (§2, §5).
   */
  problems: readonly RuleProblem[];
}

/**
 * The pair differential, `max(|a.min − b.max|, |a.max − b.min|)`, or `null`
 * when NEITHER side declares (§2). Exact when the two potentials vary
 * independently and conservative when they are correlated — the interval answer
 * to signed peak subtraction, which called two 300 V nets 180° apart Δ = 0.
 *
 * Rounded to 1 µV before any band selection so a decimal declaration whose
 * float difference lands a few ulp above a band edge (−9.95 and −39.95 →
 * 30.000000000000004) selects the band its decimals name (Astra run 1 #10).
 */
export function voltageDeltaV(
  a: VoltageInterval | null,
  b: VoltageInterval | null,
): number | null {
  if (a === null && b === null) return null;
  const x = a ?? REFERENCE;
  const y = b ?? REFERENCE;
  const raw = Math.max(Math.abs(x.minV - y.maxV), Math.abs(x.maxV - y.minV));
  // Depth behind {@link MAX_DECLARED_VOLTAGE_V}: an overflowed differential is
  // no differential, so the constituent is ABSENT rather than a throw out of
  // the resolver. `Math.round(Infinity * 1e6)` is `Infinity`, which would reach
  // the table's guard.
  if (!Number.isFinite(raw)) return null;
  return Math.round(raw * 1e6) / 1e6;
}

/** `ipc2221SpacingMm` at the pair's differential and column (§3.1). */
function termOfIntervals(
  layer: PcbCopperLayerId,
  a: VoltageInterval | null,
  b: VoltageInterval | null,
  opts: { coated: boolean; exposed: boolean },
): VoltageTerm | null {
  const diffV = voltageDeltaV(a, b);
  if (diffV === null) return null;
  const column = spacingColumn(layer, opts);
  return {
    mm: ipc2221SpacingMm(diffV, column),
    diffV,
    column,
    exposed: opts.exposed,
    coated: opts.coated,
    undeclared: a === null || b === null,
  };
}

function problem(id: string, name: string, detail: string): RuleProblem {
  return {
    ruleId: id,
    ruleName: name,
    // Not a `board.drcRules` index — electrical problems are reported after the
    // rule-table ones and keep their own first-seen order.
    ruleIndex: -1,
    kind: "invalid",
    // The stored value is malformed, and the constituent it feeds is excluded
    // from resolution entirely — exactly what the reason means for a rule.
    reason: "malformed",
    detail,
  };
}

/**
 * A present field that is not a finite number, or one whose magnitude is past
 * {@link MAX_DECLARED_VOLTAGE_V}, is never assessed silently (§2). The problem's
 * detail states only what THIS FIELD costs; the consequence for the class is
 * appended by {@link intervalOfNetClass}, which alone knows whether anything
 * valid is left to judge the class by.
 */
function declaredEndpoint(
  value: number | undefined,
  field: string,
  cls: PcbNetClass,
  out: RuleProblem[],
): number | null {
  if (value === undefined) return null;
  if (Number.isFinite(value) && Math.abs(value) <= MAX_DECLARED_VOLTAGE_V) {
    return value;
  }
  const why = Number.isFinite(value)
    ? `is ${value}, past the ${MAX_DECLARED_VOLTAGE_V} V limit a declared potential may carry`
    : `is ${String(value)}, not a finite number`;
  out.push(
    problem(
      `netClass:${cls.id}:${field}`,
      `${cls.name}.${field}`,
      `${field} ${why}, so it is ignored`,
    ),
  );
  return null;
}

/** The declared interval of one class, or `null`; appends its problems. */
function intervalOfNetClass(
  cls: PcbNetClass,
  out: RuleProblem[],
): VoltageInterval | null {
  const local: RuleProblem[] = [];
  const minV = declaredEndpoint(cls.voltageMinV, "voltageMinV", cls, local);
  const maxV = declaredEndpoint(cls.voltageMaxV, "voltageMaxV", cls, local);
  const v = declaredEndpoint(cls.voltageV, "voltageV", cls, local);
  // Both or neither (§2): when both endpoints survive, the INTERVAL decides and
  // a constant potential beside it is not a second answer. A lone endpoint is
  // not an interval, so the constant potential — if any — answers instead.
  let interval: VoltageInterval | null = null;
  if (minV !== null && maxV !== null) {
    if (minV <= maxV) interval = { minV, maxV };
    else {
      local.push(
        problem(
          `netClass:${cls.id}:voltageMinV`,
          `${cls.name}.voltageMinV`,
          `voltageMinV ${minV} is above voltageMaxV ${maxV}, so the interval is ignored`,
        ),
      );
    }
  } else if (v !== null) {
    interval = { minV: v, maxV: v };
  }
  // The CONSEQUENCE is the class's, not the field's: a class that still carries
  // a usable potential is judged by it, and only a class left with none carries
  // no requirement at all.
  const consequence =
    interval === null
      ? "nets of this class carry no IPC-2221 spacing requirement"
      : `nets of this class are judged at ${interval.minV} … ${interval.maxV} V instead`;
  for (const p of local) out.push({ ...p, detail: `${p.detail}; ${consequence}` });
  return interval;
}

/**
 * Why a present electrical scalar cannot be used, or `null` when it can: it
 * must be finite, strictly positive and inside `[1 / cap, cap]` (§5). The
 * caller appends what the rejection costs.
 */
function magnitudeReason(
  value: number,
  cap: number,
  unit: string,
): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return `is ${String(value)}, which is not a finite positive number`;
  }
  if (value > cap || value < 1 / cap) {
    return `is ${value}, outside the ${1 / cap} … ${cap} ${unit} range a declaration may carry`;
  }
  return null;
}

/** A present class `currentA` must be usable in the width formula (§5). */
function currentProblem(cls: PcbNetClass, out: RuleProblem[]): void {
  const currentA = cls.currentA;
  if (currentA === undefined) return;
  const why = magnitudeReason(currentA, MAX_DECLARED_CURRENT_A, "A");
  if (why === null) return;
  out.push(
    problem(
      `netClass:${cls.id}:currentA`,
      `${cls.name}.currentA`,
      `currentA ${why} — no trace of this class is judged for current-carrying width`,
    ),
  );
}

/** A present `electrical` scalar must be usable in the width formula (§5). */
function electricalProblems(board: PcbBoardSettings, out: RuleProblem[]): void {
  const elec = board.designRules.electrical;
  if (!elec) return;
  const fields = [
    ["tempRiseC", elec.tempRiseC, MAX_TEMP_RISE_C, "°C"],
    ["copperWeightOz", elec.copperWeightOz, MAX_COPPER_WEIGHT_OZ, "oz"],
    ["innerCopperWeightOz", elec.innerCopperWeightOz, MAX_COPPER_WEIGHT_OZ, "oz"],
  ] as const;
  for (const [field, value, cap, unit] of fields) {
    if (value === undefined) continue;
    const why = magnitudeReason(value, cap, unit);
    if (why === null) continue;
    out.push(
      problem(
        `designRules.electrical.${field}`,
        `designRules.electrical.${field}`,
        `${field} ${why} — no trace is judged for current-carrying width`,
      ),
    );
  }
}

/**
 * The board's voltage model (§2), built once with the rule resolver.
 * `netClassIdOf` is the resolver's OWN live class chain (06 §1) — this module
 * never resolves a class a second way.
 */
export function buildVoltageModel(
  board: PcbBoardSettings,
  netClassIdOf: (netId: string | null) => string,
): VoltageModel {
  const problems: RuleProblem[] = [];
  const byClassId = new Map<string, VoltageInterval>();
  const declaredIntervals: VoltageInterval[] = [];
  for (const cls of board.netClasses) {
    const interval = intervalOfNetClass(cls, problems);
    currentProblem(cls, problems);
    if (interval === null) continue;
    byClassId.set(cls.id, interval);
    declaredIntervals.push(interval);
  }
  electricalProblems(board, problems);
  const hasDeclaredVoltage = byClassId.size > 0;
  const coated = board.designRules.electrical?.outerConductors === "coated";
  const intervalOfNet = (netId: string | null): VoltageInterval | null =>
    netId === null ? null : (byClassId.get(netClassIdOf(netId)) ?? null);

  return {
    termFor(layer, aNetId, bNetId, exposedA, exposedB) {
      if (!hasDeclaredVoltage) return null;
      if (aNetId !== null && aNetId === bNetId) return null;
      return termOfIntervals(
        layer,
        intervalOfNet(aNetId),
        intervalOfNet(bNetId),
        { coated, exposed: exposedA || exposedB },
      );
    },
    widestTermAgainstMm(layer, netId, exposed) {
      if (!hasDeclaredVoltage) return 0;
      const other = intervalOfNet(netId);
      const opts = { coated, exposed };
      let max = 0;
      // Every DECLARED class the unassigned net could turn out to belong to,
      // plus the reference potential for an undeclared one — which is a term
      // only when the OTHER side declares (§2 applicability).
      const fold = (a: VoltageInterval | null): void => {
        const term = termOfIntervals(layer, a, other, opts);
        if (term !== null) max = Math.max(max, term.mm);
      };
      for (const interval of declaredIntervals) fold(interval);
      if (other !== null) fold(null);
      return max;
    },
    hasDeclaredVoltage,
    coated,
    problems,
  };
}

/**
 * The widest differential any pair on this board can present — the creepage
 * halo's input (§3.4). `Infinity` whenever ANY declared field is non-finite:
 * a full scan is correct, only slow, while a finite fallback silently dropped
 * the finite pairs that needed a wider halo (Astra A2 #1).
 *
 * Every interval lies in `[lo, hi]` with the reference folded in, and
 * `max(|a.min − b.max|, |a.max − b.min|) <= hi − lo` with equality at the
 * widest pair — so `hi − lo` IS the widest Δ. Inverted intervals contribute
 * both endpoints, which can only widen the halo.
 */
export function widestVoltageDeltaV(board: PcbBoardSettings): number {
  let lo = 0;
  let hi = 0;
  for (const cls of board.netClasses) {
    for (const v of [cls.voltageV, cls.voltageMinV, cls.voltageMaxV]) {
      if (v === undefined) continue;
      if (!Number.isFinite(v)) return Number.POSITIVE_INFINITY;
      // An out-of-range endpoint is REJECTED by the model above, so it is not a
      // differential any pair can present and the halo must not be widened to a
      // "whole board" scan on its account.
      if (Math.abs(v) > MAX_DECLARED_VOLTAGE_V) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return hi - lo;
}
