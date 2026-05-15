import type { ReactElement } from "react";
import type { PcbLayerId } from "../../../../sdks";
import {
  PCB_LAYER_COLORS,
  PCB_LAYER_LABELS,
} from "../../../../shared/frontend/canvas/layers";

/**
 * Bottom-left active-layer indicator. Mirrors Flux.ai's `[F.Cu]` pill but
 * sized and saturated so the focused routing layer is unmistakable even at
 * a glance — a color-tinted background, larger color dot, the layer label,
 * and the keyboard shortcut hint (`1`/`2`/`3`/`4`). Routing/editing
 * commands target this layer; making it loud removes a major class of
 * "I edited the wrong layer" mistakes.
 */
const KEY_HINT: Partial<Record<PcbLayerId, string>> = {
  "F.Cu": "1",
  "B.Cu": "2",
  "In1.Cu": "3",
  "In2.Cu": "4",
};

export function PcbActiveLayerPill({
  layer,
}: {
  layer: PcbLayerId;
}): ReactElement {
  const color = PCB_LAYER_COLORS[layer] ?? "#64748b";
  const label = PCB_LAYER_LABELS[layer] ?? layer;
  const keyHint = KEY_HINT[layer];
  return (
    <div
      role="status"
      aria-label={`Active layer: ${label}`}
      className="pointer-events-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold shadow-md backdrop-blur"
      style={{
        backgroundColor: `${color}22`,
        borderColor: `${color}aa`,
        color: "#f8fafc",
      }}
    >
      <span
        aria-hidden
        className="inline-block size-2.5 rounded-full ring-2"
        style={{
          backgroundColor: color,
          boxShadow: `0 0 6px ${color}cc`,
        }}
      />
      <span className="tracking-tight">{label}</span>
      {keyHint ? (
        <kbd
          className="rounded border px-1.5 py-0 text-[10px] font-mono opacity-80"
          style={{ borderColor: `${color}55` }}
        >
          {keyHint}
        </kbd>
      ) : null}
    </div>
  );
}
