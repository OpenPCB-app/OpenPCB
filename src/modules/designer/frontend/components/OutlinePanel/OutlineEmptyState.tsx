import type { ReactElement } from "react";
import { BookOpen, Plus, Tag } from "lucide-react";

interface OutlineEmptyStateProps {
  onPlaceComponent(): void;
  onAddNetLabel(): void;
  onBrowseLibrary(): void;
}

export function OutlineEmptyState({
  onPlaceComponent,
  onAddNetLabel,
  onBrowseLibrary,
}: OutlineEmptyStateProps): ReactElement {
  return (
    <div className="flex flex-1 flex-col items-stretch px-3 py-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Empty design
        </p>
        <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          Add your first component, label, or browse the library to get started.
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={onPlaceComponent}
            className="flex items-center justify-between gap-2 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500"
          >
            <span className="flex items-center gap-2">
              <Plus className="h-3.5 w-3.5" />
              Place component
            </span>
            <kbd className="rounded border border-violet-400/40 bg-violet-700/40 px-1 py-0 text-[10px] font-mono text-violet-100">
              ⌘K
            </kbd>
          </button>
          <button
            type="button"
            onClick={onAddNetLabel}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Tag className="h-3.5 w-3.5 text-slate-400" />
            Add net label
          </button>
          <button
            type="button"
            onClick={onBrowseLibrary}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <BookOpen className="h-3.5 w-3.5 text-slate-400" />
            Browse library
          </button>
        </div>
      </div>
    </div>
  );
}
