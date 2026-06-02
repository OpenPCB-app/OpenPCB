// Pure PCB helpers shared by backend, frontend, and 3D code. No DB / React
// / Three.js dependencies.

import type { PcbPlacedPart } from "./types";

/**
 * Filesystem-safe manufacturing-export bundle name for a design. Shared by the
 * backend exporter (`buildExportBundle`) and the frontend download path so the
 * two never diverge — the `X-OpenPCB-Bundle-Name` response header is not
 * CORS-exposed, so the client recomputes the name and it MUST match the server
 * byte-for-byte.
 */
export function exportBundleName(designId: string): string {
  const safe = designId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
  return `openpcb-${safe}`;
}

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
