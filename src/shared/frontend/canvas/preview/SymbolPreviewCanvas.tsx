import { useMemo } from "react";
import * as THREE from "three";
import { EDAText, PinDots } from "../primitives";
import type { SymbolPreviewModel } from "../../../rendering";
import { RENDER_ORDER } from "../layers";
import { DEFAULT_PREVIEW_THEME } from "./preview-theme";
import type { SymbolPreviewCanvasProps } from "./types";
import { graphicStrokeSegments } from "./geometry";
import { PreviewCanvasShell } from "./PreviewCanvasShell";

function SymbolGeometryLayer({ model }: { model: SymbolPreviewModel }) {
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
            color={DEFAULT_PREVIEW_THEME.symbolFill}
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
            color={DEFAULT_PREVIEW_THEME.symbolStroke}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      )}

      <PinDots
        pins={pinDots}
        radius={0.1}
        defaultColor={DEFAULT_PREVIEW_THEME.symbolPinDot}
      />

      {model.labels.map((label) => {
        const color =
          label.role === "pin-number"
            ? DEFAULT_PREVIEW_THEME.symbolPinNumber
            : label.role === "reference"
              ? DEFAULT_PREVIEW_THEME.symbolRefLabel
              : label.role === "value"
                ? DEFAULT_PREVIEW_THEME.symbolValueLabel
                : DEFAULT_PREVIEW_THEME.symbolPinLabel;
        const rotation =
          label.rotationDeg === 0
            ? undefined
            : [0, 0, (label.rotationDeg * Math.PI) / 180] as [number, number, number];

        return (
          <EDAText
            key={label.id}
            position={[label.at.x, label.at.y, 0]}
            color={color}
            fontSize={label.fontSizeMm}
            anchorX={label.anchorX}
            anchorY={label.anchorY}
            rotation={rotation}
          >
            {label.text}
          </EDAText>
        );
      })}
    </>
  );
}

export function SymbolPreviewCanvas({
  model,
  className,
  style,
  backgroundColor = "#0f172a",
  showGrid = true,
  fitPaddingPx = 24,
  minSpanMm = 2,
  initialZoom = 40,
}: SymbolPreviewCanvasProps) {
  return (
    <PreviewCanvasShell
      hasModel={model !== null}
      bounds={model?.bounds ?? null}
      emptyMessage="No symbol preview"
      gridSize={1}
      className={className}
      style={style}
      backgroundColor={backgroundColor}
      showGrid={showGrid}
      fitPaddingPx={fitPaddingPx}
      minSpanMm={minSpanMm}
      initialZoom={initialZoom}
    >
      {model ? <SymbolGeometryLayer model={model} /> : null}
    </PreviewCanvasShell>
  );
}
