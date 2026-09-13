import type { PcbNetClass, PcbPointMm } from "../../../sdks/designer";
import {
  resolveDiffPairsFull,
  type DiffPairConflict,
  type ResolvedDiffPair,
} from "../diff-pair-resolver";
import type { NetPath } from "../../pcb-connectivity/net-path";
import { coupledSpans, type CoupledSpanMember } from "../si/coupled-span";
import { exceeds } from "../../pcb-geometry/tolerance";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";
import { undefinedReasonText } from "./length";
import {
  firstPointOf,
  firstUncoupledPointMm,
  netTraceItems,
  pathCopper,
  traceCopper,
} from "./diff-pair-paths";

/**
 * The ONLY defaults this check invents, and what "definitional" means for each
 * (SI contract 14 §4.2, Decision 6).
 *
 * `gapTolMm` and `couplingMaxGapMm` describe the WINDOW the measures are taken
 * over, not a property of the board: nothing physical says coupling stops at
 * four times the target gap. They are kept at exactly the values the pre-S14
 * check used so that no existing board's verdict moves without an explicit
 * edit; a board that means something else sets `PcbDiffPair.couplingMaxGapMm`.
 *
 * `maxUncoupledMm` and `maxSkewMm` are the module's long-standing thresholds
 * for a pair that names none. There is deliberately no default TARGET GAP: a
 * pair whose table and whose net classes both stay silent is reported as
 * ineffective, never judged against an invented number.
 */
export const DIFF_PAIR_DEFAULTS = {
  gapTolMm: 0.05,
  maxUncoupledMm: 15,
  maxSkewMm: 0.5,
  /** `G` — the maximum edge gap at which copper still counts as coupled. */
  couplingMaxGapMm: (targetGapMm: number): number => 4 * targetGapMm + 0.1,
  /**
   * The folded direction angle (degrees) under which a partner segment runs
   * BESIDE the member, so an off-band gap there is a mis-gapped run and not a
   * cap or corner departure (contract 14 §4.2 `wide`). The pre-S14 gate value.
   */
  parallelMaxDeg: 15,
} as const;

/**
 * Differential-pair checks: coupled-gap deviation, intra-pair skew and
 * uncoupled run length, all as MEASURES over the path model (contract 14 §4).
 *
 * Per pair, per member: the source copper is the member's measured path, the
 * partner is the partner's copper traces, and `coupledSpans` returns the exact
 * arc-length sets `{g ≤ G}`, `{g < t − tol}` and `{t + tol < g ≤ G}`. Every
 * verdict below is a length of one of those sets — no sampled "closest point
 * per segment pair", no projection of one member onto the other's axis, and so
 * symmetric in P / N by construction.
 */
export function checkSignalIntegrity(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const board = ctx.projection.board;
  const { pairs, ambiguous, conflicts } = resolveDiffPairsFull(
    board.diffPairs,
    ctx.netNames,
  );

  // What the identity refused, reported before anything is judged (§5).
  for (const conflict of conflicts) {
    out.push({
      code: "DRC_RULE_INVALID",
      message: conflictMessage(conflict, ctx.netNames),
      anchors: [{ kind: "rule", ruleId: conflictRuleId(conflict) }],
    });
  }
  for (const base of ambiguous) {
    out.push({
      code: "DRC_RULE_INEFFECTIVE",
      message:
        `Diff-pair name "${base}" has no effect: more than one net matches ` +
        `its positive or negative suffix, so no pair is inferred — name the ` +
        `pair explicitly in the diff-pair table`,
      anchors: [{ kind: "rule", ruleId: `diffPair:auto:${base}` }],
    });
  }
  if (pairs.length === 0) return out;

  const classById = new Map(board.netClasses.map((c) => [c.id, c]));
  // The ONE net-class chain (contract 06 §1) — the resolver's memoized live
  // resolution, never a second `resolveNetClassId` call from here.
  const classOf = (netId: string): PcbNetClass | null =>
    classById.get(ctx.resolver.netClassIdOf(netId)) ?? null;
  const netPaths = ctx.netPaths();
  const items = ctx.copperItems();

  for (const dp of pairs) {
    const target = resolveTargetGap(dp, classOf);
    if (target.kind === "conflict") {
      out.push({
        code: "DRC_RULE_INVALID",
        message:
          `Diff-pair ${dp.name} cannot be applied: ${target.detail}, and the ` +
          `pair declares no gapMm of its own — nothing is judged`,
        anchors: [{ kind: "rule", ruleId: `diffPair:${dp.id}` }],
      });
      continue;
    }
    if (target.kind === "none") {
      out.push({
        code: "DRC_RULE_INEFFECTIVE",
        message:
          `Diff-pair ${dp.name} has no gap target: neither the pair nor its ` +
          `nets' classes declare one, so only its length skew is judged`,
        anchors: [{ kind: "rule", ruleId: `diffPair:${dp.id}` }],
      });
    }

    const gapTolMm = dp.gapTolMm ?? DIFF_PAIR_DEFAULTS.gapTolMm;
    const couplingMaxGapMm =
      target.kind === "gap"
        ? (dp.couplingMaxGapMm ?? DIFF_PAIR_DEFAULTS.couplingMaxGapMm(target.mm))
        : null;
    // A tolerance BAND that does not fit inside its own coupling WINDOW is not
    // a rule the measures can express, at either end (R2):
    // - `t − tol > G`: `tight` is `{g < t − tol}` with no upper bound (it must
    //   NOT be clipped by `G`, or a table with the band above the window would
    //   silently pass copper that is far too close), so every uncoupled
    //   millimetre would also satisfy `tight` and be reported as off-band.
    // - `t + tol > G`: copper sitting exactly ON target is beyond the window,
    //   so it is not coupled at all — a perfectly routed pair would report its
    //   whole length as uncoupled run.
    // Either way the table is refused and nothing about the pair is judged.
    const windowProblem =
      target.kind === "gap" && couplingMaxGapMm !== null
        ? bandOutsideWindow(target.mm, gapTolMm, couplingMaxGapMm)
        : null;
    if (windowProblem !== null) {
      out.push({
        code: "DRC_RULE_INVALID",
        message:
          `Diff-pair ${dp.name} cannot be applied: ${windowProblem} (target ` +
          `${target.kind === "gap" ? target.mm.toFixed(3) : "?"} mm, tolerance ` +
          `±${gapTolMm.toFixed(3)} mm, coupling window ` +
          `${couplingMaxGapMm!.toFixed(3)} mm) — nothing is judged`,
        anchors: [{ kind: "rule", ruleId: `diffPair:${dp.id}` }],
      });
      continue;
    }

    const anchor = {
      kind: "diffPair" as const,
      pNetId: dp.pNetId,
      nNetId: dp.nNetId,
    };
    const pPath = netPaths.netPath(dp.pNetId);
    const nPath = netPaths.netPath(dp.nNetId);
    const pItems = netTraceItems(items, dp.pNetId);
    const nItems = netTraceItems(items, dp.nNetId);
    const pCopper = pPath.kind === "defined" ? pathCopper(pPath) : [];
    const nCopper = nPath.kind === "defined" ? pathCopper(nPath) : [];

    // Every member's path that has no single length, in sorted net order so
    // two members of one pair are reported deterministically (§7).
    for (const [netId, path] of [
      [dp.pNetId, pPath] as const,
      [dp.nNetId, nPath] as const,
    ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      if (path.kind !== "undefined") continue;
      if (path.reason === "open" || path.reason === "terminals") continue;
      out.push(
        undefinedRow(ctx, dp, anchor, netId, path.reason, pCopper, nCopper),
      );
    }

    // ── coupling: only with a target, never against an invented window ──
    if (target.kind === "gap" && couplingMaxGapMm !== null) {
      const params = {
        targetGapMm: target.mm,
        gapTolMm,
        couplingMaxGapMm,
        parallelMaxDeg: DIFF_PAIR_DEFAULTS.parallelMaxDeg,
      };
      // Two calls, each keeping its `p` side: a member is measured against the
      // partner's COPPER, which is not the same list as the partner's PATH, so
      // one symmetric call cannot express it (contract §4.2).
      const p = coupledSpans(pCopper, traceCopper(nItems), params).p;
      const n = coupledSpans(nCopper, traceCopper(pItems), params).p;

      // The MAXIMUM, not the sum (contract 14 §4.2 as amended): one off-band
      // stretch of the pair is seen by BOTH members — P beside a too-wide N is
      // the same copper as N beside a too-wide P — and summing would report it
      // twice, in two different arc-length domains at that. The worse member
      // carries the measure, the marker and the breakdown; both figures go in
      // the message so an asymmetric case (one member open, one long) is still
      // legible.
      const worseGap = worseOffBand(dp, p, n);
      const offBandMm = worseGap.member.offBandMm;
      if (exceeds(offBandMm, 0)) {
        const minGapMm = minOf(p.minGapMm, n.minGapMm);
        const pName = ctx.netNames[dp.pNetId] ?? dp.pNetId;
        const nName = ctx.netNames[dp.nNetId] ?? dp.nNetId;
        // A member without a routed path was never measured. Printing its
        // 0.000 mm would read as "this side is clean", which is the opposite
        // of what an undefined path means (R2) — its own
        // `NET_LENGTH_UNDEFINED` row above says why.
        const offBandOf = (path: NetPath, member: CoupledSpanMember): string =>
          path.kind === "defined"
            ? `${member.offBandMm.toFixed(3)} mm`
            : "not measured";
        out.push({
          code: "DIFF_PAIR_GAP",
          message:
            `Diff-pair ${dp.name} runs ${offBandMm.toFixed(3)} mm outside the ` +
            `${params.targetGapMm.toFixed(3)} ±${params.gapTolMm.toFixed(3)} mm ` +
            `gap band (${pName} ${offBandOf(pPath, p)}, ` +
            `${nName} ${offBandOf(nPath, n)}; ` +
            `${worseGap.member.tightMm.toFixed(3)} mm too tight, ` +
            `${worseGap.member.wideMm.toFixed(3)} mm too wide` +
            `${minGapMm === null ? "" : `; minimum copper gap ${minGapMm.toFixed(3)} mm`})`,
          anchors: [anchor],
          measuredMm: offBandMm,
          ...locationOf(
            worseGap.member.bandExitPointMm ??
              worseGap.other.bandExitPointMm ??
              canonicalFirstPoint(dp, pCopper, nCopper),
          ),
        });
      }

      const worst = worseUncoupled(
        { path: pPath, netId: dp.pNetId, member: p, copper: pCopper },
        { path: nPath, netId: dp.nNetId, member: n, copper: nCopper },
      );
      const maxUncoupledMm =
        dp.maxUncoupledMm ?? DIFF_PAIR_DEFAULTS.maxUncoupledMm;
      if (worst !== null && exceeds(worst.member.uncoupledMm, maxUncoupledMm)) {
        const netName = ctx.netNames[worst.netId] ?? worst.netId;
        out.push({
          code: "DIFF_PAIR_UNCOUPLED_LENGTH",
          message:
            `Diff-pair ${dp.name} runs ${worst.member.uncoupledMm.toFixed(2)} mm ` +
            `of net ${netName} beside no partner copper (max ` +
            `${maxUncoupledMm.toFixed(2)} mm)`,
          anchors: [anchor, { kind: "net", netId: worst.netId }],
          measuredMm: worst.member.uncoupledMm,
          ...locationOf(
            firstUncoupledPointMm(
              worst.copper,
              worst.member.coupled,
              worst.member.copperLengthMm,
            ) ?? firstPointOf(worst.copper),
          ),
        });
      }
    }

    // ── skew: chains only; a tree total cannot establish endpoint skew ──
    const maxSkewMm = dp.maxSkewMm ?? DIFF_PAIR_DEFAULTS.maxSkewMm;
    if (pPath.kind === "defined" && nPath.kind === "defined") {
      for (const [netId, path] of [
        [dp.pNetId, pPath] as const,
        [dp.nNetId, nPath] as const,
      ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
        if (path.topology !== "tree") continue;
        out.push(
          undefinedRow(
            ctx,
            dp,
            anchor,
            netId,
            "multi-terminal",
            pCopper,
            nCopper,
          ),
        );
      }
      if (pPath.topology === "chain" && nPath.topology === "chain") {
        const skewMm = Math.abs(pPath.lengthMm - nPath.lengthMm);
        if (exceeds(skewMm, maxSkewMm)) {
          out.push({
            code: "DIFF_PAIR_SKEW",
            message:
              `Diff-pair ${dp.name} length skew ${skewMm.toFixed(3)} mm ` +
              `exceeds ${maxSkewMm.toFixed(3)} mm ` +
              `(${pPath.lengthMm.toFixed(3)} vs ${nPath.lengthMm.toFixed(3)} mm, ` +
              `${pPath.viaCount + nPath.viaCount} via barrels included)`,
            anchors: [anchor],
            measuredMm: skewMm,
            ...locationOf(canonicalFirstPoint(dp, pCopper, nCopper)),
          });
        }
      }
    }
  }

  return out;
}

/**
 * The stable identity of a refused diff-pair table entry. It is the FAULT that
 * is anchored, not one of the rows: taking `ids[0]` made the violation id
 * follow the order the rows happen to sit in the table, so reversing the table
 * re-ided the row and expired its waiver (Astra run 2). Sorted ids plus the
 * shared net are invariant under that reversal.
 */
function conflictRuleId(conflict: DiffPairConflict): string {
  const ids = [...conflict.ids].sort().join("+");
  return conflict.netId === null
    ? `diffPair:${conflict.reason}:${ids}`
    : `diffPair:${conflict.reason}:${conflict.netId}:${ids}`;
}

/** One refused diff-pair row, in the words of the fault (§5, R2). */
function conflictMessage(
  conflict: DiffPairConflict,
  netNames: Record<string, string>,
): string {
  const rows = conflict.ids.map((id) => `"${id}"`).join(" and ");
  const netName = (netId: string): string => netNames[netId] ?? netId;
  switch (conflict.reason) {
    case "self-pair":
      return (
        `Diff-pair row ${rows} cannot be applied: it names net ` +
        `${netName(conflict.pNetId)} as both members — a pair needs two ` +
        `distinct nets`
      );
    case "duplicate":
      return (
        `Diff-pair row ${conflict.ids[0] ? `"${conflict.ids[0]}"` : rows} ` +
        `cannot be applied: it repeats the net pair of ` +
        `"${conflict.ids[1]}" with different parameters — the first row is ` +
        `the one in force`
      );
    case "shared-net":
      return (
        `Diff-pair rows ${rows} cannot be applied: both claim net ` +
        `${netName(conflict.netId ?? conflict.pNetId)}, so it would belong to ` +
        `two pairs at once — neither pair is judged`
      );
  }
}

/** `NET_LENGTH_UNDEFINED` as the SI check files it: diff-pair anchor + net. */
function undefinedRow(
  ctx: DrcContext,
  dp: ResolvedDiffPair,
  anchor: { kind: "diffPair"; pNetId: string; nNetId: string },
  netId: string,
  reason: string,
  pCopper: ReturnType<typeof pathCopper>,
  nCopper: ReturnType<typeof pathCopper>,
): DrcViolationDraft {
  const netName = ctx.netNames[netId] ?? netId;
  return {
    code: "NET_LENGTH_UNDEFINED",
    message:
      `Net ${netName} of diff-pair ${dp.name} has no single routed length — ` +
      `${undefinedReasonText(reason)}; the pair's length skew cannot be judged`,
    anchors: [anchor, { kind: "net", netId }],
    ...locationOf(
      firstPointOf(netId === dp.pNetId ? pCopper : nCopper) ??
        canonicalFirstPoint(dp, pCopper, nCopper),
    ),
  };
}

/**
 * Why a `t ± tol` band cannot be judged inside a `G` coupling window, or null
 * when it fits. Both ends are compared through the ONE regime (`exceeds` at
 * `DRC_EPS_MM`), so a band that ends exactly ON the window is accepted.
 */
function bandOutsideWindow(
  targetMm: number,
  tolMm: number,
  couplingMaxGapMm: number,
): string | null {
  if (exceeds(targetMm - tolMm, couplingMaxGapMm)) {
    return (
      `its tolerance band starts at ${(targetMm - tolMm).toFixed(3)} mm, ` +
      `outside its coupling window, so no copper can be both coupled and on ` +
      `target`
    );
  }
  if (exceeds(targetMm + tolMm, couplingMaxGapMm)) {
    return (
      `its tolerance band reaches ${(targetMm + tolMm).toFixed(3)} mm, past ` +
      `its coupling window, so copper on target would not count as coupled`
    );
  }
  return null;
}

type TargetGap =
  | { kind: "gap"; mm: number }
  | { kind: "none" }
  | { kind: "conflict"; detail: string };

/**
 * The pair's target gap (contract §4.2): the pair's own `gapMm`, else the two
 * members' class `diffPairGapMm` WHEN THEY AGREE. Two classes that disagree —
 * a different number, or one class declaring nothing at all — are two rules
 * over one pair, so nothing is judged rather than one member being measured
 * against a rule its own class never stated.
 */
function resolveTargetGap(
  dp: ResolvedDiffPair,
  classOf: (netId: string) => PcbNetClass | null,
): TargetGap {
  if (dp.gapMm !== undefined) return { kind: "gap", mm: dp.gapMm };
  const p = classOf(dp.pNetId)?.diffPairGapMm;
  const n = classOf(dp.nNetId)?.diffPairGapMm;
  if (p === undefined && n === undefined) return { kind: "none" };
  if (p === undefined || n === undefined) {
    return {
      kind: "conflict",
      detail: "only one of its nets' classes declares a diff-pair gap",
    };
  }
  if (p !== n) {
    return {
      kind: "conflict",
      detail: `its nets' classes declare different diff-pair gaps (${p.toFixed(3)} vs ${n.toFixed(3)} mm)`,
    };
  }
  return { kind: "gap", mm: p };
}

interface MemberView {
  path: NetPath;
  netId: string;
  member: CoupledSpanMember;
  copper: ReturnType<typeof pathCopper>;
}

/**
 * The member with the longer uncoupled run. A member with an UNDEFINED path
 * contributes no value at all: its zero is the absence of a measurement, not
 * a perfectly coupled run (contract §4.2).
 */
function worseUncoupled(p: MemberView, n: MemberView): MemberView | null {
  // Sorted by net id first, so a tie between the two members resolves to the
  // same member whichever way the table names them (§7).
  const candidates = [p, n]
    .filter((m) => m.path.kind === "defined")
    .sort((a, b) => (a.netId < b.netId ? -1 : a.netId > b.netId ? 1 : 0));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, m) =>
    m.member.uncoupledMm > best.member.uncoupledMm ? m : best,
  );
}

/**
 * The member with the longer off-band run, and the other one. Ties go to the
 * smaller net id, so swapping `pNetId` / `nNetId` moves neither the measure
 * nor the marker (§7).
 */
function worseOffBand(
  dp: ResolvedDiffPair,
  p: CoupledSpanMember,
  n: CoupledSpanMember,
): { member: CoupledSpanMember; other: CoupledSpanMember } {
  if (p.offBandMm !== n.offBandMm) {
    return p.offBandMm > n.offBandMm
      ? { member: p, other: n }
      : { member: n, other: p };
  }
  return dp.pNetId <= dp.nNetId
    ? { member: p, other: n }
    : { member: n, other: p };
}

/** The pair's canonical marker: the first copper of its smaller net id. */
function canonicalFirstPoint(
  dp: ResolvedDiffPair,
  pCopper: ReturnType<typeof pathCopper>,
  nCopper: ReturnType<typeof pathCopper>,
): PcbPointMm | null {
  const [first, second] =
    dp.pNetId <= dp.nNetId ? [pCopper, nCopper] : [nCopper, pCopper];
  return firstPointOf(first) ?? firstPointOf(second);
}

function minOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function locationOf(point: PcbPointMm | null): { locationMm?: PcbPointMm } {
  return point === null ? {} : { locationMm: point };
}
