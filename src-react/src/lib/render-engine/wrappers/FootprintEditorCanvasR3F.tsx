/**
 * FootprintEditorCanvasR3F — R3F wrapper for the footprint editor.
 *
 * Drop-in replacement for FootprintEditorCanvas (no props, uses store hooks).
 */

import { useEffect, useMemo } from "react";
import {
  useFootprintEditorStore,
  useFootprintDraft,
  useFootprintChrome,
  useFootprintSelection,
} from "@/components/footprint-editor/footprint-editor-store";
import { useCanvasColors } from "@/lib/canvas-theme";
import { EdaCanvas } from "../interaction/EdaCanvas";
import { GridShader } from "../primitives/GridShader";
import { PadInstances } from "../primitives/PadInstances";
import { EDAText } from "../primitives/EDAText";
import type {
  InteractionHandler,
  InteractionEvent,
} from "../interaction/types";
import { Units, nmToScene, NM_TO_SCENE } from "../coords";
import { RENDER_ORDER } from "../layers";

export function FootprintEditorCanvasR3F() {
  const draft = useFootprintDraft();
  const chrome = useFootprintChrome();
  const selection = useFootprintSelection();
  const store = useFootprintEditorStore;
  const colors = useCanvasColors();

  const { gridSize, showGrid } = chrome;
  const selectedPadIds = selection.selectedPadIds;

  const padData = useMemo(
    () =>
      draft.pads.map((pad) => ({
        id: pad.id,
        x: pad.position.x,
        y: pad.position.y,
        width: pad.size.width,
        height: pad.size.height,
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
    return {
      onPointerDown(event: InteractionEvent) {
        if (
          !event.modifiers.shift &&
          !event.modifiers.ctrl &&
          !event.modifiers.meta
        ) {
          store.getState().clearSelection();
        }
      },
      onPointerMove(_event: InteractionEvent) {},
      onPointerUp(_event: InteractionEvent) {},
    };
  }, [store]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = store.getState();
      if (e.key === "Delete" || e.key === "Backspace") {
        const padIds = Array.from(state.chrome.selection.selectedPadIds);
        const graphicIds = Array.from(
          state.chrome.selection.selectedGraphicIds,
        );
        if (padIds.length > 0) state.removePads(padIds);
        else if (graphicIds.length > 0) state.removeGraphics(graphicIds);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        state.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        state.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        state.selectAllPads();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [store]);

  return (
    <EdaCanvas
      testId="footprint-editor-canvas"
      interactionHandler={interactionHandler}
      gridSize={showGrid ? gridSize : 0}
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

      <group scale={[1 / NM_TO_SCENE, 1 / NM_TO_SCENE, 1]}>
        <PadInstances
          pads={padData}
          defaultColor={colors.padFill}
          selectedColor={colors.padSelectedStroke}
        />

        {draft.pads.map((pad) => (
          <EDAText
            key={pad.id}
            position={[pad.position.x, pad.position.y, 0]}
            color={colors.padNumber}
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
