/**
 * Payload Transformers
 *
 * Transform frontend wizard draft to backend ComponentDraftPayload format.
 */

import type { WizardDraftPayload } from "@/stores/component-wizard-store";
import type { SymbolDraft } from "@/components/symbol-editor/types";

// ---------------------------------------------------------------------------
// Backend Types (mirror of src-ts/src/core/schemas/component-semantics.ts)
// ---------------------------------------------------------------------------

interface BackendSymbolData {
  referencePrefix: string;
  pinDefinitions: Array<{
    name: string;
    electricalType: string;
  }>;
  properties: Record<string, string>;
  unitCount: number;
  bodyGraphics: unknown[];
  rawKicadSource: string | null;
}

interface BackendComponentDraftPayload {
  displayLabel: string;
  description: string;
  symbolData: BackendSymbolData;
  packageVariants: unknown[];
  defaultPackageVariantId: string | null;
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
  return {
    displayLabel: draft.displayLabel || "Untitled Component",
    description: draft.description || "",
    symbolData: transformSymbolData(draft.symbolData),
    packageVariants: transformPackageVariants(draft),
    defaultPackageVariantId: draft.defaultPackageVariantId,
  };
}

/**
 * Transform symbol data from wizard format to backend format
 */
function transformSymbolData(
  symbolData: WizardDraftPayload["symbolData"],
): BackendSymbolData {
  if (!symbolData) {
    return createEmptySymbolData();
  }

  const pins = symbolData.pins || [];
  const metadata = symbolData.metadata;

  return {
    referencePrefix: metadata?.referencePrefix || symbolData.referencePrefix || "U",
    pinDefinitions: pins.map((pin) => ({
      name: pin.name || pin.number,
      electricalType: pin.electricalType || "passive",
    })),
    properties: {},
    unitCount: 1,
    bodyGraphics: transformBodyGraphics(symbolData),
    rawKicadSource: null,
  };
}

/**
 * Transform body/graphics to KiCad-compatible format
 */
function transformBodyGraphics(
  symbolData: WizardDraftPayload["symbolData"],
): unknown[] {
  if (!symbolData) return [];

  const graphics: unknown[] = [];

  // Add body rectangle if present
  if (symbolData.body) {
    const { kind, width, height } = symbolData.body;
    const halfW = width / 2;
    const halfH = height / 2;

    if (kind === "ic_box" || kind === "blank") {
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
  if (symbolData.graphics) {
    graphics.push(...symbolData.graphics);
  }

  return graphics;
}

/**
 * Transform footprint data to package variants.
 * For MVP, creates a single package variant from footprint data.
 */
function transformPackageVariants(
  draft: WizardDraftPayload,
): unknown[] {
  // If no footprint data, return empty array (MVP allows this)
  if (!draft.footprintData) {
    return [];
  }

  const footprintData = draft.footprintData;
  const variantId = crypto.randomUUID();
  const footprintId = crypto.randomUUID();

  return [
    {
      id: variantId,
      familyId: null, // Will be set on publish
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
          densityLevel: "nominal",
          ipcName: null,
          model3dOptions: [],
          defaultModel3dOptionId: null,
        },
      ],
      defaultFootprintOptionId: footprintId,
      offerings: [],
    },
  ];
}

/**
 * Determine mount type from footprint data
 */
function determineMountType(
  footprintData: NonNullable<WizardDraftPayload["footprintData"]>,
): string {
  const preset = footprintData.preset?.toLowerCase() || "";
  
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
    pads: footprintData.pads || [],
    graphics: footprintData.graphics || [],
    preset: footprintData.preset,
    config: footprintData.config,
  };
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
  return {
    id: draft.id,
    referencePrefix: draft.metadata.referencePrefix,
    body: {
      kind: draft.body.kind,
      width: draft.body.width,
      height: draft.body.height,
    },
    pins: draft.pins.map((pin) => ({
      id: pin.id,
      name: pin.name,
      number: pin.number,
      electricalType: pin.electricalType,
      side: pin.side,
      position: { x: pin.position.x, y: pin.position.y },
      length: pin.length,
    })),
    graphics: draft.graphics,
    metadata: {
      name: draft.metadata.name,
      referencePrefix: draft.metadata.referencePrefix,
      description: draft.metadata.description,
    },
  };
}
