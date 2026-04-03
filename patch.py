import sys

with open('src-react/src/components/symbol-editor/kicad-import.ts', 'r') as f:
    content = f.read()

content = content.replace(
"""import {
  DEFAULT_BODY_HEIGHT,
  DEFAULT_BODY_WIDTH,
  DEFAULT_PIN_LENGTH,
  GRID_SIZES,
  createEmptyDraft,
} from "./types";""",
"""import {
  DEFAULT_BODY_HEIGHT,
  DEFAULT_BODY_WIDTH,
  DEFAULT_PIN_LENGTH,
  GRID_SIZES,
  createEmptyDraft,
  PASSIVE_BODY_WIDTH,
  PASSIVE_BODY_HEIGHT,
} from "./types";"""
)

content = content.replace(
"""function isRectangularTwoSidedImportedIcLayout(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): graphics is [RectGraphic] {
  if (graphics.length !== 1 || graphics[0]?.type !== "rect") {
    return false;
  }

  if (pins.length < 4) {
    return false;
  }""",
"""function isRectangularTwoSidedImportedIcLayout(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): boolean {
  const rects = graphics.filter((g) => g.type === "rect");
  if (rects.length !== 1) {
    return false;
  }

  if (pins.length < 4) {
    return false;
  }"""
)

content = content.replace(
"""function normalizeRectangularTwoSidedImportedIcLayout(
  pins: SymbolPin[],
  bodyGraphic: RectGraphic,
): { pins: SymbolPin[]; graphics: [RectGraphic] } {
  const bodyWidth = clampImportedIcBodyWidth(bodyGraphic.height);
  const halfBodyWidth = bodyWidth / 2;
  const pinOffsetX = halfBodyWidth + DEFAULT_PIN_LENGTH;

  return {
    pins: pins.map((pin) => ({
      ...pin,
      position: {
        x: pin.side === "left" ? -pinOffsetX : pinOffsetX,
        y: pin.position.y,
      },
      length: DEFAULT_PIN_LENGTH,
    })),
    graphics: [
      {
        ...bodyGraphic,
        x: -halfBodyWidth,
        width: bodyWidth,
      },
    ],
  };
}""",
"""function normalizeRectangularTwoSidedImportedIcLayout(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): { pins: SymbolPin[]; graphics: SymbolGraphic[] } {
  const bodyGraphic = graphics.find((g) => g.type === "rect") as RectGraphic;
  if (!bodyGraphic) return { pins, graphics };

  const bodyWidth = clampImportedIcBodyWidth(bodyGraphic.height);
  const halfBodyWidth = bodyWidth / 2;
  const pinOffsetX = halfBodyWidth + DEFAULT_PIN_LENGTH;
  const scaleX = bodyWidth / bodyGraphic.width;

  const normalizedPins = pins.map((pin) => ({
    ...pin,
    position: {
      x: pin.side === "left" ? -pinOffsetX : pinOffsetX,
      y: pin.position.y,
    },
    length: DEFAULT_PIN_LENGTH,
  }));

  const normalizedGraphics = graphics.map((graphic) => {
    if (graphic.type === "rect" && graphic.id === bodyGraphic.id) {
      return {
        ...graphic,
        x: -halfBodyWidth,
        width: bodyWidth,
      };
    }
    if (graphic.type === "text") {
      return {
        ...graphic,
        x: graphic.x * scaleX,
        fontSize: graphic.fontSize,
      };
    }
    return graphic;
  });

  return {
    pins: normalizedPins,
    graphics: normalizedGraphics,
  };
}

function normalizeTwoTerminalPassiveLayout(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): { pins: SymbolPin[]; graphics: SymbolGraphic[] } {
  const bounds = getContentBounds([], graphics);
  if (!bounds) return { pins, graphics };

  const oldWidth = bounds.maxX - bounds.minX;
  const oldHeight = bounds.maxY - bounds.minY;

  if (oldWidth <= 0 || oldHeight <= 0) return { pins, graphics };

  const scaleX = PASSIVE_BODY_WIDTH / oldWidth;
  const scaleY = PASSIVE_BODY_HEIGHT / oldHeight;
  const scale = Math.min(scaleX, scaleY);

  const isVertical = pins[0]?.side === "top" || pins[0]?.side === "bottom";
  const pinOffsetX = isVertical ? 0 : PASSIVE_BODY_WIDTH / 2 + DEFAULT_PIN_LENGTH;
  const pinOffsetY = isVertical ? PASSIVE_BODY_HEIGHT / 2 + DEFAULT_PIN_LENGTH : 0;

  const normalizedPins = pins.map((pin) => ({
    ...pin,
    position: {
      x: pin.side === "left" ? -pinOffsetX : pin.side === "right" ? pinOffsetX : 0,
      y: pin.side === "top" ? -pinOffsetY : pin.side === "bottom" ? pinOffsetY : 0,
    },
    length: DEFAULT_PIN_LENGTH,
  }));

  const normalizedGraphics = graphics.map((graphic) => {
    switch (graphic.type) {
      case "rect":
        return {
          ...graphic,
          x: graphic.x * scale,
          y: graphic.y * scale,
          width: graphic.width * scale,
          height: graphic.height * scale,
        };
      case "line":
        return {
          ...graphic,
          x1: graphic.x1 * scale,
          y1: graphic.y1 * scale,
          x2: graphic.x2 * scale,
          y2: graphic.y2 * scale,
        };
      case "circle":
        return {
          ...graphic,
          cx: graphic.cx * scale,
          cy: graphic.cy * scale,
          radius: graphic.radius * scale,
        };
      case "arc":
        return {
          ...graphic,
          cx: graphic.cx * scale,
          cy: graphic.cy * scale,
          radius: graphic.radius * scale,
        };
      case "polygon":
        return {
          ...graphic,
          points: graphic.points.map((p) => ({ x: p.x * scale, y: p.y * scale })),
        };
      case "bezier":
        return {
          ...graphic,
          points: graphic.points.map((p) => ({ x: p.x * scale, y: p.y * scale })) as any,
        };
      case "text":
        return {
          ...graphic,
          x: graphic.x * scale,
          y: graphic.y * scale,
          fontSize: graphic.fontSize * scale,
        };
      default:
        return graphic;
    }
  });

  return {
    pins: normalizedPins,
    graphics: normalizedGraphics,
  };
}"""
)

content = content.replace(
"""function normalizeImportedSchematicContent(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
  classification: ImportedSymbolClassification,
): { pins: SymbolPin[]; graphics: SymbolGraphic[] } {
  if (
    (classification.kind === "rectangular-ic" ||
      classification.kind === "multi-unit-rectangular-ic") &&
    isRectangularTwoSidedImportedIcLayout(pins, graphics)
  ) {
    return normalizeRectangularTwoSidedImportedIcLayout(pins, graphics[0]);
  }

  return { pins, graphics };
}""",
"""function normalizeImportedSchematicContent(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
  classification: ImportedSymbolClassification,
): { pins: SymbolPin[]; graphics: SymbolGraphic[] } {
  if (
    (classification.kind === "rectangular-ic" ||
      classification.kind === "multi-unit-rectangular-ic") &&
    isRectangularTwoSidedImportedIcLayout(pins, graphics)
  ) {
    return normalizeRectangularTwoSidedImportedIcLayout(pins, graphics);
  }

  if (classification.kind === "two-terminal-passive") {
    return normalizeTwoTerminalPassiveLayout(pins, graphics);
  }

  return { pins, graphics };
}"""
)

with open('src-react/src/components/symbol-editor/kicad-import.ts', 'w') as f:
    f.write(content)
