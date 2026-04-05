import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useCanvasColors, type CanvasColors } from "@/lib/canvas-theme";
import { renderGraphicWorld } from "@/lib/canvas-core/graphics";
import type { ComponentType } from "@shared/types/component-library-schema.types";
import type { SymbolGraphic as BackendSymbolGraphic } from "@shared/types/component-semantics.types";
import { parseKicadSymbolImport } from "../../lib/api/component-api";
import {
  convertParsedKicadSymbolToDraft,
  convertBodyGraphic,
} from "../symbol-editor/kicad-import";
import { getSymbolPreviewLabel, isPowerSymbolData } from "./symbolDataDisplay";
import type {
  SymbolPin,
  SymbolGraphic,
  Viewport,
  Bounds,
  Point,
} from "../symbol-editor/types";
import { symbolToScreen, fitViewportToBounds } from "../symbol-editor/viewport";

interface SymbolPreviewProps {
  symbolData?: ComponentType["symbolData"];
}

const PIN_DOT_RADIUS = 3;
const PIN_LINE_WIDTH = 1.5;
const NM_PER_MM = 1_000_000;

// ---------------------------------------------------------------------------
// Backend → Editor type conversion
// ---------------------------------------------------------------------------

function backendGraphicToEditor(
  g: BackendSymbolGraphic,
  index: number,
): SymbolGraphic {
  const base = { id: `preview-${index}`, zIndex: index };
  switch (g.type) {
    case "line":
      return {
        ...base,
        type: "line",
        x1: g.x1,
        y1: g.y1,
        x2: g.x2,
        y2: g.y2,
        strokeWidth: g.strokeWidth,
      };
    case "rect":
      return {
        ...base,
        type: "rect",
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.height,
        filled: g.filled,
        strokeWidth: g.strokeWidth,
      };
    case "circle":
      return {
        ...base,
        type: "circle",
        cx: g.cx,
        cy: g.cy,
        radius: g.radius,
        filled: g.filled,
        strokeWidth: g.strokeWidth,
      };
    case "arc":
      return {
        ...base,
        type: "arc",
        cx: g.cx,
        cy: g.cy,
        radius: g.radius,
        startAngle: g.startAngle,
        endAngle: g.endAngle,
        strokeWidth: g.strokeWidth,
      };
    case "polygon":
      return {
        ...base,
        type: "polygon",
        points: g.points,
        filled: g.filled,
        closed: g.closed,
        strokeWidth: g.strokeWidth,
      };
    case "text":
      return {
        ...base,
        type: "text",
        x: g.x,
        y: g.y,
        content: g.content,
        fontSize: g.fontSize,
        rotation: g.rotation,
      };
  }
}

// ---------------------------------------------------------------------------
// Bounds calculation
// ---------------------------------------------------------------------------

function computeBounds(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): Bounds | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const expand = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const pin of pins) {
    expand(pin.position.x, pin.position.y);
    // Also include body end of pin
    switch (pin.side) {
      case "left":
        expand(pin.position.x + pin.length, pin.position.y);
        break;
      case "right":
        expand(pin.position.x - pin.length, pin.position.y);
        break;
      case "top":
        expand(pin.position.x, pin.position.y - pin.length);
        break;
      case "bottom":
        expand(pin.position.x, pin.position.y + pin.length);
        break;
    }
  }

  for (const g of graphics) {
    switch (g.type) {
      case "line":
        expand(g.x1, g.y1);
        expand(g.x2, g.y2);
        break;
      case "rect":
        expand(g.x, g.y);
        expand(g.x + g.width, g.y + g.height);
        break;
      case "circle":
        expand(g.cx - g.radius, g.cy - g.radius);
        expand(g.cx + g.radius, g.cy + g.radius);
        break;
      case "arc":
        expand(g.cx - g.radius, g.cy - g.radius);
        expand(g.cx + g.radius, g.cy + g.radius);
        break;
      case "polygon":
        for (const pt of g.points) expand(pt.x, pt.y);
        break;
      case "text":
        expand(g.x, g.y);
        break;
    }
  }

  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// Render functions
// ---------------------------------------------------------------------------

function renderGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colors: CanvasColors,
) {
  ctx.strokeStyle = colors.gridMajorLine;
  ctx.lineWidth = 1;
  const gridSize = 20;
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function renderPin(
  ctx: CanvasRenderingContext2D,
  pin: SymbolPin,
  viewport: Viewport,
  colors: CanvasColors,
  showText = true,
) {
  let bodyEnd: Point;
  switch (pin.side) {
    case "left":
      bodyEnd = { x: pin.position.x + pin.length, y: pin.position.y };
      break;
    case "right":
      bodyEnd = { x: pin.position.x - pin.length, y: pin.position.y };
      break;
    case "top":
      bodyEnd = { x: pin.position.x, y: pin.position.y - pin.length };
      break;
    case "bottom":
      bodyEnd = { x: pin.position.x, y: pin.position.y + pin.length };
      break;
  }

  const tipScreen = symbolToScreen(pin.position.x, pin.position.y, viewport);
  const bodyScreen = symbolToScreen(bodyEnd.x, bodyEnd.y, viewport);

  // Pin line
  ctx.strokeStyle = colors.pinLine;
  ctx.lineWidth = PIN_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(tipScreen.x, tipScreen.y);
  ctx.lineTo(bodyScreen.x, bodyScreen.y);
  ctx.stroke();

  // Connection dot
  ctx.fillStyle = colors.pinDot;
  ctx.beginPath();
  ctx.arc(tipScreen.x, tipScreen.y, PIN_DOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Adaptive font size
  const fontSize = Math.max(8, Math.min(12, viewport.zoom * 0.01));
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = "middle";

  // Pin name (near body end)
  if (showText && pin.name) {
    ctx.fillStyle = colors.pinLabel;
    const labelPadding = 4;
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
  if (showText && pin.number) {
    ctx.fillStyle = colors.pinNumber;
    const numberPadding = PIN_DOT_RADIUS + 4;
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
// Fallback layout for components without rawKicadSource
// ---------------------------------------------------------------------------

/**
 * Raw KiCAD body graphic format from the database (unit + S-expression node)
 */
interface RawKicadBodyGraphic {
  unit: number;
  node: unknown[];
}

/**
 * Detect if a value is raw KiCAD format vs parsed BackendSymbolGraphic
 */
function isRawKicadGraphic(g: unknown): g is RawKicadBodyGraphic {
  return (
    typeof g === "object" &&
    g !== null &&
    "node" in g &&
    Array.isArray((g as RawKicadBodyGraphic).node)
  );
}

/**
 * Convert bodyGraphics to editor format, handling both:
 * - Raw KiCAD S-expressions: {unit: 0, node: ["polyline", ...]}
 * - Parsed BackendSymbolGraphic: {type: "line", x1, y1, ...}
 */
function convertBodyGraphics(bodyGraphics: unknown[]): SymbolGraphic[] {
  const result: SymbolGraphic[] = [];

  for (let i = 0; i < bodyGraphics.length; i++) {
    const g = bodyGraphics[i];
    if (!g) continue;

    if (isRawKicadGraphic(g)) {
      // Raw KiCAD S-expression format
      const converted = convertBodyGraphic(g.node, i);
      if (converted) result.push(converted);
    } else if (typeof g === "object" && "type" in g) {
      // Already parsed BackendSymbolGraphic format
      const converted = backendGraphicToEditor(g as BackendSymbolGraphic, i);
      if (converted) result.push(converted);
    }
  }

  return result;
}

function createFallbackLayout(
  pinDefs: Array<{ name: string; electricalType: string }>,
  bodyGraphics: unknown[],
): { pins: SymbolPin[]; graphics: SymbolGraphic[] } {
  const graphics = convertBodyGraphics(bodyGraphics);

  // Compute body bounds from graphics to determine body size
  const gBounds = computeBounds([], graphics);
  const bodyW = gBounds ? gBounds.maxX - gBounds.minX : 10 * NM_PER_MM;
  const bodyH = gBounds
    ? gBounds.maxY - gBounds.minY
    : Math.max(5 * NM_PER_MM, (pinDefs.length * 1.27 * NM_PER_MM) / 2);
  const bodyMinX = gBounds ? gBounds.minX : -bodyW / 2;
  const bodyMinY = gBounds ? gBounds.minY : -bodyH / 2;

  // If no graphics, create a body rect
  if (graphics.length === 0) {
    const halfW = bodyW / 2;
    const pinsPerSide = Math.ceil(pinDefs.length / 2);
    const height = Math.max(5 * NM_PER_MM, pinsPerSide * 2.54 * NM_PER_MM);
    graphics.push({
      id: "fallback-body",
      zIndex: 0,
      type: "rect",
      x: -halfW,
      y: -height / 2,
      width: bodyW,
      height,
      filled: false,
      strokeWidth: 0.254,
    });
  }

  // Categorize pins by electrical type for side assignment
  const leftPins: Array<{ name: string; electricalType: string; idx: number }> =
    [];
  const rightPins: Array<{
    name: string;
    electricalType: string;
    idx: number;
  }> = [];

  pinDefs.forEach((pin, idx) => {
    const t = pin.electricalType;
    if (t === "output" || t === "open_collector" || t === "open_emitter") {
      rightPins.push({ ...pin, idx });
    } else {
      leftPins.push({ ...pin, idx });
    }
  });

  // Balance sides
  while (leftPins.length > rightPins.length + Math.ceil(pinDefs.length * 0.3)) {
    const moved = leftPins.pop();
    if (moved) rightPins.push(moved);
  }

  const pinLength = 2.54 * NM_PER_MM;
  const pins: SymbolPin[] = [];

  const layoutSide = (
    sidePins: Array<{ name: string; electricalType: string; idx: number }>,
    side: "left" | "right",
  ) => {
    const spacing = 2.54 * NM_PER_MM;
    const totalH = sidePins.length * spacing;
    const startY =
      (gBounds ? bodyMinY + bodyH / 2 : 0) + totalH / 2 - spacing / 2;

    sidePins.forEach((pin, i) => {
      const y = startY - i * spacing;
      const x =
        side === "left"
          ? (gBounds ? bodyMinX : -bodyW / 2) - pinLength
          : (gBounds ? bodyMinX + bodyW : bodyW / 2) + pinLength;
      pins.push({
        id: `fallback-pin-${pin.idx}`,
        name: pin.name,
        number: String(pin.idx + 1),
        electricalType: (pin.electricalType ||
          "passive") as SymbolPin["electricalType"],
        side,
        position: { x, y },
        length: pinLength,
      });
    });
  };

  layoutSide(leftPins, "left");
  layoutSide(rightPins, "right");

  return { pins, graphics };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SymbolPreview({ symbolData }: SymbolPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<{
    pins: SymbolPin[];
    graphics: SymbolGraphic[];
  } | null>(null);
  const [viewportState, setViewportState] = useState<Viewport | null>(null);
  const canvasColors = useCanvasColors();
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const initialFitRef = useRef<Viewport | null>(null);

  // Async parse rawKicadSource using the proper server parser
  useEffect(() => {
    if (!symbolData?.rawKicadSource) {
      setDraft(null);
      return;
    }

    let cancelled = false;
    parseKicadSymbolImport(symbolData.rawKicadSource)
      .then((result) => {
        if (cancelled) return;
        const d = convertParsedKicadSymbolToDraft(result.symbol, "preview");
        setDraft({ pins: d.pins, graphics: d.graphics });
      })
      .catch(() => {
        if (!cancelled) setDraft(null);
      });

    return () => {
      cancelled = true;
    };
  }, [symbolData?.rawKicadSource]);

  // Resolve pins/graphics for rendering
  const resolvedData = useMemo(() => {
    if (!symbolData)
      return { pins: [] as SymbolPin[], graphics: [] as SymbolGraphic[] };
    if (draft) return { pins: draft.pins, graphics: draft.graphics };
    return createFallbackLayout(
      symbolData.pinDefinitions ?? [],
      (symbolData.bodyGraphics ?? []) as unknown[],
    );
  }, [symbolData, draft]);

  // Compute initial fit viewport when data changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !symbolData) return;
    const { pins, graphics } = resolvedData;
    const bounds = computeBounds(pins, graphics);
    const fit = fitViewportToBounds(bounds, canvas.offsetWidth, 300, 30, {
      min: 0.5,
    });
    initialFitRef.current = fit;
    setViewportState(fit);
  }, [symbolData, resolvedData]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !symbolData || !viewportState) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.offsetWidth;
    const height = 300;
    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = canvasColors.background;
    ctx.fillRect(0, 0, width, height);
    renderGrid(ctx, width, height, canvasColors);

    const { pins, graphics } = resolvedData;
    const previewLabel = getSymbolPreviewLabel(symbolData);
    const hidePowerPinText = isPowerSymbolData(symbolData);
    const labelY = isPowerSymbolData(symbolData) ? height - 20 : 16;

    for (const g of graphics)
      renderGraphicWorld(
        ctx,
        g,
        viewportState,
        symbolToScreen,
        canvasColors.bodyStroke,
        canvasColors.bodyFill,
        canvasColors.pinLabel,
      );
    for (const pin of pins)
      renderPin(ctx, pin, viewportState, canvasColors, !hidePowerPinText);

    ctx.fillStyle = canvasColors.refLabel;
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(previewLabel, width / 2, labelY);
  }, [symbolData, viewportState, resolvedData, canvasColors]);

  const handleZoomIn = useCallback(() => {
    setViewportState((prev) => {
      if (!prev) return prev;
      const newZoom = Math.min(500, prev.zoom * 1.25);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, zoom: newZoom };
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        zoom: newZoom,
        offsetX: cx - (cx - prev.offsetX) * (newZoom / prev.zoom),
        offsetY: cy - (cy - prev.offsetY) * (newZoom / prev.zoom),
      };
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewportState((prev) => {
      if (!prev) return prev;
      const newZoom = Math.max(0.1, prev.zoom / 1.25);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, zoom: newZoom };
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        zoom: newZoom,
        offsetX: cx - (cx - prev.offsetX) * (newZoom / prev.zoom),
        offsetY: cy - (cy - prev.offsetY) * (newZoom / prev.zoom),
      };
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isPanningRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    setViewportState((prev) =>
      prev
        ? { ...prev, offsetX: prev.offsetX + dx, offsetY: prev.offsetY + dy }
        : prev,
    );
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const handleFitToContent = useCallback(() => {
    if (initialFitRef.current) setViewportState(initialFitRef.current);
  }, []);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full h-[250px] rounded border border-border-default bg-bg-input cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      <div className="absolute bottom-2 right-2 flex gap-1">
        <button
          type="button"
          onClick={handleFitToContent}
          className="p-1 bg-bg-elevated rounded text-text-tertiary hover:text-text-primary"
          title="Fit to content"
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          className="p-1 bg-bg-elevated rounded text-text-tertiary hover:text-text-primary"
          title="Zoom out"
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20 12H4"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleZoomIn}
          className="p-1 bg-bg-elevated rounded text-text-tertiary hover:text-text-primary"
          title="Zoom in"
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
