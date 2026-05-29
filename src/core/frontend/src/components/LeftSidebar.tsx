import { LayoutGrid, Settings } from "lucide-react";
import { useNavigationStore } from "../stores/navigation-store";
import { useBootstrap } from "../providers/BootstrapProvider";
import type { ModuleRegistryItem } from "../../../contracts/modules/registry";
import { resolveLucideIcon } from "./icon-resolver";
import { getFrontendModuleEntry } from "./ModuleSpaceHost";

interface LeftSidebarProps {
  onSettingsClick: () => void;
}

function navButtonClass(active: boolean): string {
  return `flex w-16 cursor-pointer flex-col items-center justify-center rounded-2xl border border-transparent py-2 transition-colors ${
    active
      ? "border-violet-600 bg-violet-100 text-violet-600 dark:border-violet-400 dark:bg-violet-900/40 dark:text-violet-300"
      : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
  }`;
}

function navLabelClass(active: boolean): string {
  return `mt-1 text-xs leading-tight text-center ${
    active
      ? "font-medium text-violet-600 dark:text-violet-300"
      : "text-slate-500 dark:text-slate-400"
  }`;
}

export function LeftSidebar({ onSettingsClick }: LeftSidebarProps) {
  const currentRoute = useNavigationStore((state) => state.currentRoute);
  const navigateHome = useNavigationStore((state) => state.navigateHome);
  const navigateToModule = useNavigationStore(
    (state) => state.navigateToModule,
  );
  const { moduleRegistry } = useBootstrap();

  const loadedModules = (moduleRegistry?.modules ?? []).filter(
    (module: ModuleRegistryItem) => {
      if (module.status !== "loaded" || module.sidebar.hidden === true) {
        return false;
      }
      // Defense in depth: even if the backend reports a dev-only module as
      // loaded (e.g. a stale registry response), never expose it from a
      // production build.
      if (import.meta.env.PROD) {
        const entry = getFrontendModuleEntry(module.id);
        if (entry?.manifest.availability === "dev") {
          return false;
        }
      }
      return true;
    },
  );

  const orderedModules = [...loadedModules].sort((a, b) => {
    if (a.sidebar.order !== b.sidebar.order) {
      return a.sidebar.order - b.sidebar.order;
    }
    return a.sidebar.label.localeCompare(b.sidebar.label);
  });

  return (
    <aside className="flex w-20 flex-col items-center justify-between border-r border-slate-200 bg-white py-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="w-10 h-10">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="3"
            stroke="currentColor"
            strokeWidth="2"
          ></rect>
          <line
            x1="8"
            y1="8"
            x2="16"
            y2="16"
            stroke="currentColor"
            strokeWidth="1.5"
          ></line>
          <circle cx="8" cy="8" r="1.5" fill="currentColor"></circle>
          <circle cx="16" cy="8" r="1.5" fill="currentColor"></circle>
          <circle cx="8" cy="16" r="1.5" fill="currentColor"></circle>
          <circle cx="16" cy="16" r="1.5" fill="currentColor"></circle>
        </svg>
      </div>

      <nav className="flex flex-1 flex-col items-center justify-start pt-6">
        <button
          type="button"
          className={navButtonClass(currentRoute.kind === "home")}
          aria-label="Home"
          onClick={navigateHome}
        >
          <LayoutGrid className="h-6 w-6" strokeWidth={1.8} />
          <span className={navLabelClass(currentRoute.kind === "home")}>
            Home
          </span>
        </button>

        <div className="mt-3 flex w-full flex-col items-center gap-2">
          {orderedModules.map((module: ModuleRegistryItem) => {
            const active =
              currentRoute.kind === "module" &&
              currentRoute.moduleId === module.id;
            const ModuleIcon = resolveLucideIcon(module.sidebar.icon);
            return (
              <button
                key={module.id}
                type="button"
                title={module.sidebar.label}
                className={navButtonClass(active)}
                aria-label={module.sidebar.label}
                onClick={() => navigateToModule(module.id)}
              >
                <ModuleIcon className="h-6 w-6" strokeWidth={1.8} />
                <span className={navLabelClass(active)}>
                  {module.sidebar.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          aria-label="Settings"
          aria-current={currentRoute.kind === "settings" ? "page" : undefined}
          className={navButtonClass(currentRoute.kind === "settings")}
          onClick={onSettingsClick}
        >
          <Settings className="h-6 w-6" strokeWidth={1.8} />
        </button>
      </div>
    </aside>
  );
}
