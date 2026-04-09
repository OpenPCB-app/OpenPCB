/**
 * Payload Transformers
 *
 * Transform frontend wizard draft to backend ComponentDraftPayload format.
 */

import type {
  WizardDraftPayload,
  WizardVariantDraft,
} from "@/stores/component-wizard-store";
import type { SymbolDraft } from "@/components/symbol-editor/types";
import type {
  FootprintDraft,
  FootprintGraphic,
  PadDefinition,
} from "@/components/footprint-editor/types";
import {
  createEmptyDraft as createEmptySymbolDraft,
  type SymbolGraphic,
  type SymbolPin,
} from "@/components/symbol-editor/types";
import { setStoredImportedSymbolNormalization } from "@/components/symbol-editor/import-normalization";
import { createEmptyDraft as createEmptyFootprintDraft } from "@/components/footprint-editor/types";
import type { SymbolGraphic as BackendSymbolGraphic } from "@shared/types/component-semantics.types";
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
    return {
      ...graphic,
      points: graphic.points.map((point) => ({ ...point })),
    };
  }
  if (graphic.type === "bezier") {
    return {
      ...graphic,
      points: graphic.points.map((point) => ({
        ...point,
      })) as typeof graphic.points,
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
      return {
        ...graphic,
        start: { ...graphic.start },
        end: { ...graphic.end },
      };
    case "rect":
      return { ...graphic, position: { ...graphic.position } };
    case "circle":
      return { ...graphic, center: { ...graphic.center } };
    case "arc":
      return { ...graphic, center: { ...graphic.center } };
    case "polygon":
      return {
        ...graphic,
        points: graphic.points.map((point) => ({ ...point })),
      };
    case "text":
      return { ...graphic, position: { ...graphic.position } };
  }
}

function cloneSymbolDraft(draft: SymbolDraft): SymbolDraft {
  return {
    ...draft,
    metadata: { ...draft.metadata },
    pins: draft.pins.map(cloneSymbolPin),
    graphics: draft.graphics.map(cloneSymbolGraphic),
    importPreservation: draft.importPreservation
      ? {
          ...draft.importPreservation,
          warnings: draft.importPreservation.warnings.map((warning) => ({
            ...warning,
          })),
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
          warnings: draft.importPreservation.warnings.map((warning) => ({
            ...warning,
          })),
          model3dReferences: draft.importPreservation.model3dReferences.map(
            (ref) => ({
              ...ref,
              offset: { ...ref.offset },
              scale: { ...ref.scale },
              rotation: { ...ref.rotation },
            }),
          ),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Transformers
// ---------------------------------------------------------------------------

export function transformWizardToBackendPayload(
  draft: WizardDraftPayload,
  wizardVariants?: WizardVariantDraft[],
): BackendComponentDraftPayload {
  const variants = transformVariants(draft, wizardVariants);
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
  const properties = setStoredImportedSymbolNormalization(
    draft.specs?.category
      ? { __openpcbCategoryPath: draft.specs.category }
      : {},
    symbolData.importPreservation?.normalizedSchematicGeometry === true,
  );

  return {
    referencePrefix: metadata.referencePrefix || "U",
    pinDefinitions: pins.map((pin) => ({
      name: pin.name || pin.number,
      electricalType: pin.electricalType || "passive",
    })),
    pins: pins.map((pin) => ({
      name: pin.name,
      number: pin.number,
      position: { ...pin.position },
      side: pin.side,
      length: pin.length,
      electricalType: pin.electricalType,
    })),
    properties,
    unitCount: symbolData.importPreservation?.unitCount ?? 1,
    bodyGraphics: transformBodyGraphics(symbolData),
    rawKicadSource: symbolData.importPreservation?.rawSource ?? null,
  };
}

/**
 * Strip editor-only fields (id, zIndex) from graphics for backend storage.
 */
function transformBodyGraphics(
  symbolData: WizardDraftPayload["symbolData"],
): BackendSymbolGraphic[] {
  if (!symbolData) return [];

  const graphics: BackendSymbolGraphic[] = [];

  for (const graphic of symbolData.graphics) {
    if (graphic.type === "bezier") {
      continue;
    }
    const { id: _id, zIndex: _zIndex, ...rest } = graphic;
    graphics.push(rest as BackendSymbolGraphic);
  }

  return graphics;
}

function transformVariants(
  draft: WizardDraftPayload,
  wizardVariants?: WizardVariantDraft[],
): BackendComponentDraftPayload["variants"] {
  if (wizardVariants && wizardVariants.length > 0) {
    return wizardVariants
      .filter((v) => v.footprintDraft !== null)
      .map((variant) => {
        const variantId = variant.id;
        const footprintId = crypto.randomUUID();
        const footprintData = variant.footprintDraft!;

        return {
          id: variantId,
          canonicalCode: variant.canonicalCode || "DEFAULT",
          humanLabel: variant.humanLabel || variant.canonicalCode || "Package",
          imperialAlias: null,
          metricAlias: null,
          mountType: variant.mountType,
          dimensions: null,
          isDefault: variant.isDefault,
          pinRemapTable: null,
          footprintOptions: [
            {
              id: footprintId,
              variantId,
              label: "Default",
              isDefault: true,
              kicadPayload: transformFootprintToKicad(footprintData),
              densityLevel: footprintData.densityLevel,
              ipcName: null,
              model3dOptions: transformModel3dOptionsForVariant(
                draft,
                footprintId,
                footprintData,
              ),
            },
          ],
          defaultFootprintOptionId: footprintId,
        };
      });
  }

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
function transformFootprintToKicad(
  footprintData: NonNullable<WizardDraftPayload["footprintData"]>,
): unknown {
  return {
    pads: footprintData.pads,
    graphics: footprintData.graphics,
    preset: footprintData.preset,
    config: footprintData.config,
    configMode: footprintData.configMode,
    densityLevel: footprintData.densityLevel,
    metadata: footprintData.metadata,
    rawKicadSource: footprintData.importPreservation?.rawSource ?? null,
    model3dReferences:
      footprintData.importPreservation?.model3dReferences ?? [],
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
      (ref) =>
        ref.resolvedFileName.toLowerCase() ===
        uploaded.stepFileName?.toLowerCase(),
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

function transformModel3dOptionsForVariant(
  _draft: WizardDraftPayload,
  footprintOptionId: string,
  footprintData: FootprintDraft,
): Array<{
  id: string;
  footprintOptionId: string;
  fileName: string;
  stepAssetPath: string | null;
  gltfPreviewPath: string | null;
  isDefault: boolean;
  linkStatus: "valid" | "missing_target" | "orphan_asset";
}> {
  const refs = footprintData.importPreservation?.model3dReferences ?? [];

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

function createEmptySymbolData(): BackendSymbolData {
  return {
    referencePrefix: "U",
    pinDefinitions: [],
    pins: [],
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

export function transformKicadPayloadToFootprintDraft(
  kicadPayload: unknown,
  id?: string,
): FootprintDraft | null {
  if (!kicadPayload || typeof kicadPayload !== "object") {
    return null;
  }

  const payload = kicadPayload as Record<string, unknown>;

  const pads = Array.isArray(payload.pads) ? payload.pads : [];
  const graphics = Array.isArray(payload.graphics) ? payload.graphics : [];
  const preset = typeof payload.preset === "string" ? payload.preset : "custom";
  const config = payload.config ?? {};
  const configMode =
    typeof payload.configMode === "string" ? payload.configMode : "auto";
  const densityLevel =
    typeof payload.densityLevel === "string" ? payload.densityLevel : "nominal";
  const metadata =
    payload.metadata && typeof payload.metadata === "object"
      ? payload.metadata
      : { name: "", description: "", keywords: "" };
  const rawKicadSource =
    typeof payload.rawKicadSource === "string" ? payload.rawKicadSource : null;
  const model3dReferences = Array.isArray(payload.model3dReferences)
    ? payload.model3dReferences
    : [];

  return {
    id: id ?? crypto.randomUUID(),
    preset: preset as FootprintDraft["preset"],
    config: config as FootprintDraft["config"],
    configMode: configMode as FootprintDraft["configMode"],
    densityLevel: densityLevel as FootprintDraft["densityLevel"],
    pads: pads as FootprintDraft["pads"],
    graphics: graphics as FootprintDraft["graphics"],
    metadata: metadata as FootprintDraft["metadata"],
    importPreservation: rawKicadSource
      ? {
          rawSource: rawKicadSource,
          sourceFileName: "",
          warnings: [],
          model3dReferences:
            model3dReferences as FootprintDraft["importPreservation"] extends {
              model3dReferences: infer R;
            }
              ? R
              : never,
          attributes: { type: "unknown" as const },
        }
      : null,
  };
}
