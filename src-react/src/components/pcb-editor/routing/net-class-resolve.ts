import type { PcbDocument } from "../pcb-types";

export interface ResolvedNetClass {
  defaultWidth: number;
  presets: number[];
  viaDiameter: number;
  viaDrill: number;
}

const STANDARD_WIDTH_PRESETS = [0.15, 0.2, 0.25, 0.3, 0.5, 0.8, 1.0];

const DEFAULT_NET_CLASS: ResolvedNetClass = {
  defaultWidth: 0.25,
  presets: STANDARD_WIDTH_PRESETS,
  viaDiameter: 0.6,
  viaDrill: 0.3,
};

export function resolveNetClassWidths(
  netId: string,
  document: PcbDocument,
): ResolvedNetClass {
  const net = document.nets.find((n) => n.id === netId);
  if (!net) return DEFAULT_NET_CLASS;

  const netClass = document.netClasses.find((nc) => nc.name === net.netClass);
  if (!netClass) return DEFAULT_NET_CLASS;

  const presetsSet = new Set(STANDARD_WIDTH_PRESETS);
  presetsSet.add(netClass.traceWidth);
  const presets = Array.from(presetsSet).sort((a, b) => a - b);

  return {
    defaultWidth: netClass.traceWidth,
    presets,
    viaDiameter: netClass.viaDiameter,
    viaDrill: netClass.viaDrill,
  };
}

export function findWidthIndex(width: number, presets: number[]): number {
  const exactIndex = presets.indexOf(width);
  if (exactIndex !== -1) return exactIndex;

  let closestIndex = 0;
  let closestDiff = Math.abs((presets[0] ?? 0) - width);
  for (let i = 1; i < presets.length; i++) {
    const preset = presets[i];
    if (preset === undefined) continue;
    const diff = Math.abs(preset - width);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = i;
    }
  }
  return closestIndex;
}
