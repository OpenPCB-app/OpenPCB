/**
 * The single geometric tolerance policy for DRC and creation gates
 * (DRC_HARDENING_PLAN.md P1, S2 geometry contract §1). One rule everywhere:
 * exact-spec geometry always passes; deficits/excesses inside the tolerance are
 * float noise, not violations.
 *
 * Floating-point sums like `(0.3 - 0.1) / 2` land at `0.09999999999999999`,
 * which would falsely fail a bare `< 0.1` minimum — and `(0.7 - 0.4) / 2`
 * lands at `0.14999999999999997`, which falsely failed the fab annular
 * validator before P1 (audit B2-1). 1e-6 mm = 1 nm — far below any real DRC
 * value and below the 1 nm coordinate quantum.
 */
export const DRC_EPS_MM = 1e-6;

/**
 * Overlap tolerance for short detection (0.1 µm). Different-net copper closer
 * than this is a dead short regardless of the configured clearance rule.
 */
export const SHORT_EPS_MM = 1e-4;

/** True when `value` is below `limit` by more than the geometric tolerance. */
export function below(value: number, limit: number, eps = DRC_EPS_MM): boolean {
  return value < limit - eps;
}

/** True when `value` exceeds `limit` by more than the geometric tolerance. */
export function exceeds(
  value: number,
  limit: number,
  eps = DRC_EPS_MM,
): boolean {
  return value > limit + eps;
}

/**
 * Boundary / collinearity / containment tolerance — 5e-7 mm, HALF the 1 nm
 * coordinate quantum. Every predicate in the geometry kernel (segment
 * contacts, board-region containment, ring overlap) is closed at this value.
 *
 * Justified on its own terms, not only by the nanometre grid: trace
 * coordinates are integer nanometres (so 0.5 nm is half the smallest
 * expressible gap), but outline coordinates are unquantised millimetre doubles
 * and flattened arc vertices are transcendental. The value sits 3 orders of
 * magnitude below any manufacturable feature and six orders above double
 * rounding noise at board scale (`1e3 mm × 2⁻⁵² ≈ 2e-13 mm`).
 *
 * Collinearity is always a LENGTH, never a raw cross product compared with a
 * constant: `|orient(a, b, c)| <= GEOM_EPS_MM · |b − a|`.
 */
export const GEOM_EPS_MM = 5e-7;

/**
 * The ONE clearance-tier comparison (rule-semantics contract §1, Astra run 1
 * #10). A clearance violation needs a deficit of more than half a nanometre —
 * geometry that meets the rule EXACTLY passes even when the double arithmetic
 * that derived the gap lands a few ulps short: two 0.2 mm traces 0.3 mm apart
 * centre-to-centre have `0.3 − (0.1 + 0.1) === 0.09999999999999998`, which a
 * bare `<` rejects against a 0.1 mm rule at exact physical equality. A 1 nm
 * deficit — the smallest the nanometre coordinate grid can express — still
 * fires, so the grace never forgives a real breach.
 *
 * This is the clearance regime only. Minimums (trace width, drill, annular,
 * hole-to-hole) keep {@link below} with {@link DRC_EPS_MM}; the short tier
 * keeps its own inclusive `gap <= SHORT_EPS_MM`.
 */
export function clearanceViolated(gap: number, requiredMm: number): boolean {
  return gap < requiredMm - GEOM_EPS_MM;
}

/**
 * Contact tolerance for copper connectivity — an alias of {@link GEOM_EPS_MM},
 * kept as its own name because connectivity states the rule differently: exact
 * abutment (a true distance of 0, plus float noise around 1e-12) connects,
 * while the smallest gap the nanometre grid can even express — 1 nm — stays
 * open. It is a float-noise floor, not a physical allowance: copper designed
 * with any expressible gap is open.
 */
export const CONNECT_EPS_MM = GEOM_EPS_MM;
