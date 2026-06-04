import { useMemo, type ReactElement } from "react";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import type {
  EditorGraphicElement,
  EditorLabelElement,
  EditorPinElement,
} from "./types";

const SELECTION_COLOR = "#f472b6"; // pink-400
const SELECTION_PADDING = 0.3;

/**
 * Renders selection highlights around selected graphics and pins.
 */
export function SelectionOverlay({
  selectedIds,
  graphics,
  pins,
  labels,
  color = SELECTION_COLOR,
  opacity = 0.7,
}: {
  selectedIds: Set<string>;
  graphics: readonly EditorGraphicElement[];
  pins: readonly EditorPinElement[];
  labels: readonly EditorLabelElement[];
  color?: string;
  opacity?: number;
}): ReactElement | null {
  const positions = useMemo(() => {
    if (selectedIds.size === 0) return null;

    const segments: number[] = [];

    for (const element of graphics) {
      if (!selectedIds.has(element.id)) continue;
      const g = element.graphic;

      if (g.kind === "rect") {
        const p = SELECTION_PADDING;
        const x1 = g.x - p;
        const y1 = g.y - p;
        const x2 = g.x + g.width + p;
        const y2 = g.y + g.height + p;
        segments.push(
          x1,
          y1,
          0,
          x2,
          y1,
          0,
          x2,
          y1,
          0,
          x2,
          y2,
          0,
          x2,
          y2,
          0,
          x1,
          y2,
          0,
          x1,
          y2,
          0,
          x1,
          y1,
          0,
        );
      } else if (g.kind === "line") {
        // Highlight line with parallel offset lines
        const dx = g.b.x - g.a.x;
        const dy = g.b.y - g.a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const nx = (-dy / len) * SELECTION_PADDING;
          const ny = (dx / len) * SELECTION_PADDING;
          segments.push(
            g.a.x + nx,
            g.a.y + ny,
            0,
            g.b.x + nx,
            g.b.y + ny,
            0,
            g.a.x - nx,
            g.a.y - ny,
            0,
            g.b.x - nx,
            g.b.y - ny,
            0,
          );
        }
      } else if (g.kind === "circle") {
        const r = g.radiusMm + SELECTION_PADDING;
        const segs = 24;
        for (let i = 0; i < segs; i++) {
          const a1 = (i / segs) * Math.PI * 2;
          const a2 = ((i + 1) / segs) * Math.PI * 2;
          segments.push(
            g.center.x + Math.cos(a1) * r,
            g.center.y + Math.sin(a1) * r,
            0,
            g.center.x + Math.cos(a2) * r,
            g.center.y + Math.sin(a2) * r,
            0,
          );
        }
      }
    }

    for (const pin of pins) {
      if (!selectedIds.has(pin.id)) continue;
      const p = SELECTION_PADDING;
      const cx = pin.positionMm.x;
      const cy = pin.positionMm.y;
      // Draw diamond around pin
      segments.push(
        cx - p,
        cy,
        0,
        cx,
        cy + p,
        0,
        cx,
        cy + p,
        0,
        cx + p,
        cy,
        0,
        cx + p,
        cy,
        0,
        cx,
        cy - p,
        0,
        cx,
        cy - p,
        0,
        cx - p,
        cy,
        0,
      );
    }

    for (const element of labels) {
      if (!selectedIds.has(element.id)) continue;
      const l = element.label;
      const halfText = Math.max(l.text.length * l.fontSizeMm * 0.31, 0.3);
      const halfHeight = Math.max(l.fontSizeMm * 0.6, 0.3);
      const x1 = l.at.x - halfText - SELECTION_PADDING;
      const y1 = l.at.y - halfHeight - SELECTION_PADDING;
      const x2 = l.at.x + halfText + SELECTION_PADDING;
      const y2 = l.at.y + halfHeight + SELECTION_PADDING;
      segments.push(
        x1,
        y1,
        0,
        x2,
        y1,
        0,
        x2,
        y1,
        0,
        x2,
        y2,
        0,
        x2,
        y2,
        0,
        x1,
        y2,
        0,
        x1,
        y2,
        0,
        x1,
        y1,
        0,
      );
    }

    if (segments.length === 0) return null;
    return new Float32Array(segments);
  }, [selectedIds, graphics, pins, labels]);

  if (!positions) return null;

  return (
    <lineSegments renderOrder={RENDER_ORDER.SELECTION} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={opacity}
      />
    </lineSegments>
  );
}
