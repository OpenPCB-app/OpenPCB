import type { NetLabelEntity, Viewport } from "../types";
import { schematicToScreen } from "./viewport";

export interface NetLabelColors {
  text: string;
  flag: string;
  flagStroke: string;
  selectedText: string;
  selectedFlag: string;
}

export const DEFAULT_NET_LABEL_COLORS: NetLabelColors = {
  text: "#14b8a6",
  flag: "#0d9488",
  flagStroke: "#14b8a6",
  selectedText: "#5eead4",
  selectedFlag: "#2dd4bf",
};

const FLAG_WIDTH_PX = 8;
const FLAG_HEIGHT_PX = 12;
const FLAG_NOTCH_PX = 4;
const TEXT_OFFSET_PX = 12;
const FONT_SIZE_PX = 11;

export function renderNetLabel(
  ctx: CanvasRenderingContext2D,
  label: NetLabelEntity,
  viewport: Viewport,
  options: {
    selected?: boolean;
    colors?: NetLabelColors;
  } = {},
): void {
  const colors = options.colors ?? DEFAULT_NET_LABEL_COLORS;
  const selected = options.selected ?? false;

  const screenPoint = schematicToScreen(
    label.position.x,
    label.position.y,
    viewport,
  );

  ctx.save();

  ctx.translate(screenPoint.x, screenPoint.y);
  ctx.rotate(((label.rotation ?? 0) * Math.PI) / 180);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-FLAG_WIDTH_PX, -FLAG_HEIGHT_PX / 2);
  ctx.lineTo(-FLAG_WIDTH_PX - FLAG_NOTCH_PX, 0);
  ctx.lineTo(-FLAG_WIDTH_PX, FLAG_HEIGHT_PX / 2);
  ctx.closePath();

  ctx.fillStyle = selected ? colors.selectedFlag : colors.flag;
  ctx.fill();
  ctx.strokeStyle = colors.flagStroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fillStyle = selected ? colors.selectedText : colors.text;
  ctx.fill();

  ctx.font = `bold ${FONT_SIZE_PX}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = selected ? colors.selectedText : colors.text;
  ctx.fillText(label.text, TEXT_OFFSET_PX / 2, 0);

  ctx.restore();
}

export function renderNetLabels(
  ctx: CanvasRenderingContext2D,
  labels: NetLabelEntity[],
  viewport: Viewport,
  selectedIds: Set<string>,
  colors?: NetLabelColors,
): void {
  for (const label of labels) {
    renderNetLabel(ctx, label, viewport, {
      selected: selectedIds.has(label.id),
      colors,
    });
  }
}

export function getNetLabelBounds(
  label: NetLabelEntity,
  viewport: Viewport,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const textWidthPx = label.text.length * (FONT_SIZE_PX * 0.6) + TEXT_OFFSET_PX;
  const heightPx = Math.max(FLAG_HEIGHT_PX, FONT_SIZE_PX);
  const heightSchematic = heightPx / viewport.zoom;

  const rotation = (label.rotation ?? 0) % 360;
  let minX: number, minY: number, maxX: number, maxY: number;

  switch (rotation) {
    case 90:
      minX = label.position.x - heightSchematic / 2;
      maxX = label.position.x + heightSchematic / 2;
      minY = label.position.y - (FLAG_WIDTH_PX + FLAG_NOTCH_PX) / viewport.zoom;
      maxY = label.position.y + (textWidthPx - TEXT_OFFSET_PX) / viewport.zoom;
      break;
    case 180:
      minX = label.position.x - (textWidthPx - TEXT_OFFSET_PX) / viewport.zoom;
      maxX = label.position.x + (FLAG_WIDTH_PX + FLAG_NOTCH_PX) / viewport.zoom;
      minY = label.position.y - heightSchematic / 2;
      maxY = label.position.y + heightSchematic / 2;
      break;
    case 270:
      minX = label.position.x - heightSchematic / 2;
      maxX = label.position.x + heightSchematic / 2;
      minY = label.position.y - (textWidthPx - TEXT_OFFSET_PX) / viewport.zoom;
      maxY = label.position.y + (FLAG_WIDTH_PX + FLAG_NOTCH_PX) / viewport.zoom;
      break;
    default:
      minX = label.position.x - (FLAG_WIDTH_PX + FLAG_NOTCH_PX) / viewport.zoom;
      maxX = label.position.x + (textWidthPx - TEXT_OFFSET_PX) / viewport.zoom;
      minY = label.position.y - heightSchematic / 2;
      maxY = label.position.y + heightSchematic / 2;
  }

  return { minX, minY, maxX, maxY };
}
