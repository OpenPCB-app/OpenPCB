import { Tabs, TabsList, TabsTrigger } from "@shared/frontend/ui/tabs";
import { type ReactElement, type ReactNode } from "react";
import type { DesignerDesignSummary } from "../../../../sdks/designer";
import type { DesignerView } from "../types";
import { DesignTabs } from "./DesignTabs";

interface DesignerHeaderProps {
  activeView: DesignerView;
  designs: DesignerDesignSummary[];
  openDesignIds: string[];
  activeDesignId: string | null;
  creatingDesign: boolean;
  onViewChange: (view: DesignerView) => void;
  onActivateTab: (designId: string) => void;
  onCloseTab: (designId: string) => void;
  onCloseOthers: (designId: string) => void;
  onCloseAll: () => void;
  onRenameTab: (designId: string, name: string) => Promise<void> | void;
  onReorderTabs: (fromIndex: number, toIndex: number) => void;
  onCreateDesign: () => void;
  trailing?: ReactNode;
}

export function DesignerHeader({
  activeView,
  designs,
  openDesignIds,
  activeDesignId,
  creatingDesign,
  onViewChange,
  onActivateTab,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onRenameTab,
  onReorderTabs,
  onCreateDesign,
  trailing,
}: DesignerHeaderProps): ReactElement {
  return (
    <header className="grid h-11 grid-cols-[1fr_auto_1fr] items-center border-b border-slate-200 bg-slate-50 px-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="min-w-0">
        <DesignTabs
          designs={designs}
          openDesignIds={openDesignIds}
          activeDesignId={activeDesignId}
          creatingDesign={creatingDesign}
          onActivate={onActivateTab}
          onClose={onCloseTab}
          onCloseOthers={onCloseOthers}
          onCloseAll={onCloseAll}
          onRename={onRenameTab}
          onReorder={onReorderTabs}
          onCreate={onCreateDesign}
        />
      </div>

      <Tabs
        value={activeView}
        onValueChange={(value) => onViewChange(value as DesignerView)}
      >
        <TabsList className="h-8 bg-transparent p-0.5 ">
          <TabsTrigger
            value="schem"
            className="cursor-pointer rounded-sm px-3 py-1 text-xs data-[state=active]:bg-slate-200 dark:data-[state=active]:bg-violet-900 dark:data-[state=active]:text-white data-[state=active]:text-black "
          >
            Schem
          </TabsTrigger>
          <TabsTrigger
            value="pcb"
            className="cursor-pointer rounded-sm px-3 py-1 text-xs data-[state=active]:bg-slate-200 dark:data-[state=active]:bg-violet-900 dark:data-[state=active]:text-white data-[state=active]:text-black"
          >
            PCB
          </TabsTrigger>
          <TabsTrigger
            value="3d"
            className="cursor-pointer rounded-sm px-3 py-1 text-xs data-[state=active]:bg-slate-200 dark:data-[state=active]:bg-violet-900 dark:data-[state=active]:text-white data-[state=active]:text-black"
            data-testid="designer-view-3d"
          >
            3D
          </TabsTrigger>
          <TabsTrigger
            value="bom"
            className="cursor-pointer rounded-sm px-3 py-1 text-xs data-[state=active]:bg-slate-200 dark:data-[state=active]:bg-violet-900 dark:data-[state=active]:text-white data-[state=active]:text-black"
          >
            BOM
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex items-center justify-end gap-2 pr-1">{trailing}</div>
    </header>
  );
}
