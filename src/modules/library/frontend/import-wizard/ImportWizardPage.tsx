import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
} from "react";
import { ArrowLeft } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useImportWizardStore } from "./useImportWizardStore";
import { WizardProgressBar } from "./WizardProgressBar";
import { SymbolStep } from "./steps/SymbolStep";
import { FootprintStep } from "./steps/FootprintStep";
import { ModelStep } from "./steps/ModelStep";
import { MetadataStep } from "./steps/MetadataStep";
import { isAbortError, fileSignature, filesSignature } from "../utils";
import { commitKicadImportRequest, inspectKicadImport } from "./import-api";

const STEP_SYMBOL = 0;
const STEP_FOOTPRINT = 1;
const STEP_MODEL = 2;
const STEP_METADATA = 3;

const STEPS = [
  { label: "Symbol" },
  { label: "Footprints" },
  { label: "Model" },
  { label: "Metadata" },
] as const;

interface ImportWizardPageProps {
  backendURL: string | null | undefined;
  moduleId: string;
  onClose: () => void;
  onImported: () => void;
}

export function ImportWizardPage({
  backendURL,
  moduleId,
  onClose,
  onImported,
}: ImportWizardPageProps): ReactElement {
  const inspectAbortRef = useRef<AbortController | null>(null);
  const commitAbortRef = useRef<AbortController | null>(null);

  const symbolFile = useImportWizardStore((s) => s.symbolFile);
  const footprintFiles = useImportWizardStore((s) => s.footprintFiles);
  const currentStep = useImportWizardStore((s) => s.currentStep);
  const loadingCommit = useImportWizardStore((s) => s.loadingCommit);
  const commitError = useImportWizardStore((s) => s.commitError);

  // Single derived selector — avoids 3 separate subscriptions for inspectStatus,
  // selectedSymbolId, componentName that only feed readyForAdvancedSteps / canProceed.
  const { readyForAdvancedSteps, canProceedMetadata, loadingInspect } =
    useImportWizardStore(
      useShallow((s) => ({
        readyForAdvancedSteps:
          !!s.symbolFile &&
          s.inspectStatus === "success" &&
          s.selectedSymbolId.length > 0,
        canProceedMetadata: s.componentName.trim().length > 0,
        loadingInspect: s.inspectStatus === "loading",
      })),
    );

  const symbolSig = useMemo(() => fileSignature(symbolFile), [symbolFile]);
  const footprintSig = useMemo(
    () => filesSignature(footprintFiles),
    [footprintFiles],
  );

  useEffect(() => {
    return () => {
      inspectAbortRef.current?.abort();
      commitAbortRef.current?.abort();
      // Don't reset store here — StrictMode double-mounts trigger this cleanup,
      // destroying wizard state mid-session. Store resets via handleClose instead.
    };
  }, []);

  useEffect(() => {
    const store = useImportWizardStore.getState();

    if (!symbolFile) {
      inspectAbortRef.current?.abort();
      store.resetInspectSession();
      store.goToStep(STEP_SYMBOL);
      return;
    }

    if (!backendURL) {
      inspectAbortRef.current?.abort();
      store.finishInspectError("Backend URL unavailable");
      store.goToStep(STEP_SYMBOL);
      return;
    }

    const controller = new AbortController();
    inspectAbortRef.current?.abort();
    inspectAbortRef.current = controller;

    const run = async () => {
      if (controller.signal.aborted) return;
      store.beginInspect();

      try {
        const previous = useImportWizardStore.getState();
        const symbolLibrary = {
          fileName: symbolFile.name,
          content: await symbolFile.text(),
        };
        const footprints = await Promise.all(
          footprintFiles.map(async (file) => ({
            fileName: file.name,
            content: await file.text(),
          })),
        );

        const data = await inspectKicadImport(
          backendURL,
          moduleId,
          { symbolLibrary, footprints },
          controller.signal,
        );
        const preservedSymbolId =
          previous.selectedSymbolId.length > 0 &&
          data.symbols.some((symbol) => symbol.id === previous.selectedSymbolId)
            ? previous.selectedSymbolId
            : (data.symbols[0]?.id ?? "");

        const preservedFootprintId =
          previous.selectedFootprintId.length > 0 &&
          data.footprints.some(
            (footprint) => footprint.id === previous.selectedFootprintId,
          )
            ? previous.selectedFootprintId
            : (data.footprints[0]?.id ?? "");

        const selectedSymbolForDefaults =
          data.symbols.find((symbol) => symbol.id === preservedSymbolId) ??
          data.symbols[0] ??
          null;

        // Single batched update — triggers ONE re-render instead of 6
        store.completeInspect({
          inspectData: data,
          selectedSymbolId: preservedSymbolId,
          selectedFootprintId: preservedFootprintId,
          componentName: selectedSymbolForDefaults?.name,
          description: selectedSymbolForDefaults?.description ?? "",
        });
      } catch (err) {
        if (isAbortError(err)) {
          return;
        }
        store.finishInspectError(
          err instanceof Error ? err.message : "Failed to inspect KiCad files",
        );
        store.goToStep(STEP_SYMBOL);
      } finally {
        if (inspectAbortRef.current === controller) {
          inspectAbortRef.current = null;
        }
      }
    };

    void run();

    return () => {
      controller.abort();
    };
    // symbolSig/footprintSig capture file identity — no need for symbolFile/footprintFiles
    // as separate deps. Fewer deps = fewer StrictMode double-fires.
  }, [symbolSig, footprintSig, backendURL, moduleId]);

  const runCommit = useCallback(async () => {
    const store = useImportWizardStore.getState();
    if (!backendURL || !symbolFile) {
      store.setCommitError("Backend URL unavailable");
      return;
    }

    commitAbortRef.current?.abort();
    const controller = new AbortController();
    commitAbortRef.current = controller;

    store.clearCommitError();
    store.setLoadingCommit(true);

    try {
      const symbolLibrary = {
        fileName: symbolFile.name,
        content: await symbolFile.text(),
      };
      const footprints = await Promise.all(
        footprintFiles.map(async (file) => ({
          fileName: file.name,
          content: await file.text(),
        })),
      );

      await commitKicadImportRequest(
        backendURL,
        moduleId,
        {
          symbolLibrary,
          footprints,
          selection: {
            symbolId: store.selectedSymbolId,
            footprintId:
              store.selectedFootprintId.length > 0
                ? store.selectedFootprintId
                : null,
          },
          component: {
            name: store.componentName.trim(),
            description: store.description.trim(),
          },
        },
        controller.signal,
      );

      store.reset();
      onImported();
      onClose();
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      store.setCommitError(
        err instanceof Error ? err.message : "Failed to import component",
      );
    } finally {
      if (!controller.signal.aborted) {
        store.setLoadingCommit(false);
      }
      if (commitAbortRef.current === controller) {
        commitAbortRef.current = null;
      }
    }
  }, [backendURL, moduleId, symbolFile, footprintFiles, onImported, onClose]);

  const handleClose = useCallback(() => {
    inspectAbortRef.current?.abort();
    commitAbortRef.current?.abort();
    useImportWizardStore.getState().reset();
    onClose();
  }, [onClose]);

  const canOpenStep = useCallback(
    (step: number): boolean => {
      if (step <= currentStep) {
        return true;
      }
      if (step === STEP_SYMBOL) {
        return true;
      }
      return readyForAdvancedSteps;
    },
    [currentStep, readyForAdvancedSteps],
  );

  const canProceed = useMemo(() => {
    switch (currentStep) {
      case STEP_SYMBOL:
      case STEP_FOOTPRINT:
      case STEP_MODEL:
        return readyForAdvancedSteps;
      case STEP_METADATA:
        return readyForAdvancedSteps && canProceedMetadata;
      default:
        return false;
    }
  }, [canProceedMetadata, currentStep, readyForAdvancedSteps]);

  const isLastStep = currentStep === STEP_METADATA;
  const isCanvasStep =
    currentStep === STEP_SYMBOL || currentStep === STEP_FOOTPRINT;

  const handleNext = () => {
    if (!canProceed) {
      return;
    }
    if (isLastStep) {
      void runCommit();
      return;
    }
    useImportWizardStore.getState().goNext();
  };

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={handleClose}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              New component
            </h1>
          </div>

          <div className="min-w-0 flex-1">
            <WizardProgressBar
              currentStep={currentStep}
              steps={STEPS}
              canOpenStep={canOpenStep}
              onStepClick={(step) =>
                useImportWizardStore.getState().goToStep(step)
              }
            />
          </div>

          <div className="flex w-44 shrink-0 items-center justify-end gap-2">
            <button
              type="button"
              className={`h-8 min-w-[56px] rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 ${
                currentStep > 0 ? "" : "pointer-events-none invisible"
              }`}
              onClick={() => useImportWizardStore.getState().goBack()}
            >
              Back
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={!canProceed || loadingCommit || loadingInspect}
              className="h-8 rounded-md border border-violet-600 bg-violet-600 px-3 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLastStep
                ? loadingCommit
                  ? "Importing..."
                  : "Import component"
                : "Next"}
            </button>
          </div>
        </div>
      </div>

      <div
        className={isCanvasStep ? "min-h-0 flex-1" : "flex-1 overflow-auto p-6"}
      >
        {currentStep === STEP_SYMBOL && <SymbolStep />}
        {currentStep === STEP_FOOTPRINT && <FootprintStep />}
        {currentStep === STEP_MODEL && <ModelStep />}
        {currentStep === STEP_METADATA && <MetadataStep />}
      </div>

      {commitError && currentStep === STEP_METADATA ? (
        <div className="border-t border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {commitError}
        </div>
      ) : null}
    </div>
  );
}
