import { Filter, X } from "lucide-react";
import type { ReactElement } from "react";

/**
 * Floating selection-filter panel — per primitive-kind opt-out for both
 * single-click and marquee selection. Mirrors KiCad's Selection Filter:
 * disabling "Vias" makes via primitives unselectable without hiding them
 * visually, so the user can drag-select a region without grabbing the via
 * underneath. Toggle visibility with the `F` hotkey.
 *
 * Filters are session-scoped (not persisted to board_settings) — they're
 * an interaction preference, not a property of the design.
 */
export type SelectionFilterKind = "traces" | "vias" | "pads" | "placements";

interface FilterState {
  traces: boolean;
  vias: boolean;
  pads: boolean;
  placements: boolean;
}

const KINDS: ReadonlyArray<{
  id: SelectionFilterKind;
  label: string;
  hint: string;
}> = [
  { id: "traces", label: "Traces", hint: "Routed copper segments" },
  { id: "vias", label: "Vias", hint: "Through-hole vias" },
  { id: "pads", label: "Pads", hint: "Component pads" },
  { id: "placements", label: "Components", hint: "Placed footprints" },
];

export function PcbSelectionFilter({
  filter,
  onChange,
  onClose,
}: {
  filter: FilterState;
  onChange: (kind: SelectionFilterKind, enabled: boolean) => void;
  onClose: () => void;
}): ReactElement {
  return (
    <div
      role="dialog"
      aria-label="Selection filter"
      className="pointer-events-auto absolute right-3 top-16 z-30 w-56 rounded-md border border-slate-700 bg-slate-900/95 shadow-xl backdrop-blur"
    >
      <div className="flex items-center justify-between border-b border-slate-700 px-2 py-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
          <Filter className="size-3" />
          Selection filter
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filter panel"
          className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="space-y-1 p-2">
        {KINDS.map((k) => {
          const enabled = filter[k.id];
          return (
            <label
              key={k.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-800"
              title={k.hint}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => onChange(k.id, e.target.checked)}
                className="size-3.5 accent-violet-600"
              />
              <span
                className={`flex-1 text-xs ${
                  enabled ? "text-slate-100" : "text-slate-500 line-through"
                }`}
              >
                {k.label}
              </span>
              <span className="text-[10px] text-slate-500">{k.hint}</span>
            </label>
          );
        })}
      </div>
      <div className="border-t border-slate-700 px-2 py-1 text-[10px] text-slate-500">
        Press <kbd className="rounded border border-slate-600 px-1">F</kbd> to
        toggle.
      </div>
    </div>
  );
}
