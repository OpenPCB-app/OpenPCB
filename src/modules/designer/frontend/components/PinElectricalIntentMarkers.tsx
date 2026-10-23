import { useEffect, useMemo, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import type { DesignerPlacedPart } from "../../../../sdks";
import { Units } from "../../../../shared/frontend/canvas/coords";
import { RENDER_ORDER } from "../../../../shared/frontend/canvas/layers";

type PointNm = { x: number; y: number };
type Segment = readonly [number, number, number, number];

// Fixed millimetre strokes keep these annotations legible through canvas zoom.
function strokeTriangles(segments: readonly Segment[]): Float32Array {
  const positions: number[] = [];
  const halfWidthMm = 0.06;
  for (const [ax, ay, bx, by] of segments) {
    const length = Math.hypot(bx - ax, by - ay);
    const dx = (-(by - ay) / length) * halfWidthMm;
    const dy = ((bx - ax) / length) * halfWidthMm;
    positions.push(
      ax + dx, ay + dy, 0, ax - dx, ay - dy, 0, bx - dx, by - dy, 0,
      ax + dx, ay + dy, 0, bx - dx, by - dy, 0, bx + dx, by + dy, 0,
    );
  }
  return new Float32Array(positions);
}

const NC_POSITIONS = strokeTriangles([
  [-0.45, -0.45, 0.45, 0.45], [-0.45, 0.45, 0.45, -0.45],
]);
const SOURCE_POSITIONS = strokeTriangles([
  [0, 0, 0, 1.4], [0, 1.4, 0.9, 1.05], [0.9, 1.05, 0, 0.7],
]);
const noHit = (): null => null;

interface PinElectricalIntentMarkersProps {
  parts: readonly DesignerPlacedPart[];
  renderedPartPositionNm: (part: DesignerPlacedPart) => PointNm;
  noConnectColor: string;
  powerSourceColor: string;
}

export function PinElectricalIntentMarkers({
  parts,
  renderedPartPositionNm,
  noConnectColor,
  powerSourceColor,
}: PinElectricalIntentMarkersProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const markers = useMemo(
    () => parts.flatMap((part) => {
      const rendered = renderedPartPositionNm(part);
      const dx = rendered.x - part.positionNm.x;
      const dy = rendered.y - part.positionNm.y;
      return part.pins.flatMap((pin) => {
        if (pin.electricalIntent !== "no_connect"
          && pin.electricalIntent !== "power_source") return [];
        return [{
          id: pin.id,
          intent: pin.electricalIntent,
          x: Units.nmToMm(pin.worldPositionNm.x + dx),
          y: Units.nmToMm(pin.worldPositionNm.y + dy),
        }];
      });
    }),
    [parts, renderedPartPositionNm],
  );

  useEffect(() => invalidate(), [
    invalidate, markers, noConnectColor, powerSourceColor,
  ]);

  return (
    <group>
      {markers.map((marker) => (
        <mesh
          key={marker.id}
          position={[marker.x, marker.y, 0]}
          renderOrder={RENDER_ORDER.LABELS}
          raycast={noHit}
        >
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[
                marker.intent === "no_connect" ? NC_POSITIONS : SOURCE_POSITIONS,
                3,
              ]}
            />
          </bufferGeometry>
          <meshBasicMaterial
            color={marker.intent === "no_connect" ? noConnectColor : powerSourceColor}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
