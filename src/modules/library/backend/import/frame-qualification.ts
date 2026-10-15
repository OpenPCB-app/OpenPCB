/**
 * Installed-package frame detection (H13 §3.2.4, KF1).
 *
 * Reads `KICAD_FOOTPRINT_TRANSFORM_VERSION` off the installed
 * `@openpcb/kicad-import` structurally, so this file typechecks against the
 * pinned 0.1.2 (which predates the K→C conversion and exports no such constant).
 */
import * as kicadImport from "@openpcb/kicad-import";
import type { FootprintFrameProvenance } from "../../../../sdks/library/types";
import {
  QUALIFIED_KICAD_TRANSFORM_VERSIONS,
  parseFootprintFrame,
} from "../../../../shared/pcb-geometry/footprint-frame";

/** The K→C transform version of the installed package, or null when it has none. */
export function installedKicadTransformVersion(): number | null {
  const v = (kicadImport as unknown as Record<string, unknown>)[
    "KICAD_FOOTPRINT_TRANSFORM_VERSION"
  ];
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

/** Reads the producer stamp from a server-built preview (never from a client payload). */
export function readPreviewFrame(
  preview: unknown,
): FootprintFrameProvenance | null {
  if (typeof preview !== "object" || preview === null) return null;
  return parseFootprintFrame((preview as { frame?: unknown }).frame);
}

export function isKicadConversionQualified(): boolean {
  return QUALIFIED_KICAD_TRANSFORM_VERSIONS.includes(
    installedKicadTransformVersion() ?? -1,
  );
}
