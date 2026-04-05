/**
 * PcbCanvasR3F — R3F wrapper replacing the Canvas 2D PcbCanvas.
 *
 * Connects the PCB Zustand store to the PcbScene via EdaCanvas.
 * Preserves routing, placement drag, layer switching behavior.
 */

import { useEffect, useMemo } from "react";
import { usePcbStore } from "@/stores/pcb-store";
import { useCanvasColors } from "@/lib/canvas-theme";
import { EdaCanvas } from "../interaction/EdaCanvas";
import { GridShader } from "../primitives/GridShader";
import { PcbScene } from "../scenes/PcbScene";
import type {
  InteractionHandler,
  InteractionEvent,
} from "../interaction/types";
import { snapToGrid, Units } from "../coords";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PcbCanvasR3F() {
  const document = usePcbStore((s) => s.document);
  const ratsnest = usePcbStore((s) => s.ratsnest);
  const selectedIds = usePcbStore((s) => s.selectedIds);
  const activeLayer = usePcbStore((s) => s.activeLayer);
  const visibleLayers = usePcbStore((s) => s.visibleLayers);
  const gridSize = usePcbStore((s) => s.gridSize);
  const routingSession = usePcbStore((s) => s.routingSession);

  const colors = useCanvasColors();

  // Extract routing preview from session
  const routingPreview = routingSession?.previewSegments;
  const routingPreviewVias = routingSession?.committedVias;

  // Build interaction handler
  const interactionHandler = useMemo<InteractionHandler>(() => {
    return {
      onPointerDown(event: InteractionEvent) {
        const store = usePcbStore.getState();
        const snapped =
          gridSize > 0
            ? snapToGrid(event.worldPoint, Units.mmToNm(gridSize))
            : event.worldPoint;

        // Convert to mm for PCB store (current convention)
        const worldMm = {
          x: Units.nmToMm(snapped.x),
          y: Units.nmToMm(snapped.y),
        };

        if (routingSession) {
          // During routing — add corner or complete
          store.addRoutingCorner(worldMm);
        }
      },

      onPointerMove(event: InteractionEvent) {
        const store = usePcbStore.getState();
        const worldMm = {
          x: Units.nmToMm(event.worldPoint.x),
          y: Units.nmToMm(event.worldPoint.y),
        };

        if (store.routingSession) {
          store.updateRoutingPreview(worldMm);
        }
      },

      onPointerUp(_event: InteractionEvent) {
        // Commit drag if active
      },

      onPointerLeave() {
        // Clean up state
      },
    };
  }, [routingSession, gridSize]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const store = usePcbStore.getState();

      if (e.key === "Escape") {
        if (store.routingSession) store.cancelRouting();
        else store.clearSelection();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        store.deleteSelectedEntities();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        store.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        store.undo();
      } else if (e.key === "v" && store.routingSession) {
        // Insert via
        store.placeRoutingVia(store.routingSession.startPoint);
      } else if (e.key === "w" && store.routingSession) {
        store.cycleTraceWidth(1);
      } else if (e.key === "f" && store.routingSession) {
        store.flipElbowDirection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <EdaCanvas
      testId="pcb-canvas"
      interactionHandler={interactionHandler}
      gridSize={Units.mmToNm(gridSize)}
      backgroundColor={colors.background}
      initialZoom={4}
    >
      <GridShader
        gridSize={gridSize}
        visible
        color={hexToRgb(colors.gridDot)}
        alpha={0.25}
      />
      <PcbScene
        document={document}
        ratsnest={ratsnest}
        routingPreview={routingPreview}
        routingPreviewVias={routingPreviewVias}
        config={{
          editable: true,
          activeLayer,
          visibleLayers,
          selectedIds,
        }}
        colors={colors}
      />
    </EdaCanvas>
  );
}

function hexToRgb(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b];
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
