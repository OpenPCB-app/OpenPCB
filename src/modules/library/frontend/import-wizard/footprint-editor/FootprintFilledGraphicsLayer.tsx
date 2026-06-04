import { useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { PreviewGraphic } from "../../../../../shared/rendering/types";
import {
  RENDER_ORDER,
  PCB_LAYER_COLORS,
} from "../../../../../shared/frontend/canvas/layers";
import type { EditorFootprintGraphic } from "./types";

/**
 * Renders committed footprint graphics that have `fill: "solid"` (e.g. a copper
 * shape drawn with the graphic modifier) as filled meshes. The shared
 * `FootprintRenderLayer` only strokes graphic outlines, so this composites the
 * fill underneath it. Pads are NOT handled here — they already render filled via
 * `PadInstances`.
 */
const COPPER_FALLBACK = "#d4925b";

function silkOrder(layer: string): number {
  return layer.startsWith("B.")
    ? RENDER_ORDER.BACK_SILKSCREEN
    : RENDER_ORDER.FRONT_SILKSCREEN;
}

function solidShape(graphic: PreviewGraphic): THREE.Shape | null {
  if (graphic.kind === "rect" && graphic.fill === "solid") {
    if (graphic.width <= 0 || graphic.height <= 0) return null;
    const s = new THREE.Shape();
    s.moveTo(graphic.x, graphic.y);
    s.lineTo(graphic.x + graphic.width, graphic.y);
    s.lineTo(graphic.x + graphic.width, graphic.y + graphic.height);
    s.lineTo(graphic.x, graphic.y + graphic.height);
    s.closePath();
    return s;
  }
  if (graphic.kind === "circle" && graphic.fill === "solid") {
    if (graphic.radiusMm <= 0) return null;
    const s = new THREE.Shape();
    s.absarc(graphic.center.x, graphic.center.y, graphic.radiusMm, 0, Math.PI * 2, false);
    return s;
  }
  return null;
}

export function FootprintFilledGraphicsLayer({
  graphics,
  dimmedLayers,
  layerVisibility,
}: {
  graphics: readonly EditorFootprintGraphic[];
  dimmedLayers: ReadonlySet<string>;
  layerVisibility: ReadonlySet<string>;
}): ReactElement | null {
  const groups = useMemo(() => {
    const byLayer = new Map<string, THREE.Shape[]>();
    for (const el of graphics) {
      if (!layerVisibility.has(el.layer)) continue;
      const shape = solidShape(el.graphic);
      if (!shape) continue;
      const arr = byLayer.get(el.layer) ?? [];
      arr.push(shape);
      byLayer.set(el.layer, arr);
    }
    return [...byLayer.entries()].map(([layer, shapes]) => ({ layer, shapes }));
  }, [graphics, layerVisibility]);

  if (groups.length === 0) return null;

  return (
    <>
      {groups.map((group) => {
        const color =
          PCB_LAYER_COLORS[group.layer as keyof typeof PCB_LAYER_COLORS] ??
          COPPER_FALLBACK;
        const dimmed = dimmedLayers.has(group.layer);
        return (
          <mesh
            key={group.layer}
            renderOrder={silkOrder(group.layer) - 0.1}
            frustumCulled={false}
          >
            <shapeGeometry args={[group.shapes]} />
            <meshBasicMaterial
              color={color}
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={dimmed ? 0.25 : 0.85}
            />
          </mesh>
        );
      })}
    </>
  );
}
