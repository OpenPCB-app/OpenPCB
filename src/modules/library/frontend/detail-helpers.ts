import type {
  FootprintRenderModel,
  SymbolRenderModel,
} from "../../../shared/rendering";
import type {
  ComponentDetailPayload,
  ComponentFootprintVariant,
  ComponentSourceProvenance,
} from "./types";

export function asSymbolRender(value: unknown): SymbolRenderModel | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { kind?: unknown };
  return record.kind === "symbol" ? (value as SymbolRenderModel) : null;
}

export function asFootprintRender(value: unknown): FootprintRenderModel | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { kind?: unknown };
  return record.kind === "footprint" ? (value as FootprintRenderModel) : null;
}

/**
 * Hide the KiCad reference designator (`REF**`) from a footprint preview. In the
 * library catalog context the part is unplaced, so the designator is noise.
 */
export function stripReferenceLabels(
  model: FootprintRenderModel,
): FootprintRenderModel {
  const labels = model.labels.filter(
    (label) =>
      label.role !== "reference" && label.text.trim().toUpperCase() !== "REF**",
  );
  return labels.length === model.labels.length ? model : { ...model, labels };
}

/** System tags that should never appear as semantic pills. */
const SYSTEM_TAGS = new Set(["placeholder-footprint"]);

/** Known provenance tags → human label rendered as a right-aligned chip. */
const PROVENANCE_TAG_LABELS: Record<string, string> = {
  "kicad-derived": "Imported from KiCad",
};

export interface ProvenanceChip {
  tag: string;
  label: string;
}

export interface SplitTags {
  semantic: string[];
  provenance: ProvenanceChip[];
}

/**
 * Split a component's flat tag list into user-facing semantic pills and known
 * provenance chips. Unknown tags default to semantic pills.
 */
export function splitTags(tags: readonly string[]): SplitTags {
  const semantic: string[] = [];
  const provenance: ProvenanceChip[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (SYSTEM_TAGS.has(key)) {
      continue;
    }
    const label = PROVENANCE_TAG_LABELS[key];
    if (label) {
      provenance.push({ tag, label });
    } else {
      semantic.push(tag);
    }
  }
  return { semantic, provenance };
}

/** Human label for the Details "Source" row, derived from provenance. */
export function formatSourceLabel(
  provenance: ComponentSourceProvenance | null,
  isBuiltin: boolean,
): string {
  if (!provenance) {
    return isBuiltin ? "Core library" : "—";
  }
  const kind = provenance.sourceKind?.toLowerCase() ?? null;
  const format = provenance.sourceFormat?.toLowerCase() ?? null;
  switch (kind) {
    case "imported":
      return format === "kicad" ? "KiCad library" : "Imported";
    case "generated":
      return "Generated (IPC-7351B)";
    case "drawn":
      return "Drawn";
    case "system":
      return "Core library";
    default:
      return isBuiltin ? "Core library" : (provenance.sourceKind ?? "—");
  }
}

/** The default footprint option (cached on the component), falling back to the first. */
export function getDefaultVariant(
  detail: ComponentDetailPayload,
): ComponentFootprintVariant | null {
  const variants = detail.footprintVariants ?? [];
  return variants.find((variant) => variant.isDefault) ?? variants[0] ?? null;
}

/** Display label for a footprint option's package code. */
export function packageLabel(
  variant: Pick<ComponentFootprintVariant, "packageCode" | "variantLabel">,
): string {
  return (
    variant.packageCode.metric ??
    variant.packageCode.imperial ??
    variant.variantLabel
  );
}
