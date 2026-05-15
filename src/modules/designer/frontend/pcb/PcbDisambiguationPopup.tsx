import { useEffect, useRef, type ReactElement } from "react";
import type { PcbHitCandidate } from "./pcb-hit";

/**
 * Floating disambiguation chooser shown after Alt+click on a stack of
 * overlapping primitives. Lists every candidate with a one-line label so
 * the user can click the exact item (or arrow-key + Enter, or repeat
 * Alt+click to cycle).
 *
 * Positioning is fixed in screen space at the click location. Closing is
 * any of: pick, Escape, click-outside.
 */
interface PopupItem {
  candidate: PcbHitCandidate;
  label: string;
}

export function PcbDisambiguationPopup({
  items,
  activeIndex,
  screenX,
  screenY,
  onPick,
  onClose,
  onCycle,
}: {
  items: ReadonlyArray<PopupItem>;
  activeIndex: number;
  screenX: number;
  screenY: number;
  onPick: (index: number) => void;
  onClose: () => void;
  onCycle: (direction: 1 | -1) => void;
}): ReactElement | null {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        onCycle(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        onCycle(-1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onPick(activeIndex);
        return;
      }
    };
    const handleClickOutside = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [activeIndex, onCycle, onClose, onPick]);

  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Disambiguation chooser"
      className="pointer-events-auto absolute z-50 min-w-[220px] rounded-md border border-slate-700 bg-slate-900/95 py-1 text-xs text-slate-100 shadow-xl backdrop-blur"
      style={{ left: screenX + 6, top: screenY + 6 }}
    >
      <div className="border-b border-slate-700 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">
        {items.length} items · Alt+click cycles · ↑↓ + Enter
      </div>
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          onClick={() => onPick(index)}
          className={`flex w-full items-center gap-2 px-2 py-1 text-left transition-colors ${
            index === activeIndex
              ? "bg-violet-600 text-white"
              : "hover:bg-slate-800"
          }`}
        >
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: kindColor(item.candidate) }}
          />
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function kindColor(c: PcbHitCandidate): string {
  switch (c.kind) {
    case "pad":
      return "#f59e0b";
    case "trace":
      return "#ff5757";
    case "via":
      return "#34d058";
    case "placement":
      return "#7c3aed";
  }
}

export function formatCandidateLabel(c: PcbHitCandidate): string {
  switch (c.kind) {
    case "pad":
      return `Pad ${c.hit.padNumber} on ${c.hit.placementId.slice(0, 6)}`;
    case "trace":
      return `Trace on ${c.hit.trace.layer}${
        c.hit.trace.netId ? ` (net ${c.hit.trace.netId.slice(0, 6)})` : ""
      }`;
    case "via":
      return `Via${c.via.netId ? ` (net ${c.via.netId.slice(0, 6)})` : ""}`;
    case "placement":
      return `Placement ${c.placement.reference}`;
  }
}
