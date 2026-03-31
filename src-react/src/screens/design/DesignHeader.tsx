import { useNavigationStore, type DesignTab } from "@/stores/navigation-store";
import { cn } from "@/lib/utils";

const TABS: { id: DesignTab; label: string }[] = [
  { id: "schematic", label: "Schem" },
  { id: "pcb", label: "PCB" },
  { id: "3d", label: "3D" },
  { id: "bom", label: "BOM" },
];

interface DesignHeaderProps {
  projectName?: string;
  designName?: string;
  onAiToggle?: () => void;
  aiOpen?: boolean;
}

export function DesignHeader({
  projectName = "Untitled project",
  designName = "Untitled design",
  onAiToggle,
  aiOpen,
}: DesignHeaderProps) {
  const designTab = useNavigationStore((s) => s.designTab);
  const setDesignTab = useNavigationStore((s) => s.setDesignTab);

  return (
    <div className="flex h-10 items-center justify-between border-b border-border-default bg-bg-secondary px-3">
      {/* Left: project name */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">
            {designName}
          </p>
          <p className="truncate text-[11px] text-text-tertiary">
            {projectName}
          </p>
        </div>
      </div>

      {/* Center: tab bar */}
      <div className="flex items-center rounded-md bg-bg-input p-0.5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded transition-colors",
              designTab === tab.id
                ? "bg-bg-elevated text-text-primary"
                : "text-text-tertiary hover:text-text-secondary",
            )}
            onClick={() => setDesignTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        <button className="text-xs text-text-tertiary hover:text-text-secondary transition-colors">
          Share
        </button>
        <button
          className={cn(
            "h-7 w-7 rounded flex items-center justify-center text-xs font-medium transition-colors",
            aiOpen
              ? "bg-brand-bg text-brand"
              : "text-text-tertiary hover:bg-bg-input",
          )}
          onClick={onAiToggle}
          aria-label="Toggle AI copilot"
        >
          AI
        </button>
      </div>
    </div>
  );
}
