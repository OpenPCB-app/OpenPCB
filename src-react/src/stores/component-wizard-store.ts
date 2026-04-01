/**
 * Component Creation Wizard Store
 *
 * Zustand store managing draft state, step navigation, validation, and auto-save
 * for the component creation wizard flow.
 */

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WizardStep = "preset" | "symbol" | "footprint" | "model" | "specs";

export interface ValidationResult {
  canPublish: boolean;
  blockers: ValidationMessage[];
  warnings: ValidationMessage[];
}

export interface ValidationMessage {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ComponentDraftPayload {
  // Symbol data
  displayLabel: string;
  description: string;
  symbolData: unknown;
  defaultPackageVariantId: string | null;
  
  // Footprint data (step 2)
  footprintData?: {
    padShape?: string;
    width?: string;
    height?: string;
    pitch?: string;
  };
  
  // 3D model data (step 3)
  modelData?: {
    stepFile?: File | null;
  };
  
  // Specs data (step 4)
  specs?: {
    name?: string;
    category?: string;
    mpn?: string;
    manufacturer?: string;
    datasheetUrl?: string;
  };
}

export interface ComponentDraft {
  id: string;
  payload: ComponentDraftPayload;
  familyId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Store Interface
// ---------------------------------------------------------------------------

interface ComponentWizardState {
  // Draft state
  draftId: string | null;
  draft: ComponentDraftPayload | null;
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: number | null;
  
  // Step navigation
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
  
  // Validation state
  validation: ValidationResult | null;
  isValidating: boolean;
  
  // Actions
  initDraft: (draftId?: string) => void;
  setDraft: (draft: ComponentDraftPayload) => void;
  updateDraft: (updates: Partial<ComponentDraftPayload>) => void;
  markDirty: () => void;
  markClean: () => void;
  setSaving: (saving: boolean) => void;
  setLastSaved: (timestamp: number) => void;
  
  // Step navigation
  setStep: (step: WizardStep) => void;
  nextStep: () => void;
  previousStep: () => void;
  markStepComplete: (step: WizardStep) => void;
  canNavigateToStep: (step: WizardStep) => boolean;
  
  // Validation
  setValidation: (validation: ValidationResult | null) => void;
  setValidating: (validating: boolean) => void;
  
  // Reset
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Step Order & Helpers
// ---------------------------------------------------------------------------

const STEP_ORDER: WizardStep[] = ["preset", "symbol", "footprint", "model", "specs"];

function getStepIndex(step: WizardStep): number {
  return STEP_ORDER.indexOf(step);
}

function getNextStep(current: WizardStep): WizardStep | null {
  const idx = getStepIndex(current);
  return idx < STEP_ORDER.length - 1 ? STEP_ORDER[idx + 1]! : null;
}

function getPreviousStep(current: WizardStep): WizardStep | null {
  const idx = getStepIndex(current);
  return idx > 0 ? STEP_ORDER[idx - 1]! : null;
}

function createEmptyDraft(): ComponentDraftPayload {
  return {
    displayLabel: "",
    description: "",
    symbolData: null,
    defaultPackageVariantId: null,
    footprintData: {},
    modelData: {},
    specs: {},
  };
}

// ---------------------------------------------------------------------------
// Store Factory
// ---------------------------------------------------------------------------

export const useComponentWizardStore = create<ComponentWizardState>((set, get) => ({
  // Initial state
  draftId: null,
  draft: null,
  isDirty: false,
  isSaving: false,
  lastSavedAt: null,
  currentStep: "preset",
  completedSteps: new Set<WizardStep>(),
  validation: null,
  isValidating: false,
  
  // Draft actions
  initDraft: (draftId) => {
    set({
      draftId: draftId ?? crypto.randomUUID(),
      draft: createEmptyDraft(),
      isDirty: false,
      currentStep: "preset",
      completedSteps: new Set<WizardStep>(),
      validation: null,
      lastSavedAt: null,
    });
  },
  
  setDraft: (draft) => {
    set({
      draft,
      isDirty: false,
    });
  },
  
  updateDraft: (updates) => {
    const state = get();
    if (!state.draft) return;
    
    set({
      draft: { ...state.draft, ...updates },
      isDirty: true,
    });
  },
  
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),
  setSaving: (saving) => set({ isSaving: saving }),
  setLastSaved: (timestamp) => set({ lastSavedAt: timestamp }),
  
  // Step navigation
  setStep: (step) => {
    set({ currentStep: step });
  },
  
  nextStep: () => {
    const state = get();
    const next = getNextStep(state.currentStep);
    if (next) {
      set({ currentStep: next });
    }
  },
  
  previousStep: () => {
    const state = get();
    const prev = getPreviousStep(state.currentStep);
    if (prev) {
      set({ currentStep: prev });
    }
  },
  
  markStepComplete: (step) => {
    const state = get();
    const newCompleted = new Set(state.completedSteps);
    newCompleted.add(step);
    set({ completedSteps: newCompleted });
  },
  
  canNavigateToStep: (targetStep) => {
    const state = get();
    const currentIdx = getStepIndex(state.currentStep);
    const targetIdx = getStepIndex(targetStep);
    
    // Can always go back
    if (targetIdx < currentIdx) return true;
    
    // Can go forward if all intermediate steps are completed
    for (let i = currentIdx; i < targetIdx; i++) {
      const step = STEP_ORDER[i];
      if (step && !state.completedSteps.has(step)) {
        return false;
      }
    }
    return true;
  },
  
  // Validation
  setValidation: (validation) => set({ validation }),
  setValidating: (validating) => set({ isValidating: validating }),
  
  // Reset
  reset: () => {
    set({
      draftId: null,
      draft: null,
      isDirty: false,
      isSaving: false,
      lastSavedAt: null,
      currentStep: "preset",
      completedSteps: new Set<WizardStep>(),
      validation: null,
      isValidating: false,
    });
  },
}));

// ---------------------------------------------------------------------------
// Selector Hooks
// ---------------------------------------------------------------------------

export const useDraftId = () => useComponentWizardStore((s) => s.draftId);
export const useDraft = () => useComponentWizardStore((s) => s.draft);
export const useIsDirty = () => useComponentWizardStore((s) => s.isDirty);
export const useIsSaving = () => useComponentWizardStore((s) => s.isSaving);
export const useLastSavedAt = () => useComponentWizardStore((s) => s.lastSavedAt);

export const useCurrentStep = () => useComponentWizardStore((s) => s.currentStep);
export const useCompletedSteps = () => useComponentWizardStore((s) => s.completedSteps);

export const useValidation = () => useComponentWizardStore((s) => s.validation);
export const useIsValidating = () => useComponentWizardStore((s) => s.isValidating);

export const useCanNavigateToStep = (step: WizardStep) =>
  useComponentWizardStore((s) => s.canNavigateToStep(step));
