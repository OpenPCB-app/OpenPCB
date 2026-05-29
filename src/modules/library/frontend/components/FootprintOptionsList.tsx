import { useRef, type KeyboardEvent, type ReactElement } from "react";
import type { ComponentFootprintVariant } from "../types";

interface FootprintOptionsListProps {
  variants: ComponentFootprintVariant[];
  selectedFootprintId: string;
  onSelect: (footprintId: string) => void;
  backendURL: string | null | undefined;
  moduleId: string;
  themeMode: string;
}

/**
 * Selectable footprint-option spine. Pure local selection (no command/persist).
 * Implemented as a keyboard-operable radiogroup.
 */
export function FootprintOptionsList({
  variants,
  selectedFootprintId,
  onSelect,
  backendURL,
  moduleId,
  themeMode,
}: FootprintOptionsListProps): ReactElement {
  const sorted = variants.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  const moveSelection = (currentIndex: number, delta: number) => {
    const nextIndex = (currentIndex + delta + sorted.length) % sorted.length;
    const next = sorted[nextIndex];
    if (next) {
      onSelect(next.footprintId);
      rowRefs.current[nextIndex]?.focus();
    }
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    index: number,
    footprintId: string,
  ) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        moveSelection(index, 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        moveSelection(index, -1);
        break;
      case " ":
      case "Enter":
        event.preventDefault();
        onSelect(footprintId);
        break;
      default:
        break;
    }
  };

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Footprint options
        </span>
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          {sorted.length}
        </span>
      </header>

      {/* `relative flex-1` collapses to zero intrinsic height (the absolute
          child doesn't count), so the options count never dictates the row
          height — the list scrolls to fit the height set by sibling cards. */}
      <div className="relative flex-1">
        <div
          role="radiogroup"
          aria-label="Footprint options"
          className="absolute inset-0 flex flex-col gap-1 overflow-y-auto p-2"
          data-testid="component-footprint-variants"
        >
          {sorted.map((variant, index) => {
            const selected = variant.footprintId === selectedFootprintId;
            return (
              <div
                key={variant.footprintId}
                ref={(node) => {
                  rowRefs.current[index] = node;
                }}
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(variant.footprintId)}
                onKeyDown={(event) =>
                  handleKeyDown(event, index, variant.footprintId)
                }
                data-testid={`component-footprint-variant-${variant.footprintId}`}
                className={`group grid cursor-pointer grid-cols-[44px_1fr_auto] items-center gap-3 rounded-lg border px-2.5 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  selected
                    ? "border-violet-300 bg-violet-50 dark:border-violet-700/60 dark:bg-violet-950/40"
                    : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60"
                }`}
              >
                <div className="flex h-8 w-11 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  {backendURL ? (
                    <img
                      src={`${backendURL}/api/modules/${moduleId}/footprints/${encodeURIComponent(
                        variant.footprintId,
                      )}/preview.svg?theme=${themeMode}`}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain p-0.5"
                    />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {variant.variantLabel}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400 dark:text-slate-500">
                    {variant.name}
                  </div>
                </div>
                <div className="text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  <div className="whitespace-nowrap">
                    {variant.mountType ?? "—"} · {variant.padCount} pads
                  </div>
                  {variant.isDefault ? (
                    <span className="mt-1 inline-block rounded-md border border-violet-300 bg-violet-50 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-violet-600 dark:border-violet-700/60 dark:bg-violet-950/50 dark:text-violet-300">
                      Default
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="border-t border-slate-200 px-4 py-3 text-[11.5px] leading-relaxed text-slate-400 dark:border-slate-800 dark:text-slate-500">
        Select an option to preview its footprint &amp; 3D model. The{" "}
        <span className="font-semibold text-violet-600 dark:text-violet-300">
          DEFAULT
        </span>{" "}
        is used when you place the part.
      </p>
    </section>
  );
}
