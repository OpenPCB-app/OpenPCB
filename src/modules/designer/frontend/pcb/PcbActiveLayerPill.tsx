import type { ReactElement } from "react";
import type { PcbLayerId } from "../../../../sdks";
import {
  PCB_LAYER_COLORS,
  PCB_LAYER_LABELS,
} from "../../../../shared/frontend/canvas/layers";

/**
 * Bottom-left active-layer indicator, mirroring Flux.ai's `[F.Cu]` pill —
 * color-dot + layer label so the focused side is unambiguous when display
 * mode is Normal (where the active layer otherwise blends with everything
 * else).
 */
export function PcbActiveLayerPill({
  layer,
}: {
  layer: PcbLayerId;
}): ReactElement {
  const color = PCB_LAYER_COLORS[layer] ?? "#64748b";
  const label = PCB_LAYER_LABELS[layer] ?? layer;
  return (
    <div
      role="status"
      aria-label={`Active layer: ${label}`}
      className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200/60 bg-slate-900/70 px-2 py-0.5 text-[11px] font-medium text-slate-100 shadow-sm backdrop-blur dark:border-slate-700/70"
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full ring-1 ring-black/40"
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
    </div>
  );
}
