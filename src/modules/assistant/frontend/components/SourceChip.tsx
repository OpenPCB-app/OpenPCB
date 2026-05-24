import { useState, type ReactElement } from "react";
import { ChevronRight } from "lucide-react";
import type { AiSourceRef } from "../../../../sdks/assistant";

export function SourceChip({ source }: { source: AiSourceRef }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 max-w-full inline-flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        title={source.label}
      >
        <span className="font-mono text-[10px] uppercase tracking-wider text-violet-400">
          {source.kind}
        </span>
        <span className="max-w-[120px] truncate">{source.label}</span>
        <ChevronRight
          className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open ? (
        <div className="mt-1 max-w-full overflow-hidden rounded-md border border-slate-200 bg-white p-2 text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <div>
            <span className="text-slate-500">kind:</span> {source.kind}
          </div>
          {source.refId ? (
            <div>
              <span className="text-slate-500">refId:</span>{" "}
              <span className="break-all font-mono">{source.refId}</span>
            </div>
          ) : null}
          {source.excerpt ? (
            <div className="mt-1 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">
              {source.excerpt}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SourceChipRow({
  sources,
}: {
  sources: AiSourceRef[];
}): ReactElement | null {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((source) => (
        <SourceChip key={source.id} source={source} />
      ))}
    </div>
  );
}
