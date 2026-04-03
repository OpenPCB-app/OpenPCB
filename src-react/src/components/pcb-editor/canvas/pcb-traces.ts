import type { TraceSegment, Via, PcbViewport, Point2D } from "../pcb-types";
import { LAYER_COLORS, PCB_BACKGROUND } from "../layer-colors";
import { pcbToScreen } from "./pcb-viewport";

const VIA_COPPER_COLOR = "#b4b4b4";
const INACTIVE_LAYER_ALPHA = 0.3;

export function renderTraces(
  ctx: CanvasRenderingContext2D,
  traces: TraceSegment[],
  viewport: PcbViewport,
  activeLayer: string,
  visibleLayers: Set<string>,
): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const trace of traces) {
    if (!visibleLayers.has(trace.layer)) continue;

    const isActive = trace.layer === activeLayer;
    const baseColor = LAYER_COLORS[trace.layer] ?? "#888888";

    ctx.strokeStyle = isActive
      ? baseColor
      : applyAlpha(baseColor, INACTIVE_LAYER_ALPHA);
    ctx.lineWidth = trace.width * viewport.zoom;

    const start = pcbToScreen(trace.start.x, trace.start.y, viewport);
    const end = pcbToScreen(trace.end.x, trace.end.y, viewport);

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
}

export function renderVias(
  ctx: CanvasRenderingContext2D,
  vias: Via[],
  viewport: PcbViewport,
): void {
  for (const via of vias) {
    const screen = pcbToScreen(via.position.x, via.position.y, viewport);
    const outerRadius = (via.padDiameter / 2) * viewport.zoom;
    const innerRadius = (via.drillDiameter / 2) * viewport.zoom;

    ctx.fillStyle = VIA_COPPER_COLOR;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, outerRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = PCB_BACKGROUND;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, innerRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface RoutingPreview {
  points: Point2D[];
  width: number;
  layer: string;
}

export function renderRoutingPreview(
  ctx: CanvasRenderingContext2D,
  preview: RoutingPreview | null,
  viewport: PcbViewport,
): void {
  if (!preview || preview.points.length < 2) return;

  const baseColor = LAYER_COLORS[preview.layer] ?? "#888888";

  ctx.save();
  ctx.strokeStyle = baseColor;
  ctx.lineWidth = preview.width * viewport.zoom;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([4, 4]);

  ctx.beginPath();
  const first = pcbToScreen(
    preview.points[0]!.x,
    preview.points[0]!.y,
    viewport,
  );
  ctx.moveTo(first.x, first.y);

  for (let i = 1; i < preview.points.length; i++) {
    const pt = preview.points[i]!;
    const screen = pcbToScreen(pt.x, pt.y, viewport);
    ctx.lineTo(screen.x, screen.y);
  }

  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function applyAlpha(hexColor: string, alpha: number): string {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
