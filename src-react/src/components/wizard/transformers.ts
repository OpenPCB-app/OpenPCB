/**
 * Payload Transformers
 *
 * Transform frontend wizard draft to backend ComponentDraftPayload format.
 */

import type { WizardDraftPayload } from "@/stores/component-wizard-store";
import type { SymbolDraft } from "@/components/symbol-editor/types";
import type { FootprintDraft, FootprintGraphic, PadDefinition } from "@/components/footprint-editor/types";
import { createEmptyDraft as createEmptySymbolDraft, type SymbolGraphic, type SymbolPin } from "@/components/symbol-editor/types";
import { createEmptyDraft as createEmptyFootprintDraft } from "@/components/footprint-editor/types";
import type {
  SymbolGraphic as BackendSymbolGraphic,
} from "@shared/types/component-semantics.types";
import type {
  ComponentType,
  ComponentVariantType,
} from "@shared/types/component-library-schema.types";

// ---------------------------------------------------------------------------
// Contract Types (from shared semantics contract)
// ---------------------------------------------------------------------------

type BackendSymbolData = ComponentType["symbolData"];
type BackendVariantPayload = Partial<ComponentVariantType> & {
  footprintOptions: ComponentVariantType["footprintOptions"];
};
type BackendComponentDraftPayload = {
  displayLabel: string;
  description: string;
  symbolData: BackendSymbolData;
  variants: BackendVariantPayload[];
  defaultVariantId: string | null;
};

function cloneSymbolPin(pin: SymbolPin): SymbolPin {
  return { ...pin, position: { ...pin.position } };
}

function cloneSymbolGraphic(graphic: SymbolGraphic): SymbolGraphic {
  if (graphic.type === "polygon") {
    return { ...graphic, points: graphic.points.map((point) => ({ ...point })) };
  }
  if (graphic.type === "bezier") {
    return {
      ...graphic,
      points: graphic.points.map((point) => ({ ...point })) as typeof graphic.points,
    };
  }
  return { ...graphic };
}

function clonePad(pad: PadDefinition): PadDefinition {
  return {
    ...pad,
    position: { ...pad.position },
    size: { ...pad.size },
    layers: [...pad.layers],
    drillOffset: pad.drillOffset ? { ...pad.drillOffset } : undefined,
  };
}

function cloneFootprintGraphic(graphic: FootprintGraphic): FootprintGraphic {
  switch (graphic.type) {
    case "line":
      return { ...graphic, start: { ...graphic.start }, end: { ...graphic.end } };
    case "rect":
      return { ...graphic, position: { ...graphic.position } };
    case "circle":
      return { ...graphic, center: { ...graphic.center } };
    case "arc":
      return { ...graphic, center: { ...graphic.center } };
    case "polygon":
      return { ...graphic, points: graphic.points.map((point) => ({ ...point })) };
    case "text":
      return { ...graphic, position: { ...graphic.position } };
  }
}

function cloneSymbolDraft(draft: SymbolDraft): SymbolDraft {
  return {
    ...draft,
    metadata: { ...draft.metadata },
    body: { ...draft.body },
    pins: draft.pins.map(cloneSymbolPin),
    graphics: draft.graphics.map(cloneSymbolGraphic),
    importPreservation: draft.importPreservation
      ? {
          ...draft.importPreservation,
          warnings: draft.importPreservation.warnings.map((warning) => ({ ...warning })),
        }
      : null,
  };
}

function cloneFootprintDraft(draft: FootprintDraft): FootprintDraft {
  return {
    ...draft,
    metadata: { ...draft.metadata },
    config: structuredClone(draft.config),
    pads: draft.pads.map(clonePad),
    graphics: draft.graphics.map(cloneFootprintGraphic),
    importPreservation: draft.importPreservation
      ? {
          ...draft.importPreservation,
          warnings: draft.importPreservation.warnings.map((warning) => ({ ...warning })),
          model3dReferences: draft.importPreservation.model3dReferences.map((ref) => ({
            ...ref,
            offset: { ...ref.offset },
            scale: { ...ref.scale },
            rotation: { ...ref.rotation },
          })),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Transformers
// ---------------------------------------------------------------------------

/**
 * Transform frontend wizard draft to backend payload format
 */
export function transformWizardToBackendPayload(
  draft: WizardDraftPayload,
): BackendComponentDraftPayload {
  const variants = transformVariants(draft);
  const defaultVariantId =
    variants.find((variant) => variant.isDefault)?.id ?? null;

  return {
    displayLabel: draft.displayLabel || "Untitled Component",
    description: draft.description || "",
    symbolData: transformSymbolData(draft),
    variants,
    defaultVariantId,
  };
}

/**
 * Transform symbol data from wizard format to backend format
 */
export function createEmptyBackendPayload(): BackendComponentDraftPayload {
  return transformWizardToBackendPayload({
    displayLabel: "",
    description: "",
    symbolData: null,
    footprintData: null,
    modelData: null,
    specs: null,
    defaultVariantId: null,
  });
}

function transformSymbolData(draft: WizardDraftPayload): BackendSymbolData {
  const symbolData = draft.symbolData;
  if (!symbolData) {
    return createEmptySymbolData();
  }

  const pins = symbolData.pins;
  const metadata = symbolData.metadata;

  return {
    referencePrefix: metadata.referencePrefix || "U",
    pinDefinitions: pins.map((pin) => ({
      name: pin.name || pin.number,
      electricalType: pin.electricalType || "passive",
    })),
    properties: draft.specs?.category
      ? { __openpcbCategoryPath: draft.specs.category }
      : {},
    unitCount: symbolData.importPreservation?.unitCount ?? 1,
    bodyGraphics: transformBodyGraphics(symbolData),
    rawKicadSource: symbolData.importPreservation?.rawSource ?? null,
  };
}

/**
 * Transform body/graphics to KiCad-compatible format
 */
function transformBodyGraphics(symbolData: WizardDraftPayload["symbolData"]): BackendSymbolGraphic[] {
  if (!symbolData) return [];

  const graphics: BackendSymbolGraphic[] = [];

  // Add body rectangle if present
  if (symbolData.body) {
    const { kind, width, height } = symbolData.body;
    const halfW = width / 2;
    const halfH = height / 2;

    if (kind === "ic_box") {
      graphics.push({
        type: "rect",
        x: -halfW,
        y: -halfH,
        width,
        height,
        filled: false,
        strokeWidth: 0.254,
      });
    } else if (kind === "opamp") {
      // Triangle for op-amp
      graphics.push({
        type: "polygon",
        points: [
          { x: -halfW, y: -halfH },
          { x: halfW, y: 0 },
          { x: -halfW, y: halfH },
        ],
        filled: false,
        closed: true,
        strokeWidth: 0.254,
      });
    } else if (kind === "two_pin_passive") {
      // Simple resistor zigzag (simplified)
      graphics.push({
        type: "rect",
        x: -halfW,
        y: -halfH,
        width,
        height,
        filled: false,
        strokeWidth: 0.254,
      });
    }
  }

  // Add any custom graphics
  for (const graphic of symbolData.graphics) {
    if (graphic.type === "bezier") {
      continue;
    }
    const { id: _id, zIndex: _zIndex, ...rest } = graphic;
    graphics.push(rest as BackendSymbolGraphic);
  }

  return graphics;
}

/**
 * Transform footprint data to package variants.
 * For MVP, creates a single package variant from footprint data.
 */
function transformVariants(
  draft: WizardDraftPayload,
): BackendComponentDraftPayload["variants"] {
  // If no footprint data, return empty array (MVP allows this)
  if (!draft.footprintData) {
    return [];
  }

  const footprintData = draft.footprintData;
  const variantId = crypto.randomUUID();
  const footprintId = crypto.randomUUID();
  const model3dOptions = transformModel3dOptions(draft, footprintId);

  return [
    {
      id: variantId,
      canonicalCode: footprintData.preset || "DEFAULT",
      humanLabel: draft.displayLabel || "Default Package",
      imperialAlias: null,
      metricAlias: null,
      mountType: determineMountType(footprintData),
      dimensions: null,
      isDefault: true,
      pinRemapTable: null,
      footprintOptions: [
        {
          id: footprintId,
          variantId,
          label: "Nominal",
          isDefault: true,
          kicadPayload: transformFootprintToKicad(footprintData),
          densityLevel: footprintData.densityLevel,
          ipcName: null,
          model3dOptions,
        },
      ],
      defaultFootprintOptionId: footprintId,
    },
  ];
}

/**
 * Determine mount type from footprint data
 */
function determineMountType(
  footprintData: NonNullable<WizardDraftPayload["footprintData"]>,
): NonNullable<BackendComponentDraftPayload["variants"][number]["mountType"]> {
  if (footprintData.importPreservation?.rawSource) {
    const importedMount = footprintData.importPreservation.attributes?.type;
    if (importedMount === "through_hole") return "through_hole";
    if (importedMount === "virtual") return "virtual";
    if (importedMount === "smd") return "smd";
  }

  const preset = footprintData.preset.toLowerCase();
  
  if (
    preset.includes("smd") ||
    preset.includes("chip") ||
    preset.includes("soic") ||
    preset.includes("qfp")
  ) {
    return "smd";
  }
  
  if (preset.includes("dip") || preset.includes("through")) {
    return "through_hole";
  }
  
  return "smd"; // Default to SMD
}

/**
 * Transform footprint data to KiCad payload format
 */
function transformFootprintToKicad(footprintData: NonNullable<WizardDraftPayload["footprintData"]>): unknown {
  return {
    pads: footprintData.pads,
    graphics: footprintData.graphics,
    preset: footprintData.preset,
    config: footprintData.config,
    configMode: footprintData.configMode,
    densityLevel: footprintData.densityLevel,
    metadata: footprintData.metadata,
    rawKicadSource: footprintData.importPreservation?.rawSource ?? null,
    model3dReferences: footprintData.importPreservation?.model3dReferences ?? [],
  };
}

function transformModel3dOptions(
  draft: WizardDraftPayload,
  footprintOptionId: string,
): Array<{
  id: string;
  footprintOptionId: string;
  fileName: string;
  stepAssetPath: string | null;
  gltfPreviewPath: string | null;
  isDefault: boolean;
  linkStatus: "valid" | "missing_target" | "orphan_asset";
}> {
  const uploaded = draft.modelData;
  const refs = draft.footprintData?.importPreservation?.model3dReferences ?? [];

  if (uploaded?.stepFileName) {
    const matchedRef = refs.find(
      (ref) => ref.resolvedFileName.toLowerCase() === uploaded.stepFileName?.toLowerCase(),
    );
    const unresolvedRefs = refs.filter((ref) => ref !== matchedRef);

    return [
      {
        id: crypto.randomUUID(),
        footprintOptionId,
        fileName: uploaded.stepFileName,
        stepAssetPath: uploaded.stepAssetPath ?? null,
        gltfPreviewPath: uploaded.gltfPreviewPath ?? null,
        isDefault: true,
        linkStatus: uploaded.stepAssetPath
          ? matchedRef || refs.length === 0
            ? "valid"
            : "orphan_asset"
          : "missing_target",
      },
      ...unresolvedRefs.map((ref) => ({
        id: crypto.randomUUID(),
        footprintOptionId,
        fileName: ref.resolvedFileName,
        stepAssetPath: null,
        gltfPreviewPath: null,
        isDefault: false,
        linkStatus: "missing_target" as const,
      })),
    ];
  }

  if (refs.length === 0) return [];

  return refs.map((ref, index) => ({
    id: crypto.randomUUID(),
    footprintOptionId,
    fileName: ref.resolvedFileName,
    stepAssetPath: null,
    gltfPreviewPath: null,
    isDefault: index === 0,
    linkStatus: "missing_target",
  }));
}

/**
 * Create empty symbol data for components without symbol
 */
function createEmptySymbolData(): BackendSymbolData {
  return {
    referencePrefix: "U",
    pinDefinitions: [],
    properties: {},
    unitCount: 1,
    bodyGraphics: [],
    rawKicadSource: null,
  };
}

// ---------------------------------------------------------------------------
// Symbol Draft Transformer (from symbol editor store)
// ---------------------------------------------------------------------------

/**
 * Transform symbol editor draft to wizard symbolData format
 */
export function transformSymbolDraftToWizard(
  draft: SymbolDraft,
): WizardDraftPayload["symbolData"] {
  return cloneSymbolDraft(draft);
}

export function transformFootprintDraftToWizard(
  draft: FootprintDraft,
): WizardDraftPayload["footprintData"] {
  return cloneFootprintDraft(draft);
}

export function transformWizardToSymbolDraft(
  draft: WizardDraftPayload["symbolData"],
  id?: string,
): SymbolDraft {
  if (!draft) {
    return createEmptySymbolDraft(id ?? crypto.randomUUID());
  }
  return cloneSymbolDraft(draft);
}

export function transformWizardToFootprintDraft(
  draft: WizardDraftPayload["footprintData"],
  id?: string,
): FootprintDraft {
  if (!draft) {
    return createEmptyFootprintDraft(id ?? crypto.randomUUID());
  }
  return cloneFootprintDraft(draft);
}
