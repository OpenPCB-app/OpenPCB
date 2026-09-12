// Component shorts: the `NET_SHORT_CIRCUIT` no single pair and no single
// unassigned item can see (electrical contract 13 §4.3).
//
// The per-item direct bridge emitter (06 §4) reports an unassigned item that
// touches two or more nets ITSELF. It cannot report `A–X–Y–B` — neither X nor Y
// touches two nets — nor `A–X–B` plus a `Y` that brings C into the same piece
// of copper (Astra run 1 #6). Whenever the direct drafts of a conflict
// component do not name every label, this adds ONE draft that does. The direct
// drafts and their ids are untouched.

import type {
  DrcPairKind,
  PcbCopperLayerId,
  PcbPointMm,
} from "../../../sdks/designer";
import type { DrcAnchor } from "../../../sdks/designer";
import {
  copperItemKind,
  copperItemMarker,
  copperItemAnchor,
  sharedCopperLayers,
  type EffectiveComponent,
  type EffectiveNetItem,
} from "../../pcb-connectivity/effective-nets";
import type { LegalityContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";
import { anchorKey } from "../violation-id";
import { netList } from "./clearance-judge";

/** The pair kind of two items, in the canonical trace → pad → via order. */
const PAIR_KIND: Record<string, DrcPairKind> = {
  "trace|trace": "traceToTrace",
  "trace|pad": "traceToPad",
  "trace|via": "traceToVia",
  "pad|pad": "padToPad",
  "pad|via": "padToVia",
  "via|via": "viaToVia",
};

const KIND_RANK = { trace: 0, pad: 1, via: 2 } as const;

interface CrossRequirement {
  mm: number;
  layer: PcbCopperLayerId;
}

/**
 * The largest ORDINARY requirement among the component's cross-net pairs, on
 * the layer they share (§4.3). `null` when the component's named members never
 * share a layer — a chain that shorts `F.Cu` copper to `B.Cu` copper through a
 * via has no one spacing rule to quote, so the draft quotes none (a bridge
 * draft carries no `requiredMm` either).
 *
 * Ties are broken on the layer id, never on member order, so reversing any
 * input array cannot move the reported layer.
 */
function crossNetRequirement(
  ctx: LegalityContext,
  members: readonly EffectiveNetItem[],
): CrossRequirement | null {
  let best: CrossRequirement | null = null;
  for (let i = 0; i < members.length; i += 1) {
    const a = members[i]!;
    if (a.netId === null) continue;
    for (let j = i + 1; j < members.length; j += 1) {
      const b = members[j]!;
      if (b.netId === null || b.netId === a.netId) continue;
      const [u, v] =
        KIND_RANK[copperItemKind(a)] <= KIND_RANK[copperItemKind(b)]
          ? [a, b]
          : [b, a];
      const pairKind =
        PAIR_KIND[`${copperItemKind(u)}|${copperItemKind(v)}`]!;
      const uItem = { netId: u.netId, pointMm: copperItemMarker(u) };
      const vItem = { netId: v.netId, pointMm: copperItemMarker(v) };
      for (const layer of sharedCopperLayers(u, v)) {
        const mm = ctx.resolver.clearance(pairKind, layer, uItem, vItem).mm;
        if (best === null || mm > best.mm || (mm === best.mm && layer < best.layer)) {
          best = { mm, layer };
        }
      }
    }
  }
  return best;
}

/** The component's null members as anchors, deduplicated and sorted (§4.3). */
function nullAnchors(component: EffectiveComponent): DrcAnchor[] {
  const byKey = new Map<string, DrcAnchor>();
  for (const item of component.nullMembers) {
    // One pin is several copper shapes under ONE anchor; the anchor list must
    // name it once.
    const anchor = copperItemAnchor(item);
    const key = anchorKey(anchor);
    if (!byKey.has(key)) byKey.set(key, anchor);
  }
  return [...byKey.keys()].sort().map((k) => byKey.get(k)!);
}

export function chainShortDraft(
  ctx: LegalityContext,
  component: EffectiveComponent,
): DrcViolationDraft {
  const required = crossNetRequirement(ctx, component.members);
  const location: PcbPointMm = component.markerMm;
  return {
    code: "NET_SHORT_CIRCUIT",
    message: `Short circuit: unassigned copper chain bridges nets ${netList(
      component.labels.map((netId) => ctx.netNames[netId] ?? netId),
    )}`,
    anchors: [
      ...nullAnchors(component),
      ...component.labels.map((netId): DrcAnchor => ({ kind: "net", netId })),
    ],
    locationMm: location,
    ...(required ? { layer: required.layer, requiredMm: required.mm } : {}),
    // The chain IS contact all the way through — every edge was ≤ SHORT_EPS.
    measuredMm: 0,
  };
}

/** One draft per component, in the components' own (signature) order. */
export function chainShortDrafts(
  ctx: LegalityContext,
  components: readonly EffectiveComponent[],
  out: DrcViolationDraft[],
): void {
  for (const component of components) out.push(chainShortDraft(ctx, component));
}
