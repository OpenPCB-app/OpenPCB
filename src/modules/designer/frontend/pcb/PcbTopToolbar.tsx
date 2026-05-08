import { useEffect, useRef, useState, type ReactElement } from "react";
import { Cable, Network, Sparkles } from "lucide-react";
import type { PcbLayerId, PcbTraceSegmentMode } from "../../../../sdks";
import { PCB_LAYER_COLORS } from "../../../../shared/frontend/canvas/layers";
import type { RoutePosture } from "./tools/route-tool-state";

interface PcbTopToolbarProps {
  activeLayer: PcbLayerId;
  onSetActiveLayer: (layer: PcbLayerId) => void;
  ratsnestVisible: boolean;
  onToggleRatsnest: () => void;
  routeMode: boolean;
  onToggleRouteMode: () => void;
  segmentMode: PcbTraceSegmentMode;
  onToggleSegmentMode: () => void;
  activeWidthMm: number;
  tracePresets: ReadonlyArray<number>;
  onPickWidth: (widthMm: number) => void;
  posture: RoutePosture;
  onCyclePosture: () => void;
}

const LAYER_LABELS: Partial<Record<PcbLayerId, string>> = {
  "F.Cu": "Top Copper",
  "B.Cu": "Bottom Copper",
};

const POSTURE_LABEL: Record<RoutePosture, string> = {
  auto: "Auto",
  axis: "Axis",
  diagonal: "Diag",
};

function WidthDropdown({
  activeWidthMm,
  presets,
  onPick,
}: {
  activeWidthMm: number;
  presets: ReadonlyArray<number>;
  onPick: (widthMm: number) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Trace width — W cycles forward, Shift+W backward, Alt+W custom"
        className="inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <span>W</span>
        <span className="font-mono text-slate-700 dark:text-slate-200">
          {activeWidthMm.toFixed(3)}
        </span>
        <span className="text-slate-400">mm</span>
        <span aria-hidden className="text-slate-400">
          ▾
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-[140px] overflow-hidden rounded-md border border-slate-200 bg-white text-xs shadow-xl dark:border-slate-700 dark:bg-slate-950">
          {presets.map((w) => {
            const active = Math.abs(w - activeWidthMm) < 1e-6;
            return (
              <button
                key={w}
                type="button"
                onClick={() => {
                  onPick(w);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1.5 text-left font-mono ${
                  active
                    ? "bg-violet-600 text-white"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                {w.toFixed(3)} mm
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              const input = window.prompt(
                "Custom trace width (mm):",
                activeWidthMm.toString(),
              );
              if (input !== null) {
                const next = Number(input);
                if (Number.isFinite(next) && next > 0) onPick(next);
              }
              setOpen(false);
            }}
            className="block w-full border-t border-slate-200 px-3 py-1.5 text-left text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Custom… (Alt+W)
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PcbTopToolbar({
  activeLayer,
  onSetActiveLayer,
  ratsnestVisible,
  onToggleRatsnest,
  routeMode,
  onToggleRouteMode,
  segmentMode,
  onToggleSegmentMode,
  activeWidthMm,
  tracePresets,
  onPickWidth,
  posture,
  onCyclePosture,
}: PcbTopToolbarProps): ReactElement {
  const flipped: PcbLayerId =
    activeLayer === "F.Cu" ? "B.Cu" : activeLayer === "B.Cu" ? "F.Cu" : "F.Cu";
  const layerLabel = LAYER_LABELS[activeLayer] ?? activeLayer;
  const dotColor = PCB_LAYER_COLORS[activeLayer];

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/90">
      <button
        type="button"
        onClick={() => onSetActiveLayer(flipped)}
        title="Click to flip active copper layer"
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
        {layerLabel}
      </button>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <button
        type="button"
        onClick={onToggleRouteMode}
        title="Route trace (R)"
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
          routeMode
            ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
            : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        }`}
        aria-pressed={routeMode}
      >
        <Cable className="h-3.5 w-3.5" />
        {routeMode ? "Routing (R)" : "Route (R)"}
      </button>

      {routeMode ? (
        <>
          <button
            type="button"
            onClick={onToggleSegmentMode}
            title="Toggle 45°/90° corner (Shift+Space)"
            className="inline-flex h-7 items-center rounded-md border border-transparent px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {segmentMode === "manhattan-45" ? "45°" : "90°"}
          </button>
          <button
            type="button"
            onClick={onCyclePosture}
            title="Track posture: auto / axis-first / diagonal-first (/)"
            className="inline-flex h-7 items-center rounded-md border border-transparent px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {POSTURE_LABEL[posture]}
          </button>
          <WidthDropdown
            activeWidthMm={activeWidthMm}
            presets={tracePresets}
            onPick={onPickWidth}
          />
        </>
      ) : null}

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <button
        type="button"
        onClick={onToggleRatsnest}
        title="Toggle ratsnest visibility (B)"
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
          ratsnestVisible
            ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
            : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        }`}
        aria-pressed={ratsnestVisible}
      >
        <Network className="h-3.5 w-3.5" />
        {ratsnestVisible ? "Ratsnest On" : "Ratsnest Off"}
      </button>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <span
        title="Auto-routing arrives in Phase 4"
        aria-disabled
        className="inline-flex h-7 cursor-not-allowed items-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-slate-400 dark:text-slate-500"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Auto-Layout
      </span>
    </div>
  );
}
