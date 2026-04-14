import { Text } from "@react-three/drei";
import type { ReactNode } from "react";
import { RENDER_ORDER } from "../layers";

export interface EDATextProps {
  position: [number, number, number];
  children: ReactNode;
  fontSize?: number;
  color?: string;
  anchorX?: "left" | "center" | "right";
  anchorY?: "top" | "middle" | "bottom" | "top-baseline" | "bottom-baseline";
  rotation?: [number, number, number];
  maxWidth?: number;
  opacity?: number;
  renderOrder?: number;
  visible?: boolean;
}

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
