import { useMemo } from "react";
import { EDAText, PadInstances } from "../primitives";
import type { FootprintRenderModel } from "../../../rendering";
import { RENDER_ORDER } from "../layers";
import { DEFAULT_PREVIEW_THEME } from "../preview/preview-theme";
import { graphicStrokeSegments } from "../preview/geometry";

export function FootprintRenderLayer({ model }: { model: FootprintRenderModel }) {
  const strokePositions = useMemo(() => {
    const values: number[] = [];
    for (const graphic of model.graphics) {
      const segments = graphicStrokeSegments(graphic);
      for (const segment of segments) {
        values.push(segment[0], segment[1], 0, segment[2], segment[3], 0);
      }
    }
    return new Float32Array(values);
  }, [model.graphics]);

  const padData = useMemo(
    () =>
      model.pads.map((pad) => {
        const shape: "circle" | "rect" | "oval" | "roundrect" =
          pad.shape === "circle" ||
          pad.shape === "oval" ||
          pad.shape === "roundrect"
            ? pad.shape
            : "rect";
        return {
          id: pad.id,
          x: pad.centerMm.x,
          y: pad.centerMm.y,
          width: pad.widthMm,
          height: pad.heightMm,
          rotation: pad.rotationDeg,
          shape,
          selected: false,
        };
      }),
    [model.pads],
  );

  return (
    <>
      {strokePositions.length > 0 && (
        <lineSegments renderOrder={RENDER_ORDER.FRONT_SILKSCREEN}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[strokePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial
            color={DEFAULT_PREVIEW_THEME.footprintSilk}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      )}

      <PadInstances pads={padData} defaultColor={DEFAULT_PREVIEW_THEME.footprintPad} />

      {model.pads.map((pad) =>
        pad.drillDiameterMm && pad.drillDiameterMm > 0 ? (
          <mesh
            key={`${pad.id}:drill`}
            position={[pad.centerMm.x, pad.centerMm.y, 0]}
            renderOrder={RENDER_ORDER.PINS + 0.2}
          >
            <circleGeometry args={[pad.drillDiameterMm / 2, 20]} />
            <meshBasicMaterial
              color={DEFAULT_PREVIEW_THEME.footprintDrill}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        ) : null,
      )}

      {model.pads.map((pad) => (
        <EDAText
          key={`${pad.id}:number`}
          position={[pad.centerMm.x, pad.centerMm.y, 0]}
          color={DEFAULT_PREVIEW_THEME.footprintPadNumber}
          fontSize={0.28}
          anchorX="center"
          anchorY="middle"
        >
          {pad.number}
        </EDAText>
      ))}

      {model.labels.map((label) => (
        <EDAText
          key={label.id}
          position={[label.at.x, label.at.y, 0]}
          color={
            label.layer?.includes("Fab")
              ? DEFAULT_PREVIEW_THEME.footprintFab
              : DEFAULT_PREVIEW_THEME.footprintSilk
          }
          fontSize={label.fontSizeMm}
          anchorX={label.anchorX}
          anchorY={label.anchorY}
          rotation={
            label.rotationDeg === 0
              ? undefined
              : [0, 0, (label.rotationDeg * Math.PI) / 180]
          }
        >
          {label.text}
        </EDAText>
      ))}
    </>
  );
}
