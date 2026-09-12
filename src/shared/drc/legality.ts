// Pending-copper legality — the ONE function the route tool's live check, its
// commit gate, the smart-via and tune guards and the server-side commit gate
// all call (live-parity contract 07).
//
// It is not a second DRC. It builds the pending items with the SAME builder the
// board's items came from, runs the SAME per-pair and per-item bodies batch
// runs, and finishes through the SAME `finalizeReport` — so the measurement a
// route reports is the measurement the report reports, to the bit (07 §1).

import type {
  DrcRuleClass,
  DrcRuleCode,
  DrcViolation,
  PcbTrace,
  PcbVia,
} from "../../sdks/designer";
import { buildCopperRecords } from "../pcb-connectivity/copper-records";
import { boardItems, holePairs } from "./checks/board";
import { chainShortDrafts } from "./checks/chain-short";
import {
  judgeCopperPairs,
  rejudgeItemPairs,
  type ItemSet,
} from "./checks/clearance";
import { constraintItems } from "./checks/constraints";
import { copperToHolePairs } from "./checks/copper-to-hole";
import { currentItems } from "./checks/electrical";
import { keepoutItems } from "./checks/keepouts";
import { manufacturabilityItems } from "./checks/manufacturability";
import { netClassItems } from "./checks/netclass";
import {
  itemsFromRecords,
  type DrcItems,
  type DrcPad,
  type DrcTrace,
  type DrcViaGeom,
  type LegalityContext,
} from "./drc-context";
import { finalizeReport } from "./drc-engine";
import {
  buildEffectiveNetOverlay,
  type EffectiveNetOverlay,
} from "./effective-net-overlay";
import type { DrcSeverityOverrides } from "./severity";
import type { DrcViolationDraft } from "./types";

/** The copper about to be committed. Ids are the caller's (07 §1, §4). */
export interface PendingCopper {
  traces: readonly PcbTrace[];
  vias: readonly PcbVia[];
}

export interface LegalityOptions {
  /** Board item ids the pending copper replaces (a tune / geometry edit). */
  replaces?: readonly string[];
  /** Default from `ctx.board.viewState` / `drcSeverityOverrides`, as `runDrc` does. */
  ignoredRuleClasses?: readonly DrcRuleClass[];
  waivedIds?: readonly string[];
  severityOverrides?: DrcSeverityOverrides;
}

/**
 * The live code set `L` a "refuse" gate refuses on (07 §6) — an ALLOW-LIST, not
 * "every error severity": everything else in `L` is reported as a warning, so a
 * new error-severity code cannot silently start blocking commits.
 */
export const REFUSE_CODES: ReadonlySet<DrcRuleCode> = new Set<DrcRuleCode>([
  "NET_SHORT_CIRCUIT",
  "TRACE_TO_TRACE_CLEARANCE",
  "TRACE_TO_PAD_CLEARANCE",
  "TRACE_TO_VIA_CLEARANCE",
  "VIA_TO_VIA_CLEARANCE",
  "PAD_TO_PAD_CLEARANCE",
  "PAD_TO_VIA_CLEARANCE",
  "COPPER_TO_HOLE",
  "COPPER_TO_BOARD_EDGE",
  "COPPER_OFF_BOARD",
  "KEEPOUT_VIOLATION",
  "HOLE_OFF_BOARD",
  "VIA_LAYER_SPAN",
  "TRACE_LAYER_MISMATCH",
  "TRACE_WIDTH_MIN",
  // The IPC-2221 spacing CONSTITUENT (electrical contract 13 §3.6): it comes
  // out of the SAME pair judge the gate already calls, so live and batch agree
  // by construction — listing it is what makes the gate refuse a commit the
  // batch report would fail. `refusedViolations` filters by code, waiver and
  // outline dependence, never by effective severity, so a `CREEPAGE_DISTANCE`
  // downgraded to a warning still refuses, exactly as a downgraded clearance
  // does.
  "CREEPAGE_DISTANCE",
]);

/**
 * The live code set `L` (07 §3): everything `checkPendingCopper` can report about
 * pending copper — the refuse set plus the codes reported as warnings. Exported
 * so the parity harness asserts against the module, not a hand-typed list.
 * `PAD_LAYER_MISMATCH` is in the per-item form but structurally unreachable for
 * pending copper (a route commits no pads); `FAB_PAD` DOES fire for a pending
 * via (its pad diameter against the fab minimum).
 */
export const LIVE_CODES: ReadonlySet<DrcRuleCode> = new Set<DrcRuleCode>([
  ...REFUSE_CODES,
  "FAB_CLEARANCE",
  "HOLE_TO_HOLE",
  "FAB_HOLE_TO_HOLE",
  "HOLE_TO_BOARD_EDGE",
  "VIA_DIAMETER_MIN",
  "VIA_DRILL_MIN",
  "DRILL_SIZE_MIN",
  "ANNULAR_RING_MIN",
  "VIA_ASPECT_RATIO",
  // The sibling verdict of `VIA_ASPECT_RATIO`: a non-through via gets no
  // aspect ratio and this instead (manufacturability contract 10 §5). It comes
  // out of the SAME per-item body, so the pending gate reports it too — as a
  // warning, not a refusal: the copper is legal, the drill FILE cannot carry
  // it, and that is an export decision, not a routing one.
  "VIA_TYPE_UNSUPPORTED",
  "FAB_TRACE_WIDTH",
  "FAB_DRILL",
  "FAB_ANNULAR_RING",
  "FAB_PAD",
  "NETCLASS_TRACE_WIDTH",
  "NETCLASS_VIA_DIAMETER",
  "NETCLASS_VIA_DRILL",
  "PAD_LAYER_MISMATCH",
  // The current estimate (electrical contract 13 §3.6, §5) — a WARNING, never a
  // refusal: a narrow trace is legal copper the fabricator will build, and the
  // rise it will actually see is not something this formula establishes.
  "TRACE_CURRENT_WIDTH",
]);

/** Codes an invalid outline downgrades to "report": rerouting cannot fix one. */
const OUTLINE_DEPENDENT: ReadonlySet<DrcRuleCode> = new Set<DrcRuleCode>([
  "COPPER_OFF_BOARD",
  "COPPER_TO_BOARD_EDGE",
]);

/**
 * The violations a "refuse" gate blocks on: in `REFUSE_CODES`, not waived, and
 * — when the board's outline is itself invalid — not the off-board tier (07 §6).
 */
export function refusedViolations(
  ctx: LegalityContext,
  violations: readonly DrcViolation[],
): DrcViolation[] {
  return violations.filter((v) => {
    if (!REFUSE_CODES.has(v.code)) return false;
    if (v.waived) return false;
    return !(ctx.outlineInvalid && OUTLINE_DEPENDENT.has(v.code));
  });
}

/**
 * FAIL CLOSED on the one precondition the enumeration cannot detect (R1 #4).
 *
 * A pending item that reuses a BOARD item's id without declaring it in
 * `replaces` collides on `anchorKey`: the board twin stays in the enumeration
 * (so the two are judged against each other as if they were different
 * conductors) AND the shared key makes `judgeCopperPairs` treat any bridge on
 * the board twin as the SUBJECT's, skipping the board-side completion — a
 * silent under-report on the exact path (a tune) where the collision is
 * plausible. There is no verdict that is right here, so there is no verdict.
 */
function assertPendingIdsAreFree(
  ctx: LegalityContext,
  pending: PendingCopper,
  replaces: ReadonlySet<string>,
): void {
  const traceIds = new Set(pending.traces.map((t) => t.id));
  const viaIds = new Set(pending.vias.map((v) => v.id));
  const clash = (kind: string, id: string): never => {
    throw new Error(
      `checkPendingCopper: pending ${kind} "${id}" reuses a board ${kind} id that is not listed in \`replaces\`. ` +
        `Give the pending item a fresh id, or declare the board item as replaced.`,
    );
  };
  for (const t of ctx.traces) {
    if (traceIds.has(t.id) && !replaces.has(t.id)) clash("trace", t.id);
  }
  for (const v of ctx.vias) {
    if (viaIds.has(v.via.id) && !replaces.has(v.via.id)) clash("via", v.via.id);
  }
}

/**
 * The pending copper as DRC items — the SAME builder and the SAME clamp mapping
 * the board's items came from, so a pending via contributes a `DrcViaGeom` AND
 * a `via` `DrcHole` exactly as a committed one does (07 §4). No placements and
 * no pad nets: a route commits no pads.
 *
 * Exported because `buildRouteObstacles` needs the same items the gate judges
 * (07 §5) — one derivation, so an obstacle and a verdict can never be about
 * two different pieces of copper.
 */
export function pendingItems(
  ctx: LegalityContext,
  pending: PendingCopper,
): DrcItems {
  const records = buildCopperRecords({
    layerCount: ctx.layerCount,
    placements: [],
    padNetIds: new Map(),
    freePads: [],
    traces: pending.traces,
    vias: pending.vias,
  });
  return itemsFromRecords(
    records,
    ctx.validCopperLayers,
    ctx.layerCount,
    [],
    [],
    [],
  );
}

/**
 * Rejudge the existing items the pending copper re-tiered or re-exposed (13
 * §4.4): every pair they take part in on the BOARD, and the per-item forms that
 * read the tier net.
 *
 * Their drafts are emitted with the pending copper's — they carry no pending
 * anchor, exactly like a bridge that grew because of the route (07 §4) — and
 * are refused by the same code-based policy, so a newly discovered warning
 * stays a warning. That attribution is only honest because the set is exactly
 * the items whose verdict INPUTS moved: an item whose component merely changed
 * shape resolves every pair to the board's own answer, and re-reporting those
 * made the gate refuse commits over breaches the route never touched (R1 #1).
 */
function rejudgeAffected(
  octx: LegalityContext,
  overlay: EffectiveNetOverlay,
  replaces: ReadonlySet<string>,
  out: DrcViolationDraft[],
): void {
  for (const item of overlay.rejudge) {
    rejudgeItemPairs(octx, item, octx, { replaces, out });
  }
  // The per-item forms that read the tier net (Astra run 1 #8) — over the
  // RETIERED items only, since a per-item verdict is a pure function of the
  // tier and no per-item form reads exposure.
  const traces: DrcTrace[] = [];
  const vias: DrcViaGeom[] = [];
  for (const item of overlay.retiered) {
    if ("pointsMm" in item) traces.push(item);
    else if (!("ring" in item)) vias.push(item);
  }
  if (traces.length === 0 && vias.length === 0) return;
  const retiered: ItemSet = { traces, pads: [], vias };
  netClassItems(octx, retiered, { out });
  currentItems(octx, retiered, { out });
}

/**
 * The verdict on `pending` against the board `ctx` describes: every pair the
 * pending copper takes part in (pending × board honouring `replaces`, and
 * pending × pending), the copper↔NPTH, board-edge, hole and keepout tiers, and
 * the per-item scalars — nothing board-wide (07 §3 states what is excluded and
 * who owns it).
 */
export function checkPendingCopper(
  ctx: LegalityContext,
  pending: PendingCopper,
  options: LegalityOptions = {},
): DrcViolation[] {
  const replaces = new Set(options.replaces ?? []);
  assertPendingIdsAreFree(ctx, pending, replaces);
  const items = pendingItems(ctx, pending);
  const subjects: ItemSet = {
    traces: items.traces,
    pads: [],
    vias: items.vias,
  };
  const withHoles = { ...subjects, holes: items.holes };
  // The effective-net overlay comes FIRST, before any check reads a tier net
  // (13 §4.4): every judgement below runs on the FINAL geometry's tiers.
  const overlay = buildEffectiveNetOverlay(ctx, items, replaces);
  const octx = overlay.context;

  // Broadly the order `runDrc` dispatches in — `currentItems` is the exception,
  // hoisted here beside the other per-item form while the engine runs its
  // `electrical` stage after `dangling`. Nothing depends on it: a draft group
  // hashes to one id per CODE, so the dedupe survivor is the same either way.
  const drafts: DrcViolationDraft[] = [];
  constraintItems(octx, subjects, { out: drafts });
  manufacturabilityItems(octx, withHoles, { out: drafts });
  netClassItems(octx, subjects, { out: drafts });
  currentItems(octx, subjects, { out: drafts });
  judgeCopperPairs(octx, subjects, octx, { replaces, out: drafts });
  copperToHolePairs(octx, subjects, octx.holes, { replaces, out: drafts });
  boardItems(octx, withHoles, { out: drafts });
  holePairs(octx, items.holes, octx.holes, { replaces, out: drafts });
  // Two pending vias of one session are a pair after the commit (07 §4).
  holePairs(octx, items.holes, items.holes, { out: drafts });
  keepoutItems(octx, subjects, { out: drafts });
  rejudgeAffected(octx, overlay, replaces, drafts);
  // A conflict component the pending copper created (§4.3): the route's short,
  // not the board's.
  chainShortDrafts(octx, overlay.newChainShorts, drafts);

  const viewState = ctx.board.viewState;
  return finalizeReport(drafts, {
    // The gate reports about copper, not about a design revision; ids do not
    // hash either field.
    designId: "",
    revision: 0,
    ignoredRuleClasses:
      options.ignoredRuleClasses ?? viewState?.drcIgnoredRuleClasses ?? [],
    waivedIds: options.waivedIds ?? viewState?.drcWaivedViolationIds ?? [],
    severityOverrides:
      options.severityOverrides ?? ctx.board.drcSeverityOverrides,
  }).violations;
}
