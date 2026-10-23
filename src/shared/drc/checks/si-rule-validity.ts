import type { DrcAnchor } from "../../../sdks/designer";
import type { DrcContext } from "../drc-context";
import type { ResolvedDiffPair } from "../diff-pair-resolver";
import type { DrcViolationDraft } from "../types";

/** Match the resolver's domain: named nets and net IDs carried by copper. */
export function knownSiNetIds(ctx: DrcContext): ReadonlySet<string> {
  const known = new Set(Object.keys(ctx.netNames));
  for (const items of [ctx.traces, ctx.pads, ctx.vias]) {
    for (const item of items) if (item.netId) known.add(item.netId);
  }
  return known;
}

/** A missing reference is a rule defect, unlike an existing unrouted net. */
export function missingSiNetRows(
  netIds: readonly string[],
  known: ReadonlySet<string>,
  anchor: DrcAnchor,
  label: string,
): DrcViolationDraft[] {
  return [...new Set(netIds)]
    .filter((netId) => !known.has(netId))
    .sort()
    .map((netId) => ({
      code: "DRC_RULE_INEFFECTIVE",
      message:
        `${label} cannot judge net "${netId}": it does not exist in the ` +
        `current board; update the rule's net reference`,
      anchors: [anchor, { kind: "net", netId }],
    }));
}

/** Pair identity survives duplicate-row order and positive/negative reversal. */
export function missingDiffPairNetRows(
  pair: ResolvedDiffPair,
  known: ReadonlySet<string>,
): DrcViolationDraft[] {
  const [pNetId, nNetId] =
    pair.pNetId < pair.nNetId
      ? ([pair.pNetId, pair.nNetId] as const)
      : ([pair.nNetId, pair.pNetId] as const);
  return missingSiNetRows(
    [pNetId, nNetId],
    known,
    { kind: "diffPair", pNetId, nNetId },
    `Diff-pair ${pair.name}`,
  );
}
