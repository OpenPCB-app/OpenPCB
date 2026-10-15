/**
 * Geometric identity of a footprint's pads (H15 §3.2). Qualification compares
 * the pads actually stored or placed against the accepted / legacy fingerprint
 * tables, so neither `raw.source`, `sourceKind` nor any generator claim can buy
 * a verdict — only the geometry the Gerber writes can.
 *
 * Every field is read structurally: the pinned `@openpcb/rendering-core` pad
 * type lacks `plated`, `drillSlotMm`, `drillOffsetMm` and `layers`, and stored
 * JSON may carry anything.
 */
import { createHash } from "node:crypto";

/** Coordinates are quantised to 1e-6 mm, i.e. emitted as integer nanometres. */
const QUANTUM_PER_MM = 1e6;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const quantised = Math.round(value * QUANTUM_PER_MM);
  // -0 and 0 must hash identically.
  return quantised === 0 ? 0 : quantised;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function pair(
  value: unknown,
  a: string,
  b: string,
): { [key: string]: number | null } | null {
  const r = record(value);
  return r ? { [a]: num(r[a]), [b]: num(r[b]) } : null;
}

interface PadProjection {
  n: string | null;
  s: string | null;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  r: number | null;
  rr: number | null;
  d: number | null;
  ds: { [key: string]: number | null } | null;
  do: { [key: string]: number | null } | null;
  p: boolean | null;
  l: string | null;
  ls: string[] | null;
}

function project(pad: unknown): PadProjection | null {
  const p = record(pad);
  if (!p) return null;
  const center = record(p.centerMm);
  const drill = num(p.drillDiameterMm);
  const drilled = drill !== null && drill > 0;
  const layers = Array.isArray(p.layers)
    ? p.layers.filter((layer): layer is string => typeof layer === "string").sort()
    : null;
  // Key order is fixed by this literal; JSON.stringify preserves it.
  return {
    n: str(p.number),
    s: str(p.shape),
    x: num(center?.x),
    y: num(center?.y),
    w: num(p.widthMm),
    h: num(p.heightMm),
    r: num(p.rotationDeg),
    rr: num(p.roundrectRatio),
    d: drill,
    ds: pair(p.drillSlotMm, "widthMm", "heightMm"),
    do: pair(p.drillOffsetMm, "x", "y"),
    p: drilled ? p.plated !== false : null,
    l: str(p.layer),
    ls: layers,
  };
}

function compareNullable<T extends string | number>(a: T | null, b: T | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/**
 * sha256 over the canonical projection of the pads the Gerber writes: per pad
 * `{n, s, x, y, w, h, r, rr, d, ds, do, p, l, ls}` (`p` only for drilled pads,
 * `ls` sorted), numbers quantised to 1e-6 mm, pads sorted by (n, x, y) with
 * the full projection as the final tie-break, keys in fixed order. Pad `id`
 * is excluded: it never reaches the fab.
 */
export function padGeometryFingerprint(pads: readonly unknown[]): string {
  const rows = pads.map((pad) => {
    const projection = project(pad);
    return { projection, json: JSON.stringify(projection) };
  });
  rows.sort((a, b) => {
    const pa = a.projection;
    const pb = b.projection;
    if (!pa || !pb) return pa === pb ? 0 : pa ? 1 : -1;
    return (
      compareNullable(pa.n, pb.n) ||
      compareNullable(pa.x, pb.x) ||
      compareNullable(pa.y, pb.y) ||
      compareNullable(a.json, b.json)
    );
  });
  return createHash("sha256")
    .update(`[${rows.map((row) => row.json).join(",")}]`)
    .digest("hex");
}
