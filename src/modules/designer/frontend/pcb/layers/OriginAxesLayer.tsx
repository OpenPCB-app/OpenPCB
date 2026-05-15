import { useMemo, type ReactElement } from "react";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { useThree } from "@react-three/fiber";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";

/**
 * Origin axes — pink horizontal X, blue vertical Y at world (0,0). Matches
 * the spec §11 chrome (always-on regardless of layer toggles). Line widths
 * stay constant in screen-space via `LineMaterial.resolution`, so the cross
 * reads cleanly at every zoom.
 *
 * The axes use the annotation render slot (no side-flip) — viewSide
 * mirroring would invert the X axis visually, which is not what users
 * expect for a "reference origin" indicator.
 */
const X_COLOR = "#ec4899"; // pink
const Y_COLOR = "#3b82f6"; // blue
const SPAN_MM = 200;
const LINE_WIDTH_PX = 1.0;

export function OriginAxesLayer(): ReactElement {
  const size = useThree((state) => state.size);

  const { xLine, yLine } = useMemo(() => {
    const xGeom = new LineGeometry();
    xGeom.setPositions([-SPAN_MM, 0, 0, SPAN_MM, 0, 0]);
    const yGeom = new LineGeometry();
    yGeom.setPositions([0, -SPAN_MM, 0, 0, SPAN_MM, 0]);
    const xMat = new LineMaterial({
      color: X_COLOR,
      linewidth: LINE_WIDTH_PX,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    });
    const yMat = new LineMaterial({
      color: Y_COLOR,
      linewidth: LINE_WIDTH_PX,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    });
    const x = new Line2(xGeom, xMat);
    const y = new Line2(yGeom, yMat);
    x.computeLineDistances();
    y.computeLineDistances();
    x.renderOrder = RENDER_ORDER.METADATA - 0.5;
    y.renderOrder = RENDER_ORDER.METADATA - 0.5;
    return { xLine: x, yLine: y };
  }, []);

  useMemo(() => {
    (xLine.material as LineMaterial).resolution.set(size.width, size.height);
    (yLine.material as LineMaterial).resolution.set(size.width, size.height);
  }, [size.width, size.height, xLine, yLine]);

  return (
    <group>
      <primitive object={xLine} />
      <primitive object={yLine} />
    </group>
  );
}
