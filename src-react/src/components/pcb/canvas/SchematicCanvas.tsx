import { useRef, useEffect, useCallback } from "react";
import { useSchematicStore } from "@/stores/schematic-store";
import { renderGrid } from "./grid";
import {
  domEventToScreen,
  schematicToScreen,
  screenToSchematic,
  snapToGrid,
} from "./viewport";
import { createHitTestCache, hitTestScreen } from "./hit-test";
import { renderSymbol } from "./symbols";
import {
  useSchematicInteractionController,
  type SchematicInteractionController,
} from "../useSchematicInteractionController";

interface SchematicCanvasProps {
  controller?: SchematicInteractionController;
}

export function SchematicCanvas({ controller }: SchematicCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const fallbackController = useSchematicInteractionController();
  const interactionController = controller ?? fallbackController;
  const pan = useSchematicStore((s) => s.pan);
  const zoomAt = useSchematicStore((s) => s.zoomAt);
  const viewport = useSchematicStore((s) => s.chrome.viewport);
  const gridSize = useSchematicStore((s) => s.chrome.gridSize);
  const session = useSchematicStore((s) => s.session);
  const setHitTestCache = useSchematicStore((s) => s.setHitTestCache);
  const document = useSchematicStore((s) => s.persisted.document);

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
    ctx.fillStyle = "var(--color-background, #0f172a)";
    ctx.fillRect(0, 0, width, height);
    // Use a solid dark background for canvas
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);

    // Grid
    const store = useSchematicStore.getState();
    if (store.chrome.showGrid) {
      renderGrid(ctx, width, height, store.chrome.viewport, store.chrome.gridSize);
    }

    const document = store.persisted.document;
    if (document) {
      const selectedIds = store.chrome.selectedEntityIds;

      for (const symbol of document.symbols) {
        renderSymbol(ctx, symbol, store.chrome.viewport, {
          selected: selectedIds.has(symbol.id),
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
        ctx.strokeStyle = "#38bdf8";
        ctx.fillStyle = "rgba(56, 189, 248, 0.08)";
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
  }, []);

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
    setHitTestCache(createHitTestCache(document?.symbols ?? []));
  }, [document, setHitTestCache]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle click or Space+left click = pan
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        isPanning.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }

      if (e.button !== 0) {
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
      );

      if (hit?.kind === "connector" && store.chrome.activeTool === "select") {
        interactionController.beginWire(hit.pinId);
        return;
      }

      if (hit?.kind === "body") {
        store.selectEntities([hit.symbolId]);
        return;
      }

      if (store.chrome.activeTool === "select") {
        store.clearSelection();
      }
    },
    [interactionController],
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
        const screenPoint = domEventToScreen(
          e.clientX,
          e.clientY,
          canvas.getBoundingClientRect(),
        );
        const worldPoint = screenToSchematic(screenPoint.x, screenPoint.y, viewport);
        interactionController.updatePlacementPreview(
          snapToGrid(worldPoint, gridSize),
        );
      }
    },
    [gridSize, interactionController, pan, session, viewport],
  );

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanning.current = false;
    if (session?.type === "placement") {
      interactionController.updatePlacementPreview(null);
    }
  }, [interactionController, session]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(mouseX, mouseY, factor);
    },
    [zoomAt],
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-background"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
