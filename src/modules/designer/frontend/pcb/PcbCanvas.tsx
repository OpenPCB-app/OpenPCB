import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import type {
  DesignerCommand,
  DesignerDispatchResult,
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbPointMm,
  PcbTraceSegmentMode,
} from "../../../../sdks";
import { nmToSceneMm } from "../../../../shared/frontend/canvas/coords";
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
  PcbSelectionInspector,
  type PcbInspectorSelection,
} from "./PcbSelectionInspector";
import { useMarqueeSelection } from "../../../../shared/frontend/canvas/selection";
import { PcbScene, type PcbCameraControls } from "./PcbScene";
import type { ViewportState } from "../types";
import { PcbTopToolbar } from "./PcbTopToolbar";
import { PcbExportDialog } from "./PcbExportDialog";
import { PcbBoardPanel } from "./PcbBoardPanel";
import { PcbLayersPanel } from "./PcbLayersPanel";
import { PcbActiveLayerPill } from "./PcbActiveLayerPill";
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
import { runLiveDrc, type DrcViolation } from "./drc/live-drc";
import {
  initialRouteToolState,
  routeToolReducer,
  sessionAnchors,
  type PointNm,
  type RouteSession,
} from "./tools/route-tool-state";
import { buildPreviewPath } from "./tools/route-preview-geometry";
import { dragTraceSegment } from "./tools/trace-drag-state";
import {
  initialMeasureToolState,
  measureToolReducer,
  type MeasureAnchor,
} from "./tools/measure-tool-state";
import { findMeasureSnapTarget } from "./measure-snap";
import { usePcbWorkspace } from "./usePcbWorkspace";
import { useDrcStore } from "./drc/drc-store";
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
} from "../../../../shared/frontend/canvas/layers";
import { FlipHorizontal2 } from "lucide-react";
import { openContextMenu } from "../../../../shared/frontend/context-menu";
import type { ContextMenuGroup } from "../../../../shared/frontend/context-menu";
import {
  areViasVisible,
  isCopperLayerVisible,
  isPlacementVisible,
  isTraceVisible,
  visibleLayerSet,
} from "./pcb-layer-visibility";

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

type ToolMode = "select" | "route" | "measure" | "hole" | "pad" | "text";

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

/** Grab radius for board resize handles, in mm. Matches other fixed-mm hits. */
const BOARD_HANDLE_TOLERANCE_MM = 1.0;

/**
 * In-progress drag of a single trace segment. Captures the trace's original
 * geometry + the hit segment index; `previewPointsNm` is recomputed each
 * pointer-move via `dragTraceSegment`. Commits the preview on pointer-up.
 */
interface TraceDragSession {
  traceId: string;
  segmentIndex: number;
  layer: PcbCopperLayerId;
  widthMm: number;
  netId: string | null;
  netClassId: string;
  segmentMode: PcbTraceSegmentMode;
  originalPointsNm: PointNm[];
  startCursorMm: PcbPointMm;
  previewPointsNm: PointNm[];
  /** Routing-alignment guides for the live drag point (cyan rays + collinear
   * lines), recomputed each pointer-move; empty when guides are disabled. */
  guides: RouteGuide[];
  rejected: boolean;
  moved: boolean;
}

interface PcbCanvasProps {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  gridVisible?: boolean;
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
  boardPanelTarget?: HTMLElement | null;
  layersPanelTarget?: HTMLElement | null;
  selectionRequest?: {
    placementIds: readonly string[];
    /** Cross-probe by refdes (resolved against loaded placements). */
    references?: readonly string[];
    nonce: number;
  } | null;
  initialViewport?: ViewportState | null;
  onViewportChange?: (zoom: number, posX: number, posY: number) => void;
}

function RouteHintStrip({ active }: { active: boolean }): ReactElement {
  if (!active) {
    return (
      <div className="rounded-full border border-slate-700/80 bg-slate-950/80 px-3 py-1 text-[11px] font-medium text-slate-300 shadow-lg backdrop-blur">
        Click a pad, trace, or via to start routing · Esc cancel
      </div>
    );
  }
  const keys: ReadonlyArray<[string, string]> = [
    ["F", "Flip Elbow"],
    ["V", "Switch Layer"],
    ["W", "Cycle Width"],
    ["Shift", "Unconstrain"],
    ["/", "Posture"],
    ["Backspace", "Undo Segment"],
    ["Esc", "Cancel"],
  ];
  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/90 px-3 py-1 text-[11px] text-slate-300 shadow-xl backdrop-blur">
      {keys.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1">
          <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-100 shadow-inner">
            {key}
          </kbd>
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
}

function MeasureHintStrip({ active }: { active: boolean }): ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/90 px-3 py-1 text-[11px] text-slate-300 shadow-xl backdrop-blur">
      <span>{active ? "Click endpoint to lock" : "Click start point"}</span>
      <span>·</span>
      <span>
        Hold{" "}
        <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-100 shadow-inner">
          Shift
        </kbd>{" "}
        for ΔX/ΔY
      </span>
      <span>· Esc clear</span>
    </div>
  );
}

export function PcbCanvas(props: PcbCanvasProps): ReactElement {
  const gridEnabled = props.gridVisible ?? false;
  const snap = (v: number) => snapMm(v, gridEnabled);
  const snapPoint = (p: PcbPointMm) => snapPointMm(p, gridEnabled);

  const workspace = usePcbWorkspace({
    backendURL: props.backendURL,
    moduleId: props.moduleId,
    designId: props.designId,
    dispatchCommand: props.dispatchCommand,
    notifyExternalRevisionBump: props.notifyExternalRevisionBump,
  });
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
  const [traceDragSession, setTraceDragSession] =
    useState<TraceDragSession | null>(null);
  const traceDragSessionRef = useRef<TraceDragSession | null>(null);
  traceDragSessionRef.current = traceDragSession;
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [routeState, dispatchRoute] = useReducer(
    routeToolReducer,
    initialRouteToolState,
  );
  const [measureState, dispatchMeasure] = useReducer(
    measureToolReducer,
    initialMeasureToolState,
  );
  const [measureShowDeltas, setMeasureShowDeltas] = useState(false);
  const [focusedLayer, setFocusedLayer] = useState<PcbCopperLayerId | null>(
    null,
  );
  const [cursorMm, setCursorMmState] = useState<PcbPointMm | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const cursorMmRef = useRef<PcbPointMm | null>(null);
  // Figma-style alignment guides shown while dragging placements. The index
  // + group bbox are captured once at drag-start; each move queries them.
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [alignmentSpacing, setAlignmentSpacing] = useState<SpacingGuide[]>([]);
  const alignmentIndexRef = useRef<AlignmentIndex | null>(null);
  const draggedInitialBBoxRef = useRef<BoundsMm | null>(null);
  const altHeldRef = useRef(false);
  const alignmentGuidesEnabled = usePcbViewStore(
    (s) => s.viewState.alignmentGuidesVisible ?? true,
  );
  const alignmentGuidesEnabledRef = useRef(alignmentGuidesEnabled);
  alignmentGuidesEnabledRef.current = alignmentGuidesEnabled;
  const cameraControlsRef = useRef<PcbCameraControls | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
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
  const overlayTextsRef = useRef(workspace.projection?.overlayTexts ?? []);
  overlayTextsRef.current = workspace.projection?.overlayTexts ?? [];
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
      (workspace.projection?.placements ?? []).filter((placement) =>
        isPlacementVisible(visibleLayers, placement),
      ),
    [workspace.projection?.placements, visibleLayers],
  );

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

  // Reverse-lookup (placementId|padNumber) → netId from ratsnest segments.
  // Only nets with >=2 pads appear here; isolated single-pad nets won't hover-highlight.
  const padToNet = useMemo(() => {
    const map = new Map<string, string>();
    for (const seg of workspace.projection?.ratsnest ?? []) {
      map.set(`${seg.fromPlacementId}|${seg.fromPadNumber}`, seg.netId);
      map.set(`${seg.toPlacementId}|${seg.toPadNumber}`, seg.netId);
    }
    return map;
  }, [workspace.projection?.ratsnest]);

  const traceToNet = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const t of workspace.projection?.traces ?? []) {
      map.set(t.id, t.netId);
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
  // Snap target derived from cursor + nearby primitives. Tolerance is a
  // fixed world-mm radius (0.5mm) so the indicator stays consistent at any
  // zoom without piping viewport state through here. A future Phase 3 swap
  // can switch to screen-px tolerance once the rbush index lands.
  const snapTarget = useMemo<SnapTarget | null>(() => {
    if (!cursorMm) return null;
    if (!workspace.projection) return null;
    return findSnapTarget({
      cursorMm,
      toleranceMm: 0.5,
      placements: workspace.projection.placements,
      traces: workspace.projection.traces,
      vias: workspace.projection.vias,
      activeLayer: activeCopperLayer,
    });
  }, [cursorMm, workspace.projection, activeCopperLayer]);

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
      return { placementIds, traceIds, viaIds };
    },
  });

  // Default net class supplies width/clearance/via dims when starting a trace
  // on empty space (no pad → null netId).
  const defaultNetClass = useMemo(() => {
    return workspace.projection?.board.netClasses[0] ?? null;
  }, [workspace.projection?.board.netClasses]);

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
    } => {
      const pad = hitPad(visiblePlacements, cursor);
      if (pad) {
        const padId = `${pad.placementId}|${pad.padNumber}`;
        const netId = padToNet.get(padId) ?? null;
        return { pointMm: pad.worldMm, netId, onPad: true, padId };
      }
      if (snapTarget) {
        if (
          snapTarget.kind === "trace-endpoint" ||
          snapTarget.kind === "trace-segment-end"
        ) {
          const traceId = snapTarget.sourceId.split("|")[0]!;
          const netId = traceToNet.get(traceId) ?? null;
          return { pointMm: snapTarget.pointMm, netId, onPad: false };
        }
        if (snapTarget.kind === "via-center") {
          const netId = viaToNet.get(snapTarget.sourceId) ?? null;
          return { pointMm: snapTarget.pointMm, netId, onPad: false };
        }
      }
      return { pointMm: snapPoint(cursor), netId: null, onPad: false };
    },
    [padToNet, visiblePlacements, snapTarget, traceToNet, viaToNet],
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
        traces: workspace.projection.traces,
        vias: workspace.projection.vias,
        activeLayer: session.layer,
        netId: session.netId,
        toleranceMm: SNAP_THRESHOLD_PX / drcZoomRef.current,
      });
      return snapPointMm ? { ...base, pointMm: snapPointMm } : base;
    },
    [resolveAnchor, routeState, snapTarget, workspace.projection],
  );

  // Commit the current routing session as a `pcb_add_trace` command. Anchors
  // are resolved through the corner-mode + posture-aware preview builder so
  // the path matches what the user sees as the ghost.
  const commitTrace = useCallback(
    async (session: RouteSession, finalAnchorNm: PointNm) => {
      const committedAnchors = sessionAnchors(session);
      const path = buildPreviewPath(
        [...committedAnchors, finalAnchorNm],
        session.segmentMode,
        session.posture,
      );
      if (path.length < 2) return null;
      return await workspace.addTrace({
        layer: session.layer,
        pointsNm: path,
        widthMm: session.widthMm,
        netId: session.netId,
        netClassId: session.netClassId,
        segmentMode: session.segmentMode,
      });
    },
    [workspace],
  );

  /**
   * Smart Via: commit segments-so-far on the current layer, drop a via at the
   * cursor, then rebase the session onto the target layer. Mirrors the `+`/`-`
   * keyboard shortcut behaviour. The trace commit is a no-op when the path has
   * < 2 distinct points (e.g. via dropped immediately after `start`).
   */
  const placeSmartVia = useCallback(
    async (
      session: RouteSession,
      cursorMm: PcbPointMm,
      targetLayer: PcbCopperLayerId,
    ): Promise<boolean> => {
      const snapped = snapPoint(cursorMm);
      const viaCenterNm = pointMmToNm(snapped);
      const committedAnchors = sessionAnchors(session);
      const path = buildPreviewPath(
        [...committedAnchors, viaCenterNm],
        session.segmentMode,
        session.posture,
      );
      const viaInput = {
        centerMm: snapped,
        netId: session.netId,
        netClassId: session.netClassId,
        ...(session.viaDiameterMmOverride !== undefined
          ? { diameterMmOverride: session.viaDiameterMmOverride }
          : {}),
        ...(session.viaDrillMmOverride !== undefined
          ? { drillMmOverride: session.viaDrillMmOverride }
          : {}),
      };
      try {
        if (path.length >= 2) {
          await workspace.addTraceVia({
            trace: {
              layer: session.layer,
              pointsNm: path,
              widthMm: session.widthMm,
              netId: session.netId,
              netClassId: session.netClassId,
              segmentMode: session.segmentMode,
            },
            via: viaInput,
          });
        } else {
          await workspace.addVia(viaInput);
        }
      } catch {
        return false;
      }
      dispatchRoute({
        kind: "rebase-layer",
        anchorNm: viaCenterNm,
        layer: targetLayer,
      });
      // Routing context follows the via via `rebase-layer`. The caller decides
      // whether this via also represents a user-visible board active-layer
      // switch (toolbar/hotkey) or just a local route rebase.
      return true;
    },
    [workspace],
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
        const placed = await placeSmartVia(session, viaCursor, targetLayer);
        if (!placed) return;
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
    async (widthMm: number) => {
      if (routeState.kind !== "routing") return;
      const session = routeState.session;
      if (Math.abs(session.widthMm - widthMm) < 1e-9) return;
      const hasCommittedSegments = session.waypointsNm.length > 0;
      if (!hasCommittedSegments) {
        dispatchRoute({ kind: "set-width", widthMm });
        return;
      }
      // Commit segments-so-far at OLD width using the last waypoint as the
      // session's terminal anchor.
      const lastWaypoint = session.waypointsNm[session.waypointsNm.length - 1]!;
      try {
        await commitTrace(session, lastWaypoint);
      } catch {
        return;
      }
      // Rebase the session at the join point at the NEW width.
      dispatchRoute({
        kind: "rebase",
        anchorNm: lastWaypoint,
        widthMm,
      });
    },
    [commitTrace, routeState],
  );

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

        // Route mode takes the click first.
        if (toolMode === "route") {
          if (!defaultNetClass) return;
          const anchor = resolveRouteAnchor(cursor);
          if (routeState.kind === "idle") {
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
            // Start a new route session at the resolved anchor.
            dispatchRoute({
              kind: "start",
              anchorNm: pointMmToNm(anchor.pointMm),
              layer: activeCopperLayer,
              segmentMode: "manhattan-45",
              netId: anchor.netId,
              netClassId: sessionClass.id,
              widthMm: sessionClass.traceWidthMm,
              ...(anchor.padId !== undefined
                ? { startPadId: anchor.padId }
                : {}),
            });
            return;
          }
          // Routing — finishing on a pad commits and exits the session;
          // clicking empty space adds an intermediate waypoint.
          const session = routeState.session;
          if (anchor.onPad) {
            void commitTrace(session, pointMmToNm(anchor.pointMm))
              .then(() => {
                dispatchRoute({ kind: "cancel" });
              })
              .catch(() => undefined);
            return;
          }
          dispatchRoute({
            kind: "commit-waypoint",
            pointNm: pointMmToNm(anchor.pointMm),
          });
          return;
        }

        // Board resize — a grip on the board edge/corner wins over everything
        // else in select mode. Gated behind the explicit Board-dimensions
        // toggle. The bbox handles resize any outline kind.
        const outline = workspace.projection?.board.outline;
        if (boardDimModeRef.current && outline) {
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

        // Select mode: click trace/via/freeHole/freePad/overlayText first, then placement.
        const shift = event.modifiers.shift;
        const current = selectionRef.current;
        const sf = selectionFilterRef.current;
        setTraceDragSession(null);
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
          // Arm a segment drag for the hit segment (single-select only). The
          // drag commits on pointer-up only if the segment actually moved.
          if (!shift) {
            const trace = traceHit.trace;
            setTraceDragSession({
              traceId: trace.id,
              segmentIndex: traceHit.segmentIndex,
              layer: trace.layer,
              widthMm: trace.widthMm,
              netId: trace.netId,
              netClassId: trace.netClassId,
              segmentMode: trace.segmentMode,
              originalPointsNm: trace.pointsNm.map((p) => ({ ...p })),
              startCursorMm: cursor,
              previewPointsNm: trace.pointsNm.map((p) => ({ ...p })),
              guides: [],
              rejected: false,
              moved: false,
            });
          } else {
            setTraceDragSession(null);
          }
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
          for (const p of placementsRef.current) {
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
              placements: placementsRef.current,
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
              placementsRef.current.filter((p) => groupIds.has(p.id)),
            );
          } else {
            alignmentIndexRef.current = null;
            draggedInitialBBoxRef.current = null;
          }
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

        // Hover affordance for board handles (board-dim mode, any outline).
        if (boardDimModeRef.current && toolMode === "select") {
          const outline = workspace.projection?.board.outline;
          if (outline) {
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
        // Marquee in flight: update rect, suppress hover-net & drag updates.
        if (marquee.marqueeSession) {
          marquee.updateMarqueeCursor(cursor);
          return;
        }
        // Trace segment drag in flight: recompute the perpendicular reshape.
        if (traceDragSessionRef.current) {
          workspace.hoverNet(null);
          const session = traceDragSessionRef.current;
          // Snap the live cursor like the router does: grid first, then pull
          // onto a routing-alignment guide (collinear pad/trace coords + angle
          // rays) so a dragged segment lines up with surrounding geometry. The
          // dragged trace itself is excluded as a snap target. Alt or the
          // disabled toggle skips the guide snap (grid still applies). Any
          // along-segment component is discarded by `dragTraceSegment`'s
          // perpendicular projection, so only the meaningful axis survives.
          let snapped = snapPoint(cursor);
          let guides: RouteGuide[] = [];
          if (
            alignmentGuidesEnabledRef.current &&
            !altHeldRef.current &&
            workspace.projection
          ) {
            const seg = session.segmentIndex;
            const a = session.originalPointsNm[seg];
            const b = session.originalPointsNm[seg + 1];
            if (a && b) {
              const anchorMm = {
                x: (a.x + b.x) / 2 / NM_PER_MM,
                y: (a.y + b.y) / 2 / NM_PER_MM,
              };
              const res = computeRouteGuides({
                anchorMm,
                cursorMm: snapped,
                posture: "auto",
                placements: workspace.projection.placements,
                traces: workspace.projection.traces.filter(
                  (t) => t.id !== session.traceId,
                ),
                vias: workspace.projection.vias,
                activeLayer: session.layer,
                netId: session.netId,
                toleranceMm: SNAP_THRESHOLD_PX / drcZoomRef.current,
              });
              guides = res.guides;
              if (res.snapPointMm) snapped = res.snapPointMm;
            }
          }
          const startNm = pointMmToNm(session.startCursorMm);
          const curNm = pointMmToNm(snapped);
          const deltaNm = {
            x: curNm.x - startNm.x,
            y: curNm.y - startNm.y,
          };
          const result = dragTraceSegment(
            session.originalPointsNm,
            session.segmentIndex,
            deltaNm,
            session.segmentMode,
          );
          setTraceDragSession((prev) => {
            if (!prev) return prev;
            if (result.kind === "rejected") {
              return {
                ...prev,
                previewPointsNm: prev.originalPointsNm,
                guides,
                rejected: true,
                moved: true,
              };
            }
            return {
              ...prev,
              previewPointsNm: result.pointsNm,
              guides,
              rejected: false,
              moved: true,
            };
          });
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
        if (marquee.marqueeSession) {
          marquee.finishMarquee();
          return;
        }
        const traceSession = traceDragSessionRef.current;
        if (traceSession) {
          setTraceDragSession(null);
          // Commit only a real, valid reshape. Rejected drags fall back to the
          // selection that the pointer-down already applied (no-op here).
          if (traceSession.moved && !traceSession.rejected) {
            void workspace
              .updateTraceGeometry(
                traceSession.traceId,
                traceSession.previewPointsNm,
              )
              .catch(() => undefined);
          }
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
        // NB: do NOT cancel an in-flight trace-segment drag here. `EdaCanvas`
        // calls `setPointerCapture` on press, which makes R3F synthesize
        // spurious mesh `pointerleave` events mid-drag (the ray transiently
        // misses the hit-plane) even while the cursor stays on the board —
        // cancelling on those aborts a perfectly valid drag before it can
        // commit. Pointer capture also guarantees the matching pointer-up is
        // delivered to the canvas (so the commit still fires on release even if
        // the cursor truly left), and Escape remains the explicit cancel. The
        // marquee session is resilient to leave for the same reason.
        // Keep the last board cursor during active routing so toolbar/context
        // layer switches can still drop a smart via at the last route point.
        if (toolMode === "measure") {
          // A locked measurement renders from fixed anchors and must survive the
          // cursor leaving the canvas; only an in-progress measurement (which
          // tracks the live cursor) is discarded.
          if (measureState.kind === "measuring")
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

        openContextMenu({
          scope: "pcb",
          position: { x: event.screenPoint.x, y: event.screenPoint.y },
          groups,
        });
      },
    };
  }, [
    activeCopperLayer,
    commitTrace,
    defaultNetClass,
    dragSession,
    eventToMm,
    marquee,
    measureState,
    padToNet,
    resolveMeasureAnchor,
    resolveRouteAnchor,
    routeState,
    selection,
    setActiveCopperLayer,
    setCursorMm,
    splitAndRerouteTrace,
    toolMode,
    viasVisible,
    visibleLayers,
    visiblePlacements,
    workspace,
  ]);

  useEffect(() => {
    const onShiftKey = (event: KeyboardEvent): void => {
      if (event.key === "Shift") setMeasureShowDeltas(event.type === "keydown");
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
      if (event.key === "h" || event.key === "H") {
        event.preventDefault();
        setToolMode((prev) => (prev === "hole" ? "select" : "hole"));
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }
      if (event.key === "p" || event.key === "P") {
        // Skip if a placement is selected — P is also "pad" shortcut, but
        // currently no conflicting binding exists for select mode.
        event.preventDefault();
        setToolMode((prev) => (prev === "pad" ? "select" : "pad"));
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }
      if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        setToolMode((prev) => (prev === "text" ? "select" : "text"));
        dispatchRoute({ kind: "cancel" });
        dispatchMeasure({ kind: "clear" });
        return;
      }
      if (event.key === "m" || event.key === "M") {
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
      // Shift+G toggles alignment guides (visual + magnetic snap).
      if ((event.key === "g" || event.key === "G") && event.shiftKey) {
        event.preventDefault();
        usePcbViewStore.getState().toggleAlignmentGuidesVisible();
        return;
      }
      if (event.key === "r" || event.key === "R") {
        const sole =
          selection.placementIds.size === 1
            ? [...selection.placementIds][0]
            : null;
        if (toolMode === "select" && sole && !event.shiftKey) {
          event.preventDefault();
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

      // Routing-only keys.
      if (toolMode === "route" && routeState.kind === "routing") {
        const session = routeState.session;
        if (event.key === "Escape") {
          event.preventDefault();
          dispatchRoute({ kind: "cancel" });
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          dispatchRoute({ kind: "step-back" });
          return;
        }
        if (event.key === "w" || event.key === "W") {
          event.preventDefault();
          if (event.altKey) {
            // Alt+W → custom width prompt.
            const input = window.prompt(
              "Trace width (mm):",
              session.widthMm.toString(),
            );
            if (input !== null) {
              const next = Number(input);
              if (Number.isFinite(next) && next > 0) {
                void setSessionWidth(next);
              }
            }
            return;
          }
          // W cycles forward through presets, Shift+W cycles backward.
          const next = cycleWidth(session.widthMm, event.shiftKey ? -1 : 1);
          void setSessionWidth(next);
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
        // Commits segments-so-far on the current layer, drops a via at the
        // cursor, then rebases the session onto the opposite layer.
        if (
          event.key === "+" ||
          event.key === "-" ||
          event.key === "v" ||
          event.key === "V"
        ) {
          event.preventDefault();
          if (!cursorMm) return;
          const nextLayer: PcbCopperLayerId =
            session.layer === "F.Cu" ? "B.Cu" : "F.Cu";
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
      // mode too.
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
        void setActiveCopperLayer("F.Cu");
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
        void setActiveCopperLayer("B.Cu");
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
        void setActiveCopperLayer("In1.Cu");
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
        void setActiveCopperLayer("In2.Cu");
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
        // Cancel an in-flight trace-segment drag without dropping the selection.
        if (traceDragSessionRef.current) {
          setTraceDragSession(null);
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
        } else if (
          toolMode === "hole" ||
          toolMode === "pad" ||
          toolMode === "text"
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
        if (
          placementIds.length === 0 &&
          traceIds.length === 0 &&
          viaIds.length === 0 &&
          freeHoleIds.length === 0 &&
          freePadIds.length === 0 &&
          overlayTextIds.length === 0
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
        void Promise.allSettled(tasks).then(() => {
          setSelection(emptyPcbSelection());
        });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    cursorMm,
    cycleWidth,
    handleToggleViewSide,
    marquee,
    routeState,
    selection,
    setActiveCopperLayer,
    setSessionWidth,
    toolMode,
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

  const dragOverride = useMemo<ReadonlyMap<string, PcbPointMm> | null>(() => {
    if (!dragSession || !dragSession.moved) return committedDragOverride;
    const dx = dragSession.currentPrimaryMm.x - dragSession.initialPrimaryMm.x;
    const dy = dragSession.currentPrimaryMm.y - dragSession.initialPrimaryMm.y;
    const map = new Map<string, PcbPointMm>();
    for (const [id, initial] of dragSession.initialPositionsByPlacementId) {
      map.set(id, { x: initial.x + dx, y: initial.y + dy });
    }
    return map;
  }, [committedDragOverride, dragSession]);

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
  const routePreview = useMemo(() => {
    if (routeState.kind !== "routing" || !cursorMm) return null;
    const session = routeState.session;
    const cursorAnchor = resolveRouteAnchor(cursorMm);
    const committedAnchors = sessionAnchors(session);
    const anchors = [...committedAnchors, pointMmToNm(cursorAnchor.pointMm)];
    const path = buildPreviewPath(
      anchors,
      session.segmentMode,
      session.posture,
    );
    if (path.length < 2) return null;
    return {
      pointsNm: path,
      layer: session.layer,
    };
  }, [cursorMm, resolveRouteAnchor, routeState]);

  // Live DRC for the in-progress trace.
  const drcViolations: DrcViolation[] = useMemo(() => {
    if (!routePreview || routeState.kind !== "routing" || !workspace.projection)
      return [];
    return runLiveDrc({
      traceNm: routePreview.pointsNm,
      traceWidthMm: routeState.session.widthMm,
      netId: routeState.session.netId,
      layer: routeState.session.layer,
      traces: workspace.projection.traces,
      placements: workspace.projection.placements,
      padNetMap: padToNet,
      netClasses: workspace.projection.board.netClasses,
      netClassId: routeState.session.netClassId,
      designRules: workspace.projection.board.designRules,
    });
  }, [padToNet, routePreview, routeState, workspace.projection]);

  // Live preview for an in-flight trace-segment drag — rendered through the
  // same ghost as the route preview (the two are mutually exclusive: drag runs
  // in select mode, route preview only while routing).
  const traceDragPreview = useMemo(() => {
    if (
      !traceDragSession ||
      !traceDragSession.moved ||
      traceDragSession.rejected
    ) {
      return null;
    }
    return {
      pointsNm: traceDragSession.previewPointsNm,
      layer: traceDragSession.layer,
      widthMm: traceDragSession.widthMm,
    };
  }, [traceDragSession]);

  // Live DRC for the dragged preview. The dragged trace's committed copy is
  // excluded so the preview isn't flagged against its own old geometry.
  const traceDragDrc: DrcViolation[] = useMemo(() => {
    if (!traceDragPreview || !traceDragSession || !workspace.projection) {
      return [];
    }
    return runLiveDrc({
      traceNm: traceDragPreview.pointsNm,
      traceWidthMm: traceDragSession.widthMm,
      netId: traceDragSession.netId,
      layer: traceDragSession.layer,
      traces: workspace.projection.traces.filter(
        (t) => t.id !== traceDragSession.traceId,
      ),
      placements: workspace.projection.placements,
      padNetMap: padToNet,
      netClasses: workspace.projection.board.netClasses,
      netClassId: traceDragSession.netClassId,
      designRules: workspace.projection.board.designRules,
    });
  }, [padToNet, traceDragPreview, traceDragSession, workspace.projection]);

  // Emit the live in-progress conflict count for whichever interaction is
  // active — routing (in-progress trace) or a trace-segment drag; `null` when
  // idle so the status bar falls back to the full-board batch count. Routing
  // and drag are mutually exclusive (different tool modes), so they never both
  // report at once.
  const onDrcCountChange = props.onDrcCountChange;
  const routing = routeState.kind === "routing";
  const dragActive = traceDragPreview !== null;
  useEffect(() => {
    if (routing) onDrcCountChange?.(drcViolations.length);
    else if (dragActive) onDrcCountChange?.(traceDragDrc.length);
    else onDrcCountChange?.(null);
  }, [
    routing,
    dragActive,
    drcViolations.length,
    traceDragDrc.length,
    onDrcCountChange,
  ]);

  const onSelectionCountChange = props.onSelectionCountChange;
  const selectionCount = pcbSelectionCount(selection);
  useEffect(() => {
    onSelectionCountChange?.(selectionCount);
  }, [selectionCount, onSelectionCountChange]);

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
      traces: workspace.projection.traces,
      vias: workspace.projection.vias,
      activeLayer: session.layer,
      netId: session.netId,
      toleranceMm: SNAP_THRESHOLD_PX / drcZoomRef.current,
    }).guides;
  }, [alignmentGuidesEnabled, cursorMm, routeState, workspace.projection]);

  // Routing-alignment guides for an in-flight trace-segment drag — same engine
  // and visual layer as routing, recomputed in the pointer-move handler and
  // stashed on the session. Routing and drag are mutually exclusive (route mode
  // vs select mode), so at most one of these is non-empty at a time.
  const sceneTraceDragGuides = useMemo<RouteGuide[]>(
    () =>
      alignmentGuidesEnabled && traceDragSession?.moved
        ? traceDragSession.guides
        : [],
    [alignmentGuidesEnabled, traceDragSession],
  );

  const sceneRoutePreview = useMemo(() => {
    if (traceDragPreview) return traceDragPreview;
    if (!routePreview) return null;
    return {
      pointsNm: routePreview.pointsNm,
      layer: routePreview.layer,
      widthMm:
        routeState.kind === "routing"
          ? routeState.session.widthMm
          : (defaultNetClass?.traceWidthMm ?? 0.25),
    };
  }, [
    defaultNetClass?.traceWidthMm,
    routePreview,
    routeState,
    traceDragPreview,
  ]);

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
      <div className="flex h-full items-center justify-center bg-slate-950 text-sm text-slate-500">
        Select or create a design to open PCB layout
      </div>
    );
  }

  const canvasCursor = boardResizeSession
    ? handleCursor(boardResizeSession.handle)
    : boardHandleCursor;

  return (
    <div
      className="relative h-full w-full bg-slate-950"
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
            selection={selection}
            outlineOverride={
              boardResizeSession?.currentRect ?? committedOutlineOverride
            }
            boardHandlesVisible={boardDimMode && toolMode === "select"}
            dragOverride={dragOverride}
            freePrimitiveDragOverrides={freePrimitiveDragOverrides}
            highlightedNetId={workspace.highlightedNetId}
            ratsnestVisible={workspace.ratsnestVisible}
            viewSide={workspace.viewSide}
            displayMode={workspace.displayMode}
            routeGuide={sceneRouteGuide}
            routeGuides={
              sceneTraceDragGuides.length > 0
                ? sceneTraceDragGuides
                : sceneRouteGuides
            }
            routePreview={sceneRoutePreview}
            routeFocusActive={routeState.kind === "routing"}
            routeFocusLayer={
              routeState.kind === "routing"
                ? routeState.session.layer
                : activeCopperLayer
            }
            focusedLayer={focusedLayer}
            copperFillLayers={workspace.copperFillLayers}
            marqueeOverlay={sceneMarqueeOverlay}
            measurement={sceneMeasurement}
            snapTarget={snapTarget}
            alignmentGuides={alignmentGuides}
            alignmentSpacing={alignmentSpacing}
            initialViewport={props.initialViewport}
            onViewportChange={(zoom, posX, posY) => {
              // Capture live zoom for DOM-side DRC marker hit-test tolerance.
              drcZoomRef.current = zoom;
              props.onViewportChange?.(zoom, posX, posY);
            }}
            onCameraReady={handleCameraReady}
          />
        </EdaCanvas>
      ) : null}
      {workspace.projection ? (
        <div className="pointer-events-none absolute left-3 bottom-3 z-20">
          <PcbActiveLayerPill layer={displayedCopperLayer} />
        </div>
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
      {inspectorSelection ? (
        <PcbSelectionInspector
          selection={inspectorSelection}
          onClose={() => setSelection(emptyPcbSelection())}
          onUpdateFreeHole={(id, patch) => workspace.updateFreeHole(id, patch)}
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
            className="pointer-events-none absolute inset-0 z-10 bg-blue-500/[0.04]"
            data-testid="pcb-flip-tint"
          />
          {/* Status badge — always visible when flipped, even if toolbar is
              occluded. */}
          <div
            className="pointer-events-none absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-violet-500/60 bg-violet-100/95 px-2 py-0.5 text-[11px] font-medium text-violet-700 shadow-sm backdrop-blur dark:bg-violet-900/60 dark:text-violet-200"
            data-testid="pcb-viewing-bottom-badge"
          >
            <FlipHorizontal2 className="h-3 w-3" />
            Viewing from bottom
          </div>
        </>
      ) : null}
      {workspace.projection ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
          <div className="pointer-events-auto">
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
              drcMarkersVisible={drcMarkersVisible}
              onToggleDrcMarkers={toggleDrcMarkers}
              canUndo={workspace.canUndo}
              canRedo={workspace.canRedo}
              onUndo={() => void workspace.undo()}
              onRedo={() => void workspace.redo()}
              onZoomIn={() => cameraControlsRef.current?.zoomIn()}
              onZoomOut={() => cameraControlsRef.current?.zoomOut()}
              onFit={() => cameraControlsRef.current?.fit()}
              routeMode={toolMode === "route"}
              routeSessionActive={routeState.kind === "routing"}
              onToggleRouteMode={() => {
                setToolMode((prev) => (prev === "route" ? "select" : "route"));
                if (toolMode === "route") dispatchRoute({ kind: "cancel" });
                dispatchMeasure({ kind: "clear" });
              }}
              measureMode={toolMode === "measure"}
              onToggleMeasureMode={() => {
                setToolMode((prev) => {
                  if (prev === "measure") {
                    dispatchMeasure({ kind: "clear" });
                    return "select";
                  }
                  return "measure";
                });
                dispatchRoute({ kind: "cancel" });
              }}
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
              activeWidthMm={
                routeState.kind === "routing"
                  ? routeState.session.widthMm
                  : (defaultNetClass?.traceWidthMm ?? 0.25)
              }
              tracePresets={tracePresets}
              onPickWidth={(w) => void setSessionWidth(w)}
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
              posture={
                routeState.kind === "routing"
                  ? routeState.session.posture
                  : "auto"
              }
              onCyclePosture={() => dispatchRoute({ kind: "cycle-posture" })}
            />
          </div>
        </div>
      ) : null}
      {!workspace.projection ? (
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          {workspace.loading ? "Loading PCB..." : "PCB projection unavailable"}
        </div>
      ) : null}

      {workspace.projection && props.designId ? (
        <>
          <button
            type="button"
            onClick={() => setExportDialogOpen(true)}
            title="Export manufacturing files (Gerber + Drill + BOM + PnP)"
            data-testid="pcb-export-button"
            className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white/95 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Export…
          </button>
          <PcbExportDialog
            backendURL={props.backendURL}
            moduleId={props.moduleId}
            designId={props.designId}
            open={exportDialogOpen}
            onClose={() => setExportDialogOpen(false)}
          />
        </>
      ) : null}

      {boardResizeSession && cursorClientPx ? (
        <div
          className="pointer-events-none fixed z-30 flex items-center gap-2 rounded-full border border-violet-500/60 bg-slate-950/95 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-100 shadow-lg backdrop-blur"
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
              <span className="text-slate-400">
                Δ {fmt(dw)}, {fmt(dh)}
              </span>
            );
          })()}
        </div>
      ) : null}

      {toolMode === "route" && cursorClientPx ? (
        <div
          className="pointer-events-none fixed z-30 flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-950/90 px-2 py-0.5 text-[10px] font-medium text-slate-100 shadow-lg backdrop-blur"
          style={{
            left: cursorClientPx.x + 14,
            top: cursorClientPx.y + 14,
          }}
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: PCB_LAYER_COLORS[displayedCopperLayer] }}
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
                className="pointer-events-none fixed z-40 max-w-[280px] rounded-md border border-slate-700 bg-slate-950/95 px-2.5 py-1.5 text-[11px] text-slate-100 shadow-lg backdrop-blur"
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
                <div className="mt-0.5 text-slate-300">
                  {v.anchors
                    .map((a) =>
                      resolveAnchorLabel(a, workspace.projection ?? null),
                    )
                    .join(" ↔ ")}
                </div>
                {v.layer ||
                (v.measuredMm !== undefined && v.requiredMm !== undefined) ? (
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    {v.layer ? <span className="mr-2">{v.layer}</span> : null}
                    {v.measuredMm !== undefined && v.requiredMm !== undefined
                      ? `${v.measuredMm.toFixed(3)} / ${v.requiredMm.toFixed(3)} mm`
                      : null}
                  </div>
                ) : null}
                <div className="mt-1 text-[10px] leading-snug text-slate-400">
                  {v.message}
                </div>
              </div>
            );
          })()
        : null}

      {toolMode === "route" ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
          <RouteHintStrip active={routeState.kind === "routing"} />
        </div>
      ) : null}
      {toolMode === "measure" ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
          <MeasureHintStrip active={measureState.kind === "measuring"} />
        </div>
      ) : null}
      {traceDragSession?.rejected ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
          <div className="rounded-full border border-amber-700/80 bg-amber-950/80 px-3 py-1 text-[11px] font-medium text-amber-200 shadow-lg backdrop-blur">
            Can&rsquo;t reshape this segment cleanly — release to cancel, or
            reroute instead
          </div>
        </div>
      ) : null}

      {workspace.projection && props.layersPanelTarget
        ? createPortal(
            <PcbLayersPanel
              activeLayer={focusedLayer}
              lockedVisibleLayer={displayedCopperLayer}
              onSetActiveLayer={(layer) => {
                if (
                  layer === "F.Cu" ||
                  layer === "B.Cu" ||
                  layer === "In1.Cu" ||
                  layer === "In2.Cu"
                ) {
                  setFocusedLayer((prev) => (prev === layer ? null : layer));
                  void setActiveCopperLayer(layer);
                }
              }}
              visibleLayers={workspace.projection.board.visibleLayers}
              onSetVisibleLayers={(layers) =>
                void workspace.setVisibleLayers(layers)
              }
              layerCount={workspace.projection.board.layerCount}
              displayMode={workspace.displayMode}
              onSetDisplayMode={workspace.setDisplayMode}
              copperFillLayers={workspace.copperFillLayers}
              onToggleCopperFillLayer={(layer) => {
                const enabling = !workspace.copperFillLayers.includes(layer);
                if (enabling && !visibleLayers.has(layer)) {
                  void workspace.setVisibleLayers([
                    ...(workspace.projection?.board.visibleLayers ?? []),
                    layer,
                  ]);
                }
                workspace.toggleCopperFillLayer(layer);
              }}
              viewSide={workspace.viewSide}
              onToggleViewSide={handleToggleViewSide}
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
      {workspace.projection && props.boardPanelTarget
        ? createPortal(
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
                  // Entering edit mode forces the select tool so the edge
                  // handles are interactive (route/measure would intercept).
                  if (!prev) setToolMode("select");
                  return !prev;
                })
              }
            />,
            props.boardPanelTarget,
          )
        : null}
    </div>
  );
}
