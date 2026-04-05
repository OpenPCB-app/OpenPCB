/**
 * PreviewGhost — Semi-transparent placement preview.
 *
 * Renders a symbol or footprint at the cursor position during placement mode.
 * Uses reduced opacity to distinguish from committed entities.
 */

import type { ReactNode } from "react";
import { RENDER_ORDER } from "../layers";

interface PreviewGhostProps {
  /** World-space position */
  position: [number, number, number];
  /** Rotation in radians around Z axis */
  rotation?: number;
  /** Whether mirrored */
  mirrored?: boolean;
  /** Ghost opacity */
  opacity?: number;
  /** Whether the preview is active */
  visible?: boolean;
  children: ReactNode;
}

export function PreviewGhost({
  position,
  rotation = 0,
  mirrored = false,
  opacity = 0.6,
  visible = true,
  children,
}: PreviewGhostProps) {
  if (!visible) return null;

  return (
    <group
      position={position}
      rotation={[0, 0, rotation]}
      scale={[mirrored ? -1 : 1, 1, 1]}
      renderOrder={RENDER_ORDER.PREVIEW}
    >
      {/* Opacity is applied via material props on children */}
      <group userData={{ ghostOpacity: opacity }}>{children}</group>
    </group>
  );
}
