import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { copperLayerColor } from "./pcb-layer-colors";
import { createPortal } from "react-dom";
import type {
  DesignerCommand,
  DesignerCommentAnchor,
  DesignerCommentThread,
  DesignerCommentThreadStatus,
  DesignerCommentTodoStatus,
  DesignerDispatchResult,
  DrcViolation,
  PcbBoardContour,
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbKeepout,
  PcbLayerId,
  PcbOverlayText,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
  PcbZone,
  PcbZoneNetRef,
  PcbZonePadConnection,
  PlacePayloadSummary,
  PlacementResultEnvelope,
} from "../../../../sdks";
import { nmToSceneMm } from "../../../../shared/frontend/canvas/coords";
import type { OpenpcbCapturePcbApi } from "../capture-bridge";
import { EdaCanvas } from "../../../../shared/frontend/canvas/interaction/EdaCanvas";
import type {
  InteractionCoordinateTransform,
  InteractionEvent,
  InteractionHandler,
} from "../../../../shared/frontend/canvas/interaction/types";
import { sceneMmToNm } from "../../../../shared/frontend/canvas/coords";
import {
  hitAll,
  hitDrcMarker,
  hitFreeHole,
  hitFreePad,
  hitOverlayText,
  hitPad,
  hitPlacement,
  hitTrace,
  hitVia,
  type PcbHitCandidate,
  type TraceHit,
} from "./pcb-hit";

/** Click/hover grab radius (px) for DRC markers; → mm via the live zoom. */
const DRC_HIT_PX = 18;
import {
  applyHandleDrag,
  countOutsideBoard,
  handleCursor,
  handlePointMm,
  hitBoardHandle,
  roundDimMm,
  type BoardHandle,
} from "./pcb-board-resize";
import {
  PcbDisambiguationPopup,
  formatCandidateLabel,
} from "./PcbDisambiguationPopup";
import {
  placementContainedInRect,
  placementIntersectsRect,
  traceContainedInRect,
  traceIntersectsRect,
  viaContainedInRect,
  viaIntersectsRect,
} from "./pcb-rect-hit";
import {
  clonePcbSelection,
  emptyPcbSelection,
  toggleTrace,
  toggleVia,
  togglePlacement,
  toggleFreeHole,
  toggleFreePad,
  toggleOverlayText,
  pcbSelectionCount,
  type PcbSelection,
} from "./pcb-selection";
import {
  CanvasCommentLayer,
  type CommentDraft,
} from "../components/comments/CanvasCommentLayer";
import { useCanvasProjection } from "../components/comments/useCanvasProjection";
import type { PcbInspectorSelection } from "./PcbSelectionInspector";
import { PcbPropertiesPanel } from "./PcbPropertiesPanel";
import { PcbLayerTabStrip } from "./PcbLayerTabStrip";
import { CanvasZoomCluster } from "@shared/frontend/ui/canvas-zoom-cluster";
import { useMarqueeSelection } from "../../../../shared/frontend/canvas/selection";
import {
  PcbScene,
  type AutoroutePreviewTrace,
  type PcbCameraControls,
} from "./PcbScene";
import type { ViewportState } from "../types";
import { PcbRouteParamRow, PcbTopToolbar } from "./PcbTopToolbar";
import { PcbExportDialog } from "./PcbExportDialog";
import { PcbAutorouteDialog } from "./PcbAutorouteDialog";
import { PcbAutoplaceDialog } from "./PcbAutoplaceDialog";
import { AutoLayoutDialog } from "./autolayout/AutoLayoutDialog";
import { PcbPlacePreviewBar } from "./PcbPlacePreviewBar";
import type { AutoLayoutCandidatePreview } from "./autolayout/preview/build-candidate-preview";
import {
  seedConfig,
  toRouteRequest,
  writeGlobalDefaultConfig,
} from "./autolayout/config";
import {
  applyTransformsToPlacements,
  buildFromMarkers,
  buildPositionOverride,
  diffToOperations,
  usePcbPlacePreview,
} from "./usePcbPlacePreview";
import { createDesignerApi, type CloudHeadersProvider } from "../api";
import { PcbBoardPanel } from "./PcbBoardPanel";
import { PcbComponentsPanel } from "./PcbComponentsPanel";
import { PcbLayersPanel } from "./PcbLayersPanel";
import { usePcbDesignRulesDialog } from "./use-pcb-design-rules-dialog";
import { pickRouteStartLayer } from "./route-start-layer";
import { PcbSelectionFilter } from "./PcbSelectionFilter";
import { findSnapTarget, type SnapTarget } from "./snap";
import {
  buildAlignmentIndex,
  computeAlignmentGuides,
  translateBBox,
  unionBBox,
  type AlignmentIndex,
} from "./guides/alignment-engine";
import {
  SNAP_THRESHOLD_PX,
  type AlignmentGuide,
  type RouteGuide,
  type SpacingGuide,
} from "./guides/guide-types";
import { computeRouteGuides } from "./guides/routing-engine";
import type { BoundsMm } from "../../../../shared/rendering/types";
import {
  blockingViolations,
  pendingCopperFromSession,
  runLiveDrc,
} from "./drc/live-drc";
import { useRafThrottledValue } from "./use-raf-throttled-value";
import {
  initialRouteToolState,
  routeToolReducer,
  sessionAnchors,
  type PointNm,
  type RouteSession,
  type RouteWidthSource,
} from "./tools/route-tool-state";
import { buildPreviewPath } from "./tools/route-preview-geometry";
import { resolveRouteClickAction } from "./tools/route-interactions";
import {
  initialMeasureToolState,
  measureBetween,
  measureToolReducer,
  type MeasureAnchor,
} from "./tools/measure-tool-state";
import {
  canCloseSketch,
  initialSketchToolState,
  MIN_SKETCH_VERTICES,
  sketchToolReducer,
  type SketchSession,
  type SketchTarget,
} from "./tools/sketch-tool-state";
import { useAreaTools } from "./tools/use-area-tools";
import { useAreaInteractions } from "./tools/use-area-interactions";
import { AreaToolOptionsBar } from "./AreaToolOptionsBar";
import {
  boardZoneToggleAction,
  boardZoneForLayer,
} from "./tools/board-zone-controls";
import { defaultZoneToolOptions } from "./tools/area-tool-options";
import { KEEPOUT_COLOR } from "./layers/KeepoutLayer";
import { verticesToContour } from "./sketch-geometry";
import {
  appendToEntry,
  backspaceEntry,
  emptySketchEntry,
  entryHasValue,
  parsedEntry,
  toggleEntryField,
  type SketchEntry,
} from "./sketch-dimensions";
import {
  resolveSketchTarget,
  type InferResult,
} from "./sketch-inference";
import { SketchDimEntry } from "./SketchDimEntry";
import {
  deleteVertex,
  hitEdge as hitOutlineEdge,
  hitVertex as hitOutlineVertex,
  insertVertexAtEdge,
  isEditableOutline,
  moveVertex,
  outlineVertices,
  type EditableOutline,
} from "./pcb-outline-edit";
import { CornerOpModal } from "./CornerOpModal";
import { EdgeDimModal, type DimEditTarget } from "./EdgeDimModal";
import { DxfImportModal } from "./import/DxfImportModal";
import { findMeasureSnapTarget } from "./measure-snap";
import {
  usePcbWorkspace,
  type DispatchRejectedError,
} from "./usePcbWorkspace";
import { isDrcRunActive, useDrcStore } from "./drc/drc-store";
import { DRC_SEVERITY } from "./drc/drc-colors";
import {
  buildDrcMarkers,
  CODE_LABEL,
  resolveAnchorLabel,
} from "./drc/drc-labels";
import { usePcbViewStore } from "./pcb-view-store";
import {
  DEFAULT_PCB_ZOOM,
  PCB_GRID_MM,
} from "../../../../shared/frontend/canvas/defaults";
import {
  PCB_LAYER_COLORS,
  PCB_LAYER_PRESETS,
  PCB_TRACE_COLORS,
} from "../../../../shared/frontend/canvas/layers";
import { RouteHudRows, RouteHudStatus } from "./RouteHud";
import { buildRouteHudModel, routeLengthMm } from "./tools/route-hud-model";
import { buildPcbSpatialIndex, pointQueryBox } from "./spatial-index";
import { nextRouteLayer } from "./tools/route-layer";
import { nearestRatsnestPad } from "./tools/route-target";
import {
  distanceAlongPolylineNm,
  initialTuneToolState,
  slicePolylineByArcLengthNm,
  tuneToolReducer,
} from "./tools/tune-tool-state";
import { buildTuneHudModel } from "./tools/tune-hud-model";
import { TuneHud } from "./TuneHud";
import {
  bundleAnchorNm,
  bundleToolReducer,
  initialBundleToolState,
  type BundlePad,
} from "./tools/bundle-tool-state";
import { diffPairPartnerName } from "./tools/diff-pair";
import { BundleHud, type BundleHudModel } from "./BundleHud";
import {
  assignLaneOffsets,
  buildBundleLanes,
  dedupeConsecutive,
  fanOutDir,
  tooCloseNm,
} from "../../../../shared/pcb-routing/bundle-geometry";
import {
  padWorldPositionMm,
  placementPads,
} from "../../../../shared/pcb-geometry/pad-geometry";
import { generateMeander } from "../../../../shared/pcb-routing/meander";
import { routeAutoFinish } from "../../../../shared/pcb-routing/auto-finish";
import { walkaroundHead } from "../../../../shared/pcb-routing/walkaround";
import { buildRouteObstacles } from "../../../../shared/pcb-routing/route-obstacles";
import { defaultNetClassId } from "../../../../shared/pcb-areas/net-class-resolver";
import { useFeatureFlag } from "@/feature-flags";
import { FlipHorizontal2 } from "lucide-react";
import { openContextMenu } from "../../../../shared/frontend/context-menu";
import type { ContextMenuGroup } from "../../../../shared/frontend/context-menu";
import {
  areViasVisible,
  isCopperLayerVisible,
  isPlacementVisible,
  isTraceVisible,
  visibleLayerSet,
  visibleOverlayEntities,
} from "./pcb-layer-visibility";
import {
  createPcbVisualState,
  shouldRenderCopperLayer,
} from "./pcb-visual-state";

const NM_PER_MM = 1_000_000;

function snapMm(value: number, gridEnabled: boolean): number {
  if (!gridEnabled) return value;
  return Math.round(value / PCB_GRID_MM) * PCB_GRID_MM;
}

function snapPointMm(p: PcbPointMm, gridEnabled: boolean): PcbPointMm {
  return { x: snapMm(p.x, gridEnabled), y: snapMm(p.y, gridEnabled) };
}

function pointMmToNm(p: PcbPointMm): PointNm {
  return { x: Math.round(p.x * NM_PER_MM), y: Math.round(p.y * NM_PER_MM) };
}

function pointsEqualNm(a: PointNm, b: PointNm): boolean {
  return a.x === b.x && a.y === b.y;
}

function appendDistinctPoint(points: PointNm[], point: PointNm): void {
  const last = points[points.length - 1];
  if (!last || !pointsEqualNm(last, point)) {
    points.push(point);
  }
}

function keepTracePrefixForReroute(
  tracePoints: readonly PointNm[],
  segmentIndex: number,
  splitPoint: PointNm,
): PointNm[] {
  const keep: PointNm[] = [];
  const safeSegmentIndex = Math.max(
    0,
    Math.min(segmentIndex, tracePoints.length - 2),
  );
  for (let index = 0; index <= safeSegmentIndex; index += 1) {
    appendDistinctPoint(keep, tracePoints[index]!);
  }
  appendDistinctPoint(keep, splitPoint);
  return keep;
}

type ToolMode =
  | "select"
  | "route"
  | "measure"
  | "hole"
  | "pad"
  | "text"
  | "tune"
  | "bundle"
  | "boardShape"
  | "zone"
  | "keepout"
  | "zoneHole";

/**
 * What a tool mode sketches, or null when it does not sketch at all. Every
 * sketch-machinery predicate keys off this, so the zone (Z) and keepout (K)
 * tools reuse the board-shape draw loop unchanged (contract §12.3).
 */
function sketchTargetFor(mode: ToolMode): SketchTarget | null {
  if (mode === "boardShape") return "boardShape";
  if (mode === "zone") return "zone";
  if (mode === "keepout") return "keepout";
  if (mode === "zoneHole") return "zoneHole";
  return null;
}

/**
 * Shown when Shift+Z is pressed with no cuttable zone selected. One line, same
 * transient lifetime as the route notices.
 */
const ZONE_HOLE_NO_SUBJECT_NOTICE =
  "Select one unlocked polygon zone first — Shift+Z cuts a hole in it";

/** Grab radius (mm) for closing a board-shape sketch by clicking near its start. */
const SKETCH_CLOSE_THRESHOLD_MM = 1.5;

/** Default drill size for the "drop mounting hole" tool. 3.2 mm matches an
 * M3 plus-clearance hole, the most common mechanical mount. */
const DEFAULT_FREE_HOLE_DRILL_MM = 3.2;

interface DragSession {
  primaryPlacementId: string;
  pointerOffsetMm: PcbPointMm;
  initialPrimaryMm: PcbPointMm;
  currentPrimaryMm: PcbPointMm;
  /** Initial position for every placement in the drag set (single-element for non-group). */
  initialPositionsByPlacementId: Map<string, PcbPointMm>;
  moved: boolean;
}

interface FreePrimitiveDragSession {
  kind: "freeHole" | "freePad" | "overlayText";
  id: string;
  pointerOffsetMm: PcbPointMm;
  initialPositionMm: PcbPointMm;
  currentPositionMm: PcbPointMm;
  moved: boolean;
}

interface BoardResizeSession {
  handle: BoardHandle;
  initialRect: PcbBoardOutline;
  currentRect: PcbBoardOutline;
  /** Offset from the pointer to the grabbed handle at press — keeps the edge
   * pinned under the cursor instead of jumping to it on the first move. */
  pointerOffsetMm: PcbPointMm;
  moved: boolean;
}

/** Dragging one vertex of an editable (polygon / contour) board outline. */
interface VertexDragSession {
  vIndex: number;
  initial: EditableOutline;
  current: PcbBoardOutline;
  moved: boolean;
}

/** Grab radius for board resize handles, in mm. Matches other fixed-mm hits. */
const BOARD_HANDLE_TOLERANCE_MM = 1.0;

interface PcbCanvasProps {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  gridVisible?: boolean;
  /** Login-only cloud auth headers (bearer) for the auto-layout service. */
  cloudHeaders?: CloudHeadersProvider;
  /** Logged in + cloud configured → show the unified Auto-Layout button. */
  /**
   * The Auto Layout / Route Board entry points are RENDERED. Availability (feature flag +
   * cloud configured) is separate from permission to run: hiding the feature when signed
   * out is how users conclude it does not exist.
   */
  autoLayoutEnabled?: boolean;
  /** A cloud session exists — the dialog may actually submit a job. */
  autoLayoutSignedIn?: boolean;
  dispatchCommand: (
    command: DesignerCommand,
  ) => Promise<DesignerDispatchResult>;
  notifyExternalRevisionBump?: (revision: number) => void;
  /**
   * Live in-progress-trace DRC conflict count while a route session is active;
   * `null` when idle (so the status bar can fall back to the batch count).
   */
  onDrcCountChange?: (count: number | null) => void;
  /** Reports the number of selected primitives (for the status bar). */
  onSelectionCountChange?: (count: number) => void;
  commentThreads?: readonly DesignerCommentThread[];
  activeCommentThreadId?: string | null;
  commentMode?: boolean;
  currentUserEmail?: string | null;
  onCreateComment?: (anchor: DesignerCommentAnchor, body: string) => void;
  onSelectCommentThread?: (threadId: string) => void;
  onCloseCommentThread?: () => void;
  onToggleCommentMode?: () => void;
  onAddCommentMessage?: (
    thread: DesignerCommentThread,
    body: string,
    file?: File | null,
  ) => Promise<void>;
  onSetCommentStatus?: (
    thread: DesignerCommentThread,
    status: DesignerCommentThreadStatus,
  ) => Promise<void>;
  onSetCommentTodoStatus?: (
    thread: DesignerCommentThread,
    todoStatus: DesignerCommentTodoStatus,
  ) => Promise<void>;
  onToggleCommentReaction?: (
    thread: DesignerCommentThread,
    messageId: string,
    emoji: string,
  ) => Promise<void>;
  onMoveComment?: (
    thread: DesignerCommentThread,
    pointNm: { x: number; y: number },
  ) => void;
  commentAttachmentUrl?: (attachmentId: string) => string;
  layersPanelTarget?: HTMLElement | null;
  /** Trailing slot in the sidebar "Layers" section header (preset dropdown). */
  layersHeaderTarget?: HTMLElement | null;
  /** Sidebar "Components" section body. */
  componentsPanelTarget?: HTMLElement | null;
  /**
   * Schematic part id → value. The PCB projection has no value field, so the
   * designer shell supplies the schematic projection's map for the Components
   * list and the Properties "Value" row.
   */
  partValues?: ReadonlyMap<string, string>;
  /** Docked 30px toolbar row (Space.tsx renders the empty slot). */
  toolbarTarget?: HTMLElement | null;
  /** 28px contextual parameter row; empty (collapsed) while no tool is active. */
  paramRowTarget?: HTMLElement | null;
  /** 22px layer tab strip under the canvas. */
  layerStripTarget?: HTMLElement | null;
  /** Right dock → Properties tab body. */
  propertiesTarget?: HTMLElement | null;
  /** Board-space cursor position for the status bar; `null` when off-canvas. */
  onCursorChange?: (point: { xMm: number; yMm: number } | null) => void;
  /** Effective copper layer (routing layer, else the board's active layer). */
  onActiveLayerChange?: (layer: PcbLayerId) => void;
  /** Contextual status-bar hint for the active tool / selection. */
  onHintChange?: (hint: string) => void;
  /** Human-readable status-bar selection summary. */
  onSelectionSummaryChange?: (summary: string) => void;
  /** Placement count, for the sidebar "Components" section header badge. */
  onPlacementCountChange?: (count: number) => void;
  selectionRequest?: {
    placementIds: readonly string[];
    /** Cross-probe by refdes (resolved against loaded placements). */
    references?: readonly string[];
    nonce: number;
  } | null;
  initialViewport?: ViewportState | null;
  onViewportChange?: (zoom: number, posX: number, posY: number) => void;
}

/** Stable identity for the optional `partValues` prop. */
const EMPTY_PART_VALUES: ReadonlyMap<string, string> = new Map();
// Stable empty fallbacks: the area hooks memoise on these, so a fresh literal
// per render would re-run every dependent memo while no projection is loaded.
const EMPTY_ZONES: ReadonlyArray<PcbZone> = [];
const EMPTY_KEEPOUTS: ReadonlyArray<PcbKeepout> = [];
const EMPTY_NET_NAMES: Readonly<Record<string, string>> = {};
const EMPTY_VIOLATIONS: DrcViolation[] = [];
/** Stable identity so the per-pointer-move memos keeping it as a dep settle. */
const EMPTY_PENDING_COPPER: { traces: PcbTrace[]; vias: PcbVia[] } = {
  traces: [],
  vias: [],
};

/**
 * Status-bar hints (design D2 §9). These replace the floating hint strips that
 * used to sit at the bottom of the canvas — same wording, one home.
 */
const HINT_SELECT = "Click to select · Shift+click to add · drag to box-select";
const HINT_ROUTE_IDLE = "Click a pad, trace, or via to start routing · Esc cancel";
const HINT_ROUTE_ACTIVE =
  "F flip elbow · V switch layer · W cycle width · Shift unconstrain · / posture · Backspace undo segment · Esc cancel";
const HINT_MEASURE_IDLE =
  "Click start point · hold Shift for ΔX/ΔY · Esc clear";
const HINT_MEASURE_ACTIVE =
  "Click endpoint to lock · hold Shift for ΔX/ΔY · Esc clear";
const HINT_SKETCH_IDLE = "Click to place the first corner · Esc exit";
const HINT_SKETCH_ACTIVE =
  "type Length · Tab ∠ angle · Shift 45° lock · Enter close/place · ⌫ undo · Esc cancel";

/** Distinct DRC codes of a refusal, in report order — the notice's payload. */
function violationCodeList(violations: readonly DrcViolation[]): string {
  return [...new Set(violations.map((v) => v.code))].join(", ");
}

export function PcbCanvas(props: PcbCanvasProps): ReactElement {
  const gridEnabled = props.gridVisible ?? false;
  // Stable identities — several per-pointer-move memos (bundlePreview, …)
  // list these as deps; plain arrows would invalidate them on EVERY render.
  const snap = useCallback((v: number) => snapMm(v, gridEnabled), [gridEnabled]);
  const snapPoint = useCallback(
    (p: PcbPointMm) => snapPointMm(p, gridEnabled),
    [gridEnabled],
  );

  const workspace = usePcbWorkspace({
    backendURL: props.backendURL,
    moduleId: props.moduleId,
    designId: props.designId,
    dispatchCommand: props.dispatchCommand,
    notifyExternalRevisionBump: props.notifyExternalRevisionBump,
  });
  // THE effective keepouts for this projection (zone/keepout contract §4),
  // derived once in the workspace hook. Feeds the scene, the route obstacles
  // (conservative AABB superset), the live DRC (exact predicate) and the
  // smart-via guard, so all four agree on which rule areas exist.
  const effectiveKeepouts = workspace.effectiveKeepouts;
  // On design open, clear any stale store state and hydrate the *persisted*
  // DRC report so reopening restores the markers (the DRC tab does the same).
  // We deliberately do NOT clear on revision bump — last results stay visible
  // (marked stale in the tab/card) until the user re-runs DRC.
  useEffect(() => {
    let cancelled = false;
    // Only clear + re-hydrate when the store holds a DIFFERENT design. A
    // same-design remount (e.g. switching back to the PCB tab, or arriving from
    // the DRC tab) must NOT clear: doing so wipes the cross-tab center request /
    // selected violation the DRC tab just set — breaking jump-to-violation —
    // and drops the markers until the async re-fetch lands. The `centeredSeq`
    // guard in the centering effect still prevents re-centering on revisit.
    if (useDrcStore.getState().report?.designId !== props.designId) {
      useDrcStore.getState().clear();
      void workspace.getDrcResult().then((r) => {
        if (!cancelled && r) useDrcStore.getState().setReport(r);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [props.designId, workspace.getDrcResult]);
  // Per-layer opacity + row solo live in the unified view store. Subscribing
  // here keeps the panel + scene reactive to slider drags and Alt+click
  // gestures without prop drilling through the workspace hook.
  const layerOpacity = usePcbViewStore((s) => s.viewState.perLayerOpacity);
  const soloLayer = usePcbViewStore((s) => s.soloLayer);
  // DRC dock open-state + toolbar badge source (shared store, so the toolbar
  // here and the dock/status-bar in Space stay in sync without prop-drilling).
  const drcPanelOpen = useDrcStore((s) => s.panelOpen);
  const toggleDrcPanel = useDrcStore((s) => s.togglePanel);
  const drcErrorCount = useDrcStore((s) => s.report?.summary.errors ?? 0);
  const drcRunning = useDrcStore((s) => isDrcRunActive(s.run));
  // Full report + hover id drive the canvas marker hit-test + hover tooltip.
  const drcReport = useDrcStore((s) => s.report);
  const drcHoveredId = useDrcStore((s) => s.hoveredId);
  const drcMarkersVisible = useDrcStore((s) => s.markersVisible);
  const toggleDrcMarkers = useDrcStore((s) => s.toggleMarkersVisible);
  // Center the camera when the DRC tab requests it (cross-tab via the store).
  // The board mirror group flips X on bottom view, so flip the target too.
  const drcCenterRequest = useDrcStore((s) => s.centerRequest);
  const drcViewSide = usePcbViewStore((s) => s.viewState.viewSide);
  const drcCenteredSeq = useDrcStore((s) => s.centeredSeq);
  // Selection filter — opt-out per primitive kind. Wired into both click
  // and marquee selection paths so disabling "Vias" stops a via click from
  // ever landing in the selection set.
  const selectionFilter = usePcbViewStore((s) => s.selectionFilter);
  const selectionFilterRef = useRef(selectionFilter);
  selectionFilterRef.current = selectionFilter;
  const selectionFilterPanelOpen = usePcbViewStore(
    (s) => s.selectionFilterPanelOpen,
  );
  const [widthText, setWidthText] = useState("100");
  const [heightText, setHeightText] = useState("80");
  const [dragSession, setDragSession] = useState<DragSession | null>(null);
  const [committedDragOverride, setCommittedDragOverride] =
    useState<ReadonlyMap<string, PcbPointMm> | null>(null);
  const [freePrimitiveDragSession, setFreePrimitiveDragSession] =
    useState<FreePrimitiveDragSession | null>(null);
  const freePrimitiveDragSessionRef = useRef<FreePrimitiveDragSession | null>(
    null,
  );
  freePrimitiveDragSessionRef.current = freePrimitiveDragSession;
  const [boardResizeSession, setBoardResizeSession] =
    useState<BoardResizeSession | null>(null);
  const boardResizeSessionRef = useRef<BoardResizeSession | null>(null);
  boardResizeSessionRef.current = boardResizeSession;
  // Dragging a single vertex of an editable (polygon / contour) outline.
  const [vertexDragSession, setVertexDragSession] =
    useState<VertexDragSession | null>(null);
  const vertexDragSessionRef = useRef<VertexDragSession | null>(null);
  vertexDragSessionRef.current = vertexDragSession;
  const [dxfImportOpen, setDxfImportOpen] = useState(false);
  // Active fillet / chamfer numeric editor + its live preview outline.
  const [cornerOp, setCornerOp] = useState<{
    mode: "fillet" | "chamfer";
    vIndex: number;
    contour: PcbBoardContour;
  } | null>(null);
  const [cornerPreviewOutline, setCornerPreviewOutline] =
    useState<PcbBoardOutline | null>(null);
  // Active numeric edge-length / vertex-XY editor (reuses cornerPreviewOutline).
  const [dimOp, setDimOp] = useState<DimEditTarget | null>(null);
  // Holds the just-committed outline so the preview persists across the async
  // backend refresh — without it the board flashes back to its old size for a
  // few frames before the new projection lands.
  const [committedOutlineOverride, setCommittedOutlineOverride] =
    useState<PcbBoardOutline | null>(null);
  // CSS cursor for the canvas container — set when hovering a board handle so
  // the resize affordance reads before the user presses down.
  const [boardHandleCursor, setBoardHandleCursor] = useState<string | null>(
    null,
  );
  // Board-dimension edit mode — an explicit toggle (sidebar button). Only when
  // active are the dimension inputs usable and the canvas resize handles shown.
  const [boardDimMode, setBoardDimMode] = useState(false);
  const boardDimModeRef = useRef(boardDimMode);
  boardDimModeRef.current = boardDimMode;
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [routeState, dispatchRoute] = useReducer(
    routeToolReducer,
    initialRouteToolState,
  );
  // Inline custom-width editor in the route HUD (Alt+W / click the width).
  const [widthInputOpen, setWidthInputOpen] = useState(false);
  // DRC commit gate: a finish attempt with clearance conflicts is blocked
  // (session survives) unless the user explicitly allows violations.
  // Session-scoped — both reset when the session ends.
  const [allowDrcViolations, setAllowDrcViolations] = useState(false);
  const [blockedConflictCount, setBlockedConflictCount] = useState<
    number | null
  >(null);
  const [measureState, dispatchMeasure] = useReducer(
    measureToolReducer,
    initialMeasureToolState,
  );
  // Board Shape draw tool (pcb custom-outline sketch). Only committed vertices
  // live in the reducer; the canvas rubber-bands to the cursor and commits the
  // finished polygon as one `pcb_set_board_outline`. Read through a ref inside
  // the memoised interaction handler / keydown effect to avoid restaging them.
  const [sketchState, dispatchSketch] = useReducer(
    sketchToolReducer,
    initialSketchToolState,
  );
  const sketchStateRef = useRef(sketchState);
  sketchStateRef.current = sketchState;
  // Typed-dimension buffer for the draw tool (SolidWorks-style at-cursor entry).
  // UI-ephemeral like the route width input, so it lives here, not in the
  // reducer. Read through a ref inside the interaction handler / keydown effect.
  const [sketchEntry, setSketchEntry] = useState<SketchEntry | null>(null);
  const sketchEntryRef = useRef(sketchEntry);
  sketchEntryRef.current = sketchEntry;
  // Drop the typed buffer whenever we leave the active draw loop (finish,
  // cancel, or tool switch) so a stale value can't leak into the next sketch.
  useEffect(() => {
    if (
      (sketchTargetFor(toolMode) === null || sketchState.kind !== "drawing") &&
      sketchEntryRef.current
    ) {
      setSketchEntry(null);
    }
  }, [toolMode, sketchState]);
  // Length-Tune tool session (pcb.lengthTuning) + its inline target editor.
  const [tuneState, dispatchTune] = useReducer(
    tuneToolReducer,
    initialTuneToolState,
  );
  const [tuneTargetInputOpen, setTuneTargetInputOpen] = useState(false);
  // Refusal notice of the tune commit gate (contract 07 §8), session-scoped.
  const [tuneNotice, setTuneNotice] = useState<string | null>(null);
  // Trace under the cursor while the Tune tool is idle — pick affordance.
  const [tuneHoverTraceId, setTuneHoverTraceId] = useState<string | null>(
    null,
  );
  // Bundle-routing session (pcb.bundleRouting) + commit-block reason.
  const [bundleState, dispatchBundle] = useReducer(
    bundleToolReducer,
    initialBundleToolState,
  );
  const [bundleBlocked, setBundleBlocked] = useState<string | null>(null);
  // Last valid geometry per bundle pad — degraded lanes render this (amber)
  // instead of blinking out when the cursor makes an offset degenerate.
  const bundleLastGoodRef = useRef<Map<string, PointNm[]>>(new Map());
  const [measureShowDeltas, setMeasureShowDeltas] = useState(false);
  const [focusedLayer, setFocusedLayer] = useState<PcbCopperLayerId | null>(
    null,
  );
  const [cursorMm, setCursorMmState] = useState<PcbPointMm | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [autoLayoutOpen, setAutoLayoutOpen] = useState(false);
  const [autoroutePreview, setAutoroutePreview] = useState<
    AutoroutePreviewTrace[] | null
  >(null);
  // Auto-finish (pcb.routeAutoFinish): Tab / Ctrl+Click computes an A*
  // completion of the active route, held here as an explicit-accept proposal
  // (dimmed preview). Accept = Enter/click → finishRoute; Esc dismisses.
  const autoFinishEnabled = useFeatureFlag("pcb.routeAutoFinish");
  const [autoFinishProposal, setAutoFinishProposal] = useState<{
    extraAnchorsNm: PointNm[];
    finalAnchorNm: PointNm;
    /** Full rendered path (session anchors → target) for preview + length. */
    pathNm: PointNm[];
    targetPadId: string;
    targetName: string | null;
  } | null>(null);
  const [autoFinishNotice, setAutoFinishNotice] = useState<string | null>(null);
  // Transient route refusal shown under the HUD conflict line (currently: a
  // smart via refused by a `vias` keepout). Nothing changed when it appears.
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  // Transient refusal for the Zone-cutout sub-mode (Shift+Z) when the gesture
  // has no subject. Same lifetime as `routeNotice`; nothing changed when it
  // appears.
  const [zoneHoleNotice, setZoneHoleNotice] = useState<string | null>(null);
  // Walkaround-lite (pcb.routeWalkaround): the ghost head bends around the
  // obstacle cluster it would collide with. Refs (not state) — the detour is
  // recomputed per pointer move inside the routePreview memo; clicks read the
  // last computed anchors, hysteresis reads the last side pick.
  const walkaroundEnabled = useFeatureFlag("pcb.routeWalkaround");
  const lengthTuningEnabled = useFeatureFlag("pcb.lengthTuning");
  const walkChoiceRef = useRef<{
    clusterSignature: string;
    side: "cw" | "ccw";
  } | null>(null);
  const walkDetourRef = useRef<PointNm[] | null>(null);
  // Auto Layout is ONE cloud job now — no desktop-sequenced place→route stages. The dialog
  // owns the run; the canvas only opens it, supplies context, and renders its ghost.
  const [routeBoardOpen, setRouteBoardOpen] = useState(false);
  const [autoPlaceOpen, setAutoPlaceOpen] = useState(false);
  const [candidatePreview, setCandidatePreview] =
    useState<AutoLayoutCandidatePreview | null>(null);
  const persistedAutoLayoutConfig = usePcbViewStore(
    (s) => s.viewState.autoLayoutConfig,
  );
  const setAutoLayoutConfig = usePcbViewStore((s) => s.setAutoLayoutConfig);
  const seededAutoLayoutConfig = useMemo(
    () => seedConfig(persistedAutoLayoutConfig),
    [persistedAutoLayoutConfig],
  );
  // Interactive, non-destructive auto-place preview: the result envelope's proposed poses
  // are held locally and the user drags/rotates/flips to adjust before Accept (see hook).
  const placePreview = usePcbPlacePreview();
  const previewActive = placePreview.active;
  // Dataset-capture attribution (WP-D4): candidate id of the previewed envelope.
  const placeEnvelopeIdRef = useRef<string | null>(null);
  const [placePreviewPayload, setPlacePreviewPayload] =
    useState<PlacePayloadSummary | null>(null);
  const [placeApplying, setPlaceApplying] = useState(false);
  const [placeAppliedNote, setPlaceAppliedNote] = useState<{
    text: string;
    issues: boolean;
  } | null>(null);
  const placeApi = useMemo(
    () =>
      createDesignerApi({
        backendURL: props.backendURL,
        moduleId: props.moduleId,
        cloudHeaders: props.cloudHeaders,
      }),
    [props.backendURL, props.moduleId, props.cloudHeaders],
  );
  // Stable hook methods (the hook object identity changes each render).
  const {
    begin: beginPlacePreview,
    clear: clearPlacePreview,
    setPositions: setPlacePreviewPositions,
    rotate: rotatePlacePreview,
    flip: flipPlacePreview,
    flipMany: flipManyPlacePreview,
  } = placePreview;
  // Enter preview when the dialog's poll completes.
  const handlePreviewResult = useCallback(
    (envelope: PlacementResultEnvelope) => {
      beginPlacePreview(
        workspace.projection?.placements ?? [],
        envelope.operations,
      );
      setPlacePreviewPayload(envelope.payload);
      placeEnvelopeIdRef.current = envelope.id;
      setPlaceAppliedNote(null);
      // The autoplace dialog auto-hides now that the preview is active (its
      // `open` is gated on `!previewActive`); the ghost preview bar takes over.
    },
    [beginPlacePreview, workspace.projection?.placements],
  );
  const rejectPreview = useCallback(() => {
    setDragSession(null);
    clearPlacePreview();
    setPlacePreviewPayload(null);
    setPlaceApplying(false);
    // Auto Place is a standalone tool now — rejecting its preview ends only that run.
  }, [clearPlacePreview]);
  // Diff the adjusted preview vs. the captured originals → reuse the existing apply
  // endpoint (per-op commands + one DRC pass), then reload and clear the preview. Plain
  // function so the click closure always reads the latest transforms/originals.
  const acceptPreview = async (): Promise<void> => {
    if (!props.designId) return;
    const designId = props.designId;
    const ops = diffToOperations(
      placePreview.transforms,
      placePreview.originals,
    );
    if (ops.length === 0) {
      rejectPreview();
      return;
    }
    setPlaceApplying(true);
    try {
      // "designer-pcb-session" so applied placements are user-undoable; the
      // capture fields attribute them for the dataset (WP-D4).
      const { appliedCount, failures, drc } = await placeApi.applyAutoplaceOps(
        designId,
        ops,
        "designer-pcb-session",
        { appliedCandidateId: placeEnvelopeIdRef.current ?? undefined },
      );
      await workspace.refresh();
      const failed = failures?.length ?? 0;
      const errors = drc?.summary.errors ?? 0;
      setPlaceAppliedNote({
        text:
          `Applied ${appliedCount} change${appliedCount === 1 ? "" : "s"}` +
          (failed > 0 ? ` (${failed} rejected)` : "") +
          (errors > 0 ? ` — DRC reports ${errors} error(s).` : " — DRC clean."),
        issues: failed > 0 || errors > 0,
      });
      clearPlacePreview();
      setPlacePreviewPayload(null);
    } catch (e) {
      setPlaceAppliedNote({
        text: e instanceof Error ? e.message : String(e),
        issues: true,
      });
    } finally {
      setPlaceApplying(false);
    }
  };
  // Drop a stale preview if the design changes or the canvas unmounts.
  useEffect(() => {
    return () => {
      setDragSession(null);
      clearPlacePreview();
      setPlacePreviewPayload(null);
      setPlaceApplying(false);
    };
  }, [props.designId, clearPlacePreview]);
  // Auto-dismiss the post-accept status note.
  useEffect(() => {
    if (!placeAppliedNote) return;
    const id = window.setTimeout(() => setPlaceAppliedNote(null), 4000);
    return () => window.clearTimeout(id);
  }, [placeAppliedNote]);
  const cursorMmRef = useRef<PcbPointMm | null>(null);
  // Figma-style alignment guides shown while dragging placements. The index
  // + group bbox are captured once at drag-start; each move queries them.
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [alignmentSpacing, setAlignmentSpacing] = useState<SpacingGuide[]>([]);
  const alignmentIndexRef = useRef<AlignmentIndex | null>(null);
  const draggedInitialBBoxRef = useRef<BoundsMm | null>(null);
  const altHeldRef = useRef(false);
  // Shift suppresses object + guide snapping for free placement (KiCad
  // parity); grid snap stays active. Ref like altHeldRef — the suppression
  // takes effect on the next pointer move.
  const shiftHeldRef = useRef(false);
  const alignmentGuidesEnabled = usePcbViewStore(
    (s) => s.viewState.alignmentGuidesVisible ?? true,
  );
  const alignmentGuidesEnabledRef = useRef(alignmentGuidesEnabled);
  alignmentGuidesEnabledRef.current = alignmentGuidesEnabled;
  const cameraControlsRef = useRef<PcbCameraControls | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  // Close the board-shape sketch: build a canonical contour from the collected
  // vertices, persist it as one `pcb_set_board_outline`, exit to select, and
  // reframe. Held in a ref so the interaction handler / keydown effect call the
  // latest closure without listing it (and `workspace`) in their dep arrays.
  const finishSketchRef = useRef<(session: SketchSession) => void>(
    () => undefined,
  );
  finishSketchRef.current = (session) => {
    const verticesMm = session.verticesMm;
    const target = session.target;
    if (verticesMm.length < MIN_SKETCH_VERTICES) return;
    if (target === "boardShape") {
      const outline = verticesToContour(verticesMm);
      dispatchSketch({ kind: "cancel" });
      setToolMode("select");
      void workspace
        .updateBoardOutline(outline)
        .then(() => cameraControlsRef.current?.fit())
        .catch(() => undefined);
      return;
    }
    // Zone cutout: the ring is checked against the parent zone's whole region
    // with the executor's own `zoneRegionValidity` (copper-pour §11).
    if (target === "zoneHole") {
      const parent = (workspace.projection?.zones ?? EMPTY_ZONES).find(
        (z) => z.id === session.parentZoneId,
      );
      if (!parent) return;
      void areaTools.commitHole(parent, verticesMm).then((zoneId) => {
        if (zoneId === null) return;
        dispatchSketch({ kind: "cancel" });
        setToolMode("select");
      });
      return;
    }
    // Zone / keepout: the ring is pre-checked with the executor's own
    // `zoneRingValidity` (contract §12.3). An invalid ring keeps the sketch
    // open with the reason in the options bar — no dispatch, no tool exit.
    void areaTools.commit(target, verticesMm).then((createdId) => {
      if (createdId === null) return;
      dispatchSketch({ kind: "cancel" });
      setToolMode("select");
      setSelection({
        ...emptyPcbSelection(),
        zoneIds: new Set(target === "zone" ? [createdId] : []),
        keepoutIds: new Set(target === "keepout" ? [createdId] : []),
      });
    });
  };
  // Apply a cross-tab "center on violation" request from the DRC tab once the
  // camera is ready. Board mirror flips X on bottom view, so flip the target.
  useEffect(() => {
    if (!drcCenterRequest || !cameraReady) return;
    // Guard against re-centering on a request already applied — `centeredSeq`
    // lives in the store, so this holds across a PCB-tab remount (a component
    // ref would reset and re-center on the stale request every revisit).
    if (drcCenterRequest.seq <= drcCenteredSeq) return;
    useDrcStore.getState().markCentered(drcCenterRequest.seq);
    const scaleX = drcViewSide === "bottom" ? -1 : 1;
    cameraControlsRef.current?.centerOnMm({
      x: scaleX * drcCenterRequest.x,
      y: drcCenterRequest.y,
    });
  }, [drcCenterRequest, cameraReady, drcViewSide, drcCenteredSeq]);
  const handleCameraReady = useCallback(
    (controls: PcbCameraControls | null) => {
      cameraControlsRef.current = controls;
      setCameraReady(controls != null);
    },
    [],
  );
  const setCursorMm = useCallback((next: PcbPointMm | null): void => {
    cursorMmRef.current = next;
    setCursorMmState(next);
  }, []);
  // Viewport-relative cursor position (clientX/Y) — drives the route-mode
  // layer chip that follows the cursor so users can see active layer state
  // without looking at the toolbar.
  const [cursorClientPx, setCursorClientPx] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selection, setSelection] = useState<PcbSelection>(emptyPcbSelection);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  // Disambiguation popup state. Populated on Alt+click when multiple
  // primitives sit under the cursor; user picks one with mouse, arrow
  // keys + Enter, or Alt+click again to cycle.
  const [disambigPopup, setDisambigPopup] = useState<{
    candidates: ReadonlyArray<PcbHitCandidate>;
    activeIndex: number;
    screenX: number;
    screenY: number;
  } | null>(null);
  const placementsRef = useRef(workspace.projection?.placements ?? []);
  placementsRef.current = workspace.projection?.placements ?? [];
  // Lookup of the live (DB) placements by id — the originals the preview diffs against and
  // captures lazily when the user adjusts a component the engine left untouched.
  const originalById = useMemo(
    () =>
      new Map((workspace.projection?.placements ?? []).map((p) => [p.id, p])),
    [workspace.projection?.placements],
  );
  const originalByIdRef = useRef(originalById);
  originalByIdRef.current = originalById;
  // What the user SEES and grabs: proposed poses overlaid while previewing, else the live
  // layout. Drives rendering, hit-testing and drag-seed so grabs land on the drawn pose.
  const proposedEffective = useMemo(
    () =>
      previewActive
        ? applyTransformsToPlacements(
            workspace.projection?.placements ?? [],
            placePreview.transforms,
          )
        : null,
    [previewActive, workspace.projection?.placements, placePreview.transforms],
  );
  const placePreviewFromMarkers = useMemo(
    () =>
      previewActive
        ? buildFromMarkers(placePreview.transforms, placePreview.originals)
        : null,
    [previewActive, placePreview.transforms, placePreview.originals],
  );
  const effectivePlacements =
    proposedEffective ?? workspace.projection?.placements ?? [];
  const effectivePlacementsRef = useRef(effectivePlacements);
  effectivePlacementsRef.current = effectivePlacements;
  const tracesRef = useRef(workspace.projection?.traces ?? []);
  tracesRef.current = workspace.projection?.traces ?? [];
  const viasRef = useRef(workspace.projection?.vias ?? []);
  viasRef.current = workspace.projection?.vias ?? [];

  // Cross-probe requests carrying refdes that can't be resolved yet (PCB
  // projection still loading) are parked here and resolved once placements
  // arrive — one-shot per request nonce.
  const pendingRefSelectRef = useRef<{
    references: readonly string[];
    nonce: number;
  } | null>(null);

  useEffect(() => {
    const request = props.selectionRequest;
    if (!request) return;
    setToolMode("select");
    dispatchMeasure({ kind: "clear" });
    const ids = new Set(request.placementIds);
    const references = request.references ?? [];
    if (references.length > 0) {
      const placements = workspace.projection?.placements ?? [];
      const refSet = new Set(references);
      let matched = 0;
      for (const placement of placements) {
        if (refSet.has(placement.reference)) {
          ids.add(placement.id);
          matched += 1;
        }
      }
      pendingRefSelectRef.current =
        matched < references.length
          ? { references, nonce: request.nonce }
          : null;
    } else {
      pendingRefSelectRef.current = null;
    }
    setSelection({ ...emptyPcbSelection(), placementIds: ids });
  }, [props.selectionRequest]);

  // Resolve a parked refdes cross-probe once the PCB projection loads.
  useEffect(() => {
    const pending = pendingRefSelectRef.current;
    if (!pending) return;
    const placements = workspace.projection?.placements ?? [];
    if (placements.length === 0) return;
    const refSet = new Set(pending.references);
    const ids = new Set<string>();
    for (const placement of placements) {
      if (refSet.has(placement.reference)) ids.add(placement.id);
    }
    if (ids.size === 0) return;
    pendingRefSelectRef.current = null;
    setToolMode("select");
    setSelection({ ...emptyPcbSelection(), placementIds: ids });
  }, [workspace.projection?.placements]);
  const freeHolesRef = useRef(workspace.projection?.freeHoles ?? []);
  freeHolesRef.current = workspace.projection?.freeHoles ?? [];
  const freePadsRef = useRef(workspace.projection?.freePads ?? []);
  freePadsRef.current = workspace.projection?.freePads ?? [];
  // DRC markers for hover/click hit-testing — positions only (selected/hovered
  // flags irrelevant here), waived excluded by the shared builder. A ref keeps
  // the pointer handlers' closure current without re-creating the handler memo.
  const drcWaivedIds = usePcbViewStore(
    (s) => s.viewState.drcWaivedViolationIds,
  );
  const drcHitMarkers = useMemo(
    () =>
      drcMarkersVisible
        ? buildDrcMarkers(drcReport, null, null, drcWaivedIds)
        : [],
    [drcMarkersVisible, drcReport, drcWaivedIds],
  );
  const drcMarkersRef = useRef(drcHitMarkers);
  drcMarkersRef.current = drcHitMarkers;
  const drcHoverRef = useRef<string | null>(null);
  const drcZoomRef = useRef(props.initialViewport?.zoom ?? 50);
  // Drop a lingering hover (tooltip + trace highlight) when markers are hidden.
  useEffect(() => {
    if (!drcMarkersVisible && drcHoverRef.current !== null) {
      drcHoverRef.current = null;
      useDrcStore.getState().setHovered(null);
    }
  }, [drcMarkersVisible]);

  const visibleLayers = useMemo(
    () => visibleLayerSet(workspace.projection?.board.visibleLayers ?? []),
    [workspace.projection?.board.visibleLayers],
  );

  const visiblePlacements = useMemo(
    () =>
      effectivePlacements.filter((placement) =>
        isPlacementVisible(visibleLayers, placement),
      ),
    [effectivePlacements, visibleLayers],
  );

  // Overlay text is hit-tested against the SAME set `PcbScene` renders
  // (`renderOverlayTexts`, gated by `visibleOverlayEntities` off the identical
  // `projection.board.visibleLayers` state). Without this, silk text hidden by
  // the top-side preset stayed invisibly click-selectable and draggable.
  // Declared after `visibleLayers` because the ref is filled during render.
  const visibleOverlayTexts = useMemo(
    () =>
      visibleOverlayEntities(
        visibleLayers,
        workspace.projection?.overlayTexts ?? [],
      ),
    [workspace.projection?.overlayTexts, visibleLayers],
  );
  const overlayTextsRef =
    useRef<ReadonlyArray<PcbOverlayText>>(visibleOverlayTexts);
  overlayTextsRef.current = visibleOverlayTexts;

  const viasVisible = areViasVisible(visibleLayers);

  useEffect(() => {
    const board = workspace.projection?.board.outline;
    if (!board) return;
    setWidthText(String(roundDimMm(board.widthMm)));
    setHeightText(String(roundDimMm(board.heightMm)));
  }, [workspace.projection?.board.outline]);

  // Prune stale ids when projection changes (e.g. undo deleted a trace that
  // was part of the current selection).
  useEffect(() => {
    const projection = workspace.projection;
    if (!projection) return;
    const placementIds = new Set(
      projection.placements
        .filter((p) => isPlacementVisible(visibleLayers, p))
        .map((p) => p.id),
    );
    const traceIds = new Set(
      projection.traces
        .filter((t) => isTraceVisible(visibleLayers, t))
        .map((t) => t.id),
    );
    const viaIds = new Set(viasVisible ? projection.vias.map((v) => v.id) : []);
    setSelection((prev) => {
      const np = new Set(
        [...prev.placementIds].filter((id) => placementIds.has(id)),
      );
      const nt = new Set([...prev.traceIds].filter((id) => traceIds.has(id)));
      const nv = new Set([...prev.viaIds].filter((id) => viaIds.has(id)));
      if (
        np.size === prev.placementIds.size &&
        nt.size === prev.traceIds.size &&
        nv.size === prev.viaIds.size
      ) {
        return prev;
      }
      return { placementIds: np, traceIds: nt, viaIds: nv };
    });
  }, [workspace.projection, visibleLayers, viasVisible]);

  const eventToMm = useCallback((event: InteractionEvent): PcbPointMm => {
    return {
      x: nmToSceneMm(event.worldPoint.x),
      y: nmToSceneMm(event.worldPoint.y),
    };
  }, []);

  // Reverse-lookup (placementId|padNumber) → netId. Straight from the
  // authoritative schematic correlation, so single-pad and fully routed nets
  // hover-highlight too (the old ratsnest reconstruction saw neither).
  const padToNet = useMemo(
    () => new Map(Object.entries(workspace.projection?.padNets ?? {})),
    [workspace.projection?.padNets],
  );

  const traceToNet = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const t of workspace.projection?.traces ?? []) {
      map.set(t.id, t.netId);
    }
    return map;
  }, [workspace.projection?.traces]);

  const traceToLayer = useMemo(() => {
    const map = new Map<string, PcbCopperLayerId>();
    for (const t of workspace.projection?.traces ?? []) {
      map.set(t.id, t.layer);
    }
    return map;
  }, [workspace.projection?.traces]);

  const viaToNet = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const v of workspace.projection?.vias ?? []) {
      map.set(v.id, v.netId);
    }
    return map;
  }, [workspace.projection?.vias]);

  // Resolve the active layer of the workspace, defaulting to F.Cu when the
  // active layer is a non-copper layer (silkscreen, edge cuts) — routing only
  // happens on copper.
  const activeCopperLayer: PcbCopperLayerId = useMemo(() => {
    const a = workspace.projection?.board.activeLayer;
    return a === "B.Cu" || a === "In1.Cu" || a === "In2.Cu" ? a : "F.Cu";
  }, [workspace.projection?.board.activeLayer]);
  const displayedCopperLayer: PcbCopperLayerId =
    routeState.kind === "routing"
      ? routeState.session.layer
      : activeCopperLayer;
  const mirrorActive = workspace.viewSide === "bottom";

  // Zone (Z) / keepout (K) draw-tool options + the ring-check commit path.
  const areaTools = useAreaTools({
    workspace,
    activeCopperLayer,
    layerCount: workspace.projection?.board.layerCount ?? 2,
    netNames: workspace.projection?.netNames ?? EMPTY_NET_NAMES,
  });
  // Selection / marquee / vertex editing for polygon zones + keepouts. Hidden
  // layers are never hit, marquee-selected or highlighted (contract §12.3).
  // Same pair `ZoneOutlineLayer` / `KeepoutLayer` use, so solo mode cannot
  // select what it does not draw. Route focus never coexists with area picks.
  const areaVisualState = useMemo(
    () =>
      createPcbVisualState({
        displayMode: workspace.displayMode,
        activeLayer: focusedLayer,
      }),
    [focusedLayer, workspace.displayMode],
  );
  const areaLayerAllowed = useCallback(
    (layer: PcbCopperLayerId) =>
      isCopperLayerVisible(visibleLayers, layer) &&
      shouldRenderCopperLayer(areaVisualState, layer),
    [areaVisualState, visibleLayers],
  );
  const areaInteractions = useAreaInteractions({
    zones: workspace.projection?.zones ?? EMPTY_ZONES,
    keepouts: workspace.projection?.keepouts ?? EMPTY_KEEPOUTS,
    selection,
    activeCopperLayer,
    layerAllowed: areaLayerAllowed,
    snapPoint,
    workspace,
  });

  // The one unlocked polygon zone a cutout can be cut from (copper-pour
  // contract §11). Shift+Z refuses when this is null.
  const selectedPolygonZone = useMemo<PcbZone | null>(() => {
    const ids = [...(selection.zoneIds ?? [])];
    if (ids.length !== 1) return null;
    const zone = (workspace.projection?.zones ?? EMPTY_ZONES).find(
      (z) => z.id === ids[0],
    );
    if (!zone || zone.region.kind !== "polygon") return null;
    return zone.lockedAt === null ? zone : null;
  }, [selection.zoneIds, workspace.projection?.zones]);
  const zoneHoleParentRef = useRef<PcbZone | null>(null);
  zoneHoleParentRef.current = selectedPolygonZone;

  // A ring-validity message belongs to the sketch that produced it — drop it
  // whenever the tool changes so the next session starts clean.
  const clearAreaToolError = areaTools.clearError;
  useEffect(() => {
    clearAreaToolError();
  }, [clearAreaToolError, toolMode]);

  // Floating canvas comment overlay: projection + new-comment draft + recenter.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const commentProjection = useCanvasProjection(
    wrapperRef,
    props.initialViewport,
  );
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  const recenterOnComment = useCallback(
    (anchorNm: { x: number; y: number }) => {
      const scaleX = mirrorActive ? -1 : 1;
      cameraControlsRef.current?.centerOnMm({
        x: scaleX * nmToSceneMm(anchorNm.x),
        y: nmToSceneMm(anchorNm.y),
      });
    },
    [mirrorActive],
  );

  // Dev-only capture hooks (M0.2): expose the live world-nm → canvas-px
  // projection on `window.__openpcbCapture.pcb`, gated on OPENPCB_CAPTURE=1.
  useEffect(() => {
    const captureMode =
      (window as { electronAPI?: { captureMode?: boolean } }).electronAPI
        ?.captureMode === true;
    if (!captureMode) return;
    const pcb: OpenpcbCapturePcbApi = {
      project: (anchorNm, mirrorX) =>
        commentProjection.project(anchorNm, mirrorX),
      rect: () => commentProjection.rect,
    };
    const existing = window.__openpcbCapture ?? {};
    window.__openpcbCapture = { ...existing, pcb };
    return () => {
      const current = window.__openpcbCapture;
      if (current) delete current.pcb;
    };
  }, [commentProjection]);

  // Uncommitted session geometry as pseudo projection objects so snapping,
  // guides, rendering and the copper-finish hit-test treat accumulated runs
  // like real copper until the atomic commit lands. Ids are namespaced
  // `pending:` — they never reach the backend.
  const pendingRouteGeometry = useMemo(() => {
    const board = workspace.projection?.board;
    if (routeState.kind !== "routing" || !board) return EMPTY_PENDING_COPPER;
    if (routeState.session.boundaries.length === 0) return EMPTY_PENDING_COPPER;
    // The ONE session → pending-copper mapping, shared with the gate: what the
    // scene draws and what `checkPendingCopper` judges are the same rows.
    return pendingCopperFromSession(routeState.session, null, board);
  }, [routeState, workspace.projection?.board]);

  // Broad-phase rbush index over committed copper, rebuilt per projection.
  // Prefilters the brute-force snap/DRC predicates — they stay authoritative.
  const projectionIndex = useMemo(() => {
    if (!workspace.projection) return null;
    return buildPcbSpatialIndex({
      placements: workspace.projection.placements,
      traces: workspace.projection.traces,
      vias: workspace.projection.vias,
    });
  }, [workspace.projection]);

  // Snap target derived from cursor + nearby primitives (committed AND
  // pending session copper). Tolerance is screen-px derived (8px / zoom),
  // matching the guides engine, so snapping feels identical at any zoom.
  const snapTarget = useMemo<SnapTarget | null>(() => {
    if (!cursorMm) return null;
    if (!workspace.projection || !projectionIndex) return null;
    if (shiftHeldRef.current) return null;
    const toleranceMm = SNAP_THRESHOLD_PX / drcZoomRef.current;
    const box = pointQueryBox(cursorMm, toleranceMm);
    return findSnapTarget({
      cursorMm,
      toleranceMm,
      placements: projectionIndex.queryPlacements(box),
      traces: [
        ...projectionIndex.queryTraces(box),
        ...pendingRouteGeometry.traces,
      ],
      vias: [...projectionIndex.queryVias(box), ...pendingRouteGeometry.vias],
      activeLayer: activeCopperLayer,
    });
  }, [
    cursorMm,
    workspace.projection,
    projectionIndex,
    activeCopperLayer,
    pendingRouteGeometry,
  ]);

  const resolveMeasureAnchor = useCallback(
    (cursor: PcbPointMm): MeasureAnchor => {
      if (workspace.projection) {
        const target = findMeasureSnapTarget({
          cursorMm: cursor,
          toleranceMm: 0.5,
          placements: visiblePlacements,
          traces: tracesRef.current,
          vias: viasRef.current,
          freePads: freePadsRef.current,
          activeLayer: activeCopperLayer,
        });
        if (target) {
          const { kind, pointMm, sourceId } = target;
          return sourceId !== undefined
            ? { kind, pointMm, sourceId }
            : { kind, pointMm };
        }
      }
      const pointMm = snapPoint(cursor);
      return gridEnabled
        ? { kind: "grid", pointMm }
        : { kind: "cursor", pointMm };
    },
    [
      activeCopperLayer,
      gridEnabled,
      snapPoint,
      visiblePlacements,
      workspace.projection,
    ],
  );

  // Marquee/rubber-band selection. Uses the shared canvas hook so PCB and
  // schematic behave identically (KiCad direction-based window/crossing modes,
  // Shift = additive, Escape = cancel + restore prior selection).
  const marquee = useMarqueeSelection<PcbSelection>({
    enabled: toolMode === "select",
    cloneSelection: clonePcbSelection,
    emptySelection: emptyPcbSelection,
    getSelection: () => selectionRef.current,
    setSelection,
    applyMarqueeHits: ({ rect, mode: rawMode, baseSelection }) => {
      // In bottom view the interaction transform negates X, so dragging
      // right visually gives decreasing DB-x — invert window/crossing.
      const mode = mirrorActive
        ? rawMode === "window"
          ? "crossing"
          : "window"
        : rawMode;
      const sf = selectionFilterRef.current;
      const placementHit =
        mode === "window" ? placementContainedInRect : placementIntersectsRect;
      const traceHit =
        mode === "window" ? traceContainedInRect : traceIntersectsRect;
      const viaHit = mode === "window" ? viaContainedInRect : viaIntersectsRect;
      const placementIds = new Set(baseSelection.placementIds);
      const traceIds = new Set(baseSelection.traceIds);
      const viaIds = new Set(baseSelection.viaIds);
      if (!sf || sf.pads || sf.placements) {
        for (const p of visiblePlacements) {
          if (placementHit(p, rect)) placementIds.add(p.id);
        }
      }
      const aLayer = workspace.projection?.board.activeLayer;
      const layer: PcbCopperLayerId =
        aLayer === "B.Cu" || aLayer === "In1.Cu" || aLayer === "In2.Cu"
          ? aLayer
          : "F.Cu";
      if (!sf || sf.traces) {
        for (const t of tracesRef.current) {
          if (t.layer !== layer) continue;
          if (!isTraceVisible(visibleLayers, t)) continue;
          if (traceHit(t, rect)) traceIds.add(t.id);
        }
      }
      if ((!sf || sf.vias) && viasVisible) {
        for (const v of viasRef.current) {
          if (viaHit(v, rect)) viaIds.add(v.id);
        }
      }
      const areaHits = areaInteractions.marqueeHits(rect, mode, baseSelection);
      return {
        placementIds,
        traceIds,
        viaIds,
        zoneIds: areaHits.zoneIds,
        keepoutIds: areaHits.keepoutIds,
      };
    },
  });

  // Default net class supplies width/clearance/via dims when starting a trace
  // on empty space (no pad → null netId). Array order is semantic — the first
  // class is the default (rule-semantics contract §3 step 3).
  const defaultNetClass = useMemo(() => {
    const classes = workspace.projection?.board.netClasses;
    if (!classes) return null;
    const id = defaultNetClassId(classes);
    return classes.find((c) => c.id === id) ?? null;
  }, [workspace.projection?.board.netClasses]);

  /**
   * The ONE legality context of this projection (live-parity contract 07 §2,
   * §7), derived once in `usePcbWorkspace` and shared by every legality
   * consumer on the canvas: the live gate, the commit gates for route / bundle
   * / smart via / tune, and the obstacle inflation for auto-finish /
   * walkaround / meander. Batch DRC builds the same context from the same
   * board, so the gate and the report cannot disagree.
   *
   * `maxClearanceBoundMm` is the context's own upper bound of ANY
   * copper-to-copper clearance; it sizes the A* grid step and the meander leg
   * floor. `maxObstacleReachMm` additionally covers the HOLE bound — how far
   * any obstacle rect can reach past the item that produced it — and is what
   * every `buildRouteObstacles` query window is padded by. Legality reads
   * neither: the per-obstacle requirement is resolved inside
   * `buildRouteObstacles`, the verdict inside `runLiveDrc`.
   */
  const legalityContext = workspace.legalityContext;
  const maxClearanceBoundMm = workspace.maxClearanceBoundMm;
  const maxObstacleReachMm = workspace.maxObstacleReachMm;

  /**
   * Resolve a starting anchor: snaps to pad center if cursor is over a pad and
   * returns its (placementId, padNumber, netId), else returns the snapped
   * cursor as a dangling anchor (netId=null).
   */
  const resolveAnchor = useCallback(
    (
      cursor: PcbPointMm,
    ): {
      pointMm: PcbPointMm;
      netId: string | null;
      onPad: boolean;
      padId?: string;
      /**
       * Copper layer implied by the snapped object, used to auto-pick the route
       * layer in Auto mode. `null` = spans all copper (through-hole pad / via);
       * `undefined` = free/dangling anchor with no layer hint.
       */
      layer?: PcbCopperLayerId | null;
    } => {
      const pad = hitPad(visiblePlacements, cursor);
      if (pad) {
        const padId = `${pad.placementId}|${pad.padNumber}`;
        const netId = padToNet.get(padId) ?? null;
        return {
          pointMm: pad.worldMm,
          netId,
          onPad: true,
          padId,
          layer: pad.layer,
        };
      }
      if (snapTarget) {
        if (
          snapTarget.kind === "trace-endpoint" ||
          snapTarget.kind === "trace-segment-end"
        ) {
          const traceId = snapTarget.sourceId.split("|")[0]!;
          const netId = traceToNet.get(traceId) ?? null;
          return {
            pointMm: snapTarget.pointMm,
            netId,
            onPad: false,
            layer: traceToLayer.get(traceId),
          };
        }
        if (snapTarget.kind === "via-center") {
          const netId = viaToNet.get(snapTarget.sourceId) ?? null;
          return {
            pointMm: snapTarget.pointMm,
            netId,
            onPad: false,
            layer: null,
          };
        }
      }
      return { pointMm: snapPoint(cursor), netId: null, onPad: false };
    },
    [
      padToNet,
      visiblePlacements,
      snapTarget,
      traceToNet,
      traceToLayer,
      viaToNet,
    ],
  );

  // Route-time anchor resolution = object snap (pad/endpoint/via, via
  // resolveAnchor) with routing-guide snapping layered underneath. Object snap
  // always wins; only an otherwise-free anchor is pulled onto the nearest
  // routing guide. Alt or the disabled toggle skips the guide snap. Used by
  // both the live preview and the committed waypoint/endpoint so they agree.
  const resolveRouteAnchor = useCallback(
    (cursor: PcbPointMm) => {
      const base = resolveAnchor(cursor);
      if (
        routeState.kind !== "routing" ||
        base.onPad ||
        snapTarget !== null ||
        altHeldRef.current ||
        shiftHeldRef.current ||
        !alignmentGuidesEnabledRef.current ||
        !workspace.projection
      ) {
        return base;
      }
      const session = routeState.session;
      const anchors = sessionAnchors(session);
      const last = anchors[anchors.length - 1]!;
      const prior = anchors[anchors.length - 2];
      const { snapPointMm } = computeRouteGuides({
        anchorMm: { x: last.x / NM_PER_MM, y: last.y / NM_PER_MM },
        ...(prior
          ? { priorMm: { x: prior.x / NM_PER_MM, y: prior.y / NM_PER_MM } }
          : {}),
        cursorMm: cursor,
        posture: session.posture,
        placements: workspace.projection.placements,
        traces: [
          ...workspace.projection.traces,
          ...pendingRouteGeometry.traces,
        ],
        vias: [...workspace.projection.vias, ...pendingRouteGeometry.vias],
        activeLayer: session.layer,
        netId: session.netId,
        toleranceMm: SNAP_THRESHOLD_PX / drcZoomRef.current,
      });
      return snapPointMm ? { ...base, pointMm: snapPointMm } : base;
    },
    [
      pendingRouteGeometry,
      resolveAnchor,
      routeState,
      snapTarget,
      workspace.projection,
    ],
  );

  /**
   * Finish the session through `finalAnchorNm`: assemble every accumulated
   * run + via plus the final run into ONE atomic `pcb_commit_route` (one
   * revision, one undo entry). On rejection the WHOLE session survives —
   * nothing was persisted, the commit is atomic.
   */
  const finishRoute = useCallback(
    async (
      session: RouteSession,
      finalAnchorNm: PointNm,
      // Accepted auto-finish proposals inject their A* anchors here; the run
      // still flows through the exact same builder + gate + atomic commit.
      extraAnchorsNm: readonly PointNm[] = [],
    ): Promise<void> => {
      const finalRun = buildPreviewPath(
        [...sessionAnchors(session), ...extraAnchorsNm, finalAnchorNm],
        session.segmentMode,
        session.posture,
      );
      const traces = [
        ...session.boundaries
          .filter((b) => b.run)
          .map((b) => ({
            layer: b.run!.layer,
            pointsNm: b.run!.pointsNm,
            widthMm: b.run!.widthMm,
            netId: session.netId,
            netClassId: session.netClassId,
            segmentMode: b.run!.segmentMode,
          })),
        ...(finalRun.length >= 2
          ? [
              {
                layer: session.layer,
                pointsNm: finalRun,
                widthMm: session.widthMm,
                netId: session.netId,
                netClassId: session.netClassId,
                segmentMode: session.segmentMode,
              },
            ]
          : []),
      ];
      const vias = session.boundaries
        .filter((b) => b.via)
        .map((b) => ({
          centerMm: {
            x: b.via!.centerNm.x / NM_PER_MM,
            y: b.via!.centerNm.y / NM_PER_MM,
          },
          netId: session.netId,
          netClassId: session.netClassId,
          ...(b.via!.diameterMmOverride !== undefined
            ? { diameterMmOverride: b.via!.diameterMmOverride }
            : {}),
          ...(b.via!.drillMmOverride !== undefined
            ? { drillMmOverride: b.via!.drillMmOverride }
            : {}),
        }));
      if (traces.length === 0 && vias.length === 0) return;
      // The commit gate (contract 07 §8 site B): ONE `checkPendingCopper` over
      // the WHOLE session — every run and via at once, so lane-to-lane and
      // run-to-run pairs are judged too — against the board the context
      // describes. Same-net copper is exempt inside the shared pair filters.
      if (legalityContext && workspace.projection) {
        const blocking = blockingViolations(
          legalityContext,
          runLiveDrc({
            ctx: legalityContext,
            pending: pendingCopperFromSession(
              session,
              finalRun.length >= 2 ? finalRun : null,
              workspace.projection.board,
            ),
          }),
        );
        if (!allowDrcViolations && blocking.length > 0) {
          setBlockedConflictCount(blocking.length);
          return;
        }
      }
      setBlockedConflictCount(null);
      try {
        // `report` while the override is on, else the server refuses (§6).
        await workspace.commitRoute({
          traces,
          vias,
          legality: allowDrcViolations ? "report" : "refuse",
        });
        dispatchRoute({ kind: "cancel" });
      } catch (err) {
        // A server refusal means the live gate and the server disagreed (a
        // parity bug) or the board changed under the session (a concurrent
        // assistant / MCP edit) — surface its codes instead of swallowing it.
        const rejected = (err as DispatchRejectedError | null)?.dispatchResult;
        if (rejected?.code === "PCB_COPPER_ILLEGAL") {
          setBlockedConflictCount(rejected.violations.length);
          setRouteNotice(
            `Commit rejected by DRC: ${violationCodeList(rejected.violations)}`,
          );
        }
        // Otherwise surfaced via the workspace error toast; the session
        // intentionally survives for adjust-and-retry.
      }
    },
    [allowDrcViolations, legalityContext, workspace],
  );

  /**
   * Compute an auto-finish proposal from the route head to `explicitTarget`
   * (Ctrl/Cmd+Click pad) or the nearest open same-net ratsnest pad (Tab).
   * Pure local search over clearance-inflated obstacles; result is a dimmed
   * preview the user must explicitly accept — never a commit.
   */
  const runAutoFinish = useCallback(
    (explicitTarget?: { padId: string; centerMm: PcbPointMm }): void => {
      if (routeState.kind !== "routing") return;
      const projection = workspace.projection;
      if (!projection || !projectionIndex) return;
      const session = routeState.session;
      const anchors = sessionAnchors(session);
      const sourceNm = anchors[anchors.length - 1]!;
      const sourceMm = {
        x: sourceNm.x / NM_PER_MM,
        y: sourceNm.y / NM_PER_MM,
      };
      const target =
        explicitTarget ??
        (session.netId
          ? nearestRatsnestPad({
              ratsnest: projection.ratsnest,
              netId: session.netId,
              fromMm: cursorMm ?? sourceMm,
              ...(session.startPadId
                ? { excludePadIds: new Set([session.startPadId]) }
                : {}),
            })
          : null);
      if (!target) {
        setAutoFinishNotice("No open target pad on this net");
        return;
      }
      const targetNm = pointMmToNm(target.centerMm);
      if (!legalityContext) return;
      // Broad-phase: copper within the source→target corridor + headroom.
      // This box also bounds how far the A* corridor can grow. Copper beyond
      // it is invisible to the search (the corridor can outgrow the box when
      // edge obstacles extend it), so a proposal can theoretically cross
      // unqueried copper — accepted: the accept path re-runs the full DRC
      // gate before committing, so it fails visible, never silent.
      // The obstacle builder windows the context at halo 0, so the corridor
      // must carry every requirement a pair can resolve to (contract 07 §5).
      const corridorPadMm = Math.max(
        5,
        1 + maxObstacleReachMm + session.widthMm,
      );
      const box = {
        minX: Math.min(sourceMm.x, target.centerMm.x) - corridorPadMm,
        minY: Math.min(sourceMm.y, target.centerMm.y) - corridorPadMm,
        maxX: Math.max(sourceMm.x, target.centerMm.x) + corridorPadMm,
        maxY: Math.max(sourceMm.y, target.centerMm.y) + corridorPadMm,
      };
      const excludePadIds = new Set<string>([target.padId]);
      if (session.startPadId) excludePadIds.add(session.startPadId);
      const obstacles = buildRouteObstacles({
        ctx: legalityContext,
        layer: session.layer,
        netId: session.netId,
        routeWidthMm: session.widthMm,
        excludePadIds,
        withinBounds: box,
        extra: pendingRouteGeometry,
      });
      const result = routeAutoFinish({
        sourceNm,
        targetNm,
        obstacles,
        mode: session.segmentMode,
        posture: session.posture,
        caps: {
          // Keep the grid fine enough for pad-pitch corridors. Sizing only —
          // `maxClearanceBoundMm` bounds every requirement the search could
          // meet, whatever the neighbour's net turns out to be.
          maxStepNm: Math.round(
            (maxClearanceBoundMm + session.widthMm) * NM_PER_MM,
          ),
        },
      });
      if (result.status !== "ok") {
        setAutoFinishProposal(null);
        setAutoFinishNotice(
          result.status === "target-blocked"
            ? "Target pad is boxed in — route manually"
            : "No clean path — route manually",
        );
        return;
      }
      const pathNm = buildPreviewPath(
        [...anchors, ...result.anchorsNm, targetNm],
        session.segmentMode,
        session.posture,
      );
      const [placementId, padNumber] = target.padId.split("|");
      const reference = projection.placements.find(
        (pl) => pl.id === placementId,
      )?.reference;
      setAutoFinishNotice(null);
      setAutoFinishProposal({
        extraAnchorsNm: result.anchorsNm,
        finalAnchorNm: targetNm,
        pathNm,
        targetPadId: target.padId,
        targetName: reference ? `${reference}.${padNumber}` : null,
      });
    },
    [
      cursorMm,
      legalityContext,
      maxClearanceBoundMm,
      maxObstacleReachMm,
      pendingRouteGeometry,
      projectionIndex,
      routeState,
      workspace.projection,
    ],
  );

  /** Accept = finish the whole route through the proposal's target pad. */
  const acceptAutoFinish = useCallback((): void => {
    if (routeState.kind !== "routing" || !autoFinishProposal) return;
    const proposal = autoFinishProposal;
    setAutoFinishProposal(null);
    void finishRoute(
      routeState.session,
      proposal.finalAnchorNm,
      proposal.extraAnchorsNm,
    );
  }, [autoFinishProposal, finishRoute, routeState]);

  // A proposal is anchored at the session's committed anchors — ANY session
  // change (waypoint, via, width, posture, layer, step-back, end) stales it.
  useEffect(() => {
    setAutoFinishProposal(null);
  }, [routeState]);

  // Transient failure notice, auto-dismissed.
  useEffect(() => {
    if (!autoFinishNotice) return;
    const timer = setTimeout(() => setAutoFinishNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [autoFinishNotice]);

  useEffect(() => {
    if (!routeNotice) return;
    const timer = setTimeout(() => setRouteNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [routeNotice]);

  useEffect(() => {
    if (!zoneHoleNotice) return;
    const timer = setTimeout(() => setZoneHoleNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [zoneHoleNotice]);

  // ---- Length-Tune tool (pcb.lengthTuning) ----------------------------

  /** Trace under the cursor on any VISIBLE copper layer, active first —
   * the Tune pick adopts the trace's own layer, so cross-layer clicks work. */
  const hitTraceAnyVisibleLayer = useCallback(
    (cursor: PcbPointMm) => {
      const order = [
        activeCopperLayer,
        ...(["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"] as const).filter(
          (l) => l !== activeCopperLayer,
        ),
      ];
      for (const layer of order) {
        if (!isCopperLayerVisible(visibleLayers, layer)) continue;
        const hit = hitTrace(tracesRef.current, cursor, layer);
        if (hit) return hit;
      }
      return null;
    },
    [activeCopperLayer, visibleLayers],
  );

  const tunedTrace = useMemo(() => {
    if (tuneState.kind !== "tuning" || !workspace.projection) return null;
    return (
      workspace.projection.traces.find(
        (t) => t.id === tuneState.session.traceId,
      ) ?? null
    );
  }, [tuneState, workspace.projection]);

  // Group rule for the tuned trace's net (longest targets exclude that net).
  const tuneGroupTarget = useMemo(() => {
    if (!tunedTrace || tunedTrace.netId === null || !workspace.projection) {
      return null;
    }
    const netId = tunedTrace.netId;
    const group = (workspace.projection.board.lengthMatchGroups ?? []).find(
      (g) => g.netIds.includes(netId),
    );
    if (!group) return null;
    const lengthByNet = new Map<string, number>();
    for (const t of workspace.projection.traces) {
      if (t.netId === null || !group.netIds.includes(t.netId)) continue;
      lengthByNet.set(
        t.netId,
        (lengthByNet.get(t.netId) ?? 0) + routeLengthMm(t.pointsNm),
      );
    }
    const targetMm =
      group.target.kind === "absolute"
        ? group.target.mm
        : Math.max(
            0,
            ...group.netIds
              .filter((n) => n !== netId)
              .map((n) => lengthByNet.get(n) ?? 0),
          );
    if (targetMm <= 0) return null;
    return { name: group.name, targetMm, toleranceMm: group.toleranceMm };
  }, [tunedTrace, workspace.projection]);

  const tuneNetLengths = useMemo(() => {
    if (tuneState.kind !== "tuning" || !tunedTrace || !workspace.projection) {
      return null;
    }
    let otherMm = 0;
    for (const t of workspace.projection.traces) {
      if (t.id === tunedTrace.id) continue;
      if (tunedTrace.netId !== null && t.netId === tunedTrace.netId) {
        otherMm += routeLengthMm(t.pointsNm);
      }
    }
    return {
      otherMm,
      baselineMm: routeLengthMm(tuneState.session.baselinePointsNm),
    };
  }, [tunedTrace, tuneState, workspace.projection]);

  const tuneResolvedTargetMm =
    tuneState.kind === "tuning"
      ? (tuneState.session.targetOverrideMm ??
        tuneGroupTarget?.targetMm ??
        null)
      : null;

  // Serpentine proposal for the current parameters — pure generator over
  // clearance-inflated obstacles (same-net copper transparent; the tuned
  // trace itself excluded).
  const tuneProposal = useMemo(() => {
    if (
      tuneState.kind !== "tuning" ||
      !tunedTrace ||
      !workspace.projection ||
      !projectionIndex ||
      !tuneNetLengths ||
      tuneResolvedTargetMm === null
    ) {
      return null;
    }
    const session = tuneState.session;
    const tuneExcludeTraceIds = new Set([tunedTrace.id]);
    const netTotalMm = tuneNetLengths.otherMm + tuneNetLengths.baselineMm;
    const targetExtraNm = Math.round(
      Math.max(0, tuneResolvedTargetMm - netTotalMm) * NM_PER_MM,
    );
    if (!legalityContext) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of session.baselinePointsNm) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    // Sizing only — the board-wide upper bound, so the query window holds
    // every neighbour that could constrain the meander and the leg floor is
    // never tighter than some rule allows.
    const padMm =
      1 +
      maxObstacleReachMm +
      tunedTrace.widthMm +
      session.amplitudeNm / NM_PER_MM;
    const box = {
      minX: minX / NM_PER_MM - padMm,
      minY: minY / NM_PER_MM - padMm,
      maxX: maxX / NM_PER_MM + padMm,
      maxY: maxY / NM_PER_MM + padMm,
    };
    const obstacles = buildRouteObstacles({
      ctx: legalityContext,
      layer: tunedTrace.layer,
      netId: tunedTrace.netId,
      routeWidthMm: tunedTrace.widthMm,
      withinBounds: box,
      // The tuned trace is the SUBJECT, never its own obstacle. `sameNet`
      // already drops it whenever its net is known; a null-net trace needs the
      // id.
      excludeTraceIds: tuneExcludeTraceIds,
    });
    // Adjacent serpentine legs must not violate clearance to each other.
    const spacingFloorNm = Math.round(
      (tunedTrace.widthMm + maxClearanceBoundMm) * NM_PER_MM,
    );
    return generateMeander({
      baselinePointsNm: session.baselinePointsNm,
      spanStartNm: session.spanStartNm,
      spanEndNm: session.spanEndNm,
      amplitudeNm: session.amplitudeNm,
      spacingNm: Math.max(session.spacingNm, spacingFloorNm),
      mode: tunedTrace.segmentMode,
      targetExtraNm,
      obstacles,
      minAmplitudeNm: Math.round(tunedTrace.widthMm * 2 * NM_PER_MM),
    });
  }, [
    legalityContext,
    maxClearanceBoundMm,
    maxObstacleReachMm,
    projectionIndex,
    tuneNetLengths,
    tuneResolvedTargetMm,
    tunedTrace,
    tuneState,
    workspace.projection,
  ]);

  /** Enter: replace the trace geometry with the proposal (one undo entry). */
  const commitTuneProposal = useCallback((): void => {
    if (
      tuneState.kind !== "tuning" ||
      !tuneProposal ||
      !tunedTrace ||
      tuneProposal.achievedExtraNm <= 0
    ) {
      return;
    }
    // The tune gate (contract 07 §8): the proposal is judged as the SAME trace
    // with new points, so `replaces` drops the board's copy of it at
    // enumeration — the reshape is never judged against its own baseline.
    if (legalityContext) {
      const blocking = blockingViolations(
        legalityContext,
        runLiveDrc({
          ctx: legalityContext,
          pending: {
            traces: [{ ...tunedTrace, pointsNm: tuneProposal.pointsNm }],
            vias: [],
          },
          replaces: [tunedTrace.id],
        }),
      );
      if (!allowDrcViolations && blocking.length > 0) {
        setTuneNotice(
          `Blocked: ${blocking.length} DRC conflict${blocking.length === 1 ? "" : "s"} (${violationCodeList(blocking)})`,
        );
        return;
      }
    }
    setTuneNotice(null);
    void workspace
      .updateTraceGeometry(
        tunedTrace.id,
        tuneProposal.pointsNm,
        allowDrcViolations ? "report" : "refuse",
      )
      .then((result) => {
        if (result && !result.ok && result.code === "PCB_COPPER_ILLEGAL") {
          setTuneNotice(
            `Reshape rejected by DRC: ${violationCodeList(result.violations)}`,
          );
          return;
        }
        dispatchTune({ kind: "cancel" });
      });
  }, [
    allowDrcViolations,
    legalityContext,
    tuneProposal,
    tuneState,
    tunedTrace,
    workspace,
  ]);

  // Sweeping span follows the cursor's projection onto the baseline.
  useEffect(() => {
    if (toolMode !== "tune" || tuneState.kind !== "tuning") return;
    if (!tuneState.session.sweeping || !cursorMm) return;
    dispatchTune({
      kind: "sweep",
      spanEndNm: distanceAlongPolylineNm(
        tuneState.session.baselinePointsNm,
        pointMmToNm(cursorMm),
      ),
    });
  }, [cursorMm, toolMode, tuneState]);

  // Leaving tune mode always drops the session + inline editor + hover.
  useEffect(() => {
    setTuneNotice(null);
  }, [tuneState]);
  useEffect(() => {
    if (toolMode !== "tune") {
      dispatchTune({ kind: "cancel" });
      setTuneTargetInputOpen(false);
      setTuneHoverTraceId(null);
    }
  }, [toolMode]);

  const tuneHudModel = useMemo(() => {
    if (tuneState.kind !== "tuning" || !tunedTrace || !tuneNetLengths) {
      return null;
    }
    const netName = tunedTrace.netId
      ? (workspace.projection?.netNames[tunedTrace.netId] ?? null)
      : null;
    return buildTuneHudModel({
      session: tuneState.session,
      netName,
      group: tuneGroupTarget,
      netOtherMm: tuneNetLengths.otherMm,
      baselineMm: tuneNetLengths.baselineMm,
      proposalExtraMm: (tuneProposal?.achievedExtraNm ?? 0) / NM_PER_MM,
      meanderStatus: tuneProposal?.status ?? null,
    });
  }, [
    tuneGroupTarget,
    tuneNetLengths,
    tuneProposal,
    tunedTrace,
    tuneState,
    workspace.projection,
  ]);

  const sceneTunePreview = useMemo(() => {
    if (!tuneProposal || !tunedTrace || tuneProposal.achievedExtraNm <= 0) {
      return null;
    }
    return {
      pointsNm: tuneProposal.pointsNm,
      layer: tunedTrace.layer,
      widthMm: tunedTrace.widthMm,
    };
  }, [tuneProposal, tunedTrace]);

  // Painted span halo — always visible while tuning, independent of whether
  // a proposal exists (the missing-feedback fix: sweeping is now visible
  // even with no target set or a blocked/at-target generator).
  const sceneTuneSpan = useMemo(() => {
    if (tuneState.kind !== "tuning" || !tunedTrace) return null;
    const span = slicePolylineByArcLengthNm(
      tuneState.session.baselinePointsNm,
      tuneState.session.spanStartNm,
      tuneState.session.spanEndNm,
    );
    if (span.length < 2) return null;
    return {
      pointsNm: span,
      layer: tunedTrace.layer,
      widthMm: tunedTrace.widthMm * 1.6,
    };
  }, [tunedTrace, tuneState]);

  // Tune-idle hover rides the selection channel (TraceLayer emphasis)
  // without touching the real selection state.
  const sceneSelection = useMemo(() => {
    if (
      toolMode === "tune" &&
      tuneHoverTraceId !== null &&
      tuneState.kind !== "tuning"
    ) {
      return { ...emptyPcbSelection(), traceIds: new Set([tuneHoverTraceId]) };
    }
    return selection;
  }, [selection, toolMode, tuneHoverTraceId, tuneState]);

  // ---- Bundle routing (pcb.bundleRouting) ------------------------------

  /** Nearest pad on the named net — the diff-pair partner auto-add. */
  const findNearestPadOnNet = useCallback(
    (netName: string, nearNm: PointNm): BundlePad | null => {
      const projection = workspace.projection;
      if (!projection) return null;
      const netId = Object.entries(projection.netNames).find(
        ([, name]) => name === netName,
      )?.[0];
      if (!netId) return null;
      let best: BundlePad | null = null;
      let bestDistSq = Infinity;
      for (const placement of projection.placements) {
        for (const pad of placementPads(placement)) {
          const key = `${placement.id}|${pad.number}`;
          if (padToNet.get(key) !== netId) continue;
          const centerMm = padWorldPositionMm(placement, pad);
          const dx = centerMm.x * NM_PER_MM - nearNm.x;
          const dy = centerMm.y * NM_PER_MM - nearNm.y;
          const distSq = dx * dx + dy * dy;
          if (
            distSq < bestDistSq ||
            (distSq === bestDistSq && best !== null && key < best.padId)
          ) {
            bestDistSq = distSq;
            best = {
              padId: key,
              netId,
              netName,
              centerNm: pointMmToNm(centerMm),
            };
          }
        }
      }
      return best;
    },
    [padToNet, workspace.projection],
  );

  /**
   * Ghost lanes: centerline = pad centroid → waypoints → snapped cursor;
   * each collected pad gets a monotone lane offset of the centerline plus a
   * short elbow connector from its pad center to the lane start.
   *
   * Drag stability: lanes are NEVER dropped mid-drag. A lane whose offset
   * degenerates for the current cursor (leg shorter than the miter needs)
   * comes back `degraded: true` carrying its last valid geometry — the scene
   * tints it amber. The fan-out frame comes from `fanOutDir` (centroid →
   * first waypoint, frozen once routing), not from the posture-"auto" first
   * render segment, so lanes cannot swap sides as the cursor crosses octants.
   */
  const bundlePreview = useMemo(() => {
    if (toolMode !== "bundle" || bundleState.kind !== "bundling") return null;
    const s = bundleState.session;
    if (s.pads.length < 2) return null;
    const centroid = bundleAnchorNm(s);
    const anchors: PointNm[] = [centroid, ...s.waypointsNm];
    // The widest lane sits (N−1)/2 pitches off-center; a cursor closer than
    // that (+1 pitch margin) to the last anchor cannot host valid miters —
    // hold the lanes at the last stable anchor instead of collapsing them.
    const maxOffsetNm = ((s.pads.length - 1) / 2) * s.pitchNm;
    if (cursorMm) {
      const cursorNm = pointMmToNm(snapPoint(cursorMm));
      const lastAnchor = anchors[anchors.length - 1]!;
      if (!tooCloseNm(lastAnchor, cursorNm, maxOffsetNm + s.pitchNm)) {
        anchors.push(cursorNm);
      }
    }
    if (anchors.length < 2) return null;
    const centerline = buildPreviewPath(anchors, s.segmentMode, "auto");
    if (centerline.length < 2) return null;
    const dirNm = fanOutDir(centroid, s.waypointsNm[0] ?? anchors[1]!);
    const offsets = assignLaneOffsets({
      padPointsNm: s.pads.map((pad) => pad.centerNm),
      dirNm,
      pitchNm: s.pitchNm,
    });
    const lanes = buildBundleLanes({
      centerlineNm: centerline,
      laneOffsetsNm: offsets,
      mode: s.segmentMode,
    });
    const cache = bundleLastGoodRef.current;
    const fullLanes = s.pads.map((pad, i) => {
      const lane = lanes[i]!;
      if (lane.ok && lane.pointsNm.length >= 2) {
        const connector = buildPreviewPath(
          [pad.centerNm, lane.pointsNm[0]!],
          s.segmentMode,
          "auto",
        );
        const pointsNm = dedupeConsecutive([
          ...connector,
          ...lane.pointsNm.slice(1),
        ]);
        cache.set(pad.padId, pointsNm);
        return { pad, pointsNm, degraded: false };
      }
      // Degenerate offset — show the last valid lane; centerline as the
      // cold-start fallback (never the blown-up miter geometry, which spikes).
      return {
        pad,
        pointsNm: cache.get(pad.padId) ?? centerline,
        degraded: true,
      };
    });
    return { lanes: fullLanes, allOk: fullLanes.every((l) => !l.degraded) };
  }, [bundleState, cursorMm, snapPoint, toolMode]);

  /**
   * Enter: gate every lane (vs committed copper AND the other lanes — they
   * are different nets), then commit all lanes in ONE atomic
   * pcb_commit_route. No override toggle in v1 — bundles never commit dirty.
   */
  const finishBundle = useCallback(async (): Promise<void> => {
    if (bundleState.kind !== "bundling" || !workspace.projection) return;
    const s = bundleState.session;
    if (!bundlePreview || bundlePreview.lanes.length < 2) return;
    if (!bundlePreview.allOk) {
      setBundleBlocked(
        "Lane geometry degenerates — reduce pitch or widen the corridor",
      );
      return;
    }
    if (!legalityContext) return;
    // ONE gate over EVERY lane at once (contract 07 §8 site C): the lanes are
    // different nets, and `checkPendingCopper` judges pending × pending, so
    // lane-to-lane pairs come out of the same call as lane-to-board.
    const lanePending = {
      traces: bundlePreview.lanes.map((lane, i) => ({
        id: `pending:bundle:${i}`,
        netId: lane.pad.netId,
        netClassId: s.netClassId,
        layer: s.layer,
        widthMm: s.widthMm,
        pointsNm: lane.pointsNm,
        segmentMode: s.segmentMode,
      })),
      vias: [],
    };
    const blocking = blockingViolations(
      legalityContext,
      runLiveDrc({ ctx: legalityContext, pending: lanePending }),
    );
    if (blocking.length > 0) {
      setBundleBlocked(
        `${blocking.length} DRC conflict${blocking.length === 1 ? "" : "s"} — adjust the route or pitch`,
      );
      return;
    }
    setBundleBlocked(null);
    try {
      // No override in v1 — bundles never commit dirty, so `refuse` always.
      await workspace.commitRoute({
        traces: bundlePreview.lanes.map((lane) => ({
          layer: s.layer,
          pointsNm: lane.pointsNm,
          widthMm: s.widthMm,
          netId: lane.pad.netId,
          netClassId: s.netClassId,
          segmentMode: s.segmentMode,
        })),
        vias: [],
        legality: "refuse",
      });
      dispatchBundle({ kind: "cancel" });
    } catch (err) {
      const rejected = (err as DispatchRejectedError | null)?.dispatchResult;
      if (rejected?.code === "PCB_COPPER_ILLEGAL") {
        setBundleBlocked(
          `Commit rejected by DRC: ${violationCodeList(rejected.violations)}`,
        );
      }
      // Otherwise surfaced via the workspace toast; the session survives.
    }
  }, [bundlePreview, bundleState, legalityContext, workspace]);

  // Session-scoped: leaving bundle mode drops everything; any session change
  // clears a stale block reason; the last-good lane cache dies with the session.
  useEffect(() => {
    if (toolMode !== "bundle") {
      dispatchBundle({ kind: "cancel" });
      setBundleBlocked(null);
    }
  }, [toolMode]);
  useEffect(() => {
    setBundleBlocked(null);
    if (bundleState.kind !== "bundling") bundleLastGoodRef.current.clear();
  }, [bundleState]);

  const bundleHudModel = useMemo<BundleHudModel | null>(() => {
    if (bundleState.kind !== "bundling") return null;
    const s = bundleState.session;
    const netNames = [
      ...new Set(
        s.pads.map((pad) => pad.netName ?? pad.netId ?? "?").filter(Boolean),
      ),
    ];
    const diffPair =
      s.pads.length === 2 &&
      s.pads[0]!.netName !== null &&
      s.pads[1]!.netName !== null &&
      diffPairPartnerName(s.pads[0]!.netName) === s.pads[1]!.netName;
    return {
      padCount: s.pads.length,
      netNames,
      routing: s.waypointsNm.length > 0,
      pitchMm: s.pitchNm / NM_PER_MM,
      diffPair,
    };
  }, [bundleState]);

  // Amber rings over collected pads — the in-scene collection feedback.
  const sceneBundlePads = useMemo(() => {
    if (toolMode !== "bundle" || bundleState.kind !== "bundling") return null;
    return bundleState.session.pads.map((pad) => ({
      id: pad.padId,
      x: pad.centerNm.x / NM_PER_MM,
      y: pad.centerNm.y / NM_PER_MM,
    }));
  }, [bundleState, toolMode]);

  const sceneBundlePreview = useMemo(() => {
    if (!bundlePreview || bundleState.kind !== "bundling") return null;
    const s = bundleState.session;
    return {
      layer: s.layer,
      widthMm: s.widthMm,
      okPolylinesNm: bundlePreview.lanes
        .filter((lane) => !lane.degraded)
        .map((lane) => lane.pointsNm),
      degradedPolylinesNm: bundlePreview.lanes
        .filter((lane) => lane.degraded)
        .map((lane) => lane.pointsNm),
    };
  }, [bundlePreview, bundleState]);

  /**
   * Smart Via: flush segments-so-far + the via into the session's boundary
   * log and rebase onto the target layer. Purely local — no backend command,
   * no refresh; the whole session commits atomically at finish.
   */
  const placeSmartVia = useCallback(
    (
      session: RouteSession,
      cursorMm: PcbPointMm,
      targetLayer: PcbCopperLayerId,
    ): boolean => {
      const snapped = snapPoint(cursorMm);
      const viaCenterNm = pointMmToNm(snapped);
      // Via guard (contract 07 §8): the FULL refuse set on the via the session
      // would commit — keepouts, clearance to copper on any layer it spans,
      // hole spacing, the board edge and its own minimums — not the
      // keepout-only predicate this replaced. The centre tested is the one the
      // session COMMITS (nm-quantised), not the mm double before it.
      const projection = workspace.projection;
      if (projection && legalityContext) {
        const netClass = projection.board.netClasses.find(
          (nc) => nc.id === session.netClassId,
        );
        const candidate: PcbVia = {
          id: "pending:via:candidate",
          netId: session.netId,
          netClassId: session.netClassId,
          centerMm: {
            x: viaCenterNm.x / NM_PER_MM,
            y: viaCenterNm.y / NM_PER_MM,
          },
          diameterMm:
            session.viaDiameterMmOverride ?? netClass?.viaDiameterMm ?? 0.8,
          drillMm: session.viaDrillMmOverride ?? netClass?.viaDrillMm ?? 0.4,
          fromLayer: "F.Cu",
          toLayer: "B.Cu",
          viaType: "through",
          protection: netClass?.defaultViaProtection ?? "tented",
          provenance: "route",
        };
        const blocking = blockingViolations(
          legalityContext,
          runLiveDrc({
            ctx: legalityContext,
            pending: { traces: [], vias: [candidate] },
          }),
        );
        if (blocking.length > 0) {
          setRouteNotice(`Via blocked: ${violationCodeList(blocking)}`);
          return false;
        }
      }
      const path = buildPreviewPath(
        [...sessionAnchors(session), viaCenterNm],
        session.segmentMode,
        session.posture,
      );
      dispatchRoute({
        kind: "rebase-layer",
        anchorNm: viaCenterNm,
        layer: targetLayer,
        runPointsNm: path.length >= 2 ? path : [],
        via: {
          centerNm: viaCenterNm,
          ...(session.viaDiameterMmOverride !== undefined
            ? { diameterMmOverride: session.viaDiameterMmOverride }
            : {}),
          ...(session.viaDrillMmOverride !== undefined
            ? { drillMmOverride: session.viaDrillMmOverride }
            : {}),
        },
      });
      return true;
    },
    [legalityContext, snapPoint, workspace.projection],
  );

  // Width preset list (from board settings, fallback to net-class default).
  const tracePresets = useMemo<number[]>(() => {
    const fromBoard = workspace.projection?.board.tracePresets ?? [];
    if (fromBoard.length > 0) return fromBoard;
    return defaultNetClass ? [defaultNetClass.traceWidthMm] : [0.25];
  }, [defaultNetClass, workspace.projection?.board.tracePresets]);

  /**
   * Set the active copper layer without changing the board view orientation.
   * During routing this also places a smart via at the cursor and rebases the
   * route session onto the target layer. View flip is a separate user gesture
   * (Flip view button / Shift+F) — never coupled with layer switches.
   */
  const setActiveCopperLayer = useCallback(
    async (targetLayer: PcbCopperLayerId, cursorOverrideMm?: PcbPointMm) => {
      if (routeState.kind === "routing") {
        const session = routeState.session;
        if (session.layer === targetLayer) {
          if (activeCopperLayer !== targetLayer) {
            await workspace.setActiveLayer(targetLayer);
          }
          return;
        }
        const viaCursor = cursorOverrideMm ?? cursorMmRef.current;
        if (!viaCursor) return;
        // A refused via (keepout) leaves the session on its current layer.
        if (!placeSmartVia(session, viaCursor, targetLayer)) return;
        await workspace.setActiveLayer(targetLayer);
        return;
      }

      if (activeCopperLayer !== targetLayer) {
        await workspace.setActiveLayer(targetLayer);
      }
    },
    [activeCopperLayer, placeSmartVia, routeState, workspace],
  );

  // Flip the board view and sync the active copper layer to the side now
  // facing the user (bottom view → B.Cu active, top view → F.Cu active).
  // This is a one-way coupling: changing layer alone never flips the view.
  // While routing the active layer is left alone so a smart via isn't dropped
  /**
   * Apply a single disambiguation-popup pick: replace selection with the
   * chosen primitive. Plain selection semantics (no shift-merge from the
   * popup) — the popup is for "I meant THAT one of the overlapping items",
   * not for set arithmetic.
   */
  const applyDisambigPick = useCallback((candidate: PcbHitCandidate) => {
    switch (candidate.kind) {
      case "trace":
        setSelection({
          placementIds: new Set(),
          traceIds: new Set([candidate.hit.trace.id]),
          viaIds: new Set(),
        });
        return;
      case "via":
        setSelection({
          placementIds: new Set(),
          traceIds: new Set(),
          viaIds: new Set([candidate.via.id]),
        });
        return;
      case "placement":
        setSelection({
          placementIds: new Set([candidate.placement.id]),
          traceIds: new Set(),
          viaIds: new Set(),
        });
        return;
      case "pad":
        // Pads aren't selectable on their own; selecting the parent
        // placement is the next-best UX.
        setSelection({
          placementIds: new Set([candidate.hit.placementId]),
          traceIds: new Set(),
          viaIds: new Set(),
        });
        return;
      case "zone":
        setSelection({
          ...emptyPcbSelection(),
          zoneIds: new Set([candidate.zone.id]),
        });
        return;
      case "keepout":
        setSelection({
          ...emptyPcbSelection(),
          keepoutIds: new Set([candidate.keepout.id]),
        });
        return;
    }
  }, []);

  // mid-session; the route session continues on its own layer until the user
  // explicitly switches (V / T / B).
  const handleToggleViewSide = useCallback(() => {
    const nextSide = workspace.viewSide === "bottom" ? "top" : "bottom";
    workspace.setViewSide(nextSide);
    if (routeState.kind === "routing") return;
    const targetLayer: PcbCopperLayerId =
      nextSide === "bottom" ? "B.Cu" : "F.Cu";
    if (activeCopperLayer !== targetLayer) {
      void workspace.setActiveLayer(targetLayer);
    }
  }, [activeCopperLayer, routeState, workspace]);

  // Via-size presets surfaced in the toolbar dropdowns. Conservative starter
  // set covering common JLCPCB / PCBWay capabilities; user can type a custom.
  const VIA_DIAMETER_PRESETS_MM: ReadonlyArray<number> = [0.45, 0.6, 0.8, 1.0];
  const VIA_DRILL_PRESETS_MM: ReadonlyArray<number> = [0.2, 0.25, 0.3, 0.4];

  /**
   * Pick the next preset in the cycle (wraps). When the current width is not
   * in the preset list (e.g. user typed a custom value), `direction === +1`
   * picks the smallest preset above it; `-1` picks the largest below it.
   */
  const cycleWidth = useCallback(
    (currentMm: number, direction: 1 | -1): number => {
      if (tracePresets.length === 0) return currentMm;
      const sorted = [...tracePresets].sort((a, b) => a - b);
      const exactIdx = sorted.findIndex((w) => Math.abs(w - currentMm) < 1e-6);
      if (exactIdx >= 0) {
        const next = (exactIdx + direction + sorted.length) % sorted.length;
        return sorted[next]!;
      }
      if (direction === 1) {
        return sorted.find((w) => w > currentMm) ?? sorted[0]!;
      }
      return (
        [...sorted].reverse().find((w) => w < currentMm) ??
        sorted[sorted.length - 1]!
      );
    },
    [tracePresets],
  );

  /**
   * Apply a new width to the active route session. If we're already routing
   * with committed segments behind us, split the trace: commit segments-so-far
   * at the old width, then rebase the session at the join point with the new
   * width. KiCad/Altium "future segments only" semantics.
   */
  const setSessionWidth = useCallback(
    (widthMm: number, source: RouteWidthSource): void => {
      if (routeState.kind !== "routing") return;
      const session = routeState.session;
      if (Math.abs(session.widthMm - widthMm) < 1e-9) return;
      if (session.waypointsNm.length === 0) {
        dispatchRoute({ kind: "set-width", widthMm, source });
        return;
      }
      // Width split: flush segments-so-far at the OLD width into the boundary
      // log (purely local), rebase at the last waypoint with the new width.
      const lastWaypoint = session.waypointsNm[session.waypointsNm.length - 1]!;
      dispatchRoute({
        kind: "rebase",
        anchorNm: lastWaypoint,
        widthMm,
        widthSource: source,
        runPointsNm: buildPreviewPath(
          sessionAnchors(session),
          session.segmentMode,
          session.posture,
        ),
      });
    },
    [routeState],
  );

  /** Re-resolve the session width from its net class (HUD badge reset). */
  const resetSessionWidthToNetClass = useCallback(() => {
    if (routeState.kind !== "routing") return;
    const board = workspace.projection?.board;
    const sessionClass = board?.netClasses.find(
      (nc) => nc.id === routeState.session.netClassId,
    );
    if (!sessionClass) return;
    void setSessionWidth(sessionClass.traceWidthMm, "netclass");
  }, [routeState, setSessionWidth, workspace.projection?.board]);

  const splitAndRerouteTrace = useCallback(
    async (traceHit: TraceHit) => {
      const trace = traceHit.trace;
      const splitPointNm = pointMmToNm(traceHit.closestMm);
      const keepPointsNm = keepTracePrefixForReroute(
        trace.pointsNm,
        traceHit.segmentIndex,
        splitPointNm,
      );

      setSelection(emptyPcbSelection());
      setToolMode("route");
      dispatchRoute({ kind: "cancel" });

      if (keepPointsNm.length >= 2) {
        await workspace.updateTraceGeometry(trace.id, keepPointsNm);
      } else {
        await workspace.deleteTrace(trace.id);
      }

      dispatchRoute({
        kind: "start",
        anchorNm: splitPointNm,
        layer: trace.layer,
        segmentMode: trace.segmentMode,
        netId: trace.netId,
        netClassId: trace.netClassId,
        widthMm: trace.widthMm,
      });
    },
    [workspace],
  );

  const handler = useMemo<InteractionHandler>(() => {
    return {
      onPointerDown(event) {
        if (event.button !== 0) return;
        const cursor = eventToMm(event);

        if (props.commentMode && props.onCreateComment) {
          const point = snapPoint(cursor);
          const pointNm = pointMmToNm(point);
          const pad = hitPad(visiblePlacements, cursor);
          const trace = hitTrace(tracesRef.current, cursor, activeCopperLayer);
          const via = hitVia(viasRef.current, cursor);
          const placement = hitPlacement(visiblePlacements, cursor);
          const r = wrapperRef.current?.getBoundingClientRect();
          setCommentDraft({
            anchor: {
              surface: "pcb",
              pointNm,
              entity: pad
                ? { kind: "pad", id: pad.placementId, subId: pad.padNumber }
                : trace
                  ? { kind: "trace", id: trace.trace.id }
                  : via
                    ? { kind: "via", id: via.id }
                    : placement
                      ? { kind: "placement", id: placement.id }
                      : undefined,
              layerId: activeCopperLayer,
              sourceRevision: workspace.projection?.revision,
            },
            screen: {
              x: event.screenPoint.x - (r?.left ?? 0),
              y: event.screenPoint.y - (r?.top ?? 0),
            },
          });
          return;
        }

        if (toolMode === "measure") {
          dispatchMeasure({
            kind: "click",
            anchor: resolveMeasureAnchor(cursor),
          });
          setSelection(emptyPcbSelection());
          setDragSession(null);
          setFreePrimitiveDragSession(null);
          return;
        }

        // Bundle mode — pad clicks collect (with diff-pair partner assist);
        // free-space clicks with ≥2 pads route the shared centerline.
        if (toolMode === "bundle") {
          if (!defaultNetClass) return;
          const anchor = resolveAnchor(cursor);
          const collecting =
            bundleState.kind === "idle" ||
            bundleState.session.waypointsNm.length === 0;
          if (anchor.onPad && anchor.padId !== undefined && collecting) {
            // SMD pads live on one copper side; lanes route on the active
            // layer — reject cross-side pads instead of silently mis-bundling
            // (through-hole pads span the stack: layer === null passes).
            if (
              anchor.layer !== null &&
              anchor.layer !== undefined &&
              anchor.layer !== activeCopperLayer
            ) {
              setBundleBlocked(
                `Pad is on ${anchor.layer} — switch the active layer to bundle it`,
              );
              return;
            }
            const netName = anchor.netId
              ? (workspace.projection?.netNames[anchor.netId] ?? null)
              : null;
            const clearanceMm = Math.max(
              defaultNetClass.clearanceMm,
              workspace.projection?.board.designRules.clearance
                .traceToTraceMm ?? 0,
            );
            const toggleDefaults = {
              layer: activeCopperLayer,
              segmentMode: "manhattan-45" as const,
              widthMm: defaultNetClass.traceWidthMm,
              netClassId: defaultNetClass.id,
              // +1 µm so lanes at default pitch clear the strict gate even
              // with the ≤1 nm diagonal-offset quantization.
              pitchNm: Math.round(
                (defaultNetClass.traceWidthMm + clearanceMm + 0.001) *
                  NM_PER_MM,
              ),
            };
            const pad: BundlePad = {
              padId: anchor.padId,
              netId: anchor.netId,
              netName,
              centerNm: pointMmToNm(anchor.pointMm),
            };
            const alreadyIn =
              bundleState.kind === "bundling" &&
              bundleState.session.pads.some((p) => p.padId === pad.padId);
            dispatchBundle({ kind: "toggle-pad", pad, ...toggleDefaults });
            if (!alreadyIn && netName) {
              const partnerName = diffPairPartnerName(netName);
              const partner = partnerName
                ? findNearestPadOnNet(partnerName, pad.centerNm)
                : null;
              const partnerCollected =
                partner !== null &&
                bundleState.kind === "bundling" &&
                bundleState.session.pads.some(
                  (p) => p.padId === partner.padId,
                );
              if (partner && !partnerCollected && partner.padId !== pad.padId) {
                dispatchBundle({
                  kind: "toggle-pad",
                  pad: partner,
                  ...toggleDefaults,
                });
                if (defaultNetClass.diffPairGapMm !== undefined) {
                  dispatchBundle({
                    kind: "set-pitch",
                    pitchNm: Math.round(
                      (defaultNetClass.traceWidthMm +
                        defaultNetClass.diffPairGapMm) *
                        NM_PER_MM,
                    ),
                  });
                }
              }
            }
            return;
          }
          if (
            bundleState.kind === "bundling" &&
            bundleState.session.pads.length >= 2
          ) {
            dispatchBundle({
              kind: "commit-waypoint",
              pointNm: pointMmToNm(snapPoint(cursor)),
            });
          }
          return;
        }

        // Tune mode — click a routed trace to start (span follows the
        // cursor); a second click freezes the span. Enter commits, Esc exits.
        if (toolMode === "tune") {
          if (tuneState.kind === "tuning" && tuneState.session.sweeping) {
            dispatchTune({ kind: "freeze-span" });
            return;
          }
          const hit = hitTraceAnyVisibleLayer(cursor);
          if (hit) {
            dispatchTune({
              kind: "start",
              traceId: hit.trace.id,
              baselinePointsNm: hit.trace.pointsNm,
              spanStartNm: distanceAlongPolylineNm(
                hit.trace.pointsNm,
                pointMmToNm(cursor),
              ),
            });
          }
          return;
        }

        // Hole mode — single click drops a free mounting hole at the snapped
        // cursor and returns to select mode.
        if (toolMode === "hole") {
          const point = snapPoint(cursor);
          void workspace
            .addFreeHole(point, DEFAULT_FREE_HOLE_DRILL_MM)
            .catch(() => undefined);
          setToolMode("select");
          return;
        }

        // Pad mode — click drops a free SMD pad on the current active copper
        // layer at the snapped cursor.
        if (toolMode === "pad") {
          const point = snapPoint(cursor);
          void workspace
            .addFreePad(point, { layer: activeCopperLayer })
            .catch(() => undefined);
          setToolMode("select");
          return;
        }

        // Text mode — prompt for label and drop it on the active overlay layer.
        if (toolMode === "text") {
          const point = snapPoint(cursor);
          const label = window.prompt("Overlay text:", "");
          if (label && label.length > 0) {
            const textLayer = mirrorActive ? "B.SilkS" : "F.SilkS";
            void workspace
              .addOverlayText(point, label, { layer: textLayer })
              .catch(() => undefined);
          }
          setToolMode("select");
          return;
        }

        // Sketch modes (Board Shape / Zone / Keepout) — each click drops a
        // polygon vertex (Shift locks the edge to 45°). Clicking near the start
        // vertex (>= 3 placed) or pressing Enter closes the ring.
        const sketchTarget = sketchTargetFor(toolMode);
        if (sketchTarget !== null) {
          const snapped = snapPoint(cursor);
          const sketch = sketchStateRef.current;
          if (sketch.kind !== "drawing") {
            dispatchSketch({
              kind: "start",
              pointMm: snapped,
              target: sketchTarget,
              ...(sketchTarget === "zoneHole" && zoneHoleParentRef.current
                ? { parentZoneId: zoneHoleParentRef.current.id }
                : {}),
            });
            return;
          }
          const verts = sketch.session.verticesMm;
          const last = verts[verts.length - 1]!;
          const entry = sketchEntryRef.current;
          const { point } = resolveSketchTarget(last, snapped, {
            shiftLock: shiftHeldRef.current,
            ...(entry ? parsedEntry(entry) : {}),
            others: verts.slice(0, -1),
            tolMm: SNAP_THRESHOLD_PX / drcZoomRef.current,
          });
          const first = verts[0]!;
          if (
            canCloseSketch(sketch) &&
            Math.hypot(point.x - first.x, point.y - first.y) <=
              SKETCH_CLOSE_THRESHOLD_MM
          ) {
            finishSketchRef.current(sketch.session);
            setSketchEntry(null);
            return;
          }
          dispatchSketch({ kind: "commit-vertex", pointMm: point });
          setSketchEntry(null);
          return;
        }

        // Route mode takes the click first.
        if (toolMode === "route") {
          if (!defaultNetClass) return;
          let anchor = resolveRouteAnchor(cursor);
          // Same-net copper finish: when the click is neither on a pad nor a
          // snapped copper object, look for a same-layer trace under the
          // cursor so a route can terminate in a T-junction on its own net.
          if (
            routeState.kind === "routing" &&
            !anchor.onPad &&
            anchor.netId === null
          ) {
            const traceHit = hitTrace(
              [...tracesRef.current, ...pendingRouteGeometry.traces],
              cursor,
              routeState.session.layer,
            );
            if (traceHit && traceHit.trace.netId !== null) {
              anchor = {
                pointMm: traceHit.closestMm,
                netId: traceHit.trace.netId,
                onPad: false,
              };
            }
          }
          // Any manual route click implicitly dismisses a pending proposal
          // (except the auto-finish modifier click, which replaces it).
          if (autoFinishProposal) setAutoFinishProposal(null);
          const nativeEvt = event.nativeEvent?.nativeEvent;
          const action = resolveRouteClickAction({
            routing: routeState.kind === "routing",
            anchor: { onPad: anchor.onPad, netId: anchor.netId },
            sessionNetId:
              routeState.kind === "routing" ? routeState.session.netId : null,
            clickCount: nativeEvt?.detail ?? 1,
            autoFinishModifier:
              autoFinishEnabled &&
              Boolean(nativeEvt && (nativeEvt.ctrlKey || nativeEvt.metaKey)),
          });
          if (action === "start" && routeState.kind === "idle") {
            // An explicit per-net assignment overrides the default class (and
            // its trace width) for the new route session.
            const board = workspace.projection?.board;
            const assignedId = anchor.netId
              ? board?.perNetClassAssignments?.[anchor.netId]
              : undefined;
            const sessionClass =
              (assignedId &&
                board?.netClasses.find((nc) => nc.id === assignedId)) ||
              defaultNetClass;
            // Pick the route layer. When a layer is focused (locked) it always
            // wins; otherwise (Auto) follow the clicked pad/object's layer,
            // falling back to the viewed side for through-hole / dangling
            // anchors.
            const startLayer = pickRouteStartLayer({
              focusedLayer,
              anchorLayer: anchor.layer,
              viewSide: workspace.viewSide,
            });
            // Start a new route session at the resolved anchor.
            dispatchRoute({
              kind: "start",
              anchorNm: pointMmToNm(anchor.pointMm),
              layer: startLayer,
              segmentMode: "manhattan-45",
              netId: anchor.netId,
              netClassId: sessionClass.id,
              widthMm: sessionClass.traceWidthMm,
              ...(anchor.padId !== undefined
                ? { startPadId: anchor.padId }
                : {}),
            });
            // In Auto mode keep the persisted active layer in sync with what we
            // just routed on, without engaging focus (stays in Auto).
            if (focusedLayer === null && startLayer !== activeCopperLayer) {
              void workspace.setActiveLayer(startLayer);
            }
            return;
          }
          // Routing — same-net pad click and double-click finish (dangling
          // ends allowed); anything else adds an intermediate waypoint.
          if (routeState.kind !== "routing") return;
          const session = routeState.session;
          // Ghost === committed: an active walkaround detour lands as real
          // waypoints ahead of the clicked point / finish anchor.
          const detourAnchorsNm = walkDetourRef.current ?? [];
          if (action === "finish") {
            void finishRoute(
              session,
              pointMmToNm(anchor.pointMm),
              detourAnchorsNm,
            );
            return;
          }
          if (action === "auto-finish") {
            if (anchor.padId !== undefined) {
              runAutoFinish({ padId: anchor.padId, centerMm: anchor.pointMm });
            }
            return;
          }
          if (detourAnchorsNm.length > 0) {
            dispatchRoute({
              kind: "commit-waypoints",
              pointsNm: [...detourAnchorsNm, pointMmToNm(anchor.pointMm)],
            });
            return;
          }
          dispatchRoute({
            kind: "commit-waypoint",
            pointNm: pointMmToNm(anchor.pointMm),
          });
          return;
        }

        // Board editing (behind the Board-dimensions toggle). Editable outlines
        // (polygon / contour) get direct vertex/edge manipulation — this also
        // avoids the arc-corrupting non-uniform bbox scale. Parametric outlines
        // (rect / roundrect / circle) get the bbox resize grips.
        const outline = workspace.projection?.board.outline;
        if (boardDimModeRef.current && outline && isEditableOutline(outline)) {
          const vIndex = hitOutlineVertex(
            outline,
            cursor,
            BOARD_HANDLE_TOLERANCE_MM,
          );
          if (vIndex !== null) {
            setSelection(emptyPcbSelection());
            setVertexDragSession({
              vIndex,
              initial: outline,
              current: outline,
              moved: false,
            });
            return;
          }
          const edge = hitOutlineEdge(outline, cursor, BOARD_HANDLE_TOLERANCE_MM);
          if (edge) {
            const inserted = insertVertexAtEdge(
              outline,
              edge.edgeIndex,
              snapPoint(edge.pointMm),
            );
            setCommittedOutlineOverride(inserted);
            void workspace
              .updateBoardOutline(inserted)
              .catch(() => undefined)
              .finally(() => setCommittedOutlineOverride(null));
            return;
          }
        }
        if (boardDimModeRef.current && outline && !isEditableOutline(outline)) {
          const handle = hitBoardHandle(
            outline,
            cursor,
            BOARD_HANDLE_TOLERANCE_MM,
          );
          if (handle) {
            const anchor = handlePointMm(outline, handle);
            setSelection(emptyPcbSelection());
            setBoardResizeSession({
              handle,
              initialRect: outline,
              currentRect: outline,
              pointerOffsetMm: {
                x: anchor.x - cursor.x,
                y: anchor.y - cursor.y,
              },
              moved: false,
            });
            return;
          }
        }

        // Alt+click — open the disambiguation popup at the cursor with every
        // primitive under the pointer (spec §4.4 / research §4.4). Plain
        // click still uses the first-match-wins flow below.
        if (event.modifiers.alt) {
          const candidates = hitAll({
            placements: visiblePlacements,
            traces: tracesRef.current,
            vias: viasRef.current,
            zones: workspace.projection?.zones,
            keepouts: workspace.projection?.keepouts,
            cursorMm: cursor,
            activeLayer: activeCopperLayer,
          });
          if (candidates.length > 0) {
            const clientX =
              cursorClientPx?.x ?? event.nativeEvent?.nativeEvent.clientX ?? 0;
            const clientY =
              cursorClientPx?.y ?? event.nativeEvent?.nativeEvent.clientY ?? 0;
            setDisambigPopup((prev) => {
              // Repeat Alt+click on the SAME stack → cycle to next candidate.
              if (
                prev &&
                prev.candidates.length === candidates.length &&
                prev.screenX === clientX &&
                prev.screenY === clientY
              ) {
                const nextIndex = (prev.activeIndex + 1) % candidates.length;
                applyDisambigPick(candidates[nextIndex]!);
                return {
                  ...prev,
                  candidates,
                  activeIndex: nextIndex,
                };
              }
              applyDisambigPick(candidates[0]!);
              return {
                candidates,
                activeIndex: 0,
                screenX: clientX,
                screenY: clientY,
              };
            });
            return;
          }
        }

        // DRC violation markers take click priority over the copper beneath:
        // clicking one selects that violation (syncing the DRC dock/list) and
        // leaves the existing part/trace selection untouched.
        {
          const tolMm = DRC_HIT_PX / 2 / drcZoomRef.current;
          const drcHit = hitDrcMarker(drcMarkersRef.current, cursor, tolMm);
          if (drcHit) {
            useDrcStore.getState().select(drcHit.id);
            return;
          }
        }

        // Area vertex grip — a grip on the single selected polygon zone /
        // keepout wins over the copper underneath it, or it would be
        // unreachable over a pour (contract §12.3 vertex editing).
        if (areaInteractions.tryGrabVertex(cursor)) {
          setCommittedDragOverride(null);
          setDragSession(null);
          setFreePrimitiveDragSession(null);
          return;
        }

        // Select mode: click trace/via/freeHole/freePad/overlayText first, then placement.
        const shift = event.modifiers.shift;
        const current = selectionRef.current;
        const sf = selectionFilterRef.current;
        const traceHit =
          sf.traces && isCopperLayerVisible(visibleLayers, activeCopperLayer)
            ? hitTrace(tracesRef.current, cursor, activeCopperLayer)
            : null;
        if (traceHit) {
          setCommittedDragOverride(null);
          setDragSession(null);
          setSelection(
            shift
              ? toggleTrace(current, traceHit.trace.id)
              : {
                  placementIds: new Set(),
                  traceIds: new Set([traceHit.trace.id]),
                  viaIds: new Set(),
                },
          );
          return;
        }
        const viaHit =
          sf.vias && viasVisible ? hitVia(viasRef.current, cursor) : null;
        if (viaHit) {
          setCommittedDragOverride(null);
          setDragSession(null);
          setSelection(
            shift
              ? toggleVia(current, viaHit.id)
              : {
                  placementIds: new Set(),
                  traceIds: new Set(),
                  viaIds: new Set([viaHit.id]),
                },
          );
          return;
        }
        const freeHoleHit = hitFreeHole(freeHolesRef.current, cursor);
        if (freeHoleHit) {
          setCommittedDragOverride(null);
          setDragSession(null);
          setSelection(
            shift
              ? toggleFreeHole(current, freeHoleHit.id)
              : {
                  placementIds: new Set(),
                  traceIds: new Set(),
                  viaIds: new Set(),
                  freeHoleIds: new Set([freeHoleHit.id]),
                  freePadIds: new Set(),
                  overlayTextIds: new Set(),
                },
          );
          if (!shift) {
            setFreePrimitiveDragSession({
              kind: "freeHole",
              id: freeHoleHit.id,
              pointerOffsetMm: {
                x: cursor.x - freeHoleHit.centerMm.x,
                y: cursor.y - freeHoleHit.centerMm.y,
              },
              initialPositionMm: { ...freeHoleHit.centerMm },
              currentPositionMm: { ...freeHoleHit.centerMm },
              moved: false,
            });
          } else {
            setFreePrimitiveDragSession(null);
          }
          return;
        }
        const freePadHit = hitFreePad(freePadsRef.current, cursor);
        if (freePadHit) {
          setCommittedDragOverride(null);
          setDragSession(null);
          setSelection(
            shift
              ? toggleFreePad(current, freePadHit.id)
              : {
                  placementIds: new Set(),
                  traceIds: new Set(),
                  viaIds: new Set(),
                  freeHoleIds: new Set(),
                  freePadIds: new Set([freePadHit.id]),
                  overlayTextIds: new Set(),
                },
          );
          if (!shift) {
            setFreePrimitiveDragSession({
              kind: "freePad",
              id: freePadHit.id,
              pointerOffsetMm: {
                x: cursor.x - freePadHit.centerMm.x,
                y: cursor.y - freePadHit.centerMm.y,
              },
              initialPositionMm: { ...freePadHit.centerMm },
              currentPositionMm: { ...freePadHit.centerMm },
              moved: false,
            });
          } else {
            setFreePrimitiveDragSession(null);
          }
          return;
        }
        const overlayTextHit = hitOverlayText(overlayTextsRef.current, cursor);
        if (overlayTextHit) {
          setCommittedDragOverride(null);
          setDragSession(null);
          setSelection(
            shift
              ? toggleOverlayText(current, overlayTextHit.id)
              : {
                  placementIds: new Set(),
                  traceIds: new Set(),
                  viaIds: new Set(),
                  freeHoleIds: new Set(),
                  freePadIds: new Set(),
                  overlayTextIds: new Set([overlayTextHit.id]),
                },
          );
          if (!shift) {
            setFreePrimitiveDragSession({
              kind: "overlayText",
              id: overlayTextHit.id,
              pointerOffsetMm: {
                x: cursor.x - overlayTextHit.positionMm.x,
                y: cursor.y - overlayTextHit.positionMm.y,
              },
              initialPositionMm: { ...overlayTextHit.positionMm },
              currentPositionMm: { ...overlayTextHit.positionMm },
              moved: false,
            });
          } else {
            setFreePrimitiveDragSession(null);
          }
          return;
        }
        const hit = sf.placements
          ? hitPlacement(visiblePlacements, cursor)
          : null;
        if (hit) {
          setCommittedDragOverride(null);
          if (shift) {
            // Shift-click toggles placement membership; no drag.
            setDragSession(null);
            setSelection(togglePlacement(current, hit.id));
            return;
          }
          // Decide drag set: if hit is already part of a multi-selection,
          // drag the whole group; otherwise replace selection with hit.
          const inGroup =
            current.placementIds.has(hit.id) && current.placementIds.size > 1;
          const groupIds = inGroup
            ? new Set(current.placementIds)
            : new Set([hit.id]);
          if (!inGroup) {
            setSelection({
              placementIds: groupIds,
              traceIds: new Set(),
              viaIds: new Set(),
            });
          }
          const initial = new Map<string, PcbPointMm>();
          for (const p of effectivePlacementsRef.current) {
            if (groupIds.has(p.id)) initial.set(p.id, { ...p.positionMm });
          }
          setDragSession({
            primaryPlacementId: hit.id,
            pointerOffsetMm: {
              x: cursor.x - hit.positionMm.x,
              y: cursor.y - hit.positionMm.y,
            },
            initialPrimaryMm: { ...hit.positionMm },
            currentPrimaryMm: { ...hit.positionMm },
            initialPositionsByPlacementId: initial,
            moved: false,
          });
          // Build the alignment index ONCE over the non-dragged visible
          // placements; each pointer move reuses it (Phase 1 guides).
          if (alignmentGuidesEnabledRef.current) {
            const bo = workspace.projection?.board.outline;
            alignmentIndexRef.current = buildAlignmentIndex({
              placements: effectivePlacementsRef.current,
              excludeIds: groupIds,
              visibleLayers,
              boardBoundsMm: bo
                ? {
                    minX: bo.centerMm.x - bo.widthMm / 2,
                    maxX: bo.centerMm.x + bo.widthMm / 2,
                    minY: bo.centerMm.y - bo.heightMm / 2,
                    maxY: bo.centerMm.y + bo.heightMm / 2,
                  }
                : null,
            });
            draggedInitialBBoxRef.current = unionBBox(
              effectivePlacementsRef.current.filter((p) => groupIds.has(p.id)),
            );
          } else {
            alignmentIndexRef.current = null;
            draggedInitialBBoxRef.current = null;
          }
          return;
        }
        // Polygon zones / keepouts — edge proximity only, so a marquee can
        // still start anywhere inside a pour (contract §12.3).
        const areaSelection = areaInteractions.trySelect(cursor, shift, current);
        if (areaSelection) {
          setCommittedDragOverride(null);
          setDragSession(null);
          setFreePrimitiveDragSession(null);
          setSelection(areaSelection);
          return;
        }
        // Empty space → start marquee (no drag).
        setCommittedDragOverride(null);
        setDragSession(null);
        marquee.beginMarquee(cursor, shift);
      },
      onPointerMove(event) {
        const cursor = eventToMm(event);
        setCursorMm(cursor);
        setCursorClientPx({ x: event.screenPoint.x, y: event.screenPoint.y });
        setMeasureShowDeltas(event.modifiers.shift);

        // Board resize drag in flight — move the grabbed edge(s), opposite edge
        // fixed. Suppresses all hover/selection feedback while resizing.
        if (boardResizeSessionRef.current) {
          setBoardResizeSession((prev) => {
            if (!prev) return prev;
            const anchored = {
              x: cursor.x + prev.pointerOffsetMm.x,
              y: cursor.y + prev.pointerOffsetMm.y,
            };
            const next = applyHandleDrag(
              prev.initialRect,
              prev.handle,
              anchored,
              {
                snap,
              },
            );
            if (
              next.widthMm === prev.currentRect.widthMm &&
              next.heightMm === prev.currentRect.heightMm &&
              next.centerMm.x === prev.currentRect.centerMm.x &&
              next.centerMm.y === prev.currentRect.centerMm.y
            ) {
              return prev;
            }
            // Live two-way sync with the side panel inputs.
            setWidthText(String(roundDimMm(next.widthMm)));
            setHeightText(String(roundDimMm(next.heightMm)));
            return { ...prev, currentRect: next, moved: true };
          });
          return;
        }

        // Area vertex drag in flight — reshape the ring live.
        if (areaInteractions.handlePointerMove(cursor)) return;

        // Vertex drag in flight — reshape the outline live to the snapped cursor.
        if (vertexDragSessionRef.current) {
          const snapped = snapPoint(cursor);
          setVertexDragSession((prev) =>
            prev
              ? {
                  ...prev,
                  current: moveVertex(prev.initial, prev.vIndex, snapped),
                  moved: true,
                }
              : prev,
          );
          return;
        }

        // Hover affordance for the bbox resize grips (parametric outlines only;
        // editable outlines use vertex grips, not axis-resize cursors).
        if (boardDimModeRef.current && toolMode === "select") {
          const outline = workspace.projection?.board.outline;
          if (outline && !isEditableOutline(outline)) {
            const handle = hitBoardHandle(
              outline,
              cursor,
              BOARD_HANDLE_TOLERANCE_MM,
            );
            setBoardHandleCursor(handle ? handleCursor(handle) : null);
          } else if (boardHandleCursor !== null) {
            setBoardHandleCursor(null);
          }
        } else if (boardHandleCursor !== null) {
          setBoardHandleCursor(null);
        }

        if (toolMode === "measure") {
          workspace.hoverNet(null);
          return;
        }
        // Tune-idle hover: emphasize the trace under the cursor (any visible
        // copper layer) so the pick target is obvious before clicking.
        if (toolMode === "tune") {
          const hoverId =
            tuneState.kind === "tuning"
              ? null
              : (hitTraceAnyVisibleLayer(cursor)?.trace.id ?? null);
          setTuneHoverTraceId((prev) => (prev === hoverId ? prev : hoverId));
          workspace.hoverNet(null);
          return;
        }
        // Marquee in flight: update rect, suppress hover-net & drag updates.
        if (marquee.marqueeSession) {
          marquee.updateMarqueeCursor(cursor);
          return;
        }
        // Hover-highlight: resolve cursor → pad → net (only when not dragging).
        if (!dragSession) {
          const pad = hitPad(visiblePlacements, cursor);
          const netId = pad
            ? (padToNet.get(`${pad.placementId}|${pad.padNumber}`) ?? null)
            : null;
          workspace.hoverNet(netId);

          // DRC marker hover → marker emphasis + offending-trace highlight +
          // tooltip. Guarded by drcHoverRef so the store is written only when
          // the hovered violation changes (no churn on every pointer move; the
          // tooltip follows the cursor via cursorClientPx, set above).
          const tolMm = DRC_HIT_PX / 2 / drcZoomRef.current;
          const drcHit = hitDrcMarker(drcMarkersRef.current, cursor, tolMm);
          const drcId = drcHit?.id ?? null;
          if (drcId !== drcHoverRef.current) {
            drcHoverRef.current = drcId;
            useDrcStore.getState().setHovered(drcId);
          }
        }
        setFreePrimitiveDragSession((prev) => {
          if (!prev) return prev;
          const next = {
            x: snap(cursor.x - prev.pointerOffsetMm.x),
            y: snap(cursor.y - prev.pointerOffsetMm.y),
          };
          if (
            next.x === prev.currentPositionMm.x &&
            next.y === prev.currentPositionMm.y
          )
            return prev;
          return { ...prev, currentPositionMm: next, moved: true };
        });
        if (dragSession) {
          let nx = snap(cursor.x - dragSession.pointerOffsetMm.x);
          let ny = snap(cursor.y - dragSession.pointerOffsetMm.y);
          // Alignment guides + magnetic snap. Alt suppresses the snap (hints
          // still show). Guide coord wins over grid on a matched axis.
          let guides: AlignmentGuide[] = [];
          let spacing: SpacingGuide[] = [];
          const index = alignmentIndexRef.current;
          const baseBBox = draggedInitialBBoxRef.current;
          if (alignmentGuidesEnabledRef.current && index && baseBBox) {
            const dx = nx - dragSession.initialPrimaryMm.x;
            const dy = ny - dragSession.initialPrimaryMm.y;
            const result = computeAlignmentGuides({
              index,
              draggedBBoxMm: translateBBox(baseBBox, dx, dy),
              toleranceMm: SNAP_THRESHOLD_PX / drcZoomRef.current,
            });
            guides = result.guides;
            spacing = result.spacing;
            if (!altHeldRef.current) {
              nx += result.snap.dx;
              ny += result.snap.dy;
            }
          }
          setAlignmentGuides(guides);
          setAlignmentSpacing(spacing);
          setDragSession((prev) => {
            if (!prev) return prev;
            if (
              nx === prev.currentPrimaryMm.x &&
              ny === prev.currentPrimaryMm.y
            ) {
              return prev;
            }
            return { ...prev, currentPrimaryMm: { x: nx, y: ny }, moved: true };
          });
        }
      },
      onPointerUp() {
        // Commit a board resize. The command writes ONLY the outline — no
        // placement/trace/via position is ever recomputed (non-destructive).
        const resize = boardResizeSessionRef.current;
        if (resize) {
          setBoardResizeSession(null);
          if (resize.moved) {
            const next = resize.currentRect;
            // Keep the preview pinned across the async refresh so the board
            // doesn't flash back to its old size before the new size lands.
            setCommittedOutlineOverride(next);
            void workspace
              .updateBoardOutline(next)
              .catch(() => undefined)
              .finally(() => setCommittedOutlineOverride(null));
          }
          return;
        }
        if (areaInteractions.handlePointerUp()) return;
        const vertexDrag = vertexDragSessionRef.current;
        if (vertexDrag) {
          setVertexDragSession(null);
          if (vertexDrag.moved) {
            const next = vertexDrag.current;
            setCommittedOutlineOverride(next);
            void workspace
              .updateBoardOutline(next)
              .catch(() => undefined)
              .finally(() => setCommittedOutlineOverride(null));
          }
          return;
        }
        if (marquee.marqueeSession) {
          marquee.finishMarquee();
          return;
        }
        const fpSession = freePrimitiveDragSessionRef.current;
        if (fpSession) {
          setFreePrimitiveDragSession(null);
          if (fpSession.moved) {
            const pos = fpSession.currentPositionMm;
            if (fpSession.kind === "freeHole") {
              void workspace
                .updateFreeHole(fpSession.id, { centerMm: pos })
                .catch(() => undefined);
            } else if (fpSession.kind === "freePad") {
              void workspace
                .updateFreePad(fpSession.id, { centerMm: pos })
                .catch(() => undefined);
            } else {
              void workspace
                .updateOverlayText(fpSession.id, { positionMm: pos })
                .catch(() => undefined);
            }
          }
          return;
        }
        const session = dragSession;
        if (!session) return;
        if (session.moved) {
          const dx = session.currentPrimaryMm.x - session.initialPrimaryMm.x;
          const dy = session.currentPrimaryMm.y - session.initialPrimaryMm.y;
          const updates: Array<{
            placementId: string;
            positionMm: PcbPointMm;
          }> = [];
          const optimistic = new Map<string, PcbPointMm>();
          for (const [id, initial] of session.initialPositionsByPlacementId) {
            const positionMm = { x: initial.x + dx, y: initial.y + dy };
            updates.push({
              placementId: id,
              positionMm,
            });
            optimistic.set(id, positionMm);
          }
          if (previewActive) {
            // Non-destructive: fold the move into the preview map, not the DB.
            setPlacePreviewPositions(updates, originalByIdRef.current);
          } else {
            setCommittedDragOverride(optimistic);
            const clearOptimistic = () => setCommittedDragOverride(null);
            if (updates.length === 1) {
              void workspace
                .movePlacement(updates[0]!.placementId, updates[0]!.positionMm)
                .finally(clearOptimistic);
            } else if (updates.length > 1) {
              void workspace.movePlacements(updates).finally(clearOptimistic);
            } else {
              clearOptimistic();
            }
          }
        }
        setDragSession(null);
        setAlignmentGuides([]);
        setAlignmentSpacing([]);
        alignmentIndexRef.current = null;
        draggedInitialBBoxRef.current = null;
      },
      onPointerLeave() {
        // Drop any DRC marker hover when the cursor leaves the canvas.
        if (drcHoverRef.current !== null) {
          drcHoverRef.current = null;
          useDrcStore.getState().setHovered(null);
        }
        // Keep the last board cursor during active routing so toolbar/context
        // layer switches can still drop a smart via at the last route point.
        if (toolMode === "measure") {
          dispatchMeasure({ kind: "clear" });
          setCursorMm(null);
          setCursorClientPx(null);
          return;
        }
        if (routeState.kind !== "routing") {
          setCursorMm(null);
        }
        setCursorClientPx(null);
        setBoardHandleCursor(null);
      },
      onContextMenu(event) {
        const cursor = eventToMm(event);
        const groups: ContextMenuGroup[] = [];

        // Vertex / edge ops on the single selected polygon zone or keepout.
        const areaGroup = areaInteractions.contextMenuGroup(cursor);
        if (areaGroup) {
          openContextMenu({
            scope: "pcb",
            position: { x: event.screenPoint.x, y: event.screenPoint.y },
            groups: [areaGroup],
          });
          return;
        }

        // Board-outline corner ops (board-dim mode + editable outline): fillet /
        // chamfer / delete the vertex under the cursor. Fillet & chamfer need a
        // contour (arc-capable); polygon corners only delete in v1.
        const editOutline = workspace.projection?.board.outline;
        if (
          boardDimModeRef.current &&
          editOutline &&
          isEditableOutline(editOutline)
        ) {
          const vIndex = hitOutlineVertex(
            editOutline,
            cursor,
            BOARD_HANDLE_TOLERANCE_MM,
          );
          if (vIndex !== null) {
            const apply = (next: PcbBoardOutline | null): void => {
              if (!next) return;
              void workspace.updateBoardOutline(next).catch(() => undefined);
            };
            const contour =
              editOutline.kind === "contour" ? editOutline : null;
            openContextMenu({
              scope: "pcb",
              position: { x: event.screenPoint.x, y: event.screenPoint.y },
              groups: [
                {
                  id: "outline-corner",
                  items: [
                    {
                      kind: "action",
                      id: "fillet-corner",
                      label: "Fillet corner…",
                      disabled: !contour,
                      onSelect: () => {
                        if (contour) {
                          setCornerOp({ mode: "fillet", vIndex, contour });
                        }
                      },
                    },
                    {
                      kind: "action",
                      id: "chamfer-corner",
                      label: "Chamfer corner…",
                      disabled: !contour,
                      onSelect: () => {
                        if (contour) {
                          setCornerOp({ mode: "chamfer", vIndex, contour });
                        }
                      },
                    },
                    {
                      kind: "action",
                      id: "set-vertex-position",
                      label: "Set position…",
                      onSelect: () =>
                        setDimOp({
                          kind: "vertex-xy",
                          outline: editOutline,
                          vIndex,
                        }),
                    },
                    { kind: "separator", id: "sep-del-vertex" },
                    {
                      kind: "action",
                      id: "delete-vertex",
                      label: "Delete vertex",
                      onSelect: () => apply(deleteVertex(editOutline, vIndex)),
                    },
                  ],
                },
              ],
            });
            return;
          }
          // No vertex under the cursor — offer edge ops when over a straight edge.
          const edge = hitOutlineEdge(
            editOutline,
            cursor,
            BOARD_HANDLE_TOLERANCE_MM,
          );
          if (edge) {
            openContextMenu({
              scope: "pcb",
              position: { x: event.screenPoint.x, y: event.screenPoint.y },
              groups: [
                {
                  id: "outline-edge",
                  items: [
                    {
                      kind: "action",
                      id: "set-edge-length",
                      label: "Set length…",
                      onSelect: () =>
                        setDimOp({
                          kind: "edge-length",
                          outline: editOutline,
                          edgeIndex: edge.edgeIndex,
                        }),
                    },
                    {
                      kind: "action",
                      id: "insert-edge-vertex",
                      label: "Insert vertex here",
                      onSelect: () =>
                        void workspace
                          .updateBoardOutline(
                            insertVertexAtEdge(
                              editOutline,
                              edge.edgeIndex,
                              edge.pointMm,
                            ),
                          )
                          .catch(() => undefined),
                    },
                  ],
                },
              ],
            });
            return;
          }
        }

        if (routeState.kind !== "idle") {
          groups.push({
            id: "route-actions",
            items: [
              {
                kind: "action",
                id: "cancel-route",
                label: "Cancel route",
                shortcut: "Esc",
                onSelect: () => dispatchRoute({ kind: "cancel" }),
              },
              {
                kind: "action",
                id: "commit-waypoint",
                label: "Commit waypoint",
                onSelect: () => {
                  const anchor = resolveRouteAnchor(cursor);
                  dispatchRoute({
                    kind: "commit-waypoint",
                    pointNm: pointMmToNm(anchor.pointMm),
                  });
                },
              },
              {
                kind: "action",
                id: "finish-route",
                label: "Finish route",
                shortcut: "Enter",
                onSelect: () => {
                  const anchor = resolveRouteAnchor(cursor);
                  void finishRoute(
                    routeState.session,
                    pointMmToNm(anchor.pointMm),
                  );
                },
              },
              {
                kind: "separator",
                id: "sep-via",
              },
              {
                kind: "action",
                id: "place-smart-via-top",
                label: "Top Copper (F.Cu)",
                disabled: routeState.session.layer === "F.Cu",
                onSelect: () => {
                  void setActiveCopperLayer("F.Cu", cursor);
                },
              },
              {
                kind: "action",
                id: "place-smart-via-bottom",
                label: "Bottom Copper (B.Cu)",
                disabled: routeState.session.layer === "B.Cu",
                onSelect: () => {
                  void setActiveCopperLayer("B.Cu", cursor);
                },
              },
            ],
          });
        } else {
          const traceHit = isCopperLayerVisible(
            visibleLayers,
            activeCopperLayer,
          )
            ? hitTrace(tracesRef.current, cursor, activeCopperLayer)
            : null;
          const viaHit = viasVisible ? hitVia(viasRef.current, cursor) : null;
          const placementHit = hitPlacement(visiblePlacements, cursor);

          if (traceHit) {
            if (!selection.traceIds.has(traceHit.trace.id)) {
              setSelection({
                placementIds: new Set(),
                traceIds: new Set([traceHit.trace.id]),
                viaIds: new Set(),
              });
            }
            groups.push({
              id: "trace-actions",
              items: [
                {
                  kind: "action",
                  id: "split-reroute-trace",
                  label: "Split and reroute from here",
                  onSelect: () => {
                    void splitAndRerouteTrace(traceHit).catch(() => undefined);
                  },
                },
                {
                  kind: "separator",
                  id: "sep-delete-trace",
                },
                {
                  kind: "action",
                  id: "delete-trace",
                  label: "Delete trace",
                  shortcut: "Del",
                  destructive: true,
                  onSelect: () => {
                    void workspace.deleteTrace(traceHit.trace.id).then(() =>
                      setSelection((prev) => ({
                        placementIds: prev.placementIds,
                        traceIds: new Set(),
                        viaIds: prev.viaIds,
                      })),
                    );
                  },
                },
              ],
            });
          } else if (viaHit) {
            if (!selection.viaIds.has(viaHit.id)) {
              setSelection({
                placementIds: new Set(),
                traceIds: new Set(),
                viaIds: new Set([viaHit.id]),
              });
            }
            groups.push({
              id: "via-actions",
              items: [
                {
                  kind: "action",
                  id: "delete-via",
                  label: "Delete via",
                  shortcut: "Del",
                  destructive: true,
                  onSelect: () => {
                    void workspace.deleteVia(viaHit.id).then(() =>
                      setSelection((prev) => ({
                        placementIds: prev.placementIds,
                        traceIds: prev.traceIds,
                        viaIds: new Set(),
                      })),
                    );
                  },
                },
              ],
            });
          } else if (placementHit) {
            if (!selection.placementIds.has(placementHit.id)) {
              setSelection({
                placementIds: new Set([placementHit.id]),
                traceIds: new Set(),
                viaIds: new Set(),
              });
            }
            groups.push({
              id: "placement-actions",
              items: [
                {
                  kind: "action",
                  id: "rotate",
                  label: "Rotate 90°",
                  shortcut: "R",
                  onSelect: () => {
                    if (previewActive) {
                      rotatePlacePreview(
                        placementHit.id,
                        originalByIdRef.current,
                      );
                      return;
                    }
                    void workspace.rotatePlacement(
                      placementHit.id,
                      (placementHit.rotationDeg + 90) as 0 | 90 | 180 | 270,
                    );
                  },
                },
                {
                  kind: "action",
                  id: "flip",
                  label: "Flip side",
                  shortcut: "F",
                  onSelect: () => {
                    if (previewActive) {
                      flipPlacePreview(
                        placementHit.id,
                        originalByIdRef.current,
                      );
                      return;
                    }
                    void workspace.flipPlacement(placementHit.id);
                  },
                },
                {
                  kind: "separator",
                  id: "sep-delete-placement",
                },
                {
                  kind: "action",
                  id: "delete-placement",
                  label: "Delete placement",
                  shortcut: "Del",
                  destructive: true,
                  onSelect: () => {
                    void workspace.deletePlacement(placementHit.id).then(() =>
                      setSelection((prev) => ({
                        placementIds: new Set(),
                        traceIds: prev.traceIds,
                        viaIds: prev.viaIds,
                      })),
                    );
                  },
                },
              ],
            });
          } else {
            groups.push(
              {
                id: "mode",
                items: [
                  {
                    kind: "action",
                    id: "toggle-route",
                    label:
                      toolMode === "select"
                        ? "Enter route mode"
                        : "Enter select mode",
                    shortcut: "X",
                    onSelect: () =>
                      setToolMode((prev) =>
                        prev === "select" ? "route" : "select",
                      ),
                  },
                  {
                    kind: "action",
                    id: "measure-distance",
                    label:
                      toolMode === "measure"
                        ? "Exit measure mode"
                        : "Measure distance",
                    shortcut: "M",
                    onSelect: () => {
                      setToolMode((prev) => {
                        if (prev === "measure") {
                          dispatchMeasure({ kind: "clear" });
                          return "select";
                        }
                        return "measure";
                      });
                      dispatchRoute({ kind: "cancel" });
                    },
                  },
                  {
                    kind: "action",
                    id: "toggle-ratsnest",
                    label: workspace.ratsnestVisible
                      ? "Hide ratsnest"
                      : "Show ratsnest",
                    onSelect: () => workspace.toggleRatsnestVisible(),
                  },
                ],
              },
              {
                id: "layer",
                items: [
                  {
                    kind: "action",
                    id: "set-top",
                    label: "Top layer (F.Cu)",
                    disabled: activeCopperLayer === "F.Cu",
                    onSelect: () => void setActiveCopperLayer("F.Cu"),
                  },
                  {
                    kind: "action",
                    id: "set-bottom",
                    label: "Bottom layer (B.Cu)",
                    disabled: activeCopperLayer === "B.Cu",
                    onSelect: () => void setActiveCopperLayer("B.Cu"),
                  },
                ],
              },
              {
                id: "selection",
                items: [
                  {
                    kind: "action",
                    id: "clear-selection",
                    label: "Clear selection",
                    shortcut: "Esc",
                    disabled:
                      selection.placementIds.size === 0 &&
                      selection.traceIds.size === 0 &&
                      selection.viaIds.size === 0,
                    onSelect: () => setSelection(emptyPcbSelection()),
                  },
                ],
              },
            );
          }
        }

        if (props.onCreateComment) {
          groups.push({
            id: "comment",
            items: [
              {
                kind: "action",
                id: "add-comment",
                label: "Add comment",
                onSelect: () => {
                  const point = snapPoint(cursor);
                  const pointNm = pointMmToNm(point);
                  const pad = hitPad(visiblePlacements, cursor);
                  const trace = hitTrace(
                    tracesRef.current,
                    cursor,
                    activeCopperLayer,
                  );
                  const via = hitVia(viasRef.current, cursor);
                  const placement = hitPlacement(visiblePlacements, cursor);
                  const r = wrapperRef.current?.getBoundingClientRect();
                  setCommentDraft({
                    anchor: {
                      surface: "pcb",
                      pointNm,
                      entity: pad
                        ? {
                            kind: "pad",
                            id: pad.placementId,
                            subId: pad.padNumber,
                          }
                        : trace
                          ? { kind: "trace", id: trace.trace.id }
                          : via
                            ? { kind: "via", id: via.id }
                            : placement
                              ? { kind: "placement", id: placement.id }
                              : undefined,
                      layerId: activeCopperLayer,
                      sourceRevision: workspace.projection?.revision,
                    },
                    screen: {
                      x: event.screenPoint.x - (r?.left ?? 0),
                      y: event.screenPoint.y - (r?.top ?? 0),
                    },
                  });
                },
              },
            ],
          });
        }

        openContextMenu({
          scope: "pcb",
          position: { x: event.screenPoint.x, y: event.screenPoint.y },
          groups,
        });
      },
    };
  }, [
    activeCopperLayer,
    areaInteractions,
    autoFinishEnabled,
    autoFinishProposal,
    bundleState,
    defaultNetClass,
    dragSession,
    eventToMm,
    findNearestPadOnNet,
    finishRoute,
    marquee,
    padToNet,
    pendingRouteGeometry,
    previewActive,
    props.activeCommentThreadId,
    props.commentMode,
    props.commentThreads,
    props.onCreateComment,
    props.onSelectCommentThread,
    resolveMeasureAnchor,
    resolveRouteAnchor,
    rotatePlacePreview,
    flipPlacePreview,
    runAutoFinish,
    setPlacePreviewPositions,
    routeState,
    selection,
    setActiveCopperLayer,
    setCursorMm,
    snapPoint,
    splitAndRerouteTrace,
    toolMode,
    tuneState,
    viasVisible,
    visibleLayers,
    visiblePlacements,
    workspace,
  ]);

  useEffect(() => {
    const onShiftKey = (event: KeyboardEvent): void => {
      if (event.key === "Shift") {
        setMeasureShowDeltas(event.type === "keydown");
        // Shift also suppresses object+guide snap while held (grid stays).
        shiftHeldRef.current = event.type === "keydown";
      }
      // Track Alt to let the user suppress guide snapping mid-drag/route.
      if (event.key === "Alt") altHeldRef.current = event.type === "keydown";
    };
    window.addEventListener("keydown", onShiftKey);
    window.addEventListener("keyup", onShiftKey);
    return () => {
      window.removeEventListener("keydown", onShiftKey);
      window.removeEventListener("keyup", onShiftKey);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return;

      // Esc rejects the active auto-place preview (cancelling any in-flight drag first).
      if (event.key === "Escape" && previewActive) {
        event.preventDefault();
        rejectPreview();
        return;
      }

      // F flips the currently-selected placement(s) in Select mode (KiCad
      // parity). Each placement flips around its own origin: layer toggles
      // F.Cu↔B.Cu and `mirrored` flips. Rotation/position preserved.
      // Disabled while routing — routing-mode keys are handled below.
      if (
        (event.key === "f" || event.key === "F") &&
        !event.shiftKey &&
        toolMode === "select" &&
        routeState.kind !== "routing" &&
        selection.placementIds.size > 0 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        const ids = [...selection.placementIds];
        if (previewActive) {
          if (ids.length === 1) {
            flipPlacePreview(ids[0]!, originalByIdRef.current);
          } else {
            flipManyPlacePreview(ids, originalByIdRef.current);
          }
          return;
        }
        if (ids.length === 1) {
          void workspace.flipPlacement(ids[0]!);
        } else {
          void workspace.flipPlacements(ids);
        }
        return;
      }

      // Tool toggle: R activates Route mode (also rotates a selected
      // placement when in Select mode without an active route session).
      // Group rotate is unsupported in v1 — R only rotates when exactly
      // one placement is selected.
      // Tool toggles are inert during an active route session — routing owns
      // the keyboard (Esc is the one cancel gesture). `T` deliberately falls
      // through so the layer-switch hotkey below can drive the smart via.
      if (
        (event.key === "h" || event.key === "H") &&
        routeState.kind !== "routing"
      ) {
        event.preventDefault();
        setToolMode((prev) => (prev === "hole" ? "select" : "hole"));
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }
      if (
        (event.key === "o" || event.key === "O") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        routeState.kind !== "routing"
      ) {
        event.preventDefault();
        dispatchSketch({ kind: "cancel" });
        setBoardDimMode(false);
        setToolMode((prev) =>
          prev === "boardShape" ? "select" : "boardShape",
        );
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }
      // Shift+Z — Zone cutout sub-mode. Needs exactly one unlocked polygon
      // zone selected; without a subject it refuses with a notice and changes
      // nothing (copper-pour contract §11).
      if (
        (event.key === "z" || event.key === "Z") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.shiftKey &&
        routeState.kind !== "routing"
      ) {
        event.preventDefault();
        if (toolMode === "zoneHole") {
          dispatchSketch({ kind: "cancel" });
          setToolMode("select");
          return;
        }
        if (!zoneHoleParentRef.current) {
          setZoneHoleNotice(ZONE_HOLE_NO_SUBJECT_NOTICE);
          return;
        }
        dispatchSketch({ kind: "cancel" });
        setBoardDimMode(false);
        setToolMode("zoneHole");
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }
      if (
        (event.key === "z" || event.key === "Z") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        routeState.kind !== "routing"
      ) {
        event.preventDefault();
        dispatchSketch({ kind: "cancel" });
        setBoardDimMode(false);
        setToolMode((prev) => (prev === "zone" ? "select" : "zone"));
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }
      if (
        (event.key === "k" || event.key === "K") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        routeState.kind !== "routing"
      ) {
        event.preventDefault();
        dispatchSketch({ kind: "cancel" });
        setBoardDimMode(false);
        setToolMode((prev) => (prev === "keepout" ? "select" : "keepout"));
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }
      if (
        (event.key === "p" || event.key === "P") &&
        routeState.kind !== "routing"
      ) {
        // Skip if a placement is selected — P is also "pad" shortcut, but
        // currently no conflicting binding exists for select mode.
        event.preventDefault();
        setToolMode((prev) => (prev === "pad" ? "select" : "pad"));
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }
      if (
        (event.key === "t" || event.key === "T") &&
        routeState.kind !== "routing"
      ) {
        event.preventDefault();
        setToolMode((prev) => (prev === "text" ? "select" : "text"));
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }
      if (
        (event.key === "m" || event.key === "M") &&
        routeState.kind !== "routing"
      ) {
        event.preventDefault();
        setToolMode((prev) => {
          if (prev === "measure") {
            dispatchMeasure({ kind: "clear" });
            return "select";
          }
          return "measure";
        });
        dispatchRoute({ kind: "cancel" });
        return;
      }
      // U toggles the length-Tune tool (pcb.lengthTuning).
      if (
        (event.key === "u" || event.key === "U") &&
        lengthTuningEnabled &&
        routeState.kind !== "routing" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        setToolMode((prev) => {
          if (prev === "tune") {
            dispatchTune({ kind: "cancel" });
            return "select";
          }
          return "tune";
        });
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }
      // Tune-session keys.
      if (toolMode === "tune" && tuneState.kind === "tuning") {
        if (event.key === "Escape") {
          event.preventDefault();
          dispatchTune({ kind: "cancel" });
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          commitTuneProposal();
          return;
        }
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          dispatchTune({ kind: "nudge-amplitude", direction: 1 });
          return;
        }
        if (event.key === "-") {
          event.preventDefault();
          dispatchTune({ kind: "nudge-amplitude", direction: -1 });
          return;
        }
        if (event.key === ",") {
          event.preventDefault();
          dispatchTune({ kind: "nudge-spacing", direction: -1 });
          return;
        }
        if (event.key === ".") {
          event.preventDefault();
          dispatchTune({ kind: "nudge-spacing", direction: 1 });
          return;
        }
      }
      // Bundle-session keys.
      if (toolMode === "bundle" && bundleState.kind === "bundling") {
        if (event.key === "Escape") {
          event.preventDefault();
          dispatchBundle({ kind: "cancel" });
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          dispatchBundle({ kind: "step-back" });
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          void finishBundle();
          return;
        }
        if (event.key === "," || event.key === ".") {
          event.preventDefault();
          const clearanceMm = Math.max(
            defaultNetClass?.clearanceMm ?? 0,
            workspace.projection?.board.designRules.clearance.traceToTraceMm ??
              0,
          );
          dispatchBundle({
            kind: "nudge-pitch",
            direction: event.key === "." ? 1 : -1,
            minPitchNm: Math.round(
              (bundleState.session.widthMm + clearanceMm + 0.001) * NM_PER_MM,
            ),
          });
          return;
        }
      }
      // Shift+G toggles alignment guides (visual + magnetic snap).
      if ((event.key === "g" || event.key === "G") && event.shiftKey) {
        event.preventDefault();
        usePcbViewStore.getState().toggleAlignmentGuidesVisible();
        return;
      }
      if (event.key === "r" || event.key === "R") {
        // Inert while routing — Esc cancels, R must not destroy the session.
        if (routeState.kind === "routing") return;
        const sole =
          selection.placementIds.size === 1
            ? [...selection.placementIds][0]
            : null;
        if (toolMode === "select" && sole && !event.shiftKey) {
          event.preventDefault();
          if (previewActive) {
            rotatePlacePreview(sole, originalByIdRef.current);
            return;
          }
          const placement = placementsRef.current.find((p) => p.id === sole);
          if (placement) {
            const next = (((placement.rotationDeg + 90) % 360) + 360) % 360;
            void workspace.rotatePlacement(
              placement.id,
              next as 0 | 90 | 180 | 270,
            );
          }
          return;
        }
        event.preventDefault();
        setToolMode((prev) => (prev === "route" ? "select" : "route"));
        if (toolMode === "route") dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }

      // Sketch keys (board shape / zone / keepout): Enter closes, Esc cancels +
      // exits, Backspace removes the last vertex.
      if (sketchTargetFor(toolMode) !== null) {
        const sketch = sketchStateRef.current;
        const drawing = sketch.kind === "drawing";
        // Typed numeric entry: digits / dot / (angle) minus build the buffer.
        if (
          drawing &&
          (/^[0-9]$/.test(event.key) || event.key === "." || event.key === "-")
        ) {
          event.preventDefault();
          setSketchEntry((cur) =>
            appendToEntry(cur ?? emptySketchEntry(), event.key),
          );
          return;
        }
        if (drawing && event.key === "Tab") {
          event.preventDefault();
          setSketchEntry((cur) => toggleEntryField(cur ?? emptySketchEntry()));
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const entry = sketchEntryRef.current;
          if (drawing && entry && entryHasValue(entry)) {
            // Commit exactly what the readout shows (preview folds in the typed
            // dims), or close the loop when it lands on the start vertex.
            const verts = sketch.session.verticesMm;
            const point = sketchPreviewRef.current?.preview ?? null;
            if (point) {
              const first = verts[0]!;
              if (
                canCloseSketch(sketch) &&
                Math.hypot(point.x - first.x, point.y - first.y) <=
                  SKETCH_CLOSE_THRESHOLD_MM
              ) {
                finishSketchRef.current(sketch.session);
              } else {
                dispatchSketch({ kind: "commit-vertex", pointMm: point });
              }
            }
            setSketchEntry(null);
            return;
          }
          if (drawing && canCloseSketch(sketch)) {
            finishSketchRef.current(sketch.session);
          }
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          if (sketchEntryRef.current) {
            setSketchEntry(null); // first Esc drops the typed buffer
            return;
          }
          dispatchSketch({ kind: "cancel" });
          setToolMode("select");
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          const entry = sketchEntryRef.current;
          if (
            drawing &&
            entry &&
            (entry.lengthText !== "" || entry.angleText !== "")
          ) {
            setSketchEntry(backspaceEntry(entry));
            return;
          }
          dispatchSketch({ kind: "undo-vertex" });
          return;
        }
      }

      // Routing-only keys.
      if (toolMode === "route" && routeState.kind === "routing") {
        const session = routeState.session;
        if (event.key === "Escape") {
          event.preventDefault();
          // A pending auto-finish proposal absorbs the first Esc; the
          // session itself only cancels on the next one.
          if (autoFinishProposal) {
            setAutoFinishProposal(null);
            return;
          }
          dispatchRoute({ kind: "cancel" });
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          dispatchRoute({ kind: "step-back" });
          return;
        }
        // Tab — auto-finish: propose an A* completion to the nearest open
        // same-net pad (the pad the dashed ratsnest guide points at).
        if (event.key === "Tab" && autoFinishEnabled) {
          event.preventDefault();
          runAutoFinish();
          return;
        }
        // Enter/End — accept a pending proposal, else finish anywhere:
        // commit the ghost through the snapped cursor (or just the committed
        // segments when the cursor is unknown), leaving a dangling end.
        // KiCad "Finish Route" parity.
        if (event.key === "Enter" || event.key === "End") {
          event.preventDefault();
          if (autoFinishProposal) {
            acceptAutoFinish();
            return;
          }
          const finalNm = cursorMm
            ? pointMmToNm(resolveRouteAnchor(cursorMm).pointMm)
            : (session.waypointsNm[session.waypointsNm.length - 1] ?? null);
          if (finalNm) {
            void finishRoute(session, finalNm, walkDetourRef.current ?? []);
          }
          return;
        }
        if (event.key === "w" || event.key === "W") {
          event.preventDefault();
          if (event.altKey) {
            // Alt+W → inline custom-width editor in the route HUD.
            setWidthInputOpen(true);
            return;
          }
          // W cycles forward through presets, Shift+W cycles backward.
          const next = cycleWidth(session.widthMm, event.shiftKey ? -1 : 1);
          void setSessionWidth(next, "preset");
          return;
        }
        if (event.key === "/") {
          // KiCad-style track-posture toggle.
          event.preventDefault();
          dispatchRoute({ kind: "cycle-posture" });
          return;
        }
        if (
          (event.key === "f" || event.key === "F") &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          dispatchRoute({ kind: "cycle-posture" });
          return;
        }
        if (event.shiftKey && event.key === " ") {
          event.preventDefault();
          dispatchRoute({
            kind: "set-mode",
            mode:
              session.segmentMode === "manhattan-90"
                ? "manhattan-45"
                : "manhattan-90",
          });
          return;
        }
        // Smart Via: V (KiCad/Flux universal) or +/- (alias for back-compat).
        // Flushes segments-so-far into the session, drops a via at the
        // cursor, then rebases onto the other layer of the active LAYER PAIR
        // (toolbar-selectable on 4-layer boards; 1-4 hotkeys jump directly).
        if (
          event.key === "+" ||
          event.key === "-" ||
          event.key === "v" ||
          event.key === "V"
        ) {
          event.preventDefault();
          if (!cursorMm) return;
          const nextLayer = nextRouteLayer(
            session.layer,
            workspace.projection?.board.layerCount ?? 2,
            usePcbViewStore.getState().layerPair,
          );
          void setActiveCopperLayer(nextLayer, snapPoint(cursorMm));
          return;
        }
      }

      // Global keys.
      // Flip board view (Shift+F). One-way sync: the active copper layer
      // follows the side now facing the user (bottom → B.Cu, top → F.Cu).
      // Changing layer alone still never flips the view.
      if (
        (event.key === "F" || event.key === "f") &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        handleToggleViewSide();
        return;
      }
      // Toggle the selection-filter floating panel (F alone, no modifiers,
      // select mode only). Route mode uses F for posture flip.
      if (
        toolMode === "select" &&
        (event.key === "f" || event.key === "F") &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        usePcbViewStore.getState().toggleSelectionFilterPanel();
        return;
      }
      // Layer-switch hotkeys (no view flip — that's Shift+F):
      //   T / 1 / PgUp → F.Cu, B / 2 / PgDn → B.Cu.
      // Fire globally so the user can switch active copper layer outside route
      // mode too. While idle these also engage the routing lock (focus) so the
      // chosen layer wins over Auto; pressing the locked layer's key again
      // clears the lock back to Auto. While routing, the key drives the
      // smart-via layer switch (via setActiveCopperLayer) and leaves focus be.
      const lockLayer = (target: PcbCopperLayerId) => {
        if (routeState.kind !== "routing") {
          setFocusedLayer((prev) => (prev === target ? null : target));
        }
        void setActiveCopperLayer(target);
      };
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "1" ||
          event.key === "PageUp" ||
          event.key === "t" ||
          event.key === "T")
      ) {
        event.preventDefault();
        lockLayer("F.Cu");
        return;
      }
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "2" ||
          event.key === "PageDown" ||
          event.key === "b" ||
          event.key === "B")
      ) {
        event.preventDefault();
        lockLayer("B.Cu");
        return;
      }
      // 3 / 4 → inner copper layers (only on 4-layer boards). Silently
      // ignored when the board doesn't expose them so the key isn't
      // hijacked from text-input fields that happen to be focused
      // (handler short-circuits early on input target above).
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === "3" &&
        workspace.projection?.board.layerCount === 4
      ) {
        event.preventDefault();
        lockLayer("In1.Cu");
        return;
      }
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === "4" &&
        workspace.projection?.board.layerCount === 4
      ) {
        event.preventDefault();
        lockLayer("In2.Cu");
        return;
      }
      // Ratsnest toggle moved to Shift+B (B alone now selects Bottom Copper).
      if (
        (event.key === "B" || event.key === "b") &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        workspace.toggleRatsnestVisible();
        return;
      }
      // Display-mode cycle (Normal → Dim → Solo) — KiCad's Ctrl+H.
      if (
        (event.key === "h" || event.key === "H") &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        workspace.cycleDisplayMode();
        return;
      }
      // Undo / Redo — ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z, Ctrl+Y. Skipped during active
      // routing (route owns its own backspace/escape semantics).
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        (event.key === "z" || event.key === "Z")
      ) {
        if (routeState.kind === "routing") return;
        event.preventDefault();
        if (event.shiftKey) {
          if (workspace.canRedo) void workspace.redo();
        } else {
          if (workspace.canUndo) void workspace.undo();
        }
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "y" || event.key === "Y")
      ) {
        if (routeState.kind === "routing") return;
        event.preventDefault();
        if (workspace.canRedo) void workspace.redo();
        return;
      }
      if (event.key === "`") {
        event.preventDefault();
        if (workspace.highlightedNetId) {
          workspace.pinHighlightedNet(workspace.highlightedNetId);
        } else {
          workspace.clearHighlight();
        }
        return;
      }
      if (event.key === "Escape") {
        if (marquee.marqueeSession) {
          marquee.cancelMarquee();
          return;
        }
        setSelection(emptyPcbSelection());
        setDragSession(null);
        setFreePrimitiveDragSession(null);
        setCommittedDragOverride(null);
        workspace.clearHighlight();
        if (toolMode === "route") {
          setToolMode("select");
          dispatchRoute({ kind: "cancel" });
        } else if (toolMode === "measure") {
          dispatchMeasure({ kind: "clear" });
          setToolMode("select");
        } else if (toolMode === "tune") {
          dispatchTune({ kind: "cancel" });
          setToolMode("select");
        } else if (toolMode === "bundle") {
          dispatchBundle({ kind: "cancel" });
          setToolMode("select");
        } else if (
          toolMode === "hole" ||
          toolMode === "pad" ||
          toolMode === "text" ||
          toolMode === "zone" ||
          toolMode === "keepout" ||
          toolMode === "zoneHole"
        ) {
          setToolMode("select");
        }
        return;
      }
      // Delete all selected primitives.
      if (event.key === "Delete" || event.key === "Backspace") {
        const placementIds = [...selection.placementIds];
        const traceIds = [...selection.traceIds];
        const viaIds = [...selection.viaIds];
        const freeHoleIds = [...(selection.freeHoleIds ?? [])];
        const freePadIds = [...(selection.freePadIds ?? [])];
        const overlayTextIds = [...(selection.overlayTextIds ?? [])];
        const zoneIds = [...(selection.zoneIds ?? [])];
        const keepoutIds = [...(selection.keepoutIds ?? [])];
        if (
          placementIds.length === 0 &&
          traceIds.length === 0 &&
          viaIds.length === 0 &&
          freeHoleIds.length === 0 &&
          freePadIds.length === 0 &&
          overlayTextIds.length === 0 &&
          zoneIds.length === 0 &&
          keepoutIds.length === 0
        ) {
          return;
        }
        event.preventDefault();
        const tasks: Array<Promise<unknown>> = [];
        for (const id of placementIds)
          tasks.push(workspace.deletePlacement(id));
        for (const id of traceIds) tasks.push(workspace.deleteTrace(id));
        for (const id of viaIds) tasks.push(workspace.deleteVia(id));
        for (const id of freeHoleIds) tasks.push(workspace.deleteFreeHole(id));
        for (const id of freePadIds) tasks.push(workspace.deleteFreePad(id));
        for (const id of overlayTextIds)
          tasks.push(workspace.deleteOverlayText(id));
        // Board zones and locked rows are filtered inside the hook — the
        // layers-panel toggle owns a board zone's lifecycle (contract §12.3).
        tasks.push(areaInteractions.deleteSelected(selection));
        void Promise.allSettled(tasks).then(() => {
          setSelection(emptyPcbSelection());
        });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    acceptAutoFinish,
    areaInteractions,
    autoFinishEnabled,
    autoFinishProposal,
    bundleState,
    commitTuneProposal,
    cursorMm,
    defaultNetClass,
    finishBundle,
    cycleWidth,
    handleToggleViewSide,
    lengthTuningEnabled,
    marquee,
    previewActive,
    rejectPreview,
    rotatePlacePreview,
    flipPlacePreview,
    flipManyPlacePreview,
    finishRoute,
    resolveRouteAnchor,
    routeState,
    runAutoFinish,
    selection,
    setActiveCopperLayer,
    setSessionWidth,
    toolMode,
    tuneState,
    workspace,
  ]);

  const widthMm = Number(widthText);
  const heightMm = Number(heightText);
  const valid =
    Number.isFinite(widthMm) &&
    Number.isFinite(heightMm) &&
    widthMm > 0 &&
    heightMm > 0;

  // Count of parts/traces falling outside the current (or live-drag) outline.
  // Drives the non-blocking "N items outside board" warning. Resizing never
  // moves or deletes any of them — this is purely informational.
  const effectiveOutlineRect: PcbBoardOutline | null =
    boardResizeSession?.currentRect ??
    vertexDragSession?.current ??
    cornerPreviewOutline ??
    committedOutlineOverride ??
    workspace.projection?.board.outline ??
    null;
  const outsideCount = useMemo(() => {
    if (!workspace.projection || !effectiveOutlineRect) return 0;
    return countOutsideBoard(
      workspace.projection,
      effectiveOutlineRect,
      workspace.projection.board.cutouts,
    );
  }, [workspace.projection, effectiveOutlineRect]);

  // Standing proposed origin positions while previewing — keeps the ratsnest anchored at
  // the proposed spots even when no drag is active (translate-only; exact recompute on Accept).
  const previewPositionOverride = useMemo(
    () =>
      previewActive ? buildPositionOverride(placePreview.transforms) : null,
    [previewActive, placePreview.transforms],
  );

  const dragOverride = useMemo<ReadonlyMap<string, PcbPointMm> | null>(() => {
    if (!dragSession || !dragSession.moved) {
      return previewPositionOverride ?? committedDragOverride;
    }
    const dx = dragSession.currentPrimaryMm.x - dragSession.initialPrimaryMm.x;
    const dy = dragSession.currentPrimaryMm.y - dragSession.initialPrimaryMm.y;
    const map = new Map<string, PcbPointMm>(
      previewPositionOverride ?? undefined,
    );
    for (const [id, initial] of dragSession.initialPositionsByPlacementId) {
      map.set(id, { x: initial.x + dx, y: initial.y + dy });
    }
    return map;
  }, [committedDragOverride, dragSession, previewPositionOverride]);

  const freePrimitiveDragOverrides = useMemo(() => {
    if (!freePrimitiveDragSession?.moved) return null;
    const pos = freePrimitiveDragSession.currentPositionMm;
    if (freePrimitiveDragSession.kind === "freeHole") {
      return { freeHoles: new Map([[freePrimitiveDragSession.id, pos]]) };
    } else if (freePrimitiveDragSession.kind === "freePad") {
      return { freePads: new Map([[freePrimitiveDragSession.id, pos]]) };
    } else {
      return { overlayTexts: new Map([[freePrimitiveDragSession.id, pos]]) };
    }
  }, [freePrimitiveDragSession]);

  // Live route preview: build path through committed anchors + cursor.
  // With pcb.routeWalkaround on, a colliding head is re-shaped around the hit
  // obstacle cluster BEFORE rendering — the endpoint (snap-resolved cursor)
  // is never moved, so walkaround cannot fight snapping or guides.
  const routePreview = useMemo(() => {
    if (routeState.kind !== "routing" || !cursorMm) return null;
    const session = routeState.session;
    const cursorAnchor = resolveRouteAnchor(cursorMm);
    const committedAnchors = sessionAnchors(session);
    const cursorNm = pointMmToNm(cursorAnchor.pointMm);
    let detourAnchorsNm: PointNm[] | null = null;
    let walkChoice: { clusterSignature: string; side: "cw" | "ccw" } | null =
      null;
    if (walkaroundEnabled && workspace.projection && legalityContext) {
      const headStartNm = committedAnchors[committedAnchors.length - 1]!;
      // Corridor padding only: the board-wide upper bound, so the query window
      // can never be too small for a neighbour of any net class.
      const headPadMm = 1 + maxObstacleReachMm + session.widthMm;
      const box = {
        minX: Math.min(headStartNm.x, cursorNm.x) / NM_PER_MM - headPadMm,
        minY: Math.min(headStartNm.y, cursorNm.y) / NM_PER_MM - headPadMm,
        maxX: Math.max(headStartNm.x, cursorNm.x) / NM_PER_MM + headPadMm,
        maxY: Math.max(headStartNm.y, cursorNm.y) / NM_PER_MM + headPadMm,
      };
      const obstaclesFor = (b: typeof box) =>
        buildRouteObstacles({
          ctx: legalityContext,
          layer: session.layer,
          netId: session.netId,
          routeWidthMm: session.widthMm,
          withinBounds: b,
          extra: pendingRouteGeometry,
          ...(session.startPadId !== undefined
            ? { excludePadIds: new Set([session.startPadId]) }
            : {}),
        });
      const walkInput = {
        headStartNm,
        headEndNm: cursorNm,
        mode: session.segmentMode,
        posture: session.posture,
        previousChoice: walkChoiceRef.current,
      };
      let walk = walkaroundHead({ ...walkInput, obstacles: obstaclesFor(box) });
      if (walk.status === "detour") {
        // Detour corners wrap the hit cluster's AABB and can leave the
        // head-bbox query window — copper out there was never queried, so
        // the detour wasn't checked against it. Re-run once over the
        // detour's own (union) window; runs only on collision frames.
        let minX = box.minX;
        let minY = box.minY;
        let maxX = box.maxX;
        let maxY = box.maxY;
        for (const p of walk.anchorsNm) {
          minX = Math.min(minX, p.x / NM_PER_MM - headPadMm);
          minY = Math.min(minY, p.y / NM_PER_MM - headPadMm);
          maxX = Math.max(maxX, p.x / NM_PER_MM + headPadMm);
          maxY = Math.max(maxY, p.y / NM_PER_MM + headPadMm);
        }
        const grew =
          minX < box.minX || minY < box.minY || maxX > box.maxX ||
          maxY > box.maxY;
        if (grew) {
          walk = walkaroundHead({
            ...walkInput,
            obstacles: obstaclesFor({ minX, minY, maxX, maxY }),
          });
        }
      }
      if (walk.status === "detour") {
        detourAnchorsNm = walk.anchorsNm;
        walkChoice = {
          clusterSignature: walk.clusterSignature,
          side: walk.side,
        };
      }
      // "blocked" and "clear" both fall through to the direct ghost —
      // blocked keeps today's collision highlight as the fallback.
    }
    const anchors = [
      ...committedAnchors,
      ...(detourAnchorsNm ?? []),
      cursorNm,
    ];
    const path = buildPreviewPath(
      anchors,
      session.segmentMode,
      session.posture,
    );
    if (path.length < 2) return null;
    return {
      pointsNm: path,
      layer: session.layer,
      detourAnchorsNm,
      walkChoice,
    };
  }, [
    cursorMm,
    legalityContext,
    maxObstacleReachMm,
    pendingRouteGeometry,
    resolveRouteAnchor,
    routeState,
    walkaroundEnabled,
    workspace.projection,
  ]);

  // Clicks read the last computed detour; hysteresis reads the last side.
  useEffect(() => {
    walkDetourRef.current = routePreview?.detourAnchorsNm ?? null;
    walkChoiceRef.current = routePreview?.walkChoice ?? null;
  }, [routePreview]);

  /**
   * Live legality, site A (contract 07 §8): ONE `checkPendingCopper` over the
   * WHOLE session — every finished run, every via and the ghost together —
   * exactly the subject set `finishRoute` submits, so the HUD's count and the
   * commit gate's count are the same number by construction.
   *
   * It used to be two memos (finished runs, then the ghost) concatenated by
   * violation id. That double-counted a null-net bridge whose MARKER moves
   * between the two subject sets — a multi-shape unassigned pin where the
   * ghost touches an earlier-sorting shape gets a different location-hashed id
   * in the whole-session verdict than in the finished-runs one, so the HUD
   * showed two conflicts where the commit showed one. One call, one verdict.
   *
   * There is NO rbush window here: the broad phase is the context's own
   * uniform grid, queried inside `checkPendingCopper` at exactly the halo
   * every requirement on this board can reach — so a conflict can no longer
   * hide outside a hand-sized query box. The call feeds off the rAF-throttled
   * preview, so it runs at most once per animation frame; the ghost RENDER
   * reads `routePreview` directly and is never throttled.
   */
  const throttledRoutePreview = useRafThrottledValue(routePreview);

  const drcViolations = useMemo<DrcViolation[]>(() => {
    if (
      routeState.kind !== "routing" ||
      !legalityContext ||
      !workspace.projection
    ) {
      return EMPTY_VIOLATIONS;
    }
    const pending = pendingCopperFromSession(
      routeState.session,
      throttledRoutePreview?.pointsNm ?? null,
      workspace.projection.board,
    );
    if (pending.traces.length === 0 && pending.vias.length === 0) {
      return EMPTY_VIOLATIONS;
    }
    return runLiveDrc({ ctx: legalityContext, pending });
  }, [
    legalityContext,
    routeState,
    throttledRoutePreview,
    workspace.projection,
  ]);

  /** The subset a `refuse` commit would be rejected for; the HUD's "conflicts". */
  const drcBlocking = useMemo<DrcViolation[]>(
    () =>
      legalityContext
        ? blockingViolations(legalityContext, drcViolations)
        : EMPTY_VIOLATIONS,
    [drcViolations, legalityContext],
  );

  // Length-match gauge (pcb.lengthTuning): when the session net belongs to a
  // group, resolve its target + the net's already-committed copper so the HUD
  // shows "total / target". Longest targets exclude the session net itself.
  const routeLengthTarget = useMemo(() => {
    if (!lengthTuningEnabled) return null;
    if (routeState.kind !== "routing" || !routeState.session.netId) return null;
    const projection = workspace.projection;
    if (!projection) return null;
    const netId = routeState.session.netId;
    const group = (projection.board.lengthMatchGroups ?? []).find((g) =>
      g.netIds.includes(netId),
    );
    if (!group) return null;
    const lengthByNet = new Map<string, number>();
    for (const t of projection.traces) {
      if (t.netId === null || !group.netIds.includes(t.netId)) continue;
      lengthByNet.set(
        t.netId,
        (lengthByNet.get(t.netId) ?? 0) + routeLengthMm(t.pointsNm),
      );
    }
    const targetMm =
      group.target.kind === "absolute"
        ? group.target.mm
        : Math.max(
            0,
            ...group.netIds
              .filter((n) => n !== netId)
              .map((n) => lengthByNet.get(n) ?? 0),
          );
    if (targetMm <= 0) return null;
    return {
      groupName: group.name,
      targetMm,
      toleranceMm: group.toleranceMm,
      committedMm: lengthByNet.get(netId) ?? 0,
    };
  }, [lengthTuningEnabled, routeState, workspace.projection]);

  // Route HUD view-model (net, layer, width + source, via sizes, length, DRC).
  const routeHudModel = useMemo(() => {
    if (routeState.kind !== "routing") return null;
    const session = routeState.session;
    const board = workspace.projection?.board;
    const netClass =
      board?.netClasses.find((nc) => nc.id === session.netClassId) ?? null;
    const netName = session.netId
      ? (workspace.projection?.netNames[session.netId] ?? null)
      : null;
    return buildRouteHudModel({
      session,
      previewPathNm: routePreview?.pointsNm ?? sessionAnchors(session),
      netName,
      netClass,
      drcConflictCount: drcBlocking.length,
      drcWarningCount: drcViolations.length - drcBlocking.length,
      autoFinishEnabled,
      detourActive: (routePreview?.detourAnchorsNm?.length ?? 0) > 0,
      lengthTarget: routeLengthTarget,
    });
  }, [
    autoFinishEnabled,
    drcBlocking.length,
    drcViolations.length,
    routeLengthTarget,
    routePreview,
    routeState,
    workspace.projection,
  ]);

  // The inline width editor and the DRC gate state are session-scoped.
  useEffect(() => {
    if (routeState.kind !== "routing") {
      setWidthInputOpen(false);
      setAllowDrcViolations(false);
      setBlockedConflictCount(null);
      setAutoFinishNotice(null);
      setRouteNotice(null);
    }
  }, [routeState.kind]);

  // Transient surface for backend command rejections — previously these were
  // swallowed silently. A fresh error re-shows and re-arms the auto-dismiss.
  const [workspaceErrorVisible, setWorkspaceErrorVisible] = useState(false);
  useEffect(() => {
    if (!workspace.error) {
      setWorkspaceErrorVisible(false);
      return;
    }
    setWorkspaceErrorVisible(true);
    const timer = setTimeout(() => setWorkspaceErrorVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [workspace.error]);

  // Emit the live in-progress-trace conflict count only while routing; `null`
  // when idle so the status bar falls back to the full-board batch count.
  const onDrcCountChange = props.onDrcCountChange;
  const routing = routeState.kind === "routing";
  useEffect(() => {
    onDrcCountChange?.(routing ? drcBlocking.length : null);
  }, [routing, drcBlocking.length, onDrcCountChange]);

  const onSelectionCountChange = props.onSelectionCountChange;
  const selectionCount = pcbSelectionCount(selection);
  useEffect(() => {
    onSelectionCountChange?.(selectionCount);
  }, [selectionCount, onSelectionCountChange]);

  // Board-space cursor for the status bar (X / Y readout).
  const onCursorChange = props.onCursorChange;
  useEffect(() => {
    onCursorChange?.(
      cursorMm ? { xMm: cursorMm.x, yMm: cursorMm.y } : null,
    );
  }, [cursorMm, onCursorChange]);
  useEffect(() => {
    return () => onCursorChange?.(null);
  }, [onCursorChange]);

  // Effective copper layer for the status-bar chip + layer tab strip.
  const onActiveLayerChange = props.onActiveLayerChange;
  useEffect(() => {
    onActiveLayerChange?.(displayedCopperLayer);
  }, [displayedCopperLayer, onActiveLayerChange]);

  // Status-bar hint + selection summary. Both derive from the tool mode and the
  // selection only — never from the cursor — so pointer moves never re-render
  // the editor shell (the X/Y readout has its own store for that).
  const routeSessionActive = routeState.kind === "routing";
  const measureSessionActive = measureState.kind === "measuring";
  const sketchSessionActive = sketchState.kind === "drawing";

  const selectedPlacement = useMemo(() => {
    if (selection.placementIds.size !== 1) return null;
    const [id] = [...selection.placementIds];
    return workspace.projection?.placements.find((p) => p.id === id) ?? null;
  }, [selection.placementIds, workspace.projection?.placements]);

  const statusHint = useMemo(() => {
    if (toolMode === "route") {
      return routeSessionActive ? HINT_ROUTE_ACTIVE : HINT_ROUTE_IDLE;
    }
    if (toolMode === "measure") {
      return measureSessionActive ? HINT_MEASURE_ACTIVE : HINT_MEASURE_IDLE;
    }
    if (toolMode === "boardShape") {
      return sketchSessionActive ? HINT_SKETCH_ACTIVE : HINT_SKETCH_IDLE;
    }
    if (selectionCount === 1 && selectedPlacement) {
      return `${selectedPlacement.reference} — drag to move · R rotate · F flip · Del delete`;
    }
    return HINT_SELECT;
  }, [
    measureSessionActive,
    routeSessionActive,
    selectedPlacement,
    selectionCount,
    sketchSessionActive,
    toolMode,
  ]);

  const statusSelectionSummary = useMemo(() => {
    if (selectionCount === 0) return "No selection";
    if (selectionCount > 1) return `${selectionCount} selected`;
    const proj = workspace.projection;
    const netLabel = (netId: string | null | undefined): string | null => {
      if (!netId) return null;
      return proj?.netNames[netId] ?? netId;
    };
    if (selectedPlacement) {
      return `${selectedPlacement.reference} · ${selectedPlacement.footprint.name}`;
    }
    const traceId = [...selection.traceIds][0];
    if (traceId) {
      const net = netLabel(proj?.traces.find((t) => t.id === traceId)?.netId);
      return net ? `Trace · ${net}` : "Trace";
    }
    const viaId = [...selection.viaIds][0];
    if (viaId) {
      const net = netLabel(proj?.vias.find((v) => v.id === viaId)?.netId);
      return net ? `Via · ${net}` : "Via";
    }
    const holeId = [...(selection.freeHoleIds ?? [])][0];
    if (holeId) {
      const hole = proj?.freeHoles.find((h) => h.id === holeId);
      return hole ? `Hole · Ø ${hole.drillMm} mm` : "Hole";
    }
    const padId = [...(selection.freePadIds ?? [])][0];
    if (padId) {
      const pad = proj?.freePads.find((p) => p.id === padId);
      return pad ? `Pad · ${pad.widthMm} × ${pad.heightMm} mm` : "Pad";
    }
    const textId = [...(selection.overlayTextIds ?? [])][0];
    if (textId) {
      const text = proj?.overlayTexts.find((t) => t.id === textId);
      return text ? `Text · ${text.text}` : "Text";
    }
    return "1 selected";
  }, [selection, selectionCount, selectedPlacement, workspace.projection]);

  const onHintChange = props.onHintChange;
  useEffect(() => {
    onHintChange?.(statusHint);
  }, [statusHint, onHintChange]);

  const onSelectionSummaryChange = props.onSelectionSummaryChange;
  useEffect(() => {
    onSelectionSummaryChange?.(statusSelectionSummary);
  }, [statusSelectionSummary, onSelectionSummaryChange]);

  const onPlacementCountChange = props.onPlacementCountChange;
  const placementCount = workspace.projection?.placements.length ?? 0;
  useEffect(() => {
    onPlacementCountChange?.(placementCount);
  }, [placementCount, onPlacementCountChange]);

  // "Edit rules…" from the Board properties and "Edit rules" in the DRC view
  // share one dialog + one `pcb_set_design_rules` envelope (see the hook).
  const handleRulesSaved = useCallback(() => {
    // Rules go through the PCB undo stack; refresh history so Undo enables.
    void workspace.refresh().then(() => workspace.refreshHistory());
  }, [workspace.refresh, workspace.refreshHistory]);
  const rulesDialog = usePcbDesignRulesDialog({
    backendURL: props.backendURL,
    moduleId: props.moduleId,
    designId: props.designId,
    sessionId: "designer-pcb-session",
    projection: workspace.projection ?? null,
    onSaved: handleRulesSaved,
  });

  /**
   * Board settings body. Rendered inside the right dock's Properties tab
   * (its idle state).
   */
  const boardPanelElement = (
    <PcbBoardPanel
      workspace={workspace}
      widthText={widthText}
      setWidthText={setWidthText}
      heightText={heightText}
      setHeightText={setHeightText}
      widthMm={widthMm}
      heightMm={heightMm}
      valid={valid}
      currentOutline={workspace.projection?.board.outline ?? null}
      outsideCount={outsideCount}
      onApplyOutline={(outline) =>
        void workspace
          .updateBoardOutline(outline)
          .then(() => cameraControlsRef.current?.fit())
      }
      onFitToParts={() =>
        void workspace
          .fitBoardToParts()
          .then(() => cameraControlsRef.current?.fit())
      }
      editMode={boardDimMode}
      onToggleEditMode={() =>
        setBoardDimMode((prev) => {
          // Entering edit mode forces the select tool so the edge handles are
          // interactive (route/measure would intercept).
          if (!prev) setToolMode("select");
          return !prev;
        })
      }
      onDrawShape={() => {
        dispatchSketch({ kind: "cancel" });
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        setBoardDimMode(false);
        setToolMode("boardShape");
      }}
      onImportDxf={() => {
        setBoardDimMode(false);
        setDxfImportOpen(true);
      }}
      onEditRules={rulesDialog.open}
      canEditRules={rulesDialog.available}
    />
  );

  /**
   * Sidebar Components row click: single-select the placement (clearing every
   * other kind, exactly like a canvas click) and centre the camera on it.
   */
  const handleSelectComponent = useCallback(
    (placementId: string) => {
      // Mirror the toolbar exits: leave any in-flight tool session before
      // switching to select, otherwise routing/measure state lingers.
      dispatchRoute({ kind: "cancel" });
      dispatchMeasure({ kind: "clear" });
      dispatchSketch({ kind: "cancel" });
      dispatchTune({ kind: "cancel" });
      setToolMode("select");
      setSelection({
        ...emptyPcbSelection(),
        placementIds: new Set([placementId]),
      });
      const placement = workspace.projection?.placements.find(
        (p) => p.id === placementId,
      );
      if (!placement) return;
      // The board mirror group flips X in bottom view, so flip the target too.
      const scaleX = workspace.viewSide === "bottom" ? -1 : 1;
      cameraControlsRef.current?.centerOnMm({
        x: scaleX * placement.positionMm.x,
        y: placement.positionMm.y,
      });
    },
    [workspace.projection?.placements, workspace.viewSide],
  );

  /**
   * Single entry point for "make this the active layer" — shared by the Layers
   * panel rows and the layer tab strip so both follow the same path.
   */
  const handleSetActiveLayer = useCallback(
    (layer: PcbLayerId) => {
      if (
        layer === "F.Cu" ||
        layer === "B.Cu" ||
        layer === "In1.Cu" ||
        layer === "In2.Cu"
      ) {
        setFocusedLayer((prev) => (prev === layer ? null : layer));
        void setActiveCopperLayer(layer);
      }
    },
    [setActiveCopperLayer],
  );

  const routeStartPadId =
    routeState.kind === "routing" ? routeState.session.startPadId : undefined;
  const routeGuideExcludePadIds = useMemo(
    () =>
      routeStartPadId !== undefined ? new Set([routeStartPadId]) : undefined,
    [routeStartPadId],
  );

  const sceneRouteGuide = useMemo(() => {
    if (
      routeState.kind !== "routing" ||
      !routeState.session.netId ||
      !cursorMm
    ) {
      return null;
    }
    return {
      cursorMm,
      netId: routeState.session.netId,
      ...(routeGuideExcludePadIds !== undefined
        ? { excludePadIds: routeGuideExcludePadIds }
        : {}),
    };
  }, [cursorMm, routeGuideExcludePadIds, routeState]);

  // Routing alignment guides (cyan angle/extend rays + yellow collinear-pad
  // lines) rendered while a trace is in progress. Same engine the route-snap
  // helper uses; recomputed on the same cadence as the preview.
  const sceneRouteGuides = useMemo<RouteGuide[]>(() => {
    if (
      !alignmentGuidesEnabled ||
      routeState.kind !== "routing" ||
      !cursorMm ||
      !workspace.projection
    ) {
      return [];
    }
    const session = routeState.session;
    const anchors = sessionAnchors(session);
    const last = anchors[anchors.length - 1]!;
    const prior = anchors[anchors.length - 2];
    return computeRouteGuides({
      anchorMm: { x: last.x / NM_PER_MM, y: last.y / NM_PER_MM },
      ...(prior
        ? { priorMm: { x: prior.x / NM_PER_MM, y: prior.y / NM_PER_MM } }
        : {}),
      cursorMm,
      posture: session.posture,
      placements: workspace.projection.placements,
      traces: [...workspace.projection.traces, ...pendingRouteGeometry.traces],
      vias: [...workspace.projection.vias, ...pendingRouteGeometry.vias],
      activeLayer: session.layer,
      netId: session.netId,
      toleranceMm: SNAP_THRESHOLD_PX / drcZoomRef.current,
    }).guides;
  }, [
    alignmentGuidesEnabled,
    cursorMm,
    pendingRouteGeometry,
    routeState,
    workspace.projection,
  ]);

  // Accumulated (uncommitted) runs ghost-rendered beside the live head.
  const sceneRoutePendingPreview = useMemo(() => {
    if (pendingRouteGeometry.traces.length === 0) return null;
    return pendingRouteGeometry.traces.map((t) => ({
      pointsNm: t.pointsNm,
      layer: t.layer,
      widthMm: t.widthMm,
    }));
  }, [pendingRouteGeometry]);

  const sceneRoutePreview = useMemo(() => {
    if (!routePreview) return null;
    return {
      pointsNm: routePreview.pointsNm,
      layer: routePreview.layer,
      widthMm:
        routeState.kind === "routing"
          ? routeState.session.widthMm
          : (defaultNetClass?.traceWidthMm ?? 0.25),
    };
  }, [defaultNetClass?.traceWidthMm, routePreview, routeState]);

  // Dimmed auto-finish proposal ghost (explicit-accept preview).
  const sceneAutoFinishPreview = useMemo(() => {
    if (!autoFinishProposal || routeState.kind !== "routing") return null;
    return {
      pointsNm: autoFinishProposal.pathNm,
      layer: routeState.session.layer,
      widthMm: routeState.session.widthMm,
    };
  }, [autoFinishProposal, routeState]);

  // Board-shape draw preview: committed vertices + the rubber-band to the
  // (snapped, optionally 45°-locked) cursor. Null unless actively drawing.
  const sketchPreview = useMemo(() => {
    if (sketchTargetFor(toolMode) === null || sketchState.kind !== "drawing") {
      return null;
    }
    const vertices = sketchState.session.verticesMm;
    let preview: PcbPointMm | null = null;
    let infer: InferResult | null = null;
    if (cursorMm) {
      const last = vertices[vertices.length - 1]!;
      const snapped = snapPoint(cursorMm);
      const resolved = resolveSketchTarget(last, snapped, {
        shiftLock: shiftHeldRef.current,
        ...(sketchEntry ? parsedEntry(sketchEntry) : {}),
        others: vertices.slice(0, -1),
        tolMm: SNAP_THRESHOLD_PX / drcZoomRef.current,
      });
      preview = resolved.point;
      infer = resolved.infer;
    }
    const target = sketchState.session.target;
    // A cutout is drawn in its parent zone's layer colour, not the zone tool's.
    const color =
      target === "zone"
        ? copperLayerColor(areaTools.zoneOptions.layer)
        : target === "zoneHole"
          ? copperLayerColor(
              selectedPolygonZone?.layer ?? areaTools.zoneOptions.layer,
            )
          : target === "keepout"
            ? KEEPOUT_COLOR
            : undefined;
    return { vertices, preview, infer, color };
  }, [
    areaTools.zoneOptions.layer,
    selectedPolygonZone,
    cursorMm,
    snapPoint,
    sketchState,
    toolMode,
    sketchEntry,
  ]);
  const sketchPreviewRef = useRef(sketchPreview);
  sketchPreviewRef.current = sketchPreview;

  // Live length/angle of the rubber-band edge, for the at-cursor readout box.
  const sketchReadout = useMemo(() => {
    if (!sketchPreview?.preview || sketchPreview.vertices.length === 0) return null;
    const last = sketchPreview.vertices[sketchPreview.vertices.length - 1]!;
    const m = measureBetween(last, sketchPreview.preview);
    return { lengthMm: m.distanceMm, angleDeg: m.angleDeg };
  }, [sketchPreview]);

  const sceneMarqueeOverlay = useMemo(
    () => ({
      a: marquee.overlayProps.a,
      b: marquee.overlayProps.b,
      color: marquee.overlayProps.color,
    }),
    [
      marquee.overlayProps.a,
      marquee.overlayProps.b,
      marquee.overlayProps.color,
    ],
  );

  const sceneMeasurement = useMemo(() => {
    if (measureState.kind === "locked") {
      return {
        start: measureState.start.pointMm,
        end: measureState.end.pointMm,
        showDeltas: measureShowDeltas,
      };
    }
    if (measureState.kind === "measuring" && cursorMm) {
      return {
        start: measureState.start.pointMm,
        end: resolveMeasureAnchor(cursorMm).pointMm,
        showDeltas: measureShowDeltas,
      };
    }
    return null;
  }, [cursorMm, measureShowDeltas, measureState, resolveMeasureAnchor]);

  // Derive inspector selection from the first selected item of each new type.
  const inspectorSelection = useMemo((): PcbInspectorSelection => {
    const proj = workspace.projection;
    if (!proj) return null;
    const holeId = [...(selection.freeHoleIds ?? [])][0];
    if (holeId) {
      const hole = proj.freeHoles.find((h) => h.id === holeId);
      if (hole) return { kind: "freeHole", hole };
    }
    const padId = [...(selection.freePadIds ?? [])][0];
    if (padId) {
      const pad = proj.freePads.find((p) => p.id === padId);
      if (pad) return { kind: "freePad", pad };
    }
    const textId = [...(selection.overlayTextIds ?? [])][0];
    if (textId) {
      const text = proj.overlayTexts.find((t) => t.id === textId);
      if (text) return { kind: "overlayText", text };
    }
    const zoneId = [...(selection.zoneIds ?? [])][0];
    if (zoneId) {
      const zone = proj.zones.find((z) => z.id === zoneId);
      if (zone) return { kind: "zone", zone };
    }
    const keepoutId = [...(selection.keepoutIds ?? [])][0];
    if (keepoutId) {
      const keepout = proj.keepouts.find((k) => k.id === keepoutId);
      if (keepout) return { kind: "keepout", keepout };
    }
    return null;
  }, [selection, workspace.projection]);

  // Mirror the X axis in bottom-view.
  // PcbScene mirrors board content whenever `viewSide === "bottom"`; pointer
  // hits come back in post-flip world space, so negate X here to recover
  // DB-space coords.
  const interactionCoordinateTransform =
    useMemo<InteractionCoordinateTransform>(
      () => ({
        sceneUnit: "mm",
        worldUnit: "nm",
        yAxis: "up",
        scenePointToWorldPoint: (p) => ({
          x: sceneMmToNm((mirrorActive ? -p.x : p.x) as typeof p.x),
          y: sceneMmToNm(p.y),
        }),
      }),
      [mirrorActive],
    );

  if (!props.designId) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-canvas-well text-sm text-text-tertiary">
        Select or create a design to open PCB layout
      </div>
    );
  }

  const canvasCursor = boardResizeSession
    ? handleCursor(boardResizeSession.handle)
    : boardHandleCursor;

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full bg-surface-canvas-well"
      style={canvasCursor ? { cursor: canvasCursor } : undefined}
    >
      {workspace.projection ? (
        <EdaCanvas
          key={props.designId}
          testId="designer-pcb-canvas"
          initialZoom={DEFAULT_PCB_ZOOM}
          backgroundColor="#0e1116"
          interactionHandler={handler}
          interactionCoordinateTransform={interactionCoordinateTransform}
        >
          <PcbScene
            projection={workspace.projection}
            effectiveKeepouts={effectiveKeepouts}
            selection={sceneSelection}
            outlineOverride={
              boardResizeSession?.currentRect ??
              vertexDragSession?.current ??
              cornerPreviewOutline ??
              committedOutlineOverride
            }
            boardHandlesVisible={
              boardDimMode &&
              toolMode === "select" &&
              !!workspace.projection &&
              !isEditableOutline(workspace.projection.board.outline)
            }
            vertexHandlesVisible={
              boardDimMode &&
              toolMode === "select" &&
              !!workspace.projection &&
              isEditableOutline(workspace.projection.board.outline)
            }
            sketchPreview={sketchPreview}
            dragOverride={dragOverride}
            freePrimitiveDragOverrides={freePrimitiveDragOverrides}
            highlightedNetId={workspace.highlightedNetId}
            ratsnestVisible={workspace.ratsnestVisible}
            viewSide={workspace.viewSide}
            displayMode={workspace.displayMode}
            routeGuide={sceneRouteGuide}
            routeGuides={sceneRouteGuides}
            routePreview={sceneRoutePreview}
            autoroutePreview={autoroutePreview}
            routePendingPreview={sceneRoutePendingPreview}
            routePendingVias={pendingRouteGeometry.vias}
            autoFinishPreview={sceneAutoFinishPreview}
            tunePreview={sceneTunePreview}
            tuneSpanPreview={sceneTuneSpan}
            bundlePreview={sceneBundlePreview}
            bundlePadsMm={sceneBundlePads}
            previewBasePlacements={proposedEffective}
            previewFromMarkers={placePreviewFromMarkers}
            routeFocusActive={routeState.kind === "routing"}
            routeFocusLayer={
              routeState.kind === "routing"
                ? routeState.session.layer
                : activeCopperLayer
            }
            focusedLayer={focusedLayer}
            areaDragOverride={areaInteractions.areaDragOverride}
            areaVertexHandles={
              areaInteractions.vertexHandlePoints.length > 0
                ? { pointsMm: areaInteractions.vertexHandlePoints }
                : null
            }
            marqueeOverlay={sceneMarqueeOverlay}
            measurement={sceneMeasurement}
            snapTarget={snapTarget}
            alignmentGuides={alignmentGuides}
            alignmentSpacing={alignmentSpacing}
            initialViewport={props.initialViewport}
            onViewportChange={(zoom, posX, posY) => {
              // Capture live zoom for DOM-side DRC marker hit-test tolerance.
              drcZoomRef.current = zoom;
              commentProjection.setViewport(zoom, posX, posY);
              props.onViewportChange?.(zoom, posX, posY);
            }}
            onCameraReady={handleCameraReady}
          />
        </EdaCanvas>
      ) : null}
      {workspace.projection ? (
        <CanvasCommentLayer
          threads={props.commentThreads ?? []}
          activeThreadId={props.activeCommentThreadId ?? null}
          mirrored={mirrorActive}
          rect={commentProjection.rect}
          project={commentProjection.project}
          screenToWorld={commentProjection.screenToWorld}
          clampToEdge={commentProjection.clampToEdge}
          draft={commentDraft}
          currentUserEmail={props.currentUserEmail ?? null}
          attachmentUrl={props.commentAttachmentUrl ?? (() => "")}
          onCreateComment={(anchor, body) => {
            props.onCreateComment?.(anchor, body);
            setCommentDraft(null);
          }}
          onCancelDraft={() => setCommentDraft(null)}
          onOpenThread={(id) => props.onSelectCommentThread?.(id)}
          onCloseThread={() => props.onCloseCommentThread?.()}
          onRecenter={recenterOnComment}
          onMoveComment={(thread, pointNm) =>
            props.onMoveComment?.(thread, pointNm)
          }
          onAddMessage={async (thread, body, file) => {
            await props.onAddCommentMessage?.(thread, body, file);
          }}
          onSetStatus={async (thread, status) => {
            await props.onSetCommentStatus?.(thread, status);
          }}
          onSetTodoStatus={async (thread, todoStatus) => {
            await props.onSetCommentTodoStatus?.(thread, todoStatus);
          }}
          onToggleReaction={async (thread, messageId, emoji) => {
            await props.onToggleCommentReaction?.(thread, messageId, emoji);
          }}
        />
      ) : null}
      {workspace.projection ? (
        <CanvasZoomCluster
          onZoomIn={() => cameraControlsRef.current?.zoomIn()}
          onZoomOut={() => cameraControlsRef.current?.zoomOut()}
          onFit={() => cameraControlsRef.current?.fit()}
        />
      ) : null}
      {workspace.projection && selectionFilterPanelOpen ? (
        <PcbSelectionFilter
          filter={selectionFilter}
          onChange={(kind, enabled) =>
            usePcbViewStore.getState().setSelectionFilter(kind, enabled)
          }
          onClose={() =>
            usePcbViewStore.getState().toggleSelectionFilterPanel()
          }
        />
      ) : null}
      {disambigPopup ? (
        <PcbDisambiguationPopup
          items={disambigPopup.candidates.map((candidate) => ({
            candidate,
            label: formatCandidateLabel(candidate),
          }))}
          activeIndex={disambigPopup.activeIndex}
          screenX={disambigPopup.screenX}
          screenY={disambigPopup.screenY}
          onPick={(index) => {
            const candidate = disambigPopup.candidates[index];
            if (candidate) applyDisambigPick(candidate);
            setDisambigPopup(null);
          }}
          onClose={() => setDisambigPopup(null)}
          onCycle={(direction) =>
            setDisambigPopup((prev) => {
              if (!prev) return prev;
              const len = prev.candidates.length;
              const nextIndex = (prev.activeIndex + direction + len) % len;
              const next = prev.candidates[nextIndex];
              if (next) applyDisambigPick(next);
              return { ...prev, activeIndex: nextIndex };
            })
          }
        />
      ) : null}
      {workspace.projection && mirrorActive ? (
        <>
          {/* Cool-blue background tint signals bottom-view at-a-glance.
              DOM overlay only — does not affect R3F clear color. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 bg-status-info/[0.04]"
            data-testid="pcb-flip-tint"
          />
          {/* Status badge — always visible when flipped, even if toolbar is
              occluded. */}
          <div
            className="pointer-events-none absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-control border border-selection/60 bg-selection-soft px-2 py-0.5 text-[11px] font-medium text-selection shadow-sm backdrop-blur"
            data-testid="pcb-viewing-bottom-badge"
          >
            <FlipHorizontal2 className="h-3 w-3" />
            Viewing from bottom
          </div>
        </>
      ) : null}
      {workspace.projection && props.toolbarTarget
        ? createPortal(
            <PcbTopToolbar
              selectedPlacementCount={selection.placementIds.size}
              onFlipSelection={() => {
                const ids = [...selection.placementIds];
                if (ids.length === 0) return;
                if (ids.length === 1) void workspace.flipPlacement(ids[0]!);
                else void workspace.flipPlacements(ids);
              }}
              ratsnestVisible={workspace.ratsnestVisible}
              onToggleRatsnest={workspace.toggleRatsnestVisible}
              alignmentGuidesVisible={alignmentGuidesEnabled}
              onToggleAlignmentGuides={() =>
                usePcbViewStore.getState().toggleAlignmentGuidesVisible()
              }
              drcPanelOpen={drcPanelOpen}
              onToggleDrcPanel={toggleDrcPanel}
              drcErrorCount={drcErrorCount}
              drcRunning={drcRunning}
              drcMarkersVisible={drcMarkersVisible}
              onToggleDrcMarkers={toggleDrcMarkers}
              canUndo={workspace.canUndo}
              canRedo={workspace.canRedo}
              onUndo={() => void workspace.undo()}
              onRedo={() => void workspace.redo()}
              onFit={() => cameraControlsRef.current?.fit()}
              onExport={() => setExportDialogOpen(true)}
              routeMode={toolMode === "route"}
              onToggleRouteMode={() => {
                setToolMode((prev) => (prev === "route" ? "select" : "route"));
                if (toolMode === "route") dispatchRoute({ kind: "cancel" });
                dispatchMeasure({ kind: "clear" });
              }}
              boardShapeMode={toolMode === "boardShape"}
              onToggleBoardShape={() => {
                dispatchSketch({ kind: "cancel" });
                dispatchRoute({ kind: "cancel" });
                dispatchMeasure({ kind: "clear" });
                setBoardDimMode(false);
                setToolMode((prev) =>
                  prev === "boardShape" ? "select" : "boardShape",
                );
              }}
              commentMode={props.commentMode ?? false}
              onToggleCommentMode={
                props.onToggleCommentMode
                  ? () => props.onToggleCommentMode?.()
                  : undefined
              }
              holeMode={toolMode === "hole"}
              onToggleHoleMode={() => {
                setToolMode((prev) => (prev === "hole" ? "select" : "hole"));
                dispatchRoute({ kind: "cancel" });
                dispatchMeasure({ kind: "clear" });
              }}
              padMode={toolMode === "pad"}
              onTogglePadMode={() => {
                setToolMode((prev) => (prev === "pad" ? "select" : "pad"));
                dispatchRoute({ kind: "cancel" });
                dispatchMeasure({ kind: "clear" });
              }}
              textMode={toolMode === "text"}
              onToggleTextMode={() => {
                setToolMode((prev) => (prev === "text" ? "select" : "text"));
                dispatchRoute({ kind: "cancel" });
                dispatchMeasure({ kind: "clear" });
              }}
              zoneMode={toolMode === "zone"}
              onToggleZoneMode={() => {
                dispatchSketch({ kind: "cancel" });
                setBoardDimMode(false);
                setToolMode((prev) => (prev === "zone" ? "select" : "zone"));
                dispatchRoute({ kind: "cancel" });
                dispatchMeasure({ kind: "clear" });
              }}
              keepoutMode={toolMode === "keepout"}
              onToggleKeepoutMode={() => {
                dispatchSketch({ kind: "cancel" });
                setBoardDimMode(false);
                setToolMode((prev) =>
                  prev === "keepout" ? "select" : "keepout",
                );
                dispatchRoute({ kind: "cancel" });
                dispatchMeasure({ kind: "clear" });
              }}
            />,
            props.toolbarTarget,
          )
        : null}
      {!workspace.projection ? (
        <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
          {workspace.loading ? "Loading PCB..." : "PCB projection unavailable"}
        </div>
      ) : null}

      {workspace.projection && props.designId ? (
        <>
          <PcbExportDialog
            backendURL={props.backendURL}
            moduleId={props.moduleId}
            designId={props.designId}
            open={exportDialogOpen}
            onClose={() => setExportDialogOpen(false)}
          />
          {props.autoLayoutEnabled ? (
            <>
              {!previewActive ? (
                <div className="absolute bottom-12 right-3 z-20 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAutoLayoutOpen(true)}
                    title="Place and route the whole board in OpenPCB Cloud, then pick from complete candidates"
                    data-testid="pcb-autolayout-button"
                    className="inline-flex items-center gap-1.5 rounded-control border border-selection bg-surface-raised px-2.5 py-1 text-xs font-medium text-selection shadow-sm hover:bg-selection-soft"
                  >
                    Auto Layout…
                  </button>
                  <button
                    type="button"
                    onClick={() => setRouteBoardOpen(true)}
                    title="Route the board as placed — components are never moved"
                    data-testid="pcb-route-board-button"
                    className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface-raised px-2.5 py-1 text-xs font-medium text-text shadow-sm hover:bg-surface-hover"
                  >
                    Route Board…
                  </button>
                  <button
                    type="button"
                    onClick={() => setAutoPlaceOpen(true)}
                    title="Advanced: optimize placement only, then review the ghost before applying"
                    data-testid="pcb-autoplace-button"
                    className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface-raised px-2.5 py-1 text-xs font-medium text-text shadow-sm hover:bg-surface-hover"
                  >
                    Auto Place…
                  </button>
                </div>
              ) : null}
              <AutoLayoutDialog
                backendURL={props.backendURL}
                moduleId={props.moduleId}
                designId={props.designId ?? ""}
                cloudHeaders={props.cloudHeaders}
                open={autoLayoutOpen}
                onClose={() => {
                  setCandidatePreview(null);
                  setAutoLayoutOpen(false);
                }}
                placements={workspace.projection?.placements ?? []}
                selectedPlacementIds={[...selection.placementIds]}
                config={seededAutoLayoutConfig}
                onConfigChange={(cfg) => {
                  setAutoLayoutConfig(cfg);
                  writeGlobalDefaultConfig(cfg);
                }}
                signedIn={Boolean(props.autoLayoutSignedIn)}
                sessionId="designer-pcb-session"
                onApplied={() => void workspace.refresh()}
                onPreviewChange={setCandidatePreview}
              />
              <PcbAutoplaceDialog
                backendURL={props.backendURL}
                moduleId={props.moduleId}
                designId={props.designId}
                cloudHeaders={props.cloudHeaders}
                open={autoPlaceOpen && !previewActive}
                onClose={() => setAutoPlaceOpen(false)}
                onPreviewResult={handlePreviewResult}
              />
              <PcbAutorouteDialog
                backendURL={props.backendURL}
                moduleId={props.moduleId}
                designId={props.designId}
                cloudHeaders={props.cloudHeaders}
                open={routeBoardOpen}
                request={toRouteRequest(seededAutoLayoutConfig)}
                onClose={() => {
                  setAutoroutePreview(null);
                  setRouteBoardOpen(false);
                }}
                onApplied={() => void workspace.refresh()}
                onPreviewChange={setAutoroutePreview}
              />
              {previewActive ? (
                <PcbPlacePreviewBar
                  payload={placePreviewPayload}
                  changedCount={placePreviewFromMarkers?.length ?? 0}
                  applying={placeApplying}
                  appliedNote={null}
                  appliedHasIssues={false}
                  onAccept={() => void acceptPreview()}
                  onReject={rejectPreview}
                />
              ) : null}
              {placeAppliedNote ? (
                <div
                  role="status"
                  className={
                    placeAppliedNote.issues
                      ? "absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-control border border-status-warning bg-status-warning-soft px-3 py-1.5 text-[11px] text-status-warning shadow-lg"
                      : "absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-control border border-status-success bg-status-success-soft px-3 py-1.5 text-[11px] text-status-success shadow-lg"
                  }
                >
                  {placeAppliedNote.text}
                </div>
              ) : null}
            </>
          ) : null}
          {/* General overlays — NOT gated on autoLayoutEnabled: the route HUD
              and command-rejection toast must work without any cloud config
              (an earlier nesting inside the auto-layout fragment hid them). */}
          {workspaceErrorVisible && workspace.error ? (
            <div
              role="alert"
              className="absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-control border border-status-danger bg-status-danger-soft px-3 py-1.5 text-[11px] text-status-danger shadow-lg"
            >
              {workspace.error}
              <button
                type="button"
                aria-label="Dismiss error"
                className="rounded-control px-1 hover:bg-status-danger-soft"
                onClick={() => setWorkspaceErrorVisible(false)}
              >
                ×
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {boardResizeSession && cursorClientPx ? (
        <div
          className="pointer-events-none fixed z-30 flex items-center gap-2 rounded-control border border-selection/60 bg-surface-raised/95 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-text-strong shadow-lg backdrop-blur"
          style={{
            left: cursorClientPx.x + 14,
            top: cursorClientPx.y + 14,
          }}
        >
          <span>
            {roundDimMm(boardResizeSession.currentRect.widthMm)} ×{" "}
            {roundDimMm(boardResizeSession.currentRect.heightMm)} mm
          </span>
          {(() => {
            const dw = roundDimMm(
              boardResizeSession.currentRect.widthMm -
                boardResizeSession.initialRect.widthMm,
            );
            const dh = roundDimMm(
              boardResizeSession.currentRect.heightMm -
                boardResizeSession.initialRect.heightMm,
            );
            if (dw === 0 && dh === 0) return null;
            const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
            return (
              <span className="text-text-tertiary">
                Δ {fmt(dw)}, {fmt(dh)}
              </span>
            );
          })()}
        </div>
      ) : null}

      {vertexDragSession &&
      cursorClientPx &&
      isEditableOutline(vertexDragSession.current)
        ? (() => {
            const v = outlineVertices(vertexDragSession.current)[
              vertexDragSession.vIndex
            ];
            if (!v) return null;
            return (
              <div
                className="pointer-events-none fixed z-30 rounded-control border border-selection/60 bg-surface-raised/95 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-text-strong shadow-lg backdrop-blur"
                style={{ left: cursorClientPx.x + 14, top: cursorClientPx.y + 14 }}
              >
                {roundDimMm(v.x)}, {roundDimMm(v.y)} mm
              </div>
            );
          })()
        : null}

      {toolMode === "route" && cursorClientPx ? (
        <div
          className="pointer-events-none fixed z-30 flex items-center gap-1.5 rounded-control border border-border bg-surface-raised/95 px-2 py-0.5 text-[10px] font-medium text-text-strong shadow-lg backdrop-blur"
          style={{
            left: cursorClientPx.x + 14,
            top: cursorClientPx.y + 14,
          }}
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: copperLayerColor(displayedCopperLayer) }}
          />
          {displayedCopperLayer === "F.Cu"
            ? "Top"
            : displayedCopperLayer === "In1.Cu"
              ? "Mid 1"
              : displayedCopperLayer === "In2.Cu"
                ? "Mid 2"
                : "Bottom"}
        </div>
      ) : null}

      {drcHoveredId && cursorClientPx
        ? (() => {
            const v = drcReport?.violations.find((x) => x.id === drcHoveredId);
            if (!v) return null;
            const sev = DRC_SEVERITY[v.severity];
            return (
              <div
                className="pointer-events-none fixed z-40 max-w-[280px] rounded-float border border-border bg-surface-raised/95 px-2.5 py-1.5 text-[11px] text-text-strong shadow-lg backdrop-blur"
                style={{
                  left: cursorClientPx.x + 14,
                  top: cursorClientPx.y + 14,
                }}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: sev.core }}
                  />
                  {CODE_LABEL[v.code] ?? v.code}
                </div>
                <div className="mt-0.5 text-text-secondary">
                  {v.anchors
                    .map((a) =>
                      resolveAnchorLabel(a, workspace.projection ?? null),
                    )
                    .join(" ↔ ")}
                </div>
                {v.layer ||
                (v.measuredMm !== undefined && v.requiredMm !== undefined) ? (
                  <div className="mt-0.5 text-[10px] text-text-tertiary">
                    {v.layer ? <span className="mr-2">{v.layer}</span> : null}
                    {v.measuredMm !== undefined && v.requiredMm !== undefined
                      ? `${v.measuredMm.toFixed(3)} / ${v.requiredMm.toFixed(3)} mm`
                      : null}
                  </div>
                ) : null}
                <div className="mt-1 text-[10px] leading-snug text-text-tertiary">
                  {v.message}
                </div>
              </div>
            );
          })()
        : null}

      {sketchTargetFor(toolMode) !== null && sketchState.kind === "drawing" ? (
        <SketchDimEntry
          entry={sketchEntry}
          readout={sketchReadout}
          constraint={sketchPreview?.infer?.kind ?? null}
          cursorClientPx={cursorClientPx}
        />
      ) : null}
      {toolMode === "zone" ||
      toolMode === "keepout" ||
      toolMode === "zoneHole" ? (
        <AreaToolOptionsBar
          target={toolMode}
          cutoutMode={toolMode === "zoneHole"}
          canCutout={selectedPolygonZone !== null}
          onToggleCutout={() => {
            dispatchSketch({ kind: "cancel" });
            if (toolMode === "zoneHole") {
              setToolMode("zone");
              return;
            }
            if (!selectedPolygonZone) {
              setZoneHoleNotice(ZONE_HOLE_NO_SUBJECT_NOTICE);
              return;
            }
            setToolMode("zoneHole");
          }}
          zoneOptions={areaTools.zoneOptions}
          onZoneChange={areaTools.setZoneOptions}
          keepoutOptions={areaTools.keepoutOptions}
          onKeepoutChange={areaTools.setKeepoutOptions}
          layerCount={workspace.projection?.board.layerCount ?? 2}
          nets={workspace.nets}
          error={areaTools.error}
        />
      ) : null}
      {zoneHoleNotice ? (
        <div
          data-testid="pcb-tool-notice"
          className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-control border border-border bg-surface-raised/95 px-2.5 py-1.5 text-[11px] text-status-warning shadow-lg backdrop-blur"
        >
          <span role="alert">{zoneHoleNotice}</span>
        </div>
      ) : null}

      {workspace.projection && props.layersPanelTarget
        ? createPortal(
            <PcbLayersPanel
              headerTarget={props.layersHeaderTarget ?? null}
              activeLayer={focusedLayer}
              lockedVisibleLayer={displayedCopperLayer}
              routingLayer={
                routeState.kind === "routing" ? routeState.session.layer : null
              }
              onSetActiveLayer={handleSetActiveLayer}
              visibleLayers={workspace.projection.board.visibleLayers}
              onSetVisibleLayers={(layers) =>
                void workspace.setVisibleLayers(layers)
              }
              layerCount={workspace.projection.board.layerCount}
              displayMode={workspace.displayMode}
              onSetDisplayMode={workspace.setDisplayMode}
              boardZones={workspace.projection.zones}
              nets={workspace.nets}
              onToggleBoardZone={(layer) => {
                const zones = workspace.projection?.zones ?? EMPTY_ZONES;
                const action = boardZoneToggleAction(zones, layer);
                const enabling =
                  action.kind === "add" ? true : action.enabled;
                if (enabling && !visibleLayers.has(layer)) {
                  void workspace.setVisibleLayers([
                    ...(workspace.projection?.board.visibleLayers ?? []),
                    layer,
                  ]);
                }
                if (action.kind === "add") {
                  // A new board plane defaults to the ground net by name, the
                  // same default the zone tool uses (contract §12.3).
                  void workspace.addZone({
                    layer,
                    net: defaultZoneToolOptions({
                      activeLayer: layer,
                      netNames: workspace.projection?.netNames ?? EMPTY_NET_NAMES,
                    }).net,
                    region: { kind: "board" },
                    padConnection: "solid",
                  });
                  return;
                }
                void workspace.updateZone(action.zoneId, {
                  enabled: action.enabled,
                });
              }}
              onSetBoardZoneNet={(layer, net) => {
                const row = boardZoneForLayer(
                  workspace.projection?.zones ?? EMPTY_ZONES,
                  layer,
                );
                if (row) void workspace.updateZone(row.id, { net });
              }}
              onSetBoardZonePadConnection={(layer, padConnection) => {
                const row = boardZoneForLayer(
                  workspace.projection?.zones ?? EMPTY_ZONES,
                  layer,
                );
                if (row) void workspace.updateZone(row.id, { padConnection });
              }}
              onCleanupPourTraces={() => void workspace.cleanupPourTraces()}
              onSelectLayerPreset={(preset) => {
                if (preset === "custom") return;
                // Resolve the preset spec, then apply via workspace methods
                // so the projection refresh + focusedLayer state update both
                // run. The view-side portion lands through the store (the
                // store dispatches `pcb_set_view_state` debounced).
                const spec = PCB_LAYER_PRESETS.find((p) => p.id === preset);
                if (!spec) return;
                void (async () => {
                  // Active layer FIRST so the backend's auto-pin into
                  // visibleLayers uses the new active layer (avoids
                  // force-adding the old activeLayer to the new preset's set).
                  if (spec.activeLayer) {
                    if (
                      spec.activeLayer === "F.Cu" ||
                      spec.activeLayer === "B.Cu" ||
                      spec.activeLayer === "In1.Cu" ||
                      spec.activeLayer === "In2.Cu"
                    ) {
                      setFocusedLayer(spec.activeLayer);
                      await setActiveCopperLayer(spec.activeLayer);
                    }
                  }
                  await workspace.setVisibleLayers(spec.visibleLayers);
                  // viewSide + layerPreset live in the view state (durable
                  // but non-undoable); apply through the store.
                  usePcbViewStore.getState().setLayerPreset(preset);
                })();
              }}
              perLayerOpacity={layerOpacity}
              onSetLayerOpacity={(layer, opacity) =>
                usePcbViewStore.getState().setLayerOpacity(layer, opacity)
              }
              soloLayer={soloLayer}
              onToggleSoloLayer={(layer, isActivatable) => {
                usePcbViewStore
                  .getState()
                  .toggleSoloLayer(layer, isActivatable);
                const next = usePcbViewStore.getState();
                void workspace.setVisibleLayers(next.visibleLayers);
                if (next.activeLayer) {
                  void workspace.setActiveLayer(next.activeLayer);
                }
                // Solo also bumps focus to the soloed layer when activatable
                // so the active-layer pill + tool routing target follow.
                if (
                  isActivatable &&
                  (layer === "F.Cu" ||
                    layer === "B.Cu" ||
                    layer === "In1.Cu" ||
                    layer === "In2.Cu")
                ) {
                  setFocusedLayer(layer);
                }
              }}
            />,
            props.layersPanelTarget,
          )
        : null}
      {/* Contextual 28px parameter row. Renders nothing while no tool is
          active so the slot collapses to zero height. */}
      {workspace.projection && props.paramRowTarget
        ? createPortal(
            toolMode === "route" && !previewActive ? (
              <>
                <PcbRouteParamRow
                  segmentMode={
                    routeState.kind === "routing"
                      ? routeState.session.segmentMode
                      : "manhattan-45"
                  }
                  onToggleSegmentMode={() => {
                    if (routeState.kind === "routing") {
                      dispatchRoute({
                        kind: "set-mode",
                        mode:
                          routeState.session.segmentMode === "manhattan-90"
                            ? "manhattan-45"
                            : "manhattan-90",
                      });
                    }
                  }}
                  posture={
                    routeState.kind === "routing"
                      ? routeState.session.posture
                      : "auto"
                  }
                  onCyclePosture={() => dispatchRoute({ kind: "cycle-posture" })}
                  activeWidthMm={
                    routeState.kind === "routing"
                      ? routeState.session.widthMm
                      : (defaultNetClass?.traceWidthMm ?? 0.25)
                  }
                  tracePresets={tracePresets}
                  onPickWidth={(w) => void setSessionWidth(w, "preset")}
                  layerCount={workspace.projection?.board.layerCount ?? 2}
                  routeSessionActive={routeState.kind === "routing"}
                  viaDiameterMm={
                    routeState.kind === "routing" &&
                    routeState.session.viaDiameterMmOverride !== undefined
                      ? routeState.session.viaDiameterMmOverride
                      : (defaultNetClass?.viaDiameterMm ?? 0.6)
                  }
                  viaDrillMm={
                    routeState.kind === "routing" &&
                    routeState.session.viaDrillMmOverride !== undefined
                      ? routeState.session.viaDrillMmOverride
                      : (defaultNetClass?.viaDrillMm ?? 0.3)
                  }
                  viaDiameterDefaultMm={defaultNetClass?.viaDiameterMm ?? 0.6}
                  viaDrillDefaultMm={defaultNetClass?.viaDrillMm ?? 0.3}
                  viaDiameterPresets={VIA_DIAMETER_PRESETS_MM}
                  viaDrillPresets={VIA_DRILL_PRESETS_MM}
                  onPickViaDiameter={(mm) =>
                    dispatchRoute({
                      kind: "set-via-diameter",
                      diameterMmOverride: mm,
                    })
                  }
                  onPickViaDrill={(mm) =>
                    dispatchRoute({
                      kind: "set-via-drill",
                      drillMmOverride: mm,
                    })
                  }
                  onPickViaPreset={(preset) => {
                    dispatchRoute({
                      kind: "set-via-diameter",
                      diameterMmOverride: preset.diameterMm,
                    });
                    dispatchRoute({
                      kind: "set-via-drill",
                      drillMmOverride: preset.drillMm,
                    });
                  }}
                  layer={displayedCopperLayer}
                  layerColor={copperLayerColor(displayedCopperLayer)}
                  netClassName={routeHudModel?.netClassName ?? null}
                  status={
                    <RouteHudStatus
                      model={routeHudModel}
                      widthInputOpen={widthInputOpen}
                      onOpenWidthInput={() => setWidthInputOpen(true)}
                      onWidthInputSubmit={(w) =>
                        void setSessionWidth(w, "manual")
                      }
                      onWidthInputClose={() => setWidthInputOpen(false)}
                      onResetWidthToNetClass={resetSessionWidthToNetClass}
                    />
                  }
                />
                <RouteHudRows
                  model={routeHudModel}
                  blockedConflictCount={blockedConflictCount}
                  allowDrcViolations={allowDrcViolations}
                  onToggleAllowDrcViolations={() => {
                    setAllowDrcViolations((prev) => !prev);
                    setBlockedConflictCount(null);
                  }}
                  autoFinishProposal={
                    autoFinishProposal
                      ? {
                          lengthMm: routeLengthMm(autoFinishProposal.pathNm),
                          targetName: autoFinishProposal.targetName,
                        }
                      : null
                  }
                  onAcceptAutoFinish={acceptAutoFinish}
                  onDismissAutoFinish={() => setAutoFinishProposal(null)}
                  autoFinishNotice={autoFinishNotice}
                  routeNotice={routeNotice}
                />
              </>
            ) : toolMode === "tune" && !previewActive ? (
              <TuneHud
                model={tuneHudModel}
                notice={tuneNotice}
                allowDrcViolations={allowDrcViolations}
                onToggleAllowDrcViolations={() =>
                  setAllowDrcViolations((prev) => !prev)
                }
                targetInputOpen={tuneTargetInputOpen}
                onOpenTargetInput={() => setTuneTargetInputOpen(true)}
                onTargetInputSubmit={(t) =>
                  dispatchTune({ kind: "set-target-override", targetMm: t })
                }
                onTargetInputClose={() => setTuneTargetInputOpen(false)}
                onClearTargetOverride={() =>
                  dispatchTune({
                    kind: "set-target-override",
                    targetMm: undefined,
                  })
                }
              />
            ) : toolMode === "bundle" && !previewActive ? (
              <BundleHud model={bundleHudModel} notice={bundleBlocked} />
            ) : null,
            props.paramRowTarget,
          )
        : null}
      {workspace.projection && props.layerStripTarget
        ? createPortal(
            <PcbLayerTabStrip
              activeLayer={displayedCopperLayer}
              onSetActiveLayer={handleSetActiveLayer}
              layerCount={workspace.projection.board.layerCount}
              viewSide={workspace.viewSide}
              onToggleViewSide={handleToggleViewSide}
            />,
            props.layerStripTarget,
          )
        : null}
      {workspace.projection && props.propertiesTarget
        ? createPortal(
            <PcbPropertiesPanel
              selection={selection}
              projection={workspace.projection}
              boardPanel={boardPanelElement}
              inspectorSelection={inspectorSelection}
              partValues={props.partValues ?? EMPTY_PART_VALUES}
              onUpdateFreeHole={(id, patch) =>
                workspace.updateFreeHole(id, patch)
              }
              onDeleteFreeHole={(id) =>
                workspace
                  .deleteFreeHole(id)
                  .then(() => setSelection(emptyPcbSelection()))
              }
              onUpdateFreePad={(id, patch) => workspace.updateFreePad(id, patch)}
              onDeleteFreePad={(id) =>
                workspace
                  .deleteFreePad(id)
                  .then(() => setSelection(emptyPcbSelection()))
              }
              onUpdateOverlayText={(id, patch) =>
                workspace.updateOverlayText(id, patch)
              }
              onDeleteOverlayText={(id) =>
                workspace
                  .deleteOverlayText(id)
                  .then(() => setSelection(emptyPcbSelection()))
              }
              nets={workspace.nets}
              onUpdateZone={(id, patch) =>
                workspace.updateZone(id, patch).then(() => undefined)
              }
              onDeleteZone={(id) =>
                workspace
                  .deleteZone(id)
                  .then(() => setSelection(emptyPcbSelection()))
              }
              onUpdateKeepout={(id, patch) =>
                workspace.updateKeepout(id, patch).then(() => undefined)
              }
              onDeleteKeepout={(id) =>
                workspace
                  .deleteKeepout(id)
                  .then(() => setSelection(emptyPcbSelection()))
              }
            />,
            props.propertiesTarget,
          )
        : null}
      {workspace.projection && props.componentsPanelTarget
        ? createPortal(
            <PcbComponentsPanel
              placements={workspace.projection.placements}
              partValues={props.partValues ?? EMPTY_PART_VALUES}
              selectedIds={selection.placementIds}
              onSelect={handleSelectComponent}
            />,
            props.componentsPanelTarget,
          )
        : null}
      {rulesDialog.dialog}
      {dxfImportOpen ? (
        <DxfImportModal
          backendURL={props.backendURL ?? null}
          onApply={(outline) => {
            void workspace
              .updateBoardOutline(outline)
              .then(() => cameraControlsRef.current?.fit())
              .catch(() => undefined);
          }}
          onClose={() => setDxfImportOpen(false)}
        />
      ) : null}
      {cornerOp ? (
        <CornerOpModal
          mode={cornerOp.mode}
          contour={cornerOp.contour}
          vIndex={cornerOp.vIndex}
          onPreview={setCornerPreviewOutline}
          onApply={(outline) => {
            // Pin the result across the async projection refresh (no flash).
            setCommittedOutlineOverride(outline);
            void workspace
              .updateBoardOutline(outline)
              .catch(() => undefined)
              .finally(() => setCommittedOutlineOverride(null));
          }}
          onClose={() => {
            setCornerOp(null);
            setCornerPreviewOutline(null);
          }}
        />
      ) : null}
      {dimOp ? (
        <EdgeDimModal
          target={dimOp}
          onPreview={setCornerPreviewOutline}
          onApply={(outline) => {
            setCommittedOutlineOverride(outline);
            void workspace
              .updateBoardOutline(outline)
              .catch(() => undefined)
              .finally(() => setCommittedOutlineOverride(null));
          }}
          onClose={() => {
            setDimOp(null);
            setCornerPreviewOutline(null);
          }}
        />
      ) : null}
    </div>
  );
}
