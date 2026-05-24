import { useBootstrap } from "../providers/BootstrapProvider";
import { ModuleSpaceHost } from "../components/ModuleSpaceHost";
import type { ModuleRegistryItem } from "../../../contracts/modules/registry";

function ModuleStateMessage({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="m-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        {detail}
      </p>
    </div>
  );
}

export function ModuleScreen({
  moduleId,
  designId,
  params,
}: {
  moduleId: string;
  designId?: string;
  params?: Record<string, string>;
}) {
  const { moduleRegistry } = useBootstrap();

  if (!moduleRegistry) {
    return (
      <ModuleStateMessage
        title="Module registry unavailable"
        detail="Backend did not provide module registry payload."
      />
    );
  }

  const module = moduleRegistry.modules.find(
    (item: ModuleRegistryItem) => item.id === moduleId,
  );
  if (!module) {
    return (
      <ModuleStateMessage
        title="Module not found"
        detail={`Module '${moduleId}' is not registered in backend runtime.`}
      />
    );
  }

  if (module.status !== "loaded") {
    return (
      <ModuleStateMessage
        title="Module unavailable"
        detail={module.reason ?? `Module '${moduleId}' failed to load.`}
      />
    );
  }

  return <ModuleSpaceHost module={module} designId={designId} params={params} />;
}
