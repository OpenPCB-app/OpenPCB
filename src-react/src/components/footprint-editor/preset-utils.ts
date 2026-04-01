/**
 * Footprint Preset Utilities
 *
 * Functions to generate footprint pads from preset configurations.
 */

import type {
  Millimeters,
  PadDefinition,
  FootprintGraphic,
  FootprintPresetKind,
  PresetConfig,
  Chip2TerminalConfig,
  SoicConfig,
  QfpConfig,
  QfnConfig,
  BgaConfig,
  DipConfig,
  SotConfig,
  SodConfig,
  MelfConfig,
  SojConfig,
  PlccConfig,
  DpakConfig,
  PolarizedCapConfig,
} from "./types";
import { createPad } from "./types";

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function generatePadId(): string {
  return crypto.randomUUID();
}

function createPadWithDefaults(
  number: string,
  x: Millimeters,
  y: Millimeters,
  width: Millimeters,
  height: Millimeters,
  options: Partial<PadDefinition> = {},
): PadDefinition {
  return createPad(generatePadId(), {
    number,
    name: "",
    type: options.type ?? "smd",
    shape: options.shape ?? "rect",
    position: { x, y },
    size: { width, height },
    rotation: options.rotation ?? 0,
    roundrectRatio: options.roundrectRatio,
    layers: options.layers ?? ["F.Cu", "F.Mask"],
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Graphics Generation
// ---------------------------------------------------------------------------

function createCourtyardRect(
  width: Millimeters,
  height: Millimeters,
  strokeWidth: Millimeters = 0.05,
): FootprintGraphic {
  return {
    id: generatePadId(),
    type: "rect",
    layer: "F.CrtYd",
    position: { x: 0, y: 0 },
    width,
    height,
    strokeWidth,
    filled: false,
  };
}

function createFabRect(
  width: Millimeters,
  height: Millimeters,
  strokeWidth: Millimeters = 0.1,
): FootprintGraphic {
  return {
    id: generatePadId(),
    type: "rect",
    layer: "F.Fab",
    position: { x: 0, y: 0 },
    width,
    height,
    strokeWidth,
    filled: false,
  };
}

function createSilkscreenRect(
  width: Millimeters,
  height: Millimeters,
  strokeWidth: Millimeters = 0.12,
): FootprintGraphic {
  return {
    id: generatePadId(),
    type: "rect",
    layer: "F.SilkS",
    position: { x: 0, y: 0 },
    width,
    height,
    strokeWidth,
    filled: false,
  };
}

// ---------------------------------------------------------------------------
// Preset Generators
// ---------------------------------------------------------------------------

/**
 * Generate pads for 2-terminal chip components (resistors, capacitors, inductors).
 * Layout: Two pads on left and right sides of body.
 */
export function generateChip2TerminalPads(
  config: Chip2TerminalConfig,
): PadDefinition[] {
  const { padWidth, padHeight, padSpacing } = config;
  const halfSpacing = padSpacing / 2;

  return [
    createPadWithDefaults("1", -halfSpacing, 0, padWidth, padHeight),
    createPadWithDefaults("2", halfSpacing, 0, padWidth, padHeight),
  ];
}

export function generateChip2TerminalGraphics(
  config: Chip2TerminalConfig,
): FootprintGraphic[] {
  const { bodyWidth, bodyHeight } = config;
  const courtyardMargin = 0.25;

  return [
    createCourtyardRect(
      bodyWidth + courtyardMargin * 2,
      bodyHeight + courtyardMargin * 2,
    ),
    createFabRect(bodyWidth, bodyHeight),
    createSilkscreenRect(bodyWidth + 0.1, bodyHeight + 0.1),
  ];
}

/**
 * Generate pads for SOIC (Small Outline IC) packages.
 * Layout: Two rows of pads on left and right sides.
 */
export function generateSoicPads(config: SoicConfig): PadDefinition[] {
  const { pinCount, pitch, padWidth, padHeight, rowSpacing } = config;
  const padsPerSide = pinCount / 2;
  const halfRowSpacing = rowSpacing / 2;
  const totalHeight = (padsPerSide - 1) * pitch;
  const startY = totalHeight / 2;

  const pads: PadDefinition[] = [];

  // Left side (pins 1 to N/2, top to bottom)
  for (let i = 0; i < padsPerSide; i++) {
    const y = startY - i * pitch;
    pads.push(
      createPadWithDefaults(
        String(i + 1),
        -halfRowSpacing,
        y,
        padWidth,
        padHeight,
      ),
    );
  }

  // Right side (pins N/2+1 to N, bottom to top)
  for (let i = 0; i < padsPerSide; i++) {
    const y = -startY + i * pitch;
    pads.push(
      createPadWithDefaults(
        String(padsPerSide + i + 1),
        halfRowSpacing,
        y,
        padWidth,
        padHeight,
      ),
    );
  }

  return pads;
}

export function generateSoicGraphics(config: SoicConfig): FootprintGraphic[] {
  const { bodyWidth, rowSpacing, pinCount, pitch, padHeight } = config;
  const padsPerSide = pinCount / 2;
  const bodyHeight = (padsPerSide - 1) * pitch + padHeight;
  const courtyardMargin = 0.5;

  const graphics: FootprintGraphic[] = [
    createCourtyardRect(
      rowSpacing + courtyardMargin * 2,
      bodyHeight + courtyardMargin * 2,
    ),
    createFabRect(bodyWidth, bodyHeight),
  ];

  // Pin 1 marker (semicircle notch on left side)
  const markerY = bodyHeight / 2;
  graphics.push({
    id: generatePadId(),
    type: "circle",
    layer: "F.SilkS",
    center: { x: -bodyWidth / 2 - 0.2, y: markerY - bodyHeight / 4 },
    radius: 0.3,
    strokeWidth: 0.12,
    filled: false,
  });

  return graphics;
}

/**
 * Generate pads for QFP (Quad Flat Package).
 * Layout: Four sides of pads around a rectangular body.
 */
export function generateQfpPads(config: QfpConfig): PadDefinition[] {
  const { pinsPerSide, pitch, padWidth, padHeight, bodyWidth } = config;
  const halfBody = bodyWidth / 2;
  const totalLength = (pinsPerSide - 1) * pitch;
  const startY = totalLength / 2;

  const pads: PadDefinition[] = [];
  let pinNum = 1;

  // Bottom side (pins 1 to N, left to right)
  for (let i = 0; i < pinsPerSide; i++) {
    const x = -startY + i * pitch;
    pads.push(
      createPadWithDefaults(
        String(pinNum++),
        x,
        -halfBody,
        padWidth,
        padHeight,
      ),
    );
  }

  // Right side (pins N+1 to 2N, bottom to top)
  for (let i = 0; i < pinsPerSide; i++) {
    const y = -startY + i * pitch;
    pads.push(
      createPadWithDefaults(
        String(pinNum++),
        halfBody,
        y,
        padHeight,
        padWidth,
        { rotation: 90 },
      ),
    );
  }

  // Top side (pins 2N+1 to 3N, right to left)
  for (let i = 0; i < pinsPerSide; i++) {
    const x = startY - i * pitch;
    pads.push(
      createPadWithDefaults(String(pinNum++), x, halfBody, padWidth, padHeight),
    );
  }

  // Left side (pins 3N+1 to 4N, top to bottom)
  for (let i = 0; i < pinsPerSide; i++) {
    const y = startY - i * pitch;
    pads.push(
      createPadWithDefaults(
        String(pinNum++),
        -halfBody,
        y,
        padHeight,
        padWidth,
        { rotation: 90 },
      ),
    );
  }

  return pads;
}

export function generateQfpGraphics(config: QfpConfig): FootprintGraphic[] {
  const { bodyWidth } = config;
  const bodyHeight = bodyWidth;
  const courtyardMargin = 0.5;

  const graphics: FootprintGraphic[] = [
    createCourtyardRect(
      bodyWidth + courtyardMargin * 2,
      bodyHeight + courtyardMargin * 2,
    ),
    createFabRect(bodyWidth, bodyHeight),
    createSilkscreenRect(bodyWidth + 0.1, bodyHeight + 0.1),
  ];

  // Pin 1 marker (corner notch)
  graphics.push({
    id: generatePadId(),
    type: "circle",
    layer: "F.SilkS",
    center: { x: -bodyWidth / 2 - 0.3, y: bodyHeight / 2 - 0.3 },
    radius: 0.25,
    strokeWidth: 0.12,
    filled: false,
  });

  return graphics;
}

/**
 * Generate pads for QFN (Quad Flat No-lead) packages.
 * Similar to QFP but with optional center thermal pad.
 */
export function generateQfnPads(config: QfnConfig): PadDefinition[] {
  const {
    pinsPerSide,
    pitch,
    padWidth,
    padHeight,
    bodyWidth,
    hasCenterPad,
    centerPadSize,
  } = config;
  const halfBody = bodyWidth / 2;
  const totalLength = (pinsPerSide - 1) * pitch;
  const startY = totalLength / 2;

  const pads: PadDefinition[] = [];
  let pinNum = 1;

  // Bottom side
  for (let i = 0; i < pinsPerSide; i++) {
    const x = -startY + i * pitch;
    pads.push(
      createPadWithDefaults(
        String(pinNum++),
        x,
        -halfBody,
        padWidth,
        padHeight,
      ),
    );
  }

  // Right side
  for (let i = 0; i < pinsPerSide; i++) {
    const y = -startY + i * pitch;
    pads.push(
      createPadWithDefaults(
        String(pinNum++),
        halfBody,
        y,
        padHeight,
        padWidth,
        { rotation: 90 },
      ),
    );
  }

  // Top side
  for (let i = 0; i < pinsPerSide; i++) {
    const x = startY - i * pitch;
    pads.push(
      createPadWithDefaults(String(pinNum++), x, halfBody, padWidth, padHeight),
    );
  }

  // Left side
  for (let i = 0; i < pinsPerSide; i++) {
    const y = startY - i * pitch;
    pads.push(
      createPadWithDefaults(
        String(pinNum++),
        -halfBody,
        y,
        padHeight,
        padWidth,
        { rotation: 90 },
      ),
    );
  }

  // Center thermal pad
  if (hasCenterPad && centerPadSize) {
    pads.push(
      createPadWithDefaults("EP", 0, 0, centerPadSize, centerPadSize, {
        name: "EP",
        type: "smd",
        shape: "rect",
      }),
    );
  }

  return pads;
}

/**
 * Generate pads for BGA (Ball Grid Array) packages.
 * Layout: Grid of balls.
 */
export function generateBgaPads(config: BgaConfig): PadDefinition[] {
  const { cols, rows, pitch, ballDiameter } = config;
  const halfCols = (cols - 1) / 2;
  const halfRows = (rows - 1) / 2;

  const pads: PadDefinition[] = [];
  let pinNum = 1;

  for (let row = 0; row < rows; row++) {
    const y = (row - halfRows) * pitch;
    for (let col = 0; col < cols; col++) {
      const x = (col - halfCols) * pitch;
      // BGA pin numbering: A1, A2, ... B1, B2, etc.
      const rowLetter = String.fromCharCode(65 + row); // A, B, C, ...
      const pinLabel = `${rowLetter}${col + 1}`;
      pads.push(
        createPadWithDefaults(pinLabel, x, y, ballDiameter, ballDiameter, {
          name: pinLabel,
          shape: "circle",
        }),
      );
      pinNum++;
    }
  }

  return pads;
}

/**
 * Generate pads for DIP (Dual In-line Package) through-hole.
 */
export function generateDipPads(config: DipConfig): PadDefinition[] {
  const { pinCount, pitch, rowSpacing, drillDiameter, padDiameter } = config;
  const padsPerSide = pinCount / 2;
  const halfRowSpacing = rowSpacing / 2;
  const totalHeight = (padsPerSide - 1) * pitch;
  const startY = totalHeight / 2;

  const pads: PadDefinition[] = [];

  // Left side (pins 1 to N/2, top to bottom)
  for (let i = 0; i < padsPerSide; i++) {
    const y = startY - i * pitch;
    pads.push(
      createPadWithDefaults(
        String(i + 1),
        -halfRowSpacing,
        y,
        padDiameter,
        padDiameter,
        {
          type: "thru_hole",
          shape: "circle",
          drillDiameter,
        },
      ),
    );
  }

  // Right side (pins N/2+1 to N, bottom to top)
  for (let i = 0; i < padsPerSide; i++) {
    const y = -startY + i * pitch;
    pads.push(
      createPadWithDefaults(
        String(padsPerSide + i + 1),
        halfRowSpacing,
        y,
        padDiameter,
        padDiameter,
        {
          type: "thru_hole",
          shape: "circle",
          drillDiameter,
        },
      ),
    );
  }

  return pads;
}

// ---------------------------------------------------------------------------
// Main Generator Function
// ---------------------------------------------------------------------------

/**
 * Generate pads and graphics from a preset configuration.
 */
export function generateFromPreset(
  preset: FootprintPresetKind,
  config: PresetConfig,
): { pads: PadDefinition[]; graphics: FootprintGraphic[] } {
  switch (preset) {
    case "chip_2terminal":
      return {
        pads: generateChip2TerminalPads(config as Chip2TerminalConfig),
        graphics: generateChip2TerminalGraphics(config as Chip2TerminalConfig),
      };
    case "soic":
      return {
        pads: generateSoicPads(config as SoicConfig),
        graphics: generateSoicGraphics(config as SoicConfig),
      };
    case "qfp":
      return {
        pads: generateQfpPads(config as QfpConfig),
        graphics: generateQfpGraphics(config as QfpConfig),
      };
    case "qfn": {
      const qfnConfig = config as QfnConfig;
      const qfnPadExtent = qfnConfig.bodyWidth + qfnConfig.padHeight * 2;
      const qfnMargin = 0.25;
      return {
        pads: generateQfnPads(qfnConfig),
        graphics: [
          createCourtyardRect(
            qfnPadExtent + qfnMargin * 2,
            qfnPadExtent + qfnMargin * 2,
          ),
          createFabRect(qfnConfig.bodyWidth, qfnConfig.bodyWidth),
        ],
      };
    }
    case "bga": {
      const bgaConfig = config as BgaConfig;
      const bgaWidth =
        (bgaConfig.cols - 1) * bgaConfig.pitch + bgaConfig.ballDiameter;
      const bgaHeight =
        (bgaConfig.rows - 1) * bgaConfig.pitch + bgaConfig.ballDiameter;
      const bgaMargin = 0.25;
      return {
        pads: generateBgaPads(bgaConfig),
        graphics: [
          createCourtyardRect(
            bgaWidth + bgaMargin * 2,
            bgaHeight + bgaMargin * 2,
          ),
          createFabRect(bgaWidth, bgaHeight),
        ],
      };
    }
    case "dip": {
      const dipConfig = config as DipConfig;
      const padsPerSide = dipConfig.pinCount / 2;
      const dipHeight =
        (padsPerSide - 1) * dipConfig.pitch + dipConfig.padDiameter;
      const dipWidth = dipConfig.rowSpacing + dipConfig.padDiameter;
      const dipMargin = 0.5;
      return {
        pads: generateDipPads(dipConfig),
        graphics: [
          createCourtyardRect(
            dipWidth + dipMargin * 2,
            dipHeight + dipMargin * 2,
          ),
          createFabRect(dipConfig.bodyWidth, dipHeight),
        ],
      };
    }
    case "sot":
      return generateSotPreset(config as SotConfig);
    case "sod": {
      const sodConfig = config as SodConfig;
      const chip2t: Chip2TerminalConfig = {
        kind: "chip_2terminal",
        padWidth: sodConfig.padWidth,
        padHeight: sodConfig.padHeight,
        padSpacing: sodConfig.padSpacing,
        bodyWidth: sodConfig.bodyWidth,
        bodyHeight: sodConfig.bodyHeight,
      };
      return {
        pads: generateChip2TerminalPads(chip2t),
        graphics: generateSodGraphics(sodConfig),
      };
    }
    case "melf": {
      const melfConfig = config as MelfConfig;
      return {
        pads: generateMelfPads(melfConfig),
        graphics: generateChip2TerminalGraphics({
          kind: "chip_2terminal",
          padWidth: melfConfig.padWidth,
          padHeight: melfConfig.padHeight,
          padSpacing: melfConfig.padSpacing,
          bodyWidth: melfConfig.bodyWidth,
          bodyHeight: melfConfig.bodyDiameter,
        }),
      };
    }
    case "soj": {
      const sojConfig = config as SojConfig;
      const soicCompat: SoicConfig = {
        kind: "soic",
        pinCount: sojConfig.pinCount,
        pitch: sojConfig.pitch,
        padWidth: sojConfig.padWidth,
        padHeight: sojConfig.padHeight,
        bodyWidth: sojConfig.bodyWidth,
        rowSpacing: sojConfig.rowSpacing,
      };
      return {
        pads: generateSoicPads(soicCompat),
        graphics: generateSoicGraphics(soicCompat),
      };
    }
    case "plcc": {
      const plccConfig = config as PlccConfig;
      const qfpCompat: QfpConfig = {
        kind: "qfp",
        pinsPerSide: plccConfig.pinsPerSide,
        pitch: plccConfig.pitch,
        padWidth: plccConfig.padWidth,
        padHeight: plccConfig.padHeight,
        bodyWidth: plccConfig.bodyWidth,
        hasCornerPad: false,
      };
      return {
        pads: generateQfpPads(qfpCompat),
        graphics: generateQfpGraphics(qfpCompat),
      };
    }
    case "dpak":
      return generateDpakPreset(config as DpakConfig);
    case "polarized_cap": {
      const polCapConfig = config as PolarizedCapConfig;
      const chip2tPol: Chip2TerminalConfig = {
        kind: "chip_2terminal",
        padWidth: polCapConfig.padWidth,
        padHeight: polCapConfig.padHeight,
        padSpacing: polCapConfig.padSpacing,
        bodyWidth: polCapConfig.bodyWidth,
        bodyHeight: polCapConfig.bodyHeight,
      };
      return {
        pads: generateChip2TerminalPads(chip2tPol),
        graphics: generatePolarizedCapGraphics(polCapConfig),
      };
    }
    case "import":
      return { pads: [], graphics: [] };
    default:
      return { pads: [], graphics: [] };
  }
}

// ---------------------------------------------------------------------------
// SOT Preset (Fixed Dimensions)
// ---------------------------------------------------------------------------

interface SotDimensions {
  pads: Array<{
    number: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  bodyWidth: number;
  bodyHeight: number;
}

// SOT dimensions: bodyWidth/bodyHeight = outline for fab/courtyard (includes lead overhang).
// Pad positions based on IPC-7351B nominal land patterns.
// Sources: JEDEC MO-178 (SOT-23), TO-261 (SOT-223), MO-192 (SOT-323/353/363)
const SOT_DIMENSIONS: Record<string, SotDimensions> = {
  sot23: {
    // JEDEC MO-178: 3-pin, 0.95mm pitch, 2.9mm lead-to-lead span
    pads: [
      { number: "1", x: -0.95, y: -1.0, width: 0.6, height: 0.7 },
      { number: "2", x: 0.95, y: -1.0, width: 0.6, height: 0.7 },
      { number: "3", x: 0, y: 1.0, width: 0.6, height: 0.7 },
    ],
    bodyWidth: 2.9, // total horizontal span (lead tip to lead tip)
    bodyHeight: 2.5, // total vertical span including leads
  },
  sot223: {
    // JEDEC TO-261: 3+tab, 2.3mm pitch, 6.5mm lead span
    pads: [
      { number: "1", x: -2.3, y: -3.15, width: 0.7, height: 1.5 },
      { number: "2", x: 0, y: -3.15, width: 0.7, height: 1.5 },
      { number: "3", x: 2.3, y: -3.15, width: 0.7, height: 1.5 },
      { number: "4", x: 0, y: 3.15, width: 3.8, height: 1.5 },
    ],
    bodyWidth: 6.5,
    bodyHeight: 7.0,
  },
  sot323: {
    // JEDEC MO-192 Variant AA: 3-pin, 0.65mm pitch
    pads: [
      { number: "1", x: -0.65, y: -0.85, width: 0.45, height: 0.55 },
      { number: "2", x: 0.65, y: -0.85, width: 0.45, height: 0.55 },
      { number: "3", x: 0, y: 0.85, width: 0.45, height: 0.55 },
    ],
    bodyWidth: 2.0, // total span
    bodyHeight: 2.1,
  },
  sot353: {
    pads: [
      { number: "1", x: -0.65, y: -0.95, width: 0.4, height: 0.55 },
      { number: "2", x: 0, y: -0.95, width: 0.4, height: 0.55 },
      { number: "3", x: 0.65, y: -0.95, width: 0.4, height: 0.55 },
      { number: "4", x: 0.65, y: 0.95, width: 0.4, height: 0.55 },
      { number: "5", x: -0.65, y: 0.95, width: 0.4, height: 0.55 },
    ],
    bodyWidth: 1.25,
    bodyHeight: 2.0,
  },
  sot363: {
    pads: [
      { number: "1", x: -0.65, y: -0.95, width: 0.4, height: 0.55 },
      { number: "2", x: 0, y: -0.95, width: 0.4, height: 0.55 },
      { number: "3", x: 0.65, y: -0.95, width: 0.4, height: 0.55 },
      { number: "4", x: 0.65, y: 0.95, width: 0.4, height: 0.55 },
      { number: "5", x: 0, y: 0.95, width: 0.4, height: 0.55 },
      { number: "6", x: -0.65, y: 0.95, width: 0.4, height: 0.55 },
    ],
    bodyWidth: 1.25,
    bodyHeight: 2.0,
  },
  sot523: {
    pads: [
      { number: "1", x: -0.65, y: -0.75, width: 0.35, height: 0.45 },
      { number: "2", x: 0, y: -0.75, width: 0.35, height: 0.45 },
      { number: "3", x: 0.65, y: -0.75, width: 0.35, height: 0.45 },
      { number: "4", x: 0.325, y: 0.75, width: 0.35, height: 0.45 },
      { number: "5", x: -0.325, y: 0.75, width: 0.35, height: 0.45 },
    ],
    bodyWidth: 1.0,
    bodyHeight: 1.6,
  },
  sot723: {
    pads: [
      { number: "1", x: -0.4, y: -0.55, width: 0.3, height: 0.4 },
      { number: "2", x: 0, y: -0.55, width: 0.3, height: 0.4 },
      { number: "3", x: 0.4, y: -0.55, width: 0.3, height: 0.4 },
      { number: "4", x: 0.4, y: 0.55, width: 0.3, height: 0.4 },
      { number: "5", x: 0, y: 0.55, width: 0.3, height: 0.4 },
      { number: "6", x: -0.4, y: 0.55, width: 0.3, height: 0.4 },
      { number: "7", x: 0, y: 0, width: 0.3, height: 0.4 },
      { number: "8", x: 0.2, y: 0, width: 0.3, height: 0.4 },
    ],
    bodyWidth: 0.8,
    bodyHeight: 1.2,
  },
};

function generateSotPreset(config: SotConfig): {
  pads: PadDefinition[];
  graphics: FootprintGraphic[];
} {
  const dims = SOT_DIMENSIONS[config.variant];
  if (!dims) return { pads: [], graphics: [] };

  const pads = dims.pads.map((p) =>
    createPadWithDefaults(p.number, p.x, p.y, p.width, p.height),
  );

  const margin = 0.25;
  const graphics: FootprintGraphic[] = [
    createCourtyardRect(
      dims.bodyWidth + margin * 2,
      dims.bodyHeight + margin * 2,
    ),
    createFabRect(dims.bodyWidth, dims.bodyHeight),
  ];

  // Pin 1 marker
  const firstPad = dims.pads[0];
  if (firstPad) {
    graphics.push({
      id: generatePadId(),
      type: "circle",
      layer: "F.SilkS",
      center: { x: firstPad.x - 0.4, y: firstPad.y },
      radius: 0.15,
      strokeWidth: 0.12,
      filled: true,
    });
  }

  return { pads, graphics };
}

// ---------------------------------------------------------------------------
// New Family Generators
// ---------------------------------------------------------------------------

function generateSodGraphics(config: SodConfig): FootprintGraphic[] {
  const { bodyWidth, bodyHeight } = config;
  const margin = 0.25;
  const graphics: FootprintGraphic[] = [
    createCourtyardRect(bodyWidth + margin * 2, bodyHeight + margin * 2),
    createFabRect(bodyWidth, bodyHeight),
    createSilkscreenRect(bodyWidth + 0.1, bodyHeight + 0.1),
  ];
  // Cathode band (line on right side)
  graphics.push({
    id: generatePadId(),
    type: "line",
    layer: "F.SilkS",
    start: { x: bodyWidth * 0.3, y: -bodyHeight / 2 - 0.05 },
    end: { x: bodyWidth * 0.3, y: bodyHeight / 2 + 0.05 },
    strokeWidth: 0.15,
  });
  return graphics;
}

function generateMelfPads(config: MelfConfig): PadDefinition[] {
  const { padWidth, padHeight, padSpacing } = config;
  const halfSpacing = padSpacing / 2;
  return [
    createPadWithDefaults("1", -halfSpacing, 0, padWidth, padHeight, {
      shape: "oval",
    }),
    createPadWithDefaults("2", halfSpacing, 0, padWidth, padHeight, {
      shape: "oval",
    }),
  ];
}

function generateDpakPreset(config: DpakConfig): {
  pads: PadDefinition[];
  graphics: FootprintGraphic[];
} {
  const isDpak = config.variant === "dpak";
  // TO-252 (DPAK): lead pitch 2.28mm, tab 5.4x6.0mm, body 6.5x8.0mm
  // TO-263 (D2PAK): lead pitch 5.08mm, tab 10.0x10.0mm, body 10.0x13.0mm
  const tabW = config.tabWidth || (isDpak ? 5.4 : 10.0);
  const tabH = config.tabHeight || (isDpak ? 6.0 : 10.0);
  const pitch = isDpak ? 2.28 : 5.08;

  // Pads ordered by pin number (1=gate, 2=drain/tab, 3=source)
  const pads: PadDefinition[] = [
    createPadWithDefaults("1", -pitch / 2, -3.5, 1.0, 1.5),
    createPadWithDefaults("2", 0, 2.5, tabW, tabH),
    createPadWithDefaults("3", pitch / 2, -3.5, 1.0, 1.5),
  ];

  const bodyW = isDpak ? 6.5 : 10.0;
  const bodyH = isDpak ? 8.0 : 13.0;
  const margin = 0.5;
  const graphics: FootprintGraphic[] = [
    createCourtyardRect(bodyW + margin * 2, bodyH + margin * 2),
    createFabRect(bodyW, bodyH),
  ];

  return { pads, graphics };
}

function generatePolarizedCapGraphics(
  config: PolarizedCapConfig,
): FootprintGraphic[] {
  const { bodyWidth, bodyHeight } = config;
  const margin = 0.25;
  const graphics: FootprintGraphic[] = [
    createCourtyardRect(bodyWidth + margin * 2, bodyHeight + margin * 2),
    createFabRect(bodyWidth, bodyHeight),
    createSilkscreenRect(bodyWidth + 0.1, bodyHeight + 0.1),
  ];
  // Polarity marker (+) on left side
  graphics.push({
    id: generatePadId(),
    type: "line",
    layer: "F.SilkS",
    start: { x: -bodyWidth / 2 - 0.3, y: -0.2 },
    end: { x: -bodyWidth / 2 - 0.3, y: 0.2 },
    strokeWidth: 0.15,
  });
  graphics.push({
    id: generatePadId(),
    type: "line",
    layer: "F.SilkS",
    start: { x: -bodyWidth / 2 - 0.5, y: 0 },
    end: { x: -bodyWidth / 2 - 0.1, y: 0 },
    strokeWidth: 0.15,
  });
  return graphics;
}

// ---------------------------------------------------------------------------
// Default Configurations
// ---------------------------------------------------------------------------

export const DEFAULT_PRESET_CONFIGS: Record<FootprintPresetKind, PresetConfig> =
  {
    chip_2terminal: {
      kind: "chip_2terminal",
      padWidth: 0.7,
      padHeight: 0.95,
      padSpacing: 1.55,
      bodyWidth: 1.6,
      bodyHeight: 0.8,
    },
    soic: {
      kind: "soic",
      pinCount: 8,
      pitch: 1.27,
      padWidth: 0.6,
      padHeight: 1.55,
      bodyWidth: 4.0,
      rowSpacing: 5.4,
    },
    qfp: {
      kind: "qfp",
      pinsPerSide: 16,
      pitch: 0.5,
      padWidth: 0.25,
      padHeight: 1.5,
      bodyWidth: 7.0,
      hasCornerPad: false,
    },
    qfn: {
      kind: "qfn",
      pinsPerSide: 16,
      pitch: 0.5,
      padWidth: 0.25,
      padHeight: 0.75,
      bodyWidth: 4.0,
      hasCenterPad: false,
      centerPadSize: 2.0,
    },
    bga: {
      kind: "bga",
      cols: 4,
      rows: 4,
      pitch: 0.8,
      ballDiameter: 0.4,
    },
    dip: {
      kind: "dip",
      pinCount: 8,
      pitch: 2.54,
      rowSpacing: 7.62,
      drillDiameter: 0.8,
      padDiameter: 1.6,
      bodyWidth: 6.0,
    },
    sot: {
      kind: "sot",
      variant: "sot23",
    },
    sod: {
      kind: "sod",
      padWidth: 0.6,
      padHeight: 0.8,
      padSpacing: 2.2,
      bodyWidth: 1.7,
      bodyHeight: 1.25,
    },
    melf: {
      kind: "melf",
      padWidth: 0.8,
      padHeight: 1.2,
      padSpacing: 3.5,
      bodyWidth: 3.5,
      bodyDiameter: 1.6,
    },
    soj: {
      kind: "soj",
      pinCount: 20,
      pitch: 1.27,
      padWidth: 0.6,
      padHeight: 1.55,
      bodyWidth: 7.5,
      rowSpacing: 7.62,
    },
    plcc: {
      kind: "plcc",
      pinsPerSide: 11,
      pitch: 1.27,
      padWidth: 0.6,
      padHeight: 1.55,
      bodyWidth: 17.5,
    },
    dpak: {
      kind: "dpak",
      variant: "dpak",
      tabWidth: 5.4,
      tabHeight: 6.0,
    },
    polarized_cap: {
      kind: "polarized_cap",
      padWidth: 1.0,
      padHeight: 1.0,
      padSpacing: 2.4,
      bodyWidth: 3.2,
      bodyHeight: 1.6,
    },
    import: {
      kind: "import",
      sourceFileName: "",
    },
  };
