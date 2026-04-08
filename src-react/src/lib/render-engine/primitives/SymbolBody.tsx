import { useMemo } from "react";
import * as THREE from "three";
import type {
  SymbolGraphic,
  RectGraphic,
  CircleGraphic,
  PolygonGraphic,
} from "../symbol-graphics";
import { degreesToRadians } from "../coords";
import { RENDER_ORDER } from "../layers";

// ---------------------------------------------------------------------------
// Geometry Cache (global, keyed by symbol kind)
// ---------------------------------------------------------------------------

const geometryCache = new Map<
  string,
  { fills: THREE.BufferGeometry; strokes: THREE.BufferGeometry }
>();

export function clearGeometryCache(): void {
  for (const entry of geometryCache.values()) {
    entry.fills.dispose();
    entry.strokes.dispose();
  }
  geometryCache.clear();
}

// ---------------------------------------------------------------------------
// Graphic → Three.js Shape Converters
// ---------------------------------------------------------------------------

function buildRectShape(g: RectGraphic): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(g.x, g.y);
  shape.lineTo(g.x + g.width, g.y);
  shape.lineTo(g.x + g.width, g.y + g.height);
  shape.lineTo(g.x, g.y + g.height);
  shape.closePath();
  return shape;
}

function buildCircleShape(g: CircleGraphic): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(g.cx, g.cy, g.radius, 0, Math.PI * 2, false);
  return shape;
}

function buildPolygonShape(g: PolygonGraphic): THREE.Shape {
  if (g.points.length < 2) return new THREE.Shape();
  const first = g.points[0];
  if (!first) return new THREE.Shape();
  const shape = new THREE.Shape();
  shape.moveTo(first.x, first.y);
  for (let i = 1; i < g.points.length; i++) {
    const pt = g.points[i];
    if (!pt) continue;
    shape.lineTo(pt.x, pt.y);
  }
  if (g.closed) shape.closePath();
  return shape;
}

// ---------------------------------------------------------------------------
// Build stroke vertices from graphics
// ---------------------------------------------------------------------------

function collectStrokeVertices(graphics: SymbolGraphic[]): Float32Array {
  const vertices: number[] = [];

  for (const g of graphics) {
    switch (g.type) {
      case "line":
        vertices.push(g.x1, g.y1, 0, g.x2, g.y2, 0);
        break;

      case "rect":
        // Four edges
        vertices.push(g.x, g.y, 0, g.x + g.width, g.y, 0);
        vertices.push(g.x + g.width, g.y, 0, g.x + g.width, g.y + g.height, 0);
        vertices.push(g.x + g.width, g.y + g.height, 0, g.x, g.y + g.height, 0);
        vertices.push(g.x, g.y + g.height, 0, g.x, g.y, 0);
        break;

      case "circle": {
        const segments = 32;
        for (let i = 0; i < segments; i++) {
          const a1 = (i / segments) * Math.PI * 2;
          const a2 = ((i + 1) / segments) * Math.PI * 2;
          vertices.push(
            g.cx + Math.cos(a1) * g.radius,
            g.cy + Math.sin(a1) * g.radius,
            0,
            g.cx + Math.cos(a2) * g.radius,
            g.cy + Math.sin(a2) * g.radius,
            0,
          );
        }
        break;
      }

      case "arc": {
        const startRad = degreesToRadians(g.startAngle);
        const endRad = degreesToRadians(g.endAngle);
        const segments = 24;
        const sweep = endRad - startRad;
        for (let i = 0; i < segments; i++) {
          const a1 = startRad + (i / segments) * sweep;
          const a2 = startRad + ((i + 1) / segments) * sweep;
          vertices.push(
            g.cx + Math.cos(a1) * g.radius,
            g.cy + Math.sin(a1) * g.radius,
            0,
            g.cx + Math.cos(a2) * g.radius,
            g.cy + Math.sin(a2) * g.radius,
            0,
          );
        }
        break;
      }

      case "polygon": {
        for (let i = 0; i < g.points.length - 1; i++) {
          const cur = g.points[i];
          const next = g.points[i + 1];
          if (!cur || !next) continue;
          vertices.push(cur.x, cur.y, 0);
          vertices.push(next.x, next.y, 0);
        }
        if (g.closed && g.points.length > 2) {
          const last = g.points[g.points.length - 1];
          const first = g.points[0];
          if (last && first) {
            vertices.push(last.x, last.y, 0, first.x, first.y, 0);
          }
        }
        break;
      }

      case "bezier": {
        const segments = 20;
        const [p0, p1, p2, p3] = g.points;
        for (let i = 0; i < segments; i++) {
          const t1 = i / segments;
          const t2 = (i + 1) / segments;
          const x1 = cubicBezier(t1, p0.x, p1.x, p2.x, p3.x);
          const y1 = cubicBezier(t1, p0.y, p1.y, p2.y, p3.y);
          const x2 = cubicBezier(t2, p0.x, p1.x, p2.x, p3.x);
          const y2 = cubicBezier(t2, p0.y, p1.y, p2.y, p3.y);
          vertices.push(x1, y1, 0, x2, y2, 0);
        }
        break;
      }

      case "text":
        // Text is rendered separately via EDAText
        break;
    }
  }

  return new Float32Array(vertices);
}

function cubicBezier(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number {
  const u = 1 - t;
  return (
    u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
  );
}

// ---------------------------------------------------------------------------
// Build fill geometries from graphics
// ---------------------------------------------------------------------------

function collectFillGeometries(
  graphics: SymbolGraphic[],
): THREE.BufferGeometry {
  const shapes: THREE.Shape[] = [];

  for (const g of graphics) {
    switch (g.type) {
      case "rect":
        if (g.filled) shapes.push(buildRectShape(g));
        break;
      case "circle":
        if (g.filled) shapes.push(buildCircleShape(g));
        break;
      case "polygon":
        if (g.filled && g.points.length >= 3) shapes.push(buildPolygonShape(g));
        break;
    }
  }

  if (shapes.length === 0) return new THREE.BufferGeometry();
  if (shapes.length === 1) return new THREE.ShapeGeometry(shapes[0]);

  // Merge multiple shapes into one geometry
  return new THREE.ShapeGeometry(shapes);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SymbolBodyProps {
  /** Unique key for geometry caching (e.g., component kind) */
  cacheKey?: string;
  /** Graphics to render */
  graphics: SymbolGraphic[];
  /** Stroke color */
  strokeColor?: string;
  /** Fill color */
  fillColor?: string;
  /** Whether this symbol is selected */
  selected?: boolean;
  /** Selection highlight color */
  selectionColor?: string;
  /** Opacity (for preview ghosts) */
  opacity?: number;
}

export function SymbolBody({
  cacheKey,
  graphics,
  strokeColor = "#94a3b8",
  fillColor = "#1e293b",
  selected = false,
  selectionColor = "#38bdf8",
  opacity = 1,
}: SymbolBodyProps) {
  const { fills, strokes } = useMemo(() => {
    // Check cache
    if (cacheKey && geometryCache.has(cacheKey)) {
      return geometryCache.get(cacheKey)!;
    }

    const fillGeom = collectFillGeometries(graphics);
    const strokePositions = collectStrokeVertices(graphics);
    const strokeGeom = new THREE.BufferGeometry();
    strokeGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(strokePositions, 3),
    );

    const result = { fills: fillGeom, strokes: strokeGeom };

    if (cacheKey) {
      geometryCache.set(cacheKey, result);
    }

    return result;
  }, [cacheKey, graphics]);

  const effectiveStroke = selected ? selectionColor : strokeColor;

  return (
    <group renderOrder={RENDER_ORDER.BODIES}>
      {/* Filled shapes */}
      {fills.attributes.position &&
        (fills.attributes.position as THREE.BufferAttribute).count > 0 && (
          <mesh geometry={fills} renderOrder={RENDER_ORDER.BODIES}>
            <meshBasicMaterial
              color={fillColor}
              transparent={opacity < 1}
              opacity={opacity}
              depthTest={false}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        )}

      {/* Stroke outlines */}
      {(strokes.attributes.position as THREE.BufferAttribute).count > 0 && (
        <lineSegments
          geometry={strokes}
          renderOrder={RENDER_ORDER.BODIES + 0.1}
        >
          <lineBasicMaterial
            color={effectiveStroke}
            transparent={opacity < 1}
            opacity={opacity}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      )}
    </group>
  );
}
