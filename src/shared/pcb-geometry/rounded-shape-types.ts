import type { PcbPointMm } from "../../sdks/designer";

/**
 * A copper silhouette as a convex core ⊕ a disc (exact-geometry contract 12 §1):
 * circle = one point, oval / trace = a two-point spine, roundrect = the four
 * inner corners, rect / polygon pad = its ring with radius 0. World millimetres.
 * The filled-set distance between two rounded shapes is
 * `max(0, convexDistance(coreA, coreB) − rA − rB)`, exact in real arithmetic.
 */
export interface RoundedShape {
  readonly core: readonly PcbPointMm[];
  readonly radiusMm: number;
}
