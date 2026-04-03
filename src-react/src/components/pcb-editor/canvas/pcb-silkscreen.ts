import type { PcbPlacement, Point2D, PcbViewport } from "../pcb-types";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";
import { LAYER_COLORS } from "../layer-colors";

type ParsedGraphic = ParsedKicadFootprint["graphics"][number];

function transformPoint(
  placement: PcbPlacement,
  localX: number,
  localY: number,
): Point2D {
  const radians = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  let x = localX;
  let y = localY;

  if (placement.layer === "B.Cu") {
    x = -x;
  }

  const rotatedX = x * cos - y * sin;
  const rotatedY = x * sin + y * cos;

  return {
    x: placement.position.x + rotatedX,
    y: placement.position.y + rotatedY,
  };
}

function getSilkscreenColor(
  graphic: ParsedGraphic,
  placement: PcbPlacement,
): string | null {
  const layer = graphic.layer;

  if (layer === "F.SilkS" && placement.layer === "F.Cu") {
    return LAYER_COLORS["F.SilkS"]!;
  }
  if (layer === "B.SilkS" && placement.layer === "B.Cu") {
    return LAYER_COLORS["B.SilkS"]!;
  }
  if (layer === "F.CrtYd" && placement.layer === "F.Cu") {
    return LAYER_COLORS["F.CrtYd"]!;
  }
  if (layer === "B.CrtYd" && placement.layer === "B.Cu") {
    return LAYER_COLORS["F.CrtYd"]!;
  }

  return null;
}

function renderLine(
  ctx: CanvasRenderingContext2D,
  placement: PcbPlacement,
  graphic: ParsedGraphic,
  viewport: PcbViewport,
  color: string,
): void {
  const data = graphic.data as {
    start: { x: number; y: number };
    end: { x: number; y: number };
    width?: number;
  };

  const startWorld = transformPoint(placement, data.start.x, data.start.y);
  const endWorld = transformPoint(placement, data.end.x, data.end.y);

  const startScreen = {
    x: startWorld.x * viewport.zoom + viewport.offsetX,
    y: startWorld.y * viewport.zoom + viewport.offsetY,
  };
  const endScreen = {
    x: endWorld.x * viewport.zoom + viewport.offsetX,
    y: endWorld.y * viewport.zoom + viewport.offsetY,
  };

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, (data.width ?? 0.12) * viewport.zoom);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(startScreen.x, startScreen.y);
  ctx.lineTo(endScreen.x, endScreen.y);
  ctx.stroke();
}

function renderRect(
  ctx: CanvasRenderingContext2D,
  placement: PcbPlacement,
  graphic: ParsedGraphic,
  viewport: PcbViewport,
  color: string,
): void {
  const data = graphic.data as {
    start: { x: number; y: number };
    end: { x: number; y: number };
    width?: number;
    fill?: string;
  };

  const p1 = transformPoint(placement, data.start.x, data.start.y);
  const p2 = transformPoint(placement, data.end.x, data.end.y);
  const p3 = transformPoint(placement, data.end.x, data.start.y);
  const p4 = transformPoint(placement, data.start.x, data.end.y);

  const screenPoints = [p1, p3, p2, p4].map((p) => ({
    x: p.x * viewport.zoom + viewport.offsetX,
    y: p.y * viewport.zoom + viewport.offsetY,
  }));

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, (data.width ?? 0.12) * viewport.zoom);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(screenPoints[0]!.x, screenPoints[0]!.y);
  for (let i = 1; i < screenPoints.length; i++) {
    ctx.lineTo(screenPoints[i]!.x, screenPoints[i]!.y);
  }
  ctx.closePath();

  if (data.fill === "solid") {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.stroke();
}

function renderCircle(
  ctx: CanvasRenderingContext2D,
  placement: PcbPlacement,
  graphic: ParsedGraphic,
  viewport: PcbViewport,
  color: string,
): void {
  const data = graphic.data as {
    center: { x: number; y: number };
    radius?: number;
    end?: { x: number; y: number };
    width?: number;
    fill?: string;
  };

  const centerWorld = transformPoint(placement, data.center.x, data.center.y);
  const centerScreen = {
    x: centerWorld.x * viewport.zoom + viewport.offsetX,
    y: centerWorld.y * viewport.zoom + viewport.offsetY,
  };

  let radius: number;
  if (data.radius !== undefined) {
    radius = data.radius * viewport.zoom;
  } else if (data.end) {
    const dx = data.end.x - data.center.x;
    const dy = data.end.y - data.center.y;
    radius = Math.sqrt(dx * dx + dy * dy) * viewport.zoom;
  } else {
    radius = 1 * viewport.zoom;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, (data.width ?? 0.12) * viewport.zoom);
  ctx.beginPath();
  ctx.arc(centerScreen.x, centerScreen.y, radius, 0, Math.PI * 2);

  if (data.fill === "solid") {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.stroke();
}

function renderArc(
  ctx: CanvasRenderingContext2D,
  placement: PcbPlacement,
  graphic: ParsedGraphic,
  viewport: PcbViewport,
  color: string,
): void {
  const data = graphic.data as {
    start: { x: number; y: number };
    mid: { x: number; y: number };
    end: { x: number; y: number };
    width?: number;
  };

  const startWorld = transformPoint(placement, data.start.x, data.start.y);
  const midWorld = transformPoint(placement, data.mid.x, data.mid.y);
  const endWorld = transformPoint(placement, data.end.x, data.end.y);

  const startScreen = {
    x: startWorld.x * viewport.zoom + viewport.offsetX,
    y: startWorld.y * viewport.zoom + viewport.offsetY,
  };
  const midScreen = {
    x: midWorld.x * viewport.zoom + viewport.offsetX,
    y: midWorld.y * viewport.zoom + viewport.offsetY,
  };
  const endScreen = {
    x: endWorld.x * viewport.zoom + viewport.offsetX,
    y: endWorld.y * viewport.zoom + viewport.offsetY,
  };

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, (data.width ?? 0.12) * viewport.zoom);
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(startScreen.x, startScreen.y);
  ctx.quadraticCurveTo(midScreen.x, midScreen.y, endScreen.x, endScreen.y);
  ctx.stroke();
}

function renderPoly(
  ctx: CanvasRenderingContext2D,
  placement: PcbPlacement,
  graphic: ParsedGraphic,
  viewport: PcbViewport,
  color: string,
): void {
  const data = graphic.data as {
    points: Array<{ x: number; y: number }>;
    width?: number;
    fill?: string;
  };

  if (!data.points || data.points.length < 2) return;

  const screenPoints = data.points.map((pt) => {
    const world = transformPoint(placement, pt.x, pt.y);
    return {
      x: world.x * viewport.zoom + viewport.offsetX,
      y: world.y * viewport.zoom + viewport.offsetY,
    };
  });

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, (data.width ?? 0.12) * viewport.zoom);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(screenPoints[0]!.x, screenPoints[0]!.y);
  for (let i = 1; i < screenPoints.length; i++) {
    ctx.lineTo(screenPoints[i]!.x, screenPoints[i]!.y);
  }
  ctx.closePath();

  if (data.fill === "solid") {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.stroke();
}

export function renderSilkscreen(
  ctx: CanvasRenderingContext2D,
  placements: PcbPlacement[],
  viewport: PcbViewport,
  activeLayer: "F.Cu" | "B.Cu",
  visibleLayers: Set<string>,
): void {
  for (const placement of placements) {
    if (!placement.footprintData?.graphics) continue;

    for (const graphic of placement.footprintData.graphics) {
      const color = getSilkscreenColor(graphic, placement);
      if (!color) continue;

      const layer = graphic.layer;
      if (!visibleLayers.has(layer)) continue;

      ctx.save();
      ctx.globalAlpha = placement.layer === activeLayer ? 1 : 0.3;

      switch (graphic.type) {
        case "line":
          renderLine(ctx, placement, graphic, viewport, color);
          break;
        case "rect":
          renderRect(ctx, placement, graphic, viewport, color);
          break;
        case "circle":
          renderCircle(ctx, placement, graphic, viewport, color);
          break;
        case "arc":
          renderArc(ctx, placement, graphic, viewport, color);
          break;
        case "poly":
          renderPoly(ctx, placement, graphic, viewport, color);
          break;
        case "text":
          break;
      }

      ctx.restore();
    }
  }
}
