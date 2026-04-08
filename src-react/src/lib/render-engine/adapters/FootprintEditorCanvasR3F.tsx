import { useMemo, useRef } from "react";
import {
  useFootprintEditorStore,
  useFootprintDraft,
  useFootprintChrome,
  useFootprintSelection,
} from "@/components/footprint-editor/footprint-editor-store";
import type {
  FootprintGraphic,
  PadDefinition,
} from "@/components/footprint-editor/types";
import { getPadBounds } from "@/components/footprint-editor/viewport";
import { useCanvasColors } from "@/lib/canvas-theme";
import { EdaCanvas } from "../interaction/EdaCanvas";
import { GridShader } from "../primitives/GridShader";
import { PadInstances } from "../primitives/PadInstances";
import { EDAText } from "../primitives/EDAText";
import {
  isDeleteShortcut,
  isRedoShortcut,
  isSelectAllShortcut,
  isUndoShortcut,
  parseShaderColor,
  useWindowKeyboardShortcuts,
  type KeyboardShortcutBinding,
} from "../utils";
import type {
  InteractionHandler,
  InteractionEvent,
} from "../interaction/types";
import { Units, nmToSceneMm, NM_TO_SCENE } from "../coords";
import { RENDER_ORDER } from "../layers";

const PAD_HIT_THRESHOLD_MM = 0.2;
const GRAPHIC_HIT_THRESHOLD_MM = 0.2;

export function FootprintEditorCanvasR3F() {
  const draft = useFootprintDraft();
  const chrome = useFootprintChrome();
  const selection = useFootprintSelection();
  const store = useFootprintEditorStore;
  const colors = useCanvasColors();

  const { gridSize, showGrid } = chrome;
  const selectedPadIds = selection.selectedPadIds;

  const draggedPadIdRef = useRef<string | null>(null);
  const draggedGraphicIdRef = useRef<string | null>(null);
  const lastDragPointRef = useRef<{ x: number; y: number } | null>(null);

  const padData = useMemo(
    () =>
      draft.pads.map((pad) => ({
        id: pad.id,
        x: Units.mmToNm(pad.position.x),
        y: Units.mmToNm(pad.position.y),
        width: Units.mmToNm(pad.size.width),
        height: Units.mmToNm(pad.size.height),
        rotation: pad.rotation,
        shape:
          pad.shape === "circle" || pad.shape === "oval"
            ? pad.shape
            : pad.shape === "roundrect"
              ? ("roundrect" as const)
              : ("rect" as const),
        selected: selectedPadIds.has(pad.id),
      })),
    [draft.pads, selectedPadIds],
  );

  const interactionHandler = useMemo<InteractionHandler>(() => {
    function toStorePoint(event: InteractionEvent) {
      return {
        x: Units.nmToMm(event.worldPoint.x),
        y: Units.nmToMm(event.worldPoint.y),
      };
    }

    return {
      onPointerDown(event) {
        const state = store.getState();
        const point = toStorePoint(event);
        const snapped = gridSize > 0 ? snapMmPoint(point, gridSize) : point;
        const additive =
          event.modifiers.shift || event.modifiers.ctrl || event.modifiers.meta;

        const hitPad = findPadAtPoint(state.draft.pads, point);
        if (hitPad) {
          state.selectPad(hitPad.id, additive);
          draggedPadIdRef.current = hitPad.id;
          draggedGraphicIdRef.current = null;
          lastDragPointRef.current = snapped;
          return;
        }

        const hitGraphic = findGraphicAtPoint(state.draft.graphics, point);
        if (hitGraphic) {
          state.selectGraphic(hitGraphic.id, additive);
          draggedGraphicIdRef.current = hitGraphic.id;
          draggedPadIdRef.current = null;
          lastDragPointRef.current = snapped;
          return;
        }

        if (!additive) {
          state.clearSelection();
        }
      },

      onPointerMove(event) {
        const state = store.getState();
        const point = toStorePoint(event);
        const snapped = gridSize > 0 ? snapMmPoint(point, gridSize) : point;

        if (draggedPadIdRef.current) {
          state.movePad(draggedPadIdRef.current, snapped);
          lastDragPointRef.current = snapped;
          return;
        }

        if (draggedGraphicIdRef.current && lastDragPointRef.current) {
          const graphic = state.draft.graphics.find(
            (entry) => entry.id === draggedGraphicIdRef.current,
          );
          if (!graphic) {
            return;
          }

          const dx = snapped.x - lastDragPointRef.current.x;
          const dy = snapped.y - lastDragPointRef.current.y;
          if (dx === 0 && dy === 0) {
            return;
          }

          state.updateGraphic(graphic.id, translateGraphic(graphic, dx, dy));
          lastDragPointRef.current = snapped;
        }
      },

      onPointerUp() {
        draggedPadIdRef.current = null;
        draggedGraphicIdRef.current = null;
        lastDragPointRef.current = null;
      },

      onPointerLeave() {
        draggedPadIdRef.current = null;
        draggedGraphicIdRef.current = null;
        lastDragPointRef.current = null;
      },
    };
  }, [gridSize]);

  const keyboardShortcuts = useMemo<KeyboardShortcutBinding[]>(
    () => [
      {
        matches: isDeleteShortcut,
        run: (event) => {
          const state = store.getState();
          const padIds = Array.from(state.chrome.selection.selectedPadIds);
          const graphicIds = Array.from(
            state.chrome.selection.selectedGraphicIds,
          );
          if (padIds.length > 0) {
            if (event.key === "Backspace") {
              event.preventDefault();
            }
            state.removePads(padIds);
          } else if (graphicIds.length > 0) {
            if (event.key === "Backspace") {
              event.preventDefault();
            }
            state.removeGraphics(graphicIds);
          }
        },
      },
      {
        matches: isRedoShortcut,
        run: (event) => {
          event.preventDefault();
          store.getState().redo();
        },
      },
      {
        matches: isUndoShortcut,
        run: (event) => {
          event.preventDefault();
          store.getState().undo();
        },
      },
      {
        matches: isSelectAllShortcut,
        run: (event) => {
          event.preventDefault();
          store.getState().selectAllPads();
        },
      },
    ],
    [],
  );

  useWindowKeyboardShortcuts(keyboardShortcuts, {
    ignoreEditableTarget: true,
  });

  return (
    <EdaCanvas
      testId="footprint-editor-canvas"
      interactionHandler={interactionHandler}
      gridSize={showGrid ? Units.mmToNm(gridSize) : 0}
      backgroundColor={colors.background}
    >
      <GridShader
        gridSize={nmToSceneMm(Units.mmToNm(gridSize))}
        visible={showGrid}
        color={parseShaderColor(colors.gridDot)}
        alpha={0.3}
        originColor={parseShaderColor(colors.originCross)}
        originAlpha={0.5}
      />

      <group scale={[1 / NM_TO_SCENE, 1 / NM_TO_SCENE, 1]}>
        <PadInstances
          pads={padData}
          defaultColor={colors.padFill}
          selectedColor={colors.padSelectedStroke}
        />

        {draft.pads.map((pad) => (
          <EDAText
            key={pad.id}
            position={[
              Units.mmToNm(pad.position.x),
              Units.mmToNm(pad.position.y),
              0,
            ]}
            color={
              selectedPadIds.has(pad.id)
                ? colors.padSelectedStroke
                : colors.padNumber
            }
            fontSize={Units.mmToNm(0.18)}
            anchorX="center"
            anchorY="middle"
            renderOrder={RENDER_ORDER.LABELS}
          >
            {pad.number}
          </EDAText>
        ))}
      </group>
    </EdaCanvas>
  );
}

function snapMmPoint(point: { x: number; y: number }, gridSize: number) {
  if (gridSize <= 0) {
    return point;
  }

  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

function findPadAtPoint(
  pads: PadDefinition[],
  point: { x: number; y: number },
) {
  for (let index = pads.length - 1; index >= 0; index -= 1) {
    const pad = pads[index];
    if (!pad) continue;
    const bounds = getPadBounds(pad);
    if (
      point.x >= bounds.minX - PAD_HIT_THRESHOLD_MM &&
      point.x <= bounds.maxX + PAD_HIT_THRESHOLD_MM &&
      point.y >= bounds.minY - PAD_HIT_THRESHOLD_MM &&
      point.y <= bounds.maxY + PAD_HIT_THRESHOLD_MM
    ) {
      return pad;
    }
  }
  return null;
}

function getGraphicBounds(graphic: FootprintGraphic) {
  switch (graphic.type) {
    case "line":
      return {
        minX: Math.min(graphic.start.x, graphic.end.x),
        minY: Math.min(graphic.start.y, graphic.end.y),
        maxX: Math.max(graphic.start.x, graphic.end.x),
        maxY: Math.max(graphic.start.y, graphic.end.y),
      };
    case "rect":
      return {
        minX: graphic.position.x - graphic.width / 2,
        minY: graphic.position.y - graphic.height / 2,
        maxX: graphic.position.x + graphic.width / 2,
        maxY: graphic.position.y + graphic.height / 2,
      };
    case "circle":
    case "arc":
      return {
        minX: graphic.center.x - graphic.radius,
        minY: graphic.center.y - graphic.radius,
        maxX: graphic.center.x + graphic.radius,
        maxY: graphic.center.y + graphic.radius,
      };
    case "polygon":
      if (graphic.points.length === 0) {
        return null;
      }
      return {
        minX: Math.min(...graphic.points.map((point) => point.x)),
        minY: Math.min(...graphic.points.map((point) => point.y)),
        maxX: Math.max(...graphic.points.map((point) => point.x)),
        maxY: Math.max(...graphic.points.map((point) => point.y)),
      };
    case "text":
      return {
        minX: graphic.position.x,
        minY: graphic.position.y,
        maxX: graphic.position.x,
        maxY: graphic.position.y,
      };
  }
}

function findGraphicAtPoint(
  graphics: FootprintGraphic[],
  point: { x: number; y: number },
) {
  for (let index = graphics.length - 1; index >= 0; index -= 1) {
    const graphic = graphics[index];
    if (!graphic) continue;
    const bounds = getGraphicBounds(graphic);
    if (!bounds) continue;
    if (
      point.x >= bounds.minX - GRAPHIC_HIT_THRESHOLD_MM &&
      point.x <= bounds.maxX + GRAPHIC_HIT_THRESHOLD_MM &&
      point.y >= bounds.minY - GRAPHIC_HIT_THRESHOLD_MM &&
      point.y <= bounds.maxY + GRAPHIC_HIT_THRESHOLD_MM
    ) {
      return graphic;
    }
  }
  return null;
}

function translateGraphic(
  graphic: FootprintGraphic,
  dx: number,
  dy: number,
): FootprintGraphic {
  switch (graphic.type) {
    case "line":
      return {
        ...graphic,
        start: { x: graphic.start.x + dx, y: graphic.start.y + dy },
        end: { x: graphic.end.x + dx, y: graphic.end.y + dy },
      };
    case "rect":
      return {
        ...graphic,
        position: { x: graphic.position.x + dx, y: graphic.position.y + dy },
      };
    case "circle":
      return {
        ...graphic,
        center: { x: graphic.center.x + dx, y: graphic.center.y + dy },
      };
    case "arc":
      return {
        ...graphic,
        center: { x: graphic.center.x + dx, y: graphic.center.y + dy },
      };
    case "polygon":
      return {
        ...graphic,
        points: graphic.points.map((point) => ({
          x: point.x + dx,
          y: point.y + dy,
        })),
      };
    case "text":
      return {
        ...graphic,
        position: { x: graphic.position.x + dx, y: graphic.position.y + dy },
      };
  }
}
