import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { PcbCopperLayerId, PcbTrace } from "../../../../../sdks";
import {
  PCB_TRACE_COLORS,
  RENDER_ORDER,
} from "../../../../../shared/frontend/canvas/layers";

const NM_TO_MM = 1 / 1_000_000;

interface TraceLayerProps {
  traces: ReadonlyArray<PcbTrace>;
  /** When set, traces on other nets are dimmed. */
  highlightedNetId?: string | null;
  /** Traces in this set are rendered in the selection color. */
  selectedTraceIds?: ReadonlySet<string>;
  /** Layer to render. */
  layer: PcbCopperLayerId;
  /**
   * True when this layer is not the user's active copper layer. Bright/dim
   * traces are rendered at 50% opacity (Flux/KiCad convention) so the active
   * layer reads as the focused plane. Selected traces always stay full.
   */
  inactive?: boolean;
}

/**
 * True world-width trace renderer using LineSegments2 + LineMaterial in
 * worldUnits mode — a 0.25mm trace is exactly 0.25mm wide on screen at any
 * zoom. Traces are bucketed by (widthMm × visual-state) so each LineSegments2
 * has uniform width, which is required by LineMaterial.
 *
 * Visual states emitted as separate buffers:
 *   - bright   : default rendering (or highlighted-net subset)
 *   - dim      : non-highlighted-net traces (when scoping is active)
 *   - selected : the active selection trace, rendered above everything else
 */
export function TraceLayer({
  traces,
  highlightedNetId,
  selectedTraceIds,
  layer,
  inactive = false,
}: TraceLayerProps): ReactElement | null {
  const renderOrder =
    layer === "F.Cu" ? RENDER_ORDER.FRONT_COPPER : RENDER_ORDER.BACK_COPPER;
  const baseColor = PCB_TRACE_COLORS[layer];
  const inactiveScale = inactive ? 0.5 : 1;

  // Group traces by width × state. For each (widthMm, state) bucket we
  // produce one Float32Array of segment vertex positions (6 floats per segment).
  const buckets = useMemo(() => {
    const layerTraces = traces.filter((t) => t.layer === layer);
    const scopingActive =
      highlightedNetId !== null && highlightedNetId !== undefined;

    type Bucket = { widthMm: number; positions: number[] };
    const bright = new Map<number, Bucket>();
    const dim = new Map<number, Bucket>();
    const selected = new Map<number, Bucket>();

    const upsert = (
      map: Map<number, Bucket>,
      widthMm: number,
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) => {
      let bucket = map.get(widthMm);
      if (!bucket) {
        bucket = { widthMm, positions: [] };
        map.set(widthMm, bucket);
      }
      bucket.positions.push(
        a.x * NM_TO_MM,
        a.y * NM_TO_MM,
        0,
        b.x * NM_TO_MM,
        b.y * NM_TO_MM,
        0,
      );
    };

    for (const trace of layerTraces) {
      const isSelected = selectedTraceIds?.has(trace.id) ?? false;
      const isHighlighted = scopingActive && trace.netId === highlightedNetId;
      const targetMap = isSelected
        ? selected
        : !scopingActive || isHighlighted
          ? bright
          : dim;
      for (let i = 1; i < trace.pointsNm.length; i += 1) {
        upsert(
          targetMap,
          trace.widthMm,
          trace.pointsNm[i - 1]!,
          trace.pointsNm[i]!,
        );
      }
    }

    const toBuckets = (map: Map<number, Bucket>) =>
      [...map.values()]
        .filter((b) => b.positions.length > 0)
        .map((b) => ({
          widthMm: b.widthMm,
          positions: new Float32Array(b.positions),
        }));
    return {
      bright: toBuckets(bright),
      dim: toBuckets(dim),
      selected: toBuckets(selected),
    };
  }, [traces, layer, highlightedNetId, selectedTraceIds]);

  return (
    <>
      {buckets.bright.map((b, i) => (
        <FatLineGroup
          key={`b-${b.widthMm}-${i}`}
          positions={b.positions}
          widthMm={b.widthMm}
          color={baseColor}
          opacity={1 * inactiveScale}
          renderOrder={renderOrder}
        />
      ))}
      {buckets.dim.map((b, i) => (
        <FatLineGroup
          key={`d-${b.widthMm}-${i}`}
          positions={b.positions}
          widthMm={b.widthMm}
          color={baseColor}
          opacity={0.18 * inactiveScale}
          renderOrder={renderOrder}
        />
      ))}
      {buckets.selected.map((b, i) => (
        <FatLineGroup
          key={`s-${b.widthMm}-${i}`}
          positions={b.positions}
          widthMm={b.widthMm}
          color="#ffffff"
          opacity={1}
          renderOrder={RENDER_ORDER.SELECTION}
        />
      ))}
    </>
  );
}

/**
 * Renders a single LineSegments2 with a LineMaterial in world-units mode.
 * The geometry positions are in mm (matches the rest of the scene).
 */
function FatLineGroup({
  positions,
  widthMm,
  color,
  opacity,
  renderOrder,
}: {
  positions: Float32Array;
  widthMm: number;
  color: string;
  opacity: number;
  renderOrder: number;
}): ReactElement | null {
  const size = useThree((s) => s.size);

  const geometry = useMemo(() => {
    const geom = new LineSegmentsGeometry();
    geom.setPositions(positions);
    return geom;
  }, [positions]);

  const material = useMemo(() => {
    const mat = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: widthMm,
      worldUnits: true,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
    return mat;
  }, [color, widthMm, opacity]);

  // LineMaterial needs the canvas resolution for screen-space pixel sizing
  // (used for the antialiasing falloff even in worldUnits mode).
  useEffect(() => {
    material.resolution.set(size.width, size.height);
  }, [material, size.width, size.height]);

  // Build the LineSegments2 instance once and update its geometry/material.
  const line = useMemo(
    () => new LineSegments2(geometry, material),
    [geometry, material],
  );

  useEffect(() => {
    line.computeLineDistances();
    line.renderOrder = renderOrder;
  }, [line, renderOrder]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <primitive object={line} />;
}
