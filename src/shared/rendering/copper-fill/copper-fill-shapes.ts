import * as THREE from "three";
import type { PcbPointMm } from "../../../sdks";
import type { CopperFillIsland } from "./copper-fill-geometry";

/**
 * The THREE view onto the pour kernel (copper-pour contract §8): one
 * `THREE.Shape` per island, holes attached as `THREE.Path`s.
 *
 * This is the ONLY file under `copper-fill/` that imports `three` — the kernel
 * itself runs on the Bun backend (Gerber, snapshot, DRC, connectivity), where
 * pulling a renderer in was both dead weight and a boundary violation.
 */
export function islandsToShapes(
  islands: ReadonlyArray<CopperFillIsland>,
): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];
  for (const island of islands) {
    const [outer, ...holes] = island.rings;
    if (!outer || outer.length < 3) continue;
    const shape = new THREE.Shape();
    traceRing(shape, outer);
    for (const hole of holes) {
      if (hole.length < 3) continue;
      const path = new THREE.Path();
      traceRing(path, hole);
      shape.holes.push(path);
    }
    shapes.push(shape);
  }
  return shapes;
}

function traceRing(
  target: THREE.Shape | THREE.Path,
  ring: ReadonlyArray<PcbPointMm>,
): void {
  const first = ring[0]!;
  target.moveTo(first.x, first.y);
  for (let i = 1; i < ring.length; i += 1) {
    const p = ring[i]!;
    target.lineTo(p.x, p.y);
  }
}
