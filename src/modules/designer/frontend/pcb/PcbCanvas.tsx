import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type {
  DesignerCommand,
  PcbCopperLayerId,
  PcbPointMm,
  PcbTraceSegmentMode,
} from "../../../../sdks";
import { nmToSceneMm } from "../../../../shared/frontend/canvas/coords";
import { EdaCanvas } from "../../../../shared/frontend/canvas/interaction/EdaCanvas";
import type {
  InteractionEvent,
  InteractionHandler,
} from "../../../../shared/frontend/canvas/interaction/types";
import { hitPad, hitPlacement, hitTrace, hitVia } from "./pcb-hit";
import { PcbScene } from "./PcbScene";
import { PcbToolbar } from "./PcbToolbar";
import { TracePreviewLayer } from "./layers/TracePreviewLayer";
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

const PCB_GRID_MM = 0.25;
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

interface DragSession {
  placementId: string;
  pointerOffsetMm: PcbPointMm;
  currentMm: PcbPointMm;
  moved: boolean;
}

interface PcbCanvasProps {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  dispatchCommand: (command: DesignerCommand) => Promise<unknown>;
  notifyExternalRevisionBump?: (revision: number) => void;
}

function NumberInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}): ReactElement {
  return (
    <label className="grid gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
      {props.label}
      <input
        value={props.value}
        disabled={props.disabled}
        inputMode="decimal"
        onChange={(event) => props.onChange(event.target.value)}
        className="h-8 w-24 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm font-normal text-slate-100 outline-none focus:border-violet-500 disabled:opacity-50"
      />
    </label>
  );
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
  const [cursorMm, setCursorMm] = useState<PcbPointMm | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedViaId, setSelectedViaId] = useState<string | null>(null);
  const placementsRef = useRef(workspace.projection?.placements ?? []);
  placementsRef.current = workspace.projection?.placements ?? [];
  const tracesRef = useRef(workspace.projection?.traces ?? []);
  tracesRef.current = workspace.projection?.traces ?? [];
  const viasRef = useRef(workspace.projection?.vias ?? []);
  viasRef.current = workspace.projection?.vias ?? [];
  const projectionRef = useRef(workspace.projection);
  projectionRef.current = workspace.projection;

  useEffect(() => {
    const board = workspace.projection?.board.outline;
    if (!board) return;
    setWidthText(String(board.widthMm));
    setHeightText(String(board.heightMm));
  }, [workspace.projection?.board.outline]);

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
    } => {
      const pad = hitPad(placementsRef.current, cursor);
      if (pad) {
        const netId =
          padToNet.get(`${pad.placementId}|${pad.padNumber}`) ?? null;
        return { pointMm: pad.worldMm, netId, onPad: true };
      }
      return { pointMm: snapPointMm(cursor), netId: null, onPad: false };
    },
    [padToNet],
  );

  // Commit the current routing session as a `pcb_add_trace` command. Anchors
  // are resolved through the corner-mode + posture-aware preview builder so
  // the path matches what the user sees as the ghost.
  const commitTrace = useCallback(
    async (session: RouteSession, finalAnchorNm: PointNm) => {
      const path = buildPreviewPath(
        [...sessionAnchors(session), finalAnchorNm],
        session.segmentMode,
        session.posture,
      );
      if (path.length < 2) return;
      await workspace.addTrace({
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

  // Width preset list (from board settings, fallback to net-class default).
  const tracePresets = useMemo<number[]>(() => {
    const fromBoard = workspace.projection?.board.tracePresets ?? [];
    if (fromBoard.length > 0) return fromBoard;
    return defaultNetClass ? [defaultNetClass.traceWidthMm] : [0.25];
  }, [defaultNetClass, workspace.projection?.board.tracePresets]);

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
      await commitTrace(session, lastWaypoint);
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
            });
            return;
          }
          // Routing — finishing on a pad commits and exits the session;
          // clicking empty space adds an intermediate waypoint.
          const session = routeState.session;
          if (anchor.onPad) {
            void commitTrace(session, pointMmToNm(anchor.pointMm)).then(() => {
              dispatchRoute({ kind: "cancel" });
            });
            return;
          }
          dispatchRoute({
            kind: "commit-waypoint",
            pointNm: pointMmToNm(anchor.pointMm),
          });
          return;
        }

        // Select mode: click trace/via first, then placement.
        const traceHit = hitTrace(tracesRef.current, cursor, activeCopperLayer);
        if (traceHit) {
          workspace.setSelectedPlacementId(null);
          setDragSession(null);
          setSelectedTraceId(traceHit.trace.id);
          setSelectedViaId(null);
          return;
        }
        const viaHit = hitVia(viasRef.current, cursor);
        if (viaHit) {
          workspace.setSelectedPlacementId(null);
          setDragSession(null);
          setSelectedTraceId(null);
          setSelectedViaId(viaHit.id);
          return;
        }
        // Click on empty space / placement clears trace+via selection.
        setSelectedTraceId(null);
        setSelectedViaId(null);
        const hit = hitPlacement(placementsRef.current, cursor);
        if (hit) {
          workspace.setSelectedPlacementId(hit.id);
          setDragSession({
            placementId: hit.id,
            pointerOffsetMm: {
              x: cursor.x - hit.positionMm.x,
              y: cursor.y - hit.positionMm.y,
            },
            currentMm: { ...hit.positionMm },
            moved: false,
          });
        } else {
          workspace.setSelectedPlacementId(null);
          setDragSession(null);
        }
      },
      onPointerMove(event) {
        const cursor = eventToMm(event);
        setCursorMm(cursor);
        // Hover-highlight: resolve cursor → pad → net (only when not dragging).
        if (!dragSession) {
          const pad = hitPad(placementsRef.current, cursor);
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
          if (next.x === prev.currentMm.x && next.y === prev.currentMm.y) {
            return prev;
          }
          return { ...prev, currentMm: next, moved: true };
        });
      },
      onPointerUp() {
        const session = dragSession;
        if (!session) return;
        if (session.moved) {
          void workspace.movePlacement(session.placementId, session.currentMm);
        }
        setDragSession(null);
      },
      onPointerLeave() {
        setCursorMm(null);
      },
    };
  }, [
    activeCopperLayer,
    commitTrace,
    defaultNetClass,
    dragSession,
    eventToMm,
    padToNet,
    resolveAnchor,
    routeState,
    toolMode,
    workspace,
  ]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return;

      // Tool toggle: R activates Route mode (also rotates a selected
      // placement when in Select mode without an active route session).
      if (event.key === "r" || event.key === "R") {
        if (
          toolMode === "select" &&
          workspace.selectedPlacementId &&
          !event.shiftKey
        ) {
          event.preventDefault();
          const placement = placementsRef.current.find(
            (p) => p.id === workspace.selectedPlacementId,
          );
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
        if (event.key === "+" || event.key === "-") {
          // Smart Via: drop via at cursor + flip layer.
          event.preventDefault();
          if (!cursorMm) return;
          const snapped = snapPointMm(cursorMm);
          const viaCenterNm = pointMmToNm(snapped);
          const nextLayer: PcbCopperLayerId =
            session.layer === "F.Cu" ? "B.Cu" : "F.Cu";
          // Persist via via the workspace, then update the route session.
          void workspace
            .addVia({
              centerMm: snapped,
              netId: session.netId,
              netClassId: session.netClassId,
            })
            .then(() => {
              dispatchRoute({
                kind: "switch-layer",
                layer: nextLayer,
                viaCenterNm,
              });
            });
          return;
        }
        if (event.key === "v" || event.key === "V") {
          // Drop via without layer change.
          event.preventDefault();
          if (!cursorMm) return;
          const snapped = snapPointMm(cursorMm);
          void workspace.addVia({
            centerMm: snapped,
            netId: session.netId,
            netClassId: session.netClassId,
          });
          return;
        }
      }

      // Global keys.
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
        workspace.setSelectedPlacementId(null);
        setDragSession(null);
        setSelectedTraceId(null);
        setSelectedViaId(null);
        workspace.clearHighlight();
        if (toolMode === "route") {
          setToolMode("select");
          dispatchRoute({ kind: "cancel" });
        }
        return;
      }
      // Delete selected trace / via.
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedTraceId) {
          event.preventDefault();
          void workspace.deleteTrace(selectedTraceId).then(() => {
            setSelectedTraceId(null);
          });
          return;
        }
        if (selectedViaId) {
          event.preventDefault();
          void workspace.deleteVia(selectedViaId).then(() => {
            setSelectedViaId(null);
          });
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    cursorMm,
    cycleWidth,
    routeState,
    selectedTraceId,
    selectedViaId,
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

  if (!props.designId) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950 text-sm text-slate-500">
        Select or create a design to open PCB layout
      </div>
    );
  }

  const dragOverride =
    dragSession && dragSession.moved
      ? { id: dragSession.placementId, positionMm: dragSession.currentMm }
      : null;

  // Live route preview: build path through committed anchors + cursor.
  const routePreview = useMemo(() => {
    if (routeState.kind !== "routing" || !cursorMm) return null;
    const session = routeState.session;
    const cursorAnchor = resolveAnchor(cursorMm);
    const anchors = [
      ...sessionAnchors(session),
      pointMmToNm(cursorAnchor.pointMm),
    ];
    const path = buildPreviewPath(
      anchors,
      session.segmentMode,
      session.posture,
    );
    if (path.length < 2) return null;
    // Compute the index where the pending tail begins (last committed anchor).
    const committedCount = sessionAnchors(session).length;
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
      padNetMap: (() => {
        const m = new Map<string, string>();
        for (const seg of workspace.projection.ratsnest) {
          m.set(`${seg.fromPlacementId}|${seg.fromPadNumber}`, seg.netId);
          m.set(`${seg.toPlacementId}|${seg.toPadNumber}`, seg.netId);
        }
        return m;
      })(),
      netClasses: workspace.projection.board.netClasses,
      netClassId: routeState.session.netClassId,
      designRules: workspace.projection.board.designRules,
    });
  }, [routePreview, routeState, workspace.projection]);

  return (
    <div className="relative h-full w-full bg-slate-950">
      {workspace.projection ? (
        <EdaCanvas
          key={props.designId}
          testId="designer-pcb-canvas"
          initialZoom={6}
          backgroundColor="#020617"
          interactionHandler={handler}
        >
          <PcbScene
            projection={workspace.projection}
            selectedPlacementId={workspace.selectedPlacementId}
            selectedTraceId={selectedTraceId}
            selectedViaId={selectedViaId}
            dragOverride={dragOverride}
            highlightedNetId={workspace.highlightedNetId}
            ratsnestVisible={workspace.ratsnestVisible}
          />
          {routePreview ? (
            <TracePreviewLayer
              pointsNm={routePreview.pointsNm}
              layer={routePreview.layer}
              widthMm={
                routeState.kind === "routing"
                  ? routeState.session.widthMm
                  : (defaultNetClass?.traceWidthMm ?? 0.25)
              }
              pendingTailFromIndex={routePreview.pendingTailFromIndex}
              violationSegmentIndexes={drcViolations.map((v) => v.segmentIndex)}
            />
          ) : null}
        </EdaCanvas>
      ) : null}
      {workspace.projection ? (
        <PcbToolbar
          activeLayer={workspace.projection.board.activeLayer}
          onSetActiveLayer={(layer) => void workspace.setActiveLayer(layer)}
          ratsnestVisible={workspace.ratsnestVisible}
          onToggleRatsnest={workspace.toggleRatsnestVisible}
          drcCount={drcViolations.length}
          routeMode={toolMode === "route"}
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
          posture={
            routeState.kind === "routing" ? routeState.session.posture : "auto"
          }
          onCyclePosture={() => dispatchRoute({ kind: "cycle-posture" })}
        />
      ) : null}
      {!workspace.projection ? (
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          {workspace.loading ? "Loading PCB..." : "PCB projection unavailable"}
        </div>
      ) : null}

      <div className="absolute right-3 top-3 z-20 w-72 rounded-lg border border-slate-800 bg-slate-950/95 p-3 shadow-xl backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">PCB board</h3>
            <p className="text-xs text-slate-500">Fixed rectangle, mm</p>
          </div>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
            2-layer
          </span>
        </div>

        <div className="flex items-end gap-2">
          <NumberInput
            label="Width mm"
            value={widthText}
            onChange={setWidthText}
            disabled={workspace.saving}
          />
          <NumberInput
            label="Height mm"
            value={heightText}
            onChange={setHeightText}
            disabled={workspace.saving}
          />
          <button
            type="button"
            disabled={!valid || workspace.saving || !workspace.projection}
            onClick={() => void workspace.updateBoardSize(widthMm, heightMm)}
            className="h-8 rounded-md bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {workspace.saving ? "Saving" : "Apply"}
          </button>
        </div>

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={!workspace.canUndo}
            onClick={() => void workspace.undo()}
            className="h-7 rounded-md border border-slate-700 bg-slate-900 px-2 text-[11px] font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            disabled={!workspace.canRedo}
            onClick={() => void workspace.redo()}
            className="h-7 rounded-md border border-slate-700 bg-slate-900 px-2 text-[11px] font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Redo
          </button>
        </div>

        {workspace.error ? (
          <p className="mt-3 rounded border border-red-900 bg-red-950/70 px-2 py-1.5 text-xs text-red-200">
            {workspace.error}
          </p>
        ) : null}

        {workspace.projection?.warnings.length ? (
          <ul className="mt-3 max-h-40 list-disc space-y-0.5 overflow-y-auto rounded border border-amber-900 bg-amber-950/50 px-4 py-1.5 text-xs text-amber-200">
            {workspace.projection.warnings.map((warning, i) => (
              <li key={i} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
