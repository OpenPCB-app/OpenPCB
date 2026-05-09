import { Box, Upload, X } from "lucide-react";
import { memo, useId, type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import { validateStepUploadFile } from "../../three-d/model-conversion";
import { useImportWizardStore } from "../useImportWizardStore";

export const ModelStep = memo(function ModelStep(): ReactElement {
  const inputId = useId();
  const { modelFile, setModelFile } = useImportWizardStore(
    useShallow((s) => ({
      modelFile: s.modelFile,
      setModelFile: s.setModelFile,
    })),
  );
  const validationError = modelFile ? validateStepUploadFile(modelFile) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-violet-100 p-2 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
            <Box className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              3D STEP model
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Optional. Upload a STEP/STP body for this footprint; OpenPCB will
              convert it to GLB after the component is imported.
            </p>
          </div>
        </div>

        <input
          id={inputId}
          type="file"
          accept=".step,.stp"
          onClick={(event) => {
            event.currentTarget.value = "";
          }}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setModelFile(file);
          }}
          className="sr-only"
        />

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label
            htmlFor={inputId}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-violet-500 bg-violet-600 px-4 text-sm font-semibold text-white"
          >
            <Upload className="h-4 w-4" />
            Select STEP model
          </label>
          {modelFile ? (
            <button
              type="button"
              onClick={() => setModelFile(null)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <X className="h-4 w-4" />
              Remove
            </button>
          ) : null}
        </div>
      </section>

      {modelFile ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Selected model
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex min-w-0 items-center justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">File</dt>
              <dd className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-100" title={modelFile.name}>
                {modelFile.name}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400">Size</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">
                {(modelFile.size / 1024 / 1024).toFixed(2)} MB
              </dd>
            </div>
          </dl>
          {validationError ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              {validationError}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
              This model will be converted and attached to the imported footprint.
            </div>
          )}
        </section>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          No 3D model selected. The component will still import and Designer will
          use fallback geometry until a STEP model is added.
        </div>
      )}
    </div>
  );
});
