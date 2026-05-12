import { Eye, EyeOff } from "lucide-react";
import { useCallback, useMemo, type ReactElement } from "react";
import type { PcbLayerId } from "../../../../sdks";
import { PCB_LAYER_COLORS } from "../../../../shared/frontend/canvas/layers";

const LAYERS: ReadonlyArray<{
  id: PcbLayerId;
  label: string;
  copper: boolean;
}> = [
  { id: "F.Cu", label: "Top Copper", copper: true },
  { id: "B.Cu", label: "Bottom Copper", copper: true },
  { id: "F.SilkS", label: "Top Silkscreen", copper: false },
  { id: "B.SilkS", label: "Bottom Silkscreen", copper: false },
  { id: "Edge.Cuts", label: "Edge Cuts", copper: false },
];

interface PcbLayersPanelProps {
  activeLayer: PcbLayerId;
  onSetActiveLayer: (layer: PcbLayerId) => void;
  visibleLayers: ReadonlyArray<PcbLayerId>;
  onSetVisibleLayers: (layers: ReadonlyArray<PcbLayerId>) => void;
}

export function PcbLayersPanel({
  activeLayer,
  onSetActiveLayer,
  visibleLayers,
  onSetVisibleLayers,
}: PcbLayersPanelProps): ReactElement {
  const visibleSet = useMemo(() => new Set(visibleLayers), [visibleLayers]);

  const toggleVisibility = useCallback(
    (id: PcbLayerId): void => {
      const next = new Set(visibleSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Active layer must remain visible
      next.add(activeLayer);
      onSetVisibleLayers(Array.from(next));
    },
    [activeLayer, onSetVisibleLayers, visibleSet],
  );

  return (
    <div>
      <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Layers
        </p>
      </div>
      <div>
        {LAYERS.map((layer) => {
          const isActive = layer.id === activeLayer;
          const isVisible = visibleSet.has(layer.id);
          const color =
            PCB_LAYER_COLORS[layer.id as keyof typeof PCB_LAYER_COLORS] ??
            "#64748b";

          return (
            <div
              key={layer.id}
              className={`group flex items-center gap-2 px-3 py-1.5 ${
                isActive
                  ? "bg-violet-600/20 dark:bg-violet-700/30"
                  : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  if (layer.copper) onSetActiveLayer(layer.id);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={
                  layer.copper
                    ? `Set active layer: ${layer.label}`
                    : layer.label
                }
              >
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: color }}
                />
                <span
                  className={`truncate text-xs ${
                    isActive
                      ? "font-semibold text-violet-700 dark:text-violet-300"
                      : "text-slate-700 dark:text-slate-300"
                  }`}
                >
                  {layer.label}
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleVisibility(layer.id)}
                disabled={isActive}
                title={isVisible ? "Hide layer" : "Show layer"}
                className="shrink-0 rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:text-slate-600 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 dark:hover:text-slate-200"
              >
                {isVisible ? (
                  <Eye className="h-3 w-3" />
                ) : (
                  <EyeOff className="h-3 w-3" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
