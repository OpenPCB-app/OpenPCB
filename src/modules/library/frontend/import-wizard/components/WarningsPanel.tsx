import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactElement } from "react";
import type { ImportWarning } from "../../types";

const COLLAPSED_LIMIT = 2;

interface WarningsPanelProps {
  warnings: ImportWarning[];
}

export function WarningsPanel({
  warnings,
}: WarningsPanelProps): ReactElement | null {
  const [expanded, setExpanded] = useState(false);

  if (warnings.length === 0) return null;

  const hasMore = warnings.length > COLLAPSED_LIMIT;
  const visible = expanded ? warnings : warnings.slice(0, COLLAPSED_LIMIT);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950">
      <div className="text-xs font-medium text-amber-800 dark:text-amber-300">
        {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
      </div>
      <div className="mt-1 space-y-1 text-xs text-amber-700 dark:text-amber-400">
        {visible.map((warning) => (
          <div key={warning.code + warning.message} className="line-clamp-2">
            {warning.message}
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              Show all {warnings.length} warnings
            </>
          )}
        </button>
      )}
    </div>
  );
}
