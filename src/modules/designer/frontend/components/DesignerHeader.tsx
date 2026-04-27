import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "../../../../core/frontend/src/components/ui/tabs";
import { ChevronDown, Plus } from "lucide-react";
import { useState, type ReactElement } from "react";
import type { DesignerDesignSummary } from "../../../../sdks/designer";
import type { DesignerView } from "../types";

interface DesignerHeaderProps {
  activeView: DesignerView;
  selectedDesign: DesignerDesignSummary | null;
  designs: DesignerDesignSummary[];
  creatingDesign: boolean;
  onViewChange: (view: DesignerView) => void;
  onSelectDesign: (designId: string | null) => void;
  onCreateDesign: () => void;
}

export function DesignerHeader({
  activeView,
  selectedDesign,
  designs,
  creatingDesign,
  onViewChange,
  onSelectDesign,
  onCreateDesign,
}: DesignerHeaderProps): ReactElement {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <header className="grid h-11 grid-cols-[1fr_auto_1fr] items-center border-b border-slate-200 bg-slate-50 px-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="relative min-w-0">
        <button
          type="button"
          onClick={() => setDropdownOpen((value) => !value)}
          disabled={creatingDesign}
          className="flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-left hover:bg-slate-200 disabled:opacity-50 dark:hover:bg-slate-800"
        >
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {selectedDesign?.name || "No design"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
        </button>

        {dropdownOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default bg-transparent"
              onClick={() => setDropdownOpen(false)}
              aria-label="Close design menu"
            />
            <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-md dark:border-slate-700 dark:bg-slate-900">
              {designs.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                  No designs yet
                </div>
              )}
              {designs.map((design) => (
                <button
                  key={design.id}
                  type="button"
                  onClick={() => {
                    onSelectDesign(design.id);
                    setDropdownOpen(false);
                  }}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
                    design.id === selectedDesign?.id
                      ? "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  <span className="flex-1 truncate">{design.name}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                    r{design.revision}
                  </span>
                </button>
              ))}
              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
              <button
                type="button"
                onClick={() => {
                  onCreateDesign();
                  setDropdownOpen(false);
                }}
                disabled={creatingDesign}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                {creatingDesign ? "Creating..." : "New design"}
              </button>
            </div>
          </>
        )}
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
