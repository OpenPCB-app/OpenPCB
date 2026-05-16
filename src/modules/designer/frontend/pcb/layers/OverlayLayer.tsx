import { type ReactElement, useEffect, useMemo } from "react";
import * as THREE from "three";
import type {
  PcbOverlayLayer,
  PcbOverlayShape,
  PcbOverlayText,
} from "../../../../../sdks";
import {
  PCB_LAYER_COLORS,
  RENDER_ORDER,
  effectiveRenderOrder,
} from "../../../../../shared/frontend/canvas/layers";
import { EDAText } from "../../../../../shared/frontend/canvas/primitives/EDAText";

interface OverlayLayerProps {
  texts: ReadonlyArray<PcbOverlayText>;
  shapes: ReadonlyArray<PcbOverlayShape>;
  viewSide: "top" | "bottom";
  opacity?: number;
}

const SUPPORTED_LAYERS: ReadonlyArray<PcbOverlayLayer> = [
  "F.SilkS",
  "B.SilkS",
  "F.Fab",
  "B.Fab",
  "F.CrtYd",
  "B.CrtYd",
  "Edge.Cuts",
];

/**
 * OverlayLayer — renders free-standing silkscreen / fab text and shape
 * primitives. One mesh per shape; text routes through `EDAText` (troika).
 * Each entity carries its own `layer` so the renderOrder is resolved per
 * entity via `effectiveRenderOrder(layer, viewSide, "object")`.
 */
export function OverlayLayer({
  texts,
  shapes,
  viewSide,
  opacity = 1,
}: OverlayLayerProps): ReactElement | null {
  if (texts.length === 0 && shapes.length === 0) return null;
  return (
    <>
      {shapes.map((shape) => (
        <OverlayShapeMesh
          key={shape.id}
          shape={shape}
          viewSide={viewSide}
          opacity={opacity}
        />
      ))}
      {texts.map((text) => (
        <OverlayTextMesh
          key={text.id}
          overlay={text}
          viewSide={viewSide}
          opacity={opacity}
        />
      ))}
    </>
  );
}

function anchorXFor(
  justify: PcbOverlayText["justify"],
): "left" | "center" | "right" {
  return justify;
}

function OverlayTextMesh({
  overlay,
  viewSide,
  opacity,
}: {
  overlay: PcbOverlayText;
  viewSide: "top" | "bottom";
  opacity: number;
}): ReactElement | null {
  if (!SUPPORTED_LAYERS.includes(overlay.layer)) return null;
  const color = PCB_LAYER_COLORS[overlay.layer];
  const renderOrder =
    overlay.layer === "Edge.Cuts"
      ? RENDER_ORDER.EDGE_CUTS
      : effectiveRenderOrder(overlay.layer, viewSide, "object");
  const rotZ = (overlay.rotationDeg * Math.PI) / 180;
  // OverlayLayer renders inside the scene's mirror group (scale [-1,1,1] in
  // bottom view), so text would otherwise display backwards. Wrap each text
  // in a counter-mirroring group when viewSide is "bottom" so labels stay
  // readable — same convention `NetTraceLabels` uses. The user-set
  // `overlay.mirror` flag composes on top.
  const sceneCounter = viewSide === "bottom" ? -1 : 1;
  const userMirror = overlay.mirror ? -1 : 1;
  const scaleX = sceneCounter * userMirror;
  return (
    <group
      position={[overlay.positionMm.x, overlay.positionMm.y, 0]}
      scale={[scaleX, 1, 1]}
    >
      <EDAText
        position={[0, 0, 0]}
        color={color}
        fontSize={overlay.fontSizeMm}
        rotation={[0, 0, rotZ]}
        anchorX={anchorXFor(overlay.justify)}
        anchorY="middle"
        opacity={opacity}
        renderOrder={renderOrder}
      >
        {overlay.text}
      </EDAText>
    </group>
  );
}

function OverlayShapeMesh({
  shape,
  viewSide,
  opacity,
}: {
  shape: PcbOverlayShape;
  viewSide: "top" | "bottom";
  opacity: number;
}): ReactElement | null {
  if (!SUPPORTED_LAYERS.includes(shape.layer)) return null;
  const color = PCB_LAYER_COLORS[shape.layer];
  const renderOrder =
    shape.layer === "Edge.Cuts"
      ? RENDER_ORDER.EDGE_CUTS
      : effectiveRenderOrder(shape.layer, viewSide, "object");

  // Build vertices in world-mm for stroke geometry. `line` and `polyline`
  // share the same path. `polygon` closes back to the first point. `rect`
  // and `circle` expand their 2-point representation to a closed loop.
  const segments = useMemo<Float32Array | null>(() => {
    const pts = pointsForRender(shape);
    if (!pts || pts.length < 2) return null;
    const out: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      out.push(pts[i]!.x, pts[i]!.y, 0, pts[i + 1]!.x, pts[i + 1]!.y, 0);
    }
    return new Float32Array(out);
  }, [shape]);

  const lineGeom = useMemo<THREE.BufferGeometry | null>(() => {
    if (!segments) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(segments, 3));
    return g;
  }, [segments]);

  const fillGeom = useMemo<THREE.BufferGeometry | null>(() => {
    if (shape.fill !== "solid") return null;
    const pts = pointsForRender(shape);
    if (!pts || pts.length < 3) return null;
    const path = new THREE.Shape();
    path.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) {
      path.lineTo(pts[i]!.x, pts[i]!.y);
    }
    return new THREE.ShapeGeometry(path);
  }, [shape]);

  useEffect(
    () => () => {
      lineGeom?.dispose();
      fillGeom?.dispose();
    },
    [lineGeom, fillGeom],
  );

  if (!lineGeom) return null;
  return (
    <>
      {fillGeom ? (
        <mesh geometry={fillGeom} renderOrder={renderOrder - 0.05}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={opacity * 0.35}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}
      <lineSegments geometry={lineGeom} renderOrder={renderOrder}>
        <lineBasicMaterial
          color={color}
          transparent={opacity < 1}
          opacity={opacity}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
    </>
  );
}

/**
 * Expand the stored `pointsMm` into a polyline ready for line-segment + fill
 * geometry. Closed shapes (`rect`, `circle`, `polygon`) loop back to the
 * first point.
 */
function pointsForRender(
  shape: PcbOverlayShape,
): Array<{ x: number; y: number }> | null {
  const p = shape.pointsMm;
  if (p.length < 2) return null;
  switch (shape.kind) {
    case "line":
      return [p[0]!, p[1]!];
    case "polyline":
      return [...p];
    case "polygon": {
      const out = [...p];
      if (
        out[0]!.x !== out[out.length - 1]!.x ||
        out[0]!.y !== out[out.length - 1]!.y
      ) {
        out.push(out[0]!);
      }
      return out;
    }
    case "rect": {
      const a = p[0]!;
      const b = p[1]!;
      return [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: a.x, y: b.y },
        { x: a.x, y: a.y },
      ];
    }
    case "circle": {
      const center = p[0]!;
      const edge = p[1]!;
      const dx = edge.x - center.x;
      const dy = edge.y - center.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      if (radius <= 0) return null;
      const out: Array<{ x: number; y: number }> = [];
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        out.push({
          x: center.x + Math.cos(a) * radius,
          y: center.y + Math.sin(a) * radius,
        });
      }
      return out;
    }
  }
}
