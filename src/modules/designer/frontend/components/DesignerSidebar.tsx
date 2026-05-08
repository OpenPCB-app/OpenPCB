import { GripVertical, Search } from "lucide-react";
import { type ReactElement } from "react";
import type {
  DesignerWorkspaceActions,
  DesignerWorkspaceState,
} from "../hooks/useDesignerWorkspace";
import type { DesignerView } from "../types";

interface DesignerSidebarProps {
  state: DesignerWorkspaceState;
  actions: DesignerWorkspaceActions;
  activeView: DesignerView;
}

const COMPONENT_DND_MIME = "application/x-openpcb-component-id";

export function DesignerSidebar({
  state,
  actions,
  activeView,
}: DesignerSidebarProps): ReactElement {
  const { query, searchingComponents, components, draggingComponentId } = state;

  if (activeView !== "schem") {
    return (
      <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950" />
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
      <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Components
        </p>
      </div>

      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">
          <Search className="h-3.5 w-3.5 text-slate-500" />
          <input
            value={query}
            onChange={(event) => actions.setQuery(event.target.value)}
            placeholder="Search components"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            void actions.searchComponents();
          }}
          disabled={searchingComponents}
          className="mt-2 inline-flex h-7 items-center rounded-md border border-slate-300 px-2 text-xs text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
        >
          {searchingComponents ? "Searching..." : "Refresh"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <ul className="space-y-1.5">
          {components.map((component) => {
            const dragging = draggingComponentId === component.id;
            return (
              <li key={component.id}>
                <button
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(
                      COMPONENT_DND_MIME,
                      component.id,
                    );
                    void actions
                      .beginDragComponent(component.id)
                      .catch((dragError) => {
                        actions.setError(
                          dragError instanceof Error
                            ? dragError.message
                            : "Failed to prepare drag placement",
                        );
                      });
                  }}
                  onDragEnd={() => actions.clearDragState()}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors ${
                    dragging
                      ? "border-cyan-400 bg-cyan-50 dark:border-cyan-700 dark:bg-cyan-950/40"
                      : "border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                  }`}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {component.name}
                      </span>
                      {component.isBuiltin ? (
                        <span
                          className="inline-flex shrink-0 items-center rounded-full bg-violet-100 px-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
                          title="Built-in component — read-only. Duplicate from the Library to edit."
                        >
                          Core
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {component.description || component.id}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Drag to canvas · Drop to place
      </div>
    </aside>
  );
}

export { COMPONENT_DND_MIME };
