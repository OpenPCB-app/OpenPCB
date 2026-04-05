/**
 * EDAText — Wrapper around troika-three-text (drei's <Text>) for EDA labels.
 *
 * Provides consistent defaults for pin names, net labels, reference designators.
 * MSDF-based SDF text rendering — crisp at all zoom levels.
 */

import { Text } from "@react-three/drei";
import type { ReactNode } from "react";
import { RENDER_ORDER } from "../layers";

interface EDATextProps {
  /** World-space position [x, y, z] */
  position: [number, number, number];
  /** Text content */
  children: ReactNode;
  /** Font size in world units (nanometers) */
  fontSize?: number;
  /** Text color */
  color?: string;
  /** Horizontal anchor: "left" | "center" | "right" */
  anchorX?: "left" | "center" | "right";
  /** Vertical anchor */
  anchorY?: "top" | "middle" | "bottom" | "top-baseline" | "bottom-baseline";
  /** Rotation in radians */
  rotation?: [number, number, number];
  /** Maximum width before wrapping (0 = no wrap) */
  maxWidth?: number;
  /** Opacity */
  opacity?: number;
  /** Render order override */
  renderOrder?: number;
  /** Whether to render */
  visible?: boolean;
}

/** Default font size: 1.27mm in nanometers */
/** Default font size: 0.25mm in nanometers (~12px at zoom 50) */
const DEFAULT_FONT_SIZE = 250_000;

export function EDAText({
  position,
  children,
  fontSize = DEFAULT_FONT_SIZE,
  color = "#e2e8f0",
  anchorX = "left",
  anchorY = "middle",
  rotation,
  maxWidth = 0,
  opacity = 1,
  renderOrder = RENDER_ORDER.LABELS,
  visible = true,
}: EDATextProps) {
  if (!visible) return null;

  return (
    <Text
      position={position}
      fontSize={fontSize}
      color={color}
      anchorX={anchorX}
      anchorY={anchorY}
      rotation={rotation}
      maxWidth={maxWidth || undefined}
      renderOrder={renderOrder}
      material-depthTest={false}
      material-depthWrite={false}
      material-transparent={opacity < 1}
      material-opacity={opacity}
    >
      {children}
    </Text>
  );
}
