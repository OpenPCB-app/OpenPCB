import type { ReactElement } from "react";
import type {
  DesignerWorkspaceActions,
  DesignerWorkspaceState,
} from "../hooks/useDesignerWorkspace";
import type { DesignerView } from "../types";
import { OutlinePanel } from "./OutlinePanel/OutlinePanel";
import { CollapsibleSection } from "./CollapsibleSection";

export const COMPONENT_DND_MIME = "application/x-openpcb-component-id";

interface DesignerSidebarProps {
  state: DesignerWorkspaceState;
  actions: DesignerWorkspaceActions;
  activeView: DesignerView;
  pcbSlotRef?: (el: HTMLDivElement | null) => void;
  pcbLayersSlotRef?: (el: HTMLDivElement | null) => void;
  threeDSlotRef?: (el: HTMLDivElement | null) => void;
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
  threeDSlotRef,
  onPlaceComponent,
  onAddNetLabel,
  onBrowseLibrary,
  onFrameBoundsMm,
}: DesignerSidebarProps): ReactElement {
  if (activeView === "pcb") {
    return (
      <aside className="flex h-full min-h-0 flex-col overflow-y-auto border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
        <CollapsibleSection id="pcb.sidebar.board" title="Board" defaultOpen>
          <div ref={pcbSlotRef} />
        </CollapsibleSection>
        <CollapsibleSection id="pcb.sidebar.layers" title="Layers" defaultOpen>
          <div ref={pcbLayersSlotRef} />
        </CollapsibleSection>
      </aside>
    );
  }

  if (activeView === "3d") {
    return (
      <aside className="flex h-full min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
        <div ref={threeDSlotRef} className="min-h-0 flex-1" />
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
