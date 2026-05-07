import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { DesignerCommand, PcbPointMm } from "../../../../sdks";
import { nmToSceneMm } from "../../../../shared/frontend/canvas/coords";
import { EdaCanvas } from "../../../../shared/frontend/canvas/interaction/EdaCanvas";
import type {
  InteractionEvent,
  InteractionHandler,
} from "../../../../shared/frontend/canvas/interaction/types";
import { hitPad, hitPlacement } from "./pcb-hit";
import { PcbScene } from "./PcbScene";
import { PcbToolbar } from "./PcbToolbar";
import { usePcbWorkspace } from "./usePcbWorkspace";

const PCB_GRID_MM = 0.25;

function snapMm(value: number): number {
  return Math.round(value / PCB_GRID_MM) * PCB_GRID_MM;
}

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
  const placementsRef = useRef(workspace.projection?.placements ?? []);
  placementsRef.current = workspace.projection?.placements ?? [];

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

  const handler = useMemo<InteractionHandler>(() => {
    return {
      onPointerDown(event) {
        if (event.button !== 0) return;
        const cursor = eventToMm(event);
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
    };
  }, [dragSession, eventToMm, workspace]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return;
      // Global keys (no selection required).
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
        workspace.clearHighlight();
        return;
      }
      // Selection-dependent keys.
      const id = workspace.selectedPlacementId;
      if (!id) return;
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        const placement = placementsRef.current.find((p) => p.id === id);
        if (!placement) return;
        const next = (((placement.rotationDeg + 90) % 360) + 360) % 360;
        const rotation = next as 0 | 90 | 180 | 270;
        void workspace.rotatePlacement(id, rotation);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workspace]);

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
            dragOverride={dragOverride}
            highlightedNetId={workspace.highlightedNetId}
            ratsnestVisible={workspace.ratsnestVisible}
          />
        </EdaCanvas>
      ) : null}
      {workspace.projection ? (
        <PcbToolbar
          activeLayer={workspace.projection.board.activeLayer}
          onSetActiveLayer={(layer) => void workspace.setActiveLayer(layer)}
          ratsnestVisible={workspace.ratsnestVisible}
          onToggleRatsnest={workspace.toggleRatsnestVisible}
          drcCount={0}
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
