import type { ReactElement } from "react";

export function DesignerPlaceholderView({ view }: { view: "pcb" | "3d" | "bom" }): ReactElement {
  return (
    <div className="flex h-full items-center justify-center bg-slate-950 text-center text-slate-300">
      <div>
        <h3 className="text-lg font-semibold uppercase tracking-wide">{view}</h3>
        <p className="mt-2 text-sm text-slate-400">Coming soon</p>
      </div>
    </div>
  );
}
