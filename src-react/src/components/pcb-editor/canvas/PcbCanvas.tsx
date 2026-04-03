import { useRef, useEffect, useCallback } from "react";
import { usePcbStore } from "@/stores/pcb-store";
import { renderPads } from "./pcb-pads";
import { renderSilkscreen } from "./pcb-silkscreen";
import {
  screenToPcb,
  pcbToScreen,
  fitPcbViewportToBounds,
} from "./pcb-viewport";
import { LAYER_COLORS, PCB_BACKGROUND } from "../layer-colors";
import { usePcbInteractionController } from "../usePcbInteractionController";
import { getPlacementBounds } from "./pcb-hit-test";
import type { PcbViewport } from "../pcb-types";

export function PcbCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const document = usePcbStore((s) => s.document);
  const visibleLayers = usePcbStore((s) => s.visibleLayers);
  const ratsnest = usePcbStore((s) => s.ratsnest);
  const setViewport = usePcbStore((s) => s.setViewport);
  const pan = usePcbStore((s) => s.pan);
  const zoomAt = usePcbStore((s) => s.zoomAt);

  const controller = usePcbInteractionController();

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

  const renderGrid = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      vp: PcbViewport,
      size: number,
    ) => {
      const screenGridSize = size * vp.zoom;
      if (screenGridSize < 4) return;

      const startWorld = screenToPcb(0, 0, vp);
      const endWorld = screenToPcb(width, height, vp);

      const startX = Math.floor(startWorld.x / size) * size;
      const startY = Math.floor(startWorld.y / size) * size;
      const endX = Math.ceil(endWorld.x / size) * size;
      const endY = Math.ceil(endWorld.y / size) * size;

      ctx.fillStyle = "#333333";

      for (let x = startX; x <= endX; x += size) {
        for (let y = startY; y <= endY; y += size) {
          const screen = pcbToScreen(x, y, vp);
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    [],
  );

  const renderBoardOutline = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      boardWidth: number,
      boardHeight: number,
      vp: PcbViewport,
    ) => {
      const topLeft = pcbToScreen(0, 0, vp);
      const bottomRight = pcbToScreen(boardWidth, boardHeight, vp);

      ctx.strokeStyle = LAYER_COLORS["Edge.Cuts"]!;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        topLeft.x,
        topLeft.y,
        bottomRight.x - topLeft.x,
        bottomRight.y - topLeft.y,
      );
    },
    [],
  );

  const renderRatsnest = useCallback(
    (ctx: CanvasRenderingContext2D, vp: PcbViewport) => {
      if (!visibleLayers.has("ratsnest")) return;

      ctx.strokeStyle = LAYER_COLORS["ratsnest"]!;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      for (const line of ratsnest) {
        const startScreen = pcbToScreen(line.start.x, line.start.y, vp);
        const endScreen = pcbToScreen(line.end.x, line.end.y, vp);

        ctx.beginPath();
        ctx.moveTo(startScreen.x, startScreen.y);
        ctx.lineTo(endScreen.x, endScreen.y);
        ctx.stroke();
      }

      ctx.setLineDash([]);
    },
    [ratsnest, visibleLayers],
  );

  const renderSelection = useCallback(
    (ctx: CanvasRenderingContext2D, vp: PcbViewport) => {
      const store = usePcbStore.getState();
      const doc = store.document;
      if (!doc) return;

      for (const id of store.selectedIds) {
        const placement = doc.placements.find((p) => p.id === id);
        if (!placement) continue;

        const bounds = getPlacementBounds(placement);
        const topLeft = pcbToScreen(bounds.minX, bounds.minY, vp);
        const bottomRight = pcbToScreen(bounds.maxX, bounds.maxY, vp);

        ctx.save();
        ctx.strokeStyle = "#00FF00";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(
          topLeft.x,
          topLeft.y,
          bottomRight.x - topLeft.x,
          bottomRight.y - topLeft.y,
        );
        ctx.setLineDash([]);
        ctx.restore();
      }
    },
    [],
  );

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

    ctx.fillStyle = PCB_BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    const store = usePcbStore.getState();
    const vp = store.viewport;
    const doc = store.document;

    renderGrid(ctx, width, height, vp, store.gridSize);

    if (doc) {
      renderBoardOutline(
        ctx,
        doc.boardOutline.width,
        doc.boardOutline.height,
        vp,
      );

      renderSilkscreen(
        ctx,
        doc.placements,
        vp,
        store.activeLayer,
        store.visibleLayers,
      );

      renderPads(
        ctx,
        doc.placements,
        vp,
        store.activeLayer,
        store.visibleLayers,
      );

      renderRatsnest(ctx, vp);
      renderSelection(ctx, vp);
    }

    ctx.restore();
  }, [renderGrid, renderBoardOutline, renderRatsnest, renderSelection]);

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    resizeCanvas();

    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(container);

    return () => observer.disconnect();
  }, [resizeCanvas]);

  const boardOutline = document?.boardOutline;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !boardOutline) return;

    const rect = container.getBoundingClientRect();
    const newViewport = fitPcbViewportToBounds(
      boardOutline.width,
      boardOutline.height,
      rect.width,
      rect.height,
      40,
    );
    setViewport(newViewport);
  }, [boardOutline, setViewport]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        isPanning.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }

      if (e.button === 0) {
        controller.handleMouseDown(
          e.clientX,
          e.clientY,
          canvas.getBoundingClientRect(),
        );
      }
    },
    [controller],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (isPanning.current) {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        pan(dx, dy);
        lastMouse.current = { x: e.clientX, y: e.clientY };
        return;
      }

      controller.handleMouseMove(
        e.clientX,
        e.clientY,
        canvas.getBoundingClientRect(),
      );
    },
    [pan, controller],
  );

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    controller.handleMouseUp();
  }, [controller]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      zoomAt(mouseX, mouseY, factor);
    },
    [zoomAt],
  );

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-default"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
    </div>
  );
}
