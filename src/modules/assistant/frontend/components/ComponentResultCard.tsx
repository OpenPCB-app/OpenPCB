import type { ReactElement } from "react";
import { Box, ExternalLink, PackageOpen, ArrowUpRight } from "lucide-react";
import { useNavigationStore } from "../../../../core/frontend/src/stores/navigation-store";
import { RelevanceBar } from "../../../../shared/frontend/ui/relevance-bar";
import { cn } from "@/lib/utils";

interface ComponentHit {
  componentId: string;
  name: string;
  description: string;
  tags: string[];
  isBuiltin: boolean;
  score: number;
  reasons: string[];
  detailAvailable: boolean;
}

interface GenericSuggestion {
  label: string;
  reason: string;
  availability: "not-installed";
}

export interface ComponentResultsPayload {
  rewrittenQuery: string;
  results: ComponentHit[];
  noLocalMatch: boolean;
  genericSuggestions: GenericSuggestion[];
  importGuidance: string | null;
}

export function ComponentResultsBlock({
  data,
  compact = false,
}: {
  data: ComponentResultsPayload;
  compact?: boolean;
}): ReactElement {
  const navigateToModule = useNavigationStore(
    (state) => state.navigateToModule,
  );
  const openInLibrary = (componentId: string) => {
    navigateToModule("library", undefined, { componentId });
  };
  // Relevance % is normalized against the top score in this result set.
  const maxScore = data.results.reduce((m, h) => Math.max(m, h.score), 0);
  const pctFor = (score: number) =>
    maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  const sorted = [...data.results].sort((a, b) => b.score - a.score);
  const builtinCount = data.results.filter((h) => h.isBuiltin).length;
  // Best match: top result clearly ahead of #2 (or a single strong result).
  const bestIsClear =
    sorted.length > 0 &&
    (sorted.length === 1 ||
      pctFor(sorted[0]!.score) - pctFor(sorted[1]!.score) >= 15 ||
      pctFor(sorted[0]!.score) >= 90);
  const bestId = bestIsClear ? sorted[0]!.componentId : null;
  return (
    <div className="space-y-2">
      {sorted.length > 0 ? (
        <>
          {builtinCount > 0 ? (
            <div className="text-[10px] text-slate-400">
              {builtinCount === sorted.length
                ? "All from built-in library"
                : `${builtinCount} of ${sorted.length} built-in`}
            </div>
          ) : null}
          <div
            className={`grid grid-cols-1 gap-2 ${compact ? "" : "md:grid-cols-2"}`}
          >
            {sorted.map((hit) => {
              const isBest = hit.componentId === bestId;
              const clickable = hit.detailAvailable;
              return (
                <article
                  key={hit.componentId}
                  onClick={
                    clickable ? () => openInLibrary(hit.componentId) : undefined
                  }
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openInLibrary(hit.componentId);
                          }
                        }
                      : undefined
                  }
                  title={clickable ? "Open in Library" : undefined}
                  className={cn(
                    "group min-w-0 overflow-hidden rounded-lg border p-2.5 text-sm transition-colors",
                    clickable && "cursor-pointer",
                    isBest
                      ? "border-violet-300 bg-accent-soft dark:border-violet-700/70"
                      : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
                    clickable &&
                      "hover:border-violet-400 dark:hover:border-violet-600",
                  )}
                >
                  <header className="flex items-center gap-2">
                    <Box className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                    <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {hit.name}
                    </span>
                    {isBest ? (
                      <span className="shrink-0 rounded-full bg-status-success-soft px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-status-success">
                        Best
                      </span>
                    ) : null}
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      <RelevanceBar pct={pctFor(hit.score)} />
                      {clickable ? (
                        <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-violet-400" />
                      ) : null}
                    </span>
                  </header>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <p className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-400">
                      {hit.description}
                    </p>
                    {hit.tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="hidden shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 sm:inline dark:bg-slate-800 dark:text-slate-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : null}

      {data.noLocalMatch ? (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-200">
          <div className="flex items-center gap-2 font-medium">
            <PackageOpen className="h-4 w-4" />
            No installed component matches.
          </div>
          {data.genericSuggestions.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {data.genericSuggestions.map((s) => (
                <li key={s.label} className="flex items-start gap-2">
                  <span className="rounded bg-amber-900/40 px-1 text-[10px] uppercase text-amber-300">
                    not installed
                  </span>
                  <div>
                    <div className="font-mono text-amber-100">{s.label}</div>
                    <div className="text-[11px] text-amber-300/80">
                      {s.reason}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {data.importGuidance ? (
            <p className="mt-2 inline-flex items-center gap-1 text-amber-300">
              <ExternalLink className="h-3 w-3" />
              {data.importGuidance}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
