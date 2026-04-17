import { memo, type ReactElement } from "react";
import { PCB_LAYER_COLORS } from "../../../../../shared/frontend/canvas/layers";
import { useFootprintEditorStore } from "./useFootprintEditorStore";
import { PCB_EDITOR_LAYERS } from "./types";

export const LayerPanel = memo(function LayerPanel(): ReactElement {
  const activeLayer = useFootprintEditorStore((s) => s.activeLayer);
  const layerVisibility = useFootprintEditorStore((s) => s.layerVisibility);

  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
        Layers
      </div>
      <div className="space-y-0.5">
        {PCB_EDITOR_LAYERS.map((layer) => {
          const color =
            PCB_LAYER_COLORS[layer as keyof typeof PCB_LAYER_COLORS] ??
            "#94a3b8";
          const visible = layerVisibility.has(layer);
          const isActive = activeLayer === layer;

          return (
            <div
              key={layer}
              className={`flex items-center gap-2 rounded-md px-2 py-1 text-[11px] transition-colors ${
                isActive
                  ? "bg-violet-50 dark:bg-violet-950/30"
                  : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
              }`}
            >
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) =>
                  useFootprintEditorStore
                    .getState()
                    .setLayerVisible(layer, e.currentTarget.checked)
                }
                className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500 dark:border-slate-600"
              />
              <button
                type="button"
                onClick={() =>
                  useFootprintEditorStore.getState().setActiveLayer(layer)
                }
                className="flex min-w-0 flex-1 items-center gap-1.5"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm border border-slate-300 dark:border-slate-600"
                  style={{ backgroundColor: color }}
                />
                <span
                  className={`min-w-0 truncate ${
                    isActive
                      ? "font-semibold text-violet-700 dark:text-violet-300"
                      : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {layer}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
});
