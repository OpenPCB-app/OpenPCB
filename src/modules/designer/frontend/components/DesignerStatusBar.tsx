import type { ReactElement } from "react";

interface DesignerStatusBarProps {
  gridMm: number;
  zoom: number;
  selection: string;
  drcCount?: number;
  /** When provided, the DRC chip becomes a button that toggles the DRC dock. */
  onDrcClick?: () => void;
}

export function DesignerStatusBar({
  gridMm,
  zoom,
  selection,
  drcCount,
  onDrcClick,
}: DesignerStatusBarProps): ReactElement {
  return (
    <footer className="flex h-6 items-center justify-between border-t border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
      <div className="flex items-center gap-4">
        <span>Grid: {gridMm.toFixed(2)}mm</span>
        <span>Zoom: {zoom.toFixed(0)}%</span>
      </div>
      <div className="flex items-center gap-3">
        {drcCount !== undefined ? (
          onDrcClick ? (
            <button
              type="button"
              onClick={onDrcClick}
              title="Toggle DRC panel"
              className={`cursor-pointer rounded px-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 ${
                drcCount > 0 ? "font-medium text-red-300" : "text-slate-500"
              }`}
            >
              {drcCount} DRC
            </button>
          ) : (
            <span
              title="Design rule violations"
              className={
                drcCount > 0
                  ? "rounded px-1.5 font-medium text-red-300"
                  : "rounded px-1.5 text-slate-500"
              }
            >
              {drcCount} DRC
            </span>
          )
        ) : null}
        <span>{selection}</span>
      </div>
    </footer>
  );
}
