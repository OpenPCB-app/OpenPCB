import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useNavigationStore } from "@/stores/navigation-store";
import { cn } from "@/lib/utils";
import { useImportPreview } from "@/hooks/useImportPreview";
import { useImportConfirm } from "@/hooks/useImportConfirm";
import { ImportUploadStep } from "@/components/import/ImportUploadStep";
import { ImportPreviewStep } from "@/components/import/ImportPreviewStep";
import { ImportLinkingStep } from "@/components/import/ImportLinkingStep";
import { ImportConfirmStep } from "@/components/import/ImportConfirmStep";
import { Progress } from "@/components/ui/progress";

const WIZARD_STEPS = [
  { id: 1, label: "Upload" },
  { id: 2, label: "Preview" },
  { id: 3, label: "Link" },
  { id: 4, label: "Confirm" },
];

export function ImportWizard() {
  const navigateToLibrary = useNavigationStore((s) => s.navigateToLibrary);
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "overwrite" | "rename">(
    "skip",
  );

  const { isLoading: isGeneratingPreview, preview, error: previewError, generatePreview } = useImportPreview();
  const { isImporting, result: importResult, error: importError, confirmImport } = useImportConfirm();

  const handleNext = async () => {
    if (step === 1) {
      // Generate preview
      if (files.length === 0) return;
      const result = await generatePreview(files);
      if (result) {
        setStep(2);
      }
    } else if (step === 2) {
      // Check for blockers
      if (preview && preview.totalBlockers === 0) {
        setStep(3);
      }
    } else if (step === 3) {
      setStep(4);
    } else if (step === 4) {
      // Confirm import
      if (!preview) return;
      
      const result = await confirmImport({
        groups: preview.groups.map((g) => ({
          familyLabel: g.suggestedFamilyLabel,
          canonicalKey: g.suggestedCanonicalKey,
          symbolFileName: g.symbolFileName,
          variants: g.variants.map((v) => ({
            canonicalCode: v.suggestedCanonicalCode,
            humanLabel: v.suggestedHumanLabel,
            footprintFileNames: v.footprintFileNames,
            model3dFileNames: v.model3dFileNames,
          })),
        })),
        duplicateStrategy,
      });

      if (result) {
        // Navigate to library screen on success
        setTimeout(() => {
          navigateToLibrary();
        }, 1500);
      }
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleClose = () => {
    navigateToLibrary();
  };

  const canProceed = () => {
    if (step === 1) return files.length > 0 && !isGeneratingPreview;
    if (step === 2) return preview && preview.totalBlockers === 0;
    if (step === 3) return true;
    if (step === 4) return !isImporting;
    return false;
  };

  const getButtonLabel = () => {
    if (step === 1) return isGeneratingPreview ? "Generating Preview..." : "Generate Preview";
    if (step === 4) return isImporting ? "Importing..." : "Import Components";
    return "Next";
  };

  // Show success state
  if (importResult) {
    return (
      <div className="flex h-full flex-col bg-bg-primary">
        <div className="flex items-center justify-between border-b border-border-default bg-bg-secondary px-6 py-3">
          <h1 className="text-lg font-medium text-text-primary">Import Complete</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-[500px] text-center space-y-4">
            <div className="flex justify-center">
              <div className="rounded-full bg-success/20 p-4">
                <svg
                  className="h-12 w-12 text-success"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            </div>
            <h2 className="text-xl font-semibold text-text-primary">Import Successful</h2>
            <div className="space-y-2 text-sm text-text-muted">
              <p>{importResult.importedCount} components imported successfully</p>
              {importResult.skippedCount > 0 && (
                <p>{importResult.skippedCount} components skipped (duplicates)</p>
              )}
              {importResult.errorCount > 0 && (
                <p className="text-destructive">{importResult.errorCount} components failed</p>
              )}
            </div>
            <p className="text-xs text-text-tertiary">Redirecting to library...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Wizard header */}
      <div className="flex items-center gap-3 border-b border-border-default bg-bg-secondary px-6 py-3">
        <button
          className="text-text-tertiary hover:text-text-secondary"
          onClick={handleClose}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-medium text-text-primary">Import Components</h1>
        <span className="text-sm text-text-tertiary">
          Step {step} of 4: {WIZARD_STEPS[step - 1]?.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex px-6 py-3 gap-1">
        {WIZARD_STEPS.map((s) => (
          <div key={s.id} className="flex-1 flex flex-col items-center gap-1">
            <div
              className={cn(
                "h-1 w-full rounded-full",
                s.id < step
                  ? "bg-success"
                  : s.id === step
                    ? "bg-brand"
                    : "bg-bg-input",
              )}
            />
            <span
              className={cn(
                "text-[10px]",
                s.id <= step ? "text-text-secondary" : "text-text-muted",
              )}
            >
              {s.id}. {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === 1 && <ImportUploadStep files={files} onFilesChange={setFiles} />}
      
      {step === 2 && preview && (
        <ImportPreviewStep
          groups={preview.groups}
          ungroupedFiles={preview.ungroupedFiles}
          totalWarnings={preview.totalWarnings}
          totalBlockers={preview.totalBlockers}
        />
      )}

      {step === 3 && <ImportLinkingStep />}

      {step === 4 && preview && (
        <ImportConfirmStep
          groups={preview.groups}
          duplicateStrategy={duplicateStrategy}
          onDuplicateStrategyChange={setDuplicateStrategy}
        />
      )}

      {/* Error display */}
      {(previewError || importError) && (
        <div className="px-6 pb-4">
          <div className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3">
            <p className="text-sm text-destructive">
              {previewError?.message || importError?.message}
            </p>
          </div>
        </div>
      )}

      {/* Import progress */}
      {isImporting && (
        <div className="px-6 pb-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-secondary">Importing components...</span>
              <Loader2 className="h-4 w-4 animate-spin text-brand" />
            </div>
            <Progress value={33} />
          </div>
        </div>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-end gap-2 border-t border-border-default px-6 py-3">
        {step > 1 && !isImporting && (
          <button
            className="h-9 rounded-md bg-bg-input px-4 text-sm font-medium text-text-secondary hover:bg-bg-elevated transition-colors"
            onClick={handleBack}
          >
            Back
          </button>
        )}
        <button
          className="flex items-center gap-2 h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleNext}
          disabled={!canProceed()}
        >
          {(isGeneratingPreview || isImporting) && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          {getButtonLabel()}
        </button>
      </div>
    </div>
  );
}
