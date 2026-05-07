export const RENDER_ORDER = {
  GRID: 0,
  BOARD_FILL: 1,
  BOARD_OUTLINE: 2,
  BACK_COPPER: 3,
  BACK_SILKSCREEN: 4,
  COURTYARD: 5,
  WIRES: 6,
  BODIES: 7,
  FRONT_COPPER: 8,
  FRONT_SILKSCREEN: 9,
  PINS: 10,
  LABELS: 11,
  RATSNEST: 12,
  JUNCTIONS: 13,
  SELECTION: 14,
  PREVIEW: 15,
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
  "F.CrtYd": "#a78050",
  "B.CrtYd": "#604836",
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

/**
 * Soft tool hints per layer — tools that are "conventional" for each layer.
 * Used by toolbar to show a subtle indicator on recommended tools.
 * No hard restrictions — all tools remain available on every layer.
 */
export const LAYER_TOOL_HINTS: Record<string, ReadonlySet<string>> = {
  "F.Cu": new Set(["pad", "select"]),
  "B.Cu": new Set(["pad", "select"]),
  "F.SilkS": new Set(["line", "rect", "circle", "arc", "text", "select"]),
  "B.SilkS": new Set(["line", "rect", "circle", "arc", "text", "select"]),
  "F.CrtYd": new Set(["line", "rect", "select"]),
  "B.CrtYd": new Set(["line", "rect", "select"]),
  "F.Fab": new Set(["line", "rect", "circle", "arc", "text", "select"]),
  "B.Fab": new Set(["line", "rect", "circle", "arc", "text", "select"]),
  "Edge.Cuts": new Set(["line", "arc", "circle", "select"]),
};
