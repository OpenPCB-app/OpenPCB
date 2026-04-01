/**
 * ComponentWizard
 *
 * Main wizard component for creating new components.
 * Flow: Preset → Symbol → Footprint → (3D Model) → Specs
 *
 * Creates a backend draft on open, auto-saves on changes,
 * and publishes on "Save Component".
 */

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Loader2, Save, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import {
  useComponentWizardStore,
  type WizardStep,
} from "@/stores/component-wizard-store";
import {
  createComponentDraft,
  patchComponentDraft,
  publishComponentDraft,
} from "@/lib/api/component-api";
import { useSymbolEditorStore } from "@/components/symbol-editor";
import { PresetSelector } from "./PresetSelector";
import { SpecsStep } from "./SpecsStep";
import { transformWizardToBackendPayload } from "./transformers";
import {
  SymbolEditorCanvas,
  PinPalette,
  PinPropertiesPanel,
  BodyPresetSelector,
  SymbolEditorToolbar,
  SymbolMetadataEditor,
} from "@/components/symbol-editor";
import { FootprintEditorStep } from "@/components/footprint-editor";
import type { BodyPresetKind } from "@/components/symbol-editor/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComponentWizardProps {
  onClose: () => void;
  onPublished?: (familyId: string) => void;
}

// ---------------------------------------------------------------------------
// Step Configuration
// ---------------------------------------------------------------------------

const WIZARD_STEPS: { id: WizardStep; label: string; number: number }[] = [
  { id: "preset", label: "Preset", number: 1 },
  { id: "symbol", label: "Symbol", number: 2 },
  { id: "footprint", label: "Footprint", number: 3 },
  { id: "model", label: "3D Model", number: 4 },
  { id: "specs", label: "Specs", number: 5 },
];

function getStepNumber(step: WizardStep): number {
  return WIZARD_STEPS.find((s) => s.id === step)?.number ?? 1;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ComponentWizard({ onClose, onPublished }: ComponentWizardProps) {
  // Wizard store state
  const draftId = useComponentWizardStore((s) => s.draftId);
  const currentStep = useComponentWizardStore((s) => s.currentStep);
  const isSaving = useComponentWizardStore((s) => s.isSaving);
  const initDraft = useComponentWizardStore((s) => s.initDraft);
  const setStep = useComponentWizardStore((s) => s.setStep);
  const updateDraft = useComponentWizardStore((s) => s.updateDraft);
  const setSaving = useComponentWizardStore((s) => s.setSaving);
  const reset = useComponentWizardStore((s) => s.reset);
  const draft = useComponentWizardStore((s) => s.draft);

  // Symbol editor store
  const symbolDraft = useSymbolEditorStore((s) => s.draft);
  const resetSymbolDraft = useSymbolEditorStore((s) => s.resetDraft);
  const setBodyPreset = useSymbolEditorStore((s) => s.setBodyPreset);

  // Local state
  const [isInitializing, setIsInitializing] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize draft on mount
  useEffect(() => {
    let mounted = true;

    async function initializeWizard() {
      setIsInitializing(true);
      setError(null);

      try {
        // Create backend draft
        const backendDraft = await createComponentDraft({});

        if (!mounted) return;

        // Initialize wizard store with draft ID
        initDraft(backendDraft.id);

        // Reset symbol editor
        resetSymbolDraft();
      } catch (err) {
        if (!mounted) return;
        console.error("Failed to create draft:", err);
        setError("Failed to initialize wizard. Please try again.");
      } finally {
        if (mounted) {
          setIsInitializing(false);
        }
      }
    }

    initializeWizard();

    return () => {
      mounted = false;
    };
  }, [initDraft, resetSymbolDraft]);

  // Sync symbol editor changes to wizard store
  useEffect(() => {
    if (!symbolDraft || currentStep !== "symbol") return;

    updateDraft({
      displayLabel: symbolDraft.metadata.name,
      description: symbolDraft.metadata.description,
      symbolData: {
        id: symbolDraft.id,
        body: symbolDraft.body,
        pins: symbolDraft.pins,
        graphics: symbolDraft.graphics,
        metadata: symbolDraft.metadata,
      },
    });
  }, [symbolDraft, currentStep, updateDraft]);

  // Auto-save debounced (when wizard store is dirty)
  const isDirty = useComponentWizardStore((s) => s.isDirty);
  const markClean = useComponentWizardStore((s) => s.markClean);

  useEffect(() => {
    if (!isDirty || !draftId || !draft) return;

    const timeout = setTimeout(async () => {
      try {
        setSaving(true);
        await patchComponentDraft(draftId, { payload: draft as never });
        markClean();
      } catch (err) {
        console.error("Auto-save failed:", err);
        // Don't show error for auto-save failures, just log
      } finally {
        setSaving(false);
      }
    }, 1500);

    return () => clearTimeout(timeout);
  }, [isDirty, draftId, draft, setSaving, markClean]);

  // Handle preset selection
  const handlePresetSelect = useCallback(
    (preset: BodyPresetKind) => {
      setBodyPreset(preset);
      setStep("symbol");
    },
    [setBodyPreset, setStep],
  );

  // Handle step navigation
  const handleBack = useCallback(() => {
    const stepOrder: WizardStep[] = ["preset", "symbol", "footprint", "model", "specs"];
    const currentIdx = stepOrder.indexOf(currentStep);
    if (currentIdx > 0) {
      setStep(stepOrder[currentIdx - 1]!);
    }
  }, [currentStep, setStep]);

  const handleNext = useCallback(() => {
    const stepOrder: WizardStep[] = ["preset", "symbol", "footprint", "model", "specs"];
    const currentIdx = stepOrder.indexOf(currentStep);
    if (currentIdx < stepOrder.length - 1) {
      setStep(stepOrder[currentIdx + 1]!);
    }
  }, [currentStep, setStep]);

  // Handle close (save as draft silently)
  const handleClose = useCallback(async () => {
    if (draftId && draft) {
      try {
        await patchComponentDraft(draftId, { payload: draft as never });
      } catch {
        // Silent fail for draft save on close
      }
    }
    reset();
    onClose();
  }, [draftId, draft, reset, onClose]);

  // Handle publish
  const handlePublish = useCallback(async () => {
    if (!draftId || !draft) return;

    setIsPublishing(true);
    setError(null);

    try {
      // Transform wizard draft to backend format
      const backendPayload = transformWizardToBackendPayload(draft);
      
      // Final save before publish
      await patchComponentDraft(draftId, { payload: backendPayload as never });

      // Publish
      const result = await publishComponentDraft(draftId);

      toast({
        title: "Component published",
        description: `Component saved to library successfully.`,
      });

      reset();
      onPublished?.(result.familyId);
      onClose();
    } catch (err) {
      console.error("Publish failed:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(`Failed to publish: ${message}`);
      toast({
        title: "Publish failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsPublishing(false);
    }
  }, [draftId, draft, reset, onPublished, onClose]);

  // Loading state
  if (isInitializing) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg-primary">
        <Loader2 className="h-8 w-8 animate-spin text-text-tertiary mb-4" />
        <p className="text-sm text-text-muted">Initializing wizard...</p>
      </div>
    );
  }

  const stepNumber = getStepNumber(currentStep);
  const isFirstStep = currentStep === "preset";
  const isLastStep = currentStep === "specs";

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border-default bg-bg-secondary px-6 py-3">
        <button
          className="text-text-tertiary hover:text-text-secondary"
          onClick={handleClose}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-medium text-text-primary">New component</h1>
        <span className="text-sm text-text-tertiary">
          Step {stepNumber} of {WIZARD_STEPS.length}:{" "}
          {WIZARD_STEPS.find((s) => s.id === currentStep)?.label}
        </span>

        {/* Save status indicator */}
        <div className="ml-auto flex items-center gap-2">
          {isSaving && (
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </span>
          )}
          {error && (
            <span className="flex items-center gap-1.5 text-xs text-error">
              <AlertCircle className="h-3 w-3" />
              {error}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex px-6 py-3 gap-1">
        {WIZARD_STEPS.map((s) => (
          <div key={s.id} className="flex-1 flex flex-col items-center gap-1">
            <div
              className={cn(
                "h-1 w-full rounded-full",
                s.number < stepNumber
                  ? "bg-success"
                  : s.number === stepNumber
                    ? "bg-brand"
                    : "bg-bg-input",
              )}
            />
            <span
              className={cn(
                "text-[10px]",
                s.number <= stepNumber ? "text-text-secondary" : "text-text-muted",
              )}
            >
              {s.number}. {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-hidden">
        {currentStep === "preset" && (
          <PresetSelector onSelect={handlePresetSelect} />
        )}
        {currentStep === "symbol" && <SymbolEditorStepContent />}
        {currentStep === "footprint" && <FootprintEditorStep />}
        {currentStep === "model" && <ModelStep />}
        {currentStep === "specs" && <SpecsStep />}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between border-t border-border-default px-6 py-3">
        <div className="text-xs text-text-muted">
          {draftId && <span>Draft ID: {draftId.slice(0, 8)}...</span>}
        </div>
        <div className="flex items-center gap-2">
          {!isFirstStep && (
            <button
              className="h-9 rounded-md bg-bg-input px-4 text-sm font-medium text-text-secondary hover:bg-bg-elevated transition-colors"
              onClick={handleBack}
            >
              Back
            </button>
          )}
          {isLastStep ? (
            <button
              className="flex items-center gap-2 h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              onClick={handlePublish}
              disabled={isPublishing}
            >
              {isPublishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Component
                </>
              )}
            </button>
          ) : (
            <button
              className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              onClick={handleNext}
              disabled={isFirstStep} // Preset step uses card clicks
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step Content Components
// ---------------------------------------------------------------------------

function SymbolEditorStepContent() {
  const selection = useSymbolEditorStore((s) => s.chrome.selection);
  const hasSelection = selection.selectedPinIds.size > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden h-full">
      <SymbolEditorToolbar />
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-56 flex-shrink-0 overflow-y-auto border-r border-border-default bg-bg-secondary p-3 space-y-4">
          <BodyPresetSelector />
          <div className="border-t border-border-default pt-4">
            <PinPalette />
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-hidden">
          <SymbolEditorCanvas />
        </div>

        {/* Right sidebar */}
        <div className="w-64 flex-shrink-0 overflow-y-auto border-l border-border-default bg-bg-secondary p-3 space-y-4">
          <SymbolMetadataEditor />
          <div className="border-t border-border-default pt-4">
            {hasSelection ? (
              <PinPropertiesPanel />
            ) : (
              <div className="text-sm text-text-muted">
                <p className="font-medium text-text-secondary mb-2">
                  Pin Properties
                </p>
                <p className="text-xs italic">
                  Select a pin to edit its properties
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelStep() {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-[800px]">
        <div className="grid grid-cols-2 gap-6">
          {/* Preview area */}
          <div className="rounded-lg border border-border-default bg-bg-input p-4 min-h-[300px] flex items-center justify-center">
            <p className="text-sm text-text-muted">3D model preview</p>
          </div>

          {/* Config panel */}
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Upload a STEP file or generate from footprint dimensions.
            </p>
            <div className="rounded-lg border-2 border-dashed border-border-default p-8 text-center">
              <p className="text-sm text-text-muted">
                Drag & drop .step/.stp file
              </p>
            </div>
            <p className="text-xs text-text-tertiary">
              3D models are optional. You can add one later.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
