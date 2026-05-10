// Pure PCB helpers shared by backend, frontend, and 3D code. No DB / React
// / Three.js dependencies.

import type { PcbPlacedPart } from "./types";

/**
 * Effective X-mirror flag for a placement: true when either `mirrored=true`
 * OR the placement is on the bottom copper layer. Mirrors the canonical 3D
 * formula in `three-d/transform-helpers.ts` and the 2D `PlacementRender`
 * scale-X calculation. Use this everywhere a pad/footprint is transformed
 * into board coordinates so 2D, 3D, hit-testing, and DRC stay in lockstep.
 */
export function placementMirrorX(placement: PcbPlacedPart): boolean {
  return placement.mirrored || placement.layer === "B.Cu";
}
