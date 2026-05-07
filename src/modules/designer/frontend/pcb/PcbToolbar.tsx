import { useEffect, useRef, useState, type ReactElement } from "react";
import type { PcbLayerId, PcbTraceSegmentMode } from "../../../../sdks";
import { PCB_LAYER_COLORS } from "../../../../shared/frontend/canvas/layers";
import type { RoutePosture } from "./tools/route-tool-state";

interface PcbToolbarProps {
  activeLayer: PcbLayerId;
  onSetActiveLayer: (layer: PcbLayerId) => void;
  ratsnestVisible: boolean;
  onToggleRatsnest: () => void;
  drcCount: number;
  routeMode: boolean;
  onToggleRouteMode: () => void;
  segmentMode: PcbTraceSegmentMode;
  onToggleSegmentMode: () => void;
  activeWidthMm: number;
  /** Board-level preset list shown in the width dropdown. */
  tracePresets: ReadonlyArray<number>;
  /** Apply a width selection from the dropdown (or a custom value). */
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
        className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-100 shadow-md backdrop-blur hover:border-slate-500 hover:bg-slate-800"
      >
        <span>W</span>
        <span className="font-mono">{activeWidthMm.toFixed(3)}</span>
        <span className="text-slate-400">mm</span>
        <span aria-hidden className="text-slate-500">
          ▾
        </span>
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 mb-2 min-w-[140px] overflow-hidden rounded-md border border-slate-700 bg-slate-950 text-xs shadow-xl">
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
                    : "text-slate-200 hover:bg-slate-800"
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
            className="block w-full border-t border-slate-800 px-3 py-1.5 text-left text-slate-300 hover:bg-slate-800"
          >
            Custom… (Alt+W)
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PcbToolbar({
  activeLayer,
  onSetActiveLayer,
  ratsnestVisible,
  onToggleRatsnest,
  drcCount,
  routeMode,
  onToggleRouteMode,
  segmentMode,
  onToggleSegmentMode,
  activeWidthMm,
  tracePresets,
  onPickWidth,
  posture,
  onCyclePosture,
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
          onClick={onToggleRouteMode}
          title="Route trace (R)"
          className={`rounded-full border px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur transition ${
            routeMode
              ? "border-violet-500 bg-violet-600 text-white hover:bg-violet-500"
              : "border-slate-700 bg-slate-900/80 text-slate-100 hover:border-slate-500 hover:bg-slate-800"
          }`}
        >
          {routeMode ? "Routing (R)" : "Route (R)"}
        </button>
        {routeMode ? (
          <>
            <button
              type="button"
              onClick={onToggleSegmentMode}
              title="Toggle 45°/90° corner (Shift+Space)"
              className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-100 shadow-md backdrop-blur hover:border-slate-500 hover:bg-slate-800"
            >
              {segmentMode === "manhattan-45" ? "45°" : "90°"}
            </button>
            <button
              type="button"
              onClick={onCyclePosture}
              title="Track posture: auto / axis-first / diagonal-first (/)"
              className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-100 shadow-md backdrop-blur hover:border-slate-500 hover:bg-slate-800"
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
