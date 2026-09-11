/**
 * THE reader of a RAW (KiCad-parsed) footprint graphic's geometry.
 *
 * `library_footprints.data_json.raw.graphics` is written verbatim from
 * `parseKicadFootprint`, whose `nodeToRecord` keeps the s-expression's own
 * shape: a point is the ARRAY `[x, y]`, not `{ x, y }`, and an `fp_poly`'s
 * vertices arrive as `pts: [["xy", x, y], …]` — each entry tagged with the
 * node name that produced it. A real row:
 *
 * ```json
 * { "type": "rect", "layer": "F.CrtYd",
 *   "data": { "start": [9.92, 10], "end": [-4.18, -10] } }
 * ```
 *
 * Both raw-courtyard readers (the S4 hull in `courtyard.ts` and the S12 region
 * builder in `courtyard-rings.ts`) used to read `data.start.x`, which is
 * `undefined` for every one of those rows — so the raw path silently produced
 * nothing and every KiCad-imported placement fell through to its bounds. One
 * normaliser, so the two cannot disagree again.
 */
import type { PcbPointMm } from "../../sdks";

/**
 * One raw point, or `null` when the value is not a usable one.
 *
 * Accepts the two shapes a persisted row can hold: the parser's `[x, y]` (and
 * the tagged `["xy", x, y]` an `fp_poly` vertex carries) and the `{ x, y }` a
 * hand-written or re-serialised row may carry. Non-finite coordinates are
 * rejected rather than propagated — a NaN vertex poisons every downstream
 * boolean.
 */
export function rawPointMm(value: unknown): PcbPointMm | null {
  if (Array.isArray(value)) {
    // `["xy", x, y]` — the tag the s-expression node was named after.
    const offset = typeof value[0] === "string" ? 1 : 0;
    return finitePoint(value[offset], value[offset + 1]);
  }
  if (typeof value === "object" && value !== null) {
    const v = value as { x?: unknown; y?: unknown };
    return finitePoint(v.x, v.y);
  }
  return null;
}

function finitePoint(x: unknown, y: unknown): PcbPointMm | null {
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * The vertex list of a raw `poly` graphic. KiCad names it `pts`; a
 * re-serialised row may name it `points`. Unusable vertices are dropped, so a
 * partially corrupt polygon degrades to the part that parsed rather than to
 * nothing.
 */
export function rawPolyPoints(data: Record<string, unknown>): PcbPointMm[] {
  const raw = Array.isArray(data.pts)
    ? data.pts
    : Array.isArray(data.points)
      ? data.points
      : null;
  if (!raw) return [];
  const out: PcbPointMm[] = [];
  for (const entry of raw) {
    const p = rawPointMm(entry);
    if (p) out.push(p);
  }
  return out;
}
