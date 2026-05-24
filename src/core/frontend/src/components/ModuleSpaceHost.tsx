import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { FrontendModuleEntry } from "../../../contracts/modules/frontend-entry";
import type { ModuleManifest } from "../../../contracts/modules/manifest";
import type { ModuleRegistryItem } from "../../../contracts/modules/registry";
import { useBootstrap } from "../providers/BootstrapProvider";

interface FrontendModuleEntryFile {
  default: FrontendModuleEntry;
}

interface FrontendModuleManifestFile {
  default: ModuleManifest;
}

type ModuleHostProps = {
  module: ModuleRegistryItem;
  backendURL: string | null;
  designId?: string;
  params?: Record<string, string>;
};

/**
 * Lazy glob of every module frontend barrel. Keep module code off the app
 * bootstrap path so one broken optional/dev module cannot white-screen the
 * whole shell.
 */
const moduleEntryLoaders = import.meta.glob<FrontendModuleEntryFile>(
  "../../../../modules/*/module.frontend.ts",
);

const moduleManifests = import.meta.glob<FrontendModuleManifestFile>(
  "../../../../modules/*/manifest.json",
  { eager: true },
);

const moduleEntryLoadersById: ReadonlyMap<
  string,
  () => Promise<FrontendModuleEntryFile>
> = new Map(
  Object.entries(moduleEntryLoaders).map(([entryPath, loader]) => {
    const match = entryPath.match(/\/modules\/([^/]+)\/module\.frontend\.ts$/);
    const moduleId = match?.[1] ?? entryPath;
    return [moduleId, loader] as const;
  }),
);

const moduleManifestsById: ReadonlyMap<string, ModuleManifest> = new Map(
  Object.entries(moduleManifests).map(([entryPath, file]) => {
    const match = entryPath.match(/\/modules\/([^/]+)\/manifest\.json$/);
    const moduleId = match?.[1] ?? entryPath;
    return [moduleId, file.default] as const;
  }),
);

export function getFrontendModuleEntry(
  moduleId: string,
): Pick<FrontendModuleEntry, "manifest"> | undefined {
  const manifest = moduleManifestsById.get(moduleId);
  return manifest ? { manifest } : undefined;
}

function ModuleLoadError({ message }: { message: string }) {
  return (
    <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {message}
    </div>
  );
}

function resolveModuleComponent(
  entry: FrontendModuleEntry,
): ComponentType<ModuleHostProps> | null {
  const Space = entry.Space;
  const Host: ComponentType<ModuleHostProps> = ({
    module,
    backendURL,
    designId,
    params,
  }) => (
    <Space
      moduleId={module.id}
      namespace={module.namespace}
      backendURL={backendURL}
      designId={designId}
      params={params}
    />
  );
  return Host;
}

export function ModuleSpaceHost({
  module,
  designId,
  params,
}: {
  module: ModuleRegistryItem;
  designId?: string;
  params?: Record<string, string>;
}) {
  const { backendURL } = useBootstrap();
  const [loadedEntry, setLoadedEntry] = useState<{
    moduleId: string;
    entry: FrontendModuleEntry;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const loader = moduleEntryLoadersById.get(module.id);
    setLoadedEntry(null);
    setError(null);

    if (!loader) {
      setError(`Frontend entry missing for module '${module.id}'`);
      return () => {
        mounted = false;
      };
    }

    loader()
      .then((file) => {
        if (mounted) {
          setLoadedEntry({ moduleId: module.id, entry: file.default });
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(
          err instanceof Error
            ? `Failed to load module '${module.id}': ${err.message}`
            : `Failed to load module '${module.id}'`,
        );
      });

    return () => {
      mounted = false;
    };
  }, [module.id]);

  const currentEntry =
    loadedEntry?.moduleId === module.id ? loadedEntry.entry : null;
  const Component = useMemo(
    () => (currentEntry ? resolveModuleComponent(currentEntry) : null),
    [currentEntry],
  );

  if (error) {
    return <ModuleLoadError message={error} />;
  }

  if (!Component) {
    return <div className="m-6 text-sm text-slate-500">Loading module…</div>;
  }

  return (
    <Component
      module={module}
      backendURL={backendURL}
      designId={designId}
      params={params}
    />
  );
}
