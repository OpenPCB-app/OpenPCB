import { useMemo, type ReactElement } from "react";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import {
  GUIDE_COLORS,
  type AlignmentGuide,
  type SpacingGuide,
} from "../guides/guide-types";
import { GuideLineSegments, type GuideSegment } from "./GuideLines";

/**
 * Renders Figma-style alignment guides while dragging/placing components:
 *  - violet collinearity lines (edge/center) and yellow collinear-pad lines;
 *  - emerald equal-spacing bars (with end ticks) when the dragged object is
 *    equally spaced between two flanking neighbors.
 * Thin dashed 1px lines just above geometry but below the snap crosshair
 * (`SELECTION + 0.5`). Mounted inside PcbScene's mirror group so guides track
 * the board in bottom-view like every other overlay.
 */
const OVERSHOOT_MM = 1.5;
const TICK_HALF_MM = 0.5;
const RENDER_ORDER_ALIGNMENT = RENDER_ORDER.SELECTION + 0.6;

function guideColor(kind: AlignmentGuide["kind"]): string {
  return kind === "collinear-pad" ? GUIDE_COLORS.pad : GUIDE_COLORS.align;
}

export function AlignmentGuideLayer({
  guides,
  spacing = [],
}: {
  guides: readonly AlignmentGuide[];
  spacing?: readonly SpacingGuide[];
}): ReactElement | null {
  const segments = useMemo<GuideSegment[]>(() => {
    const out: GuideSegment[] = [];
    for (const g of guides) {
      const lo = g.spanMinMm - OVERSHOOT_MM;
      const hi = g.spanMaxMm + OVERSHOOT_MM;
      const color = guideColor(g.kind);
      out.push(
        g.axis === "x"
          ? { x1: g.coordMm, y1: lo, x2: g.coordMm, y2: hi, color }
          : { x1: lo, y1: g.coordMm, x2: hi, y2: g.coordMm, color },
      );
    }
    for (const s of spacing) {
      const color = GUIDE_COLORS.spacing;
      for (const span of s.spans) {
        if (s.axis === "x") {
          // horizontal bar at y = crossMm with vertical end ticks
          out.push({
            x1: span.fromMm,
            y1: s.crossMm,
            x2: span.toMm,
            y2: s.crossMm,
            color,
          });
          for (const x of [span.fromMm, span.toMm]) {
            out.push({
              x1: x,
              y1: s.crossMm - TICK_HALF_MM,
              x2: x,
              y2: s.crossMm + TICK_HALF_MM,
              color,
            });
          }
        } else {
          // vertical bar at x = crossMm with horizontal end ticks
          out.push({
            x1: s.crossMm,
            y1: span.fromMm,
            x2: s.crossMm,
            y2: span.toMm,
            color,
          });
          for (const y of [span.fromMm, span.toMm]) {
            out.push({
              x1: s.crossMm - TICK_HALF_MM,
              y1: y,
              x2: s.crossMm + TICK_HALF_MM,
              y2: y,
              color,
            });
          }
        }
      }
    }
    return out;
  }, [guides, spacing]);

  if (segments.length === 0) return null;

  return (
    <GuideLineSegments
      segments={segments}
      renderOrder={RENDER_ORDER_ALIGNMENT}
    />
  );
}
