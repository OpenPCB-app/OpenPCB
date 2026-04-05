/**
 * WireLines — Renders schematic wires as triangulated quads (Manhattan style).
 *
 * Each wire segment (horizontal or vertical) is expanded into a rectangle
 * made of 2 triangles. At 90° corners, a square patch fills the join.
 * This gives reliable thick lines with clean corners on all GPUs,
 * no addon dependency, and is WebGPU-ready.
 *
 * Wire width is specified in nanometers (world units) and scales with zoom.
 */

import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RENDER_ORDER } from "../layers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WireData {
  id: string;
  points: readonly { x: number; y: number }[];
  selected?: boolean;
}

interface WireLinesProps {
  wires: readonly WireData[];
  defaultColor?: string;
  selectedColor?: string;
  previewColor?: string;
  /** Preview wire points (wire currently being drawn) */
  previewPoints?: readonly { x: number; y: number }[] | null;
  /** Wire stroke width in nanometers. Default 50_000 (0.05mm → ~2.5px at zoom 50). */
  wireWidth?: number;
}

// Default wire width: 0.05mm in nm (at default camera zoom 50, this is ~2.5px)
const DEFAULT_WIRE_WIDTH = 50_000;

// ---------------------------------------------------------------------------
// Triangulation: Manhattan segments → triangle vertices
// ---------------------------------------------------------------------------

/**
 * Triangulate a Manhattan polyline into thick quads with square corner patches.
 *
 * For each horizontal segment: expand vertically by ±halfWidth.
 * For each vertical segment: expand horizontally by ±halfWidth.
 * At each corner: insert a square patch centered on the bend point.
 *
 * Returns flat Float32Array of [x, y, z, x, y, z, ...] triangle vertices.
 */
function triangulateManhattanPath(
  points: readonly { x: number; y: number }[],
  halfWidth: number,
): Float32Array {
  if (points.length < 2) return new Float32Array(0);

  const verts: number[] = [];
  verts.length = 0; // hint

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;

    if (a.y === b.y) {
      // Horizontal segment
      const y1 = a.y - halfWidth;
      const y2 = a.y + halfWidth;
      const x1 = Math.min(a.x, b.x);
      const x2 = Math.max(a.x, b.x);
      // Triangle 1: top-left, top-right, bottom-left
      verts.push(x1, y2, 0, x2, y2, 0, x1, y1, 0);
      // Triangle 2: bottom-left, top-right, bottom-right
      verts.push(x1, y1, 0, x2, y2, 0, x2, y1, 0);
    } else if (a.x === b.x) {
      // Vertical segment
      const x1 = a.x - halfWidth;
      const x2 = a.x + halfWidth;
      const y1 = Math.min(a.y, b.y);
      const y2 = Math.max(a.y, b.y);
      // Triangle 1
      verts.push(x1, y2, 0, x2, y2, 0, x1, y1, 0);
      // Triangle 2
      verts.push(x1, y1, 0, x2, y2, 0, x2, y1, 0);
    } else {
      // Diagonal fallback — expand perpendicular to direction
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const nx = (-dy / len) * halfWidth;
      const ny = (dx / len) * halfWidth;
      verts.push(
        a.x + nx,
        a.y + ny,
        0,
        b.x + nx,
        b.y + ny,
        0,
        a.x - nx,
        a.y - ny,
        0,
        a.x - nx,
        a.y - ny,
        0,
        b.x + nx,
        b.y + ny,
        0,
        b.x - nx,
        b.y - ny,
        0,
      );
    }

    // Corner patch at each bend point (square centered on the point)
    if (i < points.length - 2) {
      const corner = b;
      const cx1 = corner.x - halfWidth;
      const cx2 = corner.x + halfWidth;
      const cy1 = corner.y - halfWidth;
      const cy2 = corner.y + halfWidth;
      verts.push(cx1, cy2, 0, cx2, cy2, 0, cx1, cy1, 0);
      verts.push(cx1, cy1, 0, cx2, cy2, 0, cx2, cy1, 0);
    }
  }

  return new Float32Array(verts);
}

/**
 * Triangulate multiple wires into a single vertex buffer.
 */
function triangulateWires(
  wires: readonly WireData[],
  halfWidth: number,
): Float32Array {
  const allVerts: Float32Array[] = [];
  let totalLength = 0;

  for (const wire of wires) {
    const verts = triangulateManhattanPath(wire.points, halfWidth);
    if (verts.length > 0) {
      allVerts.push(verts);
      totalLength += verts.length;
    }
  }

  if (totalLength === 0) return new Float32Array(0);
  if (allVerts.length === 1) return allVerts[0]!;

  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const v of allVerts) {
    merged.set(v, offset);
    offset += v.length;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WireLines({
  wires,
  defaultColor = "#cbd5e1",
  selectedColor = "#e0f2fe",
  previewColor = "#38bdf8",
  previewPoints = null,
  wireWidth = DEFAULT_WIRE_WIDTH,
}: WireLinesProps) {
  const invalidate = useThree((s) => s.invalidate);
  const halfWidth = wireWidth / 2;

  // Split wires into default and selected
  const groups = useMemo(() => {
    const def: WireData[] = [];
    const sel: WireData[] = [];
    for (const wire of wires) {
      if (wire.selected) sel.push(wire);
      else def.push(wire);
    }
    return { default: def, selected: sel };
  }, [wires]);

  return (
    <group>
      <WireMeshGroup
        wires={groups.default}
        halfWidth={halfWidth}
        color={defaultColor}
        renderOrder={RENDER_ORDER.WIRES}
        invalidate={invalidate}
      />
      <WireMeshGroup
        wires={groups.selected}
        halfWidth={halfWidth}
        color={selectedColor}
        renderOrder={RENDER_ORDER.WIRES + 0.1}
        invalidate={invalidate}
      />
      {previewPoints && previewPoints.length >= 2 && (
        <WireMeshGroup
          wires={[{ id: "__preview", points: previewPoints }]}
          halfWidth={halfWidth}
          color={previewColor}
          renderOrder={RENDER_ORDER.PREVIEW}
          invalidate={invalidate}
          opacity={0.9}
        />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// WireMeshGroup — renders triangulated wire geometry
// ---------------------------------------------------------------------------

interface WireMeshGroupProps {
  wires: readonly WireData[];
  halfWidth: number;
  color: string;
  renderOrder: number;
  invalidate: () => void;
  opacity?: number;
}

function WireMeshGroup({
  wires,
  halfWidth,
  color,
  renderOrder,
  invalidate,
  opacity = 1,
}: WireMeshGroupProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geomRef = useRef<THREE.BufferGeometry>(null);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        transparent: opacity < 1,
        opacity,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Update material properties reactively
  useEffect(() => {
    material.color.set(color);
    material.opacity = opacity;
    material.transparent = opacity < 1;
  }, [material, color, opacity]);

  // Triangulate wires and update geometry
  useEffect(() => {
    const geom = geomRef.current;
    if (!geom) return;

    const vertices = triangulateWires(wires, halfWidth);

    if (vertices.length === 0) {
      geom.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(0), 3),
      );
      geom.setDrawRange(0, 0);
      if (meshRef.current) meshRef.current.visible = false;
      invalidate();
      return;
    }

    geom.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geom.setDrawRange(0, vertices.length / 3);
    geom.computeBoundingSphere();

    if (meshRef.current) meshRef.current.visible = true;
    invalidate();
  }, [wires, halfWidth, invalidate]);

  if (wires.length === 0) return null;

  return (
    <mesh
      ref={meshRef}
      renderOrder={renderOrder}
      frustumCulled={false}
      material={material}
    >
      <bufferGeometry ref={geomRef} />
    </mesh>
  );
}
