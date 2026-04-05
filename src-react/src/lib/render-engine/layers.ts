/**
 * Render Engine — Layer System
 *
 * renderOrder values for 2D depth management.
 * All geometry lives at z=0; draw order is controlled exclusively via renderOrder.
 * All materials use depthTest: false, depthWrite: false.
 */

// ---------------------------------------------------------------------------
// Render Order Constants
// ---------------------------------------------------------------------------

export const RENDER_ORDER = {
  /** Background grid (infinite shader quad) */
  GRID: 0,
  /** PCB board outline (Edge.Cuts) */
  BOARD_OUTLINE: 1,
  /** PCB back copper layer */
  BACK_COPPER: 2,
  /** PCB back silkscreen */
  BACK_SILKSCREEN: 3,
  /** Footprint courtyard */
  COURTYARD: 4,
  /** Schematic wires / PCB traces background */
  WIRES: 5,
  /** Component bodies (IC rectangles, symbol graphics) */
  BODIES: 6,
  /** PCB front copper layer */
  FRONT_COPPER: 7,
  /** PCB front silkscreen */
  FRONT_SILKSCREEN: 8,
  /** Pin connector dots and pin lines */
  PINS: 9,
  /** Text labels (reference, value, pin names, net labels) */
  LABELS: 10,
  /** PCB ratsnest (unrouted connections) */
  RATSNEST: 11,
  /** Wire/trace junctions */
  JUNCTIONS: 12,
  /** Selection overlay (dashed rectangles, handles) */
  SELECTION: 13,
  /** Preview ghost (placement/routing in progress) */
  PREVIEW: 14,
  /** Background hit plane (invisible, catches empty-space clicks) */
  HIT_PLANE: -1,
} as const;

export type RenderOrderKey = keyof typeof RENDER_ORDER;

// ---------------------------------------------------------------------------
// PCB Layer Identifiers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// PCB Layer Colors (standard EDA conventions)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Default Layer Visibility
// ---------------------------------------------------------------------------

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
