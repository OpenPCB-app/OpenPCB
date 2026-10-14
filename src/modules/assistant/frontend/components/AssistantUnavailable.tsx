import { AlertTriangle } from "lucide-react";
import type { ReactElement } from "react";
import type { AssistantUnavailable as Unavailable } from "../../../../sdks/assistant/availability";

export function AssistantUnavailable({ availability, compact = false }: {
  availability: Unavailable;
  compact?: boolean;
}): ReactElement {
  return (
    <div role="alert" data-testid="assistant-unavailable"
      className={`flex min-h-0 flex-1 items-start justify-center overflow-auto ${compact ? "p-3" : "p-8"}`}>
      <div className="w-full max-w-xl rounded-xl border border-status-warning-border bg-status-warning-soft p-4 text-sm text-status-warning">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Assistant unavailable
        </div>
        <p className="mt-2 break-words">{availability.message}</p>
        {availability.databasePath ? (
          <code className="mt-2 block break-all rounded bg-status-warning-soft px-2 py-1 text-xs">
            {availability.databasePath}
          </code>
        ) : null}
        <p className="mt-2 text-xs opacity-80">Error code: {availability.code}</p>
      </div>
    </div>
  );
}
