export const RENDER_ORDER = {
  GRID: 0,
  BOARD_OUTLINE: 1,
  BACK_COPPER: 2,
  BACK_SILKSCREEN: 3,
  COURTYARD: 4,
  WIRES: 5,
  BODIES: 6,
  FRONT_COPPER: 7,
  FRONT_SILKSCREEN: 8,
  PINS: 9,
  LABELS: 10,
  RATSNEST: 11,
  JUNCTIONS: 12,
  SELECTION: 13,
  PREVIEW: 14,
  HIT_PLANE: -1,
} as const;

export type RenderOrderKey = keyof typeof RENDER_ORDER;

export type PcbLayerId =
  | "F.Cu"
  | "B.Cu"
  | "F.SilkS"
  | "B.SilkS"
  | "F.CrtYd"
  | "B.CrtYd"
  | "F.Fab"
  | "B.Fab"
  | "Edge.Cuts";

export const PCB_LAYER_COLORS: Record<PcbLayerId, string> = {
  "F.Cu": "#c87533",
  "B.Cu": "#3377c8",
  "F.SilkS": "#e2e8f0",
  "B.SilkS": "#94a3b8",
  "F.CrtYd": "rgba(255, 193, 7, 0.5)",
  "B.CrtYd": "rgba(255, 193, 7, 0.3)",
  "F.Fab": "#64748b",
  "B.Fab": "#475569",
  "Edge.Cuts": "#fbbf24",
};

export function createDefaultLayerVisibility(): Set<PcbLayerId> {
  return new Set<PcbLayerId>([
    "F.Cu",
    "B.Cu",
    "F.SilkS",
    "F.CrtYd",
    "F.Fab",
    "Edge.Cuts",
  ]);
}
