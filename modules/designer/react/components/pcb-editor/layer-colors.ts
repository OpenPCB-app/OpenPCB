import type { NetClass } from "./pcb-types";

export const LAYER_COLORS: Record<string, string> = {
  "F.Cu": "#FF3333",
  "B.Cu": "#3333FF",
  "F.SilkS": "#F0F0F0",
  "B.SilkS": "#F0F0F0",
  "F.Mask": "#800080",
  "B.Mask": "#800080",
  "F.CrtYd": "#888888",
  "Edge.Cuts": "#FFD700",
  ratsnest: "#66CCFF",
};

export const PCB_BACKGROUND = "#1a1a1a";

export const DEFAULT_NET_CLASSES: NetClass[] = [
  {
    name: "Default",
    traceWidth: 0.25,
    clearance: 0.2,
    viaDiameter: 0.6,
    viaDrill: 0.3,
  },
  {
    name: "Power",
    traceWidth: 0.5,
    clearance: 0.2,
    viaDiameter: 0.8,
    viaDrill: 0.4,
  },
];

export const PCB_GRID_PRESETS = [
  { label: "1.27mm (50mil)", size: 1.27 },
  { label: "0.635mm (25mil)", size: 0.635 },
  { label: "0.254mm (10mil)", size: 0.254 },
  { label: "0.127mm (5mil)", size: 0.127 },
  { label: "0.1mm", size: 0.1 },
] as const;

export const DEFAULT_GRID_SIZE = 0.254;
