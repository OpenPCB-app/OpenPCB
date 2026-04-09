import { useNavigationStore } from "../stores/navigation-store";
import {
  Box,
  FileText,
  LayoutGrid,
  MessageSquare,
  PenTool,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useBootstrap } from "../providers/BootstrapProvider";
import type { ModuleRegistryItem } from "../../../../contracts/modules/registry";

interface LeftSidebarProps {
  onSettingsClick: () => void;
}

const MODULE_ICON_MAP: Record<string, LucideIcon> = {
  designer: PenTool,
  "component-library": Box,
  "ai-service": MessageSquare,
  knowledge: FileText,
};

const MODULE_LABEL_FALLBACK_MAP: Record<string, string> = {
  designer: "Design",
  "component-library": "Library",
  "ai-service": "Chat",
  knowledge: "Notes",
};

const MODULE_ORDER_MAP: Record<string, number> = {
  designer: 1,
  "component-library": 2,
  "ai-service": 3,
  knowledge: 4,
};

const UNKNOWN_MODULE_ORDER = 100;

function getModuleOrder(moduleId: string): number {
  return MODULE_ORDER_MAP[moduleId] ?? UNKNOWN_MODULE_ORDER;
}

function getModuleIcon(moduleId: string): LucideIcon {
  return MODULE_ICON_MAP[moduleId] ?? Box;
}

function getModuleNavLabel(module: ModuleRegistryItem): string {
  return module.sidebarLabel ?? MODULE_LABEL_FALLBACK_MAP[module.id] ?? module.label;
}

function navButtonClass(active: boolean): string {
  return `flex w-16 flex-col items-center justify-center rounded-2xl py-2 transition-colors ${
    active
      ? "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300"
      : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
  }`;
}

function navLabelClass(active: boolean): string {
  return `mt-1 text-xs leading-tight text-center ${
    active ? "font-medium text-violet-600 dark:text-violet-300" : "text-slate-500 dark:text-slate-400"
  }`;
}

export function LeftSidebar({ onSettingsClick }: LeftSidebarProps) {
  const currentRoute = useNavigationStore((state) => state.currentRoute);
  const navigateHome = useNavigationStore((state) => state.navigateHome);
  const navigateToModule = useNavigationStore((state) => state.navigateToModule);
  const { moduleRegistry } = useBootstrap();

  const topBarModules = (moduleRegistry?.modules ?? []).filter(
    (module: ModuleRegistryItem) =>
      module.registerAsSpaceInTopBar && module.status === "loaded",
  );
  const orderedModules = [...topBarModules].sort((a, b) => {
    const orderA = getModuleOrder(a.id);
    const orderB = getModuleOrder(b.id);
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    const labelA = getModuleNavLabel(a).toLowerCase();
    const labelB = getModuleNavLabel(b).toLowerCase();
    return labelA.localeCompare(labelB);
  });

  return (
    <aside className="flex w-20 flex-col items-center justify-between border-r border-slate-200 bg-white py-3 dark:border-slate-700 dark:bg-slate-900">
      <button
        type="button"
        aria-label="OpenPCB Home"
        className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
        onClick={navigateHome}
      >
        OP
      </button>

      <nav className="flex flex-1 flex-col items-center justify-start pt-6">
        <button
          type="button"
          className={navButtonClass(currentRoute.kind === "home")}
          aria-label="Home"
          onClick={navigateHome}
        >
          <LayoutGrid className="h-6 w-6" strokeWidth={1.8} />
          <span className={navLabelClass(currentRoute.kind === "home")}>Home</span>
        </button>

        <div className="mt-3 flex w-full flex-col items-center gap-2">
          {orderedModules.map((module: ModuleRegistryItem) => {
            const active =
              currentRoute.kind === "module" && currentRoute.moduleId === module.id;
            const navLabel = getModuleNavLabel(module);
            const ModuleIcon = getModuleIcon(module.id);
            return (
              <button
                key={module.id}
                type="button"
                title={navLabel}
                className={navButtonClass(active)}
                aria-label={navLabel}
                onClick={() => navigateToModule(module.id)}
              >
                <ModuleIcon className="h-6 w-6" strokeWidth={1.8} />
                <span className={navLabelClass(active)}>{navLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          aria-label="Settings"
          className="flex w-16 flex-col items-center justify-center rounded-2xl py-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          onClick={onSettingsClick}
        >
          <Settings className="h-6 w-6" strokeWidth={1.8} />
          <span className="mt-1 text-xs leading-tight text-center text-slate-500 dark:text-slate-400">
            Settings
          </span>
        </button>
        <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden />
      </div>
    </aside>
  );
}
