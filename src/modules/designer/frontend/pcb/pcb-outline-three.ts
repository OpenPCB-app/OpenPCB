import * as THREE from "three";
import type {
  PcbBoardCutoutShape,
  PcbBoardOutline,
  PcbPointMm,
} from "../../../../sdks";
import { flattenOutline } from "../../backend/pcb/outline-geometry";

/**
 * THREE adapters for board outlines. Geometry is shared via the pure
 * `flattenOutline` so the 2D canvas, hit-testing, and export all agree on the
 * same point set (arcs already discretised). Centered around the world origin
 * unless `originMm` is given for a local-space (group-offset) build.
 */

/** Closed line-segment points (pairs) for a `<lineSegments>` outline render. */
export function outlineToLinePoints(outline: PcbBoardOutline): THREE.Vector3[] {
  const ring = flattenOutline(outline);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    out.push(new THREE.Vector3(a.x, a.y, 0), new THREE.Vector3(b.x, b.y, 0));
  }
  return out;
}

function ringToPath(
  ring: PcbPointMm[],
  originMm: PcbPointMm,
  path: THREE.Path,
): void {
  if (ring.length === 0) return;
  path.moveTo(ring[0]!.x - originMm.x, ring[0]!.y - originMm.y);
  for (let i = 1; i < ring.length; i += 1) {
    path.lineTo(ring[i]!.x - originMm.x, ring[i]!.y - originMm.y);
  }
  path.closePath();
}

/**
 * Build a filled `THREE.Shape` for the board substrate. Points are expressed in
 * local space relative to `originMm` (typically the outline center, used as the
 * mesh group offset).
 */
export function outlineToShape(
  outline: PcbBoardOutline,
  originMm: PcbPointMm,
): THREE.Shape {
  const shape = new THREE.Shape();
  ringToPath(flattenOutline(outline), originMm, shape);
  return shape;
}

/** Build a `THREE.Path` hole for a cutout, in the same local space. */
export function cutoutToPath(
  shape: PcbBoardCutoutShape,
  originMm: PcbPointMm,
): THREE.Path {
  const path = new THREE.Path();
  ringToPath(flattenOutline(shape), originMm, path);
  return path;
}
