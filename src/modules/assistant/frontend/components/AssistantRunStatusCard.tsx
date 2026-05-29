import {
  AlertTriangle,
  Loader2,
  PauseCircle,
  RotateCcw,
  Square,
} from "lucide-react";
import type { ReactElement } from "react";

export type ActiveRunStatus =
  | "queued"
  | "running"
  | "streaming"
  | "tooling"
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused"
  | "disconnected";

export interface ActiveToolState {
  callId: string;
  name: string;
  status: string;
}

export interface ActiveRunState {
  chatId: string;
  taskId: string;
  assistantMessageId: string;
  status: ActiveRunStatus;
  currentStage: string;
  activeTools: ActiveToolState[];
  lastError: string | null;
  userMessageContent: string;
  startedAt: string;
  lastEventAt: string;
  /** Set when the run finished with no visible answer; keeps the retry card on completion. */
  emptyResponse?: boolean;
}

const toolLabels: Record<string, string> = {
  library_search_components: "Searching components",
  library_get_component_detail: "Reading component details",
  designer_create_design: "Creating design",
  designer_place_components: "Preparing placement proposal",
  designer_get_design_summary: "Reading design",
  designer_get_part_detail: "Reading part detail",
};

function labelTool(name: string): string {
  return toolLabels[name] ?? name.replaceAll("_", " ");
}

export function AssistantRunStatusCard({
  run,
  onStop,
  onRetry,
}: {
  run: ActiveRunState;
  onStop?: () => void;
  onRetry?: () => void;
}): ReactElement | null {
  if (run.status === "completed") return null;
  const terminal = ["failed", "cancelled", "paused", "disconnected"].includes(
    run.status,
  );
  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-xl border p-3 text-xs ${terminal ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100" : "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/20 dark:text-violet-100"}`}
    >
      <div className="flex items-start gap-3">
        {terminal ? (
          run.status === "paused" ? (
            <PauseCircle className="mt-0.5 h-4 w-4" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4" />
          )
        ) : (
          <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-medium">
            {run.currentStage || "Assistant is working…"}
          </div>
          {run.lastError ? (
            <div className="text-amber-700/90 dark:text-amber-200/90">
              {run.lastError}
            </div>
          ) : null}
          {run.activeTools.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {run.activeTools.map((tool) => (
                <span
                  key={tool.callId}
                  className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                >
                  {labelTool(tool.name)} · {tool.status}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {!terminal ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1 rounded bg-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-300 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Square className="h-3 w-3" /> Stop
            </button>
          ) : onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded bg-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-300 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCcw className="h-3 w-3" /> Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
