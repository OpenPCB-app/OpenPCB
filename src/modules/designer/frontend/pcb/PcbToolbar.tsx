import type { ReactElement } from "react";
import type { PcbLayerId } from "../../../../sdks";
import { PCB_LAYER_COLORS } from "../../../../shared/frontend/canvas/layers";

interface PcbToolbarProps {
  activeLayer: PcbLayerId;
  onSetActiveLayer: (layer: PcbLayerId) => void;
  ratsnestVisible: boolean;
  onToggleRatsnest: () => void;
  drcCount: number;
}

const LAYER_LABELS: Partial<Record<PcbLayerId, string>> = {
  "F.Cu": "Top Copper",
  "B.Cu": "Bottom Copper",
};

function ActiveLayerPill({
  layer,
  onClick,
}: {
  layer: PcbLayerId;
  onClick: () => void;
}): ReactElement {
  const dot = PCB_LAYER_COLORS[layer];
  const label = LAYER_LABELS[layer] ?? layer;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to flip active copper layer"
      className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-100 shadow-md backdrop-blur transition hover:border-slate-500 hover:bg-slate-800"
    >
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: dot }}
      />
      {label}
    </button>
  );
}

export function PcbToolbar({
  activeLayer,
  onSetActiveLayer,
  ratsnestVisible,
  onToggleRatsnest,
  drcCount,
}: PcbToolbarProps): ReactElement {
  const flipped: PcbLayerId =
    activeLayer === "F.Cu" ? "B.Cu" : activeLayer === "B.Cu" ? "F.Cu" : "F.Cu";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex items-center justify-between gap-3 px-4">
      <div className="pointer-events-auto flex items-center gap-2">
        <ActiveLayerPill
          layer={activeLayer}
          onClick={() => onSetActiveLayer(flipped)}
        />
        <button
          type="button"
          onClick={onToggleRatsnest}
          title="Toggle ratsnest visibility (B)"
          className={`rounded-full border px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur transition ${
            ratsnestVisible
              ? "border-slate-700 bg-slate-900/80 text-slate-100 hover:border-slate-500 hover:bg-slate-800"
              : "border-slate-800 bg-slate-950/80 text-slate-500 hover:border-slate-700 hover:text-slate-300"
          }`}
        >
          {ratsnestVisible ? "Ratsnest On" : "Ratsnest Off"}
        </button>
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <div
          className="cursor-not-allowed rounded-full border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-slate-500 shadow-md backdrop-blur"
          title="Auto-routing arrives in Phase 4"
        >
          Auto-Layout
        </div>
        <div
          className={`rounded-full border px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur ${
            drcCount > 0
              ? "border-red-800 bg-red-950/70 text-red-200"
              : "border-slate-800 bg-slate-950/80 text-slate-500"
          }`}
          title="Design rule violations"
        >
          {drcCount} {drcCount === 1 ? "Review" : "Reviews"}
        </div>
      </div>
    </div>
  );
}
