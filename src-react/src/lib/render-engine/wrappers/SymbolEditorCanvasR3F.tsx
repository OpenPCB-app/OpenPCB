/**
 * SymbolEditorCanvasR3F — R3F wrapper for the symbol editor.
 *
 * Drop-in replacement for SymbolEditorCanvas (no props, uses store hooks).
 * Handles: pin click-to-add, pin drag-from-palette, drawing tools (line/rect/circle),
 * pin/graphic selection and drag, keyboard shortcuts.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useSymbolEditorStore,
  useSymbolDraft,
  useSymbolChrome,
  useSymbolSelection,
} from "@/components/symbol-editor/symbol-editor-store";
import {
  type DrawingToolState,
  type DrawingToolType,
  createDrawingToolState,
  handleDrawingMouseDown,
  handleDrawingMouseMove,
  getDrawingPreview,
  commitDrawing,
} from "@/components/symbol-editor/tools/drawing-tools";
import { PIN_DRAG_MIME } from "@/components/symbol-editor/types";
import type { SymbolGraphic } from "@/lib/canvas-core/types";
import { useCanvasColors } from "@/lib/canvas-theme";
import { EdaCanvas } from "../interaction/EdaCanvas";
import { GridShader } from "../primitives/GridShader";
import { SymbolBody } from "../primitives/SymbolBody";
import { PinDots } from "../primitives/PinDots";
import { EDAText } from "../primitives/EDAText";
import type {
  InteractionHandler,
  InteractionEvent,
  DragDropEvent,
} from "../interaction/types";
import { snapToGrid, Units, nmToScene, NM_TO_SCENE } from "../coords";
import { RENDER_ORDER } from "../layers";

export function SymbolEditorCanvasR3F() {
  const draft = useSymbolDraft();
  const chrome = useSymbolChrome();
  const selection = useSymbolSelection();
  const store = useSymbolEditorStore;
  const colors = useCanvasColors();

  const { gridSize, showGrid, activeTool } = chrome;
  const selectedPinIds = selection.selectedPinIds;

  // Drawing tool state
  const drawingStateRef = useRef<DrawingToolState | null>(null);
  const [drawingPreview, setDrawingPreview] = useState<SymbolGraphic | null>(
    null,
  );

  // Pin/graphic drag state
  const isDraggingPin = useRef(false);
  const draggedPinId = useRef<string | null>(null);
  const isDraggingGraphic = useRef(false);
  const draggedGraphicId = useRef<string | null>(null);
  const lastDragPoint = useRef<{ x: number; y: number } | null>(null);

  const pinData = useMemo(
    () =>
      draft.pins.map((pin) => ({
        id: pin.id,
        x: pin.position.x,
        y: pin.position.y,
        connected: false,
      })),
    [draft.pins],
  );

  const isDrawingTool =
    activeTool === "line" || activeTool === "rect" || activeTool === "circle";

  const interactionHandler = useMemo<InteractionHandler>(() => {
    return {
      onPointerDown(event: InteractionEvent) {
        const state = store.getState();
        const snapped = showGrid
          ? snapToGrid(event.worldPoint, gridSize)
          : event.worldPoint;

        // Drawing tool
        if (isDrawingTool) {
          const toolType = state.chrome.activeTool as DrawingToolType;
          drawingStateRef.current = handleDrawingMouseDown(
            drawingStateRef.current ?? createDrawingToolState(toolType),
            snapped,
          );
          setDrawingPreview(getDrawingPreview(drawingStateRef.current));
          return;
        }

        // Select tool — hit test pins then graphics
        const hitPin = findPinAt(state.draft.pins, snapped, gridSize);
        if (hitPin) {
          state.pushHistory();
          state.selectPin(
            hitPin.id,
            event.modifiers.shift ||
              event.modifiers.ctrl ||
              event.modifiers.meta,
          );
          isDraggingPin.current = true;
          draggedPinId.current = hitPin.id;
          lastDragPoint.current = snapped;
          return;
        }

        const hitGraphic = findGraphicAt(
          state.draft.graphics as SymbolGraphic[],
          snapped,
          gridSize,
        );
        if (hitGraphic) {
          state.pushHistory();
          state.selectGraphic(
            hitGraphic.id,
            event.modifiers.shift ||
              event.modifiers.ctrl ||
              event.modifiers.meta,
          );
          isDraggingGraphic.current = true;
          draggedGraphicId.current = hitGraphic.id;
          lastDragPoint.current = snapped;
          return;
        }

        // Click on empty space — clear selection
        if (
          !event.modifiers.shift &&
          !event.modifiers.ctrl &&
          !event.modifiers.meta
        ) {
          state.clearSelection();
        }
      },

      onPointerMove(event: InteractionEvent) {
        const state = store.getState();
        const snapped = showGrid
          ? snapToGrid(event.worldPoint, gridSize)
          : event.worldPoint;

        // Drawing tool preview
        if (isDrawingTool && drawingStateRef.current?.startPoint) {
          drawingStateRef.current = handleDrawingMouseMove(
            drawingStateRef.current,
            snapped,
          );
          setDrawingPreview(getDrawingPreview(drawingStateRef.current));
          return;
        }

        // Pin drag
        if (isDraggingPin.current && draggedPinId.current) {
          state.movePin(draggedPinId.current, snapped);
          lastDragPoint.current = snapped;
          return;
        }

        // Graphic drag
        if (
          isDraggingGraphic.current &&
          draggedGraphicId.current &&
          lastDragPoint.current
        ) {
          const dx = snapped.x - lastDragPoint.current.x;
          const dy = snapped.y - lastDragPoint.current.y;
          if (dx !== 0 || dy !== 0) {
            const graphic = state.draft.graphics.find(
              (g) => g.id === draggedGraphicId.current,
            );
            if (graphic) {
              state.updateGraphic(
                draggedGraphicId.current,
                translateGraphic(graphic as SymbolGraphic, dx, dy),
              );
              lastDragPoint.current = snapped;
            }
          }
          return;
        }
      },

      onPointerUp(_event: InteractionEvent) {
        const state = store.getState();

        // Commit drawing
        if (isDrawingTool && drawingStateRef.current) {
          const graphic = commitDrawing(drawingStateRef.current);
          if (graphic) {
            state.pushHistory();
            state.addGraphic(graphic);
          }
          drawingStateRef.current = null;
          setDrawingPreview(null);
          return;
        }

        // End drag
        isDraggingPin.current = false;
        draggedPinId.current = null;
        isDraggingGraphic.current = false;
        draggedGraphicId.current = null;
        lastDragPoint.current = null;
      },

      onDragOver(_event: DragDropEvent) {},

      onDrop(event: DragDropEvent) {
        if (!event.types.includes(PIN_DRAG_MIME)) return;
        try {
          const data = JSON.parse(event.getData(PIN_DRAG_MIME)) as {
            electricalType?: string;
            defaultSide?: string;
          };
          const snapped = showGrid
            ? snapToGrid(event.worldPoint, gridSize)
            : event.worldPoint;

          const state = store.getState();
          const existingNumbers = new Set(
            state.draft.pins.map((p) => p.number),
          );
          let nextNum = 1;
          while (existingNumbers.has(String(nextNum))) nextNum++;

          state.pushHistory();
          state.addPin({
            id: crypto.randomUUID(),
            name: `Pin ${nextNum}`,
            number: String(nextNum),
            electricalType: (data.electricalType ??
              "passive") as import("@/components/symbol-editor/types").PinElectricalType,
            side: (data.defaultSide ??
              "left") as import("@/lib/canvas-core/types").PinSide,
            position: snapped,
            length: Units.mmToNm(2.54),
          });
        } catch {
          // Ignore invalid data
        }
      },
    };
  }, [store, gridSize, showGrid, isDrawingTool]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = store.getState();
      if (e.key === "Delete" || e.key === "Backspace") {
        const pinIds = Array.from(state.chrome.selection.selectedPinIds);
        const graphicIds = Array.from(
          state.chrome.selection.selectedGraphicIds,
        );
        if (pinIds.length > 0) {
          state.pushHistory();
          state.removePins(pinIds);
        } else if (graphicIds.length > 0) {
          state.pushHistory();
          state.removeGraphics(graphicIds);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        state.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        state.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        state.selectAllPins();
      } else if (e.key === "Escape") {
        // Cancel drawing
        drawingStateRef.current = null;
        setDrawingPreview(null);
        state.clearSelection();
      } else if (e.key === "v" || e.key === "V") {
        state.setTool("select");
      } else if (e.key === "l" || e.key === "L") {
        state.setTool("line");
      } else if (e.key === "r" && !e.ctrlKey && !e.metaKey) {
        state.setTool("rect");
      } else if (e.key === "c" && !e.ctrlKey && !e.metaKey) {
        state.setTool("circle");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [store]);

  // Collect all graphics to render (draft + preview)
  const allGraphics = useMemo(() => {
    const gfx = [...(draft.graphics as SymbolGraphic[])];
    if (drawingPreview) gfx.push(drawingPreview);
    return gfx;
  }, [draft.graphics, drawingPreview]);

  return (
    <EdaCanvas
      testId="symbol-editor-canvas"
      interactionHandler={interactionHandler}
      gridSize={showGrid ? gridSize : 0}
      enableDragDrop
      backgroundColor={colors.background}
    >
      <GridShader
        gridSize={nmToScene(gridSize)}
        visible={showGrid}
        color={hexToRgb(colors.gridDot)}
        alpha={0.3}
        originColor={hexToRgb(colors.originCross)}
        originAlpha={0.5}
      />

      {/* Content group: nm → mm scale */}
      <group scale={[1 / NM_TO_SCENE, 1 / NM_TO_SCENE, 1]}>
        {allGraphics.length > 0 && (
          <SymbolBody
            graphics={allGraphics}
            strokeColor={colors.bodyStroke}
            fillColor={colors.bodyFill}
          />
        )}

        <PinDots
          pins={pinData}
          defaultColor={colors.pinDot}
          connectedColor={colors.pinConnected}
        />

        {draft.pins.map((pin) => (
          <EDAText
            key={pin.id}
            position={[pin.position.x + 200_000, pin.position.y, 0]}
            color={
              selectedPinIds.has(pin.id)
                ? colors.selectionStroke
                : colors.pinLabel
            }
            fontSize={Units.mmToNm(0.2)}
            anchorX="left"
            anchorY="middle"
            renderOrder={RENDER_ORDER.LABELS}
          >
            {pin.name}
          </EDAText>
        ))}
      </group>
    </EdaCanvas>
  );
}

// ---------------------------------------------------------------------------
// Hit testing helpers
// ---------------------------------------------------------------------------

const HIT_THRESHOLD_NM = 200_000; // 0.2mm

function findPinAt(
  pins: Array<{ id: string; position: { x: number; y: number } }>,
  point: { x: number; y: number },
  _gridSize: number,
): { id: string } | null {
  for (const pin of pins) {
    const dx = point.x - pin.position.x;
    const dy = point.y - pin.position.y;
    if (Math.sqrt(dx * dx + dy * dy) < HIT_THRESHOLD_NM) {
      return { id: pin.id };
    }
  }
  return null;
}

function findGraphicAt(
  graphics: SymbolGraphic[],
  point: { x: number; y: number },
  _gridSize: number,
): { id: string } | null {
  for (const g of graphics) {
    if (isPointNearGraphic(g, point)) return { id: g.id };
  }
  return null;
}

function isPointNearGraphic(
  g: SymbolGraphic,
  p: { x: number; y: number },
): boolean {
  const t = HIT_THRESHOLD_NM;
  switch (g.type) {
    case "rect":
      return (
        p.x >= g.x - t &&
        p.x <= g.x + g.width + t &&
        p.y >= g.y - t &&
        p.y <= g.y + g.height + t
      );
    case "circle": {
      const dx = p.x - g.cx;
      const dy = p.y - g.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return Math.abs(dist - g.radius) < t || dist < g.radius;
    }
    case "line": {
      return distToSegment(p, { x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }) < t;
    }
    default:
      return false;
  }
}

function distToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

// ---------------------------------------------------------------------------
// Graphic translation helper
// ---------------------------------------------------------------------------

function translateGraphic(
  g: SymbolGraphic,
  dx: number,
  dy: number,
): SymbolGraphic {
  switch (g.type) {
    case "line":
      return {
        ...g,
        x1: g.x1 + dx,
        y1: g.y1 + dy,
        x2: g.x2 + dx,
        y2: g.y2 + dy,
      };
    case "rect":
      return { ...g, x: g.x + dx, y: g.y + dy };
    case "circle":
      return { ...g, cx: g.cx + dx, cy: g.cy + dy };
    case "arc":
      return { ...g, cx: g.cx + dx, cy: g.cy + dy };
    case "polygon":
      return {
        ...g,
        points: g.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    case "bezier":
      return {
        ...g,
        points: g.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) as [
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
        ],
      };
    case "text":
      return { ...g, x: g.x + dx, y: g.y + dy };
  }
}

function hexToRgb(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  const match = color.match(/[\d.]+/g);
  if (match && match.length >= 3) {
    return [
      parseFloat(match[0] ?? "0") / 255,
      parseFloat(match[1] ?? "0") / 255,
      parseFloat(match[2] ?? "0") / 255,
    ];
  }
  return [0.58, 0.64, 0.72];
}
