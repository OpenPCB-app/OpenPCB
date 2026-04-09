import { Suspense, lazy, useMemo, type ComponentType } from "react";
import type { FrontendModuleEntry } from "../../../contracts/modules/frontend-entry";
import type { ModuleRegistryItem } from "../../../contracts/modules/registry";
import { useBootstrap } from "../providers/BootstrapProvider";

interface FrontendModuleEntryFile {
  default: FrontendModuleEntry;
}

type ModuleHostProps = {
  module: ModuleRegistryItem;
  backendURL: string | null;
};

/**
 * Fully lazy glob of every module's frontend barrel. Each entry is a
 * loader function that dynamically imports `module.frontend.ts` on first
 * call. Nothing module-specific enters the initial bundle.
 */
const moduleEntries = import.meta.glob<FrontendModuleEntryFile>(
  "../../../../modules/*/module.frontend.ts",
);

const moduleCache = new Map<string, ComponentType<ModuleHostProps>>();

function ModuleLoadError({ message }: { message: string }) {
  return (
    <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {message}
    </div>
  );
}

function ModuleLoading({ moduleId }: { moduleId: string }) {
  return (
    <div className="m-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
      Loading module {moduleId}...
    </div>
  );
}

function resolveModuleComponent(
  moduleId: string,
): ComponentType<ModuleHostProps> | null {
  const cached = moduleCache.get(moduleId);
  if (cached) {
    return cached;
  }

  const entryPath = `../../../../modules/${moduleId}/module.frontend.ts`;
  const loader = moduleEntries[entryPath];
  if (!loader) {
    return null;
  }

  // React.lazy expects a loader that resolves to `{ default: Component }`.
  // Our barrel's default export is `{ manifest, Space }`, so we wrap it:
  // load the barrel, then return a small adapter whose default is a
  // component that renders the barrel's Space with injected props.
  const LazyHost = lazy(async () => {
    const loaded = await loader();
    const entry = loaded.default;
    const Space = entry.Space;
    const Host: ComponentType<ModuleHostProps> = ({ module, backendURL }) => (
      <Space
        moduleId={module.id}
        namespace={module.namespace}
        backendURL={backendURL}
      />
    );
    return { default: Host };
  });

  moduleCache.set(moduleId, LazyHost);
  return LazyHost;
}

export function ModuleSpaceHost({ module }: { module: ModuleRegistryItem }) {
  const { backendURL } = useBootstrap();
  const Component = useMemo(
    () => resolveModuleComponent(module.id),
    [module.id],
  );

  if (!Component) {
    return (
      <ModuleLoadError
        message={`Frontend entry missing for module '${module.id}'`}
      />
    );
  }

  return (
    <Suspense fallback={<ModuleLoading moduleId={module.id} />}>
      <Component module={module} backendURL={backendURL} />
    </Suspense>
  );
}
