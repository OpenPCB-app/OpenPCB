import {
  boundsFromGraphics,
  emptyBoundsMm,
  includeLabel,
  includePoint,
  isFiniteBoundsMm,
  normalizeBounds,
  translatePoint,
} from "./geometry";
import type {
  BoundsMm,
  BuildSymbolRenderModelOptions,
  PreviewGraphic,
  PreviewLabel,
  SymbolRenderModel,
  SymbolRenderModelPin,
  SymbolRenderSource,
} from "./types";

const DEFAULT_UNIT_GAP_MM = 2.0;
const PIN_NAME_GAP_MM = 0.4;
const PIN_NUMBER_GAP_MM = 0.7;

function normalizeRotation(rotationDeg: number): number {
  const normalized = rotationDeg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function rotationToSide(
  rotationDeg: number,
): "left" | "right" | "top" | "bottom" {
  const normalized = normalizeRotation(rotationDeg);
  if (normalized === 0) return "left";
  if (normalized === 180) return "right";
  if (normalized === 90) return "bottom";
  if (normalized === 270) return "top";
  return "left";
}

function pinBodyEnd(pin: {
  readonly positionMm: { x: number; y: number };
  readonly lengthMm: number;
  readonly rotationDeg: number;
}): { x: number; y: number } {
  const radians = (pin.rotationDeg * Math.PI) / 180;
  return {
    x: pin.positionMm.x + Math.cos(radians) * pin.lengthMm,
    y: pin.positionMm.y + Math.sin(radians) * pin.lengthMm,
  };
}

function createPinLabels(pin: SymbolRenderModelPin): PreviewLabel[] {
  const side = rotationToSide(pin.rotationDeg);
  const out: PreviewLabel[] = [];

  if (pin.name.trim().length > 0) {
    const nameAt =
      side === "left"
        ? { x: pin.bodyEnd.x + PIN_NAME_GAP_MM, y: pin.bodyEnd.y }
        : side === "right"
          ? { x: pin.bodyEnd.x - PIN_NAME_GAP_MM, y: pin.bodyEnd.y }
          : side === "top"
            ? { x: pin.bodyEnd.x, y: pin.bodyEnd.y + PIN_NAME_GAP_MM }
            : { x: pin.bodyEnd.x, y: pin.bodyEnd.y - PIN_NAME_GAP_MM };

    out.push({
      id: `${pin.id}:name`,
      text: pin.name,
      at: nameAt,
      fontSizeMm: 0.28,
      rotationDeg: 0,
      anchorX: side === "left" ? "left" : side === "right" ? "right" : "center",
      anchorY: "middle",
      role: "pin-name",
    });
  }

  if (pin.number && pin.number.trim().length > 0) {
    const numberAt =
      side === "left"
        ? { x: pin.anchor.x - PIN_NUMBER_GAP_MM, y: pin.anchor.y }
        : side === "right"
          ? { x: pin.anchor.x + PIN_NUMBER_GAP_MM, y: pin.anchor.y }
          : side === "top"
            ? { x: pin.anchor.x, y: pin.anchor.y + PIN_NUMBER_GAP_MM }
            : { x: pin.anchor.x, y: pin.anchor.y - PIN_NUMBER_GAP_MM };

    out.push({
      id: `${pin.id}:number`,
      text: pin.number,
      at: numberAt,
      fontSizeMm: 0.25,
      rotationDeg: 0,
      anchorX: side === "left" ? "right" : side === "right" ? "left" : "center",
      anchorY: "middle",
      role: "pin-number",
    });
  }

  return out;
}

function translatedGraphic(
  graphic: PreviewGraphic,
  dx: number,
): PreviewGraphic {
  switch (graphic.kind) {
    case "line":
      return {
        ...graphic,
        a: { x: graphic.a.x + dx, y: graphic.a.y },
        b: { x: graphic.b.x + dx, y: graphic.b.y },
      };
    case "rect":
      return { ...graphic, x: graphic.x + dx };
    case "circle":
      return {
        ...graphic,
        center: { x: graphic.center.x + dx, y: graphic.center.y },
      };
    case "arc3":
      return {
        ...graphic,
        start: { x: graphic.start.x + dx, y: graphic.start.y },
        mid: { x: graphic.mid.x + dx, y: graphic.mid.y },
        end: { x: graphic.end.x + dx, y: graphic.end.y },
      };
    case "polyline":
      return {
        ...graphic,
        points: graphic.points.map((point) => ({
          x: point.x + dx,
          y: point.y,
        })),
      };
    case "bezier":
      return {
        ...graphic,
        points: [
          { x: graphic.points[0].x + dx, y: graphic.points[0].y },
          { x: graphic.points[1].x + dx, y: graphic.points[1].y },
          { x: graphic.points[2].x + dx, y: graphic.points[2].y },
          { x: graphic.points[3].x + dx, y: graphic.points[3].y },
        ],
      };
  }
}

function withFallbackBody(
  graphics: readonly PreviewGraphic[],
  pins: readonly SymbolRenderModelPin[],
): readonly PreviewGraphic[] {
  if (graphics.length > 0 || pins.length === 0) {
    return graphics;
  }

  let bounds = emptyBoundsMm();
  for (const pin of pins) {
    bounds = includePoint(includePoint(bounds, pin.anchor), pin.bodyEnd);
  }

  if (!isFiniteBoundsMm(bounds)) {
    return graphics;
  }

  const padded = {
    minX: bounds.minX + 0.6,
    minY: bounds.minY - 1.2,
    maxX: bounds.maxX - 0.6,
    maxY: bounds.maxY + 1.2,
  };

  return [
    {
      kind: "rect",
      x: Math.min(padded.minX, padded.maxX),
      y: Math.min(padded.minY, padded.maxY),
      width: Math.abs(padded.maxX - padded.minX),
      height: Math.abs(padded.maxY - padded.minY),
      fill: "none",
      strokeWidthMm: 0.15,
    },
  ];
}

function composeBounds(
  graphics: readonly PreviewGraphic[],
  pins: readonly SymbolRenderModelPin[],
  labels: readonly PreviewLabel[],
): BoundsMm | null {
  let bounds = boundsFromGraphics(graphics) ?? emptyBoundsMm();

  for (const pin of pins) {
    bounds = includePoint(includePoint(bounds, pin.anchor), pin.bodyEnd);
  }

  for (const label of labels) {
    bounds = includeLabel(bounds, label);
  }

  if (!isFiniteBoundsMm(bounds)) {
    return null;
  }

  return normalizeBounds(bounds, 1.5);
}

export function buildSymbolRenderModel(
  source: SymbolRenderSource,
  options: BuildSymbolRenderModelOptions = {},
): SymbolRenderModel {
  const composeAllUnits = options.composeAllUnits ?? true;
  const includeHiddenPins = options.includeHiddenPins ?? false;
  const unitGapMm = options.unitGapMm ?? DEFAULT_UNIT_GAP_MM;
  const preserveOrigin = options.preserveOrigin ?? false;

  const unitCount = Math.max(source.unitCount, 1);
  const effectiveUnitCount = composeAllUnits ? unitCount : 1;

  const graphicsOut: PreviewGraphic[] = [];
  const pinsOut: SymbolRenderModelPin[] = [];
  const labelsOut: PreviewLabel[] = [];

  let cursorX = 0;
  let globalBounds = emptyBoundsMm();

  for (let unit = 1; unit <= effectiveUnitCount; unit += 1) {
    const localPins = source.pins
      .filter((pin) => (includeHiddenPins ? true : !pin.hidden))
      .filter((pin) => pin.unit === unit || pin.unit === 0)
      .map<SymbolRenderModelPin>((pin) => {
        const bodyEnd = pinBodyEnd(pin);
        return {
          id: pin.id,
          name: pin.name,
          number: pin.number,
          electricalType: pin.electricalType,
          unit: pin.unit,
          anchor: { x: pin.positionMm.x, y: pin.positionMm.y },
          bodyEnd,
          rotationDeg: pin.rotationDeg,
        };
      });

    const unitGraphics = source.graphics
      .filter((graphic) => graphic.unit === 0 || graphic.unit === unit)
      .map((entry) => entry.graphic);

    const graphicsWithFallback = withFallbackBody(unitGraphics, localPins);

    const localLabelsFromPins = localPins.flatMap((pin) =>
      createPinLabels(pin),
    );
    const localLabelsFromSource = (source.labels ?? [])
      .filter((entry) => entry.unit === 0 || entry.unit === unit)
      .map((entry) => entry.label);
    const localLabels = [...localLabelsFromPins, ...localLabelsFromSource];
    const localBounds = composeBounds(
      graphicsWithFallback,
      localPins,
      localLabels,
    );

    const shiftX = preserveOrigin
      ? 0
      : localBounds === null
        ? cursorX
        : cursorX - localBounds.minX + (unit > 1 ? unitGapMm : 0);

    for (const graphic of graphicsWithFallback) {
      graphicsOut.push(translatedGraphic(graphic, shiftX));
    }

    for (const pin of localPins) {
      pinsOut.push({
        ...pin,
        anchor: translatePoint(pin.anchor, shiftX, 0),
        bodyEnd: translatePoint(pin.bodyEnd, shiftX, 0),
      });
    }

    for (const label of localLabels) {
      labelsOut.push({
        ...label,
        at: translatePoint(label.at, shiftX, 0),
      });
    }

    if (localBounds) {
      const shiftedBounds = {
        minX: localBounds.minX + shiftX,
        minY: localBounds.minY,
        maxX: localBounds.maxX + shiftX,
        maxY: localBounds.maxY,
      };
      globalBounds = {
        minX: Math.min(globalBounds.minX, shiftedBounds.minX),
        minY: Math.min(globalBounds.minY, shiftedBounds.minY),
        maxX: Math.max(globalBounds.maxX, shiftedBounds.maxX),
        maxY: Math.max(globalBounds.maxY, shiftedBounds.maxY),
      };
      cursorX = shiftedBounds.maxX;
    }
  }

  const composedBounds = composeBounds(graphicsOut, pinsOut, labelsOut);
  const finalBounds =
    composedBounds ??
    (isFiniteBoundsMm(globalBounds)
      ? normalizeBounds(globalBounds, 1.5)
      : null);

  if (finalBounds) {
    if (source.referenceText.trim().length > 0) {
      labelsOut.push({
        id: "symbol:reference",
        text: source.referenceText,
        at: {
          x: (finalBounds.minX + finalBounds.maxX) / 2,
          y: finalBounds.maxY + 0.4,
        },
        fontSizeMm: 0.35,
        rotationDeg: 0,
        anchorX: "center",
        anchorY: "bottom",
        role: "reference",
      });
    }
    if (
      source.valueText.trim().length > 0 &&
      source.valueText !== source.referenceText
    ) {
      labelsOut.push({
        id: "symbol:value",
        text: source.valueText,
        at: {
          x: (finalBounds.minX + finalBounds.maxX) / 2,
          y: finalBounds.minY - 0.4,
        },
        fontSizeMm: 0.30,
        rotationDeg: 0,
        anchorX: "center",
        anchorY: "top",
        role: "value",
      });
    }
  }

  const resolvedBounds = composeBounds(graphicsOut, pinsOut, labelsOut);

  return {
    kind: "symbol",
    units: "mm",
    name: source.name,
    unitCount,
    graphics: graphicsOut,
    pins: pinsOut,
    labels: labelsOut,
    bounds: resolvedBounds,
    warnings: source.warnings,
  };
}
