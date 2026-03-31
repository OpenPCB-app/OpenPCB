import { useRef, useEffect, useCallback } from "react";
import { useSchematicStore } from "@/stores/schematic-store";
import { renderGrid } from "./grid";

export function SchematicCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const pan = useSchematicStore((s) => s.pan);
  const zoomAt = useSchematicStore((s) => s.zoomAt);

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
    if (store.showGrid) {
      renderGrid(ctx, width, height, store.viewport, store.gridSize);
    }

    // TODO: Render symbols, wires, labels, selection, interaction preview

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

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Middle click or Space+left click = pan
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }

    // Left click - tool interaction (TODO: dispatch to interaction manager)
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning.current) {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        pan(dx, dy);
        lastMouse.current = { x: e.clientX, y: e.clientY };
        return;
      }

      // TODO: update cursor position in status bar
      // TODO: update interaction preview (ghost, wire preview)
    },
    [pan],
  );

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

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
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
