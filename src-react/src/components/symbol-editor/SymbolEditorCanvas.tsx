/**
 * Symbol Editor Canvas
 *
 * HTML5 Canvas 2D component for rendering and editing symbol drafts.
 * Renders body presets, pins, and handles user interaction.
 */

import { useRef, useEffect, useCallback } from "react";
import { useSymbolEditorStore } from "./symbol-editor-store";
import {
  symbolToScreen,
  screenToSymbol,
  domEventToScreen,
  snapToGrid,
  createCenteredViewport,
} from "./viewport";
import type {
  SymbolPin,
  BodyPreset,
  Viewport,
  Nanometers,
  Point,
  PinElectricalType,
  PinSide,
} from "./types";
import { PIN_DRAG_MIME, DEFAULT_PIN_LENGTH, createPin } from "./types";

// ---------------------------------------------------------------------------
// Rendering Constants
// ---------------------------------------------------------------------------

const COLORS = {
  background: "#0f172a",
  gridDot: "rgba(148, 163, 184, 0.3)",
  gridDotFaint: "rgba(148, 163, 184, 0.15)",
  gridMajorLine: "rgba(148, 163, 184, 0.08)",
  originCross: "rgba(148, 163, 184, 0.25)",
  bodyStroke: "#94a3b8",
  bodyFill: "#1e293b",
  pinLine: "#94a3b8",
  pinDot: "#38bdf8",
  pinLabel: "#e2e8f0",
  pinNumber: "#64748b",
  selectionStroke: "#38bdf8",
  selectionFill: "rgba(56, 189, 248, 0.15)",
};

const PIN_DOT_RADIUS = 4;
const PIN_LINE_WIDTH = 2;
const BODY_LINE_WIDTH = 2;

// ---------------------------------------------------------------------------
// Grid Rendering
// ---------------------------------------------------------------------------

interface SymbolBounds {
  left: Nanometers;
  top: Nanometers;
  right: Nanometers;
  bottom: Nanometers;
}

function getVisibleSymbolBounds(
  width: number,
  height: number,
  viewport: Viewport,
): SymbolBounds {
  const topLeft = screenToSymbol(0, 0, viewport);
  const bottomRight = screenToSymbol(width, height, viewport);
  return {
    left: Math.min(topLeft.x, bottomRight.x),
    top: Math.max(topLeft.y, bottomRight.y), // Y is flipped
    right: Math.max(topLeft.x, bottomRight.x),
    bottom: Math.min(topLeft.y, bottomRight.y),
  };
}

function getGridPixelSpacing(
  gridSizeNm: Nanometers,
  viewport: Viewport,
): number {
  return (gridSizeNm / 1_000_000) * viewport.zoom;
}

function renderGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  gridSize: Nanometers,
): void {
  const gridPx = getGridPixelSpacing(gridSize, viewport);
  if (gridPx < 4) return;

  const bounds = getVisibleSymbolBounds(width, height, viewport);
  const snappedLeft = Math.floor(bounds.left / gridSize) * gridSize;
  const snappedBottom = Math.floor(bounds.bottom / gridSize) * gridSize;
  const snappedRight = Math.ceil(bounds.right / gridSize) * gridSize;
  const snappedTop = Math.ceil(bounds.top / gridSize) * gridSize;

  const dotRadius = Math.max(0.5, viewport.zoom * 0.0003);
  ctx.fillStyle = gridPx > 20 ? COLORS.gridDot : COLORS.gridDotFaint;

  for (let x = snappedLeft; x <= snappedRight; x += gridSize) {
    for (let y = snappedBottom; y <= snappedTop; y += gridSize) {
      const screen = symbolToScreen(x, y, viewport);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Major grid lines
  const majorGridSize = gridSize * 10;
  const majorGridPx = getGridPixelSpacing(majorGridSize, viewport);
  if (majorGridPx > 40) {
    const majorLeft = Math.floor(bounds.left / majorGridSize) * majorGridSize;
    const majorBottom =
      Math.floor(bounds.bottom / majorGridSize) * majorGridSize;
    const majorRight = Math.ceil(bounds.right / majorGridSize) * majorGridSize;
    const majorTop = Math.ceil(bounds.top / majorGridSize) * majorGridSize;

    ctx.strokeStyle = COLORS.gridMajorLine;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = majorLeft; x <= majorRight; x += majorGridSize) {
      const screen = symbolToScreen(x, 0, viewport);
      ctx.moveTo(screen.x, 0);
      ctx.lineTo(screen.x, height);
    }

    for (let y = majorBottom; y <= majorTop; y += majorGridSize) {
      const screen = symbolToScreen(0, y, viewport);
      ctx.moveTo(0, screen.y);
      ctx.lineTo(width, screen.y);
    }

    ctx.stroke();
  }

  // Origin cross
  const origin = symbolToScreen(0, 0, viewport);
  if (
    origin.x >= -10 &&
    origin.x <= width + 10 &&
    origin.y >= -10 &&
    origin.y <= height + 10
  ) {
    ctx.strokeStyle = COLORS.originCross;
    ctx.lineWidth = 1;
    const crossSize = 15;
    ctx.beginPath();
    ctx.moveTo(origin.x - crossSize, origin.y);
    ctx.lineTo(origin.x + crossSize, origin.y);
    ctx.moveTo(origin.x, origin.y - crossSize);
    ctx.lineTo(origin.x, origin.y + crossSize);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Body Rendering
// ---------------------------------------------------------------------------

function renderBody(
  ctx: CanvasRenderingContext2D,
  body: BodyPreset,
  viewport: Viewport,
): void {
  const halfWidth = body.width / 2;
  const halfHeight = body.height / 2;

  switch (body.kind) {
    case "blank":
      // No body drawn
      break;

    case "ic_box": {
      const topLeft = symbolToScreen(-halfWidth, halfHeight, viewport);
      const bottomRight = symbolToScreen(halfWidth, -halfHeight, viewport);
      const w = bottomRight.x - topLeft.x;
      const h = bottomRight.y - topLeft.y;

      ctx.fillStyle = COLORS.bodyFill;
      ctx.strokeStyle = COLORS.bodyStroke;
      ctx.lineWidth = BODY_LINE_WIDTH;
      ctx.fillRect(topLeft.x, topLeft.y, w, h);
      ctx.strokeRect(topLeft.x, topLeft.y, w, h);
      break;
    }

    case "opamp": {
      // Triangle shape pointing right
      const topCorner = symbolToScreen(-halfWidth, halfHeight, viewport);
      const bottomCorner = symbolToScreen(-halfWidth, -halfHeight, viewport);
      const tip = symbolToScreen(halfWidth, 0, viewport);

      ctx.fillStyle = COLORS.bodyFill;
      ctx.strokeStyle = COLORS.bodyStroke;
      ctx.lineWidth = BODY_LINE_WIDTH;

      ctx.beginPath();
      ctx.moveTo(topCorner.x, topCorner.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(bottomCorner.x, bottomCorner.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // + and - labels
      const labelOffset = halfWidth * 0.3;
      const plusPos = symbolToScreen(
        -halfWidth + labelOffset,
        halfHeight * 0.5,
        viewport,
      );
      const minusPos = symbolToScreen(
        -halfWidth + labelOffset,
        -halfHeight * 0.5,
        viewport,
      );

      ctx.font = `${Math.max(10, viewport.zoom * 0.012)}px monospace`;
      ctx.fillStyle = COLORS.pinLabel;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+", plusPos.x, plusPos.y);
      ctx.fillText("−", minusPos.x, minusPos.y);
      break;
    }

    case "two_pin_passive": {
      // Simple horizontal rectangle
      const topLeft = symbolToScreen(-halfWidth, halfHeight, viewport);
      const bottomRight = symbolToScreen(halfWidth, -halfHeight, viewport);
      const w = bottomRight.x - topLeft.x;
      const h = bottomRight.y - topLeft.y;

      ctx.fillStyle = COLORS.bodyFill;
      ctx.strokeStyle = COLORS.bodyStroke;
      ctx.lineWidth = BODY_LINE_WIDTH;
      ctx.fillRect(topLeft.x, topLeft.y, w, h);
      ctx.strokeRect(topLeft.x, topLeft.y, w, h);
      break;
    }

    case "transistor": {
      // Circle with 3-terminal internal lines
      const center = symbolToScreen(0, 0, viewport);
      const radius = Math.abs(
        symbolToScreen(halfWidth, 0, viewport).x - center.x,
      );

      ctx.fillStyle = COLORS.bodyFill;
      ctx.strokeStyle = COLORS.bodyStroke;
      ctx.lineWidth = BODY_LINE_WIDTH;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Vertical bar (base contact)
      const barX = center.x - radius * 0.3;
      const barTop = center.y - radius * 0.5;
      const barBottom = center.y + radius * 0.5;
      ctx.beginPath();
      ctx.moveTo(barX, barTop);
      ctx.lineTo(barX, barBottom);
      ctx.stroke();

      // Collector line (up-right from bar)
      ctx.beginPath();
      ctx.moveTo(barX, barTop + (barBottom - barTop) * 0.3);
      ctx.lineTo(center.x + radius * 0.5, center.y - radius * 0.6);
      ctx.stroke();

      // Emitter line (down-right from bar)
      ctx.beginPath();
      ctx.moveTo(barX, barTop + (barBottom - barTop) * 0.7);
      ctx.lineTo(center.x + radius * 0.5, center.y + radius * 0.6);
      ctx.stroke();
      break;
    }

    case "diode": {
      // Triangle + bar pointing right
      const topCorner = symbolToScreen(
        -halfWidth * 0.6,
        halfHeight * 0.8,
        viewport,
      );
      const bottomCorner = symbolToScreen(
        -halfWidth * 0.6,
        -halfHeight * 0.8,
        viewport,
      );
      const tip = symbolToScreen(halfWidth * 0.6, 0, viewport);

      ctx.fillStyle = COLORS.bodyFill;
      ctx.strokeStyle = COLORS.bodyStroke;
      ctx.lineWidth = BODY_LINE_WIDTH;

      // Triangle (anode)
      ctx.beginPath();
      ctx.moveTo(topCorner.x, topCorner.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(bottomCorner.x, bottomCorner.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Cathode bar
      const barTop = symbolToScreen(
        halfWidth * 0.6,
        halfHeight * 0.8,
        viewport,
      );
      const barBottom = symbolToScreen(
        halfWidth * 0.6,
        -halfHeight * 0.8,
        viewport,
      );
      ctx.beginPath();
      ctx.moveTo(barTop.x, barTop.y);
      ctx.lineTo(barBottom.x, barBottom.y);
      ctx.stroke();
      break;
    }

    case "connector": {
      // Dashed rectangle
      const topLeft = symbolToScreen(-halfWidth, halfHeight, viewport);
      const bottomRight = symbolToScreen(halfWidth, -halfHeight, viewport);
      const w = bottomRight.x - topLeft.x;
      const h = bottomRight.y - topLeft.y;

      ctx.fillStyle = COLORS.bodyFill;
      ctx.strokeStyle = COLORS.bodyStroke;
      ctx.lineWidth = BODY_LINE_WIDTH;
      ctx.setLineDash([6, 3]);
      ctx.fillRect(topLeft.x, topLeft.y, w, h);
      ctx.strokeRect(topLeft.x, topLeft.y, w, h);
      ctx.setLineDash([]);
      break;
    }

    case "voltage_regulator": {
      // IC box with VIN/VOUT/GND labels
      const topLeft = symbolToScreen(-halfWidth, halfHeight, viewport);
      const bottomRight = symbolToScreen(halfWidth, -halfHeight, viewport);
      const w = bottomRight.x - topLeft.x;
      const h = bottomRight.y - topLeft.y;

      ctx.fillStyle = COLORS.bodyFill;
      ctx.strokeStyle = COLORS.bodyStroke;
      ctx.lineWidth = BODY_LINE_WIDTH;
      ctx.fillRect(topLeft.x, topLeft.y, w, h);
      ctx.strokeRect(topLeft.x, topLeft.y, w, h);

      // Labels
      const fontSize = Math.max(8, viewport.zoom * 0.008);
      ctx.font = `${fontSize}px monospace`;
      ctx.fillStyle = COLORS.pinLabel;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const vinPos = symbolToScreen(
        -halfWidth * 0.4,
        halfHeight * 0.4,
        viewport,
      );
      const voutPos = symbolToScreen(
        halfWidth * 0.4,
        halfHeight * 0.4,
        viewport,
      );
      const gndPos = symbolToScreen(0, -halfHeight * 0.4, viewport);
      ctx.fillText("IN", vinPos.x, vinPos.y);
      ctx.fillText("OUT", voutPos.x, voutPos.y);
      ctx.fillText("GND", gndPos.x, gndPos.y);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Pin Rendering
// ---------------------------------------------------------------------------

function renderPin(
  ctx: CanvasRenderingContext2D,
  pin: SymbolPin,
  viewport: Viewport,
  selected: boolean,
): void {
  // Calculate pin line end (body connection) based on side
  const pinTip = pin.position;
  let bodyEnd: Point;

  switch (pin.side) {
    case "left":
      bodyEnd = { x: pinTip.x + pin.length, y: pinTip.y };
      break;
    case "right":
      bodyEnd = { x: pinTip.x - pin.length, y: pinTip.y };
      break;
    case "top":
      bodyEnd = { x: pinTip.x, y: pinTip.y - pin.length };
      break;
    case "bottom":
      bodyEnd = { x: pinTip.x, y: pinTip.y + pin.length };
      break;
  }

  const tipScreen = symbolToScreen(pinTip.x, pinTip.y, viewport);
  const bodyScreen = symbolToScreen(bodyEnd.x, bodyEnd.y, viewport);

  // Pin line
  ctx.strokeStyle = selected ? COLORS.selectionStroke : COLORS.pinLine;
  ctx.lineWidth = PIN_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(tipScreen.x, tipScreen.y);
  ctx.lineTo(bodyScreen.x, bodyScreen.y);
  ctx.stroke();

  // Connection dot at tip
  ctx.fillStyle = selected ? COLORS.selectionStroke : COLORS.pinDot;
  ctx.beginPath();
  ctx.arc(tipScreen.x, tipScreen.y, PIN_DOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Selection highlight
  if (selected) {
    ctx.strokeStyle = COLORS.selectionStroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tipScreen.x, tipScreen.y, PIN_DOT_RADIUS + 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Pin labels
  const fontSize = Math.max(10, viewport.zoom * 0.01);
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = "middle";

  // Pin name (near body end)
  if (pin.name) {
    ctx.fillStyle = COLORS.pinLabel;
    const labelPadding = 6;

    switch (pin.side) {
      case "left":
        ctx.textAlign = "left";
        ctx.fillText(pin.name, bodyScreen.x + labelPadding, bodyScreen.y);
        break;
      case "right":
        ctx.textAlign = "right";
        ctx.fillText(pin.name, bodyScreen.x - labelPadding, bodyScreen.y);
        break;
      case "top":
        ctx.textAlign = "center";
        ctx.fillText(
          pin.name,
          bodyScreen.x,
          bodyScreen.y + labelPadding + fontSize / 2,
        );
        break;
      case "bottom":
        ctx.textAlign = "center";
        ctx.fillText(
          pin.name,
          bodyScreen.x,
          bodyScreen.y - labelPadding - fontSize / 2,
        );
        break;
    }
  }

  // Pin number (near tip)
  if (pin.number) {
    ctx.fillStyle = COLORS.pinNumber;
    const numberPadding = PIN_DOT_RADIUS + 6;

    switch (pin.side) {
      case "left":
        ctx.textAlign = "right";
        ctx.fillText(pin.number, tipScreen.x - numberPadding, tipScreen.y);
        break;
      case "right":
        ctx.textAlign = "left";
        ctx.fillText(pin.number, tipScreen.x + numberPadding, tipScreen.y);
        break;
      case "top":
        ctx.textAlign = "center";
        ctx.fillText(pin.number, tipScreen.x, tipScreen.y - numberPadding);
        break;
      case "bottom":
        ctx.textAlign = "center";
        ctx.fillText(
          pin.number,
          tipScreen.x,
          tipScreen.y + numberPadding + fontSize,
        );
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Hit Testing
// ---------------------------------------------------------------------------

function hitTestPin(
  screenX: number,
  screenY: number,
  pin: SymbolPin,
  viewport: Viewport,
  threshold = 10,
): boolean {
  const tipScreen = symbolToScreen(pin.position.x, pin.position.y, viewport);
  const dx = screenX - tipScreen.x;
  const dy = screenY - tipScreen.y;
  return Math.sqrt(dx * dx + dy * dy) <= threshold;
}

function findPinAtScreen(
  screenX: number,
  screenY: number,
  pins: SymbolPin[],
  viewport: Viewport,
): SymbolPin | null {
  // Check in reverse order (top-most first)
  for (let i = pins.length - 1; i >= 0; i--) {
    const pin = pins[i];
    if (pin && hitTestPin(screenX, screenY, pin, viewport)) {
      return pin;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SymbolEditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const isDraggingPin = useRef(false);
  const draggedPinId = useRef<string | null>(null);

  const chrome = useSymbolEditorStore((s) => s.chrome);
  const pan = useSymbolEditorStore((s) => s.pan);
  const zoomAt = useSymbolEditorStore((s) => s.zoomAt);
  const setViewport = useSymbolEditorStore((s) => s.setViewport);
  const selectPin = useSymbolEditorStore((s) => s.selectPin);
  const clearSelection = useSymbolEditorStore((s) => s.clearSelection);
  const movePin = useSymbolEditorStore((s) => s.movePin);
  const addPin = useSymbolEditorStore((s) => s.addPin);

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
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    const store = useSymbolEditorStore.getState();
    const { viewport, gridSize, showGrid, selection } = store.chrome;
    const { body, pins } = store.draft;

    // Grid
    if (showGrid) {
      renderGrid(ctx, width, height, viewport, gridSize);
    }

    // Body
    renderBody(ctx, body, viewport);

    // Pins
    for (const pin of pins) {
      const isSelected = selection.selectedPinIds.has(pin.id);
      renderPin(ctx, pin, viewport, isSelected);
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

    const observer = new ResizeObserver(() => {
      resizeCanvas();
      // Center viewport on resize
      const rect = container.getBoundingClientRect();
      setViewport(
        createCenteredViewport(rect.width, rect.height, chrome.viewport.zoom),
      );
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [resizeCanvas, setViewport, chrome.viewport.zoom]);

  // Initial centering
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    setViewport(createCenteredViewport(rect.width, rect.height));
  }, [setViewport]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Middle click or Shift+left click = pan
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        isPanning.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }

      if (e.button !== 0) return;

      const store = useSymbolEditorStore.getState();
      const screenPoint = domEventToScreen(
        e.clientX,
        e.clientY,
        canvas.getBoundingClientRect(),
      );
      const hitPin = findPinAtScreen(
        screenPoint.x,
        screenPoint.y,
        store.draft.pins,
        store.chrome.viewport,
      );

      if (hitPin) {
        selectPin(hitPin.id, e.ctrlKey || e.metaKey);
        // Start dragging
        isDraggingPin.current = true;
        draggedPinId.current = hitPin.id;
        lastMouse.current = { x: e.clientX, y: e.clientY };
      } else {
        clearSelection();
      }
    },
    [selectPin, clearSelection],
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

      if (isDraggingPin.current && draggedPinId.current) {
        const store = useSymbolEditorStore.getState();
        const screenPoint = domEventToScreen(
          e.clientX,
          e.clientY,
          canvas.getBoundingClientRect(),
        );
        const symbolPoint = screenToSymbol(
          screenPoint.x,
          screenPoint.y,
          store.chrome.viewport,
        );
        const snappedPoint = snapToGrid(symbolPoint, store.chrome.gridSize);
        movePin(draggedPinId.current, snappedPoint);
      }
    },
    [pan, movePin],
  );

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    isDraggingPin.current = false;
    draggedPinId.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanning.current = false;
    isDraggingPin.current = false;
    draggedPinId.current = null;
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

  // Keyboard handlers for delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const store = useSymbolEditorStore.getState();
        const selectedIds = [...store.chrome.selection.selectedPinIds];
        if (selectedIds.length > 0) {
          store.removePins(selectedIds);
          e.preventDefault();
        }
      }

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        if (e.shiftKey) {
          useSymbolEditorStore.getState().redo();
        } else {
          useSymbolEditorStore.getState().undo();
        }
        e.preventDefault();
      }

      // Select all
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        useSymbolEditorStore.getState().selectAllPins();
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Drag-drop handlers for pin palette
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(PIN_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const data = e.dataTransfer.getData(PIN_DRAG_MIME);
      if (!data) return;

      e.preventDefault();

      try {
        const template = JSON.parse(data) as {
          electricalType: PinElectricalType;
          defaultSide: PinSide;
        };

        const store = useSymbolEditorStore.getState();
        const screenPoint = domEventToScreen(
          e.clientX,
          e.clientY,
          canvas.getBoundingClientRect(),
        );
        const symbolPoint = screenToSymbol(
          screenPoint.x,
          screenPoint.y,
          store.chrome.viewport,
        );
        const snappedPoint = snapToGrid(symbolPoint, store.chrome.gridSize);

        // Get next pin number
        const existingNumbers = new Set(store.draft.pins.map((p) => p.number));
        let num = 1;
        while (existingNumbers.has(String(num))) {
          num++;
        }
        const pinNumber = String(num);

        const newPin = createPin(crypto.randomUUID(), {
          name: `Pin ${pinNumber}`,
          number: pinNumber,
          electricalType: template.electricalType,
          side: template.defaultSide,
          position: snappedPoint,
          length: DEFAULT_PIN_LENGTH,
        });

        addPin(newPin);
        selectPin(newPin.id);
      } catch {
        // Invalid JSON, ignore
      }
    },
    [addPin, selectPin],
  );

  return (
    <div
      ref={containerRef}
      data-testid="symbol-editor-canvas-surface"
      className="relative h-full w-full overflow-hidden bg-background"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <canvas
        ref={canvasRef}
        data-testid="symbol-editor-canvas"
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
