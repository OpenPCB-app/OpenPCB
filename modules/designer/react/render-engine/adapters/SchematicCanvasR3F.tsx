/**
 * SchematicCanvasR3F — R3F wrapper replacing the Canvas 2D SchematicCanvas.
 *
 * Full interaction support: component placement, pin-to-pin wiring,
 * symbol selection/drag, net labels. Delegates to useSchematicInteractionController.
 */

import { useCallback, useMemo, useRef } from "react";
import { useSchematicStore } from "@/stores/schematic-store";
import {
  useSchematicInteractionController,
  type SchematicInteractionController,
} from "@/components/pcb/useSchematicInteractionController";
import { PALETTE_SYMBOL_KIND_MIME } from "@/components/pcb/symbol-library";
import { useCanvasColors } from "@/lib/canvas-theme";
import { EdaCanvas } from "../interaction/EdaCanvas";
import { GridShader } from "../primitives/GridShader";
import { SchematicScene } from "../scenes/SchematicScene";
import {
  isDeleteShortcut,
  isEscapeShortcut,
  isRedoShortcut,
  isUndoShortcut,
  matchesKey,
  parseShaderColor,
  useWindowKeyboardShortcuts,
  type KeyboardShortcutBinding,
} from "../utils";
import type {
  InteractionHandler,
  InteractionEvent,
  DragDropEvent,
} from "../interaction/types";
import { snapPointToGridNm, nmToSceneMm } from "../coords";
import { buildOrthogonalWirePathWithWaypoints } from "@/components/pcb/canvas/wires";
import type { Point } from "@/components/pcb/types";

// Hit radius for pin detection in nanometers
// Strictly match visual pin size (80k nm) with minimal tolerance
const PIN_HIT_RADIUS_NM = 100_000; // 0.1mm - must click directly on pin

interface SchematicCanvasR3FProps {
  controller?: SchematicInteractionController;
}

export function SchematicCanvasR3F({ controller }: SchematicCanvasR3FProps) {
  const fallbackController = useSchematicInteractionController();
  const ctrl = controller ?? fallbackController;

  // Store selectors
  const document = useSchematicStore((s) => s.persisted.document);
  const connectivity = useSchematicStore((s) => s.derived.connectivity);
  const symbolBounds = useSchematicStore(
    (s) => s.derived.hitTestCache.symbolBounds,
  );
  const selectedIds = useSchematicStore((s) => s.chrome.selectedEntityIds);
  const gridSize = useSchematicStore((s) => s.chrome.gridSize);
  const showGrid = useSchematicStore((s) => s.chrome.showGrid);
  const session = useSchematicStore((s) => s.session);
  const activeTool = useSchematicStore((s) => s.chrome.activeTool);

  const colors = useCanvasColors();

  // Pending drag state (for 5px threshold)
  const pendingDrag = useRef<{
    symbolId: string;
    startClient: { x: number; y: number };
    startWorld: Point;
  } | null>(null);

  // Connected pin IDs (for pin dot coloring)
  const connectedPinIds = useMemo(() => {
    if (!document) return new Set<string>();
    const ids = new Set<string>();
    for (const wire of document.wires) {
      if (wire.sourcePinId) ids.add(wire.sourcePinId);
      if (wire.targetPinId) ids.add(wire.targetPinId);
    }
    return ids;
  }, [document]);

  /** Find the nearest pin within hit radius */
  const findPinAt = useCallback(function findPinAt(
    worldPoint: Point,
  ): { pinId: string; symbolId: string } | null {
    const anchors =
      useSchematicStore.getState().derived.hitTestCache.connectorAnchors;
    let closestDist = PIN_HIT_RADIUS_NM;
    let closestResult: { pinId: string; symbolId: string } | null = null;

    for (const [pinId, pos] of Object.entries(anchors)) {
      const dx = worldPoint.x - pos.x;
      const dy = worldPoint.y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        // Extract symbolId from pinId (format: "symbolId:pinIndex" or just pinId)
        // The connector anchors use the pin.id directly; we need to find which symbol owns it
        const doc = useSchematicStore.getState().persisted.document;
        if (doc) {
          for (const sym of doc.symbols) {
            if (sym.pins.some((p) => p.id === pinId)) {
              closestResult = { pinId, symbolId: sym.id };
              break;
            }
          }
        }
      }
    }

    if (
      typeof window !== "undefined" &&
      window.location.search.includes("e2e=schematic")
    ) {
      const pin2 = anchors["pin-2"];
      console.log("[findPinAt]", {
        worldPoint,
        pin2,
        anchorsCount: Object.keys(anchors).length,
        closestResult,
        closestDist,
      });
    }

    return closestResult;
  }, []);

  /** Find symbol body at world point */
  const findSymbolAt = useCallback(function findSymbolAt(
    worldPoint: Point,
  ): string | null {
    const bounds =
      useSchematicStore.getState().derived.hitTestCache.symbolBounds;
    // Iterate in reverse (top-to-bottom) for correct z-order
    const doc = useSchematicStore.getState().persisted.document;
    if (!doc) return null;
    for (let i = doc.symbols.length - 1; i >= 0; i--) {
      const sym = doc.symbols[i];
      if (!sym) continue;
      const b = bounds[sym.id];
      if (!b) continue;
      if (
        worldPoint.x >= b.minX &&
        worldPoint.x <= b.maxX &&
        worldPoint.y >= b.minY &&
        worldPoint.y <= b.maxY
      ) {
        return sym.id;
      }
    }
    return null;
  }, []);

  const interactionHandler = useMemo<InteractionHandler>(() => {
    return {
      onPointerDown(event: InteractionEvent) {
        const snapped = showGrid
          ? snapPointToGridNm(event.worldPoint, gridSize)
          : event.worldPoint;

        // Placement session — commit on click
        if (session?.type === "placement") {
          ctrl.commitPlacement(snapped);
          return;
        }

        // Active wire session — check if clicking a target pin or adding waypoint
        if (session?.type === "wire") {
          const pinHit = findPinAt(event.worldPoint);
          if (pinHit) {
            // Commit wire to target pin
            const success = ctrl.commitWire(pinHit.pinId);
            if (!success) {
              // If commit failed (same pin), add waypoint instead
              ctrl.addWireWaypoint(snapped);
            }
          } else {
            ctrl.addWireWaypoint(snapped);
          }
          return;
        }

        // Net label tool
        if (activeTool === "label") {
          const name = window.prompt("Net name:");
          if (name) ctrl.commitNetLabel(name, snapped);
          return;
        }

        // Wire tool — start wire only from pin hit
        if (activeTool === "wire") {
          const pinHit = findPinAt(event.worldPoint);
          if (pinHit) {
            ctrl.beginWire(pinHit.pinId);
            return;
          }
        }

        if (activeTool === "select") {
          const pinHit = findPinAt(event.worldPoint);
          if (pinHit) {
            ctrl.beginWire(pinHit.pinId);
            return;
          }

          const symbolId = findSymbolAt(event.worldPoint);
          if (symbolId) {
            const additive =
              event.modifiers.shift ||
              event.modifiers.ctrl ||
              event.modifiers.meta;
            if (additive) {
              useSchematicStore.getState().addToSelection([symbolId]);
            } else {
              useSchematicStore.getState().selectEntities([symbolId]);
            }
            pendingDrag.current = {
              symbolId,
              startClient: event.screenPoint,
              startWorld: snapped,
            };
            return;
          }

          // Click on empty space — clear selection
          if (
            !event.modifiers.shift &&
            !event.modifiers.ctrl &&
            !event.modifiers.meta
          ) {
            useSchematicStore.getState().clearSelection();
          }
        }
      },

      onPointerMove(event: InteractionEvent) {
        const snapped = showGrid
          ? snapPointToGridNm(event.worldPoint, gridSize)
          : event.worldPoint;

        // Update placement preview
        if (session?.type === "placement") {
          ctrl.updatePlacementPreview(snapped);
          return;
        }

        // Update wire preview — build full orthogonal path from source pin
        if (session?.type === "wire") {
          const anchors =
            useSchematicStore.getState().derived.hitTestCache.connectorAnchors;
          const sourcePoint = anchors[session.sourcePinId];
          if (!sourcePoint) return;

          const pinHit = findPinAt(event.worldPoint);
          let targetPoint = snapped;
          let targetPinId: string | undefined;

          if (pinHit && pinHit.pinId !== session.sourcePinId) {
            const pinPos = anchors[pinHit.pinId];
            if (pinPos) {
              targetPoint = pinPos;
              targetPinId = pinHit.pinId;
            }
          }

          const builtPath = buildOrthogonalWirePathWithWaypoints(
            sourcePoint,
            session.waypoints,
            targetPoint,
          );
          ctrl.updateWirePreview(builtPath, targetPinId);
          return;
        }

        // Pending drag — check threshold
        if (pendingDrag.current) {
          const dx = event.screenPoint.x - pendingDrag.current.startClient.x;
          const dy = event.screenPoint.y - pendingDrag.current.startClient.y;
          if (Math.sqrt(dx * dx + dy * dy) > 5) {
            const selected =
              useSchematicStore.getState().chrome.selectedEntityIds;
            ctrl.beginDragMove(
              Array.from(selected),
              pendingDrag.current.symbolId,
              pendingDrag.current.startWorld,
            );
            pendingDrag.current = null;
          }
          return;
        }

        // Active drag — update position
        if (session?.type === "drag") {
          const delta = {
            x: snapped.x - session.startPointer.x,
            y: snapped.y - session.startPointer.y,
          };
          ctrl.updateDragMove(delta);
        }
      },

      onPointerUp(_event: InteractionEvent) {
        // Commit drag
        if (session?.type === "drag") {
          ctrl.commitDragMove();
        }
        pendingDrag.current = null;
      },

      onPointerLeave() {
        if (session?.type === "placement") {
          ctrl.updatePlacementPreview(null);
        }
        pendingDrag.current = null;
      },

      // Drag-drop from symbol palette
      // Read session from store directly to avoid stale closure issues —
      // the palette starts the session before drag events reach the canvas.
      onDragEnter(event: DragDropEvent) {
        const currentSession = useSchematicStore.getState().session;
        if (currentSession?.type === "placement") {
          ctrl.updatePlacementPreview(event.snappedPoint);
          return;
        }
        // Fallback: try to start from dataTransfer (may fail in some browsers)
        if (event.types.includes(PALETTE_SYMBOL_KIND_MIME)) {
          const kind = event.getData(PALETTE_SYMBOL_KIND_MIME);
          if (kind) {
            ctrl.beginPlacement(kind);
            ctrl.updatePlacementPreview(event.snappedPoint);
          }
        }
      },

      onDragOver(event: DragDropEvent) {
        const currentSession = useSchematicStore.getState().session;
        if (currentSession?.type === "placement") {
          ctrl.updatePlacementPreview(event.snappedPoint);
        }
      },

      onDragLeave() {
        const currentSession = useSchematicStore.getState().session;
        if (currentSession?.type === "placement") {
          ctrl.updatePlacementPreview(null);
        }
      },

      onDrop(event: DragDropEvent) {
        const currentSession = useSchematicStore.getState().session;
        if (currentSession?.type === "placement") {
          ctrl.commitPlacement(event.snappedPoint);
        }
      },
    };
  }, [ctrl, session, activeTool, gridSize, showGrid, findPinAt, findSymbolAt]);

  const keyboardShortcuts = useMemo<KeyboardShortcutBinding[]>(
    () => [
      {
        matches: isEscapeShortcut,
        run: () => {
          ctrl.cancelSession();
          pendingDrag.current = null;
        },
      },
      {
        matches: isDeleteShortcut,
        run: () => {
          ctrl.deleteSelectedEntities();
        },
      },
      {
        matches: isRedoShortcut,
        run: (event) => {
          event.preventDefault();
          useSchematicStore.getState().redo();
        },
      },
      {
        matches: isUndoShortcut,
        run: (event) => {
          event.preventDefault();
          useSchematicStore.getState().undo();
        },
      },
      {
        matches: (event) => matchesKey(event, "r"),
        run: () => {
          if (session?.type === "placement") {
            ctrl.rotatePlacement();
          }
        },
      },
      {
        matches: (event) => matchesKey(event, "w"),
        run: () => {
          useSchematicStore.getState().chrome.activeTool !== "wire"
            ? ctrl.activateTool("wire")
            : ctrl.activateTool("select");
        },
      },
    ],
    [ctrl, session],
  );

  useWindowKeyboardShortcuts(keyboardShortcuts, {
    ignoreEditableTarget: true,
  });

  return (
    <EdaCanvas
      testId="schematic-canvas"
      interactionHandler={interactionHandler}
      gridSize={showGrid ? gridSize : 0}
      enableDragDrop
      backgroundColor={colors.background}
    >
      <GridShader
        gridSize={nmToSceneMm(gridSize)}
        visible={showGrid}
        color={parseShaderColor(colors.gridDot)}
        alpha={0.3}
        originColor={parseShaderColor(colors.originCross)}
      />
      <SchematicScene
        document={document}
        connectivity={connectivity}
        session={session}
        config={{
          editable: true,
          selectedIds,
          connectedPinIds,
          gridSize,
        }}
        colors={colors}
        symbolBounds={symbolBounds}
      />
    </EdaCanvas>
  );
}
