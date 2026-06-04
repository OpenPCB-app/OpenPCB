import { useMemo, type ReactElement } from "react";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import {
  GUIDE_COLORS,
  isRayGuide,
  type RouteGuide,
} from "../guides/guide-types";
import { GuideLineSegments, type GuideSegment } from "./GuideLines";

/**
 * Renders routing assist guides: cyan angle/extend rays from the live anchor
 * and yellow collinear-pad lines. Same thin dashed 1px style as the placement
 * guides, drawn just above geometry (below the snap crosshair). Mounted inside
 * PcbScene's mirror group so it tracks the board in bottom-view.
 */
const RAY_HALF_LEN_MM = 500; // rays span well past any board
const OVERSHOOT_MM = 1.5;
const RENDER_ORDER_ROUTE = RENDER_ORDER.SELECTION + 0.6;

export function RoutingGuideLayer({
  guides,
}: {
  guides: readonly RouteGuide[];
}): ReactElement | null {
  const segments = useMemo<GuideSegment[]>(() => {
    return guides.map((g) => {
      if (isRayGuide(g)) {
        return {
          x1: g.originMm.x - g.dirMm.x * RAY_HALF_LEN_MM,
          y1: g.originMm.y - g.dirMm.y * RAY_HALF_LEN_MM,
          x2: g.originMm.x + g.dirMm.x * RAY_HALF_LEN_MM,
          y2: g.originMm.y + g.dirMm.y * RAY_HALF_LEN_MM,
          color: GUIDE_COLORS.ray,
        };
      }
      const lo = g.spanMinMm - OVERSHOOT_MM;
      const hi = g.spanMaxMm + OVERSHOOT_MM;
      return g.axis === "x"
        ? {
            x1: g.coordMm,
            y1: lo,
            x2: g.coordMm,
            y2: hi,
            color: GUIDE_COLORS.pad,
          }
        : {
            x1: lo,
            y1: g.coordMm,
            x2: hi,
            y2: g.coordMm,
            color: GUIDE_COLORS.pad,
          };
    });
  }, [guides]);

  if (segments.length === 0) return null;

  return (
    <GuideLineSegments segments={segments} renderOrder={RENDER_ORDER_ROUTE} />
  );
}
