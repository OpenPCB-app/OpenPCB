import type { PcbPointMm } from "../../../../../sdks";

export type MeasureAnchorKind =
  | "grid"
  | "cursor"
  | "footprint-origin"
  | "pad-center"
  | "free-pad-center"
  | "trace-point"
  | "via-center";

export interface MeasureAnchor {
  kind: MeasureAnchorKind;
  pointMm: PcbPointMm;
  sourceId?: string;
}

export type MeasureToolState =
  | { kind: "idle" }
  | { kind: "measuring"; start: MeasureAnchor }
  | { kind: "locked"; start: MeasureAnchor; end: MeasureAnchor };

export const initialMeasureToolState: MeasureToolState = { kind: "idle" };

export type MeasureToolAction =
  | { kind: "click"; anchor: MeasureAnchor }
  | { kind: "clear" };

export function measureToolReducer(
  state: MeasureToolState,
  action: MeasureToolAction,
): MeasureToolState {
  if (action.kind === "clear") return initialMeasureToolState;
  if (state.kind === "measuring") {
    return { kind: "locked", start: state.start, end: action.anchor };
  }
  return { kind: "measuring", start: action.anchor };
}

export interface MeasurementReadout {
  distanceMm: number;
  dxMm: number;
  dyMm: number;
  angleDeg: number;
}

export function measureBetween(
  start: PcbPointMm,
  end: PcbPointMm,
): MeasurementReadout {
  const dxMm = end.x - start.x;
  const dyMm = end.y - start.y;
  const distanceMm = Math.hypot(dxMm, dyMm);
  const angleDeg = (Math.atan2(dyMm, dxMm) * 180) / Math.PI;
  return { distanceMm, dxMm, dyMm, angleDeg };
}

export function formatMm(value: number): string {
  const abs = Math.abs(value);
  if (abs < 10) return `${value.toFixed(3)} mm`;
  if (abs < 100) return `${value.toFixed(2)} mm`;
  return `${value.toFixed(1)} mm`;
}

export function formatMeasureLabel(
  start: PcbPointMm,
  end: PcbPointMm,
  showDeltas: boolean,
): string {
  const readout = measureBetween(start, end);
  if (!showDeltas) return formatMm(readout.distanceMm);
  return `${formatMm(readout.distanceMm)}  Δx ${formatMm(readout.dxMm)}  Δy ${formatMm(readout.dyMm)}`;
}
