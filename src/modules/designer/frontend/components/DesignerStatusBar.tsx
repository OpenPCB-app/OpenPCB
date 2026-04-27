import type { ReactElement } from "react";

interface DesignerStatusBarProps {
  gridMm: number;
  zoom: number;
  selection: string;
}

export function DesignerStatusBar({
  gridMm,
  zoom,
  selection,
}: DesignerStatusBarProps): ReactElement {
  return (
    <footer className="flex h-6 items-center justify-between border-t border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
      <div className="flex items-center gap-4">
        <span>Grid: {gridMm.toFixed(2)}mm</span>
        <span>Zoom: {zoom.toFixed(0)}%</span>
      </div>
      <span>{selection}</span>
    </footer>
  );
}
