import { useMemo, type ComponentType } from "react";
import type { FrontendModuleEntry } from "../../../contracts/modules/frontend-entry";
import type { ModuleRegistryItem } from "../../../contracts/modules/registry";
import { useBootstrap } from "../providers/BootstrapProvider";

interface FrontendModuleEntryFile {
  default: FrontendModuleEntry;
}

type ModuleHostProps = {
  module: ModuleRegistryItem;
  backendURL: string | null;
  designId?: string;
};

/**
 * Eager glob of every module's frontend barrel. All module Spaces are
 * resolved at app bootstrap, so navigation between modules is instant and
 * no Suspense boundary is required at the host level.
 */
const moduleEntries = import.meta.glob<FrontendModuleEntryFile>(
  "../../../../modules/*/module.frontend.ts",
  { eager: true },
);

const moduleEntriesById: ReadonlyMap<string, FrontendModuleEntry> = new Map(
  Object.entries(moduleEntries).map(([entryPath, file]) => {
    const match = entryPath.match(/\/modules\/([^/]+)\/module\.frontend\.ts$/);
    const moduleId = match?.[1] ?? entryPath;
    return [moduleId, file.default] as const;
  }),
);

export function getFrontendModuleEntry(
  moduleId: string,
): FrontendModuleEntry | undefined {
  return moduleEntriesById.get(moduleId);
}

function ModuleLoadError({ message }: { message: string }) {
  return (
    <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {message}
    </div>
  );
}

function resolveModuleComponent(
  moduleId: string,
): ComponentType<ModuleHostProps> | null {
  const entry = moduleEntriesById.get(moduleId);
  if (!entry) {
    return null;
  }
  const Space = entry.Space;
  const Host: ComponentType<ModuleHostProps> = ({
    module,
    backendURL,
    designId,
  }) => (
    <Space
      moduleId={module.id}
      namespace={module.namespace}
      backendURL={backendURL}
      designId={designId}
    />
  );
  return Host;
}

export function ModuleSpaceHost({
  module,
  designId,
}: {
  module: ModuleRegistryItem;
  designId?: string;
}) {
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
    <Component module={module} backendURL={backendURL} designId={designId} />
  );
}
