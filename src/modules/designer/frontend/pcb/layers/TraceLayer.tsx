import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type {
  PcbCopperLayerId,
  PcbTrace,
  PcbViewSide,
} from "../../../../../sdks";
import {
  PCB_TRACE_COLORS,
  RENDER_ORDER,
  effectiveRenderOrder,
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
  /** Opacity applied to bright traces on this layer. */
  inactiveOpacity?: number;
  /** Opacity applied to non-highlighted traces when net scoping is active. */
  dimOpacity?: number;
  /**
   * Pre-mirror X coordinates in the geometry. Use when the parent group does
   * NOT apply a negative-X scale (LineSegments2 does not render correctly
   * under negative-scale parent groups). Pass `true` when viewSide="bottom".
   */
  mirror?: boolean;
  /**
   * Side-flip indicator. Drives renderOrder reversal so bottom-view brings
   * B.Cu traces above F.Cu (spec §5.2). Defaults to "top" for back-compat.
   */
  viewSide?: PcbViewSide;
  /**
   * Net-class color map keyed by net class id. When provided, traces emit
   * a thin halo accent in the net-class color underneath the main trace —
   * useful for telling power / GND / signal nets apart at a glance without
   * forcing per-net coloring on the whole trace.
   */
  netClassColors?: Record<string, string>;
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
const NET_CLASS_HALO_EXTRA_MM = 0.12;
const NET_CLASS_HALO_OPACITY = 0.55;

export function TraceLayer({
  traces,
  highlightedNetId,
  selectedTraceIds,
  layer,
  inactiveOpacity = 1,
  dimOpacity = 0.18,
  mirror = false,
  viewSide = "top",
  netClassColors,
}: TraceLayerProps): ReactElement | null {
  const renderOrder = effectiveRenderOrder(layer, viewSide, "object");
  // Keep RENDER_ORDER referenced (selection slot below uses it).
  void RENDER_ORDER;
  const baseColor = PCB_TRACE_COLORS[layer];
  const brightOpacity = Math.max(0, Math.min(1, inactiveOpacity));

  // Group traces by width × state. For each (widthMm, state) bucket we
  // produce one Float32Array of segment vertex positions (6 floats per segment).
  const buckets = useMemo(() => {
    const scopingActive =
      highlightedNetId !== null && highlightedNetId !== undefined;
    const xScale = mirror ? -1 : 1;

    type Bucket = { widthMm: number; positions: number[] };
    const bright = new Map<number, Bucket>();
    const dim = new Map<number, Bucket>();
    const selected = new Map<number, Bucket>();
    // Halo buckets keyed by `${widthMm}|${color}` so each net-class color
    // produces one batched LineSegments2 call. Halos always use the
    // trace's bright width + extra so they appear as colored outlines.
    const halos = new Map<string, Bucket & { color: string }>();

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
        a.x * NM_TO_MM * xScale,
        a.y * NM_TO_MM,
        0,
        b.x * NM_TO_MM * xScale,
        b.y * NM_TO_MM,
        0,
      );
    };

    const upsertHalo = (
      widthMm: number,
      color: string,
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) => {
      const key = `${widthMm}|${color}`;
      let bucket = halos.get(key);
      if (!bucket) {
        bucket = { widthMm, color, positions: [] };
        halos.set(key, bucket);
      }
      bucket.positions.push(
        a.x * NM_TO_MM * xScale,
        a.y * NM_TO_MM,
        0,
        b.x * NM_TO_MM * xScale,
        b.y * NM_TO_MM,
        0,
      );
    };

    for (const trace of traces) {
      if (trace.layer !== layer) continue;
      const isSelected = selectedTraceIds?.has(trace.id) ?? false;
      const isHighlighted = scopingActive && trace.netId === highlightedNetId;
      const targetMap = isSelected
        ? selected
        : !scopingActive || isHighlighted
          ? bright
          : dim;
      const netClassColor = netClassColors?.[trace.netClassId];
      const wantsHalo =
        !isSelected &&
        netClassColor !== undefined &&
        (!scopingActive || isHighlighted);
      for (let i = 1; i < trace.pointsNm.length; i += 1) {
        upsert(
          targetMap,
          trace.widthMm,
          trace.pointsNm[i - 1]!,
          trace.pointsNm[i]!,
        );
        if (wantsHalo) {
          upsertHalo(
            trace.widthMm + NET_CLASS_HALO_EXTRA_MM,
            netClassColor,
            trace.pointsNm[i - 1]!,
            trace.pointsNm[i]!,
          );
        }
      }
    }

    const toBuckets = (map: Map<number, Bucket>) =>
      [...map.values()]
        .filter((b) => b.positions.length > 0)
        .map((b) => ({
          widthMm: b.widthMm,
          positions: new Float32Array(b.positions),
        }));
    const toHaloBuckets = () =>
      [...halos.values()]
        .filter((b) => b.positions.length > 0)
        .map((b) => ({
          widthMm: b.widthMm,
          color: b.color,
          positions: new Float32Array(b.positions),
        }));
    return {
      bright: toBuckets(bright),
      dim: toBuckets(dim),
      selected: toBuckets(selected),
      halos: toHaloBuckets(),
    };
  }, [
    traces,
    layer,
    highlightedNetId,
    selectedTraceIds,
    mirror,
    netClassColors,
  ]);

  return (
    <>
      {/* Net-class color halos render UNDERNEATH the main trace so the
          colored accent only peeks out at the trace edges. renderOrder is
          biased down so each halo group paints before its matching trace
          group on the same layer. */}
      {buckets.halos.map((b, i) => (
        <FatLineGroup
          key={`h-${b.widthMm}-${b.color}-${i}`}
          positions={b.positions}
          widthMm={b.widthMm}
          color={b.color}
          opacity={NET_CLASS_HALO_OPACITY * brightOpacity}
          renderOrder={renderOrder - 0.05}
        />
      ))}
      {buckets.bright.map((b, i) => (
        <FatLineGroup
          key={`b-${b.widthMm}-${i}`}
          positions={b.positions}
          widthMm={b.widthMm}
          color={baseColor}
          opacity={brightOpacity}
          renderOrder={renderOrder}
        />
      ))}
      {buckets.dim.map((b, i) => (
        <FatLineGroup
          key={`d-${b.widthMm}-${i}`}
          positions={b.positions}
          widthMm={b.widthMm}
          color={baseColor}
          opacity={dimOpacity}
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
  const dpr = useThree((s) => s.viewport.dpr);

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
      // Always transparent so traces sort with the (transparent) solder-mask
      // layer by `renderOrder`. With `transparent: false`, three.js renders
      // opaque traces in the opaque pass *before* the transparent mask pass,
      // so the mask ends up painted over them regardless of renderOrder.
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
    return mat;
  }, [color, widthMm, opacity]);

  material.resolution.set(size.width * dpr, size.height * dpr);

  // Build with render state applied before the first demand-render frame.
  const line = useMemo(() => {
    const built = new LineSegments2(geometry, material);
    built.computeLineDistances();
    built.renderOrder = renderOrder;
    built.frustumCulled = false;
    return built;
  }, [geometry, material, renderOrder]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <primitive object={line} />;
}
