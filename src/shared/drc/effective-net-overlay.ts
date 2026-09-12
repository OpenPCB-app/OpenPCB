// The live gate's effective-net overlay (electrical contract 13 §4.4).
//
// The board map is the context's, built once and immutable. A pending commit
// changes the geometry, so it changes the components: a pending trace can give
// an existing unassigned item a tier it did not have, take one away (via
// `replaces`), or grow a conflict from {A, B} to {A, B, C}. The overlay is a
// COMPLETE recomputation over the FINAL geometry — board minus `replaces` plus
// pending — never a union-only update, so a shrink re-tiers correctly and batch
// on the committed board derives exactly the same components (07 §1 clause 1).
//
// It is never stored on the context, and `boardBridgeCache` is untouched: the
// board's own bridge completion is a function of the board alone.

import {
  buildEffectiveNets,
  type EffectiveComponent,
  type EffectiveNetItem,
  type EffectiveNetItems,
  type EffectiveNetKind,
  type EffectiveNets,
} from "../pcb-connectivity/effective-nets";
import {
  effectiveNetCandidates,
  type DrcItems,
  type DrcPad,
  type DrcTrace,
  type DrcViaGeom,
  type LegalityContext,
} from "./drc-context";
import { buildExposureOverlay } from "./mask-exposure-overlay";
import { escapeStructuralIdSegment } from "./violation-id";

export interface EffectiveNetOverlay {
  /** `ctx` with `tierNetOf` / `chainShorts` / `effectiveNets` on the overlay. */
  context: LegalityContext;
  /**
   * Existing board items whose PAIR verdicts the pending copper can have moved:
   * the retiered ones plus the ones whose exposure moved. Nothing else belongs
   * here — a pair verdict is a function of the two TIERS, the two exposures and
   * the geometry, and none of the three moves when only a component's label set
   * or membership changed (R1 #1). Rejudging on a membership delta re-reported
   * the board's own board×board breaches as the ROUTE's and refused the commit
   * on them: a null stub landing on a conductor made every pre-existing row of
   * that conductor the route's fault. The label-set delta is already served by
   * {@link newChainShorts}.
   */
  rejudge: readonly EffectiveNetItem[];
  /**
   * The subset of {@link rejudge} whose TIER NET itself moved — the per-item
   * forms' subject set. Exposure is a pair-only input (only the judge reads
   * `exposedOn`), so an exposure move alone changes no per-item verdict.
   */
  retiered: readonly EffectiveNetItem[];
  /** Conflict components that exist only WITH the pending copper (§4.3, 07 §4). */
  newChainShorts: readonly EffectiveComponent[];
}

/** Board arrays minus `replaces`, plus the pending items, and the index maps. */
function overlayItems(
  ctx: LegalityContext,
  pending: DrcItems,
  replaces: ReadonlySet<string>,
): {
  items: EffectiveNetItems;
  /** Board index → overlay index, `-1` for a replaced item. */
  indexOf: (kind: EffectiveNetKind, boardIndex: number) => number;
  /** The pending items' overlay indices, by kind. */
  pendingIndices: (kind: EffectiveNetKind) => readonly number[];
} {
  const traceMap: number[] = [];
  const traces: DrcTrace[] = [];
  for (const t of ctx.traces) {
    traceMap.push(replaces.has(t.id) ? -1 : traces.push(t) - 1);
  }
  const viaMap: number[] = [];
  const vias: DrcViaGeom[] = [];
  for (const v of ctx.vias) {
    viaMap.push(replaces.has(v.via.id) ? -1 : vias.push(v) - 1);
  }
  // A route commits no pads, so the pad array is the board's, index for index.
  const pads: readonly DrcPad[] = ctx.pads;
  const pendingTraces = traces.length;
  const pendingVias = vias.length;
  traces.push(...pending.traces);
  vias.push(...pending.vias);
  const traceIdx = pending.traces.map((_, i) => pendingTraces + i);
  const viaIdx = pending.vias.map((_, i) => pendingVias + i);
  return {
    items: { traces, pads, vias },
    indexOf: (kind, boardIndex) =>
      kind === "traces"
        ? traceMap[boardIndex]!
        : kind === "vias"
          ? viaMap[boardIndex]!
          : boardIndex,
    pendingIndices: (kind) =>
      kind === "traces" ? traceIdx : kind === "vias" ? viaIdx : [],
  };
}

/**
 * A chain short's identity as the SURVIVING BOARD sees it: its labels plus the
 * members that are neither pending nor replaced. A component that only gained a
 * pending member — or only lost a replaced one — carries the same identity on
 * both sides, so it is the board's pre-existing short and not the route's (the
 * 07 §4 "grew because of the pending copper" rule).
 *
 * Both exclusions are needed, and on BOTH sides of the comparison (R1 #3):
 * stripping only pending members made a pure re-id tune (`replaces: ["y"]` with
 * the same geometry) look like a brand-new short, because the board-side
 * identity still named `y` while the overlay's did not.
 */
function boardIdentity(
  component: EffectiveComponent,
  transient: (item: EffectiveNetItem) => boolean,
): string {
  const keys = component.memberKeys.filter(
    (_, i) => !transient(component.members[i]!),
  );
  return `${component.labels.map(escapeStructuralIdSegment).join("|")}#${keys.join("|")}`;
}

/**
 * The overlay, the rejudge sets and the route's own chain shorts (§4.4).
 *
 * The REJUDGE set is every EXISTING board item whose tier net differs from the
 * board map's, or whose EXPOSURE moved because a pending opening now reaches
 * its copper or a replaced one no longer does (Astra run 1 #5, §1.2). A
 * component whose label set or membership changed without moving either — a
 * conflict growing from {A, B} to {A, B, C} (Astra run 1 #6) — reports through
 * {@link EffectiveNetOverlay.newChainShorts}, not through a rejudge: its pairs
 * resolve to exactly what they resolved to on the board.
 */
export function buildEffectiveNetOverlay(
  ctx: LegalityContext,
  pending: DrcItems,
  replaces: ReadonlySet<string>,
): EffectiveNetOverlay {
  const { items, indexOf, pendingIndices } = overlayItems(ctx, pending, replaces);
  const overlayNets = buildEffectiveNets(
    items,
    ctx.broadPhase === "exhaustive"
      ? {}
      : {
          // The grid indexes the BOARD arrays, so its hits are remapped onto the
          // overlay's and the (few) pending items are appended by hand.
          candidates: effectiveNetCandidates(
            ctx.near,
            ctx.nearPolyline,
            indexOf,
            pendingIndices,
          ),
        },
  );

  // The FINAL artwork's exposure (§1.2, §4.4); `null` on every board that
  // cannot have an exposure question, which keeps `ctx.exposedOn`'s memo.
  const exposure = buildExposureOverlay(ctx, pending, replaces);
  const context: LegalityContext = {
    ...ctx,
    effectiveNets: overlayNets,
    tierNetOf: (item) => overlayNets.effectiveNetOf.get(item) ?? item.netId,
    chainShorts: overlayNets.chainShorts,
    ...(exposure ? { exposedOn: exposure.exposedOn } : {}),
  };

  const existing: EffectiveNetItem[] = [
    ...ctx.traces.filter((t) => !replaces.has(t.id)),
    ...ctx.pads,
    ...ctx.vias.filter((v) => !replaces.has(v.via.id)),
  ];
  // A NAMED item's tier is its own net and never moves, so this set is the
  // unassigned copper the commit re-tiered — bounded by the components the
  // pending copper actually reaches, not by the board (Astra run 1 #13). The
  // pre-S13-review work budget is gone: its fallback set (every board null
  // item) was a strict SUPERSET of this one, so it could only ever add work.
  const retiered = existing.filter(
    (item) => ctx.tierNetOf(item) !== context.tierNetOf(item),
  );
  // An exposure move needs an opening added or removed, so this set is bounded
  // by the pending and replaced VIAS' neighbourhoods — and a NAMED item can
  // move, which the tier diff alone never reports.
  const already = new Set(retiered);
  const rejudge: EffectiveNetItem[] = [
    ...retiered,
    ...(exposure?.changed ?? []).filter((item) => !already.has(item)),
  ];

  const pendingSet = new Set<EffectiveNetItem>([
    ...pending.traces,
    ...pending.vias,
  ]);
  const transient = (item: EffectiveNetItem): boolean =>
    pendingSet.has(item) ||
    ("pointsMm" in item
      ? replaces.has(item.id)
      : "via" in item
        ? replaces.has(item.via.id)
        : false);
  const before = new Set(ctx.chainShorts.map((c) => boardIdentity(c, transient)));
  return {
    context,
    rejudge,
    retiered,
    newChainShorts: overlayNets.chainShorts.filter(
      (c) => !before.has(boardIdentity(c, transient)),
    ),
  };
}
