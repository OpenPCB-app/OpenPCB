/**
 * Render-order index. Higher = drawn later (on top). All PCB primitives use
 * `depthTest: false, depthWrite: false`, so this index alone determines
 * stacking. Ordered to mirror physical fab stackup:
 *
 *   bottom side → inner copper → drill → top side → annotations.
 *
 * Selection / preview always win.
 */
export const RENDER_ORDER = {
  HIT_PLANE: -3,
  GRID: -2,
  BOARD_FILL: -1,
  // Bottom side (drawn first / lowest)
  B_COPPER: 0,
  B_MASK: 1,
  B_PASTE: 2,
  B_SILK: 3,
  B_FAB: 4,
  // Inner copper (between bottom finish and top finish)
  IN2_COPPER: 5,
  IN1_COPPER: 6,
  // Drill: above all copper, below top finish, visible through mask cutouts
  DRILL: 7,
  // Top side (drawn above bottom + inner)
  F_FAB: 8,
  F_SILK: 9,
  F_MASK: 10,
  F_PASTE: 11,
  F_COPPER: 12,
  // Annulus overlay (mounting-hole pink ring on top silk)
  ANNULAR: 13,
  // Edges + annotations always on top
  EDGE_CUTS: 14,
  COURTYARD: 15,
  METADATA: 16,
  RATSNEST: 17,
  LABELS: 18,
  SELECTION: 19,
  PREVIEW: 20,
  // Legacy aliases — kept until call sites migrate (Phases 2–6).
  BACK_COPPER: 0,
  BACK_SILKSCREEN: 3,
  WIRES: 6,
  BODIES: 7,
  FRONT_COPPER: 12,
  FRONT_SILKSCREEN: 9,
  PINS: 10,
  JUNCTIONS: 13,
  BOARD_OUTLINE: 14,
} as const;

export type RenderOrderKey = keyof typeof RENDER_ORDER;

/**
 * Canvas-side PcbLayerId. Mirrors `PcbLayerId` in `src/sdks/designer/types.ts`
 * — must stay in sync since board_settings JSON uses these literal strings.
 */
export type PcbLayerId =
  | "F.Cu"
  | "In1.Cu"
  | "In2.Cu"
  | "B.Cu"
  | "F.Mask"
  | "B.Mask"
  | "F.Paste"
  | "B.Paste"
  | "F.SilkS"
  | "B.SilkS"
  | "F.CrtYd"
  | "B.CrtYd"
  | "F.Fab"
  | "B.Fab"
  | "Edge.Cuts"
  | "Drill"
  | "Metadata";

/**
 * Per-layer base color (hex). Mask layers use `#RRGGBBAA` because their
 * material is translucent. Convention follows Altium/Flux (red top copper,
 * blue bottom copper; green mask; cyan top silk / magenta bottom silk).
 */
export const PCB_LAYER_COLORS: Record<PcbLayerId, string> = {
  "F.Cu": "#c0392b",
  "In1.Cu": "#d4b347",
  "In2.Cu": "#3aa3c8",
  "B.Cu": "#2e6fd6",
  "F.Mask": "#1a8b3cb3",
  "B.Mask": "#1a8b3cb3",
  "F.Paste": "#c8a8d6",
  "B.Paste": "#7fd0d6",
  "F.SilkS": "#e8eef5",
  "B.SilkS": "#d63aa3",
  "F.CrtYd": "#a78050",
  "B.CrtYd": "#604836",
  "F.Fab": "#64748b",
  "B.Fab": "#475569",
  "Edge.Cuts": "#f0c040",
  Drill: "#050505",
  Metadata: "#a3a3a3",
};

/**
 * Trace-only color overrides for copper layers. Pads continue to use
 * PCB_LAYER_COLORS so footprint pads retain their static copper appearance;
 * traces use slightly more saturated red/blue/yellow/cyan so the routed
 * signal flow stays visually distinct from pad copper.
 */
export const PCB_TRACE_COLORS: Record<
  "F.Cu" | "In1.Cu" | "In2.Cu" | "B.Cu",
  string
> = {
  "F.Cu": "#b91c1c",
  "In1.Cu": "#ca8a04",
  "In2.Cu": "#0e7490",
  "B.Cu": "#1d4ed8",
};

/** All copper layer ids in render-stack order (top → inner → bottom). */
export const PCB_COPPER_LAYERS: ReadonlyArray<PcbLayerId> = [
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
];

export function createDefaultLayerVisibility(): Set<PcbLayerId> {
  return new Set<PcbLayerId>([
    "F.Cu",
    "B.Cu",
    "F.SilkS",
    "B.SilkS",
    "Edge.Cuts",
    "Drill",
    "Metadata",
  ]);
}

/**
 * Soft tool hints per layer — tools that are "conventional" for each layer.
 * Used by toolbar to show a subtle indicator on recommended tools.
 * No hard restrictions — all tools remain available on every layer.
 */
export const LAYER_TOOL_HINTS: Record<string, ReadonlySet<string>> = {
  "F.Cu": new Set(["pad", "select"]),
  "In1.Cu": new Set(["pad", "select"]),
  "In2.Cu": new Set(["pad", "select"]),
  "B.Cu": new Set(["pad", "select"]),
  "F.SilkS": new Set(["line", "rect", "circle", "arc", "text", "select"]),
  "B.SilkS": new Set(["line", "rect", "circle", "arc", "text", "select"]),
  "F.CrtYd": new Set(["line", "rect", "select"]),
  "B.CrtYd": new Set(["line", "rect", "select"]),
  "F.Fab": new Set(["line", "rect", "circle", "arc", "text", "select"]),
  "B.Fab": new Set(["line", "rect", "circle", "arc", "text", "select"]),
  "Edge.Cuts": new Set(["line", "arc", "circle", "select"]),
};

/**
 * Hierarchical layer tree used by `PcbLayersPanel` (Flux-style grouped view).
 * Group nodes own no rendering of their own — they expand the visibility set
 * of their children. `requiresLayerCount` hides nodes unless the board's
 * `layerCount` meets the threshold.
 */
export type PcbLayerGroupId = "group:top" | "group:bottom";

export type LayerTreeNode =
  | {
      kind: "layer";
      id: PcbLayerId;
      label: string;
      /** May be set as the active layer (only copper qualifies). */
      activatable: boolean;
      /** Hide this node entirely when board.layerCount < this. */
      requiresLayerCount?: 4;
    }
  | {
      kind: "group";
      id: PcbLayerGroupId;
      label: string;
      children: PcbLayerId[];
    };

export const PCB_LAYER_TREE: ReadonlyArray<LayerTreeNode> = [
  { kind: "layer", id: "Metadata", label: "Metadata", activatable: false },
  {
    kind: "layer",
    id: "Edge.Cuts",
    label: "Board Outline",
    activatable: false,
  },
  { kind: "layer", id: "Drill", label: "Drill Holes", activatable: false },
  {
    kind: "group",
    id: "group:top",
    label: "Top Layers",
    children: ["F.SilkS", "F.Paste", "F.Mask", "F.Cu"],
  },
  { kind: "layer", id: "F.SilkS", label: "Top Overlay", activatable: false },
  {
    kind: "layer",
    id: "F.Paste",
    label: "Top Solder Paste",
    activatable: false,
  },
  { kind: "layer", id: "F.Mask", label: "Top Solder Mask", activatable: false },
  { kind: "layer", id: "F.Cu", label: "Top Copper", activatable: true },
  {
    kind: "layer",
    id: "In1.Cu",
    label: "Mid-Layer 1",
    activatable: true,
    requiresLayerCount: 4,
  },
  {
    kind: "layer",
    id: "In2.Cu",
    label: "Mid-Layer 2",
    activatable: true,
    requiresLayerCount: 4,
  },
  {
    kind: "group",
    id: "group:bottom",
    label: "Bottom Layers",
    children: ["B.Cu", "B.Mask", "B.Paste", "B.SilkS"],
  },
  { kind: "layer", id: "B.Cu", label: "Bottom Copper", activatable: true },
  {
    kind: "layer",
    id: "B.Mask",
    label: "Bottom Solder Mask",
    activatable: false,
  },
  {
    kind: "layer",
    id: "B.Paste",
    label: "Bottom Solder Paste",
    activatable: false,
  },
  { kind: "layer", id: "B.SilkS", label: "Bottom Overlay", activatable: false },
];

/** Human-readable label for any PcbLayerId, sourced from PCB_LAYER_TREE. */
export const PCB_LAYER_LABELS: Record<PcbLayerId, string> = (() => {
  const out: Partial<Record<PcbLayerId, string>> = {};
  for (const node of PCB_LAYER_TREE) {
    if (node.kind === "layer") out[node.id] = node.label;
  }
  out["F.CrtYd"] = "Top Courtyard";
  out["B.CrtYd"] = "Bottom Courtyard";
  out["F.Fab"] = "Top Fab";
  out["B.Fab"] = "Bottom Fab";
  return out as Record<PcbLayerId, string>;
})();
