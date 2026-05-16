import {
  ChevronDown,
  ChevronRight,
  Droplet,
  Eye,
  EyeOff,
  Focus,
  SlidersHorizontal,
} from "lucide-react";
import {
  useCallback,
  useMemo,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import type {
  PcbCopperLayerId,
  PcbDisplayMode,
  PcbLayerCount,
  PcbLayerId,
  PcbLayerPreset,
  PcbViewSide,
} from "../../../../sdks";
import {
  PCB_LAYER_COLORS,
  PCB_LAYER_PRESETS,
  PCB_LAYER_TREE,
  detectLayerPreset,
  type LayerTreeNode,
  type PcbLayerPresetId,
} from "../../../../shared/frontend/canvas/layers";
import { PcbSideModeButton } from "./PcbSideModeButton";

interface PcbLayersPanelProps {
  activeLayer: PcbLayerId | null;
  /** Layer that must stay visible for route/edit commands, even when no layer is focused. */
  lockedVisibleLayer?: PcbLayerId | null;
  onSetActiveLayer: (layer: PcbLayerId) => void;
  visibleLayers: ReadonlyArray<PcbLayerId>;
  onSetVisibleLayers: (layers: ReadonlyArray<PcbLayerId>) => void;
  /** 2 → hide In1.Cu / In2.Cu nodes. */
  layerCount?: PcbLayerCount;
  displayMode?: PcbDisplayMode;
  onSetDisplayMode?: (mode: PcbDisplayMode) => void;
  copperFillLayers?: ReadonlyArray<PcbCopperLayerId>;
  onToggleCopperFillLayer?: (layer: PcbCopperLayerId) => void;
  /** Side-mode toolbar state + handlers. When omitted the chip is hidden. */
  viewSide?: PcbViewSide;
  onToggleViewSide?: () => void;
  /** Preset chip handler. Receives the preset id; "custom" should be ignored. */
  onSelectLayerPreset?: (preset: PcbLayerPreset) => void;
  /**
   * Per-layer opacity map. Optional. When provided, each row gains a
   * collapsible chevron that reveals a 0–100% slider for the layer.
   */
  perLayerOpacity?: Partial<Record<PcbLayerId, number>>;
  /** Slider commit handler. */
  onSetLayerOpacity?: (layer: PcbLayerId, opacity: number) => void;
  /**
   * Row solo. When non-null, only this layer + always-on chrome are
   * visible. Alt+click a row to enter/exit. The icon highlights the
   * currently-soloed row.
   */
  soloLayer?: PcbLayerId | null;
  onToggleSoloLayer?: (layer: PcbLayerId, isActivatable: boolean) => void;
}

const DISPLAY_MODES: ReadonlyArray<{
  id: PcbDisplayMode;
  label: string;
}> = [
  { id: "normal", label: "Normal" },
  { id: "dim", label: "Dim" },
  { id: "solo", label: "Solo" },
];

function isCopperLayer(layer: PcbLayerId): layer is PcbCopperLayerId {
  return (
    layer === "F.Cu" ||
    layer === "In1.Cu" ||
    layer === "In2.Cu" ||
    layer === "B.Cu"
  );
}

/**
 * Hybrid layer panel — Flux-style grouped tree with KiCad-style display mode
 * cycle. Group headers ("Top Layers", "Bottom Layers") toggle every child
 * layer at once; per-layer eye icons toggle individuals. Copper layers may
 * be set as the active layer.
 */
export function PcbLayersPanel({
  activeLayer,
  lockedVisibleLayer = null,
  onSetActiveLayer,
  visibleLayers,
  onSetVisibleLayers,
  layerCount = 2,
  displayMode = "normal",
  onSetDisplayMode,
  copperFillLayers = [],
  onToggleCopperFillLayer,
  viewSide,
  onToggleViewSide,
  onSelectLayerPreset,
  perLayerOpacity,
  onSetLayerOpacity,
  soloLayer = null,
  onToggleSoloLayer,
}: PcbLayersPanelProps): ReactElement {
  const activePresetId = useMemo(
    () => detectLayerPreset(visibleLayers),
    [visibleLayers],
  );
  const visibleSet = useMemo(() => new Set(visibleLayers), [visibleLayers]);
  // Per-row expansion state for the opacity slider. Hidden by default to
  // keep the panel scannable; expand on chevron click.
  const [expandedOpacityRows, setExpandedOpacityRows] = useState<
    ReadonlySet<PcbLayerId>
  >(new Set());
  const toggleOpacityRow = useCallback((id: PcbLayerId) => {
    setExpandedOpacityRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const copperFillSet = useMemo(
    () => new Set(copperFillLayers),
    [copperFillLayers],
  );
  const [topOpen, setTopOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(true);

  const filteredNodes = useMemo(
    () =>
      PCB_LAYER_TREE.filter(
        (n) =>
          n.kind === "group" ||
          (n.requiresLayerCount ? layerCount >= n.requiresLayerCount : true),
      ),
    [layerCount],
  );

  const setVisibility = useCallback(
    (next: ReadonlySet<PcbLayerId>) => {
      const arr: PcbLayerId[] = [];
      next.forEach((id) => arr.push(id));
      // Always keep the edit/routing layer visible. Layer focus itself can be
      // cleared, but command-target copper must remain renderable.
      if (lockedVisibleLayer && !next.has(lockedVisibleLayer)) {
        arr.push(lockedVisibleLayer);
      }
      onSetVisibleLayers(arr);
    },
    [lockedVisibleLayer, onSetVisibleLayers],
  );

  const toggleLayer = useCallback(
    (id: PcbLayerId) => {
      const next = new Set(visibleSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setVisibility(next);
    },
    [setVisibility, visibleSet],
  );

  const toggleGroup = useCallback(
    (children: ReadonlyArray<PcbLayerId>) => {
      // If every child currently visible → hide all; otherwise show all.
      const allVisible = children.every((c) => visibleSet.has(c));
      const next = new Set(visibleSet);
      for (const c of children) {
        if (allVisible) next.delete(c);
        else next.add(c);
      }
      setVisibility(next);
    },
    [setVisibility, visibleSet],
  );

  // Track which sub-layers belong inside expanded groups so we hide them when
  // the group is collapsed (purely visual).
  const TOP_CHILDREN: ReadonlyArray<PcbLayerId> = [
    "F.SilkS",
    "F.Paste",
    "F.Mask",
    "F.Cu",
  ];
  const BOTTOM_CHILDREN: ReadonlyArray<PcbLayerId> = [
    "B.Cu",
    "B.Mask",
    "B.Paste",
    "B.SilkS",
  ];

  const groupOpen: Record<"group:top" | "group:bottom", boolean> = {
    "group:top": topOpen,
    "group:bottom": bottomOpen,
  };

  const isHidden = (node: LayerTreeNode): boolean => {
    if (node.kind === "group") return false;
    if (TOP_CHILDREN.includes(node.id) && !groupOpen["group:top"]) return true;
    if (BOTTOM_CHILDREN.includes(node.id) && !groupOpen["group:bottom"])
      return true;
    return false;
  };

  const handlePresetClick = useCallback(
    (preset: PcbLayerPresetId) => {
      onSelectLayerPreset?.(preset);
    },
    [onSelectLayerPreset],
  );

  return (
    <div className="flex flex-col">
      {viewSide && onToggleViewSide ? (
        <div className="flex justify-end px-2 py-1">
          <PcbSideModeButton viewSide={viewSide} onToggle={onToggleViewSide} />
        </div>
      ) : null}
      {onSelectLayerPreset ? (
        <div className="flex flex-wrap gap-1 border-b border-slate-200 px-2 py-2 dark:border-slate-800">
          {PCB_LAYER_PRESETS.map((preset) => {
            const active = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePresetClick(preset.id)}
                title={preset.description}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  active
                    ? "bg-violet-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredNodes.map((node) => {
          if (isHidden(node)) return null;
          if (node.kind === "group") {
            const open = groupOpen[node.id];
            const allVisible = node.children.every((c) => visibleSet.has(c));
            const anyVisible = node.children.some((c) => visibleSet.has(c));
            return (
              <div
                key={node.id}
                className="group flex items-center gap-1 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60"
              >
                <button
                  type="button"
                  onClick={() =>
                    node.id === "group:top"
                      ? setTopOpen((v) => !v)
                      : setBottomOpen((v) => !v)
                  }
                  className="shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-100"
                  title={open ? "Collapse group" : "Expand group"}
                >
                  {open ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
                <span className="flex-1 truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {node.label}
                </span>
                <button
                  type="button"
                  onClick={() => toggleGroup(node.children)}
                  className="shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-100"
                  title={allVisible ? "Hide all" : "Show all"}
                >
                  {anyVisible ? (
                    <Eye className="h-3 w-3" />
                  ) : (
                    <EyeOff className="h-3 w-3" />
                  )}
                </button>
              </div>
            );
          }

          const isActive = node.id === activeLayer;
          const isVisible = visibleSet.has(node.id);
          const color = PCB_LAYER_COLORS[node.id] ?? "#64748b";
          const isChild =
            TOP_CHILDREN.includes(node.id) || BOTTOM_CHILDREN.includes(node.id);
          const copperLayer = isCopperLayer(node.id) ? node.id : null;
          const copperFillActive =
            copperLayer !== null && copperFillSet.has(copperLayer);
          const isSoloed = soloLayer === node.id;
          const opacityValue = perLayerOpacity?.[node.id] ?? 1;
          const opacityExpanded = expandedOpacityRows.has(node.id);
          const handleRowClick = (
            event: MouseEvent<HTMLButtonElement>,
          ): void => {
            if (event.altKey && onToggleSoloLayer) {
              event.preventDefault();
              onToggleSoloLayer(node.id, node.activatable);
              return;
            }
            if (node.activatable) onSetActiveLayer(node.id);
          };
          return (
            <div key={node.id}>
              <div
                className={`group relative flex items-center gap-2 py-1 pr-2 ${
                  isChild ? "pl-7" : "pl-3"
                } ${
                  isActive
                    ? "bg-slate-200/70 dark:bg-slate-800/80"
                    : isSoloed
                      ? "bg-violet-100/70 dark:bg-violet-900/40"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 h-full w-1 rounded-r"
                    style={{ backgroundColor: color }}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={handleRowClick}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                  title={
                    onToggleSoloLayer
                      ? `${
                          node.activatable
                            ? isActive
                              ? `Clear focus: ${node.label}`
                              : `Focus: ${node.label}`
                            : node.label
                        } · Alt+click to solo`
                      : node.activatable
                        ? isActive
                          ? `Clear focus: ${node.label}`
                          : `Focus: ${node.label}`
                        : node.label
                  }
                >
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/20"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className={`truncate text-xs ${
                      isActive
                        ? "font-semibold text-slate-950 dark:text-slate-50"
                        : isVisible
                          ? "text-slate-700 dark:text-slate-300"
                          : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {node.label}
                  </span>
                  {isActive ? (
                    <span
                      className="ml-auto rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-950 ring-1 ring-black/10 dark:text-white"
                      style={{ backgroundColor: `${color}55` }}
                    >
                      Focus
                    </span>
                  ) : null}
                  {isSoloed ? (
                    <span
                      className="ml-auto inline-flex items-center gap-1 rounded bg-violet-600 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-white"
                      title="Soloed (Alt+click to exit)"
                    >
                      <Focus className="h-2.5 w-2.5" />
                      Solo
                    </span>
                  ) : null}
                </button>
                {onSetLayerOpacity ? (
                  <button
                    type="button"
                    onClick={() => toggleOpacityRow(node.id)}
                    title={
                      opacityExpanded
                        ? "Collapse opacity slider"
                        : "Expand opacity slider"
                    }
                    aria-label="Toggle opacity slider"
                    aria-expanded={opacityExpanded}
                    className={`shrink-0 rounded p-0.5 transition-colors ${
                      opacityExpanded
                        ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-white"
                        : opacityValue < 1
                          ? "text-violet-500 hover:text-violet-700"
                          : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-100"
                    }`}
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                  </button>
                ) : null}
                {copperLayer !== null && onToggleCopperFillLayer ? (
                  <button
                    type="button"
                    onClick={() => onToggleCopperFillLayer(copperLayer)}
                    title={
                      copperFillActive
                        ? "Hide copper fills"
                        : "Show copper fills"
                    }
                    className={`relative shrink-0 rounded p-0.5 transition-colors ${
                      copperFillActive
                        ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-white"
                        : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-100"
                    }`}
                  >
                    <Droplet className="h-3 w-3" />
                    {!copperFillActive ? (
                      <span
                        aria-hidden
                        className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-current"
                      />
                    ) : null}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => toggleLayer(node.id)}
                  disabled={node.id === lockedVisibleLayer}
                  title={isVisible ? "Hide layer" : "Show layer"}
                  className="shrink-0 rounded p-0.5 text-slate-400 transition-opacity hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:text-slate-100"
                >
                  {isVisible ? (
                    <Eye className="h-3 w-3" />
                  ) : (
                    <EyeOff className="h-3 w-3" />
                  )}
                </button>
              </div>
              {onSetLayerOpacity && opacityExpanded ? (
                <div
                  className={`flex items-center gap-2 pb-1 pr-2 ${
                    isChild ? "pl-7" : "pl-3"
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Opacity
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={opacityValue}
                    onChange={(e) =>
                      onSetLayerOpacity(node.id, Number(e.target.value))
                    }
                    aria-label={`${node.label} opacity`}
                    className="flex-1 accent-violet-600"
                  />
                  <span className="w-8 text-right text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {Math.round(opacityValue * 100)}%
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {onSetDisplayMode ? (
        <div className="border-t border-slate-200 px-2 py-2 dark:border-slate-800">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Display Mode
          </p>
          <div className="flex overflow-hidden rounded border border-slate-300 dark:border-slate-700">
            {DISPLAY_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSetDisplayMode(m.id)}
                className={`flex-1 px-1.5 py-1 text-[11px] ${
                  displayMode === m.id
                    ? "bg-violet-600 text-white"
                    : "bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
                title={`Display mode: ${m.label} (Ctrl+H)`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
