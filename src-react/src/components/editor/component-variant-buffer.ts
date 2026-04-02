import type {
  ComponentType,
  ComponentVariant,
  MountType,
} from "@/lib/api/component-api";
import { createEmptyDraft, type FootprintDraft } from "@/components/footprint-editor";

export interface EditableComponentVariant {
  id: string;
  canonicalCode: string;
  humanLabel: string;
  mountType: MountType;
  isDefault: boolean;
  footprintId: string;
  footprintLabel: string;
  footprintPayload: unknown | null;
}

const DENSITY_LEVELS = new Set(["most", "nominal", "least"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeMountType(value: unknown): MountType {
  if (value === "through_hole" || value === "virtual") {
    return value;
  }
  return "smd";
}

function getSourceVariants(component?: ComponentType | null): ComponentVariant[] {
  if (!component) {
    return [];
  }
  if (component.packageVariants.length > 0) {
    return component.packageVariants;
  }
  return component.variants;
}

function getDefaultFootprint(variant: ComponentVariant) {
  return (
    [...variant.footprintOptions, ...variant.footprints].find((footprint) => footprint.isDefault) ??
    variant.footprintOptions[0] ??
    variant.footprints[0] ??
    null
  );
}

export function createDefaultEditableVariant(order = 1): EditableComponentVariant {
  const id = crypto.randomUUID();
  return {
    id,
    canonicalCode: `variant-${order}`,
    humanLabel: `Variant ${order}`,
    mountType: "smd",
    isDefault: true,
    footprintId: crypto.randomUUID(),
    footprintLabel: "Default",
    footprintPayload: null,
  };
}

export function createInitialEditableVariants(
  component?: ComponentType | null,
): EditableComponentVariant[] {
  const sourceVariants = getSourceVariants(component);
  if (sourceVariants.length === 0) {
    return [createDefaultEditableVariant()];
  }

  const mapped = sourceVariants.map((variant, index) => {
    const footprint = getDefaultFootprint(variant);
    return {
      id: variant.id,
      canonicalCode: variant.canonicalCode,
      humanLabel: variant.humanLabel,
      mountType: normalizeMountType(variant.mountType),
      isDefault: Boolean(variant.isDefault),
      footprintId: footprint?.id ?? crypto.randomUUID(),
      footprintLabel: footprint?.label ?? "Default",
      footprintPayload: footprint?.kicadPayload ?? null,
      fallbackOrder: index + 1,
    };
  });

  const hasDefault = mapped.some((variant) => variant.isDefault);
  return mapped.map((variant, index) => ({
    ...variant,
    isDefault: hasDefault ? variant.isDefault : index === 0,
    canonicalCode:
      variant.canonicalCode.trim().length > 0
        ? variant.canonicalCode
        : `variant-${variant.fallbackOrder}`,
    humanLabel:
      variant.humanLabel.trim().length > 0
        ? variant.humanLabel
        : `Variant ${variant.fallbackOrder}`,
  }));
}

export function createNewEditableVariant(
  existingVariants: EditableComponentVariant[],
): EditableComponentVariant {
  const existingCodes = new Set(
    existingVariants.map((variant) => variant.canonicalCode.toLowerCase()),
  );

  let order = existingVariants.length + 1;
  let code = `variant-${order}`;
  while (existingCodes.has(code.toLowerCase())) {
    order += 1;
    code = `variant-${order}`;
  }

  return {
    id: crypto.randomUUID(),
    canonicalCode: code,
    humanLabel: `Variant ${order}`,
    mountType: "smd",
    isDefault: false,
    footprintId: crypto.randomUUID(),
    footprintLabel: "Default",
    footprintPayload: null,
  };
}

export function normalizeEditableVariants(
  variants: EditableComponentVariant[],
): EditableComponentVariant[] {
  if (variants.length === 0) {
    return [createDefaultEditableVariant()];
  }

  const defaultIndex = variants.findIndex((variant) => variant.isDefault);
  return variants.map((variant, index) => ({
    ...variant,
    isDefault: defaultIndex >= 0 ? index === defaultIndex : index === 0,
  }));
}

export function getDefaultVariantId(
  variants: EditableComponentVariant[],
): string | null {
  const normalized = normalizeEditableVariants(variants);
  return normalized.find((variant) => variant.isDefault)?.id ?? normalized[0]?.id ?? null;
}

export function createFootprintDraftFromVariant(
  variant: EditableComponentVariant,
): FootprintDraft {
  return createFootprintDraftFromPayload(
    variant.footprintPayload,
    variant.footprintId,
    variant.humanLabel,
  );
}

export function createFootprintDraftFromPayload(
  payload: unknown,
  draftId: string,
  fallbackName: string,
): FootprintDraft {
  const fallback = createEmptyDraft(draftId);
  fallback.metadata.name = fallbackName;
  fallback.metadata.reference = fallbackName;
  fallback.metadata.description = "";

  if (!isRecord(payload)) {
    return fallback;
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : null;
  const importPreservation =
    payload.importPreservation === null || isRecord(payload.importPreservation)
      ? (payload.importPreservation as FootprintDraft["importPreservation"])
      : fallback.importPreservation;

  return {
    ...fallback,
    id: draftId,
    metadata: {
      name:
        typeof metadata?.name === "string" && metadata.name.trim().length > 0
          ? metadata.name
          : fallback.metadata.name,
      reference:
        typeof metadata?.reference === "string" && metadata.reference.trim().length > 0
          ? metadata.reference
          : fallback.metadata.reference,
      description:
        typeof metadata?.description === "string"
          ? metadata.description
          : fallback.metadata.description,
    },
    preset:
      typeof payload.preset === "string"
        ? (payload.preset as FootprintDraft["preset"])
        : fallback.preset,
    config: isRecord(payload.config)
      ? (payload.config as unknown as FootprintDraft["config"])
      : fallback.config,
    configMode: payload.configMode === "ipc" ? "ipc" : "manual",
    densityLevel:
      typeof payload.densityLevel === "string" && DENSITY_LEVELS.has(payload.densityLevel)
        ? (payload.densityLevel as FootprintDraft["densityLevel"])
        : fallback.densityLevel,
    pads: Array.isArray(payload.pads)
      ? (payload.pads as FootprintDraft["pads"])
      : fallback.pads,
    graphics: Array.isArray(payload.graphics)
      ? (payload.graphics as FootprintDraft["graphics"])
      : fallback.graphics,
    importPreservation,
  };
}

export function serializeFootprintDraft(draft: FootprintDraft): unknown {
  return structuredClone(draft);
}

function toFootprintPayload(variant: EditableComponentVariant) {
  return {
    id: variant.footprintId,
    variantId: variant.id,
    label: variant.footprintLabel,
    isDefault: true,
    kicadPayload: variant.footprintPayload,
    model3dOptions: [],
    densityLevel: null,
    ipcName: null,
  };
}

export function toComponentVariantPayload(
  variant: EditableComponentVariant,
  familyId: string,
): ComponentType["packageVariants"][number] {
  const footprint = toFootprintPayload(variant);

  return {
    id: variant.id,
    familyId,
    canonicalCode: variant.canonicalCode,
    humanLabel: variant.humanLabel,
    imperialAlias: null,
    metricAlias: null,
    mountType: variant.mountType,
    dimensions: null,
    isDefault: variant.isDefault,
    pinRemapTable: null,
    footprints: [footprint],
    defaultFootprintId: footprint.id,
    footprintOptions: [footprint],
    defaultFootprintOptionId: footprint.id,
  };
}

export function toVariantMutationPayload(
  variant: EditableComponentVariant,
): Partial<ComponentVariant> {
  const footprint = toFootprintPayload(variant);

  return {
    canonicalCode: variant.canonicalCode,
    humanLabel: variant.humanLabel,
    imperialAlias: null,
    metricAlias: null,
    mountType: variant.mountType,
    dimensions: null,
    isDefault: variant.isDefault,
    pinRemapTable: null,
    footprints: [footprint],
    defaultFootprintId: footprint.id,
    footprintOptions: [footprint],
    defaultFootprintOptionId: footprint.id,
  };
}
