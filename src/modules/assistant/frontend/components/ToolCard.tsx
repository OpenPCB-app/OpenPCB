import { useState, type ReactElement } from "react";
import {
  AlertCircle,
  Barcode,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  LayoutGrid,
  ListChecks,
  Loader2,
  Package,
  Route,
  Search,
  ShieldCheck,
  ShieldX,
  Spline,
  Sparkles,
  SquarePlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type {
  AssistantToolEventDto,
  AiToolStatus,
} from "../../../../sdks/assistant";
import { toolDisplay } from "../../../../shared/frontend/assistant/tool-display-names";
import { toolDurationMs } from "./chat-format";
import { SourceChipRow } from "./SourceChip";

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

const ICONS: Record<string, LucideIcon> = {
  FileSearch,
  SquarePlus,
  LayoutGrid,
  Package,
  Route,
  Spline,
  Search,
  ListChecks,
  Barcode,
  Sparkles,
  ShieldCheck,
  Wrench,
};

function statusIcon(status: AiToolStatus): ReactElement {
  switch (status) {
    case "requested":
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300" />;
    case "succeeded":
      return <CheckCircle2 className="h-3.5 w-3.5 text-status-success" />;
    case "failed":
      return <AlertCircle className="h-3.5 w-3.5 text-status-danger" />;
    case "rejected":
      return <ShieldX className="h-3.5 w-3.5 text-status-warning" />;
  }
}

/** Render a single argument value compactly (no raw nested JSON walls). */
function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function parseArgs(argumentsJson: string): [string, string][] {
  try {
    const parsed = JSON.parse(argumentsJson) as Record<string, unknown>;
    return Object.entries(parsed).map(([k, v]) => [k, formatValue(v)]);
  } catch {
    return [];
  }
}

function inlineSummary(pairs: [string, string][]): string {
  return pairs
    .slice(0, 2)
    .map(([k, v]) => `${k}=${v.length > 24 ? v.slice(0, 24) + "…" : v}`)
    .join(" · ");
}

export function ToolCard({
  event,
  compact = false,
}: {
  event: AssistantToolEventDto;
  compact?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const contentId = `tool-card-${event.id}`;
  const display = toolDisplay(event.toolName);
  const Icon = ICONS[display.icon] ?? Wrench;
  const pairs = parseArgs(event.argumentsJson);
  const running = event.status === "requested" || event.status === "running";
  const duration = toolDurationMs(event.createdAt, event.updatedAt);

  return (
    <div className="max-w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className={`flex w-full min-w-0 items-center gap-2 text-left text-xs ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-violet-500 dark:text-violet-400" />
        <span className="shrink-0 font-medium text-slate-700 dark:text-slate-200">
          {display.label}
        </span>
        {running ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-[11px] text-slate-400">
              running…
            </span>
            <span className="h-0.5 max-w-[80px] flex-1 overflow-hidden rounded-pill bg-slate-200 dark:bg-slate-800">
              <span className="block h-full w-2/3 animate-pulse rounded-pill bg-violet-400" />
            </span>
          </span>
        ) : pairs.length > 0 ? (
          <span className="hidden min-w-0 truncate font-mono text-[11px] text-slate-400 sm:inline">
            {inlineSummary(pairs)}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {event.sources.length > 0 ? (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {event.sources.length} src
            </span>
          ) : null}
          {!running && duration !== null ? (
            <span className="text-[10px] text-slate-400">
              {formatMs(duration)}
            </span>
          ) : null}
          {statusIcon(event.status)}
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open ? (
        <div
          id={contentId}
          className="space-y-2 border-t border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300"
        >
          <div className="mb-0.5 font-mono text-[10px] text-slate-400">
            {event.toolName}
          </div>
          {pairs.length > 0 ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {pairs.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="font-mono text-[11px] text-slate-500">
                    {key}
                  </dt>
                  <dd className="min-w-0 break-words font-mono text-[11px] text-slate-700 dark:text-slate-300">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {event.toolName === "library_search_components" &&
          event.status === "succeeded" ? (
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
