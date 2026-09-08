import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type {
  PcbCopperLayerId,
  PcbLayerId,
  PcbPointMm,
  PcbViewSide,
  PcbZone,
} from "../../../../../sdks";
import { effectiveRenderOrder } from "../../../../../shared/frontend/canvas/layers";
import { copperLayerColor } from "../pcb-layer-colors";
import { isCopperLayerVisible } from "../pcb-layer-visibility";
import {
  layerOpacity,
  shouldRenderCopperLayer,
  type PcbVisualState,
} from "../pcb-visual-state";

/** A disabled zone pours no copper (§3.5) — the ring is drawn as a faint ghost. */
const GHOST_OPACITY = 0.35;
/** ZoneOutlineLayer is presentation only — it never captures a pick. */
const NO_PICK = (): void => {};

interface ZoneOutlineLayerProps {
  /**
   * Every persisted polygon zone, enabled or not — a disabled zone still
   * draws its ring as a dashed ghost, so this must NOT be pre-filtered
   * through `collectCopperZones`. Board zones have no ring to draw and are
   * skipped by `region.kind`.
   */
  zones: ReadonlyArray<PcbZone>;
  visibleLayers: ReadonlySet<PcbLayerId>;
  visualState: PcbVisualState;
  layerOpacityFor?: (layer: PcbCopperLayerId) => number;
  viewSide?: PcbViewSide;
}

type PolygonZone = PcbZone & {
  region: { kind: "polygon"; pointsMm: PcbPointMm[]; holesMm?: PcbPointMm[][] };
};

function isPolygonZone(zone: PcbZone): zone is PolygonZone {
  return zone.region.kind === "polygon";
}

/**
 * Every ring this layer draws for one zone: the outer ring first, then each
 * cutout (copper-pour contract §11). A board zone draws nothing.
 */
export function zoneOutlineRings(
  zone: PcbZone,
): ReadonlyArray<ReadonlyArray<PcbPointMm>> {
  if (zone.region.kind !== "polygon") return [];
  return [zone.region.pointsMm, ...(zone.region.holesMm ?? [])];
}

/**
 * ZoneOutlineLayer — draws each polygon zone's ring: a solid closed line
 * under the pour when enabled, a dashed ghost when disabled (zone/keepout
 * contract §3.5, §12.3). Cutout rings are drawn in the outer ring's own style
 * (copper-pour contract §11). Board-region zones have no ring and are skipped
 * — the per-layer fill toggle has no outline of its own.
 */
export function ZoneOutlineLayer({
  zones,
  visibleLayers,
  visualState,
  layerOpacityFor,
  viewSide = "top",
}: ZoneOutlineLayerProps): ReactElement | null {
  const polygonZones = zones.filter(isPolygonZone);
  if (polygonZones.length === 0) return null;
  return (
    <>
      {polygonZones.map((zone) =>
        isCopperLayerVisible(visibleLayers, zone.layer) &&
        shouldRenderCopperLayer(visualState, zone.layer)
          ? zoneOutlineRings(zone).map((ring, ringIndex) => (
              <ZoneRing
                key={`zone:${zone.id}:${ringIndex}`}
                pointsMm={ring}
                layer={zone.layer}
                enabled={zone.enabled}
                viewSide={viewSide}
                opacity={
                  layerOpacity(visualState, zone.layer) *
                  (layerOpacityFor?.(zone.layer) ?? 1)
                }
              />
            ))
          : null,
      )}
    </>
  );
}

function ZoneRing({
  pointsMm,
  layer,
  enabled,
  viewSide,
  opacity,
}: {
  pointsMm: ReadonlyArray<PcbPointMm>;
  layer: PcbCopperLayerId;
  enabled: boolean;
  viewSide: PcbViewSide;
  opacity: number;
}): ReactElement | null {
  const solidGeom = useMemo(
    () => (enabled ? lineGeometry(zoneRingSegments(pointsMm)) : null),
    [pointsMm, enabled],
  );
  const ghostGeom = useMemo(
    () => (enabled ? null : lineGeometry(zoneGhostSegments(pointsMm))),
    [pointsMm, enabled],
  );
  useEffect(
    () => () => {
      solidGeom?.dispose();
      ghostGeom?.dispose();
    },
    [solidGeom, ghostGeom],
  );

  const geometry = solidGeom ?? ghostGeom;
  if (!geometry) return null;
  // Under the keepout hatch/outline slot, above the layer's copper objects.
  const renderOrder =
    effectiveRenderOrder(
      layer as Parameters<typeof effectiveRenderOrder>[0],
      viewSide,
      "object",
    ) + 0.2;
  const color = copperLayerColor(layer);
  return (
    <lineSegments
      geometry={geometry}
      renderOrder={renderOrder}
      raycast={NO_PICK}
    >
      <lineBasicMaterial
        color={color}
        transparent
        opacity={enabled ? opacity : opacity * GHOST_OPACITY}
        depthTest={false}
        depthWrite={false}
      />
    </lineSegments>
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

/** The closed ring as `lineSegments` vertex pairs, or null below 3 points. */
export function zoneRingSegments(
  pointsMm: ReadonlyArray<PcbPointMm>,
): Float32Array | null {
  if (pointsMm.length < 3) return null;
  const out: number[] = [];
  for (const p of pointsMm) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }
  for (let i = 0; i < pointsMm.length; i++) {
    const a = pointsMm[i]!;
    const b = pointsMm[(i + 1) % pointsMm.length]!;
    out.push(a.x, a.y, 0, b.x, b.y, 0);
  }
  return new Float32Array(out);
}

/**
 * Dashed closed ring for a disabled zone's ghost outline: walks the ring's
 * perimeter emitting `dashMm` on, `gapMm` off, restarting the dash phase at
 * every edge so short edges don't inherit a stale phase from the previous one.
 */
export function zoneGhostSegments(
  pointsMm: ReadonlyArray<PcbPointMm>,
  dashMm = 0.6,
  gapMm = 0.4,
): Float32Array | null {
  if (pointsMm.length < 3 || dashMm <= 0 || gapMm < 0) return null;
  for (const p of pointsMm) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }
  const period = dashMm + gapMm;
  const out: number[] = [];
  for (let i = 0; i < pointsMm.length; i++) {
    const a = pointsMm[i]!;
    const b = pointsMm[(i + 1) % pointsMm.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len;
    const uy = dy / len;
    let t = 0;
    while (t < len) {
      const dashEnd = Math.min(t + dashMm, len);
      out.push(
        a.x + ux * t,
        a.y + uy * t,
        0,
        a.x + ux * dashEnd,
        a.y + uy * dashEnd,
        0,
      );
      t += period;
    }
  }
  return out.length === 0 ? null : new Float32Array(out);
}
