import { useState, type ReactElement } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  ShieldX,
  Wrench,
} from "lucide-react";
import type {
  AssistantToolEventDto,
  AiToolStatus,
} from "../../../../sdks/assistant";
import { SourceChipRow } from "./SourceChip";

function statusIcon(status: AiToolStatus): ReactElement {
  switch (status) {
    case "requested":
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300" />;
    case "succeeded":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
    case "failed":
      return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
    case "rejected":
      return <ShieldX className="h-3.5 w-3.5 text-amber-400" />;
  }
}

function summarizeArgs(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    if (keys.length === 0) return "";
    const preview = keys.slice(0, 3).map((k) => {
      const v = parsed[k];
      const str = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${str.length > 30 ? str.slice(0, 30) + "…" : str}`;
    });
    return preview.join(" · ");
  } catch {
    return argumentsJson.slice(0, 60);
  }
}

export function ToolCard({
  event,
  compact = false,
}: {
  event: AssistantToolEventDto;
  compact?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const isLibrarySearch = event.toolName === "library_search_components";
  const contentId = `tool-card-${event.id}`;

  return (
    <div className="max-w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className={`flex w-full min-w-0 items-center gap-2 text-left text-xs ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
      >
        <Wrench className="h-3.5 w-3.5 shrink-0 text-violet-500 dark:text-violet-400" />
        <span className="min-w-0 truncate font-mono text-slate-700 dark:text-slate-200">
          {event.toolName}
        </span>
        <span className="hidden min-w-0 truncate text-slate-500 sm:inline">
          {summarizeArgs(event.argumentsJson)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {event.sources.length > 0 ? (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {event.sources.length} src
            </span>
          ) : null}
          {statusIcon(event.status)}
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open ? (
        <div id={contentId} className="space-y-2 border-t border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
          {isLibrarySearch && event.status === "succeeded" ? (
            <p className="text-[11px] italic text-slate-500">
              Component cards rendered above.
            </p>
          ) : null}
          <SourceChipRow sources={event.sources} />
          {event.errorJson ? (
            <pre className="overflow-x-auto rounded bg-red-950/30 p-2 text-[11px] text-red-200">
              {event.errorJson}
            </pre>
          ) : null}
          {event.resultJson ? (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-slate-500">
                Raw result
              </summary>
              <pre className="mt-1 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-2 text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                {event.resultJson}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
