import { useMemo } from "react";
import * as THREE from "three";
import { EDAText, PinDots, ThickLineBucket } from "../primitives";
import type { PreviewLabel, SymbolRenderModel } from "../../../rendering";
import { RENDER_ORDER } from "../layers";
import { useCanvasTheme } from "../theme";
import { graphicStrokeSegments } from "../preview/geometry";
import {
  BODY_STROKE_MM,
  KLC_TEXT_SIZE_MM,
  REFERENCE_OFFSET_MM,
  SYMBOL_PIN_DOT_RADIUS_MM,
} from "../defaults";

interface StrokeBucket {
  widthMm: number;
  positions: number[];
}

/**
 * Bucket all symbol-body segments by their stroke width so each LineSegments2
 * mesh has a uniform width (LineMaterial requires this). Pin stubs share the
 * default body stroke width.
 */
function buildStrokeBuckets(model: SymbolRenderModel): StrokeBucket[] {
  const bucketsByWidth = new Map<number, StrokeBucket>();

  const upsert = (
    widthMm: number,
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => {
    const key = widthMm;
    let bucket = bucketsByWidth.get(key);
    if (!bucket) {
      bucket = { widthMm, positions: [] };
      bucketsByWidth.set(key, bucket);
    }
    bucket.positions.push(a.x, a.y, 0, b.x, b.y, 0);
  };

  for (const graphic of model.graphics) {
    const stroke =
      "strokeWidthMm" in graphic && graphic.strokeWidthMm > 0
        ? graphic.strokeWidthMm
        : BODY_STROKE_MM;
    const segments = graphicStrokeSegments(graphic);
    for (const segment of segments) {
      upsert(
        stroke,
        { x: segment[0], y: segment[1] },
        { x: segment[2], y: segment[3] },
      );
    }
  }

  for (const pin of model.pins) {
    upsert(BODY_STROKE_MM, pin.anchor, pin.bodyEnd);
  }

  return [...bucketsByWidth.values()];
}

export function SymbolRenderLayer({
  model,
  counterRotationDeg = 0,
  counterMirrored = false,
  referenceText,
  valueText,
}: {
  model: SymbolRenderModel;
  /**
   * When this layer is rendered inside a rotated/mirrored parent group, set
   * these to undo the parent transform for label content so pin numbers,
   * references, values, and pin labels render upright/unmirrored regardless
   * of part orientation.
   */
  counterRotationDeg?: number;
  counterMirrored?: boolean;
  /** Optional instance designator override, e.g. R6/C2/U1. */
  referenceText?: string;
  /** Optional instance value override. Empty string hides the value label. */
  valueText?: string;
}) {
  const { theme } = useCanvasTheme();
  const pt = theme.preview;

  const buckets = useMemo(() => buildStrokeBuckets(model), [model]);

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
        shape.absarc(
          graphic.center.x,
          graphic.center.y,
          graphic.radiusMm,
          0,
          Math.PI * 2,
        );
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

  const referenceLabel = model.labels.find(
    (label) => label.role === "reference",
  );
  const hasValueLabel = model.labels.some((label) => label.role === "value");
  const hasInstanceValue =
    valueText !== undefined && valueText.trim().length > 0;
  const fallbackValueLabel: PreviewLabel | null = hasInstanceValue
    ? {
        id: "instance:value",
        text: valueText!.trim(),
        at: {
          x:
            referenceLabel?.at.x ??
            ((model.bounds?.minX ?? -1) + (model.bounds?.maxX ?? 1)) / 2,
          y:
            (referenceLabel?.at.y ??
              (model.bounds?.maxY ?? 0) + REFERENCE_OFFSET_MM) -
            (referenceLabel?.fontSizeMm ?? KLC_TEXT_SIZE_MM) * 1.25,
        },
        fontSizeMm: referenceLabel?.fontSizeMm ?? KLC_TEXT_SIZE_MM,
        rotationDeg: 0,
        anchorX: "center",
        anchorY: "bottom",
        role: "value",
      }
    : null;

  function renderLabel(label: PreviewLabel, key: string) {
    if (
      key !== "instance:value" &&
      label.role === "value" &&
      valueText !== undefined &&
      hasValueLabel
    ) {
      return null;
    }

    const counterScaleX = counterMirrored ? -1 : 1;
    const counterRotationRad = (-counterRotationDeg * Math.PI) / 180;
    const needsCounter = counterRotationDeg !== 0 || counterMirrored;

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
        : ([0, 0, (label.rotationDeg * Math.PI) / 180] as [
            number,
            number,
            number,
          ]);

    const isLight = theme.mode === "light";
    const outlineWidth = isLight ? 0.025 : undefined;
    const outlineColor = isLight ? "#f5f5f0" : undefined;

    const labelText =
      label.role === "reference"
        ? (referenceText ?? label.text)
        : label.role === "value"
          ? label.text
          : label.text;

    if (labelText.length === 0) {
      return null;
    }

    const text = (
      <EDAText
        position={needsCounter ? [0, 0, 0] : [label.at.x, label.at.y, 0]}
        color={color}
        fontSize={label.fontSizeMm}
        anchorX={label.anchorX}
        anchorY={label.anchorY}
        rotation={rotation}
        outlineWidth={outlineWidth}
        outlineColor={outlineColor}
      >
        {labelText}
      </EDAText>
    );

    if (!needsCounter) {
      return <group key={key}>{text}</group>;
    }

    return (
      <group key={key} position={[label.at.x, label.at.y, 0]}>
        <group scale={[counterScaleX, 1, 1]}>
          <group rotation={[0, 0, counterRotationRad]}>{text}</group>
        </group>
      </group>
    );
  }

  return (
    <>
      {fillShapes.length > 0 && (
        <mesh renderOrder={RENDER_ORDER.BODIES}>
          <shapeGeometry args={[fillShapes] as [THREE.Shape[]]} />
          <meshBasicMaterial
            color={pt.symbolFill}
            depthTest={false}
            depthWrite={false}
            transparent
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {buckets.map((bucket, i) => (
        <ThickLineBucket
          key={`${bucket.widthMm}-${i}`}
          positions={bucket.positions}
          widthMm={bucket.widthMm}
          color={pt.symbolStroke}
          renderOrder={RENDER_ORDER.BODIES + 0.1}
        />
      ))}

      <PinDots
        pins={pinDots}
        radius={SYMBOL_PIN_DOT_RADIUS_MM}
        defaultColor={pt.symbolPinDot}
      />

      {model.labels.map((label) => renderLabel(label, label.id))}
      {fallbackValueLabel
        ? renderLabel(fallbackValueLabel, fallbackValueLabel.id)
        : null}
    </>
  );
}
