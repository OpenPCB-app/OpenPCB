/**
 * Render-order index. Higher = drawn later (on top). All PCB primitives use
 * `depthTest: false, depthWrite: false`, so this index alone determines
 * stacking. Ordered to mirror physical fab stackup:
 *
 *   bottom side → inner copper → drill → top side → annotations.
 *
 * Each copper layer carries two slots — `*_COPPER_FILL` (pour mesh) and
 * `*_COPPER` (traces / pad copper / vias) — so the panel's per-layer fill
 * toggle does not collide with the object visibility toggle.
 *
 * Side-mode flip (top↔bottom) reverses physical-layer z but leaves
 * annotation layers (drill, edge, metadata, ratsnest, labels, selection,
 * preview, grid, board fill) untouched. Use `effectiveRenderOrder()` to read
 * the side-aware value.
 *
 * Selection / preview always win.
 */
export const RENDER_ORDER = {
  HIT_PLANE: -3,
  GRID: -2,
  BOARD_FILL: -1,
  // Bottom side (drawn first / lowest)
  B_COPPER_FILL: -0.35,
  B_COPPER: 0,
  B_MASK: 1,
  B_PASTE: 2,
  B_SILK: 3,
  B_FAB: 4,
  // Inner copper (between bottom finish and top finish)
  IN2_COPPER_FILL: 4.65,
  IN2_COPPER: 5,
  IN1_COPPER_FILL: 5.65,
  IN1_COPPER: 6,
  // Drill: above all copper, below top finish, visible through mask cutouts
  DRILL: 7,
  // Top side (drawn above bottom + inner)
  F_FAB: 8,
  F_SILK: 9,
  F_MASK: 10,
  F_PASTE: 11,
  F_COPPER_FILL: 11.65,
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
 * Per-layer base color (6-char hex only — `THREE.Color.setStyle` silently
 * falls back to white when handed 8-char `#RRGGBBAA`). Mask translucency
 * is applied via the material's `opacity` prop, not the color string.
 * Convention follows Altium/Flux: saturated red top copper, saturated blue
 * bottom copper, professional green mask, pure-white top silk, soft-cyan
 * bottom silk. Tuned for ≥4.5:1 contrast against the #15191f board substrate
 * so every layer reads at a glance.
 */
export const PCB_LAYER_COLORS: Record<PcbLayerId, string> = {
  "F.Cu": "#ff0000",
  "In1.Cu": "#f59e0b",
  "In2.Cu": "#06b6d4",
  "B.Cu": "#1e40af",
  "F.Mask": "#0a0d12",
  "B.Mask": "#0a0d12",
  "F.Paste": "#cbd5e1",
  "B.Paste": "#94a3b8",
  "F.SilkS": "#f8fafc",
  "B.SilkS": "#a5f3fc",
  "F.CrtYd": "#a78050",
  "B.CrtYd": "#604836",
  "F.Fab": "#64748b",
  "B.Fab": "#475569",
  "Edge.Cuts": "#fbbf24",
  Drill: "#000000",
  Metadata: "#a3a3a3",
};

/**
 * Trace-only color overrides for copper layers. Traces are rendered slightly
 * brighter / more saturated than pad fills so the signal flow remains the
 * dominant visual element at every zoom level. Pads use PCB_LAYER_COLORS
 * (warmer / slightly desaturated) so they read as "deposits" rather than
 * "wires".
 */
export const PCB_TRACE_COLORS: Record<
  "F.Cu" | "In1.Cu" | "In2.Cu" | "B.Cu",
  string
> = {
  "F.Cu": "#ff0000",
  "In1.Cu": "#fbbf24",
  "In2.Cu": "#22d3ee",
  "B.Cu": "#2563eb",
};

/** All copper layer ids in render-stack order (top → inner → bottom). */
export const PCB_COPPER_LAYERS: ReadonlyArray<PcbLayerId> = [
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
];

/**
 * Lime-green outline color drawn around every drill hole (PTH pads + vias).
 * Provides a high-contrast boundary regardless of which substrate / theme
 * shows through the cutout. Tailwind lime-400 — adjusted for visibility on
 * both dark and light board fills.
 */
export const PCB_DRILL_OUTLINE_COLOR = "#a3e635";

/**
 * Drill-outline ring thickness in mm. Constant in board space — does not
 * scale with the drill radius. Tuned to read as a thin halo at typical
 * routing zooms without eclipsing the actual hole at small drills.
 */
export const PCB_DRILL_OUTLINE_THICKNESS_MM = 0.06;

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

/**
 * Closed-form metadata describing each Tier-1 layer. `gerberFileFunction` is
 * reserved (consumed by a future export path); never read inside the canvas.
 * `family` groups layers for the panel and the side-flip logic — only
 * `physical` layers reverse z when the view side flips.
 */
export type PcbLayerFamily =
  | "copper"
  | "mask"
  | "paste"
  | "silk"
  | "courtyard"
  | "fab"
  | "annotation";

export type PcbLayerSide = "F" | "B" | "inner" | "none";

export interface PcbLayerMetadata {
  family: PcbLayerFamily;
  side: PcbLayerSide;
  /** Eligible for export to manufacturing (Tier-1 + Tier-2 with opt-in). */
  exportable: boolean;
  /**
   * Gerber `%TF.FileFunction` payload. Closed for modification: future
   * export code reads this verbatim. Annotation layers carry `null`.
   */
  gerberFileFunction: string | null;
  /**
   * Whether this layer is mirrored visually with the rest of the side when
   * `viewSide = bottom`. Annotation layers (drill, edge, metadata) opt out so
   * they always render right-reading regardless of side mode.
   */
  reverseOnFlip: boolean;
}

export const PCB_LAYER_METADATA: Record<PcbLayerId, PcbLayerMetadata> = {
  "F.Cu": {
    family: "copper",
    side: "F",
    exportable: true,
    gerberFileFunction: "Copper,L1,Top,Signal",
    reverseOnFlip: true,
  },
  "In1.Cu": {
    family: "copper",
    side: "inner",
    exportable: true,
    gerberFileFunction: "Copper,L2,Inr,Signal",
    reverseOnFlip: true,
  },
  "In2.Cu": {
    family: "copper",
    side: "inner",
    exportable: true,
    gerberFileFunction: "Copper,L3,Inr,Signal",
    reverseOnFlip: true,
  },
  "B.Cu": {
    family: "copper",
    side: "B",
    exportable: true,
    gerberFileFunction: "Copper,L4,Bot,Signal",
    reverseOnFlip: true,
  },
  "F.Mask": {
    family: "mask",
    side: "F",
    exportable: true,
    gerberFileFunction: "Soldermask,Top",
    reverseOnFlip: true,
  },
  "B.Mask": {
    family: "mask",
    side: "B",
    exportable: true,
    gerberFileFunction: "Soldermask,Bot",
    reverseOnFlip: true,
  },
  "F.Paste": {
    family: "paste",
    side: "F",
    exportable: true,
    gerberFileFunction: "Paste,Top",
    reverseOnFlip: true,
  },
  "B.Paste": {
    family: "paste",
    side: "B",
    exportable: true,
    gerberFileFunction: "Paste,Bot",
    reverseOnFlip: true,
  },
  "F.SilkS": {
    family: "silk",
    side: "F",
    exportable: true,
    gerberFileFunction: "Legend,Top",
    reverseOnFlip: true,
  },
  "B.SilkS": {
    family: "silk",
    side: "B",
    exportable: true,
    gerberFileFunction: "Legend,Bot",
    reverseOnFlip: true,
  },
  "F.CrtYd": {
    family: "courtyard",
    side: "F",
    exportable: false,
    gerberFileFunction: null,
    reverseOnFlip: true,
  },
  "B.CrtYd": {
    family: "courtyard",
    side: "B",
    exportable: false,
    gerberFileFunction: null,
    reverseOnFlip: true,
  },
  "F.Fab": {
    family: "fab",
    side: "F",
    exportable: false,
    gerberFileFunction: null,
    reverseOnFlip: true,
  },
  "B.Fab": {
    family: "fab",
    side: "B",
    exportable: false,
    gerberFileFunction: null,
    reverseOnFlip: true,
  },
  "Edge.Cuts": {
    family: "annotation",
    side: "none",
    exportable: true,
    gerberFileFunction: "Profile,NP",
    reverseOnFlip: false,
  },
  Drill: {
    family: "annotation",
    side: "none",
    exportable: true,
    gerberFileFunction: null,
    reverseOnFlip: false,
  },
  Metadata: {
    family: "annotation",
    side: "none",
    exportable: false,
    gerberFileFunction: null,
    reverseOnFlip: false,
  },
};

/**
 * Per-layer render slots. `fill` is defined only for copper. Components pull
 * the slot they're drawing — `CopperFillLayer` uses `fill`, `TraceLayer`/
 * pads/vias use `object`. Side-flip reverses physical layers around a pivot
 * (`F_COPPER` ↔ `B_COPPER`, `F_FAB` ↔ `B_FAB`, etc.). Annotation layers
 * (`reverseOnFlip = false`) keep their base z under either side.
 */
export interface PcbLayerRenderSlots {
  object: number;
  fill?: number;
}

const BASE_RENDER_SLOTS: Record<PcbLayerId, PcbLayerRenderSlots> = {
  "F.Cu": { object: RENDER_ORDER.F_COPPER, fill: RENDER_ORDER.F_COPPER_FILL },
  "In1.Cu": {
    object: RENDER_ORDER.IN1_COPPER,
    fill: RENDER_ORDER.IN1_COPPER_FILL,
  },
  "In2.Cu": {
    object: RENDER_ORDER.IN2_COPPER,
    fill: RENDER_ORDER.IN2_COPPER_FILL,
  },
  "B.Cu": { object: RENDER_ORDER.B_COPPER, fill: RENDER_ORDER.B_COPPER_FILL },
  "F.Mask": { object: RENDER_ORDER.F_MASK },
  "B.Mask": { object: RENDER_ORDER.B_MASK },
  "F.Paste": { object: RENDER_ORDER.F_PASTE },
  "B.Paste": { object: RENDER_ORDER.B_PASTE },
  "F.SilkS": { object: RENDER_ORDER.F_SILK },
  "B.SilkS": { object: RENDER_ORDER.B_SILK },
  "F.CrtYd": { object: RENDER_ORDER.COURTYARD },
  "B.CrtYd": { object: RENDER_ORDER.COURTYARD - 0.5 },
  "F.Fab": { object: RENDER_ORDER.F_FAB },
  "B.Fab": { object: RENDER_ORDER.B_FAB },
  "Edge.Cuts": { object: RENDER_ORDER.EDGE_CUTS },
  Drill: { object: RENDER_ORDER.DRILL },
  Metadata: { object: RENDER_ORDER.METADATA },
};

// Each physical layer that flips has a counterpart on the opposite side.
// At viewSide = bottom we render with the counterpart's slot — keeps each
// family's internal ordering intact (e.g. copper above mask, mask above
// paste) while swapping which side is foreground (spec §5.2).
const FLIP_COUNTERPART: Partial<Record<PcbLayerId, PcbLayerId>> = {
  "F.Cu": "B.Cu",
  "B.Cu": "F.Cu",
  "F.Mask": "B.Mask",
  "B.Mask": "F.Mask",
  "F.Paste": "B.Paste",
  "B.Paste": "F.Paste",
  "F.SilkS": "B.SilkS",
  "B.SilkS": "F.SilkS",
  "F.CrtYd": "B.CrtYd",
  "B.CrtYd": "F.CrtYd",
  "F.Fab": "B.Fab",
  "B.Fab": "F.Fab",
};

/**
 * Render-order helper. Centralizes the side-flip rule so individual layer
 * components never inspect viewSide. Pass `slot = "fill"` for the copper
 * pour mesh, otherwise `"object"`. Annotation layers ignore viewSide.
 */
export function effectiveRenderOrder(
  layer: PcbLayerId,
  viewSide: "top" | "bottom",
  slot: "object" | "fill" = "object",
): number {
  const meta = PCB_LAYER_METADATA[layer];
  const sourceLayer =
    viewSide === "bottom" && meta.reverseOnFlip
      ? (FLIP_COUNTERPART[layer] ?? layer)
      : layer;
  const base = BASE_RENDER_SLOTS[sourceLayer];
  return slot === "fill" && base.fill !== undefined ? base.fill : base.object;
}

/** Built-in layer-set presets shown in the panel's preset dropdown. */
export type PcbLayerPresetId =
  | "top-side"
  | "bottom-side"
  | "all-copper"
  | "assembly";

export interface PcbLayerPresetSpec {
  id: PcbLayerPresetId;
  label: string;
  description: string;
  visibleLayers: PcbLayerId[];
  /** Optional activeLayer override (must be activatable). */
  activeLayer?: PcbLayerId;
  /** Optional viewSide override. */
  viewSide?: "top" | "bottom";
}

export const PCB_LAYER_PRESETS: ReadonlyArray<PcbLayerPresetSpec> = [
  {
    id: "top-side",
    label: "Top side",
    description: "Top copper + finish + drill + chrome.",
    visibleLayers: [
      "F.Cu",
      "F.Mask",
      "F.Paste",
      "F.SilkS",
      "Edge.Cuts",
      "Drill",
      "Metadata",
    ],
    activeLayer: "F.Cu",
    viewSide: "top",
  },
  {
    id: "bottom-side",
    label: "Bottom side",
    description: "Bottom copper + finish + drill + chrome.",
    visibleLayers: [
      "B.Cu",
      "B.Mask",
      "B.Paste",
      "B.SilkS",
      "Edge.Cuts",
      "Drill",
      "Metadata",
    ],
    activeLayer: "B.Cu",
    viewSide: "bottom",
  },
  {
    id: "all-copper",
    label: "All copper",
    description: "Every routable copper layer + edge + drill. No finish.",
    visibleLayers: [
      "F.Cu",
      "In1.Cu",
      "In2.Cu",
      "B.Cu",
      "Edge.Cuts",
      "Drill",
      "Metadata",
    ],
    viewSide: "top",
  },
  {
    id: "assembly",
    label: "Assembly view",
    description: "Silk + courtyard + fab + drill. Copper dimmed.",
    visibleLayers: [
      "F.SilkS",
      "B.SilkS",
      "F.CrtYd",
      "B.CrtYd",
      "F.Fab",
      "B.Fab",
      "Edge.Cuts",
      "Drill",
      "Metadata",
    ],
    viewSide: "top",
  },
];

/**
 * Best-effort match of a visibility set to a preset. Returns `"custom"` when
 * no preset matches exactly. Used by the panel to highlight the active chip.
 */
export function detectLayerPreset(
  visibleLayers: ReadonlyArray<PcbLayerId>,
): PcbLayerPresetId | "custom" {
  const visible = new Set(visibleLayers);
  for (const preset of PCB_LAYER_PRESETS) {
    if (preset.visibleLayers.length !== visible.size) continue;
    let match = true;
    for (const id of preset.visibleLayers) {
      if (!visible.has(id)) {
        match = false;
        break;
      }
    }
    if (match) return preset.id;
  }
  return "custom";
}
