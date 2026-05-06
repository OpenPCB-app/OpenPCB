import { useMemo } from "react";
import * as THREE from "three";
import { EDAText, PinDots } from "../primitives";
import type { SymbolRenderModel } from "../../../rendering";
import { RENDER_ORDER } from "../layers";
import { useCanvasTheme } from "../theme";
import { graphicStrokeSegments } from "../preview/geometry";

export function SymbolRenderLayer({ model }: { model: SymbolRenderModel }) {
  const { theme } = useCanvasTheme();
  const pt = theme.preview;

  const strokePositions = useMemo(() => {
    const values: number[] = [];
    for (const graphic of model.graphics) {
      const segments = graphicStrokeSegments(graphic);
      for (const segment of segments) {
        values.push(segment[0], segment[1], 0, segment[2], segment[3], 0);
      }
    }
    for (const pin of model.pins) {
      values.push(pin.anchor.x, pin.anchor.y, 0, pin.bodyEnd.x, pin.bodyEnd.y, 0);
    }
    return new Float32Array(values);
  }, [model.graphics, model.pins]);

  const fillShapes = useMemo(() => {
    const shapes: THREE.Shape[] = [];
    for (const graphic of model.graphics) {
      if (graphic.kind === "rect" && graphic.fill === "solid") {
        const shape = new THREE.Shape();
        shape.moveTo(graphic.x, graphic.y);
        shape.lineTo(graphic.x + graphic.width, graphic.y);
        shape.lineTo(graphic.x + graphic.width, graphic.y + graphic.height);
        shape.lineTo(graphic.x, graphic.y + graphic.height);
        shape.closePath();
        shapes.push(shape);
      }
      if (graphic.kind === "circle" && graphic.fill === "solid") {
        const shape = new THREE.Shape();
        shape.absarc(graphic.center.x, graphic.center.y, graphic.radiusMm, 0, Math.PI * 2);
        shapes.push(shape);
      }
      if (
        graphic.kind === "polyline" &&
        graphic.fill === "solid" &&
        graphic.closed &&
        graphic.points.length >= 3
      ) {
        const first = graphic.points[0];
        if (!first) {
          continue;
        }
        const shape = new THREE.Shape();
        shape.moveTo(first.x, first.y);
        for (let index = 1; index < graphic.points.length; index += 1) {
          const point = graphic.points[index];
          if (!point) {
            continue;
          }
          shape.lineTo(point.x, point.y);
        }
        shape.closePath();
        shapes.push(shape);
      }
    }
    return shapes;
  }, [model.graphics]);

  const pinDots = useMemo(
    () =>
      model.pins.map((pin) => ({
        id: pin.id,
        x: pin.anchor.x,
        y: pin.anchor.y,
        connected: false,
      })),
    [model.pins],
  );

  return (
    <>
      {fillShapes.length > 0 && (
        <mesh renderOrder={RENDER_ORDER.BODIES}>
          <shapeGeometry args={[fillShapes] as [THREE.Shape[]]} />
          <meshBasicMaterial
            color={pt.symbolFill}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {strokePositions.length > 0 && (
        <lineSegments renderOrder={RENDER_ORDER.BODIES + 0.1}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[strokePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial
            color={pt.symbolStroke}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      )}

      <PinDots
        pins={pinDots}
        radius={0.1}
        defaultColor={pt.symbolPinDot}
      />

      {model.labels.map((label) => {
        const color =
          label.role === "pin-number"
            ? pt.symbolPinNumber
            : label.role === "reference"
              ? pt.symbolRefLabel
              : label.role === "value"
                ? pt.symbolValueLabel
                : pt.symbolPinLabel;
        const rotation =
          label.rotationDeg === 0
            ? undefined
            : ([0, 0, (label.rotationDeg * Math.PI) / 180] as [number, number, number]);

        const isLight = theme.mode === "light";
        const outlineWidth = isLight ? 0.025 : undefined;
        const outlineColor = isLight ? "#f5f5f0" : undefined;

        return (
          <EDAText
            key={label.id}
            position={[label.at.x, label.at.y, 0]}
            color={color}
            fontSize={label.fontSizeMm}
            anchorX={label.anchorX}
            anchorY={label.anchorY}
            rotation={rotation}
            outlineWidth={outlineWidth}
            outlineColor={outlineColor}
          >
            {label.text}
          </EDAText>
        );
      })}
    </>
  );
}
