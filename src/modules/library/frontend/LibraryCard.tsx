import type { ReactElement } from "react";
import type { LibraryComponent } from "../../../sdks/library";
import { classifyTag, type TagGroupId } from "./tag-grouping";

const SYMBOL_GLYPHS: Array<[RegExp, string]> = [
  [/(^|[-_/])ground($|[-_/])/, "GND"],
  [/(^|[-_/])vcc($|[-_/])/, "VCC"],
  [/(^|[-_/])resistor($|[-_/])/, "R"],
  [/(^|[-_/])capacitor($|[-_/])/, "C"],
  [/(^|[-_/])inductor($|[-_/])/, "L"],
];

const CHIP_LIMIT = 4;
const CHIP_PRIORITY: TagGroupId[] = ["family", "package", "mount", "other"];

function previewGlyph(component: LibraryComponent): string {
  const symbol = component.symbolId.toLowerCase();
  for (const [pattern, glyph] of SYMBOL_GLYPHS) {
    if (pattern.test(symbol)) {
      return glyph;
    }
  }

  const fallback = component.name.trim().charAt(0).toUpperCase();
  return fallback.length > 0 ? fallback : "U";
}

interface CardChipsResult {
  visible: string[];
  hidden: number;
  hasPlaceholderFootprint: boolean;
}

function cardChips(component: LibraryComponent): CardChipsResult {
  const buckets = new Map<TagGroupId, string[]>();
  let hasPlaceholderFootprint = false;
  for (const raw of component.tags) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === "placeholder-footprint") {
      hasPlaceholderFootprint = true;
      continue;
    }
    const group = classifyTag(normalized);
    if (group === "system") continue;
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group)!.push(normalized);
  }

  const visible: string[] = [];
  for (const group of CHIP_PRIORITY) {
    const list = buckets.get(group);
    if (!list) continue;
    for (const tag of list) {
      if (visible.length >= CHIP_LIMIT) break;
      visible.push(tag);
    }
    if (visible.length >= CHIP_LIMIT) break;
  }

  const allCount = Array.from(buckets.values()).reduce(
    (sum, list) => sum + list.length,
    0,
  );
  const hidden = Math.max(0, allCount - visible.length);
  return { visible, hidden, hasPlaceholderFootprint };
}

export function LibraryCard({
  component,
  selected,
  onOpen,
  onToggleSelect,
}: {
  component: LibraryComponent;
  selected?: boolean;
  onOpen: (componentId: string) => void;
  onToggleSelect?: (componentId: string) => void;
}): ReactElement {
  const glyph = previewGlyph(component);
  const {
    visible: chips,
    hidden,
    hasPlaceholderFootprint,
  } = cardChips(component);
  const isBuiltin = component.isBuiltin;

  const borderClass = selected
    ? "border-violet-500 dark:border-violet-500"
    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700";

  return (
    <div
      className={`group relative flex h-56 w-full flex-col overflow-hidden rounded-xl border bg-white text-left transition-all hover:shadow-sm dark:bg-slate-900 ${borderClass}`}
    >
      {!isBuiltin && (
        <label className="absolute left-2 top-2 z-10 inline-flex items-center rounded-sm bg-white/90 p-0.5 dark:bg-slate-900/90">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(component.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${component.name}`}
            className="h-4 w-4 cursor-pointer rounded border-slate-300 text-violet-600 focus:ring-violet-600 dark:border-slate-600"
          />
        </label>
      )}
      {isBuiltin && (
        <span
          className="absolute right-2 top-2 z-10 inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
          title="Built-in component — read-only. Use Duplicate to edit."
        >
          Core
        </span>
      )}
      <button
        type="button"
        onClick={() => onOpen(component.id)}
        className="flex h-full w-full flex-col text-left focus:outline-none focus:ring-2 focus:ring-violet-500"
        data-testid={`library-component-card-${component.id}`}
      >
        <div className="relative flex h-22 items-center justify-center border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
          <span className="text-3xl font-semibold tracking-tight text-slate-400 dark:text-slate-500">
            {glyph}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-3">
          <h3 className="truncate text-sm font-semibold leading-tight text-slate-900 dark:text-slate-100">
            {component.name}
          </h3>
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-500 dark:text-slate-400">
            {component.description || "No description"}
          </p>

          <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
            {hasPlaceholderFootprint && (
              <span
                className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[0.6875rem] font-medium text-violet-700 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-300"
                title="Component imported without a footprint"
              >
                No footprint
              </span>
            )}
            {chips.map((chip) => (
              <span
                key={`${component.id}-${chip}`}
                className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[0.6875rem] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
              >
                {chip}
              </span>
            ))}
            {hidden > 0 && (
              <span
                className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[0.6875rem] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-500"
                title={`${hidden} more tag${hidden === 1 ? "" : "s"}`}
              >
                +{hidden}
              </span>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}
