/**
 * TraceLines — Renders PCB traces using Line2 (fat lines with world-unit widths).
 *
 * Uses LineSegments2 from three/addons for screen-space quad rendering,
 * avoiding the 1px line width limitation on Windows/ANGLE.
 *
 * Traces are grouped by layer for correct render ordering.
 */

import { useEffect, useMemo, useRef } from "react";
import { useThree, extend } from "@react-three/fiber";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { RENDER_ORDER } from "../layers";

// Register Line2 types with R3F reconciler
extend({ LineSegments2, LineSegmentsGeometry, LineMaterial });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TraceSegmentData {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  layer: string;
  selected?: boolean;
}

interface TraceLinesProps {
  segments: readonly TraceSegmentData[];
  /** Color for front copper traces */
  frontColor?: string;
  /** Color for back copper traces */
  backColor?: string;
  /** Color for selected traces */
  selectedColor?: string;
  /** Preview segments (being routed) */
  previewSegments?: readonly TraceSegmentData[];
  previewColor?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TraceLines({
  segments,
  frontColor = "#c87533",
  backColor = "#3377c8",
  selectedColor = "#38bdf8",
  previewSegments,
  previewColor = "#38bdf8",
}: TraceLinesProps) {
  const { size, invalidate } = useThree();

  // Group segments by category
  const groups = useMemo(() => {
    const front: TraceSegmentData[] = [];
    const back: TraceSegmentData[] = [];
    const selected: TraceSegmentData[] = [];

    for (const seg of segments) {
      if (seg.selected) selected.push(seg);
      else if (seg.layer === "B.Cu") back.push(seg);
      else front.push(seg);
    }

    return { front, back, selected };
  }, [segments]);

  return (
    <group>
      <TraceLineGroup
        segments={groups.back}
        color={backColor}
        renderOrder={RENDER_ORDER.BACK_COPPER}
        resolution={[size.width, size.height]}
        invalidate={invalidate}
        opacity={0.6}
      />
      <TraceLineGroup
        segments={groups.front}
        color={frontColor}
        renderOrder={RENDER_ORDER.FRONT_COPPER}
        resolution={[size.width, size.height]}
        invalidate={invalidate}
      />
      <TraceLineGroup
        segments={groups.selected}
        color={selectedColor}
        renderOrder={RENDER_ORDER.SELECTION}
        resolution={[size.width, size.height]}
        invalidate={invalidate}
      />
      {previewSegments && previewSegments.length > 0 && (
        <TraceLineGroup
          segments={previewSegments}
          color={previewColor}
          renderOrder={RENDER_ORDER.PREVIEW}
          resolution={[size.width, size.height]}
          invalidate={invalidate}
          dashed
          opacity={0.8}
        />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// TraceLineGroup — renders a batch of same-style segments
// ---------------------------------------------------------------------------

interface TraceLineGroupProps {
  segments: readonly TraceSegmentData[];
  color: string;
  renderOrder: number;
  resolution: [number, number];
  invalidate: () => void;
  dashed?: boolean;
  opacity?: number;
}

function TraceLineGroup({
  segments,
  color,
  renderOrder,
  resolution,
  invalidate,
  dashed = false,
  opacity = 1,
}: TraceLineGroupProps) {
  const lineRef = useRef<LineSegments2>(null);

  const geometry = useMemo(() => new LineSegmentsGeometry(), []);
  const material = useMemo(
    () =>
      new LineMaterial({
        color,
        worldUnits: true,
        linewidth: 1, // Will be overridden per-segment via average
        depthTest: false,
        depthWrite: false,
        transparent: opacity < 1 || dashed,
        opacity,
        dashed,
        dashScale: 1,
        dashSize: 200_000,
        gapSize: 120_000,
        resolution: { set: () => {} } as never,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    material.color.set(color);
    material.opacity = opacity;
    material.dashed = dashed;
    material.resolution.set(resolution[0], resolution[1]);
  }, [material, color, opacity, dashed, resolution]);

  useEffect(() => {
    if (segments.length === 0) {
      geometry.setPositions([]);
      if (lineRef.current) lineRef.current.visible = false;
      return;
    }

    const positions: number[] = [];
    let totalWidth = 0;

    for (const seg of segments) {
      positions.push(seg.startX, seg.startY, 0, seg.endX, seg.endY, 0);
      totalWidth += seg.width;
    }

    geometry.setPositions(positions);
    // Use average width (Line2 only supports uniform width per object)
    material.linewidth = totalWidth / segments.length;

    if (lineRef.current) {
      lineRef.current.visible = true;
      lineRef.current.computeLineDistances();
    }

    invalidate();
  }, [segments, geometry, material, invalidate]);

  if (segments.length === 0) return null;

  return (
    <primitive
      ref={lineRef}
      object={new LineSegments2(geometry, material)}
      renderOrder={renderOrder}
      frustumCulled={false}
    />
  );
}
