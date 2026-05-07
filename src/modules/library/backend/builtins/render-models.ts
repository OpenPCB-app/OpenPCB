import { buildSymbolRenderModel } from "../../../../shared/rendering/symbol-preview-builder";
import type {
  SymbolRenderModel,
  SymbolRenderSource,
  SymbolRenderSourceGraphic,
  SymbolRenderSourcePin,
} from "../../../../shared/rendering/types";
import { BODY_STROKE_MM } from "../../../../shared/frontend/canvas/defaults";

interface NormalizedPin {
  originPinKey: string;
  number: string;
  name: string;
  localPosition: { x: number; y: number };
  electricalType: string;
  unit: number;
}

/** Flux-style horizontal resistor: pins at (±5.08, 0), 10.16 mm pin span,
 *  zigzag spans x∈[-2.54, 2.54] with vertical amplitude ±0.762 mm.
 *  7-segment zigzag matches Flux.AI / common ANSI rendering. */
function buildResistorSource(): SymbolRenderSource {
  const pins: SymbolRenderSourcePin[] = [
    {
      id: "pin-1",
      name: "",
      number: "1",
      electricalType: "passive",
      positionMm: { x: -5.08, y: 0 },
      lengthMm: 2.54,
      rotationDeg: 0,
      unit: 1,
      hidden: false,
    },
    {
      id: "pin-2",
      name: "",
      number: "2",
      electricalType: "passive",
      positionMm: { x: 5.08, y: 0 },
      lengthMm: 2.54,
      rotationDeg: 180,
      unit: 1,
      hidden: false,
    },
  ];

  // Asymmetric ANSI/Flux-style zigzag: starts going DOWN to a valley (bottom)
  // and ends coming UP out of a peak (top). 3 valleys at y=-1.016
  // alternating with 3 peaks at y=+1.016. Equal slopes throughout. Body
  // x∈[-1.95, 1.95] gives a slightly stretched, less-steep wave.
  const graphics: SymbolRenderSourceGraphic[] = [
    {
      unit: 1,
      graphic: {
        kind: "polyline",
        points: [
          { x: -2.54, y: 0 },
          { x: -1.95, y: 0 },
          { x: -1.625, y: -1.016 }, // valley 1 — "start from bottom"
          { x: -0.975, y: 1.016 }, // peak 1
          { x: -0.325, y: -1.016 }, // valley 2
          { x: 0.325, y: 1.016 }, // peak 2
          { x: 0.975, y: -1.016 }, // valley 3
          { x: 1.625, y: 1.016 }, // peak 3 — "end from top"
          { x: 1.95, y: 0 },
          { x: 2.54, y: 0 },
        ],
        closed: false,
        fill: "none",
        strokeWidthMm: BODY_STROKE_MM,
      },
    },
  ];

  return {
    name: "R",
    unitCount: 1,
    referenceText: "R",
    valueText: "R",
    pins,
    graphics,
    warnings: [],
  };
}

/** Non-polarized capacitor: pins at (0, ±3.81), 7.62 mm pin span, plates at
 *  y=±0.762 mm running from x=-1.524 to 1.524. */
function buildCapacitorSource(): SymbolRenderSource {
  const plateY = 0.762;
  const plateHalfW = 1.524;
  const pinLengthMm = 3.81 - plateY; // 3.048

  const pins: SymbolRenderSourcePin[] = [
    {
      id: "pin-1",
      name: "",
      number: "1",
      electricalType: "passive",
      positionMm: { x: 0, y: 3.81 },
      lengthMm: pinLengthMm,
      rotationDeg: 270,
      unit: 1,
      hidden: false,
    },
    {
      id: "pin-2",
      name: "",
      number: "2",
      electricalType: "passive",
      positionMm: { x: 0, y: -3.81 },
      lengthMm: pinLengthMm,
      rotationDeg: 90,
      unit: 1,
      hidden: false,
    },
  ];

  const graphics: SymbolRenderSourceGraphic[] = [
    {
      unit: 1,
      graphic: {
        kind: "line",
        a: { x: -plateHalfW, y: plateY },
        b: { x: plateHalfW, y: plateY },
        strokeWidthMm: BODY_STROKE_MM,
      },
    },
    {
      unit: 1,
      graphic: {
        kind: "line",
        a: { x: -plateHalfW, y: -plateY },
        b: { x: plateHalfW, y: -plateY },
        strokeWidthMm: BODY_STROKE_MM,
      },
    },
  ];

  return {
    name: "C",
    unitCount: 1,
    referenceText: "C",
    valueText: "C",
    pins,
    graphics,
    warnings: [],
  };
}

function buildPreview(source: SymbolRenderSource): SymbolRenderModel {
  return buildSymbolRenderModel(source, {
    composeAllUnits: false,
    includeHiddenPins: false,
    preserveOrigin: true,
  });
}

function buildNormalizedPinsFromPreview(
  preview: SymbolRenderModel,
): NormalizedPin[] {
  return preview.pins.map((pin) => ({
    originPinKey: pin.id,
    number: pin.number ?? "",
    name: pin.name,
    localPosition: { x: pin.anchor.x, y: pin.anchor.y },
    electricalType: pin.electricalType,
    unit: pin.unit,
  }));
}

export interface BuiltinSymbolSpec {
  symbolId: string;
  symbolName: string;
  referencePrefix: string;
  description: string;
  sourceHash: string;
  preview: SymbolRenderModel;
  pins: NormalizedPin[];
}

function buildSymbolSpec(
  symbolId: string,
  symbolName: string,
  referencePrefix: string,
  description: string,
  sourceHash: string,
  preview: SymbolRenderModel,
): BuiltinSymbolSpec {
  return {
    symbolId,
    symbolName,
    referencePrefix,
    description,
    sourceHash,
    preview,
    pins: buildNormalizedPinsFromPreview(preview),
  };
}

export function buildResistorSymbolSpec(): BuiltinSymbolSpec {
  return buildSymbolSpec(
    "builtin:sym:resistor",
    "Resistor",
    "R",
    "Generic non-polarized resistor (IEEE/ANSI zigzag)",
    "builtin:resistor:v8",
    buildPreview(buildResistorSource()),
  );
}

export function buildCapacitorSymbolSpec(): BuiltinSymbolSpec {
  return buildSymbolSpec(
    "builtin:sym:capacitor",
    "Capacitor",
    "C",
    "Generic non-polarized capacitor",
    "builtin:capacitor:v8",
    buildPreview(buildCapacitorSource()),
  );
}

export function buildSymbolDataJson(
  spec: BuiltinSymbolSpec,
  now: string,
): string {
  return JSON.stringify({
    provenance: {
      sourceKind: "builtin",
      sourceFormat: "openpcb-builtin",
      fileName: null,
      importedAt: now,
      sourceHash: spec.sourceHash,
    },
    parser: {
      warnings: [],
      properties: {},
      units: 1,
    },
    normalized: {
      id: spec.symbolId,
      name: spec.symbolName,
      referencePrefix: spec.referencePrefix,
      description: spec.description,
      pins: spec.pins,
      sourceHash: spec.sourceHash,
      warnings: [],
      preview: spec.preview,
    },
    raw: {
      kind: "openpcb-builtin",
      name: spec.symbolName,
    },
  });
}
