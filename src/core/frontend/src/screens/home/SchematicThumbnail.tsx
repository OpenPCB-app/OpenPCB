import { useMemo } from "react";
import { PencilRuler } from "lucide-react";
import type { DesignerSchematicPreview } from "@sdks/designer";
import { buildSchematicPreviewGeometry } from "./schematic-preview";

/**
 * Real schematic preview for a design card. Renders the placed symbols and
 * wires from the design's precomputed {@link DesignerSchematicPreview} (shipped
 * with the design list) as a static, auto-fit SVG matching the schematic
 * editor's dark theme. Empty designs (no parts) show an icon + label.
 */

// Dark schematic theme tokens (mirrors @openpcb/r3f-eda-canvas canvasTheme).
const BG = "#131313";
const WIRE = "#94a3b8";
const SYMBOL_STROKE = "#e2e8f0";
const SYMBOL_FILL = "#111111";

// Stroke widths in rendered px (vector-effect non-scaling-stroke keeps them
// constant regardless of how far the design extent is zoomed to fit the card).
const SYMBOL_STROKE_PX = 1.1;
const WIRE_STROKE_PX = 1;
const DOT_DIAMETER_PX = 2.2;

function EmptyPreview() {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-1.5"
      style={{ backgroundColor: BG }}
    >
      <PencilRuler className="h-5 w-5 text-slate-600" aria-hidden="true" />
      <span className="text-[11px] text-slate-500">Empty design</span>
    </div>
  );
}

export function SchematicThumbnail({
  preview,
}: {
  preview: DesignerSchematicPreview | null | undefined;
}) {
  const geometry = useMemo(
    () => (preview ? buildSchematicPreviewGeometry(preview) : null),
    [preview],
  );

  if (!geometry) return <EmptyPreview />;

  return (
    <svg
      viewBox={geometry.viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="block h-full w-full"
      style={{ backgroundColor: BG }}
      aria-hidden="true"
    >
      {geometry.wires.map((points, i) => (
        <polyline
          key={`w${i}`}
          points={points}
          fill="none"
          stroke={WIRE}
          strokeWidth={WIRE_STROKE_PX}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {geometry.paths.map((p, i) => (
        <path
          key={`p${i}`}
          d={p.d}
          fill={p.fill ? SYMBOL_FILL : "none"}
          stroke={SYMBOL_STROKE}
          strokeWidth={SYMBOL_STROKE_PX}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {geometry.circles.map((c, i) => (
        <circle
          key={`c${i}`}
          cx={c.cx}
          cy={c.cy}
          r={c.r}
          fill={c.fill ? SYMBOL_FILL : "none"}
          stroke={SYMBOL_STROKE}
          strokeWidth={SYMBOL_STROKE_PX}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* Connection dots: zero-length round-capped points → constant-px filled
          dots that don't scale with the viewBox. */}
      {geometry.dots.map((d, i) => (
        <path
          key={`d${i}`}
          d={`M${d.x} ${d.y} L${d.x} ${d.y}`}
          fill="none"
          stroke={WIRE}
          strokeWidth={DOT_DIAMETER_PX}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
