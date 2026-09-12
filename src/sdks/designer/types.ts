import type { CommandEnvelope } from "../../shared/domain/commands/command-envelope";
import type {
  LibraryComponent,
  LibraryComponentPlacementDetail,
  LibraryFootprintPlacementSnapshot,
  LibrarySymbolPlacementSnapshot,
} from "../library";

export type DesignerEntityKind = "part" | "wire" | "label" | "primitive";

/** First-class schematic primitives for power/ground/portal — distinct from
 *  library components. They have no footprint and never become PCB
 *  placements. Net derivation uses them to force net names and to globally
 *  join sub-graphs by portal text. */
export type DesignerPrimitiveKind = "gnd" | "pwr" | "net_portal" | "junction";

/**
 * Compact DRC status for the design card. Sourced from the latest persisted
 * DRC run. `stale` = the design has been edited since DRC last ran
 * (`ranAtRevision !== design.revision`). Absent/null = DRC never run.
 */
export interface DesignerDrcStatus {
  ranAtRevision: number;
  ranAt: string;
  errors: number;
  warnings: number;
  infos: number;
  stale: boolean;
}

export interface DesignerDesignSummary {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Cached schematic preview for Home-screen thumbnails. Populated by
   *  `listDesigns`; omitted from command/create results. */
  schematicPreview?: DesignerSchematicPreview | null;
  /** Latest DRC status for the card badge. Populated by `listDesigns`. */
  drcStatus?: DesignerDrcStatus | null;
}

export interface DesignerEntityRecord {
  id: string;
  designId: string;
  kind: DesignerEntityKind;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DesignerDesignRecord {
  head: DesignerDesignSummary;
  entities: DesignerEntityRecord[];
}

export interface CreateDesignerDesignInput {
  name?: string;
}

export interface UpdateDesignerDesignInput {
  name: string;
}

export interface DesignerSchematicProjection {
  designId: string;
  revision: number;
  parts: DesignerPlacedPart[];
  wires: DesignerWire[];
  labels: DesignerLabel[];
  primitives: DesignerPrimitive[];
  junctions: DesignerJunction[];
  nets: DesignerDerivedNet[];
}

export type DesignerCommentSurface = "schematic" | "pcb" | "design";

export type DesignerCommentThreadStatus = "open" | "resolved" | "archived";

export type DesignerCommentTodoStatus =
  | "none"
  | "todo"
  | "in_progress"
  | "done";

export type DesignerCommentSyncState =
  | "local"
  | "pending"
  | "synced"
  | "failed"
  | "conflict";

export type DesignerCommentMessageKind = "user" | "system" | "assistant";

export type DesignerCommentAnchorEntityKind =
  | "part"
  | "pin"
  | "wire"
  | "label"
  | "primitive"
  | "placement"
  | "pad"
  | "trace"
  | "via"
  | "freePad"
  | "freeHole"
  | "overlayText"
  | "overlayShape";

export interface DesignerCommentAnchor {
  surface: DesignerCommentSurface;
  pointNm: { x: number; y: number };
  entity?: {
    kind: DesignerCommentAnchorEntityKind;
    id: string;
    subId?: string;
  };
  layerId?: string;
  netId?: string | null;
  sourceRevision?: number;
}

export interface DesignerCommentAttachment {
  id: string;
  designId: string;
  threadId: string;
  messageId: string | null;
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  localPath?: string | null;
  storageKey?: string | null;
  createdAt: string;
  deletedAt: string | null;
}

/** Aggregated reaction tally for a single emoji on a message. */
export interface DesignerCommentReaction {
  emoji: string;
  count: number;
  /** Whether the current user has this reaction active. */
  reactedByMe: boolean;
}

export interface DesignerCommentMessage {
  id: string;
  designId: string;
  threadId: string;
  kind: DesignerCommentMessageKind;
  body: string | null;
  mentions: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  revision: number;
  attachments: DesignerCommentAttachment[];
  reactions: DesignerCommentReaction[];
}

export interface DesignerCommentThread {
  id: string;
  designId: string;
  surface: DesignerCommentSurface;
  anchor: DesignerCommentAnchor | null;
  status: DesignerCommentThreadStatus;
  todoStatus: DesignerCommentTodoStatus;
  title: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  messageCount: number;
  revision: number;
  syncState: DesignerCommentSyncState;
  deletedAt: string | null;
  messages?: DesignerCommentMessage[];
}

export interface DesignerCommentThreadPage {
  threads: DesignerCommentThread[];
}

export interface DesignerCommentCommandEnvelope {
  commandId: string;
  sessionId: string;
  aggregateId: string;
  baseRevision: number | null;
  issuedAt: number;
  command: DesignerCommentCommand;
}

export type DesignerCommentCommand =
  | {
      type: "create_thread";
      threadId: string;
      messageId: string;
      surface: DesignerCommentSurface;
      anchor: DesignerCommentAnchor | null;
      body: string;
      title?: string | null;
      todoStatus?: DesignerCommentTodoStatus;
      mentions?: string[];
      createdBy?: string | null;
    }
  | {
      type: "add_message";
      threadId: string;
      messageId: string;
      body: string;
      mentions?: string[];
      createdBy?: string | null;
    }
  | { type: "edit_message"; threadId: string; messageId: string; body: string }
  | { type: "delete_message"; threadId: string; messageId: string }
  | {
      type: "set_thread_status";
      threadId: string;
      status: DesignerCommentThreadStatus;
    }
  | {
      type: "set_thread_todo_status";
      threadId: string;
      todoStatus: DesignerCommentTodoStatus;
    }
  | {
      type: "set_thread_anchor";
      threadId: string;
      anchor: DesignerCommentAnchor | null;
    }
  | {
      type: "toggle_reaction";
      threadId: string;
      messageId: string;
      emoji: string;
      createdBy?: string | null;
    };

export type DesignerCommentCommandResult =
  | { ok: true; threadRevision: number; thread: DesignerCommentThread }
  | {
      ok: false;
      code: "COMMENT_CONFLICT" | "COMMENT_NOT_FOUND" | "INVALID_COMMENT";
      detail: string;
      currentRevision?: number;
    };

/** Compact schematic snapshot for Home-screen thumbnails. Carries the vector
 *  geometry needed to draw an auto-fit SVG preview — placed-symbol
 *  graphics/bounds + pin stubs (mm), wire polylines (nm), and power/ground/
 *  portal primitives — without footprints, labels, or derived nets.
 *
 *  `schemaVersion` lets the cache (`designer_design_heads.schematic_preview_json`)
 *  detect a shape change and recompute even when the design revision is unchanged. */
export interface DesignerSchematicPreview {
  schemaVersion: number;
  designId: string;
  revision: number;
  parts: Array<{
    positionNm: { x: number; y: number };
    rotationDeg: number;
    mirrored: boolean;
    graphics: LibrarySymbolPlacementSnapshot["preview"]["graphics"];
    bounds: LibrarySymbolPlacementSnapshot["preview"]["bounds"];
    /** Pin stub segments in local mm (anchor = wire connection point). */
    pins: Array<{
      anchor: { x: number; y: number };
      bodyEnd: { x: number; y: number };
    }>;
  }>;
  wires: Array<{ pointsNm: Array<{ x: number; y: number }> }>;
  /** Power/ground/portal primitives (geometry templated client-side per kind). */
  primitives: Array<{
    kind: DesignerPrimitiveKind;
    positionNm: { x: number; y: number };
    rotationDeg: number;
  }>;
}

/**
 * PCB layer identifier. The wire-format contract — persisted in `board_settings`
 * payloadJson. Adding a layer here means migrations must accept it; removing
 * one means a migration must rewrite saved boards. Kept in sync with the
 * frontend canvas `PcbLayerId` in `src/shared/frontend/canvas/layers.ts`.
 *
 * Grouping:
 *  - Copper:     F.Cu, In1.Cu, In2.Cu, B.Cu  (traces + vias + pads live here)
 *  - Solder mask:F.Mask, B.Mask              (translucent green overlay)
 *  - Solder paste:F.Paste, B.Paste           (SMD stencil aperture)
 *  - Silkscreen: F.SilkS, B.SilkS            (component outlines + refdes)
 *  - Courtyard:  F.CrtYd, B.CrtYd            (no-go zone marker)
 *  - Fabrication:F.Fab, B.Fab                (assembly notes, hidden by default)
 *  - Edge:       Edge.Cuts                   (board outline)
 *  - Drill:      Drill                       (virtual layer — all PTH + via holes)
 *  - Metadata:   Metadata                    (refdes/value annotation)
 */
export type PcbLayerId =
  | "F.Cu"
  | "In1.Cu"
  | "In2.Cu"
  | "In3.Cu"
  | "In4.Cu"
  | "In5.Cu"
  | "In6.Cu"
  | "In7.Cu"
  | "In8.Cu"
  | "In9.Cu"
  | "In10.Cu"
  | "In11.Cu"
  | "In12.Cu"
  | "In13.Cu"
  | "In14.Cu"
  | "In15.Cu"
  | "In16.Cu"
  | "In17.Cu"
  | "In18.Cu"
  | "In19.Cu"
  | "In20.Cu"
  | "In21.Cu"
  | "In22.Cu"
  | "In23.Cu"
  | "In24.Cu"
  | "In25.Cu"
  | "In26.Cu"
  | "In27.Cu"
  | "In28.Cu"
  | "In29.Cu"
  | "In30.Cu"
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
 * Subset of PcbLayerId that traces and vias may live on (copper only). Inner
 * layers In1..In30 support up to a 32-layer stackup (P2). Explicit literal
 * union (not a template type) so exhaustiveness stays strict.
 */
export type PcbCopperLayerId =
  | "F.Cu"
  | "In1.Cu" | "In2.Cu" | "In3.Cu" | "In4.Cu" | "In5.Cu" | "In6.Cu" | "In7.Cu" | "In8.Cu" | "In9.Cu" | "In10.Cu" | "In11.Cu" | "In12.Cu" | "In13.Cu" | "In14.Cu" | "In15.Cu" | "In16.Cu" | "In17.Cu" | "In18.Cu" | "In19.Cu" | "In20.Cu" | "In21.Cu" | "In22.Cu" | "In23.Cu" | "In24.Cu" | "In25.Cu" | "In26.Cu" | "In27.Cu" | "In28.Cu" | "In29.Cu" | "In30.Cu"
  | "B.Cu";

/**
 * Display emphasis mode controlling how non-active layers render relative to
 * the active layer. Mirrors KiCad's Ctrl+H cycle.
 *  - `normal`: every visible layer at full color/opacity.
 *  - `dim`:    non-active layers desaturated + reduced opacity (~0.18).
 *  - `solo`:   non-active layers hidden entirely.
 */
export type PcbDisplayMode = "normal" | "dim" | "solo";

/** Stackup layer count. Even values 2..32 (P2 full multilayer). */
export type PcbLayerCount = 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20 | 22 | 24 | 26 | 28 | 30 | 32;

export type PcbTraceSegmentMode = "manhattan-90" | "manhattan-45";

/** Side of the board the viewer is looking at. Drives X-mirror + z-flip. */
export type PcbViewSide = "top" | "bottom";

/**
 * Built-in layer-set presets. Match the four cards the user picked during
 * planning. `custom` = user-modified visibility set (no preset matched). The
 * canvas tracks the active preset so the panel can highlight it; switching
 * presets replaces visibleLayers + activeLayer + (optionally) viewSide.
 */
export type PcbLayerPreset =
  | "custom"
  | "top-side"
  | "bottom-side"
  | "all-copper"
  | "assembly";

/**
 * Curated cloud-auto-place knobs the Auto-Layout modal exposes — a subset of
 * the service `PlaceOptions` (weights + subset mode intentionally omitted).
 */
export interface AutoLayoutPlaceConfig {
  allowRotate: boolean;
  allowFlip: boolean;
  moveConnectors: boolean;
  respectExistingTraces: boolean;
  /** Board fill target, 0..1. */
  targetUtilization: number;
}

/**
 * Curated cloud-auto-route knobs the Auto-Layout modal exposes — a subset of
 * the service `RouteOptions`. `serializePours: "auto"` omits the flag from the
 * request so the backend negotiates it against the service capability.
 */
export interface AutoLayoutRouteConfig {
  geometryMode: PcbTraceSegmentMode;
  allowVias: boolean;
  maxViasPerNet?: number | null;
  serializePours?: boolean | "auto";
}

/**
 * Persisted per-design Auto-Layout config: which stages run, the chosen preset
 * + effort tier, and the curated place/route knobs. Stored inside
 * `board_settings.viewState` JSON (no migration). Additive-optional on
 * `PcbViewState`; absent rows seed from the localStorage global default or the
 * frontend `DEFAULT_AUTOLAYOUT_CONFIG`.
 */
export interface AutoLayoutConfig {
  /**
   * LEGACY stage toggles. Full Auto Layout is one composite cloud job — there are no
   * desktop-sequenced stages to switch off — so these are read only by the config
   * migration, which maps `runPlace:false, runRoute:true` onto a Route Board run rather
   * than onto a layout run. Kept optional so an older persisted blob still parses.
   */
  runPlace?: boolean;
  runRoute?: boolean;
  /**
   * Product intent for the run. `preserve` biases toward the user's existing layout;
   * `custom` means the Advanced knobs were touched.
   */
  preset:
    | "fast"
    | "balanced"
    | "quality"
    | "routability"
    | "compact"
    | "preserve"
    | "custom";
  effort: "fast" | "balanced" | "quality";
  /** Which components the placer may move. `selected` requires a non-empty selection. */
  scope?: "all" | "selected";
  place: AutoLayoutPlaceConfig;
  route: AutoLayoutRouteConfig;
}

/**
 * Per-design persisted display state. Carries everything the layer panel /
 * canvas chrome needs to re-render identically on reload. Additive: missing
 * fields fall back to defaults (no destructive migration).
 *
 * The per-layer copper fill is NOT here: it is a persisted board zone row
 * (`PcbZone` with `region: { kind: "board" }`), so display state never decides
 * what copper exists. Legacy rows carrying the old `copperFill*` keys are
 * migrated once by `migrateLegacyBoardFill` (zone/keepout contract §12.1).
 *
 *  - perLayerOpacity: 0..1 override applied on top of displayMode dimming.
 *  - layerPreset: tracks which built-in preset (if any) the visibleLayers set
 *    currently matches; UI uses it to highlight the active preset chip.
 */
export interface PcbViewState {
  displayMode: PcbDisplayMode;
  viewSide: PcbViewSide;
  perLayerOpacity: Partial<Record<PcbLayerId, number>>;
  layerPreset: PcbLayerPreset;
  ratsnestVisible: boolean;
  /**
   * Figma-style placement/routing alignment guides + magnetic snapping.
   * Optional so board_settings rows saved before this feature hydrate to the
   * default-on behavior. Absent = enabled.
   */
  alignmentGuidesVisible?: boolean;
  /**
   * DRC rule-classes the user has chosen to ignore wholesale (panel "ignore
   * all" toggles). Violations in these classes are not emitted. Additive;
   * absent = ignore nothing.
   */
  drcIgnoredRuleClasses?: DrcRuleClass[];
  /**
   * Stable ids of individually waived DRC violations. Waived violations are
   * still listed (struck-through) but excluded from the active summary counts.
   * Additive; absent = no waivers.
   */
  drcWaivedViolationIds?: string[];
  /**
   * Persisted Auto-Layout modal config (place/route stage toggles, preset,
   * curated knobs). Additive; absent = seed from the localStorage global
   * default or `DEFAULT_AUTOLAYOUT_CONFIG`.
   */
  autoLayoutConfig?: AutoLayoutConfig;
}

export interface PcbPointMm {
  x: number;
  y: number;
}

export type PcbBoardOutline =
  | PcbBoardOutlineRect
  | PcbBoardOutlineRoundRect
  | PcbBoardOutlineCircle
  | PcbBoardOutlinePolygon
  | PcbBoardContour;

/**
 * Every outline variant carries a `widthMm` / `heightMm` / `centerMm` bounding
 * box. For non-rect shapes this is a *cache* of the shape's extent — kept so
 * consumers that only need the board footprint (3D enclosure, fab presets,
 * legacy code) keep working without shape awareness. Recompute it with
 * `computeOutlineBboxMm` whenever the shape geometry changes.
 */
export interface PcbBoardOutlineRect {
  kind: "rect";
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
}

/** Rounded rectangle with a single (uniform) corner radius. */
export interface PcbBoardOutlineRoundRect {
  kind: "roundrect";
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
  cornerRadiusMm: number;
}

/**
 * Circle / ellipse. `widthMm` / `heightMm` are the bounding box (= the two
 * diameters); a circle has `widthMm === heightMm`. An oval has them differ.
 */
export interface PcbBoardOutlineCircle {
  kind: "circle";
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
}

/**
 * Closed polygon outline imported from KiCad's Edge.Cuts graphics. Line-only
 * (no arc fidelity). Kept for back-compat with existing KiCad imports; new
 * free-form shapes use `PcbBoardContour` instead.
 */
export interface PcbBoardOutlinePolygon {
  kind: "polygon";
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
  pointsMm: Array<{ x: number; y: number }>;
}

/**
 * One edge of a closed contour. The segment's start point is the previous
 * segment's `to` (the contour's `start` for the first segment); the loop closes
 * from the last segment's `to` back to `start`.
 */
export type PcbOutlineSegment =
  | { type: "line"; to: PcbPointMm }
  | { type: "arc"; to: PcbPointMm; centerMm: PcbPointMm; cw: boolean };

/**
 * Arc-aware free-form closed outline — the result of polygon drawing, fillet /
 * chamfer edits, and DXF / SVG import. Arcs are preserved (not flattened) so
 * Gerber / fabrication keep true curves.
 */
export interface PcbBoardContour {
  kind: "contour";
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
  start: PcbPointMm;
  segments: PcbOutlineSegment[];
}

/**
 * A closed shape representing a single internal cutout (slot, window, internal
 * milling). Cutouts are punched out of the board substrate and exported as
 * additional closed Edge.Cuts contours. Reuses the non-rect outline shapes.
 */
export type PcbBoardCutoutShape =
  | PcbBoardOutlineRoundRect
  | PcbBoardOutlineCircle
  | PcbBoardContour;

export interface PcbBoardCutout {
  id: string;
  shape: PcbBoardCutoutShape;
}

export interface PcbDesignRules {
  clearance: {
    traceToTraceMm: number;
    traceToPadMm: number;
    padToPadMm: number;
    traceToViaMm: number;
    viaToViaMm: number;
    copperToBoardEdgeMm: number;
    /**
     * Min drill-edge-to-board-edge spacing (mm). Optional/additive — absent on
     * pre-P5 boards, where the context defaults it (audit B4-4).
     */
    holeToBoardEdgeMm?: number;
    /**
     * Zone-fill clearance floor against foreign copper (mm) — the pour-side
     * component of the `pourToTrace` / `pourToPad` / `pourToVia` / `pourToPour`
     * pair kinds (rule-semantics contract §6). Optional/additive; absent reads
     * as 0.5, the constant the fill kernel has always used.
     */
    pourToCopperMm?: number;
    /**
     * Copper-to-non-plated-drill clearance (mm): trace / pad / via copper edge
     * to an NPTH drill wall (free holes and non-plated free-pad drills).
     * Optional/additive; absent reads as `copperToBoardEdgeMm`, the value the
     * pour has always applied to its NPTH halo (batch-DRC contract 06 §4).
     */
    copperToHoleMm?: number;
  };
  minimums: {
    traceWidthMm: number;
    drillSizeMm: number;
    annularRingMm: number;
    viaDiameterMm: number;
    viaDrillMm: number;
    /**
     * Minimum edge-to-edge spacing between drilled holes (mm). Optional/additive
     * — readers default to 0.25 mm (IPC-2222 / typical fab). Drives the
     * hole-to-hole DRC check.
     */
    holeToHoleMm?: number;
    /**
     * Absolute clearance floor (mm) — no scoped rule or net class may resolve
     * BELOW this (KiCad's board-minimum semantics). Optional/additive; absent
     * (pre-P6 boards) reads as 0 so no board is retroactively tightened.
     */
    clearanceMm?: number;
  };
  /**
   * Electrical modeling parameters for the IPC-2221 checks (electrical contract
   * 13 §1.3, §5). Optional/additive — every key absent uses the documented
   * default (10 °C rise, 1 oz copper, uncoated outer conductors).
   */
  electrical?: {
    /** Allowed conductor temperature rise (°C). Absent reads as 10. */
    tempRiseC?: number;
    /** Nominal OUTER copper weight (oz/ft²). Absent reads as 1. */
    copperWeightOz?: number;
    /**
     * Nominal INNER copper weight (oz/ft²) — inner layers are commonly half
     * the outer weight. Absent falls back to `copperWeightOz`, then to 1.
     */
    innerCopperWeightOz?: number;
    /**
     * Whether the outer conductors carry a PERMANENT POLYMER COATING, which
     * selects the IPC-2221B B4 spacing column instead of B2 (13 §1.2).
     * `"coated"` is the USER'S CLAIM: whether a liquid-photoimageable solder
     * mask qualifies depends on coverage, openings and process qualification
     * OpenPCB cannot see, and an item exposed through a mask opening is judged
     * in B2 whatever this says. Absent reads as `"uncoated"`.
     */
    outerConductors?: "uncoated" | "coated";
  };
  /**
   * Silkscreen DFM parameters (DFM contract 11 §6). Optional/additive; an
   * absent key reads as the check's own documented default, so no existing
   * board is retroactively judged by a rule it never stored.
   */
  silkscreen?: {
    /** Legend ink to a solder-mask opening (mm). Absent reads as 0. */
    silkToMaskClearanceMm?: number;
    /** Legend ink to the board boundary (mm). Absent reads as 0.15. */
    silkToBoardEdgeMm?: number;
  };
  /** Solder-mask DFM parameters (§6). */
  solderMask?: {
    /**
     * Minimum mask dam between two openings (mm). ABSENT means no design-rule
     * verdict at all — only the fabricator row applies.
     */
    minBridgeMm?: number;
  };
  /** Copper-shape and courtyard DFM parameters (§6). */
  dfm?: {
    /** Minimum conductive width (mm). Absent reads as 0.1, capped by `minimums.traceWidthMm`. */
    sliverWidthMm?: number;
    /** Minimum length of a sub-width appendage worth reporting (mm). Absent reads as 0.2. */
    sliverMinLengthMm?: number;
    /** Minimum interior angle at a trace junction (deg). Absent reads as 90. */
    acuteAngleDeg?: number;
    /**
     * Courtyard excess applied to a footprint's bounds when it declares no
     * courtyard (mm). Absent reads as 0.25 — the IPC-7351B level B value.
     */
    courtyardFallbackMm?: number;
  };
  /**
   * Board-material rules (exact-geometry contract 12 §5). Optional/additive,
   * and ABSENT means no verdict at all: the minimum web a board may carry is a
   * shape intent no fabricator row states and nothing may default for a user.
   */
  outline?: {
    /**
     * Minimum width of board MATERIAL anywhere — between two cutouts, between
     * a cutout and the edge, or across the board's own neck (mm).
     */
    minWebMm?: number;
  };
}

/**
 * Object-pair kind a scoped clearance rule targets. The four `pourTo*` kinds
 * name a copper pour on one side; a rule reaches them ONLY through an explicit
 * `pairKind` scope (rule-semantics contract §6 rule 1), so no pre-S6 rule can
 * change a fill.
 */
export type DrcPairKind =
  | "traceToTrace"
  | "traceToPad"
  | "traceToVia"
  | "padToPad"
  | "padToVia"
  | "viaToVia"
  | "pourToTrace"
  | "pourToPad"
  | "pourToVia"
  | "pourToPour";

/**
 * A scope predicate for a DRC rule. All scopes on a rule are AND-combined; a
 * rule with `scopes: []` matches everything. For a clearance query, `net` /
 * `netClass` match if EITHER pair item qualifies; `area` matches only when
 * BOTH items fall inside the polygon (BGA-fanout relaxation semantics).
 * Repeated scopes of the SAME kind union their sets (rule-semantics contract
 * §4.2): several `area` scopes mean "both items inside any ONE of them".
 */
export type DrcRuleScope =
  | { kind: "net"; netIds: string[] }
  | { kind: "netClass"; netClassIds: string[] }
  | { kind: "layer"; layers: PcbCopperLayerId[] }
  | { kind: "area"; polygonMm: PcbPointMm[] }
  | { kind: "pairKind"; pairKinds: DrcPairKind[] };

/** The constraint a scoped rule imposes. */
export type DrcRuleConstraint =
  | { kind: "clearance"; mm: number }
  | { kind: "trackWidth"; minMm: number }
  | { kind: "viaDiameter"; minMm: number }
  | { kind: "viaDrill"; minMm: number }
  | { kind: "annularRing"; minMm: number }
  | { kind: "holeToHole"; minMm: number }
  | { kind: "edgeClearance"; minMm: number };

/**
 * A scoped, prioritized DRC rule (DRC_HARDENING_PLAN.md P6). Clearance rules
 * resolve Altium-style: highest priority first-match wins, and a rule MAY relax
 * below the board default — but never below `minimums.clearanceMm`. Scalar
 * constraints (width/via/annular/hole/edge) can only tighten.
 */
export interface PcbDrcRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Higher wins; ties broken by earlier array index. */
  priority: number;
  /** AND-combined scope predicates; `[]` matches everything. */
  scopes: DrcRuleScope[];
  constraint: DrcRuleConstraint;
  /** Optional severity for violations this rule produces. */
  severity?: DrcSeverity;
  comment?: string;
}

export interface PcbNetClass {
  id: string;
  name: string;
  traceWidthMm: number;
  clearanceMm: number;
  viaDiameterMm: number;
  viaDrillMm: number;
  /** Color used to render ratsnest airwires for nets in this class. */
  color: string;
  /** IPC-4761 default applied to new vias on nets in this class. */
  defaultViaProtection: PcbViaProtection;
  /**
   * Differential-pair edge-to-edge gap (mm) for nets in this class. Used by
   * bundle routing as the default pitch for detected `_P/_N` / `+/-` pairs.
   * Optional — absent falls back to the class clearance.
   */
  diffPairGapMm?: number;
  /**
   * Constant DC potential of nets in this class relative to the board
   * reference (V, signed). Drives the IPC-2221 conductor-spacing requirement
   * (electrical contract 13 §2). Optional; ABSENT = undeclared, and an
   * undeclared net is ASSUMED at the reference potential — an assumption the
   * verdict states, not a measurement. An explicit `0` is the same assumption.
   */
  voltageV?: number;
  /**
   * The interval a VARYING potential occupies (AC, a switching node, a bipolar
   * signal), in volts. Both or neither; absent means `[voltageV, voltageV]`.
   * Two DISTINCT nets of one class are INDEPENDENT potentials, so a class
   * `[−300, 300]` gives Δ = 600 V between two of its nets (13 §2) — class
   * membership never establishes correlation. Conductors at two different
   * CONSTANT potentials need two classes.
   */
  voltageMinV?: number;
  /** Upper end of {@link voltageMinV}'s interval; both or neither. */
  voltageMaxV?: number;
  /**
   * Steady-state current (A) carried by nets in this class, driving the
   * IPC-2221 current-versus-width estimate (electrical contract 13 §5). Every
   * segment of the net — including unassigned copper that extends it — is
   * judged as carrying the FULL value; parallel paths are not modelled.
   * Optional; absent = unrated, and a present value that is not finite and
   * strictly positive is a `DRC_RULE_INVALID` row under which no trace of the
   * class is judged.
   */
  currentA?: number;
}

/**
 * Named length-match rule over a set of nets (high-speed buses, clocks).
 * `longest` targets track the longest routed member dynamically; `absolute`
 * targets pin an explicit routed length. Evaluated by the DRC length check
 * and surfaced live in the route/tune HUD gauges.
 */
/**
 * A differential pair (P10/P11). Explicit entries win over the name-convention
 * heuristic. Optional per-pair overrides fall back to the nets' class defaults.
 */
export interface PcbDiffPair {
  id: string;
  name: string;
  pNetId: string;
  nNetId: string;
  /** Target edge-to-edge coupled gap (mm); falls back to class diffPairGapMm. */
  gapMm?: number;
  /** Allowed gap deviation (mm); default 0.05. */
  gapTolMm?: number;
  /** Max uncoupled run per member (mm); default 15. */
  maxUncoupledMm?: number;
  /** Max intra-pair length skew (mm); default 0.5. */
  maxSkewMm?: number;
}

/**
 * The one default finished-board thickness (mm, standard FR4) for an absent
 * `PcbBoardSettings.boardThicknessMm`. The DRC context, the cloud board
 * snapshot, the Gerber job file and the 3D preview all read this constant
 * instead of re-declaring 1.6.
 */
export const DEFAULT_BOARD_THICKNESS_MM = 1.6;

export interface PcbLengthMatchGroup {
  id: string;
  name: string;
  netIds: string[];
  target: { kind: "longest" } | { kind: "absolute"; mm: number };
  /** Allowed deviation from the target (mm, ≥ 0). */
  toleranceMm: number;
}

export interface PcbBoardSettings {
  outline: PcbBoardOutline;
  /**
   * Internal cutouts punched out of the board. Optional for back-compat with
   * pre-cutout saves; readers must treat an absent field as an empty list.
   */
  cutouts?: PcbBoardCutout[];
  activeLayer: PcbLayerId;
  visibleLayers: PcbLayerId[];
  designRules: PcbDesignRules;
  netClasses: PcbNetClass[];
  /**
   * Explicit per-net → net-class overrides (netId → netClassId). Consulted
   * before the name-pattern heuristic in `resolveNetClassId`, and applied to
   * new traces/vias at creation. Optional/additive — readers treat an absent
   * field as no overrides. Unknown class ids are dropped on persist.
   */
  perNetClassAssignments?: Record<string, string>;
  /**
   * Per-code DRC severity policy: maps a DrcRuleCode to a severity or the
   * string "ignore" (drop the code). Optional/additive. A design property
   * (shared by collaborators), so it lives on board settings, not viewState.
   * Safety-critical codes (shorts, layer-invalid) ignore overrides.
   */
  drcSeverityOverrides?: Partial<
    Record<DrcRuleCode, DrcSeverity | "ignore">
  >;
  /**
   * Scoped priority DRC rules (P6). Optional/additive — absent reads as no
   * rules, i.e. the implicit board-rule + net-class tier only (byte-identical
   * to pre-P6 behavior).
   */
  drcRules?: PcbDrcRule[];
  /**
   * Explicit differential pairs (P11). Optional/additive; a net-name
   * convention also auto-detects pairs when no explicit entry covers a net.
   */
  diffPairs?: PcbDiffPair[];
  /**
   * Length-match rules (see PcbLengthMatchGroup). Optional/additive —
   * readers treat an absent field as no rules. Entries whose net ids no
   * longer resolve are kept (nets may reappear) but skipped in evaluation.
   */
  lengthMatchGroups?: PcbLengthMatchGroup[];
  /**
   * Board-level trace-width presets (mm), shown in the route-tool dropdown
   * and cycled with W / Shift+W. The active net class's traceWidthMm is the
   * implicit default at session start.
   */
  tracePresets: number[];
  /**
   * Manufacturer preset for fab-rule validation. `"custom"` = user-defined
   * design rules only. Otherwise validation surfaces warnings when traces /
   * vias fall below the named fab's minimums (see `fab-presets.ts`).
   */
  fabricator: PcbFabricatorId;
  /**
   * Stackup layer count. Controls whether In1.Cu / In2.Cu are routable and
   * appear in the layer panel.
   */
  layerCount: PcbLayerCount;
  /**
   * Finished board thickness (mm). Optional/additive — readers default to
   * 1.6 mm (standard FR4). Drives the via aspect-ratio DRC check
   * (thickness / drill ≤ fab max).
   */
  boardThicknessMm?: number;
  /** Non-active layer emphasis cycle (Normal/Dim/Solo). Default `normal`. */
  displayMode: PcbDisplayMode;
  /**
   * Solder-mask aperture expansion (mm, per side). IPC-7351 typ. 0.05–0.075
   * SMD, 0.10 THT. Board-global v1; per-pad override deferred.
   */
  solderMaskExpansionMm: number;
  /**
   * Solder-paste aperture inset (mm, per side). Negative = aperture smaller
   * than pad. Typical −0.05 mm. Affects SMD pads only (THT skipped).
   */
  solderPasteExpansionMm: number;
  /**
   * Per-design display state (view-side, fill toggles, presets, opacities…).
   * Optional for backward-compat with pre-viewState saves; readers must
   * apply a default fallback when this field is absent.
   */
  viewState?: PcbViewState;
  updatedAt: string;
}

/**
 * Identifiers must match keys of `FAB_PRESETS` in
 * `src/modules/designer/backend/pcb/fab-presets.ts`.
 */
export type PcbFabricatorId =
  | "custom"
  | "jlcpcb_2l"
  | "jlcpcb_4l"
  | "pcbway_std"
  | "pcbway_advanced";

export interface PcbPlacedPart {
  id: string;
  partId: string;
  componentId: string;
  reference: string;
  positionMm: PcbPointMm;
  rotationDeg: number;
  mirrored: boolean;
  layer: PcbLayerId;
  footprint: LibraryFootprintPlacementSnapshot;
}

export interface PcbTrace {
  id: string;
  /** Net id resolved at create time from the starting pad, or null for empty-space starts. */
  netId: string | null;
  netClassId: string;
  layer: PcbCopperLayerId;
  /** Width in mm. Defaults from net class; user may override mid-route. */
  widthMm: number;
  /** Polyline in nm; >=2 points; segments are 90° or 45° depending on segmentMode. */
  pointsNm: Array<{ x: number; y: number }>;
  segmentMode: PcbTraceSegmentMode;
  /**
   * Optional hint emitted by importers (KiCad) carrying the source net name.
   * The projection net-pad correlator uses this to bind `netId` when pad
   * endpoint alignment is ambiguous (via-to-via, label-routed segments).
   * Native traces created via the route tool leave this null.
   */
  netName?: string | null;
}

/**
 * IPC-4761 via protection (tenting / fill / cap).
 *  - `tented`: solder mask covers via opening (default; cheapest).
 *  - `none`:   open via, accessible for test probes.
 *  - `plugged` / `filled`: non-conductive epoxy fill (Type III–VI).
 *  - `capped`:  filled + plated copper cap (Type VII; required for via-in-pad).
 */
export type PcbViaProtection =
  | "none"
  | "tented"
  | "plugged"
  | "filled"
  | "capped";

/**
 * Via topology. v1 ships only `through`; the schema is forward-compat for HDI
 * (blind/buried/microvia) when inner layers land in Phase C.
 */
export type PcbViaType = "through" | "blind" | "buried" | "micro";

/**
 * Origin of the via:
 *  - `route`  : dropped by the routing tool as part of a trace path (default).
 *  - `manual` : placed standalone by the user — stitching via, test point,
 *               isolated drop. v1 ships data-only; full manual-via tooling
 *               lives behind the F5 toolbar work-stream.
 */
export type PcbViaProvenance = "route" | "manual";

export interface PcbVia {
  id: string;
  netId: string | null;
  netClassId: string;
  centerMm: PcbPointMm;
  diameterMm: number;
  drillMm: number;
  /** Start copper layer of the via barrel. v1 = F.Cu (or B.Cu). */
  fromLayer: PcbCopperLayerId;
  /** End copper layer. v1 = B.Cu (or F.Cu). */
  toLayer: PcbCopperLayerId;
  viaType: PcbViaType;
  protection: PcbViaProtection;
  /** Defaults to `"route"` for legacy / pre-F5 rows. */
  provenance: PcbViaProvenance;
  /**
   * Optional importer hint — see PcbTrace.netName. Used by the projection
   * correlator to resolve `netId` when via geometry doesn't directly
   * intersect a pad.
   */
  netName?: string | null;
}

/**
 * Free-standing mechanical hole — drilled non-electrical opening that is not
 * part of any footprint. Used for mounting holes, tooling holes, alignment
 * cutouts, etc. Renders as a real cutout in the board substrate plus a lime
 * outline ring (shared rendering path with via / pad drills).
 *
 * Free holes are invisible to nets, ratsnest, and electrical DRC. Mechanical
 * DRC (drill-to-trace clearance) is applied separately via the design rules.
 */
/**
 * Oblong / slotted drill. When present on a free hole/pad, the drill is a
 * rounded slot (e.g. USB shield, edge connector) rather than a round hole:
 * Excellon emits it as a `G85` routed slot (tool diameter = `widthMm`) instead
 * of a single round hit. `lengthMm` is the overall long dimension along
 * `angleDeg` (0 = +X); `lengthMm === widthMm` degenerates to a round hole.
 */
export interface PcbDrillSlot {
  lengthMm: number;
  widthMm: number;
  angleDeg: number;
}

export interface PcbFreeHole {
  id: string;
  centerMm: PcbPointMm;
  drillMm: number;
  /** Oblong drill. When set, the hole is a routed slot of width `drillMm`. */
  drillSlot?: PcbDrillSlot | null;
  /** When true, the hole is read-only in the editor until unlocked. */
  lockedAt: string | null;
}

/**
 * Region a copper zone fills. A `"board"` region is the whole board (the
 * per-layer copper plane the layers panel toggles); a `"polygon"` region is an
 * explicit simple polygon in mm. Both are persisted rows — a board region
 * carries no points, and its zone id must be `board:<layer>`.
 */
export type PcbZoneRegion =
  | { kind: "board" }
  /** `holesMm` = zone cutouts (copper-pour contract §11); parse/validity is WP4's. */
  | { kind: "polygon"; pointsMm: PcbPointMm[]; holesMm?: PcbPointMm[][] };

/**
 * Same-net pad connection inside a zone. `"solid"` floods the pad,
 * `"thermal"` leaves an IPC-2221 relief crossed by spokes, `"thruHoleThermal"`
 * is thermal for drilled pads and `"none"` for undrilled ones, and `"none"`
 * treats same-net pads as different-net copper (excluded with clearance).
 */
export type PcbZonePadConnection =
  | "solid"
  | "thermal"
  | "thruHoleThermal"
  | "none";

/**
 * What happens to a fill island that no same-net object anchors: keep every
 * island, drop every unanchored one, or keep the ones at least `minAreaMm2`.
 */
export type PcbZoneIslandRemoval =
  | "always"
  | "never"
  | { minAreaMm2: number };

/**
 * Copper zone (v2) — a region of ONE copper layer filled with the copper of
 * one net, or of no net. Zones make copper; keepouts make rules. The effective
 * list every consumer reads comes from `collectCopperZones`
 * (`src/shared/pcb-areas/copper-zones.ts`), never from this record directly.
 * Persisted v1 rows are upgraded on read by `upgradePcbZoneRecord`.
 */
export interface PcbZone {
  id: string;
  name: string | null;
  /** `false` = intent, not a warning: no copper, no connectivity, no export. */
  enabled: boolean;
  /** When set, the zone is read-only in the editor until unlocked. */
  lockedAt: string | null;
  layer: PcbCopperLayerId;
  /**
   * Resolved net id (schematic net the zone pours). `null` with a `netName`
   * that does not resolve is *unbound* — the zone pours nothing; `null` with
   * no `netName` is net-less copper, which pours but joins no net graph.
   */
  netId: string | null;
  /**
   * Source net name (e.g. "GND"). Bound to `netId` at projection time by the
   * same name-binding pass that handles `PcbTrace.netName`.
   */
  netName: string | null;
  region: PcbZoneRegion;
  /** Integer ≥ 0; a higher priority fills first. */
  priority: number;
  /** Absent ⇒ the constant default `"solid"`; there is no board-level setting. */
  padConnection?: PcbZonePadConnection;
  /** Tighten-only override: the resolved value is `max(board rule, this)`. */
  clearanceMm?: number | null;
  /** Tighten-only override: the resolved value is `max(board rule, this)`. */
  minWidthMm?: number | null;
  /** Absent ⇒ the fill kernel's thermal defaults. */
  thermal?: { gapMm: number; spokeWidthMm: number } | null;
  /** Absent ⇒ the board default island-removal policy. */
  islandRemoval?: PcbZoneIslandRemoval;
}

/** Object classes a keepout forbids inside its region. `true` = forbidden. */
export interface PcbKeepoutRestrictions {
  tracks: boolean;
  vias: boolean;
  pads: boolean;
  copperPour: boolean;
  footprints: boolean;
}

/**
 * Keepout (KiCad "rule area") — a region on a SET of copper layers where the
 * selected object classes are forbidden. Keepouts never make copper, and are
 * not clipped to the board (the off-board part is inert).
 */
export interface PcbKeepout {
  id: string;
  name: string | null;
  /** `false` = intent: the keepout affects nothing anywhere. */
  enabled: boolean;
  /** When set, the keepout is read-only in the editor until unlocked. */
  lockedAt: string | null;
  /** Non-empty; copper layers only in v1. */
  layers: PcbCopperLayerId[];
  pointsMm: PcbPointMm[];
  restrictions: PcbKeepoutRestrictions;
}

/**
 * Layer a free overlay primitive may live on. Restricts to non-copper layers
 * so overlay graphics don't accidentally pollute electrical net extraction.
 */
export type PcbOverlayLayer =
  | "F.SilkS"
  | "B.SilkS"
  | "F.Fab"
  | "B.Fab"
  | "F.CrtYd"
  | "B.CrtYd"
  | "Edge.Cuts";

/**
 * Free-standing silkscreen / fab text. Anchored at a position with a font
 * size + rotation. The renderer falls back to the canvas EDA text primitive.
 */
export interface PcbOverlayText {
  id: string;
  layer: PcbOverlayLayer;
  positionMm: PcbPointMm;
  text: string;
  fontSizeMm: number;
  rotationDeg: number;
  mirror: boolean;
  /** Horizontal anchor. */
  justify: "left" | "center" | "right";
  lockedAt: string | null;
}

/**
 * Free-standing overlay shape — rectangle, circle, line, polyline, polygon.
 * Geometry lives in `points` (interpretation depends on `kind`):
 *  - rect:     [bottomLeft, topRight]
 *  - circle:   [center, edgePoint]  — radius = distance(center, edgePoint)
 *  - line / polyline / polygon: ordered vertices
 */
export type PcbOverlayShapeKind =
  | "rect"
  | "circle"
  | "line"
  | "polyline"
  | "polygon";

export interface PcbOverlayShape {
  id: string;
  layer: PcbOverlayLayer;
  kind: PcbOverlayShapeKind;
  pointsMm: PcbPointMm[];
  strokeWidthMm: number;
  /** Fill applies only to closed shapes (rect, circle, polygon). */
  fill: "none" | "solid";
  lockedAt: string | null;
}

/**
 * Free pad type. Drives which fields are valid + how the pad renders:
 *  - `smd`  : surface-mount, single layer — a `drillMm`, when present, is a
 *             non-plated drill (Excellon NPTH, cleared like a free hole).
 *  - `hole` : non-plated through-hole (NPTH) — drill only, no copper.
 *  - `std`  : standard plated through-hole — drill + annular copper on EVERY
 *             copper layer of the stackup (the one free-pad layer model).
 *  - `conn` : connector / large-area paddle pad, single layer — a `drillMm`,
 *             when present, is a non-plated drill (Excellon NPTH, cleared like
 *             a free hole).
 */
export type PcbFreePadType = "smd" | "hole" | "std" | "conn";

/**
 * Free pad shape. Matches the existing footprint pad shape enum so the
 * renderer can route through `PadInstances` without special-casing.
 */
export type PcbFreePadShape = "rect" | "circle" | "oval" | "roundrect";

/**
 * Free-standing electrical pad — not part of any footprint. Test point,
 * fiducial, paddle, manually placed pad. Optionally net-assigned so the
 * ratsnest and DRC see it as part of a net.
 */
export interface PcbFreePad {
  id: string;
  centerMm: PcbPointMm;
  rotationDeg: number;
  padType: PcbFreePadType;
  shape: PcbFreePadShape;
  widthMm: number;
  heightMm: number;
  /** Corner radius ratio for roundrect (0..0.5). Ignored for other shapes. */
  roundrectRatio?: number;
  /** Required for `hole` and `std`. Ignored / undefined otherwise. */
  drillMm: number | null;
  /** Oblong drill for `hole`/`std` pads. When set, the drill is a routed slot of width `drillMm`. */
  drillSlot?: PcbDrillSlot | null;
  /** Copper layer the pad lives on. `std` pads span F.Cu + B.Cu and only set this for fab-order purposes. */
  layer: PcbCopperLayerId;
  /** Net assignment. `null` = isolated pad. */
  netId: string | null;
  /** Optional mask expansion override (mm). `null` means use design rule. */
  solderMaskExpansionMm: number | null;
  /** Optional paste expansion override (mm). */
  solderPasteExpansionMm: number | null;
  lockedAt: string | null;
}

/**
 * What an airwire is anchored on. Free pads (test points, paddles) carry a net
 * and join the copper graph, so a ratsnest endpoint is not always a footprint
 * pad — consumers that need `placementId` must narrow on `kind` first.
 */
export type RatsnestEndpoint =
  | { kind: "pad"; placementId: string; padNumber: string }
  | { kind: "freePad"; freePadId: string };

export interface RatsnestSegment {
  netId: string;
  /** Net-class id used for color routing (e.g. "default", "power", "gnd"). */
  netClassId: string;
  fromMm: PcbPointMm;
  toMm: PcbPointMm;
  /** Copper the airwire leaves from (the component representative). */
  from: RatsnestEndpoint;
  /** Copper the airwire lands on. */
  to: RatsnestEndpoint;
}

export interface DesignerPcbProjection {
  designId: string;
  revision: number;
  board: PcbBoardSettings;
  placements: PcbPlacedPart[];
  traces: PcbTrace[];
  vias: PcbVia[];
  /** Free-standing mechanical holes (mounting / tooling). Non-electrical. */
  freeHoles: PcbFreeHole[];
  /** Free-standing electrical pads (test points, paddles, fiducials). */
  freePads: PcbFreePad[];
  /** Silkscreen / fab text and shape primitives (F5 overlay layer). */
  overlayTexts: PcbOverlayText[];
  overlayShapes: PcbOverlayShape[];
  /**
   * Copper zones (v2), including the persisted `board:<layer>` board zones the
   * per-layer copper fill is made of. The effective pour list comes from
   * `collectCopperZones` (`src/shared/pcb-areas/copper-zones.ts`), never from
   * these rows directly.
   */
  zones: PcbZone[];
  /** Keepouts (KiCad rule areas). Never copper; see `collectKeepouts`. */
  keepouts: PcbKeepout[];
  ratsnest: RatsnestSegment[];
  /**
   * Net id → display name map (e.g. `"net-7" → "VCC_3V3"`). Sourced from the
   * schematic's derived nets at projection time. Used by canvas overlays
   * (net-trace labels) and tooltips.
   */
  netNames: Record<string, string>;
  /**
   * Footprint-pad → net id map, key `` `${placementId}|${padNumber}` ``.
   * Derived from the schematic↔PCB pad correlation already computed at
   * projection time. Lets a pure consumer (DRC) resolve which net a footprint
   * pad belongs to without re-running correlation. Optional / additive: absent
   * on pre-DRC saves and when there is no schematic.
   */
  padNets?: Record<string, string>;
  warnings: string[];
}

export interface DesignerJunction {
  xNm: number;
  yNm: number;
}

export interface DesignerDerivedNet {
  id: string;
  name: string;
  pinIds: string[];
  wireIds: string[];
  labelIds: string[];
  primitiveIds: string[];
}

export interface DesignerPin {
  id: string;
  originPinKey: string;
  number: string | null;
  name: string;
  electricalType: string;
  unit: number;
  localPositionNm: {
    x: number;
    y: number;
  };
  worldPositionNm: {
    x: number;
    y: number;
  };
}

export interface PartPropertiesJson {
  valueStructured?: {
    kind: "resistor" | "capacitor" | "generic";
    amount?: number;
    unit?: string;
    tolerance?: string;
  };
  pcb?: {
    staleReason?: string;
    staleAt?: string;
  };
  [key: string]: unknown;
}

export interface DesignerPlacedPart {
  id: string;
  componentId: string;
  reference: string;
  value: string;
  rotationDeg: number;
  mirrored: boolean;
  positionNm: {
    x: number;
    y: number;
  };
  symbol: LibrarySymbolPlacementSnapshot;
  footprint: LibraryFootprintPlacementSnapshot;
  pins: DesignerPin[];
  propertiesJson: PartPropertiesJson;
}

export interface DesignerWire {
  id: string;
  sourcePinId: string;
  targetPinId: string;
  pointsNm: Array<{
    x: number;
    y: number;
  }>;
  /** "colliding" when the auto-router had to commit its known-colliding
   *  fallback path (no clean route found within its caps). Absent otherwise. */
  routeStatus?: "colliding";
}

export interface DesignerLabel {
  id: string;
  text: string;
  positionNm: {
    x: number;
    y: number;
  };
}

interface DesignerPrimitiveBase {
  id: string;
  positionNm: { x: number; y: number };
  rotationDeg: number;
}

export interface DesignerGndPort extends DesignerPrimitiveBase {
  kind: "gnd";
}

export interface DesignerPwrPort extends DesignerPrimitiveBase {
  kind: "pwr";
  /** User-facing rail name (e.g. "VCC", "+3V3"). Drives the net's name. */
  railText: string;
}

export interface DesignerNetPortal extends DesignerPrimitiveBase {
  kind: "net_portal";
  /** Cross-region join key. Portals sharing this text merge into one net. */
  portalText: string;
}

/**
 * Topology anchor created by a wire T-tap (`create_wire_junction`): a
 * first-class wire terminus so the tapped wire can split into two wires and
 * the branch can end exactly at the tap point. It names no net, renders no
 * glyph (the derived junction dot is the visual), and is never a routing
 * obstacle. Its synthetic pin id is `primitive:<id>` like every primitive.
 */
export interface DesignerJunctionNode extends DesignerPrimitiveBase {
  kind: "junction";
}

export type DesignerPrimitive =
  | DesignerGndPort
  | DesignerPwrPort
  | DesignerNetPortal
  | DesignerJunctionNode;

export interface DesignerPlacePartCommand {
  type: "place_part";
  componentId: string;
  positionNm: {
    x: number;
    y: number;
  };
  rotationDeg?: number;
  mirrored?: boolean;
}

export interface DesignerCreateWireCommand {
  type: "create_wire";
  sourcePinId: string;
  targetPinId: string;
  pointsNm?: Array<{
    x: number;
    y: number;
  }>;
}

export interface DesignerCreateWireJunctionCommand {
  type: "create_wire_junction";
  sourcePinId: string;
  wireId: string;
  targetPointNm: {
    x: number;
    y: number;
  };
  pointsNm?: Array<{
    x: number;
    y: number;
  }>;
}

/**
 * Replace a schematic wire's polyline geometry (Flux-style segment drag). The
 * backend forces the endpoints back onto the source/target pins and validates
 * the path is orthogonal + non-overlapping; interior waypoints are kept verbatim.
 */
export interface DesignerUpdateWireGeometryCommand {
  type: "update_wire_geometry";
  wireId: string;
  pointsNm: Array<{
    x: number;
    y: number;
  }>;
}

export interface DesignerMovePartCommand {
  type: "move_part";
  partId: string;
  positionNm: {
    x: number;
    y: number;
  };
}

export interface DesignerRotatePartCommand {
  type: "rotate_part";
  partId: string;
  rotationDeg: 0 | 90 | 180 | 270;
}

export interface DesignerMirrorPartCommand {
  type: "mirror_part";
  partId: string;
  mirrored: boolean;
}

export interface DesignerUpdatePartPropertiesCommand {
  type: "update_part_properties";
  partId: string;
  reference?: string;
  value?: string;
  propertiesJson?: PartPropertiesJson;
}

export interface DesignerUpdatePartsPropertiesCommand {
  type: "update_parts_properties";
  partIds: string[];
  value?: string;
  propertiesJson?: PartPropertiesJson;
}

export interface DesignerDeleteEntityCommand {
  type: "delete_entity";
  entityId: string;
  entityKind: DesignerEntityKind;
}

export interface DesignerUpsertLabelCommand {
  type: "upsert_label";
  labelId?: string;
  text: string;
  positionNm: {
    x: number;
    y: number;
  };
}

export interface DesignerPlaceGndPortCommand {
  type: "place_gnd_port";
  positionNm: { x: number; y: number };
  rotationDeg?: 0 | 90 | 180 | 270;
}

export interface DesignerPlacePwrPortCommand {
  type: "place_pwr_port";
  positionNm: { x: number; y: number };
  rotationDeg?: 0 | 90 | 180 | 270;
  railText: string;
}

export interface DesignerPlaceNetPortalCommand {
  type: "place_net_portal";
  positionNm: { x: number; y: number };
  rotationDeg?: 0 | 90 | 180 | 270;
  portalText: string;
}

export interface DesignerMovePrimitiveCommand {
  type: "move_primitive";
  primitiveId: string;
  positionNm: { x: number; y: number };
}

export interface DesignerRotatePrimitiveCommand {
  type: "rotate_primitive";
  primitiveId: string;
  rotationDeg: 0 | 90 | 180 | 270;
}

export interface DesignerUpdatePrimitiveTextCommand {
  type: "update_primitive_text";
  primitiveId: string;
  /** Applies to railText (pwr) or portalText (net_portal). Ignored for gnd. */
  text: string;
}

/**
 * Re-layout the whole schematic deterministically from the netlist: group
 * net-connected parts into blocks with routing channels, then re-route every
 * wire around bodies / primitives / other wires. Non-destructive; one undo
 * step. Intended to be appended by AI placement/wiring proposals — manual
 * `move_part` never triggers it, so hand-placed layouts are not reshuffled.
 */
export interface DesignerAutoArrangeSchematicCommand {
  type: "auto_arrange_schematic";
  /** Optional top-left anchor for the layout. Defaults to the origin. */
  originNm?: { x: number; y: number };
  /** Reserved for a future selection-scoped arrange. v1 always re-lays all. */
  scope?: "all";
}

export interface DesignerPcbSetBoardSettingsCommand {
  type: "pcb_set_board_settings";
  widthMm: number;
  heightMm: number;
  /** Optional new board center. When omitted, the existing center is kept
   * (symmetric resize). Set by drag-resize to keep the opposite edge fixed. */
  centerMm?: PcbPointMm;
}

/**
 * General board-geometry command — sets the full outline shape (any kind) and,
 * optionally, the internal cutouts. Used by the shape picker, drag handles for
 * non-rect shapes, the polygon draw tool, import, and templates. The legacy
 * `pcb_set_board_settings` remains for the simple rect width/height path.
 */
export interface DesignerPcbSetBoardOutlineCommand {
  type: "pcb_set_board_outline";
  outline: PcbBoardOutline;
  /** When omitted, existing cutouts are kept; pass `[]` to clear them. */
  cutouts?: PcbBoardCutout[];
}

export interface DesignerPcbMovePlacementCommand {
  type: "pcb_move_placement";
  placementId: string;
  positionMm: PcbPointMm;
}

export interface DesignerPcbMovePlacementsCommand {
  type: "pcb_move_placements";
  updates: ReadonlyArray<{ placementId: string; positionMm: PcbPointMm }>;
}

export interface DesignerPcbRotatePlacementCommand {
  type: "pcb_rotate_placement";
  placementId: string;
  rotationDeg: 0 | 90 | 180 | 270;
}

export interface DesignerPcbFlipPlacementCommand {
  type: "pcb_flip_placement";
  placementId: string;
}

export interface DesignerPcbFlipPlacementsCommand {
  type: "pcb_flip_placements";
  placementIds: ReadonlyArray<string>;
}

export interface DesignerPcbSetActiveLayerCommand {
  type: "pcb_set_active_layer";
  layer: PcbLayerId;
}

export interface DesignerPcbSetVisibleLayersCommand {
  type: "pcb_set_visible_layers";
  visibleLayers: ReadonlyArray<PcbLayerId>;
}

/**
 * How a copper-creating command treats the reference DRC verdict on the copper
 * it commits (live-parity contract 07 §6). `refuse` (default): a violation in
 * the refuse set rejects the command with `PCB_COPPER_ILLEGAL`; `report`: the
 * verdict is computed and counted on the ok result, never refuses — the desktop
 * sends it while its "allow violations" override is on; `off`: no verdict is
 * computed — the cloud apply paths, which are judged by the post-apply report.
 */
export type PcbCommitLegality = "refuse" | "report" | "off";

export interface DesignerPcbAddTraceCommand {
  type: "pcb_add_trace";
  layer: PcbCopperLayerId;
  pointsNm: Array<{ x: number; y: number }>;
  widthMm: number;
  netId: string | null;
  netClassId: string;
  segmentMode: PcbTraceSegmentMode;
  legality?: PcbCommitLegality;
}

export interface DesignerPcbAddViaCommand {
  type: "pcb_add_via";
  centerMm: PcbPointMm;
  netId: string | null;
  netClassId: string;
  /** Optional override for via diameter; falls back to net-class default. */
  diameterMmOverride?: number;
  /** Optional override for via drill; falls back to net-class default. */
  drillMmOverride?: number;
  /**
   * Optional layer span + type. Absent = through F.Cu→B.Cu (everything the
   * interactive route tool emits). Non-through types are accepted data-only
   * behind the `pcb.advancedVias` dev flag and validated against the
   * board's layerCount/stackup order.
   */
  fromLayer?: PcbCopperLayerId;
  toLayer?: PcbCopperLayerId;
  viaType?: PcbViaType;
  legality?: PcbCommitLegality;
}

export interface DesignerPcbAddTraceViaCommand {
  type: "pcb_add_trace_via";
  trace: Omit<DesignerPcbAddTraceCommand, "type" | "legality">;
  via: Omit<DesignerPcbAddViaCommand, "type" | "legality">;
  legality?: PcbCommitLegality;
}

/**
 * Atomic multi-run route commit: every trace and via of one routing session
 * (multi-layer, width splits) lands as ONE command → one revision → one undo
 * entry. Validate-all-then-insert-all: the first invalid item rejects the
 * whole batch with nothing persisted. Like all pcb_* commands it is not
 * cloud-mirrored (schematic-only whitelist in cloud-sync.ts).
 */
export interface DesignerPcbCommitRouteCommand {
  type: "pcb_commit_route";
  traces: Array<Omit<DesignerPcbAddTraceCommand, "type" | "legality">>;
  vias: Array<Omit<DesignerPcbAddViaCommand, "type" | "legality">>;
  legality?: PcbCommitLegality;
}

/**
 * A placement op inside an Auto Layout candidate (the 3-op union the placer emits).
 * The `type` discriminator is KEPT — the ops arrive interleaved in one ordered list, and
 * a component may be moved AND rotated AND flipped, so order and kind both matter.
 */
export type DesignerPcbCandidatePlacementOperation =
  | DesignerPcbMovePlacementCommand
  | DesignerPcbRotatePlacementCommand
  | DesignerPcbFlipPlacementCommand;

/** A copper op inside an Auto Layout candidate (the 3-op union the router emits). */
export type DesignerPcbCandidateRouteOperation =
  | DesignerPcbAddTraceCommand
  | DesignerPcbAddViaCommand
  | DesignerPcbAddTraceViaCommand;

/**
 * Atomic application of ONE cloud Auto Layout candidate: every placement move/rotate/flip
 * AND every trace/via of that candidate land as one command → one revision → one undo
 * entry.
 *
 * This exists because the previous cloud apply path dispatched one envelope per operation:
 * a 40-op candidate produced 40 revisions and 40 undo entries, and a failure at op 30 left
 * the board half-laid-out with no way back but 29 undos. Grouping cannot fix that after the
 * fact — the earlier commands have already committed. Only a single command can.
 *
 * The handler PLANS everything first (validating against an in-memory transform map) and
 * writes nothing until every operation is known good, because executor branches return
 * error RESULTS rather than throwing: a mutation before a late error would be committed
 * with the error.
 *
 * `snapshotDigest` is the desktop's content digest of the board the candidate was computed
 * for (see backend/pcb/board-content-digest.ts) — NOT the revision, which view-state
 * commands bump. The apply route rejects a stale candidate before dispatching.
 */
export interface DesignerPcbApplyAutolayoutCandidateCommand {
  type: "pcb_apply_autolayout_candidate";
  jobId: string;
  candidateId: string;
  snapshotDigest: string;
  /** Applied in order — one component may be moved AND rotated AND flipped. */
  placementOperations: DesignerPcbCandidatePlacementOperation[];
  routeOperations: DesignerPcbCandidateRouteOperation[];
  /** Recorded for history/debugging. Bounded on purpose — never the whole cloud result. */
  provenance: {
    engineVersions?: Record<string, string>;
    objectiveVersion?: string;
    /** The service's own snapshot hash, kept as provenance only. */
    cloudSnapshotHash?: string;
  };
}

export interface DesignerPcbDeleteTraceCommand {
  type: "pcb_delete_trace";
  traceId: string;
}

export interface DesignerPcbDeleteViaCommand {
  type: "pcb_delete_via";
  viaId: string;
}

export interface DesignerPcbUpdateTraceGeometryCommand {
  type: "pcb_update_trace_geometry";
  traceId: string;
  pointsNm: Array<{ x: number; y: number }>;
  legality?: PcbCommitLegality;
}

/**
 * Delete traces made redundant by a copper pour: same-net, same-layer traces
 * whose copper is already fully covered by the net's filled pour island. Used by
 * the "Remove redundant ground traces" action after enabling a ground plane.
 * Result data: `{ removed: number }`.
 */
export interface DesignerPcbCleanupPourTracesCommand {
  type: "pcb_cleanup_pour_traces";
}

/**
 * Replace the per-design display state (viewSide / displayMode / preset / fill
 * toggles / opacities). Front-end debounces ~200ms so slider drags don't
 * spam undo history. The command persists straight into
 * `PcbBoardSettings.viewState`; partial updates merge into existing state.
 */
export interface DesignerPcbSetViewStateCommand {
  type: "pcb_set_view_state";
  patch: Partial<PcbViewState>;
}

/**
 * Edit the board's design rules, net classes, and/or finished thickness.
 * Non-undoable settings change; bumps the revision so a prior DRC run is
 * marked stale. Any omitted field is left unchanged.
 */
export interface DesignerPcbSetDesignRulesCommand {
  type: "pcb_set_design_rules";
  designRules?: PcbDesignRules;
  netClasses?: PcbNetClass[];
  boardThicknessMm?: number;
  /** Per-net → net-class overrides (netId → netClassId). See PcbBoardSettings. */
  perNetClassAssignments?: Record<string, string>;
  /** Length-match rules. See PcbBoardSettings.lengthMatchGroups. */
  lengthMatchGroups?: PcbLengthMatchGroup[];
  /** Per-code DRC severity policy. See PcbBoardSettings.drcSeverityOverrides. */
  drcSeverityOverrides?: Partial<Record<DrcRuleCode, DrcSeverity | "ignore">>;
  /** Scoped priority DRC rules. See PcbBoardSettings.drcRules. */
  drcRules?: PcbDrcRule[];
  /**
   * Explicit differential pairs (P11). Optional/additive; a net-name
   * convention (`_P`/`_N`, `+`/`-`) also auto-detects pairs when no explicit
   * entry covers a net.
   */
  diffPairs?: PcbDiffPair[];
}

/**
 * Delete a placement (component) from the PCB. Schematic-side reference is
 * unaffected — auto-sync will re-create the placement on next projection
 * unless the schematic part is also removed.
 */
export interface DesignerPcbDeletePlacementCommand {
  type: "pcb_delete_placement";
  placementId: string;
}

export interface DesignerPcbAddFreeHoleCommand {
  type: "pcb_add_free_hole";
  centerMm: PcbPointMm;
  drillMm: number;
}

export interface DesignerPcbUpdateFreeHoleCommand {
  type: "pcb_update_free_hole";
  freeHoleId: string;
  /** Optional patch — only provided fields are updated. */
  centerMm?: PcbPointMm;
  drillMm?: number;
  /** Pass `true` to lock, `false` to unlock, omit to leave unchanged. */
  locked?: boolean;
}

export interface DesignerPcbDeleteFreeHoleCommand {
  type: "pcb_delete_free_hole";
  freeHoleId: string;
}

export interface DesignerPcbAddFreePadCommand {
  type: "pcb_add_free_pad";
  centerMm: PcbPointMm;
  rotationDeg: number;
  padType: PcbFreePadType;
  shape: PcbFreePadShape;
  widthMm: number;
  heightMm: number;
  roundrectRatio?: number;
  drillMm?: number;
  layer: PcbCopperLayerId;
  netId?: string | null;
  solderMaskExpansionMm?: number;
  solderPasteExpansionMm?: number;
}

export interface DesignerPcbUpdateFreePadCommand {
  type: "pcb_update_free_pad";
  freePadId: string;
  centerMm?: PcbPointMm;
  rotationDeg?: number;
  padType?: PcbFreePadType;
  shape?: PcbFreePadShape;
  widthMm?: number;
  heightMm?: number;
  roundrectRatio?: number;
  drillMm?: number | null;
  layer?: PcbCopperLayerId;
  netId?: string | null;
  solderMaskExpansionMm?: number | null;
  solderPasteExpansionMm?: number | null;
  locked?: boolean;
}

export interface DesignerPcbDeleteFreePadCommand {
  type: "pcb_delete_free_pad";
  freePadId: string;
}

/**
 * Drop a manually placed via (smart via) — not associated with any routed
 * trace. Use cases: stitching vias to a copper pour, test-point vias, edge
 * fiducials. Diameter / drill default to the net-class spec when omitted.
 *
 * The persisted via carries `provenance: "manual"` so future tooling can
 * distinguish route-dropped vs hand-placed.
 */
export interface DesignerPcbAddManualViaCommand {
  type: "pcb_add_manual_via";
  centerMm: PcbPointMm;
  netId: string | null;
  netClassId: string;
  diameterMmOverride?: number;
  drillMmOverride?: number;
  legality?: PcbCommitLegality;
}

export interface DesignerPcbAddOverlayTextCommand {
  type: "pcb_add_overlay_text";
  layer: PcbOverlayLayer;
  positionMm: PcbPointMm;
  text: string;
  fontSizeMm: number;
  rotationDeg: number;
  mirror?: boolean;
  justify?: "left" | "center" | "right";
}

export interface DesignerPcbUpdateOverlayTextCommand {
  type: "pcb_update_overlay_text";
  overlayTextId: string;
  layer?: PcbOverlayLayer;
  positionMm?: PcbPointMm;
  text?: string;
  fontSizeMm?: number;
  rotationDeg?: number;
  mirror?: boolean;
  justify?: "left" | "center" | "right";
  locked?: boolean;
}

export interface DesignerPcbDeleteOverlayTextCommand {
  type: "pcb_delete_overlay_text";
  overlayTextId: string;
}

export interface DesignerPcbAddOverlayShapeCommand {
  type: "pcb_add_overlay_shape";
  layer: PcbOverlayLayer;
  kind: PcbOverlayShapeKind;
  pointsMm: PcbPointMm[];
  strokeWidthMm: number;
  fill?: "none" | "solid";
}

export interface DesignerPcbUpdateOverlayShapeCommand {
  type: "pcb_update_overlay_shape";
  overlayShapeId: string;
  layer?: PcbOverlayLayer;
  kind?: PcbOverlayShapeKind;
  pointsMm?: PcbPointMm[];
  strokeWidthMm?: number;
  fill?: "none" | "solid";
  locked?: boolean;
}

export interface DesignerPcbDeleteOverlayShapeCommand {
  type: "pcb_delete_overlay_shape";
  overlayShapeId: string;
}

/**
 * The net a zone pours, as the pair the record persists. Net ids are ephemeral
 * (`designer/AGENTS.md`): a named net is persisted as `{ netId: null, netName }`
 * and re-bound by name on every projection, an unnamed net as
 * `{ netId, netName: null }`, and "no net" as both null.
 */
export interface PcbZoneNetRef {
  netId: string | null;
  netName: string | null;
}

/**
 * Create a copper zone (zone/keepout contract §12.2). A board region takes the
 * derived id `board:<layer>` and rejects a second row on the same layer
 * (`PCB_ZONE_BOARD_EXISTS`); a polygon region takes a fresh uuid and must pass
 * `zoneRingValidity`.
 */
export interface DesignerPcbAddZoneCommand {
  type: "pcb_add_zone";
  layer: PcbCopperLayerId;
  net: PcbZoneNetRef;
  region: PcbZoneRegion;
  name?: string | null;
  enabled?: boolean;
  /** Integer ≥ 0; omitted = 0. Ignored for a board region (forced below every zone). */
  priority?: number;
  padConnection?: PcbZonePadConnection;
  clearanceMm?: number | null;
  minWidthMm?: number | null;
  thermal?: { gapMm: number; spokeWidthMm: number } | null;
  islandRemoval?: PcbZoneIslandRemoval;
}

/**
 * Patch a copper zone — only provided fields change. A locked zone rejects
 * every change except `locked: false`; a board zone rejects `layer` and
 * `region`; `net` replaces both net fields together.
 */
export interface DesignerPcbUpdateZoneCommand {
  type: "pcb_update_zone";
  zoneId: string;
  name?: string | null;
  enabled?: boolean;
  layer?: PcbCopperLayerId;
  net?: PcbZoneNetRef;
  region?: PcbZoneRegion;
  priority?: number;
  padConnection?: PcbZonePadConnection;
  clearanceMm?: number | null;
  minWidthMm?: number | null;
  thermal?: { gapMm: number; spokeWidthMm: number } | null;
  /** `null` clears the override (back to the board default). */
  islandRemoval?: PcbZoneIslandRemoval | null;
  /**
   * Pass `true` to lock, `false` to unlock, omit to leave unchanged. A locked
   * zone accepts `locked: false` ONLY on its own — never bundled with edits.
   */
  locked?: boolean;
}

export interface DesignerPcbDeleteZoneCommand {
  type: "pcb_delete_zone";
  zoneId: string;
}

/**
 * Create a keepout (KiCad "rule area"). Keepouts make rules, never copper:
 * `restrictions` is the full five-flag object, a missing flag being `false`.
 */
export interface DesignerPcbAddKeepoutCommand {
  type: "pcb_add_keepout";
  layers: PcbCopperLayerId[];
  pointsMm: PcbPointMm[];
  restrictions: PcbKeepoutRestrictions;
  name?: string | null;
  enabled?: boolean;
}

/** Patch a keepout — only provided fields change; `restrictions` replaces the whole object. */
export interface DesignerPcbUpdateKeepoutCommand {
  type: "pcb_update_keepout";
  keepoutId: string;
  name?: string | null;
  enabled?: boolean;
  layers?: PcbCopperLayerId[];
  pointsMm?: PcbPointMm[];
  restrictions?: PcbKeepoutRestrictions;
  /** Pass `true` to lock, `false` to unlock, omit to leave unchanged. */
  locked?: boolean;
}

export interface DesignerPcbDeleteKeepoutCommand {
  type: "pcb_delete_keepout";
  keepoutId: string;
}

export type DesignerCommand =
  | DesignerPlacePartCommand
  | DesignerCreateWireCommand
  | DesignerCreateWireJunctionCommand
  | DesignerUpdateWireGeometryCommand
  | DesignerMovePartCommand
  | DesignerRotatePartCommand
  | DesignerMirrorPartCommand
  | DesignerUpdatePartPropertiesCommand
  | DesignerUpdatePartsPropertiesCommand
  | DesignerDeleteEntityCommand
  | DesignerUpsertLabelCommand
  | DesignerPlaceGndPortCommand
  | DesignerPlacePwrPortCommand
  | DesignerPlaceNetPortalCommand
  | DesignerMovePrimitiveCommand
  | DesignerRotatePrimitiveCommand
  | DesignerUpdatePrimitiveTextCommand
  | DesignerAutoArrangeSchematicCommand
  | DesignerPcbSetBoardSettingsCommand
  | DesignerPcbSetBoardOutlineCommand
  | DesignerPcbMovePlacementCommand
  | DesignerPcbMovePlacementsCommand
  | DesignerPcbRotatePlacementCommand
  | DesignerPcbFlipPlacementCommand
  | DesignerPcbFlipPlacementsCommand
  | DesignerPcbSetActiveLayerCommand
  | DesignerPcbSetVisibleLayersCommand
  | DesignerPcbAddTraceCommand
  | DesignerPcbAddViaCommand
  | DesignerPcbAddTraceViaCommand
  | DesignerPcbCommitRouteCommand
  | DesignerPcbApplyAutolayoutCandidateCommand
  | DesignerPcbDeleteTraceCommand
  | DesignerPcbDeleteViaCommand
  | DesignerPcbUpdateTraceGeometryCommand
  | DesignerPcbCleanupPourTracesCommand
  | DesignerPcbSetViewStateCommand
  | DesignerPcbSetDesignRulesCommand
  | DesignerPcbDeletePlacementCommand
  | DesignerPcbAddFreeHoleCommand
  | DesignerPcbUpdateFreeHoleCommand
  | DesignerPcbDeleteFreeHoleCommand
  | DesignerPcbAddFreePadCommand
  | DesignerPcbUpdateFreePadCommand
  | DesignerPcbDeleteFreePadCommand
  | DesignerPcbAddManualViaCommand
  | DesignerPcbAddOverlayTextCommand
  | DesignerPcbUpdateOverlayTextCommand
  | DesignerPcbDeleteOverlayTextCommand
  | DesignerPcbAddOverlayShapeCommand
  | DesignerPcbUpdateOverlayShapeCommand
  | DesignerPcbDeleteOverlayShapeCommand
  | DesignerPcbAddZoneCommand
  | DesignerPcbUpdateZoneCommand
  | DesignerPcbDeleteZoneCommand
  | DesignerPcbAddKeepoutCommand
  | DesignerPcbUpdateKeepoutCommand
  | DesignerPcbDeleteKeepoutCommand;

export type DesignerCommandEnvelope = CommandEnvelope<DesignerCommand>;

export interface DesignerHistorySnapshot {
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
}

export interface DesignerHistoryActionOkResult {
  ok: true;
  revision: number;
  history: DesignerHistorySnapshot;
}

export type DesignerHistoryActionResult =
  | DesignerHistoryActionOkResult
  | {
      ok: false;
      code: "HISTORY_EMPTY";
      direction: "undo" | "redo";
      history: DesignerHistorySnapshot;
    };

export interface DesignerCommandOkResult {
  ok: true;
  revision: number;
  createdEntityId: string | null;
  idempotent?: boolean;
  /**
   * Reference-DRC verdict counts for the copper a gated command committed
   * (contract 07 §6): `refused` is 0 on an ok result under `legality: "refuse"`
   * and the would-be refusal count under `"report"`; `warnings` counts the rest
   * of the live code set. Counts only — the command log persists results
   * verbatim, and a replay returns the original revision's verdict.
   */
  legality?: { refused: number; warnings: number };
}

export type DesignerDispatchResult =
  | DesignerCommandOkResult
  | {
      ok: false;
      code: "PCB_COPPER_ILLEGAL";
      detail: string;
      /**
       * The refused violations (contract 07 §6 refuse set), ids as batch would
       * assign them — **capped at the first 50** in the report's canonical
       * `(code, id)` order, so one command-log row and one HTTP body stay
       * bounded however much copper a batch crosses. `refusedCount` is the
       * truth about how many there were; `violations.length` is not.
       */
      violations: DrcViolation[];
      /** Total refused violations. `violations` lists at most the first 50. */
      refusedCount: number;
    }
  | {
      ok: false;
      code: "REVISION_CONFLICT";
      conflict: {
        expected: number | null;
        actual: number;
      };
    }
  | {
      ok: false;
      code: "COMPONENT_NOT_FOUND";
      componentId: string;
    }
  | {
      ok: false;
      code: "COMPONENT_NOT_WIREABLE";
      componentId: string;
      reason: "NO_PINS";
    }
  | {
      ok: false;
      code: "PIN_NOT_FOUND";
      pinId: string;
    }
  | {
      ok: false;
      code: "ENTITY_NOT_FOUND";
      entityId: string;
      entityKind: DesignerEntityKind;
    }
  | {
      ok: false;
      code: "INVALID_WIRE_PATH";
      detail: string;
    }
  | {
      ok: false;
      code: "DUPLICATE_REFERENCE";
      reference: string;
    }
  | {
      ok: false;
      code: "INVALID_LABEL";
      detail: string;
    }
  | {
      ok: false;
      code: "INVALID_PRIMITIVE";
      detail: string;
    }
  | {
      ok: false;
      code: "PRIMITIVE_NOT_FOUND";
      primitiveId: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_BOARD_SETTINGS";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_PLACEMENT_NOT_FOUND";
      placementId: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_TRACE";
      detail: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_VIA";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_TRACE_NOT_FOUND";
      traceId: string;
    }
  | {
      ok: false;
      code: "PCB_VIA_NOT_FOUND";
      viaId: string;
    }
  | {
      ok: false;
      code: "PCB_NET_CLASS_NOT_FOUND";
      netClassId: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_FREE_HOLE";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_FREE_HOLE_NOT_FOUND";
      freeHoleId: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_FREE_PAD";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_FREE_PAD_NOT_FOUND";
      freePadId: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_OVERLAY";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_OVERLAY_NOT_FOUND";
      overlayId: string;
    }
  | {
      ok: false;
      code: "INVALID_PCB_ZONE";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_ZONE_NOT_FOUND";
      zoneId: string;
    }
  | {
      ok: false;
      code: "PCB_ZONE_BOARD_EXISTS";
      layer: PcbCopperLayerId;
    }
  | {
      ok: false;
      code: "INVALID_PCB_KEEPOUT";
      detail: string;
    }
  | {
      ok: false;
      code: "PCB_KEEPOUT_NOT_FOUND";
      keepoutId: string;
    }
  /**
   * A `pcb_set_design_rules` payload carried a structurally invalid DRC rule
   * (rule-semantics contract §2.1). The WHOLE command is refused — nothing is
   * persisted and nothing is dropped silently, because a dropped tightening
   * rule is fail-open and the author would never see it.
   */
  | {
      ok: false;
      code: "INVALID_DRC_RULE";
      ruleId: string;
      detail: string;
    };

/**
 * Pointer to a specific design entity an ERC violation hangs off of. The
 * canvas uses these to jump-to-violation and to draw inline indicators.
 */
export type ErcAnchor =
  | { kind: "pin"; pinId: string }
  | { kind: "net"; netId: string }
  | { kind: "part"; partId: string };

export type ErcSeverity = "error" | "warning" | "info";

export interface ErcViolation {
  code: string;
  severity: ErcSeverity;
  message: string;
  anchors: ErcAnchor[];
}

export interface ErcReport {
  designId: string;
  revision: number;
  violations: ErcViolation[];
  summary: { errors: number; warnings: number; infos: number };
}

/**
 * Pointer to a specific PCB entity a DRC violation hangs off of. The canvas
 * uses these to highlight offending items; each violation also carries a
 * `locationMm` + `layer` for marker placement (KiCad-style: the marker sits at
 * the midpoint of the offending pair).
 */
export type DrcAnchor =
  | { kind: "trace"; traceId: string }
  | { kind: "segment"; traceId: string; index: number }
  | { kind: "via"; viaId: string }
  | { kind: "pad"; placementId: string; padNumber: string }
  | { kind: "freePad"; freePadId: string }
  | { kind: "freeHole"; freeHoleId: string }
  | { kind: "placement"; placementId: string }
  | { kind: "net"; netId: string }
  | { kind: "zone"; zoneId: string }
  | { kind: "keepout"; keepoutId: string }
  | { kind: "diffPair"; pNetId: string; nNetId: string }
  /**
   * A stored `PcbLengthMatchGroup` row. Carried as the SECOND anchor of
   * `NET_LENGTH_OUT_OF_RANGE` so a net that belongs to several groups gets one
   * violation id per group instead of one id for all of them.
   */
  | { kind: "lengthGroup"; groupId: string }
  /** A stored `PcbDrcRule` row — DRC_RULE_INVALID / DRC_RULE_INEFFECTIVE. */
  | { kind: "rule"; ruleId: string }
  /**
   * A board-level overlay drawing (`PcbOverlayShape`) — the silkscreen artwork
   * source of a DFM violation (contract 11 §7). It is not copper, so it has no
   * existing anchor kind; without one every overlay hit would have to hang off
   * `boardEdge` and collapse into a single id.
   */
  | { kind: "overlayShape"; shapeId: string }
  /** A board-level overlay text (`PcbOverlayText`); same reason. */
  | { kind: "overlayText"; textId: string }
  | { kind: "boardEdge" };

export type DrcSeverity = "error" | "warning" | "info";

/**
 * Rule-class groups violations in the panel and drives per-class ignore
 * toggles (`PcbViewState.drcIgnoredRuleClasses`).
 */
export type DrcRuleClass =
  | "clearance"
  | "constraint"
  | "connectivity"
  | "manufacturability"
  | "structural"
  | "dfm"
  | "electrical"
  | "signal-integrity";

/**
 * Every `DrcRuleClass`, as a runtime list. Derived from a compiler-total record
 * so adding a class to the union above fails to compile until this list is
 * updated — a persisted class ignore is silently dropped by any consumer whose
 * hand-written list lost a member.
 */
const DRC_RULE_CLASS_MEMBERS: Record<DrcRuleClass, true> = {
  clearance: true,
  constraint: true,
  connectivity: true,
  manufacturability: true,
  structural: true,
  dfm: true,
  electrical: true,
  "signal-integrity": true,
};

export const DRC_RULE_CLASSES: readonly DrcRuleClass[] = Object.keys(
  DRC_RULE_CLASS_MEMBERS,
) as DrcRuleClass[];

/**
 * Stable, machine-readable violation codes. Every code below has an emit site
 * under `src/shared/drc/checks/` (S8 relocation) and a label in
 * `drc-labels.ts` (verified 2026-09-07); the P1/P2 group comments are
 * historical milestone labels, not implementation status.
 */
export type DrcRuleCode =
  // --- P1 ---
  | "TRACE_WIDTH_MIN"
  | "VIA_DIAMETER_MIN"
  | "VIA_DRILL_MIN"
  | "DRILL_SIZE_MIN"
  | "ANNULAR_RING_MIN"
  | "TRACE_TO_TRACE_CLEARANCE"
  | "TRACE_TO_PAD_CLEARANCE"
  | "TRACE_TO_VIA_CLEARANCE"
  | "UNCONNECTED_NET"
  | "NET_SHORT_CIRCUIT"
  | "TRACE_LAYER_MISMATCH"
  | "PAD_LAYER_MISMATCH"
  | "NETCLASS_TRACE_WIDTH"
  | "NETCLASS_VIA_DIAMETER"
  | "NETCLASS_VIA_DRILL"
  | "HOLE_TO_BOARD_EDGE"
  // A drill (or slot) that is not inside the board region at all — the error
  // half of the former dual-severity HOLE_TO_BOARD_EDGE (contract §7).
  | "HOLE_OFF_BOARD"
  | "TRACK_DANGLING"
  | "VIA_DANGLING"
  | "CREEPAGE_DISTANCE"
  | "TRACE_CURRENT_WIDTH"
  | "DIFF_PAIR_GAP"
  | "DIFF_PAIR_SKEW"
  | "DIFF_PAIR_UNCOUPLED_LENGTH"
  | "PLACED_PART_MISSING_FOOTPRINT"
  // A schematic net bound to a NON-PLATED pad, whose copper rings are
  // mechanical and never conduct between faces (contract 10 §2.4).
  | "NPTH_PAD_NET"
  | "FAB_TRACE_WIDTH"
  | "FAB_CLEARANCE"
  | "FAB_ANNULAR_RING"
  | "FAB_DRILL"
  | "FAB_HOLE_TO_HOLE"
  | "FAB_PAD"
  // --- Length matching (pcb.lengthTuning) ---
  | "NET_LENGTH_OUT_OF_RANGE"
  // --- P2 (historical group label; all implemented) ---
  | "VIA_TO_VIA_CLEARANCE"
  | "PAD_TO_PAD_CLEARANCE"
  | "PAD_TO_VIA_CLEARANCE"
  | "COPPER_TO_BOARD_EDGE"
  | "HOLE_TO_HOLE"
  // Copper (trace / pad / via) too close to a NON-PLATED drill wall —
  // the pair kind the pour has always cleared and DRC never judged
  // (batch-DRC contract 06 §4).
  | "COPPER_TO_HOLE"
  | "VIA_LAYER_SPAN"
  | "VIA_ASPECT_RATIO"
  // A via OpenPCB cannot export: the Excellon writer emits ONE plated drill
  // file, so every plated hit is a through drill (contract 10 §5.1).
  | "VIA_TYPE_UNSUPPORTED"
  | "BOARD_OUTLINE_INVALID"
  | "OUTLINE_INTERNAL_RADIUS"
  | "OUTLINE_SLOT_WIDTH"
  | "COPPER_OFF_BOARD"
  | "ISOLATED_COPPER_ISLAND"
  // --- Zones and keepouts (S4 legality integration, contract 03 §13.1) ---
  | "KEEPOUT_VIOLATION"
  | "ZONE_OVERLAP"
  | "ZONE_INVALID"
  | "ZONE_EMPTY_FILL"
  // The fill kernel bailed on a zone (copper-pour contract §8/§10): the zone
  // ships NO copper for a reason that is not its geometry.
  | "ZONE_FILL_FAILED"
  // --- Rule validity (rule-semantics contract §2.1, §10) ---
  // A persisted rule row that cannot be applied at all; excluded from
  // resolution. Non-overridable: a dropped tightening rule is fail-open.
  | "DRC_RULE_INVALID"
  // A rule that resolves, but not with the number its author wrote (unknown
  // net / class / layer reference, or a value clamped by the floor / minimum).
  | "DRC_RULE_INEFFECTIVE"
  // --- Courtyards (S12, DFM contract 11 §2) ---
  // Two placements' courtyard regions overlap on one face by more than a
  // shared edge — the parts cannot both be assembled where they stand.
  | "COURTYARD_OVERLAP"
  // The footprint's courtyard graphics would not chain into closed loops (an
  // open chain, a branch, an unmodelled graphic), or the overlap kernel refused
  // a pair. The region falls back to the superset hull, which over-reports.
  | "COURTYARD_INVALID"
  // --- Silkscreen (S12, DFM contract 11 §3) ---
  // Legend ink over, or too close to, a solder-mask opening: it will be
  // printed onto the pad and lift with the solder.
  | "SILK_TO_MASK_CLEARANCE"
  // Legend ink too close to (or off) the routed board edge.
  | "SILK_TO_BOARD_EDGE"
  // The fabricator's own silk-to-pad row.
  | "FAB_SILK_CLEARANCE"
  // A legend stroke narrower than the fabricator prints.
  | "FAB_SILK_WIDTH"
  // A legend text smaller than the fabricator prints legibly.
  | "FAB_SILK_TEXT_HEIGHT"
  // --- Solder mask (S12, DFM contract 11 §4) ---
  // The mask dam between two different-net openings is narrower than the
  // design rule — the bridge hazard the dam exists to prevent.
  | "MASK_BRIDGE"
  // The same dam, against the fabricator's row.
  | "FAB_MASK_BRIDGE"
  // A mask web between same-net or copper-less openings: it can lift, but it
  // cannot bridge two nets.
  | "MASK_SLIVER"
  // A mask opening exposing copper that is not its own.
  | "FAB_MASK_TO_COPPER"
  // --- Copper shape (S12, DFM contract 11 §5) ---
  // One net's own copper narrows below the sliver width somewhere in the
  // middle of it — a web the etcher may open.
  | "COPPER_CONNECTION_WIDTH"
  // Copper that is thinner than the sliver width EVERYWHERE: an annulus, a
  // hairline appendage, an acid-trap spike.
  | "COPPER_SLIVER"
  // The explicit "we did not answer": a kernel refusal, a unit over the vertex
  // budget, or a truncated neck list. Never a silent pass.
  | "COPPER_SHAPE_UNCHECKED"
  // A copper-free wedge at a trace junction (an acid trap).
  | "TRACE_ACUTE_ANGLE"
  // Two collinear, overlapping segments of DIFFERENT traces on one layer.
  | "TRACE_OVERLAP"
  // --- Board material (S12b, exact-geometry contract 12 §5) ---
  // Board MATERIAL narrower than `designRules.outline.minWebMm`: a neck in the
  // board itself, a band between a cutout and the edge, an annulus between two
  // cutouts, or a whole board narrower than the rule.
  | "OUTLINE_MIN_WEB"
  // The explicit "we did not answer" of the exact-geometry layer (§4, §5): the
  // web certificate was unavailable (a capped flattening, a kernel refusal, a
  // budget), or an exact board-edge / outline recomputation ran out of its
  // per-run budget and the chord verdict stands. Never a silent pass.
  | "OUTLINE_WEB_UNCHECKED";

export interface DrcViolation {
  /**
   * Stable id = hash(code + sorted anchor keys + layer + a 0.1 mm location bucket for
   * hot-spot codes) — v2, see `violation-id.ts`. Order-independent and stable
   * across re-runs so a persisted waiver keeps matching the same violation.
   */
  id: string;
  code: DrcRuleCode;
  ruleClass: DrcRuleClass;
  severity: DrcSeverity;
  message: string;
  anchors: DrcAnchor[];
  /** Marker placement (mm, board coords). Absent for non-spatial violations. */
  locationMm?: PcbPointMm;
  /** Copper layer the violation lives on, when layer-specific. */
  layer?: PcbCopperLayerId;
  /** Measured value that triggered the rule (mm). */
  measuredMm?: number;
  /** Required threshold from the rule (mm). */
  requiredMm?: number;
  /**
   * True when the user has waived this violation id. Waived violations are
   * still listed (panel shows them struck-through) but excluded from
   * `summary` counts.
   */
  waived?: boolean;
}

export interface DrcReport {
  designId: string;
  revision: number;
  violations: DrcViolation[];
  /** Active (non-waived) counts. Drives the status bar + panel badges. */
  summary: { errors: number; warnings: number; infos: number };
  /** Per-code counts of all emitted violations (incl. waived) for grouping. */
  countsByCode: Partial<Record<DrcRuleCode, number>>;
}

/**
 * A batch DRC run's lifecycle record (execution contract 09 §1). In-memory on
 * the designer backend; the report itself is served by `GET /designs/:id/drc`
 * once the run is `completed`. `progress` carries counts only — never a
 * partial violation list (09 §4).
 */
export type DrcRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export type DrcRunCancelReason =
  | "user"
  | "superseded"
  | "design-deleted"
  | "shutdown";

export interface DrcRunProgress {
  /** A `DrcStage` name, `"pour"` while zones fill, or `"queued"`. */
  stage: string;
  index: number;
  total: number;
  /** 0..1 over the whole run; work-based, never time-based. */
  fraction: number;
  violationsSoFar: number;
}

export interface DrcRunSnapshot {
  runId: string;
  designId: string;
  /** The projection revision the run computes over. */
  revision: number;
  status: DrcRunStatus;
  progress: DrcRunProgress;
  startedAt: string;
  finishedAt?: string;
  /** Present once `completed`. */
  summary?: DrcReport["summary"];
  /** Present once `failed`. */
  error?: string;
  /** Present once `cancelled`. */
  cancelReason?: DrcRunCancelReason;
}

export interface DesignerSearchLibraryParams {
  query?: string;
  tags?: string[];
  limit?: number;
}

export interface DesignerDispatchContext {
  designId: string;
  envelope: DesignerCommandEnvelope;
}

export interface DesignerLibraryLookup {
  component: LibraryComponent;
  placement: LibraryComponentPlacementDetail;
}

// ─────────────────────── KiCad project import ───────────────────────

/**
 * Severity-tagged warning shared by the inspect + commit responses. A code is a
 * stable, machine-readable identifier (`zones_dropped`, `hierarchical_sheets_flattened`,
 * `wire_diagonal`, `footprint_missing_lib_id`, …). The message is user-facing
 * English suitable for the import wizard.
 */
export interface KicadProjectImportWarning {
  code: string;
  message: string;
  severity: "info" | "warning";
}

export interface KicadProjectInspectReport {
  /** Suggested OpenPCB design name (defaults to `.kicad_pro` basename). */
  projectName: string;
  /** Copper layer count derived from the .kicad_pcb (layers ...) block. */
  copperLayerCount: number;
  /** Schematic sheet count. v1 always reports 1 because hierarchical sheets are flattened. */
  schematicSheetCount: number;
  /** Number of net entries declared in the .kicad_pcb. */
  netCount: number;
  /** Bounding box of Edge.Cuts graphics in mm; `null` when no outline graphics found. */
  boardOutlineMm: {
    minXMm: number;
    minYMm: number;
    maxXMm: number;
    maxYMm: number;
  } | null;
  /** Per-component reuse/ingest status, keyed by `lib_id`. */
  components: KicadProjectImportComponentRow[];
  /** Counts of schematic and PCB entities found. */
  counts: KicadProjectImportCounts;
  /** Net classes declared in the project, with unknown rules preserved. */
  netClasses: KicadProjectImportNetClass[];
  /**
   * `board.design_settings.rules` — KiCad's project-wide minimums, mapped 1:1
   * onto OpenPCB's (rule-semantics contract §12.3). Every field is optional:
   * an absent KiCad minimum is never invented.
   */
  designRules?: KicadProjectImportDesignRules;
  /**
   * Net NAME → net-class NAME, folded from `classes[].nets` (KiCad 6),
   * `netclass_patterns` (7/8, exact names only) and `netclass_assignments`
   * (9). Resolved to `perNetClassAssignments` (netId → classId) at commit,
   * once the nets exist.
   */
  netClassAssignments?: Record<string, string>;
  warnings: KicadProjectImportWarning[];
}

/** KiCad's `board.design_settings.rules`, in mm (rule-semantics §12.3). */
export interface KicadProjectImportDesignRules {
  minClearanceMm?: number;
  minTrackWidthMm?: number;
  minViaDiameterMm?: number;
  minThroughHoleMm?: number;
  minViaAnnularMm?: number;
  minHoleToHoleMm?: number;
  minCopperEdgeClearanceMm?: number;
  /**
   * `min_hole_clearance` — copper edge to a (non-plated) drill wall; commits
   * to `clearance.copperToHoleMm` (batch-DRC contract 06 §4).
   */
  minHoleClearanceMm?: number;
}

export interface KicadProjectImportComponentRow {
  libId: string;
  /** All refdes instances of this lib_id in the project. */
  references: string[];
  /** Where this component will come from on commit. */
  status: "reuse" | "ingest" | "missing";
  /** When `status === "reuse"`, the OpenPCB componentId we matched to. */
  componentId: string | null;
  /** Reason free-form, populated when status === "missing". */
  reason?: string;
}

export interface KicadProjectImportCounts {
  schematicSymbols: number;
  schematicWires: number;
  schematicLabels: number;
  schematicGlobalLabels: number;
  schematicPowerSymbols: number;
  schematicJunctions: number;
  schematicNoConnects: number;
  hierarchicalSheets: number;
  pcbFootprints: number;
  pcbSegments: number;
  pcbVias: number;
  pcbZones: number;
  pcbKeepouts: number;
}

export interface KicadProjectImportNetClass {
  name: string;
  clearanceMm: number | null;
  trackWidthMm: number | null;
  viaDiameterMm: number | null;
  viaDrillMm: number | null;
  /** Unknown / opaque rules (diff pair gap, microvia, uvia, …) preserved verbatim. */
  unknownRules: Record<string, unknown>;
}

export interface KicadProjectCommitRequest {
  /** Suggested design name; defaults to inspect report's projectName. */
  designName?: string;
  /** ZIP archive of the KiCad project bundle (bytes). Server resolves files internally. */
  archiveBytes: Uint8Array;
  archiveFileName: string;
}

export interface KicadProjectCommitResult {
  designId: string;
  designName: string;
  /** Summary of what was actually inserted. */
  applied: {
    boardOutline: boolean;
    copperLayerCount: number;
    netClassesIngested: number;
    /**
     * v1 deliberately does NOT yet ingest schematic parts / wires / PCB
     * placements (those require library-component ingestion of project-embedded
     * symbols and footprints). The list of deferred entity kinds is surfaced
     * here so the wizard can display "imported as empty design + N warnings"
     * cleanly.
     */
    deferred: KicadProjectDeferredEntityKind[];
  };
  warnings: KicadProjectImportWarning[];
}

export type KicadProjectDeferredEntityKind =
  | "schematic_symbols"
  | "schematic_wires"
  | "schematic_labels"
  | "schematic_primitives"
  | "pcb_placements"
  | "pcb_segments"
  | "pcb_vias"
  | "library_ingestion";

// =========================================================================
// Manufacturing export (Gerber X2 + Excellon + BOM + pick-and-place)
//
// First fab-able beta: ship a 2-layer board to JLCPCB/PCBWay using only
// OpenPCB output. RS-274X X2 only (no legacy mode).
// =========================================================================

export type GerberArtifactKind =
  | "gerber.top_copper"
  | "gerber.bottom_copper"
  | "gerber.inner1_copper"
  | "gerber.inner2_copper"
  | "gerber.top_mask"
  | "gerber.bottom_mask"
  | "gerber.top_paste"
  | "gerber.bottom_paste"
  | "gerber.top_silk"
  | "gerber.bottom_silk"
  | "gerber.edge_cuts"
  | "gerber.job"
  | "excellon.drills_pth"
  | "excellon.drills_npth"
  | "csv.bom"
  | "csv.pnp";

export interface GerberArtifact {
  kind: GerberArtifactKind;
  fileName: string;
  /** UTF-8 textual contents. All v0 artifacts are text. */
  text: string;
}

export interface GerberExportOptions {
  includeBom?: boolean;
  includePickAndPlace?: boolean;
  includeInnerLayers?: boolean;
}

export interface GerberExportRequest {
  designId: string;
  options?: GerberExportOptions;
}

export interface GerberExportResult {
  designId: string;
  bundleName: string;
  artifacts: GerberArtifact[];
  warnings: string[];
}

export interface BomRow {
  refdesList: string;
  value: string;
  footprint: string;
  partNumber: string | null;
  quantity: number;
  manufacturer?: string | null;
  manufacturerPartNumber?: string | null;
}

export interface BomOverride {
  designId: string;
  refdes: string;
  manufacturer: string | null;
  manufacturerPartNumber: string | null;
  lcscPartNumber: string | null;
  supplier: string | null;
  unitPrice: number | null;
  currency: string | null;
  dnp: boolean;
  assemblySide: "top" | "bottom" | null;
  notes: string | null;
  updatedAt: string;
}

export interface BomLineRef {
  refdes: string;
  partId: string | null;
  placementId: string | null;
  pcbLayer: "top" | "bottom" | null;
  dnp: boolean;
}

export interface BomLine {
  id: string;
  refs: BomLineRef[];
  refdesList: string;
  value: string;
  footprint: string;
  description: string | null;
  quantity: number;
  manufacturer: string | null;
  manufacturerPartNumber: string | null;
  lcscPartNumber: string | null;
  supplier: string | null;
  unitPrice: number | null;
  currency: string | null;
  dnp: boolean;
  assemblySide: "top" | "bottom" | "mixed" | null;
  notes: string | null;
  warnings: string[];
}

export interface BomSummary {
  lineCount: number;
  partCount: number;
  activePartCount: number;
  dnpPartCount: number;
  missingRequiredCount: number;
  estimatedCost: number | null;
  currency: string | null;
}

export interface BomProjection {
  designId: string;
  revision: number;
  rows: BomLine[];
  summary: BomSummary;
  warnings: string[];
}

export interface BomOverridePatch {
  manufacturer?: string | null;
  manufacturerPartNumber?: string | null;
  lcscPartNumber?: string | null;
  supplier?: string | null;
  unitPrice?: number | null;
  currency?: string | null;
  dnp?: boolean;
  assemblySide?: "top" | "bottom" | null;
  notes?: string | null;
}

export interface CentroidRow {
  refdes: string;
  value: string;
  footprint: string;
  xMm: number;
  yMm: number;
  rotationDeg: number;
  layer: "top" | "bottom";
}
