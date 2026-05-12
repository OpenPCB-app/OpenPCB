import { useEffect, useRef, useState, type ReactElement } from "react";
import { Cable, FlipHorizontal2, Network } from "lucide-react";
import type { PcbLayerId, PcbTraceSegmentMode } from "../../../../sdks";
import { PCB_LAYER_COLORS } from "../../../../shared/frontend/canvas/layers";
import type { RoutePosture } from "./tools/route-tool-state";
import { VIA_PRESETS, type PcbViaPreset } from "../../backend/pcb/via-presets";

interface PcbTopToolbarProps {
  activeLayer: PcbLayerId;
  onSetActiveLayer: (layer: PcbLayerId) => void;
  selectedPlacementCount: number;
  onFlipSelection: () => void;
  ratsnestVisible: boolean;
  onToggleRatsnest: () => void;
  /** Current board view orientation. `"bottom"` mirrors the scene horizontally. */
  viewSide: "top" | "bottom";
  routeMode: boolean;
  routeSessionActive: boolean;
  onToggleRouteMode: () => void;
  segmentMode: PcbTraceSegmentMode;
  onToggleSegmentMode: () => void;
  activeWidthMm: number;
  tracePresets: ReadonlyArray<number>;
  onPickWidth: (widthMm: number) => void;
  /** Active via diameter (mm). When `viaDiameterOverride` is undefined this is the net-class default. */
  viaDiameterMm: number;
  /** Active via drill (mm). Same fallback semantics as diameter. */
  viaDrillMm: number;
  /** Net-class default; surfaced in the dropdown so the user can revert. */
  viaDiameterDefaultMm: number;
  viaDrillDefaultMm: number;
  /** Optional preset list for diameter/drill cycling. */
  viaDiameterPresets: ReadonlyArray<number>;
  viaDrillPresets: ReadonlyArray<number>;
  onPickViaDiameter: (mm: number | undefined) => void;
  onPickViaDrill: (mm: number | undefined) => void;
  /**
   * Apply a paired via preset (drill + diameter together). Net-class default
   * remains the implicit fallback when both overrides are cleared.
   */
  onPickViaPreset: (preset: PcbViaPreset) => void;
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

function ViaSizeDropdown({
  label,
  hotkeyTitle,
  activeMm,
  defaultMm,
  presets,
  onPick,
}: {
  label: "Ø" | "⌀";
  hotkeyTitle: string;
  activeMm: number;
  defaultMm: number;
  presets: ReadonlyArray<number>;
  onPick: (mm: number | undefined) => void;
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

  const isOverride = Math.abs(activeMm - defaultMm) > 1e-9;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={hotkeyTitle}
        className={`inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${
          isOverride
            ? "text-violet-600 dark:text-violet-300"
            : "text-slate-500 dark:text-slate-300"
        }`}
      >
        <span>{label}</span>
        <span className="font-mono text-slate-700 dark:text-slate-200">
          {activeMm.toFixed(2)}
        </span>
        <span className="text-slate-400">mm</span>
        <span aria-hidden className="text-slate-400">
          ▾
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-[160px] overflow-hidden rounded-md border border-slate-200 bg-white text-xs shadow-xl dark:border-slate-700 dark:bg-slate-950">
          <button
            type="button"
            onClick={() => {
              onPick(undefined);
              setOpen(false);
            }}
            className={`block w-full px-3 py-1.5 text-left ${
              !isOverride
                ? "bg-violet-600 text-white"
                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            }`}
          >
            Net-class default ({defaultMm.toFixed(2)} mm)
          </button>
          {presets.map((mm) => {
            const active = Math.abs(mm - activeMm) < 1e-6 && isOverride;
            return (
              <button
                key={mm}
                type="button"
                onClick={() => {
                  onPick(mm);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1.5 text-left font-mono ${
                  active
                    ? "bg-violet-600 text-white"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                {mm.toFixed(2)} mm
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              const input = window.prompt(
                `Custom ${label === "Ø" ? "diameter" : "drill"} (mm):`,
                activeMm.toString(),
              );
              if (input !== null) {
                const next = Number(input);
                if (Number.isFinite(next) && next > 0) onPick(next);
              }
              setOpen(false);
            }}
            className="block w-full border-t border-slate-200 px-3 py-1.5 text-left text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Custom…
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ViaPresetDropdown({
  activeDiameterMm,
  activeDrillMm,
  onPick,
}: {
  activeDiameterMm: number;
  activeDrillMm: number;
  onPick: (preset: PcbViaPreset) => void;
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

  const matched = VIA_PRESETS.find(
    (p) =>
      Math.abs(p.diameterMm - activeDiameterMm) < 1e-6 &&
      Math.abs(p.drillMm - activeDrillMm) < 1e-6,
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Via preset (paired drill + diameter)"
        className="inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <span className="text-slate-700 dark:text-slate-200">
          {matched?.name ?? "Custom"}
        </span>
        <span aria-hidden className="text-slate-400">
          ▾
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-[260px] overflow-hidden rounded-md border border-slate-200 bg-white text-xs shadow-xl dark:border-slate-700 dark:bg-slate-950">
          {VIA_PRESETS.map((preset) => {
            const active = matched?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onPick(preset);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1.5 text-left ${
                  active
                    ? "bg-violet-600 text-white"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3 font-mono">
                  <span className="font-sans font-medium">{preset.name}</span>
                  <span>
                    {preset.drillMm.toFixed(2)} / {preset.diameterMm.toFixed(2)}{" "}
                    mm
                  </span>
                </div>
                <div
                  className={`text-[10px] ${active ? "text-violet-100" : "text-slate-500 dark:text-slate-400"}`}
                >
                  {preset.description}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function PcbTopToolbar({
  activeLayer,
  onSetActiveLayer,
  selectedPlacementCount,
  onFlipSelection,
  ratsnestVisible,
  onToggleRatsnest,
  viewSide,
  routeMode,
  routeSessionActive,
  onToggleRouteMode,
  segmentMode,
  onToggleSegmentMode,
  activeWidthMm,
  tracePresets,
  onPickWidth,
  viaDiameterMm,
  viaDrillMm,
  viaDiameterDefaultMm,
  viaDrillDefaultMm,
  viaDiameterPresets,
  viaDrillPresets,
  onPickViaDiameter,
  onPickViaDrill,
  onPickViaPreset,
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
        title="Switch active layer and mirror view (Top ↔ Bottom)"
        aria-pressed={viewSide === "bottom"}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
          viewSide === "bottom"
            ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
            : "border-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        }`}
      >
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
        {layerLabel}
      </button>

      <button
        type="button"
        onClick={onFlipSelection}
        disabled={selectedPlacementCount === 0}
        title={
          selectedPlacementCount === 0
            ? "Select a placement, then F to flip to the other side"
            : `Flip ${selectedPlacementCount} placement${selectedPlacementCount === 1 ? "" : "s"} to the opposite side (F)`
        }
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800 dark:disabled:hover:bg-transparent"
      >
        <FlipHorizontal2 className="h-3.5 w-3.5" />
        Flip
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
        Route (R)
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
          {routeSessionActive ? (
            <>
              <ViaPresetDropdown
                activeDiameterMm={viaDiameterMm}
                activeDrillMm={viaDrillMm}
                onPick={onPickViaPreset}
              />
              <ViaSizeDropdown
                label="Ø"
                hotkeyTitle="Via diameter (route-time override)"
                activeMm={viaDiameterMm}
                defaultMm={viaDiameterDefaultMm}
                presets={viaDiameterPresets}
                onPick={onPickViaDiameter}
              />
              <ViaSizeDropdown
                label="⌀"
                hotkeyTitle="Via drill (route-time override)"
                activeMm={viaDrillMm}
                defaultMm={viaDrillDefaultMm}
                presets={viaDrillPresets}
                onPick={onPickViaDrill}
              />
            </>
          ) : null}
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
        Ratsnest
      </button>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
    </div>
  );
}
