import type { DrcAnchor, DrcRuleCode } from "../../sdks/designer";

/**
 * Escape the structural separators used by the id scheme (`:` inside a key, `|`
 * between sorted keys, `#` between code and keys) in every dynamic id segment.
 * Without this, distinct anchor sets could alias to the same hash input — e.g.
 * pad `("x","1:2")` vs `("x:1","2")`, or a net id that literally contains `|`.
 */
export function escapeStructuralIdSegment(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\p")
    .replace(/#/g, "\\h")
    .replace(/:/g, "\\c");
}

/**
 * Total, escaped key for one anchor. Exported because it is also the CANONICAL
 * PAIR ORDER of the clearance witness search (rule-semantics contract §11):
 * the item with the smaller key leads, so reordering the input arrays cannot
 * move the reported witness — and with it the id's location bucket.
 */
export function anchorKey(a: DrcAnchor): string {
  switch (a.kind) {
    case "trace":
      return `t:${escapeStructuralIdSegment(a.traceId)}`;
    case "segment":
      return `s:${escapeStructuralIdSegment(a.traceId)}:${a.index}`;
    case "via":
      return `v:${escapeStructuralIdSegment(a.viaId)}`;
    case "pad":
      return `p:${escapeStructuralIdSegment(a.placementId)}:${escapeStructuralIdSegment(
        a.padNumber,
      )}`;
    case "freePad":
      return `fp:${escapeStructuralIdSegment(a.freePadId)}`;
    case "freeHole":
      return `fh:${escapeStructuralIdSegment(a.freeHoleId)}`;
    case "placement":
      return `pl:${escapeStructuralIdSegment(a.placementId)}`;
    case "net":
      return `n:${escapeStructuralIdSegment(a.netId)}`;
    case "zone":
      return `z:${escapeStructuralIdSegment(a.zoneId)}`;
    case "keepout":
      return `k:${escapeStructuralIdSegment(a.keepoutId)}`;
    case "diffPair":
      return `dp:${escapeStructuralIdSegment(a.pNetId)}:${escapeStructuralIdSegment(a.nNetId)}`;
    case "lengthGroup":
      return `lg:${escapeStructuralIdSegment(a.groupId)}`;
    case "rule":
      return `r:${escapeStructuralIdSegment(a.ruleId)}`;
    case "overlayShape":
      return `os:${escapeStructuralIdSegment(a.shapeId)}`;
    case "overlayText":
      return `ot:${escapeStructuralIdSegment(a.textId)}`;
    case "boardEdge":
      return "be";
  }
}

/**
 * 64-bit FNV-1a (canonical basis/prime), emitted as 16 hex chars. Wider than
 * the prior 32-bit lane so dense boards keep negligible id-collision odds.
 */
export function fnv1a64(s: string): string {
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
 * Codes that can fire more than once between the same anchor pair (distinct
 * hot-spots), so their v2 id includes a quantized location bucket + layer to
 * keep spots distinct and to expire a waiver when the offending geometry moves
 * to a different spot (audit B5-WAIVER-DRIFT). Excluded: UNCONNECTED_NET
 * (airwire midpoint volatile per routing) and ISOLATED_COPPER_ISLAND (pour
 * recompute jitter — layer alone suffices, fixing B3-7), and single-item codes
 * whose anchors are already unique.
 */
const LOCATION_HASHED_CODES = new Set<DrcRuleCode>([
  "TRACE_TO_TRACE_CLEARANCE",
  "TRACE_TO_PAD_CLEARANCE",
  "TRACE_TO_VIA_CLEARANCE",
  "VIA_TO_VIA_CLEARANCE",
  "PAD_TO_PAD_CLEARANCE",
  "PAD_TO_VIA_CLEARANCE",
  "NET_SHORT_CIRCUIT",
  "FAB_CLEARANCE",
  "HOLE_TO_HOLE",
  "FAB_HOLE_TO_HOLE",
  // Several hits on the outline / cutout set share the single `boardEdge`
  // anchor, so only the location keeps them apart.
  "OUTLINE_INTERNAL_RADIUS",
  "OUTLINE_SLOT_WIDTH",
  "BOARD_OUTLINE_INVALID",
  // DFM overlays (DFM contract 11 §7). One placement pair, one silk source or
  // one opening pair is ONE anchor set, and every one of them can hit at
  // several distinct spots — two courtyards that overlap in two lobes, a silk
  // polyline that crosses two edges of one mask opening, a pad pair whose dam
  // narrows at both ends. Only the location keeps those apart.
  // COURTYARD_INVALID is deliberately absent: it is one verdict per placement.
  "COURTYARD_OVERLAP",
  "SILK_TO_MASK_CLEARANCE",
  "SILK_TO_BOARD_EDGE",
  "FAB_SILK_CLEARANCE",
  "MASK_BRIDGE",
  "FAB_MASK_BRIDGE",
  "MASK_SLIVER",
  "FAB_MASK_TO_COPPER",
  // Copper shape (DFM contract 11 §7): one net on one layer is ONE anchor, so
  // only the location keeps two necks / slivers / wedges apart. These are
  // pour-derived, so an unrelated edit that moves a pour vertex can move a
  // location across a bucket and re-id a waiver — the mirror image of
  // ISOLATED_COPPER_ISLAND's choice not to hash, recorded in §10.
  // COPPER_SHAPE_UNCHECKED is deliberately absent: it is one verdict per unit.
  "COPPER_CONNECTION_WIDTH",
  "COPPER_SLIVER",
  "TRACE_ACUTE_ANGLE",
  "TRACE_OVERLAP",
]);

/** 0.1 mm bucket: same-spot evolution keeps a waiver, a real move expires it. */
const LOCATION_BUCKET_MM = 0.1;

interface ViolationIdInput {
  code: DrcRuleCode;
  anchors: readonly DrcAnchor[];
  layer?: string;
  locationMm?: { x: number; y: number };
}

/**
 * Stable, order-independent violation id (v2). Anchor keys are sorted so a
 * pairwise violation (A,B) hashes identically to (B,A). The layer enters the
 * hash whenever set (fixes cross-layer id collisions, B3-7); a 0.1 mm-bucketed
 * location enters only for hot-spot-capable codes (B5-WAIVER-DRIFT). The
 * measured value is deliberately NOT hashed — that would expire waivers on
 * every µm-scale edit (KiCad likewise keys exclusions by identity, not value).
 */
export function computeViolationId(input: ViolationIdInput): string;
export function computeViolationId(
  code: DrcRuleCode,
  anchors: readonly DrcAnchor[],
): string;
export function computeViolationId(
  a: DrcRuleCode | ViolationIdInput,
  b?: readonly DrcAnchor[],
): string {
  const input: ViolationIdInput =
    typeof a === "string" ? { code: a, anchors: b ?? [] } : a;
  const { code, anchors, layer, locationMm } = input;
  const keys = anchors.map(anchorKey).sort().join("|");
  const layerSeg = layer ? escapeStructuralIdSegment(layer) : "-";
  let locSeg = "-";
  if (locationMm && LOCATION_HASHED_CODES.has(code)) {
    const qx = Math.round(locationMm.x / LOCATION_BUCKET_MM);
    const qy = Math.round(locationMm.y / LOCATION_BUCKET_MM);
    locSeg = `${qx},${qy}`;
  }
  return `${code}-v2-${fnv1a64(`v2|${code}#${keys}#L:${layerSeg}#Q:${locSeg}`)}`;
}
