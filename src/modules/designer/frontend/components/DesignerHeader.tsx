import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "../../../../core/frontend/src/components/ui/tabs";
import type { ReactElement } from "react";
import type { DesignerDesignSummary } from "../../../../contracts/modules/sdk";
import type { DesignerView } from "../types";

interface DesignerHeaderProps {
  activeView: DesignerView;
  selectedDesign: DesignerDesignSummary | null;
  onViewChange: (view: DesignerView) => void;
}

export function DesignerHeader({
  activeView,
  selectedDesign,
  onViewChange,
}: DesignerHeaderProps): ReactElement {
  const title = selectedDesign?.name || "Untitled design";

  return (
    <header className="grid h-11 grid-cols-[1fr_auto_1fr] items-center border-b border-slate-200 bg-slate-50 px-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </div>
      </div>

      <Tabs
        value={activeView}
        onValueChange={(value) => onViewChange(value as DesignerView)}
      >
        <TabsList className="h-8 bg-slate-200/80 p-0.5 dark:bg-slate-800">
          <TabsTrigger value="schem" className="px-3 py-1 text-xs">
            Schem
          </TabsTrigger>
          <TabsTrigger value="pcb" className="px-3 py-1 text-xs">
            PCB
          </TabsTrigger>
          <TabsTrigger value="3d" className="px-3 py-1 text-xs">
            3D
          </TabsTrigger>
          <TabsTrigger value="bom" className="px-3 py-1 text-xs">
            BOM
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div />
    </header>
  );
}
