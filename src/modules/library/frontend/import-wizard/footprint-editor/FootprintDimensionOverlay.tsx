import { useMemo, type ReactElement } from "react";
import { EDAText } from "../../../../../shared/frontend/canvas/primitives";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import { useFootprintEditorStore } from "./useFootprintEditorStore";

/**
 * Footprint dimension annotations: live W×H / ⌀ while drawing, selected pad /
 * graphic sizes (+ drill), and center-to-center distances (pitch) between
 * selected pads. Text is mm-sized (scales with zoom); a thin dimension line
 * connects measured pads.
 */
const DIM_COLOR = "#38bdf8"; // sky-400
const FONT_MM = 0.7;
const PAD_MM = FONT_MM * 0.7;
const RENDER_ORDER_DIM = RENDER_ORDER.SELECTION + 0.7;

function fmt(n: number): string {
  return n.toFixed(2);
}

interface DimLabel {
  key: string;
  x: number;
  y: number;
  text: string;
  anchorY: "top" | "middle" | "bottom";
}

export function FootprintDimensionOverlay(): ReactElement | null {
  const visible = useFootprintEditorStore((s) => s.dimensionsVisible);
  const previewGraphic = useFootprintEditorStore((s) => s.previewGraphic);
  const pads = useFootprintEditorStore((s) => s.pads);
  const graphics = useFootprintEditorStore((s) => s.graphics);
  const selectedIds = useFootprintEditorStore((s) => s.selectedIds);

  const labels = useMemo<DimLabel[]>(() => {
    if (!visible) return [];
    const out: DimLabel[] = [];

    // Live draw dimensions from the rubber-band preview.
    if (previewGraphic) {
      if (previewGraphic.kind === "rect" && previewGraphic.width > 0) {
        out.push({
          key: "preview",
          x: previewGraphic.x + previewGraphic.width / 2,
          y: previewGraphic.y + previewGraphic.height + PAD_MM,
          text: `${fmt(previewGraphic.width)} × ${fmt(previewGraphic.height)} mm`,
          anchorY: "bottom",
        });
      } else if (
        previewGraphic.kind === "circle" &&
        previewGraphic.radiusMm > 0
      ) {
        out.push({
          key: "preview",
          x: previewGraphic.center.x,
          y: previewGraphic.center.y + previewGraphic.radiusMm + PAD_MM,
          text: `Ø ${fmt(previewGraphic.radiusMm * 2)} mm`,
          anchorY: "bottom",
        });
      }
    }

    // Selected pad sizes (+ drill for THT).
    for (const pad of pads) {
      if (!selectedIds.has(pad.id)) continue;
      const drill =
        pad.drillDiameterMm && pad.drillDiameterMm > 0
          ? `  Ø${fmt(pad.drillDiameterMm)}`
          : "";
      out.push({
        key: `pad-${pad.id}`,
        x: pad.centerMm.x,
        y: pad.centerMm.y - pad.heightMm / 2 - PAD_MM,
        text: `${fmt(pad.widthMm)} × ${fmt(pad.heightMm)}${drill}`,
        anchorY: "top",
      });
    }

    // Selected rect graphic sizes.
    for (const g of graphics) {
      if (!selectedIds.has(g.id)) continue;
      if (g.graphic.kind === "rect" && g.graphic.width > 0) {
        out.push({
          key: `g-${g.id}`,
          x: g.graphic.x + g.graphic.width / 2,
          y: g.graphic.y - PAD_MM,
          text: `${fmt(g.graphic.width)} × ${fmt(g.graphic.height)}`,
          anchorY: "top",
        });
      }
    }

    return out;
  }, [visible, previewGraphic, pads, graphics, selectedIds]);

  // Center-to-center distances between consecutive selected pads.
  const { distSegments, distLabels } = useMemo(() => {
    if (!visible) return { distSegments: null, distLabels: [] as DimLabel[] };
    const selPads = pads.filter((p) => selectedIds.has(p.id));
    if (selPads.length < 2)
      return { distSegments: null, distLabels: [] as DimLabel[] };

    const sorted = [...selPads].sort(
      (a, b) => a.centerMm.x - b.centerMm.x || a.centerMm.y - b.centerMm.y,
    );
    const segs: number[] = [];
    const labelsOut: DimLabel[] = [];
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const a = sorted[i]!.centerMm;
      const b = sorted[i + 1]!.centerMm;
      segs.push(a.x, a.y, 0, b.x, b.y, 0);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      labelsOut.push({
        key: `dist-${i}`,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2 + PAD_MM,
        text: `${fmt(d)} mm`,
        anchorY: "bottom",
      });
    }
    return {
      distSegments: segs.length > 0 ? new Float32Array(segs) : null,
      distLabels: labelsOut,
    };
  }, [visible, pads, selectedIds]);

  if (!visible) return null;
  if (labels.length === 0 && distLabels.length === 0 && !distSegments)
    return null;

  return (
    <>
      {distSegments && (
        <lineSegments renderOrder={RENDER_ORDER_DIM} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[distSegments, 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial
            color={DIM_COLOR}
            depthTest={false}
            depthWrite={false}
            transparent
            opacity={0.85}
          />
        </lineSegments>
      )}
      {[...labels, ...distLabels].map((t) => (
        <EDAText
          key={t.key}
          position={[t.x, t.y, 0]}
          color={DIM_COLOR}
          fontSize={FONT_MM}
          anchorX="center"
          anchorY={t.anchorY}
          renderOrder={RENDER_ORDER_DIM}
          outlineWidth={0.05}
          outlineColor="#0b1220"
        >
          {t.text}
        </EDAText>
      ))}
    </>
  );
}
