/**
 * ComponentWizard
 *
 * Main wizard component for creating new components.
 * Flow: Preset → Symbol → Footprint → (3D Model) → Specs
 *
 * Creates a backend draft on open, auto-saves on changes,
 * and publishes on "Save Component".
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Loader2, Save, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import {
  useComponentWizardStore,
  type WizardStep,
  type WizardVariantDraft,
  type MountType,
  type WizardDraftPayload,
} from "@/stores/component-wizard-store";
import {
  createWorkspaceComponentRecord,
  getComponent,
  patchWorkspaceComponentRecord,
  publishWorkspaceComponentRecord,
} from "@/lib/api/component-api";
import { useSymbolEditorStore } from "@/components/symbol-editor";
import { SpecsStep } from "./SpecsStep";
import { ModelStep } from "./ModelStep";
import {
  createEmptyBackendPayload,
  transformFootprintDraftToWizard,
  transformKicadPayloadToFootprintDraft,
  transformSymbolDraftToWizard,
  transformWizardToBackendPayload,
  transformWizardToFootprintDraft,
  transformWizardToSymbolDraft,
} from "./transformers";
import {
  SymbolEditorCanvas,
  PinPalette,
  PinPropertiesPanel,
  BodyPresetSelector,
  SymbolEditorToolbar,
  SymbolMetadataEditor,
} from "@/components/symbol-editor";
import type { SymbolDraft } from "@/components/symbol-editor/types";
import type { FootprintDraft } from "@/components/footprint-editor/types";
import {
  FootprintEditorStep,
  useFootprintEditorStore,
} from "@/components/footprint-editor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComponentWizardProps {
  /** If provided, wizard opens in edit mode for existing component */
  componentId?: string;
  onClose: () => void;
  onPublished?: (componentId: string) => void;
}

// ---------------------------------------------------------------------------
// Step Configuration
// ---------------------------------------------------------------------------

const WIZARD_STEPS: { id: WizardStep; label: string; number: number }[] = [
  { id: "symbol", label: "Symbol", number: 1 },
  { id: "footprint", label: "Footprint", number: 2 },
  { id: "model", label: "3D Model", number: 3 },
  { id: "specs", label: "Specs", number: 4 },
];

function getStepNumber(step: WizardStep): number {
  return WIZARD_STEPS.find((s) => s.id === step)?.number ?? 1;
}

function areJsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ComponentWizard({
  componentId,
  onClose,
  onPublished,
}: ComponentWizardProps) {
  // Wizard store state
  const draftId = useComponentWizardStore((s) => s.draftId);
  const currentStep = useComponentWizardStore((s) => s.currentStep);
  const isSaving = useComponentWizardStore((s) => s.isSaving);
  const initDraft = useComponentWizardStore((s) => s.initDraft);
  const initFromExisting = useComponentWizardStore((s) => s.initFromExisting);
  const setStep = useComponentWizardStore((s) => s.setStep);
  const updateDraft = useComponentWizardStore((s) => s.updateDraft);
  const setSaving = useComponentWizardStore((s) => s.setSaving);
  const reset = useComponentWizardStore((s) => s.reset);
  const draft = useComponentWizardStore((s) => s.draft);
  const variants = useComponentWizardStore((s) => s.variants);

  // Symbol editor store
  const symbolDraft = useSymbolEditorStore((s) => s.draft);
  const resetSymbolDraft = useSymbolEditorStore((s) => s.resetDraft);
  const setSymbolDraft = useSymbolEditorStore((s) => s.setDraft);
  const footprintDraft = useFootprintEditorStore((s) => s.draft);
  const setFootprintDraft = useFootprintEditorStore((s) => s.setDraft);
  const resetFootprintDraft = useFootprintEditorStore((s) => s.resetDraft);

  // Local state
  const [isInitializing, setIsInitializing] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode] = useState(!!componentId);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressSymbolSyncRef = useRef(false);
  const suppressFootprintSyncRef = useRef(false);

  // Initialize draft on mount
  useEffect(() => {
    let mounted = true;

    async function initializeWizard() {
      setIsInitializing(true);
      setError(null);

      try {
        if (componentId) {
          // Edit mode: fetch existing component
          const component = await getComponent(componentId);

          if (!mounted) return;

          // Build wizard draft from component
          const wizardDraft: WizardDraftPayload = {
            displayLabel: component.displayLabel,
            description: component.description,
            symbolData: null,
            footprintData: null,
            modelData: null,
            specs: {
              name: component.displayLabel,
              category: component.categoryPath ?? undefined,
            },
            defaultVariantId: component.defaultVariantId ?? null,
          };

          // Convert API variants to wizard variants
          const wizardVariants: WizardVariantDraft[] = component.variants.map(
            (v) => {
              const footprintOption = v.footprintOptions[0];
              const footprintDraft = footprintOption?.kicadPayload
                ? transformKicadPayloadToFootprintDraft(
                    footprintOption.kicadPayload,
                  )
                : null;

              return {
                id: v.id,
                canonicalCode: v.canonicalCode,
                humanLabel: v.humanLabel,
                mountType: v.mountType as MountType,
                isDefault: v.isDefault,
                footprintDraft,
              };
            },
          );

          initFromExisting(componentId, wizardDraft, wizardVariants);

          // Set footprint for active variant
          const defaultVariant =
            wizardVariants.find((v) => v.isDefault) ?? wizardVariants[0];
          if (defaultVariant?.footprintDraft) {
            setFootprintDraft(defaultVariant.footprintDraft);
          } else {
            resetFootprintDraft();
          }

          resetSymbolDraft();
        } else {
          // Create mode: create new backend draft
          const backendDraft = await createWorkspaceComponentRecord(
            createEmptyBackendPayload(),
          );

          if (!mounted) return;

          initDraft(backendDraft.id);

          resetSymbolDraft();
          resetFootprintDraft();
        }
      } catch (err) {
        if (!mounted) return;
        console.error("Failed to initialize wizard:", err);
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
  }, [
    componentId,
    initDraft,
    initFromExisting,
    resetFootprintDraft,
    resetSymbolDraft,
    setFootprintDraft,
  ]);

  useEffect(() => {
    if (!draft) return;

    if (currentStep === "symbol" && draft.symbolData) {
      const currentSymbolPayload = transformSymbolDraftToWizard(symbolDraft);
      if (areJsonEqual(currentSymbolPayload, draft.symbolData)) {
        suppressSymbolSyncRef.current = false;
      } else {
        suppressSymbolSyncRef.current = true;
        setSymbolDraft(transformWizardToSymbolDraft(draft.symbolData));
      }
    }

    if (currentStep === "footprint" && draft.footprintData) {
      const currentFootprintPayload =
        transformFootprintDraftToWizard(footprintDraft);
      if (areJsonEqual(currentFootprintPayload, draft.footprintData)) {
        suppressFootprintSyncRef.current = false;
      } else {
        suppressFootprintSyncRef.current = true;
        setFootprintDraft(transformWizardToFootprintDraft(draft.footprintData));
      }
    }
  }, [
    currentStep,
    draft,
    footprintDraft,
    setFootprintDraft,
    setSymbolDraft,
    symbolDraft,
  ]);

  // Sync symbol editor changes to wizard store
  useEffect(() => {
    if (!symbolDraft || currentStep !== "symbol") return;
    if (suppressSymbolSyncRef.current) {
      suppressSymbolSyncRef.current = false;
      return;
    }

    updateDraft({
      displayLabel: symbolDraft.metadata.name,
      description: symbolDraft.metadata.description,
      symbolData: transformSymbolDraftToWizard(symbolDraft),
    });
  }, [symbolDraft, currentStep, updateDraft]);

  // Sync footprint editor changes to wizard store
  useEffect(() => {
    if (!footprintDraft || currentStep !== "footprint") return;
    if (suppressFootprintSyncRef.current) {
      suppressFootprintSyncRef.current = false;
      return;
    }

    updateDraft({
      footprintData: transformFootprintDraftToWizard(footprintDraft),
    });
  }, [footprintDraft, currentStep, updateDraft]);

  // Auto-save debounced (when wizard store is dirty)
  const isDirty = useComponentWizardStore((s) => s.isDirty);
  const markClean = useComponentWizardStore((s) => s.markClean);

  useEffect(() => {
    if (!isDirty || !draftId || !draft) return;

    autosaveTimeoutRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        await patchWorkspaceComponentRecord(draftId, {
          payload: transformWizardToBackendPayload(draft, variants),
        });
        markClean();
      } catch (err) {
        console.error("Auto-save failed:", err);
      } finally {
        setSaving(false);
      }
    }, 1500);

    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
    };
  }, [isDirty, draftId, draft, variants, setSaving, markClean]);

  // Handle step navigation
  const handleBack = useCallback(() => {
    const stepOrder: WizardStep[] = ["symbol", "footprint", "model", "specs"];
    const currentIdx = stepOrder.indexOf(currentStep);
    if (currentIdx > 0) {
      setStep(stepOrder[currentIdx - 1]!);
    }
  }, [currentStep, setStep]);

  const handleNext = useCallback(() => {
    const stepOrder: WizardStep[] = ["symbol", "footprint", "model", "specs"];
    const currentIdx = stepOrder.indexOf(currentStep);
    if (currentIdx < stepOrder.length - 1) {
      setStep(stepOrder[currentIdx + 1]!);
    }
  }, [currentStep, setStep]);

  // Handle close (save as draft silently)
  const handleClose = useCallback(async () => {
    if (draftId && draft) {
      try {
        if (autosaveTimeoutRef.current) {
          clearTimeout(autosaveTimeoutRef.current);
          autosaveTimeoutRef.current = null;
        }
        await patchWorkspaceComponentRecord(draftId, {
          payload: transformWizardToBackendPayload(draft, variants),
        });
      } catch {
        // Silent fail for draft save on close
      }
    }
    reset();
    onClose();
  }, [draftId, draft, variants, reset, onClose]);

  // Handle publish
  const handlePublish = useCallback(async () => {
    if (!draftId || !draft) return;

    setIsPublishing(true);
    setError(null);

    try {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }

      const backendPayload = transformWizardToBackendPayload(draft, variants);

      await patchWorkspaceComponentRecord(draftId, {
        payload: backendPayload,
      });

      const result = await publishWorkspaceComponentRecord(draftId);

      toast({
        title: "Component published",
        description: `Component saved to library successfully.`,
      });

      reset();
      onPublished?.(result.componentId);
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
  }, [draftId, draft, variants, reset, onPublished, onClose]);

  const handleImportedSymbolDraft = useCallback(
    (importedDraft: SymbolDraft) => {
      setSymbolDraft(importedDraft);
      updateDraft({
        displayLabel: importedDraft.metadata.name,
        description: importedDraft.metadata.description,
        symbolData: transformSymbolDraftToWizard(importedDraft),
      });
    },
    [setSymbolDraft, updateDraft],
  );

  const handleImportedFootprintDraft = useCallback(
    (importedDraft: FootprintDraft) => {
      setFootprintDraft(importedDraft);
      updateDraft({
        footprintData: transformFootprintDraftToWizard(importedDraft),
      });
    },
    [setFootprintDraft, updateDraft],
  );

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
  const isFirstStep = currentStep === "symbol";
  const isLastStep = currentStep === "specs";

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border-default bg-bg-secondary px-6 py-3">
        <button
          type="button"
          className="text-text-tertiary hover:text-text-secondary"
          onClick={handleClose}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-medium text-text-primary">
          {isEditMode ? "Edit component" : "New component"}
        </h1>
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
                s.number <= stepNumber
                  ? "text-text-secondary"
                  : "text-text-muted",
              )}
            >
              {s.number}. {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-hidden">
        {currentStep === "symbol" && (
          <SymbolEditorStepContent
            onImportedDraft={handleImportedSymbolDraft}
          />
        )}
        {currentStep === "footprint" && (
          <FootprintEditorStep onImportedDraft={handleImportedFootprintDraft} />
        )}
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
              type="button"
              className="h-9 rounded-md bg-bg-input px-4 text-sm font-medium text-text-secondary hover:bg-bg-elevated transition-colors"
              onClick={handleBack}
            >
              Back
            </button>
          )}
          {isLastStep ? (
            <button
              type="button"
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
              type="button"
              className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              onClick={handleNext}
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

function SymbolEditorStepContent({
  onImportedDraft,
}: {
  onImportedDraft: (draft: SymbolDraft) => void;
}) {
  const selection = useSymbolEditorStore((s) => s.chrome.selection);
  const hasSelection = selection.selectedPinIds.size > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden h-full">
      <SymbolEditorToolbar onImportedDraft={onImportedDraft} />
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
