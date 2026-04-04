import { useRef, useEffect, useCallback, useMemo } from "react";
import { useSchematicStore } from "@/stores/schematic-store";
import { useCanvasWheel } from "@/hooks/useCanvasWheel";
import { renderGrid } from "./grid";
import {
  domEventToScreen,
  schematicToScreen,
  screenToSchematic,
  snapToGrid,
} from "./viewport";
import {
  createHitTestCache,
  createNetLabelHitTestCache,
  hitTestScreen,
} from "./hit-test";
import { renderSymbol } from "./symbols";
import {
  buildOrthogonalWirePathWithWaypoints,
  collectDirectlyAttachedPinIds,
  renderJunctions,
  renderWire,
} from "./wires";
import { renderNetLabels } from "./net-labels";
import {
  createPreviewSymbol,
  PALETTE_SYMBOL_KIND_MIME,
} from "../symbol-library";
import {
  useSchematicInteractionController,
  type SchematicInteractionController,
} from "../useSchematicInteractionController";
import { GRID_PRESETS, type Point, type SymbolKind } from "../types";
import {
  getGridColors,
  getSymbolColors,
  getWireColors,
  useCanvasColors,
} from "@/lib/canvas-theme";

interface SchematicCanvasProps {
  controller?: SchematicInteractionController;
}

export function SchematicCanvas({ controller }: SchematicCanvasProps) {
  const DRAG_THRESHOLD_PX = 5;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const pendingDragRef = useRef<{
    symbolId: string;
    startClient: { x: number; y: number };
    didStartDrag: boolean;
  } | null>(null);

  const fallbackController = useSchematicInteractionController();
  const interactionController = controller ?? fallbackController;
  const pan = useSchematicStore((s) => s.pan);
  const zoomAt = useSchematicStore((s) => s.zoomAt);
  const viewport = useSchematicStore((s) => s.chrome.viewport);
  const gridSize = useSchematicStore((s) => s.chrome.gridSize);
  const showGrid = useSchematicStore((s) => s.chrome.showGrid);
  const session = useSchematicStore((s) => s.session);
  const setHitTestCache = useSchematicStore((s) => s.setHitTestCache);
  const setPaletteDragSymbolKind = useSchematicStore(
    (s) => s.setPaletteDragSymbolKind,
  );
  const resetViewport = useSchematicStore((s) => s.resetViewport);
  const document = useSchematicStore((s) => s.persisted.document);
  const canvasColors = useCanvasColors();
  const gridColors = useMemo(() => getGridColors(canvasColors), [canvasColors]);
  const symbolColors = useMemo(
    () => getSymbolColors(canvasColors),
    [canvasColors],
  );
  const wireColors = useMemo(() => getWireColors(canvasColors), [canvasColors]);

  const getPlacementPosition = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return null;
      }

      const screenPoint = domEventToScreen(
        clientX,
        clientY,
        canvas.getBoundingClientRect(),
      );
      const worldPoint = screenToSchematic(
        screenPoint.x,
        screenPoint.y,
        viewport,
      );

      // Only snap to grid when grid is enabled
      return showGrid ? snapToGrid(worldPoint, gridSize) : worldPoint;
    },
    [gridSize, showGrid, viewport],
  );

  const updatePlacementPreviewFromClient = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const position = getPlacementPosition(clientX, clientY);
      interactionController.updatePlacementPreview(position);
      return position;
    },
    [getPlacementPosition, interactionController],
  );

  const readDraggedSymbolKind = useCallback(
    (dataTransfer: DataTransfer | null): SymbolKind | null => {
      const dragKind =
        dataTransfer?.getData(PALETTE_SYMBOL_KIND_MIME) ||
        dataTransfer?.getData("text/plain");
      if (dragKind) {
        return dragKind as SymbolKind;
      }

      const state = useSchematicStore.getState();
      if (state.draggedSymbolKind) {
        return state.draggedSymbolKind;
      }

      return state.session?.type === "placement"
        ? state.session.symbolKind
        : null;
    },
    [],
  );

  const syncDragPlacementSession = useCallback(
    (kind: SymbolKind) => {
      const currentSession = useSchematicStore.getState().session;
      if (
        currentSession?.type === "placement" &&
        currentSession.symbolKind === kind
      ) {
        return;
      }

      interactionController.beginPlacement(kind);
    },
    [interactionController],
  );

  const updateDragPreviewFromEvent = useCallback(
    (kind: SymbolKind, clientX: number, clientY: number) => {
      syncDragPlacementSession(kind);
      updatePlacementPreviewFromClient(clientX, clientY);
    },
    [syncDragPlacementSession, updatePlacementPreviewFromClient],
  );

  // Resize canvas to fill container
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }, []);

  // Render frame
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = canvasColors.background;
    ctx.fillRect(0, 0, width, height);

    // Grid
    const store = useSchematicStore.getState();
    if (store.chrome.showGrid) {
      const currentPreset = GRID_PRESETS.find(
        (p) => p.id === store.chrome.gridPresetId,
      );
      renderGrid(
        ctx,
        width,
        height,
        store.chrome.viewport,
        store.chrome.gridSize,
        currentPreset?.style ?? "dots",
        gridColors,
      );
    }

    const document = store.persisted.document;
    if (document) {
      const selectedIds = store.chrome.selectedEntityIds;
      const allConnectedPinIds = new Set(
        collectDirectlyAttachedPinIds(document.wires),
      );

      for (const wire of document.wires) {
        renderWire(ctx, wire.points, store.chrome.viewport, {
          selected: selectedIds.has(wire.id),
          colors: wireColors,
        });
      }

      if (store.derived.connectivity?.junctions.length) {
        renderJunctions(
          ctx,
          store.derived.connectivity.junctions,
          store.chrome.viewport,
          wireColors,
        );
      }

      if (document.labels.length > 0) {
        renderNetLabels(
          ctx,
          document.labels,
          store.chrome.viewport,
          selectedIds,
        );
      }

      for (const symbol of document.symbols) {
        const symbolConnectedPinIds = new Set(
          symbol.pins
            .map((pin) => pin.id)
            .filter((pinId) => allConnectedPinIds.has(pinId)),
        );

        renderSymbol(ctx, symbol, store.chrome.viewport, {
          selected: selectedIds.has(symbol.id),
          colors: symbolColors,
          connectedPinIds:
            symbolConnectedPinIds.size > 0 ? symbolConnectedPinIds : undefined,
        });
      }

      if (
        store.session?.type === "placement" &&
        store.session.previewPosition
      ) {
        renderSymbol(
          ctx,
          createPreviewSymbol(
            store.session.symbolKind,
            store.session.previewPosition,
            store.session.rotation,
            store.componentLibraryIndex,
          ),
          store.chrome.viewport,
          { preview: true, colors: symbolColors },
        );
      }

      if (store.session?.type === "wire") {
        renderWire(ctx, store.session.previewPoints, store.chrome.viewport, {
          preview: true,
          colors: wireColors,
        });
      }

      for (const selectedId of selectedIds) {
        const bounds = store.derived.hitTestCache.symbolBounds[selectedId];
        if (!bounds) {
          continue;
        }

        const screenMin = schematicToScreen(
          bounds.minX,
          bounds.minY,
          store.chrome.viewport,
        );
        const screenMax = schematicToScreen(
          bounds.maxX,
          bounds.maxY,
          store.chrome.viewport,
        );

        ctx.save();
        ctx.strokeStyle = canvasColors.selectionStroke;
        ctx.fillStyle = canvasColors.selectionFill;
        ctx.lineWidth = 1.5;
        ctx.fillRect(
          Math.min(screenMin.x, screenMax.x) - 6,
          Math.min(screenMin.y, screenMax.y) - 6,
          Math.abs(screenMax.x - screenMin.x) + 12,
          Math.abs(screenMax.y - screenMin.y) + 12,
        );
        ctx.strokeRect(
          Math.min(screenMin.x, screenMax.x) - 6,
          Math.min(screenMin.y, screenMax.y) - 6,
          Math.abs(screenMax.x - screenMin.x) + 12,
          Math.abs(screenMax.y - screenMin.y) + 12,
        );
        ctx.restore();
      }
    }

    ctx.restore();
  }, [canvasColors, gridColors, symbolColors, wireColors]);

  // Animation loop
  useEffect(() => {
    let running = true;

    const loop = () => {
      if (!running) return;
      render();
      rafRef.current = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [render]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    resizeCanvas();

    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(container);

    return () => observer.disconnect();
  }, [resizeCanvas]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !document?.id) {
      return;
    }

    const rect = container.getBoundingClientRect();
    resetViewport(rect.width, rect.height);
  }, [document?.id, resetViewport]);

  useEffect(() => {
    setHitTestCache(createHitTestCache(document?.symbols ?? []));
  }, [document, setHitTestCache]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle click or Space+left click = pan
      if (
        e.button === 1 ||
        (e.button === 0 &&
          e.shiftKey &&
          useSchematicStore.getState().chrome.activeTool !== "select")
      ) {
        isPanning.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }

      if (e.button !== 0) {
        return;
      }

      if (session?.type === "placement") {
        const position = getPlacementPosition(e.clientX, e.clientY);
        if (!position) {
          return;
        }

        interactionController.commitPlacement(position);
        return;
      }

      if (useSchematicStore.getState().chrome.activeTool === "label") {
        const position = getPlacementPosition(e.clientX, e.clientY);
        if (!position) {
          return;
        }

        const netName = window.prompt("Enter net name:", "NET1");
        if (netName) {
          interactionController.commitNetLabel(netName, position);
        }
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const store = useSchematicStore.getState();
      const document = store.persisted.document;
      if (!document) {
        store.clearSelection();
        return;
      }

      const screenPoint = domEventToScreen(
        e.clientX,
        e.clientY,
        canvas.getBoundingClientRect(),
      );
      const hit = hitTestScreen(
        screenPoint.x,
        screenPoint.y,
        document.symbols,
        store.chrome.viewport,
        store.derived.hitTestCache,
        document.labels,
        createNetLabelHitTestCache(document.labels, store.chrome.viewport),
      );

      if (store.session?.type === "wire") {
        if (
          hit?.kind === "connector" &&
          hit.pinId !== store.session.sourcePinId
        ) {
          interactionController.commitWire(hit.pinId);
        } else {
          const worldPoint = screenToSchematic(
            screenPoint.x,
            screenPoint.y,
            viewport,
          );
          const waypointPoint = showGrid
            ? snapToGrid(worldPoint, gridSize)
            : worldPoint;

          interactionController.addWireWaypoint(waypointPoint);
        }
        return;
      }

      if (
        hit?.kind === "connector" &&
        (store.chrome.activeTool === "select" ||
          store.chrome.activeTool === "wire")
      ) {
        interactionController.beginWire(hit.pinId);
        return;
      }

      if (hit?.kind === "body" && store.chrome.activeTool === "select") {
        const isMultiSelect = e.shiftKey || e.metaKey || e.ctrlKey;
        if (isMultiSelect) {
          store.addToSelection([hit.symbolId]);
        } else if (!store.chrome.selectedEntityIds.has(hit.symbolId)) {
          store.selectEntities([hit.symbolId]);
        }

        pendingDragRef.current = {
          symbolId: hit.symbolId,
          startClient: { x: e.clientX, y: e.clientY },
          didStartDrag: false,
        };
        return;
      }

      if (hit?.kind === "netLabel" && store.chrome.activeTool === "select") {
        const isMultiSelect = e.shiftKey || e.metaKey || e.ctrlKey;
        if (isMultiSelect) {
          store.addToSelection([hit.labelId]);
        } else {
          store.selectEntities([hit.labelId]);
        }
        return;
      }

      if (store.chrome.activeTool === "select") {
        store.clearSelection();
      }
    },
    [
      getPlacementPosition,
      gridSize,
      showGrid,
      interactionController,
      session,
      viewport,
    ],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning.current) {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        pan(dx, dy);
        lastMouse.current = { x: e.clientX, y: e.clientY };
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      if (session?.type === "placement") {
        updatePlacementPreviewFromClient(e.clientX, e.clientY);
        return;
      }

      if (session?.type === "wire") {
        const store = useSchematicStore.getState();
        const document = store.persisted.document;
        if (!document) {
          return;
        }

        const screenPoint = domEventToScreen(
          e.clientX,
          e.clientY,
          canvas.getBoundingClientRect(),
        );
        const hoveredHit = hitTestScreen(
          screenPoint.x,
          screenPoint.y,
          document.symbols,
          store.chrome.viewport,
          store.derived.hitTestCache,
          document.labels,
          createNetLabelHitTestCache(document.labels, store.chrome.viewport),
        );
        const sourcePoint =
          store.derived.hitTestCache.connectorAnchors[session.sourcePinId];
        if (!sourcePoint) {
          interactionController.updateWirePreview([], null);
          return;
        }

        const targetPinId =
          hoveredHit?.kind === "connector" &&
          hoveredHit.pinId !== session.sourcePinId
            ? hoveredHit.pinId
            : null;
        const cursorPoint = screenToSchematic(
          screenPoint.x,
          screenPoint.y,
          viewport,
        );
        const targetPoint =
          targetPinId &&
          store.derived.hitTestCache.connectorAnchors[targetPinId]
            ? store.derived.hitTestCache.connectorAnchors[targetPinId]
            : cursorPoint;

        interactionController.updateWirePreview(
          buildOrthogonalWirePathWithWaypoints(
            sourcePoint,
            session.waypoints,
            targetPoint,
          ),
          targetPinId,
        );
        return;
      }

      if (pendingDragRef.current && !pendingDragRef.current.didStartDrag) {
        const dx = e.clientX - pendingDragRef.current.startClient.x;
        const dy = e.clientY - pendingDragRef.current.startClient.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > DRAG_THRESHOLD_PX) {
          const store = useSchematicStore.getState();
          const screenPoint = domEventToScreen(
            pendingDragRef.current.startClient.x,
            pendingDragRef.current.startClient.y,
            canvas.getBoundingClientRect(),
          );
          const worldPoint = screenToSchematic(
            screenPoint.x,
            screenPoint.y,
            viewport,
          );

          interactionController.beginDragMove(
            Array.from(store.chrome.selectedEntityIds),
            pendingDragRef.current.symbolId,
            worldPoint,
          );
          pendingDragRef.current.didStartDrag = true;
        }
      }

      const activeSession = useSchematicStore.getState().session;
      if (activeSession?.type === "drag") {
        const screenPoint = domEventToScreen(
          e.clientX,
          e.clientY,
          canvas.getBoundingClientRect(),
        );
        const worldPoint = screenToSchematic(
          screenPoint.x,
          screenPoint.y,
          viewport,
        );

        const rawDelta = {
          x: worldPoint.x - activeSession.startPointer.x,
          y: worldPoint.y - activeSession.startPointer.y,
        };

        // Only snap to grid when grid is enabled
        const delta = showGrid
          ? {
              x: Math.round(rawDelta.x / gridSize) * gridSize,
              y: Math.round(rawDelta.y / gridSize) * gridSize,
            }
          : rawDelta;

        interactionController.updateDragMove(delta);
      }
    },
    [
      gridSize,
      showGrid,
      interactionController,
      pan,
      session,
      updatePlacementPreviewFromClient,
      viewport,
    ],
  );

  const handleMouseUp = useCallback(() => {
    if (pendingDragRef.current?.didStartDrag) {
      interactionController.commitDragMove();
    }
    pendingDragRef.current = null;
    isPanning.current = false;
  }, [interactionController]);

  const handleMouseLeave = useCallback(() => {
    if (pendingDragRef.current?.didStartDrag) {
      interactionController.commitDragMove();
    }
    pendingDragRef.current = null;
    isPanning.current = false;
    if (session?.type === "placement") {
      interactionController.updatePlacementPreview(null);
    }
  }, [interactionController, session]);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const kind = readDraggedSymbolKind(event.dataTransfer);
      if (!kind) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      updateDragPreviewFromEvent(kind, event.clientX, event.clientY);
    },
    [readDraggedSymbolKind, updateDragPreviewFromEvent],
  );

  const handleDragEnter = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const kind = readDraggedSymbolKind(event.dataTransfer);
      if (!kind) {
        return;
      }

      event.preventDefault();
      updateDragPreviewFromEvent(kind, event.clientX, event.clientY);
    },
    [readDraggedSymbolKind, updateDragPreviewFromEvent],
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        event.currentTarget.contains(nextTarget)
      ) {
        return;
      }

      interactionController.updatePlacementPreview(null);
    },
    [interactionController],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const kind = readDraggedSymbolKind(event.dataTransfer);
      if (!kind) {
        return;
      }

      event.preventDefault();
      syncDragPlacementSession(kind);
      const position = getPlacementPosition(event.clientX, event.clientY);
      interactionController.updatePlacementPreview(null);
      if (!position) {
        setPaletteDragSymbolKind(null);
        interactionController.cancelSession();
        return;
      }

      interactionController.commitPlacement(position);
      setPaletteDragSymbolKind(null);
    },
    [
      getPlacementPosition,
      interactionController,
      readDraggedSymbolKind,
      setPaletteDragSymbolKind,
      syncDragPlacementSession,
    ],
  );

  useCanvasWheel(canvasRef, { pan, zoomAt });

  return (
    <div
      ref={containerRef}
      data-testid="schematic-canvas-surface"
      className="relative h-full w-full overflow-hidden bg-background"
    >
      <canvas
        ref={canvasRef}
        data-testid="schematic-canvas"
        className="absolute inset-0 cursor-crosshair"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
