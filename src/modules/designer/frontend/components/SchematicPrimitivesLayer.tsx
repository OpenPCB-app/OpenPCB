import { useMemo, type ReactElement } from "react";
import type { DesignerPrimitive } from "../../../../sdks";
import { Units } from "../../../../shared/frontend/canvas/coords";
import {
  BODY_STROKE_MM,
  SYMBOL_PIN_DOT_RADIUS_MM,
} from "../../../../shared/frontend/canvas/defaults";
import { RENDER_ORDER } from "../../../../shared/frontend/canvas/layers";
import {
  EDAText,
  ThickLineBucket,
} from "../../../../shared/frontend/canvas/primitives";
import { useCanvasTheme } from "../../../../shared/frontend/canvas/theme";

type Vec2 = readonly [number, number];

function flattenSegments(segments: Array<[Vec2, Vec2]>): number[] {
  const positions: number[] = [];
  for (const [a, b] of segments) {
    positions.push(a[0], a[1], 0, b[0], b[1], 0);
  }
  return positions;
}

// Local-space (mm) geometry per primitive kind. Connection point is at (0, 0)
// — wires/pins attach here. The rest of the geometry hangs below or above.

// Earth-style ground: vertical pin stub + 3 horizontal lines diminishing in
// width. Sized to read at the same scale as a discrete-component pin span.
const GND_SEGMENTS: Array<[Vec2, Vec2]> = [
  // Vertical pin stub up to the connection point at (0, 0)
  [
    [0, 0],
    [0, -2.032],
  ],
  // Top earth line (widest)
  [
    [-2.032, -2.032],
    [2.032, -2.032],
  ],
  // Middle earth line
  [
    [-1.219, -2.794],
    [1.219, -2.794],
  ],
  // Bottom earth line (narrowest)
  [
    [-0.61, -3.556],
    [0.61, -3.556],
  ],
];

// Power port: short pin stub + simple closed triangle. Connection at (0, 0).
// Triangle 2.54 mm wide × 1.524 mm tall, sitting on a 1.27 mm pin stub.
const PWR_SEGMENTS: Array<[Vec2, Vec2]> = [
  // Pin stub from connection point up to triangle base
  [
    [0, 0],
    [0, 1.27],
  ],
  // Triangle base
  [
    [-1.27, 1.27],
    [1.27, 1.27],
  ],
  // Left side (base to apex)
  [
    [-1.27, 1.27],
    [0, 2.794],
  ],
  // Right side (apex to base)
  [
    [0, 2.794],
    [1.27, 1.27],
  ],
];

// Net portal: compact rightward-pointing tag. Connection at the arrow tip
// (0, 0); body extends to the LEFT with a flat back edge at x=-4.470.
// Body: 4.470 mm long × 2.032 mm tall.
const NET_PORTAL_SEGMENTS: Array<[Vec2, Vec2]> = [
  // Top slant from the tip up-left to the body
  [
    [0, 0],
    [-0.812, 1.016],
  ],
  // Top horizontal
  [
    [-0.812, 1.016],
    [-4.47, 1.016],
  ],
  // Back (flat) vertical edge
  [
    [-4.47, 1.016],
    [-4.47, -1.016],
  ],
  // Bottom horizontal
  [
    [-4.47, -1.016],
    [-0.812, -1.016],
  ],
  // Bottom slant from the body down-right to the tip
  [
    [-0.812, -1.016],
    [0, 0],
  ],
];

// Local-space (mm) AABB per primitive kind. Padded slightly so the selection
// outline frames the geometry instead of clipping the strokes.
const PRIMITIVE_LOCAL_BOUNDS_MM: Record<
  "gnd" | "pwr" | "net_portal",
  { minX: number; minY: number; maxX: number; maxY: number }
> = {
  gnd: { minX: -2.032, minY: -3.556, maxX: 2.032, maxY: 0 },
  pwr: { minX: -1.27, minY: 0, maxX: 1.27, maxY: 2.794 },
  net_portal: { minX: -4.47, minY: -1.016, maxX: 0, maxY: 1.016 },
};

const SELECTION_OUTLINE_PAD_MM = 0.508;

function PrimitiveSelectionOutline({
  kind,
  color,
}: {
  kind: "gnd" | "pwr" | "net_portal";
  color: string;
}): ReactElement | null {
  const positions = useMemo(() => {
    const b = PRIMITIVE_LOCAL_BOUNDS_MM[kind];
    const minX = b.minX - SELECTION_OUTLINE_PAD_MM;
    const minY = b.minY - SELECTION_OUTLINE_PAD_MM;
    const maxX = b.maxX + SELECTION_OUTLINE_PAD_MM;
    const maxY = b.maxY + SELECTION_OUTLINE_PAD_MM;
    return new Float32Array([
      minX,
      minY,
      0,
      maxX,
      minY,
      0,
      maxX,
      minY,
      0,
      maxX,
      maxY,
      0,
      maxX,
      maxY,
      0,
      minX,
      maxY,
      0,
      minX,
      maxY,
      0,
      minX,
      minY,
      0,
    ]);
  }, [kind]);

  return (
    <lineSegments renderOrder={RENDER_ORDER.LABELS + 0.1}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
    </lineSegments>
  );
}

interface SinglePrimitiveProps {
  primitive: DesignerPrimitive;
  selected?: boolean;
  ghost?: boolean;
}

function SinglePrimitive({
  primitive,
  selected = false,
  ghost = false,
}: SinglePrimitiveProps): ReactElement {
  const { theme } = useCanvasTheme();
  const t = theme.schematic;
  // Use the same pin-dot color/size as part symbol pins so primitive
  // connection points read as "the same kind of thing" visually.
  const pinDotColor = theme.preview.symbolPinDot;
  const segments =
    primitive.kind === "gnd"
      ? GND_SEGMENTS
      : primitive.kind === "pwr"
        ? PWR_SEGMENTS
        : NET_PORTAL_SEGMENTS;
  const positions = useMemo(() => flattenSegments(segments), [segments]);

  const x = Units.nmToMm(primitive.positionNm.x);
  const y = Units.nmToMm(primitive.positionNm.y);
  const rotationRad = (primitive.rotationDeg * Math.PI) / 180;

  // Per-kind primitive accent color. Wires are intentionally muted greys;
  // primitives use saturated landmark colors so PWR/GND/Net Portal ports
  // remain immediately recognizable.
  const kindBaseColor =
    primitive.kind === "gnd"
      ? t.primitiveGndColor
      : primitive.kind === "pwr"
        ? t.primitivePwrColor
        : t.primitivePortalColor;

  // Selected primitives keep their kind color — selection is communicated
  // by the surrounding outline rect (PrimitiveSelectionOutline), not by
  // recoloring the symbol itself.
  const baseColor = ghost ? t.wirePreviewColor : kindBaseColor;

  const labelText =
    primitive.kind === "pwr"
      ? primitive.railText
      : primitive.kind === "net_portal"
        ? primitive.portalText
        : null;

  return (
    <group position={[x, y, 0]} rotation={[0, 0, rotationRad]}>
      {selected && !ghost ? (
        <PrimitiveSelectionOutline
          kind={primitive.kind}
          color={t.selectionColor}
        />
      ) : null}
      <ThickLineBucket
        positions={positions}
        widthMm={BODY_STROKE_MM}
        color={baseColor}
        renderOrder={RENDER_ORDER.LABELS}
        opacity={ghost ? 0.5 : 1}
      />
      {ghost ? null : (
        <mesh renderOrder={RENDER_ORDER.JUNCTIONS}>
          <circleGeometry args={[SYMBOL_PIN_DOT_RADIUS_MM, 24]} />
          <meshBasicMaterial
            color={pinDotColor}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      )}
      {labelText ? (
        <EDAText
          // Net-portal body spans x ∈ [-4.47, 0]; anchor the label just left of
          // the back edge (right-anchored) so it clears the body + outline
          // instead of rendering inside it.
          position={primitive.kind === "pwr" ? [0, 3.18, 0] : [-5.0, 0, 0]}
          color={baseColor}
          fontSize={1.27}
          anchorX={primitive.kind === "pwr" ? "center" : "right"}
          anchorY={primitive.kind === "pwr" ? "bottom" : "middle"}
        >
          {labelText}
        </EDAText>
      ) : null}
    </group>
  );
}

export interface SchematicPrimitivesLayerProps {
  primitives: readonly DesignerPrimitive[];
  selectedPrimitiveIds: ReadonlySet<string>;
}

export function SchematicPrimitivesLayer({
  primitives,
  selectedPrimitiveIds,
}: SchematicPrimitivesLayerProps): ReactElement {
  return (
    <>
      {primitives.map((primitive) => (
        <SinglePrimitive
          key={primitive.id}
          primitive={primitive}
          selected={selectedPrimitiveIds.has(primitive.id)}
        />
      ))}
    </>
  );
}

export interface PrimitiveGhostProps {
  primitive: DesignerPrimitive;
}

export function PrimitiveGhost({
  primitive,
}: PrimitiveGhostProps): ReactElement {
  return <SinglePrimitive primitive={primitive} ghost />;
}
