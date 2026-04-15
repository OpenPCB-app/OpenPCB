/**
 * IPC-7351B pad size calculators.
 *
 * All functions are pure — no I/O, no side effects.
 * Input dimensions in mm, output in mm.
 */

import type {
  FootprintRenderSourcePad,
  PreviewGraphic,
  PreviewLabel,
  PreviewRectGraphic,
} from "../types";
import {
  COURTYARD_LINE_WIDTH,
  SILK_LINE_WIDTH,
  SILK_PAD_CLEARANCE,
  type DensityLevel,
  type SolderFilletAdditions,
} from "./ipc-dimensions";

// ── Helpers ─────────────────────────────────────────────────────────

function padId(index: number): string {
  return `pad-${index + 1}`;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function silkRect(
  cx: number,
  cy: number,
  width: number,
  height: number,
  _pads: readonly FootprintRenderSourcePad[],
): PreviewRectGraphic {
  return {
    kind: "rect",
    x: roundTo(cx - width / 2, 4),
    y: roundTo(cy - height / 2, 4),
    width: roundTo(width, 4),
    height: roundTo(height, 4),
    fill: "none",
    strokeWidthMm: SILK_LINE_WIDTH,
    layer: "F.SilkS",
  };
}

function courtyardRect(
  cx: number,
  cy: number,
  width: number,
  height: number,
): PreviewRectGraphic {
  return {
    kind: "rect",
    x: roundTo(cx - width / 2, 4),
    y: roundTo(cy - height / 2, 4),
    width: roundTo(width, 4),
    height: roundTo(height, 4),
    fill: "none",
    strokeWidthMm: COURTYARD_LINE_WIDTH,
    layer: "F.CrtYd",
  };
}

function refLabel(cy: number, halfHeight: number): PreviewLabel {
  return {
    id: "ref",
    text: "REF**",
    at: { x: 0, y: halfHeight + 0.8 },
    fontSizeMm: 0.8,
    rotationDeg: 0,
    anchorX: "center",
    anchorY: "bottom",
    layer: "F.SilkS",
    role: "reference",
  };
}

function valueLabel(cy: number, halfHeight: number): PreviewLabel {
  return {
    id: "value",
    text: "VALUE",
    at: { x: 0, y: -(halfHeight + 0.8) },
    fontSizeMm: 0.8,
    rotationDeg: 0,
    anchorX: "center",
    anchorY: "top",
    layer: "F.Fab",
    role: "value",
  };
}

// ── Results ─────────────────────────────────────────────────────────

export interface PadCalculatorResult {
  readonly pads: FootprintRenderSourcePad[];
  readonly graphics: PreviewGraphic[];
  readonly labels: PreviewLabel[];
}

// ── Chip (2-terminal passive) ───────────────────────────────────────

export interface ChipParams {
  /** Body length (terminal-to-terminal direction, mm) */
  bodyLengthMm: number;
  /** Body width (perpendicular direction, mm) */
  bodyWidthMm: number;
  /** Terminal length on each side (mm) */
  terminalLengthMm: number;
}

export function calculateChipPads(
  params: ChipParams,
  additions: SolderFilletAdditions,
): PadCalculatorResult {
  const { bodyLengthMm, bodyWidthMm, terminalLengthMm } = params;

  // IPC-7351B pad size formula for chip components:
  // Pad width  = terminal width + 2 * side addition
  // Pad height = terminal length + toe + heel additions
  // Pad span   = body length + toe addition (total center-to-center)
  const padWidth = roundTo(bodyWidthMm + 2 * additions.side, 4);
  const padHeight = roundTo(
    terminalLengthMm + additions.toe + additions.heel,
    4,
  );
  const padSpan = roundTo(
    bodyLengthMm - terminalLengthMm + padHeight + additions.toe,
    4,
  );
  const padCenterX = padSpan / 2;

  const pads: FootprintRenderSourcePad[] = [
    {
      id: padId(0),
      number: "1",
      shape: "rect",
      centerMm: { x: roundTo(-padCenterX, 4), y: 0 },
      widthMm: padWidth,
      heightMm: padHeight,
      rotationDeg: 90,
      layer: "F.Cu",
    },
    {
      id: padId(1),
      number: "2",
      shape: "rect",
      centerMm: { x: roundTo(padCenterX, 4), y: 0 },
      widthMm: padWidth,
      heightMm: padHeight,
      rotationDeg: 90,
      layer: "F.Cu",
    },
  ];

  const silkW = bodyWidthMm + SILK_PAD_CLEARANCE * 2;
  const silkH = bodyLengthMm;
  const courtW = padSpan + padHeight + 2 * additions.courtyard;
  const courtH = Math.max(bodyWidthMm, padWidth) + 2 * additions.courtyard;

  const graphics: PreviewGraphic[] = [
    silkRect(0, 0, silkW, silkH, pads),
    courtyardRect(0, 0, roundTo(courtW, 4), roundTo(courtH, 4)),
  ];

  const halfH = Math.max(courtH, silkH) / 2;
  const labels = [refLabel(0, halfH), valueLabel(0, halfH)];

  return { pads, graphics, labels };
}

// ── Gull-wing dual row (SOIC, SOT) ─────────────────────────────────

export interface GullWingDualParams {
  /** Number of pins (must be even for dual-row) */
  pinCount: number;
  /** Pin pitch (center-to-center along row, mm) */
  pitchMm: number;
  /** Span (center-to-center between opposite rows, mm) */
  spanMm: number;
  /** Terminal length (lead foot length, mm) */
  terminalLengthMm: number;
  /** Terminal width (lead width, mm) */
  terminalWidthMm: number;
  /** Body width (between rows, mm) — for silkscreen */
  bodyWidthMm: number;
  /** Body length (along rows, mm) — for silkscreen */
  bodyLengthMm: number;
}

export function calculateGullWingDualPads(
  params: GullWingDualParams,
  additions: SolderFilletAdditions,
): PadCalculatorResult {
  const {
    pinCount,
    pitchMm,
    spanMm,
    terminalLengthMm,
    terminalWidthMm,
    bodyWidthMm,
    bodyLengthMm,
  } = params;

  if (pinCount % 2 !== 0) {
    throw new Error("pinCount must be even for dual-row packages");
  }

  const pinsPerSide = pinCount / 2;
  const padWidth = roundTo(terminalWidthMm + 2 * additions.side, 4);
  const padHeight = roundTo(
    terminalLengthMm + additions.toe + additions.heel,
    4,
  );
  const padCenterX = roundTo(
    spanMm / 2 + (additions.toe - additions.heel) / 2,
    4,
  );

  const pads: FootprintRenderSourcePad[] = [];
  const rowOffset = ((pinsPerSide - 1) * pitchMm) / 2;

  // Left column (pins 1..N/2, top to bottom)
  for (let i = 0; i < pinsPerSide; i++) {
    const y = roundTo(rowOffset - i * pitchMm, 4);
    pads.push({
      id: padId(pads.length),
      number: String(i + 1),
      shape: "rect",
      centerMm: { x: -padCenterX, y },
      widthMm: padHeight,
      heightMm: padWidth,
      rotationDeg: 0,
      layer: "F.Cu",
    });
  }

  // Right column (pins N/2+1..N, bottom to top)
  for (let i = 0; i < pinsPerSide; i++) {
    const y = roundTo(-rowOffset + i * pitchMm, 4);
    pads.push({
      id: padId(pads.length),
      number: String(pinsPerSide + i + 1),
      shape: "rect",
      centerMm: { x: padCenterX, y },
      widthMm: padHeight,
      heightMm: padWidth,
      rotationDeg: 0,
      layer: "F.Cu",
    });
  }

  const courtW = roundTo(spanMm + padHeight + 2 * additions.courtyard, 4);
  const courtH = roundTo(
    Math.max(bodyLengthMm, pinsPerSide * pitchMm) + 2 * additions.courtyard,
    4,
  );

  const graphics: PreviewGraphic[] = [
    silkRect(0, 0, bodyWidthMm, bodyLengthMm, pads),
    courtyardRect(0, 0, courtW, courtH),
  ];

  const halfH = Math.max(courtH, bodyLengthMm) / 2;
  const labels = [refLabel(0, halfH), valueLabel(0, halfH)];

  return { pads, graphics, labels };
}

// ── Quad flat (QFP) ─────────────────────────────────────────────────

export interface QuadFlatParams {
  /** Total pin count (must be divisible by 4) */
  pinCount: number;
  /** Pin pitch (mm) */
  pitchMm: number;
  /** Span X (center-to-center between left/right rows, mm) */
  spanXMm: number;
  /** Span Y (center-to-center between top/bottom rows, mm) */
  spanYMm: number;
  /** Terminal length (mm) */
  terminalLengthMm: number;
  /** Terminal width (mm) */
  terminalWidthMm: number;
  /** Body size X (mm) */
  bodyWidthMm: number;
  /** Body size Y (mm) */
  bodyLengthMm: number;
}

export function calculateQuadFlatPads(
  params: QuadFlatParams,
  additions: SolderFilletAdditions,
): PadCalculatorResult {
  const {
    pinCount,
    pitchMm,
    spanXMm,
    spanYMm,
    terminalLengthMm,
    terminalWidthMm,
    bodyWidthMm,
    bodyLengthMm,
  } = params;

  if (pinCount % 4 !== 0) {
    throw new Error("pinCount must be divisible by 4 for QFP packages");
  }

  const pinsPerSide = pinCount / 4;
  const padW = roundTo(terminalWidthMm + 2 * additions.side, 4);
  const padH = roundTo(terminalLengthMm + additions.toe + additions.heel, 4);
  const padCenterX = roundTo(
    spanXMm / 2 + (additions.toe - additions.heel) / 2,
    4,
  );
  const padCenterY = roundTo(
    spanYMm / 2 + (additions.toe - additions.heel) / 2,
    4,
  );

  const pads: FootprintRenderSourcePad[] = [];
  const rowOffsetX = ((pinsPerSide - 1) * pitchMm) / 2;
  const rowOffsetY = ((pinsPerSide - 1) * pitchMm) / 2;
  let pinNum = 1;

  // Left side (top to bottom)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      id: padId(pads.length),
      number: String(pinNum++),
      shape: "rect",
      centerMm: {
        x: -padCenterX,
        y: roundTo(rowOffsetY - i * pitchMm, 4),
      },
      widthMm: padH,
      heightMm: padW,
      rotationDeg: 0,
      layer: "F.Cu",
    });
  }

  // Bottom side (left to right)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      id: padId(pads.length),
      number: String(pinNum++),
      shape: "rect",
      centerMm: {
        x: roundTo(-rowOffsetX + i * pitchMm, 4),
        y: -padCenterY,
      },
      widthMm: padW,
      heightMm: padH,
      rotationDeg: 0,
      layer: "F.Cu",
    });
  }

  // Right side (bottom to top)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      id: padId(pads.length),
      number: String(pinNum++),
      shape: "rect",
      centerMm: {
        x: padCenterX,
        y: roundTo(-rowOffsetY + i * pitchMm, 4),
      },
      widthMm: padH,
      heightMm: padW,
      rotationDeg: 0,
      layer: "F.Cu",
    });
  }

  // Top side (right to left)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      id: padId(pads.length),
      number: String(pinNum++),
      shape: "rect",
      centerMm: {
        x: roundTo(rowOffsetX - i * pitchMm, 4),
        y: padCenterY,
      },
      widthMm: padW,
      heightMm: padH,
      rotationDeg: 0,
      layer: "F.Cu",
    });
  }

  const courtW = roundTo(spanXMm + padH + 2 * additions.courtyard, 4);
  const courtH = roundTo(spanYMm + padH + 2 * additions.courtyard, 4);

  const graphics: PreviewGraphic[] = [
    silkRect(0, 0, bodyWidthMm, bodyLengthMm, pads),
    courtyardRect(0, 0, courtW, courtH),
  ];

  const halfH = Math.max(courtH, bodyLengthMm) / 2;
  const labels = [refLabel(0, halfH), valueLabel(0, halfH)];

  return { pads, graphics, labels };
}

// ── QFN (perimeter pads + optional exposed pad) ─────────────────────

export interface QfnParams {
  /** Total pin count (perimeter only, must be divisible by 4) */
  pinCount: number;
  /** Pin pitch (mm) */
  pitchMm: number;
  /** Body size (square, mm) */
  bodySizeMm: number;
  /** Pad width (along edge, mm) */
  padWidthMm: number;
  /** Pad height (perpendicular to edge, mm) */
  padHeightMm: number;
  /** Exposed thermal pad size (0 = none, mm) */
  exposedPadMm?: number;
}

export function calculateQfnPads(
  params: QfnParams,
  additions: SolderFilletAdditions,
): PadCalculatorResult {
  const {
    pinCount,
    pitchMm,
    bodySizeMm,
    padWidthMm,
    padHeightMm,
    exposedPadMm,
  } = params;

  if (pinCount % 4 !== 0) {
    throw new Error("pinCount must be divisible by 4 for QFN packages");
  }

  const pinsPerSide = pinCount / 4;
  const padW = roundTo(padWidthMm + 2 * additions.side, 4);
  const padH = roundTo(padHeightMm + additions.toe, 4);
  const edgeCenter = roundTo(bodySizeMm / 2, 4);
  const rowOffset = ((pinsPerSide - 1) * pitchMm) / 2;

  const pads: FootprintRenderSourcePad[] = [];
  let pinNum = 1;

  // Left (top to bottom)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      id: padId(pads.length),
      number: String(pinNum++),
      shape: "rect",
      centerMm: {
        x: roundTo(-edgeCenter + padH / 2, 4),
        y: roundTo(rowOffset - i * pitchMm, 4),
      },
      widthMm: padH,
      heightMm: padW,
      rotationDeg: 0,
      layer: "F.Cu",
    });
  }

  // Bottom (left to right)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      id: padId(pads.length),
      number: String(pinNum++),
      shape: "rect",
      centerMm: {
        x: roundTo(-rowOffset + i * pitchMm, 4),
        y: roundTo(-edgeCenter + padH / 2, 4),
      },
      widthMm: padW,
      heightMm: padH,
      rotationDeg: 0,
      layer: "F.Cu",
    });
  }

  // Right (bottom to top)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      id: padId(pads.length),
      number: String(pinNum++),
      shape: "rect",
      centerMm: {
        x: roundTo(edgeCenter - padH / 2, 4),
        y: roundTo(-rowOffset + i * pitchMm, 4),
      },
      widthMm: padH,
      heightMm: padW,
      rotationDeg: 0,
      layer: "F.Cu",
    });
  }

  // Top (right to left)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      id: padId(pads.length),
      number: String(pinNum++),
      shape: "rect",
      centerMm: {
        x: roundTo(rowOffset - i * pitchMm, 4),
        y: roundTo(edgeCenter - padH / 2, 4),
      },
      widthMm: padW,
      heightMm: padH,
      rotationDeg: 0,
      layer: "F.Cu",
    });
  }

  // Exposed thermal pad
  if (exposedPadMm && exposedPadMm > 0) {
    pads.push({
      id: padId(pads.length),
      number: String(pinNum),
      shape: "rect",
      centerMm: { x: 0, y: 0 },
      widthMm: roundTo(exposedPadMm, 4),
      heightMm: roundTo(exposedPadMm, 4),
      rotationDeg: 0,
      layer: "F.Cu",
    });
  }

  const courtSize = roundTo(bodySizeMm + 2 * additions.courtyard, 4);
  const graphics: PreviewGraphic[] = [
    silkRect(0, 0, bodySizeMm, bodySizeMm, pads),
    courtyardRect(0, 0, courtSize, courtSize),
  ];

  const halfH = courtSize / 2;
  const labels = [refLabel(0, halfH), valueLabel(0, halfH)];

  return { pads, graphics, labels };
}
