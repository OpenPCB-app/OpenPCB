// Pure PCB helpers shared by backend, frontend, and 3D code. No DB / React
// / Three.js dependencies.

import type { PcbPlacedPart } from "./types";

const MAX_BUNDLE_SLUG_LENGTH = 40;

/**
 * Filesystem-safe manufacturing-export bundle name for a design: a slug of the
 * design NAME (what the user and the fab recognise), falling back to
 * `openpcb-<designId>` when the name has no usable characters. Shared by the
 * backend exporter (`buildExportBundle`, the BOM/PnP download routes, the
 * `.gbrjob`) and the frontend download path so the two never diverge — the
 * `X-OpenPCB-Bundle-Name` / `Content-Disposition` headers are not CORS-exposed,
 * so the client recomputes the name and it MUST match the server byte-for-byte.
 */
export function exportBundleName(
  designId: string,
  designName?: string | null,
): string {
  const slug = fileNameSlug(designName ?? "", MAX_BUNDLE_SLUG_LENGTH);
  if (slug.length > 0) return slug;
  return `openpcb-${designId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)}`;
}

/**
 * `Dual LED Blinker (v2)` → `Dual_LED_Blinker_v2`: diacritics folded to ASCII,
 * every run of other characters one `_`, no leading/trailing separator.
 */
function fileNameSlug(text: string, maxLength: number): string {
  const folded = text.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const slug = folded
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
  return slug.slice(0, maxLength).replace(/[_-]+$/g, "");
}

/** The standalone BOM / pick-and-place downloads (BOM view, `exports/*.csv`). */
export type BomExportKind = "csv" | "tsv" | "jlc" | "kicad" | "pnp";

const BOM_EXPORT_SUFFIX: Record<BomExportKind, string> = {
  csv: "BOM.csv",
  tsv: "BOM.tsv",
  jlc: "JLC-BOM.csv",
  kicad: "KiCad-BOM.csv",
  pnp: "PnP.csv",
};

/** `<bundle>-BOM.csv`, `<bundle>-JLC-BOM.csv`, `<bundle>-PnP.csv`, … */
export function bomExportFileName(
  bundleName: string,
  kind: BomExportKind,
): string {
  return `${bundleName}-${BOM_EXPORT_SUFFIX[kind]}`;
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
