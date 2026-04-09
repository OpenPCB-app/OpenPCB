import { Suspense, lazy, useMemo, type ComponentType } from "react";
import type { FrontendModuleEntry } from "../../../../contracts/modules/frontend-entry";
import type { ModuleRegistryItem } from "../../../../contracts/modules/registry";
import { useBootstrap } from "../providers/BootstrapProvider";

interface FrontendModuleEntryFile {
  default: FrontendModuleEntry;
}

const moduleEntries = import.meta.glob<FrontendModuleEntryFile>(
  "../../../../../modules/*/core/frontend-entry.tsx",
);

type ModuleHostProps = {
  module: ModuleRegistryItem;
  backendURL: string | null;
};

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

function resolveModuleComponent(moduleId: string): ComponentType<ModuleHostProps> | null {
  const cached = moduleCache.get(moduleId);
  if (cached) {
    return cached;
  }

  const entryPath = `../../../../../modules/${moduleId}/core/frontend-entry.tsx`;
  const loader = moduleEntries[entryPath];
  if (!loader) {
    return null;
  }

  const LazySpace = lazy(async () => {
    const loaded = await loader();
    if (!loaded.default || loaded.default.id !== moduleId) {
      throw new Error(`Invalid frontend module entry for '${moduleId}'`);
    }
    const Space = loaded.default.Space;
    return {
      default: ({
        module,
        backendURL,
      }: {
        module: ModuleRegistryItem;
        backendURL: string | null;
      }) => (
        <Space
          moduleId={module.id}
          moduleLabel={module.label}
          namespace={module.namespace}
          backendURL={backendURL}
        />
      ),
    };
  });

  const Wrapped = ({ module, backendURL }: ModuleHostProps) => (
    <Suspense fallback={<ModuleLoading moduleId={module.id} />}>
      <LazySpace module={module} backendURL={backendURL} />
    </Suspense>
  );

  moduleCache.set(moduleId, Wrapped);
  return Wrapped;
}

export function ModuleSpaceHost({ module }: { module: ModuleRegistryItem }) {
  const { backendURL } = useBootstrap();
  const Component = useMemo(() => resolveModuleComponent(module.id), [module.id]);

  if (!Component) {
    return <ModuleLoadError message={`Frontend entry missing for module '${module.id}'`} />;
  }

  return <Component module={module} backendURL={backendURL} />;
}
