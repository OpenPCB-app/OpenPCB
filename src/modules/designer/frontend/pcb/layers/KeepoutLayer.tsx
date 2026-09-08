import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type {
  PcbCopperLayerId,
  PcbKeepout,
  PcbLayerId,
  PcbPointMm,
  PcbViewSide,
} from "../../../../../sdks";
import { effectiveRenderOrder } from "../../../../../shared/frontend/canvas/layers";
import { isCopperLayerVisible } from "../pcb-layer-visibility";
import {
  layerOpacity,
  shouldRenderCopperLayer,
  type PcbVisualState,
} from "../pcb-visual-state";

/**
 * Keepout ("rule area") color. There is no keepout token in the canvas theme
 * (`theme.pcbCanvas`), so — like `drc-colors.ts` — the hue is pinned here: a
 * violet clear of the copper palette (red F.Cu, blue B.Cu), of the silkscreen
 * white and of the DRC marker hues (magenta / amber / cyan), so a keepout never
 * reads as copper or as a violation.
 */
export const KEEPOUT_COLOR = "#c084fc";
/** Hatch line spacing in board millimetres (world units, so it scales with zoom). */
const HATCH_SPACING_MM = 0.8;
/** A disabled keepout restricts nothing (contract §3.5) — drawn, but faint. */
const DISABLED_OPACITY = 0.35;
/** The hatch is texture; the outline is the boundary that matters. */
const HATCH_OPACITY = 0.55;
/** Keepouts are never pickable — selection/hit-testing ignores them entirely. */
const NO_PICK = (): void => {};

interface KeepoutLayerProps {
  /**
   * Every persisted keepout, enabled or not: a disabled keepout is still drawn
   * (dimmed), so it must NOT be pre-filtered through `collectKeepouts`.
   */
  keepouts: ReadonlyArray<PcbKeepout>;
  visibleLayers: ReadonlySet<PcbLayerId>;
  visualState: PcbVisualState;
  /** Per-layer opacity slider from the layers panel. */
  layerOpacityFor?: (layer: PcbCopperLayerId) => number;
  viewSide?: PcbViewSide;
}

/**
 * KeepoutLayer — draws each keepout as a hatched, non-interactive outline on
 * every copper layer it covers (zone/keepout contract §7). Keepouts make rules,
 * never copper, so this layer is presentation only: it never captures a pick
 * (`raycast` is stubbed out) and it carries no fill that could be mistaken for
 * poured copper. Disabled keepouts render dimmed rather than disappearing —
 * `enabled: false` is intent, not absence (§3.5).
 */
export function KeepoutLayer({
  keepouts,
  visibleLayers,
  visualState,
  layerOpacityFor,
  viewSide = "top",
}: KeepoutLayerProps): ReactElement | null {
  if (keepouts.length === 0) return null;
  return (
    <>
      {keepouts.flatMap((keepout) =>
        keepout.layers.map((layer) =>
          isCopperLayerVisible(visibleLayers, layer) &&
          shouldRenderCopperLayer(visualState, layer) ? (
            <KeepoutOutline
              key={`keepout:${keepout.id}:${layer}`}
              pointsMm={keepout.pointsMm}
              layer={layer}
              viewSide={viewSide}
              opacity={
                (keepout.enabled ? 1 : DISABLED_OPACITY) *
                layerOpacity(visualState, layer) *
                (layerOpacityFor?.(layer) ?? 1)
              }
            />
          ) : null,
        ),
      )}
    </>
  );
}

function KeepoutOutline({
  pointsMm,
  layer,
  viewSide,
  opacity,
}: {
  pointsMm: ReadonlyArray<PcbPointMm>;
  layer: PcbCopperLayerId;
  viewSide: PcbViewSide;
  opacity: number;
}): ReactElement | null {
  const outlineGeom = useMemo(
    () => lineGeometry(keepoutRingSegments(pointsMm)),
    [pointsMm],
  );
  const hatchGeom = useMemo(
    () => lineGeometry(keepoutHatchSegments(pointsMm, HATCH_SPACING_MM)),
    [pointsMm],
  );
  useEffect(
    () => () => {
      outlineGeom?.dispose();
      hatchGeom?.dispose();
    },
    [outlineGeom, hatchGeom],
  );

  if (!outlineGeom) return null;
  // Just above the layer's copper objects so the rule area stays readable over
  // traces and pads, still below the next layer's slot.
  // Cast as in TraceLayer / FreePadLayer: the canvas package's own layer union
  // stops at In2.Cu, the sdk's copper union runs to In30.Cu.
  const renderOrder =
    effectiveRenderOrder(
      layer as Parameters<typeof effectiveRenderOrder>[0],
      viewSide,
      "object",
    ) + 0.25;
  return (
    <>
      {hatchGeom ? (
        <lineSegments
          geometry={hatchGeom}
          renderOrder={renderOrder}
          raycast={NO_PICK}
        >
          <lineBasicMaterial
            color={KEEPOUT_COLOR}
            transparent
            opacity={opacity * HATCH_OPACITY}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      ) : null}
      <lineSegments
        geometry={outlineGeom}
        renderOrder={renderOrder}
        raycast={NO_PICK}
      >
        <lineBasicMaterial
          color={KEEPOUT_COLOR}
          transparent
          opacity={opacity}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
    </>
  );
}

function lineGeometry(
  segments: Float32Array | null,
): THREE.BufferGeometry | null {
  if (!segments || segments.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(segments, 3));
  return geometry;
}

/** The closed ring as `lineSegments` vertex pairs. Exported for its tests. */
export function keepoutRingSegments(
  pointsMm: ReadonlyArray<PcbPointMm>,
): Float32Array | null {
  if (pointsMm.length < 3) return null;
  const out: number[] = [];
  for (let i = 0; i < pointsMm.length; i++) {
    const a = pointsMm[i]!;
    const b = pointsMm[(i + 1) % pointsMm.length]!;
    out.push(a.x, a.y, 0, b.x, b.y, 0);
  }
  return new Float32Array(out);
}

/**
 * 45° hatch lines clipped to the ring: for each line `x − y = c` spaced
 * `spacingMm` apart across the ring's bounding box, collect the edge crossings
 * and pair them up (even–odd), so only the spans inside the polygon are drawn.
 * Concave and self-touching rings work because the pairing is per-line, not
 * per-shape. A vertex exactly on the line counts once (half-open edge test),
 * which keeps the crossing count even.
 */
export function keepoutHatchSegments(
  pointsMm: ReadonlyArray<PcbPointMm>,
  spacingMm: number,
): Float32Array | null {
  if (pointsMm.length < 3 || spacingMm <= 0) return null;
  let minC = Infinity;
  let maxC = -Infinity;
  for (const p of pointsMm) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const c = p.x - p.y;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  if (!Number.isFinite(minC) || !Number.isFinite(maxC)) return null;
  // Anchor the family on a global multiple of the spacing so neighbouring
  // keepouts hatch in phase instead of each starting at its own bbox corner.
  const first = Math.ceil(minC / spacingMm) * spacingMm;
  const out: number[] = [];
  const crossings: number[] = [];
  for (let c = first; c <= maxC; c += spacingMm) {
    crossings.length = 0;
    for (let i = 0; i < pointsMm.length; i++) {
      const a = pointsMm[i]!;
      const b = pointsMm[(i + 1) % pointsMm.length]!;
      const fa = a.x - a.y - c;
      const fb = b.x - b.y - c;
      // Half-open: an endpoint sitting on the line belongs to one edge only.
      if (!((fa <= 0 && fb > 0) || (fb <= 0 && fa > 0))) continue;
      const s = fa / (fa - fb);
      crossings.push(a.y + s * (b.y - a.y));
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const t0 = crossings[i]!;
      const t1 = crossings[i + 1]!;
      // Points on the line are (c + t, t).
      out.push(c + t0, t0, 0, c + t1, t1, 0);
    }
  }
  return out.length === 0 ? null : new Float32Array(out);
}
