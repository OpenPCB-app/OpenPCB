import type { ReactElement } from "react";
import type {
  DesignerWorkspaceActions,
  DesignerWorkspaceState,
} from "../hooks/useDesignerWorkspace";
import type { DesignerView } from "../types";
import { OutlinePanel } from "./OutlinePanel/OutlinePanel";

export const COMPONENT_DND_MIME = "application/x-openpcb-component-id";

interface DesignerSidebarProps {
  state: DesignerWorkspaceState;
  actions: DesignerWorkspaceActions;
  activeView: DesignerView;
  pcbSlotRef?: (el: HTMLDivElement | null) => void;
  pcbLayersSlotRef?: (el: HTMLDivElement | null) => void;
  onPlaceComponent(): void;
  onAddNetLabel(): void;
  onBrowseLibrary(): void;
  onFrameBoundsMm(bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }): void;
}

export function DesignerSidebar({
  state,
  actions,
  activeView,
  pcbSlotRef,
  pcbLayersSlotRef,
  onPlaceComponent,
  onAddNetLabel,
  onBrowseLibrary,
  onFrameBoundsMm,
}: DesignerSidebarProps): ReactElement {
  if (activeView === "pcb") {
    return (
      <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
        <div ref={pcbLayersSlotRef} />
        <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Board
          </p>
        </div>
        <div ref={pcbSlotRef} className="min-h-0 flex-1 overflow-y-auto" />
      </aside>
    );
  }

  if (activeView !== "schem") {
    return (
      <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950" />
    );
  }

  return (
    <OutlinePanel
      state={state}
      actions={actions}
      onPlaceComponent={onPlaceComponent}
      onAddNetLabel={onAddNetLabel}
      onBrowseLibrary={onBrowseLibrary}
      onFrameBoundsMm={onFrameBoundsMm}
    />
  );
}
