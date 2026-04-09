import { useMemo, type ReactNode } from "react";
import { usePcbStore } from "@/stores/pcb-store";
import { BoardSizeForm } from "./BoardSizeForm";

const LAYER_OPTIONS = ["F.Cu", "B.Cu", "F.SilkS", "B.SilkS"] as const;

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 border-t border-border-default px-2 py-3 first:border-t-0">
      <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function PcbSidebar() {
  const document = usePcbStore((state) => state.document);
  const activeLayer = usePcbStore((state) => state.activeLayer);
  const visibleLayers = usePcbStore((state) => state.visibleLayers);
  const selectedIds = usePcbStore((state) => state.selectedIds);
  const setActiveLayer = usePcbStore((state) => state.setActiveLayer);
  const toggleLayerVisibility = usePcbStore((state) => state.toggleLayerVisibility);
  const rotatePlacement = usePcbStore((state) => state.rotatePlacement);
  const flipPlacement = usePcbStore((state) => state.flipPlacement);
  const deleteSelectedEntities = usePcbStore(
    (state) => state.deleteSelectedEntities,
  );

  const selectedPlacement = useMemo(() => {
    if (!document) {
      return null;
    }

    const selectedId = Array.from(selectedIds)[0];
    if (!selectedId) {
      return null;
    }

    return document.placements.find((placement) => placement.id === selectedId) ?? null;
  }, [document, selectedIds]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg-secondary">
      <Section title="PCB Setup">
        <BoardSizeForm />
      </Section>

      <Section title="Layers">
        <div className="flex gap-2">
          {(["F.Cu", "B.Cu"] as const).map((layer) => (
            <button
              key={layer}
              type="button"
              className={`h-8 flex-1 rounded-md border px-2 text-xs ${
                activeLayer === layer
                  ? "border-border-strong bg-bg-input text-text-primary"
                  : "border-border-default text-text-muted hover:bg-bg-input"
              }`}
              onClick={() => setActiveLayer(layer)}
            >
              {layer}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {LAYER_OPTIONS.map((layer) => (
            <label
              key={layer}
              className="flex items-center justify-between rounded-md border border-border-default px-2 py-1.5 text-xs text-text-secondary"
            >
              <span>{layer}</span>
              <input
                type="checkbox"
                checked={visibleLayers.has(layer)}
                onChange={() => toggleLayerVisibility(layer)}
              />
            </label>
          ))}
        </div>
      </Section>

      <Section title="Selection">
        {selectedPlacement ? (
          <div className="space-y-3 text-xs text-text-secondary">
            <div className="space-y-1 rounded-md border border-border-default px-2 py-2">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Reference</span>
                <span className="text-text-primary">{selectedPlacement.reference}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Value</span>
                <span className="text-text-primary">{selectedPlacement.value || "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Layer</span>
                <span className="text-text-primary">{selectedPlacement.layer}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Rotation</span>
                <span className="text-text-primary">{selectedPlacement.rotation}°</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Position</span>
                <span className="text-text-primary">
                  {selectedPlacement.position.x.toFixed(2)}, {selectedPlacement.position.y.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                className="h-8 rounded-md border border-border-default px-2 text-left text-xs text-text-primary hover:bg-bg-input"
                onClick={() => rotatePlacement(selectedPlacement.id, 90)}
              >
                Rotate 90°
              </button>
              <button
                type="button"
                className="h-8 rounded-md border border-border-default px-2 text-left text-xs text-text-primary hover:bg-bg-input"
                onClick={() => flipPlacement(selectedPlacement.id)}
              >
                {selectedPlacement.layer === "F.Cu" ? "Flip to back" : "Flip to front"}
              </button>
                <button
                  type="button"
                  className="h-8 rounded-md border border-red-500/30 px-2 text-left text-xs text-red-300 hover:bg-red-500/10"
                  onClick={deleteSelectedEntities}
                >
                  Delete component
                </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-text-muted">Select a component on the PCB canvas.</p>
        )}
      </Section>
    </div>
  );
}
