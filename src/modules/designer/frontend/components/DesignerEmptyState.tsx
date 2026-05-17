import { FileUp, Plus } from "lucide-react";
import { type ReactElement } from "react";
import type { DesignerDesignSummary } from "../../../../sdks/designer";

interface DesignerEmptyStateProps {
  designs: DesignerDesignSummary[];
  creatingDesign: boolean;
  onCreate(): void;
  onOpen(designId: string): void;
  onImportKicad?(): void;
}

export function DesignerEmptyState({
  designs,
  creatingDesign,
  onCreate,
  onOpen,
  onImportKicad,
}: DesignerEmptyStateProps): ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-950 p-6">
      <div className="flex w-full max-w-md flex-col items-stretch gap-5 rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow-sm">
        <div className="text-center">
          <h2 className="text-base font-semibold text-slate-100">
            No design open
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Create a new design or open an existing one to get started.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          disabled={creatingDesign}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-500 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {creatingDesign ? "Creating…" : "New design"}
        </button>
        {onImportKicad && (
          <button
            type="button"
            onClick={onImportKicad}
            disabled={creatingDesign}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-800 disabled:opacity-60"
          >
            <FileUp className="h-4 w-4" />
            Import KiCad project…
          </button>
        )}
        {designs.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Open existing
            </div>
            <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {designs.map((design) => (
                <button
                  key={design.id}
                  type="button"
                  onClick={() => onOpen(design.id)}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-slate-200 transition-colors hover:bg-slate-800"
                >
                  <span className="truncate">
                    {design.name || "Untitled Design"}
                  </span>
                  <span className="ml-2 shrink-0 text-[10px] text-slate-500">
                    r{design.revision}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
