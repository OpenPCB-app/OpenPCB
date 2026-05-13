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
import {
  isEscapeShortcut,
  matchesKey,
  useWindowKeyboardShortcuts,
  type KeyboardShortcutBinding,
} from "../../../../shared/frontend/canvas/utils/keyboard-shortcuts";
import { isAbortError, fileSignature, filesSignature } from "../utils";
import {
  commitDrawnImportRequest,
  commitGeneratedImportRequest,
  commitKicadImportRequest,
  inspectKicadImport,
} from "./import-api";
import type { ModelConversionMetadata } from "../../contracts/import";
import {
  convertPendingModelConversion,
  uploadFootprintStepModel,
  validateStepUploadFile,
} from "../three-d/model-conversion";
import { useSymbolEditorStore } from "./editor";
import { useFootprintEditorStore } from "./footprint-editor";
import { toUserError } from "../utils";

export { convertPendingModelConversion };

const STEP_SYMBOL = 0;
const STEP_FOOTPRINT = 1;
const STEP_MODEL = 2;
const STEP_METADATA = 3;

const STEPS = [
  { label: "Symbol" },
  { label: "Footprints" },
  { label: "3D Model" },
  { label: "Metadata" },
] as const;

function isPendingModelConversion(
  value: unknown,
): value is ModelConversionMetadata {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { status?: unknown }).status === "pending_client_conversion" &&
    typeof (value as { footprintId?: unknown }).footprintId === "string" &&
    typeof (value as { sourceStepUrl?: unknown }).sourceStepUrl === "string"
  );
}

async function fetchCommittedFootprintId({
  backendURL,
  moduleId,
  componentId,
  signal,
}: {
  backendURL: string;
  moduleId: string;
  componentId: string;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await fetch(
    `${backendURL}/api/modules/${encodeURIComponent(moduleId)}/components/${encodeURIComponent(componentId)}/detail`,
    { signal },
  );
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    data?: { detail?: { footprint?: { id?: unknown } } };
    error?: string;
  } | null;
  const footprintId = payload?.data?.detail?.footprint?.id;
  if (!response.ok || !payload?.ok || typeof footprintId !== "string") {
    throw new Error(
      toUserError(payload, `Detail fetch failed (HTTP ${response.status})`),
    );
  }
  return footprintId;
}

function toGeneratedMountType(
  value: "smd" | "tht" | "mixed",
): "smd" | "through_hole" {
  return value === "smd" ? "smd" : "through_hole";
}

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
  const modelFile = useImportWizardStore((s) => s.modelFile);
  const currentStep = useImportWizardStore((s) => s.currentStep);
  const loadingCommit = useImportWizardStore((s) => s.loadingCommit);
  const commitError = useImportWizardStore((s) => s.commitError);
  const commitResult = useImportWizardStore((s) => s.commitResult);
  const modelConversionStatus = useImportWizardStore(
    (s) => s.modelConversionStatus,
  );
  const modelConversionMessage = useImportWizardStore(
    (s) => s.modelConversionMessage,
  );
  const symbolSource = useImportWizardStore((s) => s.symbolSource);

  // Single derived selector — avoids 3 separate subscriptions for inspectStatus,
  // selectedSymbolId, componentName that only feed readyForAdvancedSteps / canProceed.
  const { readyForAdvancedSteps, canProceedMetadata, loadingInspect } =
    useImportWizardStore(
      useShallow((s) => ({
        readyForAdvancedSteps:
          s.symbolSource === "draw" ||
          (!!s.symbolFile &&
            s.inspectStatus === "success" &&
            s.selectedSymbolId.length > 0),
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
    if (!symbolFile) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [symbolFile]);

  useEffect(() => {
    const store = useImportWizardStore.getState();
    const isDrawMode = symbolSource === "draw";

    // Draw mode: no symbol file to inspect. Parse footprints only (when any);
    // otherwise reset the inspect session. Never redirect — user may be on the
    // Footprint step importing .kicad_mod files after drawing a symbol.
    if (!isDrawMode && !symbolFile) {
      inspectAbortRef.current?.abort();
      store.resetInspectSession();
      store.goToStep(STEP_SYMBOL);
      return;
    }

    if (isDrawMode && footprintFiles.length === 0) {
      inspectAbortRef.current?.abort();
      store.resetInspectSession();
      return;
    }

    if (!backendURL) {
      inspectAbortRef.current?.abort();
      store.finishInspectError("Backend URL unavailable");
      if (!isDrawMode) store.goToStep(STEP_SYMBOL);
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
        const symbolLibrary = symbolFile
          ? {
              fileName: symbolFile.name,
              content: await symbolFile.text(),
            }
          : null;
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
        // Only rewind to Symbol step when the user IS using imports; in draw
        // mode the symbol step has nothing file-related to fix.
        if (!isDrawMode) store.goToStep(STEP_SYMBOL);
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
  }, [symbolSig, footprintSig, backendURL, moduleId, symbolSource]);

  const runCommit = useCallback(async () => {
    const store = useImportWizardStore.getState();
    const isDrawMode = store.symbolSource === "draw";

    if (!backendURL) {
      store.setCommitError("Backend URL unavailable");
      return;
    }
    if (!isDrawMode && !symbolFile) {
      store.setCommitError("No symbol file selected");
      return;
    }

    commitAbortRef.current?.abort();
    const controller = new AbortController();
    commitAbortRef.current = controller;

    store.clearCommitError();
    store.setLoadingCommit(true);

    try {
      let result;

      if (isDrawMode) {
        // Drawn symbol path: footprint from preset, imported files, drawn, or none.
        const editorState = useSymbolEditorStore.getState();
        const symbolRenderSource = editorState.toSymbolRenderSource();

        let footprintMode: "import" | "generated" | "drawn" | "none" = "none";
        let footprintFilesPayload:
          | { fileName: string; content: string }[]
          | undefined;
        let footprintSelection: { footprintId: string } | undefined;
        let generatedFp;
        let drawnFp;

        if (store.footprintSource === "draw") {
          const fpEditor = useFootprintEditorStore.getState();
          const fpSource = fpEditor.toFootprintRenderSource();
          footprintMode = "drawn";
          drawnFp = {
            source: fpSource,
            metadata: {
              name: fpEditor.footprintName || "FP",
              mountType: toGeneratedMountType(fpEditor.derivedMountType()),
              packageCode: { imperial: null, metric: null },
              tags: ["drawn-footprint"],
            },
          };
        } else if (
          store.footprintSource === "preset" &&
          store.generatedFootprint
        ) {
          footprintMode = "generated";
          generatedFp = {
            source: store.generatedFootprint.source,
            metadata: store.generatedFootprint.metadata,
          };
        } else if (
          store.footprintSource === "import" &&
          footprintFiles.length > 0 &&
          store.selectedFootprintId.length > 0
        ) {
          footprintMode = "import";
          footprintFilesPayload = await Promise.all(
            footprintFiles.map(async (file) => ({
              fileName: file.name,
              content: await file.text(),
            })),
          );
          footprintSelection = { footprintId: store.selectedFootprintId };
        }

        result = await commitDrawnImportRequest(
          backendURL,
          moduleId,
          {
            drawnSymbol: {
              source: symbolRenderSource,
              referencePrefix: editorState.referencePrefix,
            },
            footprintMode,
            footprintFiles: footprintFilesPayload,
            footprintSelection,
            generatedFootprint: generatedFp,
            drawnFootprint: drawnFp,
            component: {
              name: store.componentName.trim(),
              description: store.description.trim(),
            },
          },
          controller.signal,
        );
      } else if (store.footprintSource === "draw") {
        // Imported symbol + drawn footprint → use generated endpoint with provenance
        const symbolLibrary = {
          fileName: symbolFile!.name,
          content: await symbolFile!.text(),
        };
        const fpEditor = useFootprintEditorStore.getState();
        const fpSource = fpEditor.toFootprintRenderSource();
        result = await commitGeneratedImportRequest(
          backendURL,
          moduleId,
          {
            symbolLibrary,
            selection: { symbolId: store.selectedSymbolId },
            generatedFootprint: {
              source: fpSource,
              metadata: {
                name: fpEditor.footprintName || "FP",
                mountType: toGeneratedMountType(fpEditor.derivedMountType()),
                packageCode: { imperial: null, metric: null },
                tags: ["drawn-footprint"],
              },
            },
            footprintProvenance: "drawn",
            component: {
              name: store.componentName.trim(),
              description: store.description.trim(),
            },
          },
          controller.signal,
        );
      } else if (
        store.footprintSource === "preset" &&
        store.generatedFootprint
      ) {
        // Imported symbol + generated footprint
        const symbolLibrary = {
          fileName: symbolFile!.name,
          content: await symbolFile!.text(),
        };
        result = await commitGeneratedImportRequest(
          backendURL,
          moduleId,
          {
            symbolLibrary,
            selection: { symbolId: store.selectedSymbolId },
            generatedFootprint: {
              source: store.generatedFootprint.source,
              metadata: store.generatedFootprint.metadata,
            },
            component: {
              name: store.componentName.trim(),
              description: store.description.trim(),
            },
          },
          controller.signal,
        );
      } else {
        // Imported symbol + imported footprint (or no footprint)
        const symbolLibrary = {
          fileName: symbolFile!.name,
          content: await symbolFile!.text(),
        };
        const footprintsData = await Promise.all(
          footprintFiles.map(async (file) => ({
            fileName: file.name,
            content: await file.text(),
          })),
        );
        result = await commitKicadImportRequest(
          backendURL,
          moduleId,
          {
            symbolLibrary,
            footprints: footprintsData,
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
      }

      const modelConversion = isPendingModelConversion(
        (result as unknown as { modelConversion?: unknown }).modelConversion,
      )
        ? (result as unknown as { modelConversion: ModelConversionMetadata })
            .modelConversion
        : null;
      if (modelFile) {
        const validationError = validateStepUploadFile(modelFile);
        if (validationError) {
          throw new Error(validationError);
        }
        const footprintId = await fetchCommittedFootprintId({
          backendURL,
          moduleId,
          componentId: result.componentId,
          signal: controller.signal,
        });
        void uploadFootprintStepModel({
          backendURL,
          moduleId,
          footprintId,
          stepFile: modelFile,
          signal: controller.signal,
          onProgress: (status, message) => {
            useImportWizardStore
              .getState()
              .setModelConversionProgress(status, message ?? null);
          },
        }).catch((conversionError) => {
          useImportWizardStore
            .getState()
            .setModelConversionProgress(
              "failed",
              conversionError instanceof Error
                ? conversionError.message
                : "3D model conversion failed",
            );
        });
      }
      if (modelConversion) {
        // Don't block commit UX on conversion: model conversion happens client-side
        // and can hang/timeout independently; import should still succeed.
        void convertPendingModelConversion({
          backendURL,
          moduleId,
          conversion: modelConversion,
          signal: controller.signal,
          onProgress: (status, message) => {
            useImportWizardStore
              .getState()
              .setModelConversionProgress(status, message ?? null);
          },
        }).catch((conversionError) => {
          useImportWizardStore
            .getState()
            .setModelConversionProgress(
              "failed",
              conversionError instanceof Error
                ? conversionError.message
                : "3D model conversion failed",
            );
        });
      }

      onImported();
      if (result.reused) {
        store.setCommitResult(result);
      } else {
        store.reset();
        useSymbolEditorStore.getState().reset();
        useFootprintEditorStore.getState().reset();
        onClose();
      }
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      store.setCommitError(
        err instanceof Error ? err.message : "Failed to import component",
      );
      store.setModelConversionProgress("idle", null);
    } finally {
      if (!controller.signal.aborted) {
        store.setLoadingCommit(false);
      }
      if (commitAbortRef.current === controller) {
        commitAbortRef.current = null;
      }
    }
  }, [backendURL, moduleId, symbolFile, footprintFiles, modelFile, onImported, onClose]);

  const handleClose = useCallback(
    (skipConfirm = false) => {
      const wizardState = useImportWizardStore.getState();
      const editorState = useSymbolEditorStore.getState();
      const hasWork =
        wizardState.symbolFile !== null ||
        wizardState.modelFile !== null ||
        (wizardState.symbolSource === "draw" &&
          (editorState.graphics.length > 0 || editorState.pins.length > 0));
      if (!skipConfirm && hasWork) {
        const confirmed = window.confirm(
          "Close the wizard? Unsaved changes will be lost.",
        );
        if (!confirmed) return;
      }
      inspectAbortRef.current?.abort();
      commitAbortRef.current?.abort();
      useImportWizardStore.getState().reset();
      useSymbolEditorStore.getState().reset();
      useFootprintEditorStore.getState().reset();
      onClose();
    },
    [onClose],
  );

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
        return readyForAdvancedSteps;
      case STEP_MODEL:
        return readyForAdvancedSteps && (!modelFile || !validateStepUploadFile(modelFile));
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

  const keyboardBindings = useMemo<KeyboardShortcutBinding[]>(
    () => [
      {
        matches: (e) => isEscapeShortcut(e),
        run: () => handleClose(),
      },
      {
        matches: (e) => matchesKey(e, "Enter"),
        run: (e) => {
          e.preventDefault();
          handleNext();
        },
      },
    ],
    [handleClose, handleNext],
  );
  useWindowKeyboardShortcuts(keyboardBindings, {
    ignoreEditableTarget: true,
  });

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={() => handleClose()}
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

      {commitResult?.reused && currentStep === STEP_METADATA ? (
        <div className="flex items-center justify-between border-t border-amber-200 bg-amber-50 px-6 py-2 dark:border-amber-900 dark:bg-amber-950">
          <span className="text-sm text-amber-700 dark:text-amber-300">
            Component &ldquo;{commitResult.componentName}&rdquo; already exists
            &mdash; reused existing record.
          </span>
          <button
            type="button"
            onClick={() => handleClose(true)}
            className="ml-4 shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-300"
          >
            Close
          </button>
        </div>
      ) : modelConversionStatus !== "idle" && currentStep === STEP_METADATA ? (
        <div
          className={`border-t px-6 py-2 text-sm ${
            modelConversionStatus === "failed"
              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
              : "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300"
          }`}
        >
          {modelConversionMessage ??
            (modelConversionStatus === "ready"
              ? "Ready"
              : "Converting 3D model…")}
        </div>
      ) : commitError && currentStep === STEP_METADATA ? (
        <div className="border-t border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {commitError}
        </div>
      ) : null}
    </div>
  );
}
