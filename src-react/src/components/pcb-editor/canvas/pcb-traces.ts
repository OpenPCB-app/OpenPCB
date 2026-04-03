import type { TraceSegment, Via, PcbViewport } from "../pcb-types";
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
    renderVia(ctx, via, viewport);
  }
}

export function renderRoutingPreview(
  ctx: CanvasRenderingContext2D,
  segments: TraceSegment[],
  committedSegments: TraceSegment[],
  committedVias: Via[],
  previewVia: Via | null,
  viewport: PcbViewport,
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const seg of committedSegments) {
    const baseColor = LAYER_COLORS[seg.layer] ?? "#888888";
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = seg.width * viewport.zoom;

    const start = pcbToScreen(seg.start.x, seg.start.y, viewport);
    const end = pcbToScreen(seg.end.x, seg.end.y, viewport);

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  for (const via of committedVias) {
    renderVia(ctx, via, viewport);
  }

  ctx.setLineDash([4, 4]);

  for (const seg of segments) {
    const baseColor = LAYER_COLORS[seg.layer] ?? "#888888";
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = seg.width * viewport.zoom;

    const start = pcbToScreen(seg.start.x, seg.start.y, viewport);
    const end = pcbToScreen(seg.end.x, seg.end.y, viewport);

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  if (previewVia) {
    ctx.globalAlpha = 0.6;
    renderVia(ctx, previewVia, viewport);
    ctx.globalAlpha = 1;
  }

  ctx.setLineDash([]);
  ctx.restore();
}

function renderVia(
  ctx: CanvasRenderingContext2D,
  via: Via,
  viewport: PcbViewport,
): void {
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

function applyAlpha(hexColor: string, alpha: number): string {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
