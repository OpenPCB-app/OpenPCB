import { useMemo, useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type {
  LibraryFacetBucket,
  LibraryFacetOption,
  LibraryFacets,
} from "../../../../sdks/library";

const SOURCE_TAG_PREFIX = "source:";
/** Show this many options per section before "show more" reveals the rest. */
const COLLAPSE_THRESHOLD = 6;
/** Sections beyond this size also get a search-within-facet input. */
const SEARCH_WITHIN_THRESHOLD = 10;

interface SectionConfig {
  bucket: Exclude<LibraryFacetBucket, never>;
  label: string;
  prefix: string; // tag prefix to emit (empty for plain tags)
}

const SECTIONS: SectionConfig[] = [
  { bucket: "source", label: "Source", prefix: SOURCE_TAG_PREFIX },
  { bucket: "family", label: "Family", prefix: "" },
  { bucket: "mount", label: "Mount", prefix: "" },
  { bucket: "package", label: "Package", prefix: "" },
  { bucket: "other", label: "Other", prefix: "" },
];

export interface FacetSidebarProps {
  facets: LibraryFacets;
  activeFilters: ReadonlySet<string>;
  onToggle: (filterToken: string) => void;
  onClearAll: () => void;
}

export function FacetSidebar({
  facets,
  activeFilters,
  onToggle,
  onClearAll,
}: FacetSidebarProps): ReactElement {
  const hasAnyActive = activeFilters.size > 0;
  return (
    <aside
      aria-label="Filter facets"
      className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Filters
        </h2>
        {hasAnyActive && (
          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
          >
            <X className="h-3 w-3" />
            Clear all
          </button>
        )}
      </header>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {SECTIONS.map((section) => {
          const options = facets[section.bucket];
          if (options.length === 0) return null;
          return (
            <FacetSection
              key={section.bucket}
              config={section}
              options={options}
              activeFilters={activeFilters}
              onToggle={onToggle}
            />
          );
        })}
      </div>
    </aside>
  );
}

interface FacetSectionProps {
  config: SectionConfig;
  options: readonly LibraryFacetOption[];
  activeFilters: ReadonlySet<string>;
  onToggle: (filterToken: string) => void;
}

function FacetSection({
  config,
  options,
  activeFilters,
  onToggle,
}: FacetSectionProps): ReactElement {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.key.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Always surface active selections even if they'd be hidden behind "show more".
  const visible = useMemo(() => {
    if (showAll) return filtered;
    if (filtered.length <= COLLAPSE_THRESHOLD) return filtered;
    const head = filtered.slice(0, COLLAPSE_THRESHOLD);
    const overflow = filtered.slice(COLLAPSE_THRESHOLD);
    const promoted = overflow.filter((o) =>
      activeFilters.has(`${config.prefix}${o.key}`),
    );
    return [...head, ...promoted];
  }, [filtered, showAll, activeFilters, config.prefix]);

  const hiddenCount = filtered.length - visible.length;
  const showsSearch = options.length > SEARCH_WITHIN_THRESHOLD;

  return (
    <section className="border-b border-slate-100 py-2 last:border-b-0 dark:border-slate-800/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {config.label}
        </span>
        <span className="text-[10px] font-normal text-slate-400">
          {options.length}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {showsSearch && (
            <label className="relative mx-2 mb-2 block">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${config.label.toLowerCase()}…`}
                className="h-7 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-[11px] outline-none placeholder:text-slate-400 focus:border-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>
          )}
          {visible.map((option) => {
            const token = `${config.prefix}${option.key}`;
            const checked = activeFilters.has(token);
            return (
              <label
                key={option.key}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs ${
                  checked
                    ? "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(token)}
                  className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-violet-600 focus:ring-violet-500 dark:border-slate-600"
                />
                <span className="flex-1 truncate" title={option.label}>
                  {option.label}
                </span>
                <span
                  className={`shrink-0 text-[10px] tabular-nums ${
                    option.count === 0
                      ? "text-slate-300 dark:text-slate-600"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {option.count}
                </span>
              </label>
            );
          })}
          {!showAll && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="block w-full rounded-md px-2 py-1 text-left text-[11px] font-medium text-violet-600 hover:bg-slate-100 dark:text-violet-400 dark:hover:bg-slate-800"
            >
              Show {hiddenCount} more…
            </button>
          )}
        </div>
      )}
    </section>
  );
}
