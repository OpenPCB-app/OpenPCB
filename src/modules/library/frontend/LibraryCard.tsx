import type { ReactElement } from "react";
import type { LibraryComponent } from "../../../core/contracts/modules/sdk";

const SYMBOL_GLYPHS: Array<[RegExp, string]> = [
  [/(^|[-_/])ground($|[-_/])/, "GND"],
  [/(^|[-_/])vcc($|[-_/])/, "VCC"],
  [/(^|[-_/])resistor($|[-_/])/, "R"],
  [/(^|[-_/])capacitor($|[-_/])/, "C"],
  [/(^|[-_/])inductor($|[-_/])/, "L"],
];

const MOUNT_TAGS = new Set(["smd", "through-hole", "tht", "virtual"]);

function compactToken(id: string): string {
  return id
    .replace(/^(sym|fp|comp)-/i, "")
    .replace(/-/g, " ")
    .trim();
}

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

function cardChips(component: LibraryComponent): string[] {
  const chips: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const value = raw.trim();
    if (value.length === 0) {
      return;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    chips.push(value);
  };

  const packageTag = component.tags.find((tag) => /^\d{4}$/.test(tag));
  if (packageTag) {
    push(packageTag);
  }
  const mountTag = component.tags.find((tag) =>
    MOUNT_TAGS.has(tag.toLowerCase()),
  );
  if (mountTag) {
    push(mountTag);
  }
  push(compactToken(component.footprintId));

  return chips.slice(0, 2);
}

export function LibraryCard({
  component,
  onOpen,
}: {
  component: LibraryComponent;
  onOpen: (componentId: string) => void;
}): ReactElement {
  const glyph = previewGlyph(component);
  const chips = cardChips(component);

  return (
    <button
      type="button"
      onClick={() => onOpen(component.id)}
      className="group relative flex h-56 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-all hover:border-slate-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
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
          {chips.map((chip) => (
            <span
              key={`${component.id}-${chip}`}
              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[0.6875rem] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}
