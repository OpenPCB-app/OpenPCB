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
  PcbCopperLayerId,
  PcbPointMm,
} from "../../../../sdks";
import { nmToSceneMm } from "../../../../shared/frontend/canvas/coords";
import { EdaCanvas } from "../../../../shared/frontend/canvas/interaction/EdaCanvas";
import type {
  InteractionCoordinateTransform,
  InteractionEvent,
  InteractionHandler,
} from "../../../../shared/frontend/canvas/interaction/types";
import { sceneMmToNm } from "../../../../shared/frontend/canvas/coords";
import { hitPad, hitPlacement, hitTrace, hitVia } from "./pcb-hit";
import {
  placementContainedInRect,
  placementIntersectsRect,
  traceContainedInRect,
  traceIntersectsRect,
} from "./pcb-rect-hit";
import {
  clonePcbSelection,
  emptyPcbSelection,
  toggleTrace,
  toggleVia,
  togglePlacement,
  type PcbSelection,
} from "./pcb-selection";
import { useMarqueeSelection } from "../../../../shared/frontend/canvas/selection";
import { PcbScene } from "./PcbScene";
import { PcbTopToolbar } from "./PcbTopToolbar";
import { PcbBoardPanel } from "./PcbBoardPanel";
import { PcbLayersPanel } from "./PcbLayersPanel";
import { runLiveDrc, type DrcViolation } from "./drc/live-drc";
import {
  initialRouteToolState,
  routeToolReducer,
  sessionAnchors,
  type PointNm,
  type RouteSession,
} from "./tools/route-tool-state";
import { buildPreviewPath } from "./tools/route-preview-geometry";
import { usePcbWorkspace } from "./usePcbWorkspace";
import {
  DEFAULT_PCB_ZOOM,
  PCB_GRID_MM,
} from "../../../../shared/frontend/canvas/defaults";
import { PCB_LAYER_COLORS } from "../../../../shared/frontend/canvas/layers";
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

function snapMm(value: number): number {
  return Math.round(value / PCB_GRID_MM) * PCB_GRID_MM;
}

function snapPointMm(p: PcbPointMm): PcbPointMm {
  return { x: snapMm(p.x), y: snapMm(p.y) };
}

function pointMmToNm(p: PcbPointMm): PointNm {
  return { x: Math.round(p.x * NM_PER_MM), y: Math.round(p.y * NM_PER_MM) };
}

type ToolMode = "select" | "route";

function viewSideForCopperLayer(
  layer: PcbCopperLayerId,
): "top" | "bottom" {
  return layer === "B.Cu" ? "bottom" : "top";
}

interface DragSession {
  primaryPlacementId: string;
  pointerOffsetMm: PcbPointMm;
  initialPrimaryMm: PcbPointMm;
  currentPrimaryMm: PcbPointMm;
  /** Initial position for every placement in the drag set (single-element for non-group). */
  initialPositionsByPlacementId: Map<string, PcbPointMm>;
  moved: boolean;
}

interface PcbCanvasProps {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  dispatchCommand: (
    command: DesignerCommand,
  ) => Promise<DesignerDispatchResult>;
  notifyExternalRevisionBump?: (revision: number) => void;
  onDrcCountChange?: (count: number) => void;
  boardPanelTarget?: HTMLElement | null;
  layersPanelTarget?: HTMLElement | null;
}

export function PcbCanvas(props: PcbCanvasProps): ReactElement {
  const workspace = usePcbWorkspace({
    backendURL: props.backendURL,
    moduleId: props.moduleId,
    designId: props.designId,
    dispatchCommand: props.dispatchCommand,
    notifyExternalRevisionBump: props.notifyExternalRevisionBump,
  });
  const [widthText, setWidthText] = useState("100");
  const [heightText, setHeightText] = useState("80");
  const [dragSession, setDragSession] = useState<DragSession | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [routeState, dispatchRoute] = useReducer(
    routeToolReducer,
    initialRouteToolState,
  );
  const [cursorMm, setCursorMmState] = useState<PcbPointMm | null>(null);
  const cursorMmRef = useRef<PcbPointMm | null>(null);
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
  const placementsRef = useRef(workspace.projection?.placements ?? []);
  placementsRef.current = workspace.projection?.placements ?? [];
  const tracesRef = useRef(workspace.projection?.traces ?? []);
  tracesRef.current = workspace.projection?.traces ?? [];
  const viasRef = useRef(workspace.projection?.vias ?? []);
  viasRef.current = workspace.projection?.vias ?? [];

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
    setWidthText(String(board.widthMm));
    setHeightText(String(board.heightMm));
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

  // Resolve the active layer of the workspace, defaulting to F.Cu when the
  // active layer is a non-copper layer (silkscreen, edge cuts) — routing only
  // happens on copper.
  const activeCopperLayer: PcbCopperLayerId = useMemo(() => {
    const a = workspace.projection?.board.activeLayer;
    return a === "B.Cu" ? "B.Cu" : "F.Cu";
  }, [workspace.projection?.board.activeLayer]);
  const displayedCopperLayer: PcbCopperLayerId =
    routeState.kind === "routing" ? routeState.session.layer : activeCopperLayer;
  const mirrorActive = workspace.viewSide === "bottom";

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
      const placementHit =
        mode === "window" ? placementContainedInRect : placementIntersectsRect;
      const traceHit =
        mode === "window" ? traceContainedInRect : traceIntersectsRect;
      const placementIds = new Set(baseSelection.placementIds);
      const traceIds = new Set(baseSelection.traceIds);
      const viaIds = new Set(baseSelection.viaIds);
      for (const p of visiblePlacements) {
        if (placementHit(p, rect)) placementIds.add(p.id);
      }
      const layer: PcbCopperLayerId =
        workspace.projection?.board.activeLayer === "B.Cu" ? "B.Cu" : "F.Cu";
      for (const t of tracesRef.current) {
        if (t.layer !== layer) continue;
        if (!isTraceVisible(visibleLayers, t)) continue;
        if (traceHit(t, rect)) traceIds.add(t.id);
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
      return { pointMm: snapPointMm(cursor), netId: null, onPad: false };
    },
    [padToNet, visiblePlacements],
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
      const snapped = snapPointMm(cursorMm);
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
   * One canonical Top/Bottom switch path. Outside routing it persists the active
   * copper layer and mirrors the view deterministically. During routing it
   * inserts a smart via at the cursor before rebasing to the target layer.
   */
  const setCopperLayerAndView = useCallback(
    async (targetLayer: PcbCopperLayerId, cursorOverrideMm?: PcbPointMm) => {
      if (routeState.kind === "routing") {
        const session = routeState.session;
        if (session.layer === targetLayer) {
          workspace.setViewSide(viewSideForCopperLayer(targetLayer));
          if (activeCopperLayer !== targetLayer) {
            await workspace.setActiveLayer(targetLayer);
          }
          return;
        }
        const viaCursor = cursorOverrideMm ?? cursorMmRef.current;
        if (!viaCursor) return;
        const placed = await placeSmartVia(session, viaCursor, targetLayer);
        if (!placed) return;
        workspace.setViewSide(viewSideForCopperLayer(targetLayer));
        await workspace.setActiveLayer(targetLayer);
        return;
      }

      workspace.setViewSide(viewSideForCopperLayer(targetLayer));
      if (activeCopperLayer !== targetLayer) {
        await workspace.setActiveLayer(targetLayer);
      }
    },
    [activeCopperLayer, placeSmartVia, routeState, workspace],
  );

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

  const handler = useMemo<InteractionHandler>(() => {
    return {
      onPointerDown(event) {
        if (event.button !== 0) return;
        const cursor = eventToMm(event);

        // Route mode takes the click first.
        if (toolMode === "route") {
          if (!defaultNetClass) return;
          const anchor = resolveAnchor(cursor);
          if (routeState.kind === "idle") {
            // Start a new route session at the resolved anchor.
            dispatchRoute({
              kind: "start",
              anchorNm: pointMmToNm(anchor.pointMm),
              layer: activeCopperLayer,
              segmentMode: "manhattan-45",
              netId: anchor.netId,
              netClassId: defaultNetClass.id,
              widthMm: defaultNetClass.traceWidthMm,
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

        // Select mode: click trace/via first, then placement.
        const shift = event.modifiers.shift;
        const current = selectionRef.current;
        const traceHit = isCopperLayerVisible(visibleLayers, activeCopperLayer)
          ? hitTrace(tracesRef.current, cursor, activeCopperLayer)
          : null;
        if (traceHit) {
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
        const viaHit = viasVisible ? hitVia(viasRef.current, cursor) : null;
        if (viaHit) {
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
        const hit = hitPlacement(visiblePlacements, cursor);
        if (hit) {
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
          return;
        }
        // Empty space → start marquee (no drag).
        setDragSession(null);
        marquee.beginMarquee(cursor, shift);
      },
      onPointerMove(event) {
        const cursor = eventToMm(event);
        setCursorMm(cursor);
        setCursorClientPx({ x: event.screenPoint.x, y: event.screenPoint.y });
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
        }
        setDragSession((prev) => {
          if (!prev) return prev;
          const next = {
            x: snapMm(cursor.x - prev.pointerOffsetMm.x),
            y: snapMm(cursor.y - prev.pointerOffsetMm.y),
          };
          if (
            next.x === prev.currentPrimaryMm.x &&
            next.y === prev.currentPrimaryMm.y
          ) {
            return prev;
          }
          return { ...prev, currentPrimaryMm: next, moved: true };
        });
      },
      onPointerUp() {
        if (marquee.marqueeSession) {
          marquee.finishMarquee();
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
          for (const [id, initial] of session.initialPositionsByPlacementId) {
            updates.push({
              placementId: id,
              positionMm: { x: initial.x + dx, y: initial.y + dy },
            });
          }
          if (updates.length === 1) {
            void workspace.movePlacement(
              updates[0]!.placementId,
              updates[0]!.positionMm,
            );
          } else if (updates.length > 1) {
            void workspace.movePlacements(updates);
          }
        }
        setDragSession(null);
      },
      onPointerLeave() {
        // Keep the last board cursor during active routing so toolbar/context
        // layer switches can still drop a smart via at the last route point.
        if (routeState.kind !== "routing") setCursorMm(null);
        setCursorClientPx(null);
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
                  const anchor = resolveAnchor(cursor);
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
                  void setCopperLayerAndView("F.Cu", cursor);
                },
              },
              {
                kind: "action",
                id: "place-smart-via-bottom",
                label: "Bottom Copper (B.Cu)",
                disabled: routeState.session.layer === "B.Cu",
                onSelect: () => {
                  void setCopperLayerAndView("B.Cu", cursor);
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
                    onSelect: () => void setCopperLayerAndView("F.Cu"),
                  },
                  {
                    kind: "action",
                    id: "set-bottom",
                    label: "Bottom layer (B.Cu)",
                    disabled: activeCopperLayer === "B.Cu",
                    onSelect: () => void setCopperLayerAndView("B.Cu"),
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
    padToNet,
    resolveAnchor,
    routeState,
    selection,
    setCopperLayerAndView,
    setCursorMm,
    toolMode,
    viasVisible,
    visibleLayers,
    visiblePlacements,
    workspace,
  ]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return;

      // F flips the currently-selected placement(s) in Select mode (KiCad
      // parity). Each placement flips around its own origin: layer toggles
      // F.Cu↔B.Cu and `mirrored` flips. Rotation/position preserved.
      // Disabled while routing — routing-mode keys are handled below.
      if (
        (event.key === "f" || event.key === "F") &&
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
          void setCopperLayerAndView(nextLayer, snapPointMm(cursorMm));
          return;
        }
      }

      // Global keys.
      // Layer-switch hotkeys: 1=F.Cu, 2=B.Cu, PgUp=F.Cu, PgDn=B.Cu (KiCad
      // alias). Fire globally so the user can switch active copper layer
      // outside route mode too.
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === "1" || event.key === "PageUp")
      ) {
        event.preventDefault();
        void setCopperLayerAndView("F.Cu");
        return;
      }
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === "2" || event.key === "PageDown")
      ) {
        event.preventDefault();
        void setCopperLayerAndView("B.Cu");
        return;
      }
      if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        workspace.toggleRatsnestVisible();
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
        workspace.clearHighlight();
        if (toolMode === "route") {
          setToolMode("select");
          dispatchRoute({ kind: "cancel" });
        }
        return;
      }
      // Delete all selected traces + vias.
      if (event.key === "Delete" || event.key === "Backspace") {
        const traceIds = [...selection.traceIds];
        const viaIds = [...selection.viaIds];
        if (traceIds.length === 0 && viaIds.length === 0) return;
        event.preventDefault();
        const tasks: Array<Promise<unknown>> = [];
        for (const id of traceIds) tasks.push(workspace.deleteTrace(id));
        for (const id of viaIds) tasks.push(workspace.deleteVia(id));
        void Promise.allSettled(tasks).then(() => {
          setSelection((prev) => ({
            placementIds: prev.placementIds,
            traceIds: new Set(),
            viaIds: new Set(),
          }));
        });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    cursorMm,
    cycleWidth,
    marquee,
    routeState,
    selection,
    setCopperLayerAndView,
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

  const dragOverride = useMemo<ReadonlyMap<string, PcbPointMm> | null>(() => {
    if (!dragSession || !dragSession.moved) return null;
    const dx = dragSession.currentPrimaryMm.x - dragSession.initialPrimaryMm.x;
    const dy = dragSession.currentPrimaryMm.y - dragSession.initialPrimaryMm.y;
    const map = new Map<string, PcbPointMm>();
    for (const [id, initial] of dragSession.initialPositionsByPlacementId) {
      map.set(id, { x: initial.x + dx, y: initial.y + dy });
    }
    return map;
  }, [dragSession]);

  // Live route preview: build path through committed anchors + cursor.
  const routePreview = useMemo(() => {
    if (routeState.kind !== "routing" || !cursorMm) return null;
    const session = routeState.session;
    const cursorAnchor = resolveAnchor(cursorMm);
    const committedAnchors = sessionAnchors(session);
    const anchors = [
      ...committedAnchors,
      pointMmToNm(cursorAnchor.pointMm),
    ];
    const path = buildPreviewPath(
      anchors,
      session.segmentMode,
      session.posture,
    );
    if (path.length < 2) return null;
    // Compute the index where the pending tail begins (last committed anchor).
    const committedCount = committedAnchors.length;
    return {
      pointsNm: path,
      layer: session.layer,
      // Number of segments fully committed = committedCount - 1.
      pendingTailFromIndex: Math.max(0, committedCount - 1),
    };
  }, [cursorMm, resolveAnchor, routeState]);

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

  const onDrcCountChange = props.onDrcCountChange;
  useEffect(() => {
    onDrcCountChange?.(drcViolations.length);
  }, [drcViolations.length, onDrcCountChange]);

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

  const sceneRoutePreview = useMemo(() => {
    if (!routePreview) return null;
    return {
      pointsNm: routePreview.pointsNm,
      layer: routePreview.layer,
      widthMm:
        routeState.kind === "routing"
          ? routeState.session.widthMm
          : (defaultNetClass?.traceWidthMm ?? 0.25),
      pendingTailFromIndex: routePreview.pendingTailFromIndex,
      violationSegmentIndexes: drcViolations.map((v) => v.segmentIndex),
    };
  }, [defaultNetClass?.traceWidthMm, drcViolations, routePreview, routeState]);

  const sceneMarqueeOverlay = useMemo(
    () => ({
      a: marquee.overlayProps.a,
      b: marquee.overlayProps.b,
      color: marquee.overlayProps.color,
    }),
    [marquee.overlayProps.a, marquee.overlayProps.b, marquee.overlayProps.color],
  );

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

  return (
    <div className="relative h-full w-full bg-slate-950">
      {workspace.projection ? (
        <EdaCanvas
          key={props.designId}
          testId="designer-pcb-canvas"
          initialZoom={DEFAULT_PCB_ZOOM}
          backgroundColor="#131313"
          interactionHandler={handler}
          interactionCoordinateTransform={interactionCoordinateTransform}
        >
          <PcbScene
            projection={workspace.projection}
            selection={selection}
            dragOverride={dragOverride}
            highlightedNetId={workspace.highlightedNetId}
            ratsnestVisible={workspace.ratsnestVisible}
            viewSide={workspace.viewSide}
            routeGuide={sceneRouteGuide}
            routePreview={sceneRoutePreview}
            marqueeOverlay={sceneMarqueeOverlay}
          />
        </EdaCanvas>
      ) : null}
      {workspace.projection ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
          <div className="pointer-events-auto">
            <PcbTopToolbar
              activeLayer={displayedCopperLayer}
              onSetActiveLayer={(layer) => {
                if (layer === "F.Cu" || layer === "B.Cu") {
                  void setCopperLayerAndView(layer);
                }
              }}
              selectedPlacementCount={selection.placementIds.size}
              onFlipSelection={() => {
                const ids = [...selection.placementIds];
                if (ids.length === 0) return;
                if (ids.length === 1) void workspace.flipPlacement(ids[0]!);
                else void workspace.flipPlacements(ids);
              }}
              ratsnestVisible={workspace.ratsnestVisible}
              onToggleRatsnest={workspace.toggleRatsnestVisible}
              viewSide={workspace.viewSide}
              routeMode={toolMode === "route"}
              routeSessionActive={routeState.kind === "routing"}
              onToggleRouteMode={() => {
                setToolMode((prev) => (prev === "route" ? "select" : "route"));
                if (toolMode === "route") dispatchRoute({ kind: "cancel" });
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
          {displayedCopperLayer === "F.Cu" ? "Top" : "Bottom"}
        </div>
      ) : null}

      {workspace.projection && props.layersPanelTarget
        ? createPortal(
            <PcbLayersPanel
              activeLayer={displayedCopperLayer}
              onSetActiveLayer={(layer) => {
                if (layer === "F.Cu" || layer === "B.Cu") {
                  void setCopperLayerAndView(layer);
                }
              }}
              visibleLayers={workspace.projection.board.visibleLayers}
              onSetVisibleLayers={(layers) =>
                void workspace.setVisibleLayers(layers)
              }
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
            />,
            props.boardPanelTarget,
          )
        : null}
    </div>
  );
}
