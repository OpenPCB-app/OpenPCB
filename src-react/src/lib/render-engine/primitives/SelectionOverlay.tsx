/**
 * SelectionOverlay — Renders dashed selection rectangles around selected entities.
 *
 * Also renders rubber-band selection rectangle during drag-select.
 */

import { useMemo } from "react";
import * as THREE from "three";
import { RENDER_ORDER } from "../layers";
import type { Bounds } from "../coords";

// ---------------------------------------------------------------------------
// Selection Boxes
// ---------------------------------------------------------------------------

interface SelectionBoxData {
  entityId: string;
  bounds: Bounds;
}

interface SelectionOverlayProps {
  /** Bounds of selected entities */
  selections: readonly SelectionBoxData[];
  /** Stroke color for selection rectangles */
  strokeColor?: string;
  /** Padding around selection bounds in nm */
  padding?: number;
}

export function SelectionOverlay({
  selections,
  strokeColor = "#38bdf8",
  padding = 150_000,
}: SelectionOverlayProps) {
  // Build merged geometry for all selection boxes
  const { fillGeom, strokePositions } = useMemo(() => {
    const shapes: THREE.Shape[] = [];
    const verts: number[] = [];

    for (const sel of selections) {
      const { minX, minY, maxX, maxY } = sel.bounds;
      const x1 = minX - padding;
      const y1 = minY - padding;
      const x2 = maxX + padding;
      const y2 = maxY + padding;

      // Fill shape
      const shape = new THREE.Shape();
      shape.moveTo(x1, y1);
      shape.lineTo(x2, y1);
      shape.lineTo(x2, y2);
      shape.lineTo(x1, y2);
      shape.closePath();
      shapes.push(shape);

      // Stroke edges
      verts.push(x1, y1, 0, x2, y1, 0);
      verts.push(x2, y1, 0, x2, y2, 0);
      verts.push(x2, y2, 0, x1, y2, 0);
      verts.push(x1, y2, 0, x1, y1, 0);
    }

    return {
      fillGeom: shapes.length > 0 ? new THREE.ShapeGeometry(shapes) : null,
      strokePositions: new Float32Array(verts),
    };
  }, [selections, padding]);

  // Parse fill color (must be before early return — Rules of Hooks)
  const fillColorObj = useMemo(() => {
    return { color: strokeColor, opacity: 0.12 };
  }, [strokeColor]);

  if (selections.length === 0) return null;

  return (
    <group>
      {/* Semi-transparent fill */}
      {fillGeom && (
        <mesh geometry={fillGeom} renderOrder={RENDER_ORDER.SELECTION}>
          <meshBasicMaterial
            color={fillColorObj.color}
            transparent
            opacity={fillColorObj.opacity}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Dashed stroke */}
      {strokePositions.length > 0 && (
        <lineSegments renderOrder={RENDER_ORDER.SELECTION + 0.1}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[strokePositions, 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial
            color={strokeColor}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Rubber Band (drag-to-select rectangle)
// ---------------------------------------------------------------------------

interface RubberBandProps {
  /** Start corner in world coordinates */
  start: { x: number; y: number } | null;
  /** End corner in world coordinates */
  end: { x: number; y: number } | null;
  color?: string;
}

export function RubberBand({ start, end, color = "#38bdf8" }: RubberBandProps) {
  if (!start || !end) return null;

  const x1 = Math.min(start.x, end.x);
  const y1 = Math.min(start.y, end.y);
  const x2 = Math.max(start.x, end.x);
  const y2 = Math.max(start.y, end.y);

  const positions = useMemo(
    () =>
      new Float32Array([
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
      ]),
    [x1, y1, x2, y2],
  );

  return (
    <group>
      {/* Fill */}
      <mesh renderOrder={RENDER_ORDER.SELECTION}>
        <planeGeometry args={[x2 - x1, y2 - y1]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.08}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Stroke */}
      <lineSegments renderOrder={RENDER_ORDER.SELECTION + 0.1}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineDashedMaterial
          color={color}
          dashSize={100_000}
          gapSize={80_000}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}
