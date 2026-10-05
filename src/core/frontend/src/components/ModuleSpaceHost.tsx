import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { FrontendModuleEntry } from "../../../contracts/modules/frontend-entry";
import type { ModuleManifest } from "../../../contracts/modules/manifest";
import type { ModuleRegistryItem } from "../../../contracts/modules/registry";
import { ErrorBoundary } from "@shared/frontend/ui/error-boundary";
import { Recovery } from "../shell/Recovery";
import { reportRenderError } from "../shell/GlobalErrors";
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

function useModuleEntry(moduleId: string) {
  const [loadedEntry, setLoadedEntry] = useState<{
    moduleId: string;
    entry: FrontendModuleEntry;
  } | null>(null);
  const [loadError, setLoadError] = useState<{
    moduleId: string;
    message: string;
  } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    const loader = moduleEntryLoadersById.get(moduleId);
    setLoadedEntry(null);
    setLoadError(null);

    if (!loader) {
      setLoadError({
        moduleId: moduleId,
        message: `Frontend entry missing for module '${moduleId}'`,
      });
      return () => {
        mounted = false;
      };
    }

    loader()
      .then((file) => {
        if (mounted) {
          setLoadedEntry({ moduleId: moduleId, entry: file.default });
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setLoadError({
          moduleId: moduleId,
          message:
            err instanceof Error
              ? `Failed to load module '${moduleId}': ${err.message}`
              : `Failed to load module '${moduleId}'`,
        });
      });

    return () => {
      mounted = false;
    };
  }, [moduleId, loadAttempt]);

  return {
    currentEntry: loadedEntry?.moduleId === moduleId ? loadedEntry.entry : null,
    loadError: loadError?.moduleId === moduleId ? loadError : null,
    retry: () => setLoadAttempt((attempt) => attempt + 1),
  };
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
  const { currentEntry, loadError, retry } = useModuleEntry(module.id);
  const Component = useMemo(
    () => (currentEntry ? resolveModuleComponent(currentEntry) : null),
    [currentEntry],
  );

  if (loadError) {
    return (
      <Recovery
        error={new Error(loadError.message)}
        title={`${module.sidebar.label} could not load`}
        reset={retry}
      />
    );
  }

  if (!Component) {
    return (
      <div className="m-6 text-sm text-text-tertiary">Loading module…</div>
    );
  }

  return (
    <ErrorBoundary
      scope={`module/${module.id}`}
      resetKeys={[module.id, designId]}
      onError={reportRenderError}
      fallback={(props) => (
        <Recovery
          {...props}
          title={`${module.sidebar?.label ?? module.id} stopped working`}
        />
      )}
    >
      <Component
        module={module}
        backendURL={backendURL}
        designId={designId}
        params={params}
      />
    </ErrorBoundary>
  );
}
