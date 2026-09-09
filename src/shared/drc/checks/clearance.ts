// The copper clearance check: the SIX batch loops (unchanged) plus the general
// subject-set form `judgeCopperPairs` the live gate runs (live-parity contract
// 07 §2 D3). Both go through the ONE set of per-pair bodies in
// `clearance-judge.ts`; batch is not a special case of the general form and the
// general form is not a second implementation — they are two enumerations over
// the same bodies.

import type { RingBounds } from "../../pcb-geometry/pad-outline";
import {
  layersOverlap,
  type DrcContext,
  type DrcPad,
  type DrcTrace,
  type DrcViaGeom,
  type LegalityContext,
} from "../drc-context";
import type { DrcViolationDraft } from "../types";
import { anchorKey } from "../violation-id";
import {
  bridgeDraft,
  createPairJudge,
  markerBefore,
  sameNet,
  type BridgeEntry,
  type BridgeMap,
  type ItemSet,
  type PairJudge,
} from "./clearance-judge";

export type {
  BridgeEntry,
  BridgeMap,
  ItemSet,
  PairJudge,
} from "./clearance-judge";
export { createPairJudge } from "./clearance-judge";

export function checkClearance(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const judge = createPairJudge(ctx, out);

  // --- trace ↔ trace (same layer) ---
  for (let i = 0; i < ctx.traces.length; i += 1) {
    const a = ctx.traces[i]!;
    if (a.pointsMm.length < 2) continue;
    for (let j = i + 1; j < ctx.traces.length; j += 1) {
      const b = ctx.traces[j]!;
      if (b.pointsMm.length < 2) continue;
      if (a.layer !== b.layer) continue;
      if (sameNet(a.netId, b.netId)) continue;
      if (judge.farApart(a.bounds, b.bounds, "traceToTrace", a.netId, b.netId)) {
        continue;
      }
      judge.traceTrace(a, b);
    }
  }

  // --- trace ↔ pad (pad occupies the trace's layer) ---
  for (const t of ctx.traces) {
    if (t.pointsMm.length < 2) continue;
    for (const pad of ctx.pads) {
      if (!pad.layers.includes(t.layer)) continue;
      if (sameNet(t.netId, pad.netId)) continue;
      if (judge.farApart(t.bounds, pad.bounds, "traceToPad", t.netId, pad.netId)) {
        continue;
      }
      judge.tracePad(t, pad);
    }
  }

  // --- trace ↔ via (via barrel crosses the trace's layer) ---
  for (const t of ctx.traces) {
    if (t.pointsMm.length < 2) continue;
    for (const vg of ctx.vias) {
      if (!vg.layers.includes(t.layer)) continue;
      if (sameNet(t.netId, vg.netId)) continue;
      if (judge.farApart(t.bounds, vg.bounds, "traceToVia", t.netId, vg.netId)) {
        continue;
      }
      judge.traceVia(t, vg);
    }
  }

  // --- via ↔ via (P2) ---
  for (let i = 0; i < ctx.vias.length; i += 1) {
    const a = ctx.vias[i]!;
    for (let j = i + 1; j < ctx.vias.length; j += 1) {
      const b = ctx.vias[j]!;
      if (!layersOverlap(a.layers, b.layers)) continue;
      if (sameNet(a.netId, b.netId)) continue;
      if (judge.farApart(a.bounds, b.bounds, "viaToVia", a.netId, b.netId)) continue;
      judge.viaVia(a, b);
    }
  }

  // --- pad ↔ pad (P2). Pads of the SAME footprint run the short tier ONLY:
  // intra-footprint spacing is the library's responsibility, a different-net
  // overlap inside a footprint is still a dead short (contract 06 §4) — the
  // judge owns that skip, so both enumerations get it. ---
  for (let i = 0; i < ctx.pads.length; i += 1) {
    const a = ctx.pads[i]!;
    for (let j = i + 1; j < ctx.pads.length; j += 1) {
      const b = ctx.pads[j]!;
      if (!layersOverlap(a.layers, b.layers)) continue;
      if (sameNet(a.netId, b.netId)) continue;
      if (judge.farApart(a.bounds, b.bounds, "padToPad", a.netId, b.netId)) continue;
      judge.padPad(a, b);
    }
  }

  // --- pad ↔ via (P2). Via barrel crosses a copper layer the pad occupies, on
  // different nets. ---
  for (const pad of ctx.pads) {
    for (const vg of ctx.vias) {
      if (!layersOverlap(pad.layers, vg.layers)) continue;
      if (sameNet(pad.netId, vg.netId)) continue;
      if (judge.farApart(pad.bounds, vg.bounds, "padToVia", pad.netId, vg.netId)) {
        continue;
      }
      judge.padVia(pad, vg);
    }
  }

  // --- null-net bridges (contract 06 §4) ---
  judge.flushBridges();

  return out;
}

// --- the general subject-set form ------------------------------------------

type ItemKind = "traces" | "pads" | "vias";

/** Candidate indices into `others[kind]` — the grid, or every index. */
type Pick = (kind: ItemKind, count: number, bounds: RingBounds) => readonly number[];

function allIndices(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(i);
  return out;
}

const ALL_PICK: Pick = (_kind, count) => allIndices(count);

function judgeTraceAgainst(
  judge: PairJudge,
  t: DrcTrace,
  others: ItemSet,
  pick: Pick,
  replaces?: ReadonlySet<string>,
): void {
  if (t.pointsMm.length < 2) return;
  for (const i of pick("traces", others.traces.length, t.bounds)) {
    const b = others.traces[i]!;
    if (b === t) continue;
    if (replaces?.has(b.id)) continue;
    if (b.pointsMm.length < 2) continue;
    if (t.layer !== b.layer) continue;
    if (sameNet(t.netId, b.netId)) continue;
    if (judge.farApart(t.bounds, b.bounds, "traceToTrace", t.netId, b.netId)) {
      continue;
    }
    judge.traceTrace(t, b);
  }
  for (const i of pick("pads", others.pads.length, t.bounds)) {
    const pad = others.pads[i]!;
    if (!pad.layers.includes(t.layer)) continue;
    if (sameNet(t.netId, pad.netId)) continue;
    if (judge.farApart(t.bounds, pad.bounds, "traceToPad", t.netId, pad.netId)) {
      continue;
    }
    judge.tracePad(t, pad);
  }
  for (const i of pick("vias", others.vias.length, t.bounds)) {
    const vg = others.vias[i]!;
    if (replaces?.has(vg.via.id)) continue;
    if (!vg.layers.includes(t.layer)) continue;
    if (sameNet(t.netId, vg.netId)) continue;
    if (judge.farApart(t.bounds, vg.bounds, "traceToVia", t.netId, vg.netId)) {
      continue;
    }
    judge.traceVia(t, vg);
  }
}

function judgeViaAgainst(
  judge: PairJudge,
  vg: DrcViaGeom,
  others: ItemSet,
  pick: Pick,
  replaces?: ReadonlySet<string>,
): void {
  for (const i of pick("traces", others.traces.length, vg.bounds)) {
    const t = others.traces[i]!;
    if (replaces?.has(t.id)) continue;
    if (t.pointsMm.length < 2) continue;
    if (!vg.layers.includes(t.layer)) continue;
    if (sameNet(t.netId, vg.netId)) continue;
    if (judge.farApart(t.bounds, vg.bounds, "traceToVia", t.netId, vg.netId)) {
      continue;
    }
    judge.traceVia(t, vg);
  }
  for (const i of pick("pads", others.pads.length, vg.bounds)) {
    const pad = others.pads[i]!;
    if (!layersOverlap(pad.layers, vg.layers)) continue;
    if (sameNet(pad.netId, vg.netId)) continue;
    if (judge.farApart(pad.bounds, vg.bounds, "padToVia", pad.netId, vg.netId)) {
      continue;
    }
    judge.padVia(pad, vg);
  }
  for (const i of pick("vias", others.vias.length, vg.bounds)) {
    const b = others.vias[i]!;
    if (b === vg) continue;
    if (replaces?.has(b.via.id)) continue;
    if (!layersOverlap(vg.layers, b.layers)) continue;
    if (sameNet(vg.netId, b.netId)) continue;
    if (judge.farApart(vg.bounds, b.bounds, "viaToVia", vg.netId, b.netId)) {
      continue;
    }
    judge.viaVia(vg, b);
  }
}

function judgePadAgainst(
  judge: PairJudge,
  pad: DrcPad,
  others: ItemSet,
  pick: Pick,
  replaces?: ReadonlySet<string>,
): void {
  for (const i of pick("traces", others.traces.length, pad.bounds)) {
    const t = others.traces[i]!;
    if (replaces?.has(t.id)) continue;
    if (t.pointsMm.length < 2) continue;
    if (!pad.layers.includes(t.layer)) continue;
    if (sameNet(t.netId, pad.netId)) continue;
    if (judge.farApart(t.bounds, pad.bounds, "traceToPad", t.netId, pad.netId)) {
      continue;
    }
    judge.tracePad(t, pad);
  }
  for (const i of pick("pads", others.pads.length, pad.bounds)) {
    const b = others.pads[i]!;
    if (b === pad) continue;
    if (!layersOverlap(pad.layers, b.layers)) continue;
    if (sameNet(pad.netId, b.netId)) continue;
    if (judge.farApart(pad.bounds, b.bounds, "padToPad", pad.netId, b.netId)) {
      continue;
    }
    judge.padPad(pad, b);
  }
  for (const i of pick("vias", others.vias.length, pad.bounds)) {
    const vg = others.vias[i]!;
    if (replaces?.has(vg.via.id)) continue;
    if (!layersOverlap(pad.layers, vg.layers)) continue;
    if (sameNet(pad.netId, vg.netId)) continue;
    if (judge.farApart(pad.bounds, vg.bounds, "padToVia", pad.netId, vg.netId)) {
      continue;
    }
    judge.padVia(pad, vg);
  }
}

/** Every unordered subject × subject pair, each judged exactly once (07 §4). */
function judgeWithinSubjects(judge: PairJudge, subjects: ItemSet): void {
  for (let i = 0; i < subjects.traces.length; i += 1) {
    judgeTraceAgainst(
      judge,
      subjects.traces[i]!,
      {
        traces: subjects.traces.slice(i + 1),
        pads: subjects.pads,
        vias: subjects.vias,
      },
      ALL_PICK,
    );
  }
  for (let i = 0; i < subjects.vias.length; i += 1) {
    // Traces are empty: trace × via was covered above.
    judgeViaAgainst(
      judge,
      subjects.vias[i]!,
      { traces: [], pads: subjects.pads, vias: subjects.vias.slice(i + 1) },
      ALL_PICK,
    );
  }
  for (let i = 0; i < subjects.pads.length; i += 1) {
    // Traces and vias are empty: both cross pairs were covered above.
    judgePadAgainst(
      judge,
      subjects.pads[i]!,
      { traces: [], pads: subjects.pads.slice(i + 1), vias: [] },
      ALL_PICK,
    );
  }
}

type KeyedItem =
  | { kind: "trace"; item: DrcTrace }
  | { kind: "pad"; item: DrcPad }
  | { kind: "via"; item: DrcViaGeom };

/**
 * Every board item sharing one logical anchor key — a pin is several `DrcPad`
 * shapes under ONE key, and batch's `recordBridge` aggregates all of them, so a
 * completion that stopped at the shape a subject touched would under-count the
 * pin's pre-existing nets and attribute a pre-existing bridge to the route.
 *
 * Read from the context's memoised index when `others` IS the board (Astra
 * R2 #3); the linear scan stays for any other item set.
 */
function boardItemsForKey(
  ctx: LegalityContext,
  others: ItemSet,
  key: string,
  replaces: ReadonlySet<string> | undefined,
): KeyedItem[] {
  const out: KeyedItem[] = [];
  if (
    others.traces === ctx.traces &&
    others.pads === ctx.pads &&
    others.vias === ctx.vias
  ) {
    const entry = ctx.itemsByAnchorKey().get(key);
    if (!entry) return out;
    for (const i of entry.traces) {
      const t = ctx.traces[i]!;
      if (!replaces?.has(t.id)) out.push({ kind: "trace", item: t });
    }
    for (const i of entry.pads) out.push({ kind: "pad", item: ctx.pads[i]! });
    for (const i of entry.vias) {
      const v = ctx.vias[i]!;
      if (!replaces?.has(v.via.id)) out.push({ kind: "via", item: v });
    }
    return out;
  }
  for (const t of others.traces) {
    if (replaces?.has(t.id)) continue;
    if (anchorKey({ kind: "trace", traceId: t.id }) === key) {
      out.push({ kind: "trace", item: t });
    }
  }
  for (const p of others.pads) {
    if (anchorKey(p.anchor) === key) out.push({ kind: "pad", item: p });
  }
  for (const v of others.vias) {
    if (replaces?.has(v.via.id)) continue;
    if (anchorKey({ kind: "via", viaId: v.via.id }) === key) {
      out.push({ kind: "via", item: v });
    }
  }
  return out;
}

/**
 * The board-side touches of one unassigned board item: what its net set was
 * BEFORE the pending copper (07 §4). `null` when it touches no named copper.
 */
function boardBridgeTouches(
  ctx: LegalityContext,
  others: ItemSet,
  pick: Pick,
  key: string,
  replaces: ReadonlySet<string> | undefined,
): BridgeEntry | null {
  const found: BridgeMap = new Map();
  const completion = createPairJudge(ctx, [], {
    bridges: found,
    recordOnly: true,
  });
  for (const ref of boardItemsForKey(ctx, others, key, replaces)) {
    if (ref.kind === "trace") {
      judgeTraceAgainst(completion, ref.item, others, pick, replaces);
    } else if (ref.kind === "via") {
      judgeViaAgainst(completion, ref.item, others, pick, replaces);
    } else {
      judgePadAgainst(completion, ref.item, others, pick, replaces);
    }
  }
  return found.get(key) ?? null;
}

function subjectAnchorKeys(subjects: ItemSet): Set<string> {
  const keys = new Set<string>();
  for (const t of subjects.traces) {
    keys.add(anchorKey({ kind: "trace", traceId: t.id }));
  }
  for (const p of subjects.pads) keys.add(anchorKey(p.anchor));
  for (const v of subjects.vias) {
    keys.add(anchorKey({ kind: "via", viaId: v.via.id }));
  }
  return keys;
}

/**
 * Bridge attribution (07 §1 `touch`, §4): a SUBJECT that bridges two nets is
 * the route's own short; a BOARD item is the route's only when its net set GREW
 * because of the pending copper — an unassigned board item that already bridged
 * two nets is pre-existing and belongs to the batch report, not to the gate.
 */
function emitBridges(
  ctx: LegalityContext,
  judge: PairJudge,
  subjects: ItemSet,
  others: ItemSet,
  pick: Pick,
  replaces: ReadonlySet<string> | undefined,
  cacheable: boolean,
  out: DrcViolationDraft[],
): void {
  const subjectKeys = subjectAnchorKeys(subjects);
  for (const key of [...judge.bridges.keys()].sort()) {
    const entry = judge.bridges.get(key)!;
    if (subjectKeys.has(key)) {
      if (entry.nets.size >= 2) {
        out.push(bridgeDraft(ctx.netNames, entry.side, entry.nets));
      }
      continue;
    }
    // The board item's own touches are a function of the board alone, so they
    // are memoised per context (07 §7) — but only when nothing is replaced,
    // since `replaces` changes what the board is.
    let boardEntry = cacheable ? ctx.boardBridgeCache.get(key) : undefined;
    if (boardEntry === undefined) {
      boardEntry = boardBridgeTouches(ctx, others, pick, key, replaces);
      if (cacheable) ctx.boardBridgeCache.set(key, boardEntry);
    }
    const boardNets = boardEntry?.nets;
    const allNets = new Set(entry.nets);
    if (boardNets) for (const n of boardNets) allNets.add(n);
    if (allNets.size < 2 || allNets.size <= (boardNets?.size ?? 0)) continue;
    let side = entry.side;
    if (boardEntry && markerBefore(boardEntry.side.marker, side.marker)) {
      side = boardEntry.side;
    }
    out.push(bridgeDraft(ctx.netNames, side, allNets));
  }
}

/**
 * Every copper pair a pending item takes part in — pending × board (through the
 * broad phase, honouring `replaces`) and pending × pending — judged by the SAME
 * bodies the batch loops call, then the null-net bridge pass of 07 §4.
 *
 * `replaces` filters the BOARD side only: a tune's pending trace legitimately
 * carries the id of the board trace it replaces, and filtering the subject set
 * by it would judge nothing at all.
 */
export function judgeCopperPairs(
  ctx: LegalityContext,
  subjects: ItemSet,
  others: ItemSet,
  opts: { replaces?: ReadonlySet<string>; out: DrcViolationDraft[] },
): void {
  const judge = createPairJudge(ctx, opts.out);
  const replaces =
    opts.replaces && opts.replaces.size > 0 ? opts.replaces : undefined;
  // The grid indexes the CONTEXT's arrays; any other `others` falls back to the
  // full scan, which the exact `farApart` filter below makes equivalent.
  const gridded =
    others.traces === ctx.traces &&
    others.pads === ctx.pads &&
    others.vias === ctx.vias;
  const pick: Pick = gridded
    ? (kind, _count, bounds) => ctx.near(kind, bounds, ctx.maxClearanceBoundMm)
    : ALL_PICK;

  for (const t of subjects.traces) judgeTraceAgainst(judge, t, others, pick, replaces);
  for (const vg of subjects.vias) judgeViaAgainst(judge, vg, others, pick, replaces);
  for (const pad of subjects.pads) judgePadAgainst(judge, pad, others, pick, replaces);
  judgeWithinSubjects(judge, subjects);

  emitBridges(
    ctx,
    judge,
    subjects,
    others,
    pick,
    replaces,
    gridded && replaces === undefined,
    opts.out,
  );
}
