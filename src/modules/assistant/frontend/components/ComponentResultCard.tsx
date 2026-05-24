import type { ReactElement } from "react";
import { Box, ExternalLink, PackageOpen, ArrowUpRight } from "lucide-react";
import { useNavigationStore } from "../../../../core/frontend/src/stores/navigation-store";

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
}: {
  data: ComponentResultsPayload;
}): ReactElement {
  const navigateToModule = useNavigationStore(
    (state) => state.navigateToModule,
  );
  const openInLibrary = (componentId: string) => {
    navigateToModule("library", undefined, { componentId });
  };
  return (
    <div className="space-y-2">
      {data.results.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {data.results.map((hit) => (
            <article
              key={hit.componentId}
              className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm"
            >
              <header className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 truncate">
                  <Box className="h-4 w-4 text-violet-300" />
                  <span className="truncate font-medium text-slate-100">
                    {hit.name}
                  </span>
                  {hit.isBuiltin ? (
                    <span className="rounded-full bg-emerald-950/60 px-1.5 py-0.5 text-[10px] uppercase text-emerald-400">
                      built-in
                    </span>
                  ) : null}
                </div>
                <span className="text-[10px] text-slate-500">
                  score {hit.score.toFixed(2)}
                </span>
              </header>
              <p className="mt-1 text-xs text-slate-400 line-clamp-2">
                {hit.description}
              </p>
              {hit.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {hit.tags.slice(0, 6).map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {hit.reasons.length > 0 ? (
                <p className="mt-2 text-[11px] italic text-slate-500">
                  {hit.reasons.join(" · ")}
                </p>
              ) : null}
              {hit.detailAvailable ? (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => openInLibrary(hit.componentId)}
                    className="inline-flex items-center gap-1 rounded-md border border-violet-700 bg-violet-900/40 px-2 py-1 text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-800/60 hover:text-violet-100"
                    title="Open in Library"
                  >
                    <ArrowUpRight className="h-3 w-3" />
                    Open in Library
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
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
