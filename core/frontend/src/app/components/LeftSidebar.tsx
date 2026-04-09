import { useNavigationStore } from "../stores/navigation-store";
import { Settings } from "lucide-react";
import { useBootstrap } from "../providers/BootstrapProvider";
import type { ModuleRegistryItem } from "../../../../contracts/modules/registry";

interface LeftSidebarProps {
  onSettingsClick: () => void;
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
          className={`w-14 rounded-xl px-2 py-2 text-xs font-medium transition-colors ${
            currentRoute.kind === "home"
              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
              : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
          onClick={navigateHome}
        >
          Home
        </button>

        <div className="mt-3 flex w-full flex-col items-center gap-2">
          {topBarModules.map((module: ModuleRegistryItem) => {
            const active =
              currentRoute.kind === "module" && currentRoute.moduleId === module.id;
            return (
              <button
                key={module.id}
                type="button"
                title={module.label}
                className={`w-14 rounded-xl px-2 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
                onClick={() => navigateToModule(module.id)}
              >
                {module.label.slice(0, 3).toUpperCase()}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          aria-label="Settings"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          onClick={onSettingsClick}
        >
          <Settings className="h-5 w-5" />
        </button>
        <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden />
      </div>
    </aside>
  );
}
