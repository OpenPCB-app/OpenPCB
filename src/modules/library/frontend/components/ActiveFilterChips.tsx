import type { ReactElement } from "react";
import { X } from "lucide-react";
import type { LibraryFacets } from "../../../../sdks/library";

const SOURCE_TAG_PREFIX = "source:";

export interface ActiveFilterChipsProps {
  activeFilters: ReadonlySet<string>;
  facets: LibraryFacets;
  onRemove: (token: string) => void;
  onClearAll: () => void;
}

/**
 * Strip above the results grid that mirrors the sidebar's active selections
 * as removable chips, plus a single "Clear all". Filter tokens are matched
 * back to their facet bucket so we can show a human label like
 * `Source: openpcb.core` instead of the raw token.
 */
export function ActiveFilterChips({
  activeFilters,
  facets,
  onRemove,
  onClearAll,
}: ActiveFilterChipsProps): ReactElement | null {
  if (activeFilters.size === 0) return null;
  const chips: Array<{ token: string; bucket: string; label: string }> = [];
  for (const token of activeFilters) {
    if (token.startsWith(SOURCE_TAG_PREFIX)) {
      const key = token.slice(SOURCE_TAG_PREFIX.length);
      const entry = facets.source.find((o) => o.key === key);
      chips.push({
        token,
        bucket: "Source",
        label: entry?.label ?? key,
      });
      continue;
    }
    // Find which bucket this token belongs to so the chip can carry a prefix.
    const buckets: Array<[string, readonly { key: string; label: string }[]]> =
      [
        ["Family", facets.family],
        ["Mount", facets.mount],
        ["Package", facets.package],
        ["Other", facets.other],
      ];
    let matched = false;
    for (const [bucketLabel, options] of buckets) {
      const hit = options.find((o) => o.key === token);
      if (hit) {
        chips.push({ token, bucket: bucketLabel, label: hit.label });
        matched = true;
        break;
      }
    }
    if (!matched) {
      chips.push({ token, bucket: "Tag", label: token });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.token}
          type="button"
          onClick={() => onRemove(chip.token)}
          className="group inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 py-0.5 pl-2 pr-1 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-300 dark:hover:bg-violet-900/60"
        >
          <span className="text-violet-500 dark:text-violet-400">
            {chip.bucket}:
          </span>
          <span>{chip.label}</span>
          <X className="h-3 w-3 opacity-60 group-hover:opacity-100" />
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
      >
        Clear all
      </button>
    </div>
  );
}
