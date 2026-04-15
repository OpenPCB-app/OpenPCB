import { memo, type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import { useImportWizardStore } from "../useImportWizardStore";

export const MetadataStep = memo(function MetadataStep(): ReactElement {
  const {
    componentName,
    setComponentName,
    description,
    setDescription,
    inspectData,
    selectedFootprintId,
    hasFootprint,
    inputsLocked,
  } = useImportWizardStore(
    useShallow((s) => ({
      componentName: s.componentName,
      setComponentName: s.setComponentName,
      description: s.description,
      setDescription: s.setDescription,
      inspectData: s.inspectData,
      selectedFootprintId: s.selectedFootprintId,
      hasFootprint:
        s.selectedFootprintId.length > 0 ||
        (s.footprintSource === "preset" && s.generatedFootprint !== null),
      inputsLocked: s.inspectStatus === "loading",
    })),
  );

  const symbolWarningCount = inspectData
    ? inspectData.warnings.filter((w) => w.scope === "symbol").length
    : 0;
  const footprintWarningCount = inspectData
    ? inspectData.warnings.filter((w) => w.scope === "footprint").length
    : 0;
  const totalWarnings = inspectData?.warnings.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Metadata
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Review and edit the component details before importing.
        </p>

        {inputsLocked ? (
          <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
            Re-inspecting files. Metadata editing is temporarily locked.
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="text-slate-700 dark:text-slate-300">
              Component name <span className="text-red-500">*</span>
            </span>
            <input
              value={componentName}
              onChange={(e) => setComponentName(e.target.value)}
              placeholder="e.g. C, R, LED"
              disabled={inputsLocked}
              className="h-8 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-slate-700 dark:text-slate-300">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Unpolarized capacitor"
              rows={3}
              disabled={inputsLocked}
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </div>

        {totalWarnings > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
            <div className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {totalWarnings} parser warning{totalWarnings !== 1 ? "s" : ""}
            </div>
            <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {symbolWarningCount > 0 && (
                <span>{symbolWarningCount} symbol</span>
              )}
              {symbolWarningCount > 0 && footprintWarningCount > 0 && (
                <span>, </span>
              )}
              {footprintWarningCount > 0 && (
                <span>{footprintWarningCount} footprint</span>
              )}
            </div>
          </div>
        )}

        {!hasFootprint && inspectData && (
          <div className="mt-4 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
            Importing without a footprint. Component will use visible
            placeholder: <span className="font-semibold">No footprint yet</span>
            .
          </div>
        )}

        {totalWarnings === 0 && inspectData && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            No parser warnings
          </div>
        )}
      </div>
    </div>
  );
});
