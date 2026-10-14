import type { ReactElement } from "react";
import { SYMBOL_PIN_DOT_RADIUS_MM } from "../../../../shared/frontend/canvas/defaults";
import { RENDER_ORDER } from "../../../../shared/frontend/canvas/layers";

/** Hollow ring colour for a label / port that touches no wire or pin. */
export const FLOATING_ANCHOR_COLOR = "#f59e0b";

/** Horizontal run (mm) from a label's anchor dot to its text start. */
export const LABEL_STEM_MM = 0.5;

const RING_ARGS: [number, number, number] = [
  SYMBOL_PIN_DOT_RADIUS_MM * 0.7,
  SYMBOL_PIN_DOT_RADIUS_MM * 1.3,
  24,
];
const DOT_ARGS: [number, number] = [SYMBOL_PIN_DOT_RADIUS_MM, 24];
const STEM_ARGS: [number, number] = [LABEL_STEM_MM, 0.1];

interface AnchorProps {
  attached: boolean;
  /** Dot colour when attached. */
  color: string;
  opacity?: number;
  /** Draw a short stem toward +x (net labels). */
  stem?: boolean;
}

/** Connection anchor at the parent group's origin: filled dot (+ stem) when
 *  attached, hollow warning ring when floating. */
export function SchematicAttachAnchor({
  attached,
  color,
  opacity = 1,
  stem = false,
}: AnchorProps): ReactElement {
  const transparent = opacity < 1;
  if (!attached) {
    return (
      <mesh renderOrder={RENDER_ORDER.JUNCTIONS}>
        <ringGeometry args={RING_ARGS} />
        <meshBasicMaterial
          color={FLOATING_ANCHOR_COLOR}
          depthTest={false}
          depthWrite={false}
          transparent={transparent}
          opacity={opacity}
        />
      </mesh>
    );
  }
  return (
    <>
      <mesh renderOrder={RENDER_ORDER.JUNCTIONS}>
        <circleGeometry args={DOT_ARGS} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          transparent={transparent}
          opacity={opacity}
        />
      </mesh>
      {stem ? (
        <mesh
          position={[LABEL_STEM_MM / 2, 0, 0]}
          renderOrder={RENDER_ORDER.JUNCTIONS}
        >
          <planeGeometry args={STEM_ARGS} />
          <meshBasicMaterial
            color={color}
            depthTest={false}
            depthWrite={false}
            transparent={transparent}
            opacity={opacity}
          />
        </mesh>
      ) : null}
    </>
  );
}
