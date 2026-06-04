import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  Cable,
  CircleDot,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Magnet,
  Minus,
  Network,
  Plus,
  Redo2,
  Ruler,
  ScanSearch,
  ShieldAlert,
  Square,
  Type,
  Undo2,
} from "lucide-react";
import type { PcbTraceSegmentMode } from "../../../../sdks";
import type { RoutePosture } from "./tools/route-tool-state";
import { VIA_PRESETS, type PcbViaPreset } from "../../backend/pcb/via-presets";

interface PcbTopToolbarProps {
  selectedPlacementCount: number;
  onFlipSelection: () => void;
  ratsnestVisible: boolean;
  onToggleRatsnest: () => void;
  /** Figma-style alignment guides + magnetic snap (Shift+G). */
  alignmentGuidesVisible: boolean;
  onToggleAlignmentGuides: () => void;
  /** Whether the in-PCB-tab DRC results dock is open. */
  drcPanelOpen: boolean;
  onToggleDrcPanel: () => void;
  /** Active batch-DRC error count; drives the red alarm dot on the button. */
  drcErrorCount?: number;
  /** Whether DRC violation markers are drawn on the canvas. */
  drcMarkersVisible: boolean;
  onToggleDrcMarkers: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  routeMode: boolean;
  routeSessionActive: boolean;
  onToggleRouteMode: () => void;
  measureMode: boolean;
  onToggleMeasureMode: () => void;
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
  /** F5 mounting-hole drop tool. Click on canvas drops a free hole. */
  holeMode: boolean;
  onToggleHoleMode: () => void;
  /** F5 free-pad drop tool. Click on canvas drops a free SMD pad. */
  padMode: boolean;
  onTogglePadMode: () => void;
  /** F5 overlay-text drop tool. Click on canvas opens prompt → silkscreen label. */
  textMode: boolean;
  onToggleTextMode: () => void;
}

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

function AddDropdown({
  holeMode,
  onToggleHoleMode,
  padMode,
  onTogglePadMode,
  textMode,
  onToggleTextMode,
}: {
  holeMode: boolean;
  onToggleHoleMode: () => void;
  padMode: boolean;
  onTogglePadMode: () => void;
  textMode: boolean;
  onToggleTextMode: () => void;
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

  const items = [
    {
      key: "hole",
      label: "Hole",
      hotkey: "H",
      title:
        "Drop mounting hole (H) — click on the board to place a 3.2 mm hole",
      Icon: CircleDot,
      active: holeMode,
      onToggle: onToggleHoleMode,
      activeClass:
        "border-lime-500 bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300",
    },
    {
      key: "pad",
      label: "Pad",
      hotkey: "P",
      title:
        "Drop free pad (P) — click on the board to place a free SMD pad on the active copper layer",
      Icon: Square,
      active: padMode,
      onToggle: onTogglePadMode,
      activeClass:
        "border-amber-500 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    },
    {
      key: "text",
      label: "Text",
      hotkey: "T",
      title:
        "Add silkscreen text (T) — click on the board, then type the label",
      Icon: Type,
      active: textMode,
      onToggle: onToggleTextMode,
      activeClass:
        "border-cyan-500 bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
    },
  ] as const;

  const activeItem = items.find((it) => it.active);
  const ButtonIcon = activeItem ? activeItem.Icon : Plus;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          activeItem ? activeItem.title : "Add hole, pad, or silkscreen text"
        }
        aria-pressed={Boolean(activeItem)}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
          activeItem
            ? activeItem.activeClass
            : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        }`}
      >
        <ButtonIcon className="h-3.5 w-3.5" />
        {activeItem ? activeItem.label : "Add"}
        <span aria-hidden className="text-slate-400">
          ▾
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-[160px] overflow-hidden rounded-md border border-slate-200 bg-white text-xs shadow-xl dark:border-slate-700 dark:bg-slate-950">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              title={it.title}
              onClick={() => {
                it.onToggle();
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                it.active
                  ? "bg-violet-600 text-white"
                  : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              <it.Icon className="h-3.5 w-3.5" />
              <span className="flex-1">{it.label}</span>
              <span
                className={`font-mono ${it.active ? "text-violet-100" : "text-slate-400"}`}
              >
                {it.hotkey}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PcbTopToolbar({
  selectedPlacementCount,
  onFlipSelection,
  ratsnestVisible,
  onToggleRatsnest,
  alignmentGuidesVisible,
  onToggleAlignmentGuides,
  drcPanelOpen,
  onToggleDrcPanel,
  drcErrorCount,
  drcMarkersVisible,
  onToggleDrcMarkers,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFit,
  routeMode,
  routeSessionActive,
  onToggleRouteMode,
  measureMode,
  onToggleMeasureMode,
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
  holeMode,
  onToggleHoleMode,
  padMode,
  onTogglePadMode,
  textMode,
  onToggleTextMode,
}: PcbTopToolbarProps): ReactElement {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/90">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (⌘/Ctrl+Z)"
        aria-label="Undo"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (⌘/Ctrl+Shift+Z)"
        aria-label="Redo"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <Redo2 className="h-3.5 w-3.5" />
      </button>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <button
        type="button"
        onClick={onZoomOut}
        title="Zoom out"
        aria-label="Zoom out"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        title="Zoom in"
        aria-label="Zoom in"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onFit}
        title="Fit"
        aria-label="Fit board"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <ScanSearch className="h-3.5 w-3.5" />
      </button>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <button
        type="button"
        onClick={onFlipSelection}
        disabled={selectedPlacementCount === 0}
        title={
          selectedPlacementCount === 0
            ? "Select a placement, then F to flip it to the other side"
            : `Flip ${selectedPlacementCount} placement${selectedPlacementCount === 1 ? "" : "s"} to the opposite side (F)`
        }
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800 dark:disabled:hover:bg-transparent"
      >
        <FlipHorizontal2 className="h-3.5 w-3.5" />
        Flip part
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

      <button
        type="button"
        onClick={onToggleMeasureMode}
        title="Measure distance (M)"
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
          measureMode
            ? "border-sky-500 bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
            : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        }`}
        aria-pressed={measureMode}
      >
        <Ruler className="h-3.5 w-3.5" />
        Measure (M)
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

      <AddDropdown
        holeMode={holeMode}
        onToggleHoleMode={onToggleHoleMode}
        padMode={padMode}
        onTogglePadMode={onTogglePadMode}
        textMode={textMode}
        onToggleTextMode={onToggleTextMode}
      />

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <button
        type="button"
        onClick={onToggleRatsnest}
        title="Toggle ratsnest visibility (Shift+B)"
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

      <button
        type="button"
        onClick={onToggleAlignmentGuides}
        title="Toggle alignment guides + snap (Shift+G)"
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
          alignmentGuidesVisible
            ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
            : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        }`}
        aria-pressed={alignmentGuidesVisible}
      >
        <Magnet className="h-3.5 w-3.5" />
        Guides
      </button>

      <button
        type="button"
        onClick={onToggleDrcPanel}
        title="Toggle DRC panel"
        className={`relative inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
          drcPanelOpen
            ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
            : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        }`}
        aria-pressed={drcPanelOpen}
      >
        <ShieldAlert className="h-3.5 w-3.5" />
        DRC
        {drcErrorCount !== undefined && drcErrorCount > 0 ? (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900"
          />
        ) : null}
      </button>

      <button
        type="button"
        onClick={onToggleDrcMarkers}
        title={
          drcMarkersVisible
            ? "Hide DRC markers on the board"
            : "Show DRC markers on the board"
        }
        aria-label={drcMarkersVisible ? "Hide DRC markers" : "Show DRC markers"}
        aria-pressed={!drcMarkersVisible}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs transition-colors ${
          drcMarkersVisible
            ? "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            : "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
        }`}
      >
        {drcMarkersVisible ? (
          <Eye className="h-3.5 w-3.5" />
        ) : (
          <EyeOff className="h-3.5 w-3.5" />
        )}
      </button>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
    </div>
  );
}
