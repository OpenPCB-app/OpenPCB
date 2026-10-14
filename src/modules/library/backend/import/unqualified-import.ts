import { AppError } from "../../../../core/contracts/errors";
import { isFeatureEnabled } from "../../../../core/contracts/feature-flags/backend";
import { FOOTPRINT_IMPORT_UNAVAILABLE } from "../../shared/import-policy";
import { readAssetJson } from "../sync/opclib-reader";
import type { OpclibPackage } from "../sync/types";

type ImportSource = "kicad_mod" | "kicad_zip" | "opclib";
type Marker = { value: string; truncated: boolean };
interface AffectedFootprint {
  id: string;
  classification: "kicad-derived" | "unverified";
  markers: Record<string, Marker>;
}

const MAX_DIAGNOSTICS = 20;
const MAX_MARKER_LENGTH = 256;

export class UnqualifiedImportError extends AppError {
  constructor(
    source: ImportSource,
    count: number,
    affected: AffectedFootprint[],
  ) {
    super(
      FOOTPRINT_IMPORT_UNAVAILABLE,
      422,
      "Footprint import unavailable",
      "https://openpcb.dev/problems/unqualified-import",
      {
        code: "UNQUALIFIED_IMPORT",
        source,
        blockedCapability: "footprint-import",
        affectedFootprintCount: count,
        affectedFootprints: affected,
        omittedFootprintCount: Math.max(0, count - affected.length),
      },
    );
  }
}

export function rejectKicadFootprints(
  source: "kicad_mod" | "kicad_zip",
  ids: string[],
): void {
  if (!isFeatureEnabled("library.footprintIntakeQuarantine")) return;
  throw new UnqualifiedImportError(
    source,
    ids.length,
    ids.slice(0, MAX_DIAGNOSTICS).map((id) => ({
      id: id.slice(0, MAX_MARKER_LENGTH),
      classification: "kicad-derived",
      markers: { sourceFormat: { value: source, truncated: false } },
    })),
  );
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function describeFootprint(id: string, data: unknown): AffectedFootprint {
  const provenance = record(record(data).provenance);
  const markers: Record<string, Marker> = {};
  for (const key of [
    "sourceKind",
    "sourceFormat",
    "source",
    "sourceFileName",
    "conversionTool",
  ]) {
    const value = provenance[key];
    if (typeof value === "string")
      markers[key] = {
        value: value.slice(0, MAX_MARKER_LENGTH),
        truncated: value.length > MAX_MARKER_LENGTH,
      };
  }
  const explicitKicad =
    provenance.source === "kicad-derived" ||
    provenance.sourceFormat === "kicad_mod" ||
    provenance.sourceFormat === "kicad-mod";
  return {
    id: id.slice(0, MAX_MARKER_LENGTH),
    classification: explicitKicad ? "kicad-derived" : "unverified",
    markers,
  };
}

export function rejectUnqualifiedPackFootprints(pkg: OpclibPackage): void {
  if (!isFeatureEnabled("library.footprintIntakeQuarantine")) return;
  if (pkg.manifest.footprints.length === 0) return;
  // Pack declarations are not independent transform qualification; missing or forged provenance cannot authorize intake.
  const affected = pkg.manifest.footprints
    .slice(0, MAX_DIAGNOSTICS)
    .map((entry) =>
      describeFootprint(entry.id, readAssetJson<unknown>(pkg, entry.path)),
    );
  throw new UnqualifiedImportError(
    "opclib",
    pkg.manifest.footprints.length,
    affected,
  );
}
