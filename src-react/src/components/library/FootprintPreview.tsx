import { useEffect, useRef, useState, useCallback } from "react";
import { useCanvasColors } from "@/lib/canvas-theme";
import type { FootprintOptionType } from "../../../../src-ts/src/core/schemas/component-library.schema";

interface ParsedPad {
  number: string;
  type: "smd" | "thru_hole" | "np_thru_hole" | "connect";
  shape: "circle" | "rect" | "oval" | "roundrect" | "trapezoid" | "custom";
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  layers: string[];
  drillDiameter?: number;
}

interface ParsedGraphic {
  type: "line" | "rect" | "circle" | "arc" | "poly" | "polygon" | "text";
  layer: string;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  center?: { x: number; y: number };
  radius?: number;
  width?: number;
  points?: Array<{ x: number; y: number }>;
  text?: string;
}

interface ParsedFootprint {
  name: string;
  pads: ParsedPad[];
  graphics: ParsedGraphic[];
}

function parseKicadFootprint(source: string): ParsedFootprint | null {
  try {
    const pads: ParsedPad[] = [];
    const graphics: ParsedGraphic[] = [];

    // Parse pads
    const padRegex =
      /\(pad\s+"([^"]*)"\s+(\w+)\s+(\w+)\s+\(at\s+([\d.-]+)\s+([\d.-]+)(?:\s+([\d.-]+))?\)\s+\(size\s+([\d.-]+)\s+([\d.-]+)\)/g;
    let match;
    while ((match = padRegex.exec(source)) !== null) {
      const [, number, padType, shape, x, y, rotation, width, height] = match;
      pads.push({
        number: number || "",
        type: (padType as ParsedPad["type"]) || "smd",
        shape: (shape as ParsedPad["shape"]) || "rect",
        position: { x: parseFloat(x || "0"), y: parseFloat(y || "0") },
        size: {
          width: parseFloat(width || "0"),
          height: parseFloat(height || "0"),
        },
        rotation: parseFloat(rotation || "0"),
        layers: [],
      });
    }

    // Parse lines (fp_line)
    const lineRegex =
      /\(fp_line\s+\(start\s+([\d.-]+)\s+([\d.-]+)\)\s+\(end\s+([\d.-]+)\s+([\d.-]+)\)\s+\(layer\s+(\w+)\)/g;
    while ((match = lineRegex.exec(source)) !== null) {
      const [, startX, startY, endX, endY, layer] = match;
      graphics.push({
        type: "line",
        layer: layer || "F.SilkS",
        start: { x: parseFloat(startX || "0"), y: parseFloat(startY || "0") },
        end: { x: parseFloat(endX || "0"), y: parseFloat(endY || "0") },
      });
    }

    // Parse circles (fp_circle)
    const circleRegex =
      /\(fp_circle\s+\(center\s+([\d.-]+)\s+([\d.-]+)\)\s+\(end\s+([\d.-]+)\s+([\d.-]+)\)\s+\(layer\s+(\w+)\)/g;
    while ((match = circleRegex.exec(source)) !== null) {
      const [, centerX, centerY, endX, endY, layer] = match;
      const cx = parseFloat(centerX || "0");
      const cy = parseFloat(centerY || "0");
      const ex = parseFloat(endX || "0");
      const ey = parseFloat(endY || "0");
      const radius = Math.sqrt((ex - cx) ** 2 + (ey - cy) ** 2);
      graphics.push({
        type: "circle",
        layer: layer || "F.SilkS",
        center: { x: cx, y: cy },
        radius,
      });
    }

    // Parse arcs (fp_arc)
    const arcRegex =
      /\(fp_arc\s+\(start\s+([\d.-]+)\s+([\d.-]+)\)\s+\(end\s+([\d.-]+)\s+([\d.-]+)\)\s+\(angle\s+([\d.-]+)\)\s+\(layer\s+(\w+)\)/g;
    while ((match = arcRegex.exec(source)) !== null) {
      const [, startX, startY, endX, endY, , layer] = match;
      graphics.push({
        type: "arc",
        layer: layer || "F.SilkS",
        start: { x: parseFloat(startX || "0"), y: parseFloat(startY || "0") },
        end: { x: parseFloat(endX || "0"), y: parseFloat(endY || "0") },
      });
    }

    return { name: "", pads, graphics };
  } catch (e) {
    console.error("Failed to parse KiCAD footprint:", e);
    return null;
  }
}

interface FootprintPreviewProps {
  footprint?: FootprintOptionType;
}

interface FpViewport {
  offsetX: number;
  offsetY: number;
  scale: number;
  pixelsPerMm: number;
}

export function FootprintPreview({ footprint }: FootprintPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fpViewport, setFpViewport] = useState<FpViewport | null>(null);
  const canvasColors = useCanvasColors();
  const initialFpViewportRef = useRef<FpViewport | null>(null);
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // Reset viewport when footprint changes
  useEffect(() => {
    initialFpViewportRef.current = null;
    setFpViewport(null);
  }, [footprint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const width = canvas.offsetWidth;
    const height = 300;
    canvas.width = width;
    canvas.height = height;

    // Clear canvas
    ctx.fillStyle = canvasColors.background;
    ctx.fillRect(0, 0, width, height);

    // Try to get footprint data
    let parsedFootprint: ParsedFootprint | null = null;

    const kicadPayload = footprint?.kicadPayload as
      | {
          pads?: Array<{
            number: string;
            type: string;
            shape: string;
            position: { x: number; y: number };
            size: { width: number; height: number };
            rotation?: number;
            layers?: string[];
            drillDiameter?: number;
          }>;
          graphics?: Array<{
            type: string;
            layer?: string;
            start?: { x: number; y: number };
            end?: { x: number; y: number };
            center?: { x: number; y: number };
            position?: { x: number; y: number };
            width?: number;
            height?: number;
            radius?: number;
            strokeWidth?: number;
            points?: Array<{ x: number; y: number }>;
            text?: string;
          }>;
          rawKicadSource?: string | null;
        }
      | undefined;

    if (kicadPayload?.pads?.length || kicadPayload?.graphics?.length) {
      // Use structured data directly from stored payload
      parsedFootprint = {
        name: "",
        pads: (kicadPayload.pads ?? []).map((pad) => ({
          number: pad.number ?? "",
          type: (pad.type as ParsedPad["type"]) ?? "smd",
          shape: (pad.shape as ParsedPad["shape"]) ?? "rect",
          position: pad.position ?? { x: 0, y: 0 },
          size: pad.size ?? { width: 0, height: 0 },
          rotation: pad.rotation ?? 0,
          layers: pad.layers ?? [],
          drillDiameter: pad.drillDiameter,
        })),
        graphics: (kicadPayload.graphics ?? []).map((g) => {
          // Map footprint editor graphic types to preview graphic types
          const base: ParsedGraphic = {
            type: g.type as ParsedGraphic["type"],
            layer: g.layer ?? "F.SilkS",
          };
          if (g.type === "line" && g.start && g.end) {
            base.start = g.start;
            base.end = g.end;
          } else if (g.type === "rect" && g.position) {
            // Convert rect position+size to start/end
            const hw = (g.width ?? 0) / 2;
            const hh = (g.height ?? 0) / 2;
            base.start = { x: g.position.x - hw, y: g.position.y - hh };
            base.end = { x: g.position.x + hw, y: g.position.y + hh };
            base.type = "rect";
          } else if (g.type === "circle" && g.center) {
            base.center = g.center;
            base.radius = g.radius;
          } else if (g.type === "arc") {
            base.start = g.start ?? g.center;
            base.end = g.end;
          } else if (g.type === "polygon" && g.points) {
            base.points = g.points;
          }
          if (g.strokeWidth) base.width = g.strokeWidth;
          return base;
        }),
      };
    } else if (kicadPayload?.rawKicadSource) {
      // Legacy fallback: parse raw KiCad source
      parsedFootprint = parseKicadFootprint(kicadPayload.rawKicadSource);
    }

    if (
      !parsedFootprint ||
      (parsedFootprint.pads.length === 0 &&
        parsedFootprint.graphics.length === 0)
    ) {
      // Draw empty state
      ctx.fillStyle = canvasColors.pinNumber;
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No footprint data available", width / 2, height / 2);
      return;
    }

    // Draw grid
    ctx.strokeStyle = canvasColors.gridMajorLine;
    ctx.lineWidth = 1;
    const gridSize = 10;
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

    // Calculate bounds
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    parsedFootprint.pads.forEach((pad) => {
      const hw = pad.size.width / 2;
      const hh = pad.size.height / 2;
      minX = Math.min(minX, pad.position.x - hw);
      minY = Math.min(minY, pad.position.y - hh);
      maxX = Math.max(maxX, pad.position.x + hw);
      maxY = Math.max(maxY, pad.position.y + hh);
    });

    parsedFootprint.graphics.forEach((graphic) => {
      if (graphic.start) {
        minX = Math.min(minX, graphic.start.x);
        minY = Math.min(minY, graphic.start.y);
        maxX = Math.max(maxX, graphic.start.x);
        maxY = Math.max(maxY, graphic.start.y);
      }
      if (graphic.end) {
        minX = Math.min(minX, graphic.end.x);
        minY = Math.min(minY, graphic.end.y);
        maxX = Math.max(maxX, graphic.end.x);
        maxY = Math.max(maxY, graphic.end.y);
      }
      if (graphic.center && graphic.radius) {
        minX = Math.min(minX, graphic.center.x - graphic.radius);
        minY = Math.min(minY, graphic.center.y - graphic.radius);
        maxX = Math.max(maxX, graphic.center.x + graphic.radius);
        maxY = Math.max(maxY, graphic.center.y + graphic.radius);
      }
      if (graphic.points) {
        graphic.points.forEach((pt) => {
          minX = Math.min(minX, pt.x);
          minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x);
          maxY = Math.max(maxY, pt.y);
        });
      }
    });

    if (minX === Number.POSITIVE_INFINITY) {
      minX = -5;
      minY = -5;
      maxX = 5;
      maxY = 5;
    }

    // Add padding
    const padding = 2;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    // Calculate initial fit scale
    const fpWidth = maxX - minX;
    const fpHeight = maxY - minY;
    const pixelsPerMm = 15;
    const scaleX = (width - 40) / (fpWidth * pixelsPerMm);
    const scaleY = (height - 40) / (fpHeight * pixelsPerMm);
    const fitScale = Math.min(scaleX, scaleY);

    const fpCenterX = (minX + maxX) / 2;
    const fpCenterY = (minY + maxY) / 2;

    // Save initial viewport
    const initialVp: FpViewport = {
      offsetX: width / 2 - fpCenterX * pixelsPerMm * fitScale,
      offsetY: height / 2 + fpCenterY * pixelsPerMm * fitScale,
      scale: fitScale,
      pixelsPerMm,
    };
    if (!initialFpViewportRef.current) {
      initialFpViewportRef.current = initialVp;
      setFpViewport(initialVp);
    }

    // Use interactive viewport or initial fit
    const vp = fpViewport ?? initialVp;
    const scale = vp.scale;

    const transform = (x: number, y: number) => ({
      x: vp.offsetX + x * pixelsPerMm * scale,
      y: vp.offsetY - y * pixelsPerMm * scale,
    });

    // Draw graphics (silkscreen, fab layer)
    parsedFootprint.graphics.forEach((graphic) => {
      ctx.strokeStyle = graphic.layer.includes("SilkS")
        ? canvasColors.silkscreen
        : canvasColors.fabOutline;
      ctx.lineWidth = 1.5;

      switch (graphic.type) {
        case "line": {
          if (graphic.start && graphic.end) {
            const start = transform(graphic.start.x, graphic.start.y);
            const end = transform(graphic.end.x, graphic.end.y);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
          }
          break;
        }
        case "rect": {
          if (graphic.start && graphic.end) {
            const start = transform(graphic.start.x, graphic.start.y);
            const end = transform(graphic.end.x, graphic.end.y);
            ctx.strokeRect(
              Math.min(start.x, end.x),
              Math.min(start.y, end.y),
              Math.abs(end.x - start.x),
              Math.abs(end.y - start.y),
            );
          }
          break;
        }
        case "circle": {
          if (graphic.center && graphic.radius) {
            const center = transform(graphic.center.x, graphic.center.y);
            const radius = graphic.radius * pixelsPerMm * scale;
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.stroke();
          }
          break;
        }
        case "polygon": {
          if (graphic.points && graphic.points.length > 1) {
            const first = graphic.points[0];
            if (first) {
              ctx.beginPath();
              const p = transform(first.x, first.y);
              ctx.moveTo(p.x, p.y);
              for (let i = 1; i < graphic.points.length; i++) {
                const pt = graphic.points[i];
                if (pt) {
                  const sp = transform(pt.x, pt.y);
                  ctx.lineTo(sp.x, sp.y);
                }
              }
              ctx.closePath();
              ctx.stroke();
            }
          }
          break;
        }
        case "arc": {
          if (graphic.start && graphic.end) {
            const start = transform(graphic.start.x, graphic.start.y);
            const end = transform(graphic.end.x, graphic.end.y);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
          }
          break;
        }
      }
    });

    // Draw pads
    parsedFootprint.pads.forEach((pad) => {
      const pos = transform(pad.position.x, pad.position.y);
      const w = pad.size.width * pixelsPerMm * scale;
      const h = pad.size.height * pixelsPerMm * scale;

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate((-pad.rotation * Math.PI) / 180);

      ctx.fillStyle = canvasColors.padSelectedFill;
      ctx.strokeStyle = canvasColors.padStroke;
      ctx.lineWidth = 1.5;

      if (pad.shape === "circle") {
        const radius = Math.min(w, h) / 2;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (pad.shape === "oval") {
        ctx.beginPath();
        ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
      }

      ctx.restore();

      // Draw pad number
      if (scale > 0.5) {
        ctx.fillStyle = canvasColors.padNumberLight;
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(pad.number, pos.x, pos.y);
      }
    });

    // Draw pin 1 marker
    const pin1 = parsedFootprint.pads.find((p) => p.number === "1");
    if (pin1) {
      const pos = transform(pin1.position.x, pin1.position.y);
      ctx.fillStyle = canvasColors.pin1Marker;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [footprint, fpViewport, canvasColors]);

  const handleZoomIn = useCallback(() => {
    setFpViewport((prev) => {
      if (!prev) return prev;
      const newScale = Math.min(50, prev.scale * 1.25);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, scale: newScale };
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const ratio = newScale / prev.scale;
      return {
        ...prev,
        scale: newScale,
        offsetX: cx - (cx - prev.offsetX) * ratio,
        offsetY: cy - (cy - prev.offsetY) * ratio,
      };
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setFpViewport((prev) => {
      if (!prev) return prev;
      const newScale = Math.max(0.01, prev.scale / 1.25);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, scale: newScale };
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const ratio = newScale / prev.scale;
      return {
        ...prev,
        scale: newScale,
        offsetX: cx - (cx - prev.offsetX) * ratio,
        offsetY: cy - (cy - prev.offsetY) * ratio,
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
    setFpViewport((prev) =>
      prev
        ? { ...prev, offsetX: prev.offsetX + dx, offsetY: prev.offsetY + dy }
        : prev,
    );
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const handleFitToContent = useCallback(() => {
    initialFpViewportRef.current = null;
    setFpViewport(null);
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
          onClick={handleFitToContent}
          className="p-1 bg-bg-elevated rounded text-text-tertiary hover:text-text-primary"
          title="Fit to content"
        >
          <svg
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
          onClick={handleZoomOut}
          className="p-1 bg-bg-elevated rounded text-text-tertiary hover:text-text-primary"
          title="Zoom out"
        >
          <svg
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
          onClick={handleZoomIn}
          className="p-1 bg-bg-elevated rounded text-text-tertiary hover:text-text-primary"
          title="Zoom in"
        >
          <svg
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
