import type { PcbPlacement, Point2D, PcbViewport } from "../pcb-types";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";
import { LAYER_COLORS, PCB_BACKGROUND } from "../layer-colors";

type ParsedPad = ParsedKicadFootprint["pads"][number];

function transformPadPosition(
  placement: PcbPlacement,
  pad: ParsedPad,
): Point2D {
  const radians = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  let localX = pad.position.x;
  let localY = pad.position.y;

  if (placement.layer === "B.Cu") {
    localX = -localX;
  }

  const rotatedX = localX * cos - localY * sin;
  const rotatedY = localX * sin + localY * cos;

  return {
    x: placement.position.x + rotatedX,
    y: placement.position.y + rotatedY,
  };
}

function getPadColor(pad: ParsedPad, activeLayer: "F.Cu" | "B.Cu"): string {
  const isFrontPad = pad.layers.some(
    (l) => l === "F.Cu" || l === "*.Cu" || l === "F.Mask",
  );
  const isBackPad = pad.layers.some(
    (l) => l === "B.Cu" || l === "*.Cu" || l === "B.Mask",
  );
  const isThroughHole = pad.type === "thru_hole" || pad.type === "np_thru_hole";

  if (isThroughHole) {
    return activeLayer === "F.Cu"
      ? LAYER_COLORS["F.Cu"]!
      : LAYER_COLORS["B.Cu"]!;
  }

  if (isFrontPad && isBackPad) {
    return activeLayer === "F.Cu"
      ? LAYER_COLORS["F.Cu"]!
      : LAYER_COLORS["B.Cu"]!;
  }

  if (isFrontPad) {
    return LAYER_COLORS["F.Cu"]!;
  }

  if (isBackPad) {
    return LAYER_COLORS["B.Cu"]!;
  }

  return LAYER_COLORS["F.Cu"]!;
}

export function renderPads(
  ctx: CanvasRenderingContext2D,
  placements: PcbPlacement[],
  viewport: PcbViewport,
  activeLayer: "F.Cu" | "B.Cu",
  visibleLayers: Set<string>,
): void {
  const backPlacements = placements.filter((p) => p.layer === "B.Cu");
  const frontPlacements = placements.filter((p) => p.layer === "F.Cu");

  const renderPlacementPads = (
    placement: PcbPlacement,
    isActiveLayer: boolean,
  ) => {
    if (!placement.footprintData?.pads) return;

    for (const pad of placement.footprintData.pads) {
      const worldPos = transformPadPosition(placement, pad);
      const screenX = worldPos.x * viewport.zoom + viewport.offsetX;
      const screenY = worldPos.y * viewport.zoom + viewport.offsetY;

      const halfWidth = (pad.size.width / 2) * viewport.zoom;
      const halfHeight = (pad.size.height / 2) * viewport.zoom;

      const padColor = getPadColor(pad, activeLayer);
      ctx.fillStyle = padColor;
      ctx.globalAlpha = isActiveLayer ? 1 : 0.3;

      ctx.save();
      ctx.translate(screenX, screenY);

      let totalRotation = placement.rotation + (pad.rotation || 0);
      if (placement.layer === "B.Cu") {
        totalRotation = -totalRotation;
      }
      ctx.rotate((totalRotation * Math.PI) / 180);

      switch (pad.shape) {
        case "circle":
          ctx.beginPath();
          ctx.arc(0, 0, halfWidth, 0, Math.PI * 2);
          ctx.fill();
          break;

        case "oval":
          ctx.beginPath();
          ctx.ellipse(0, 0, halfWidth, halfHeight, 0, 0, Math.PI * 2);
          ctx.fill();
          break;

        case "roundrect": {
          const radius =
            Math.min(pad.size.width, pad.size.height) *
            (pad.roundrectRatio ?? 0.25) *
            viewport.zoom;
          ctx.beginPath();
          ctx.roundRect(
            -halfWidth,
            -halfHeight,
            halfWidth * 2,
            halfHeight * 2,
            radius,
          );
          ctx.fill();
          break;
        }

        case "rect":
        default:
          ctx.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
          break;
      }

      if (pad.type === "thru_hole" || pad.type === "np_thru_hole") {
        const drillRadius = ((pad.drillDiameter ?? 0.3) / 2) * viewport.zoom;
        ctx.fillStyle = PCB_BACKGROUND;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(0, 0, drillRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  };

  if (visibleLayers.has("B.Cu")) {
    for (const placement of backPlacements) {
      renderPlacementPads(placement, activeLayer === "B.Cu");
    }
  }

  if (visibleLayers.has("F.Cu")) {
    for (const placement of frontPlacements) {
      renderPlacementPads(placement, activeLayer === "F.Cu");
    }
  }

  ctx.globalAlpha = 1;
}
