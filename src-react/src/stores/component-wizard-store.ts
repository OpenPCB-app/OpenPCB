/**
 * Component Creation Wizard Store
 *
 * Zustand store managing draft state, step navigation, validation, and auto-save
 * for the component creation wizard flow.
 */

import { create } from "zustand";
import type { SymbolDraft } from "@/components/symbol-editor/types";
import type { FootprintDraft } from "@/components/footprint-editor/types";
import type {
  Component as ComponentEntity,
  ComponentReference,
  ComponentVariant,
} from "@shared/types/component-library.types";

export type Component = ComponentEntity;
export type { ComponentVariant, ComponentReference };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WizardStep = "symbol" | "footprint" | "model" | "specs";

export type MountType = "smd" | "through_hole";

/**
 * Draft variant for the wizard — each variant has its own footprint
 */
export interface WizardVariantDraft {
  id: string;
  canonicalCode: string;
  humanLabel: string;
  mountType: MountType;
  isDefault: boolean;
  footprintDraft: FootprintDraft | null;
}

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

export interface WizardDraftPayload {
  // Core fields
  displayLabel: string;
  description: string;

  // Symbol data (from symbol editor)
  symbolData: SymbolDraft | null;

  // Footprint data (from footprint editor)
  footprintData: FootprintDraft | null;

  // 3D model data (step 3)
  modelData?: {
    fileId?: string | null;
    stepFileName?: string | null;
    stepAssetPath?: string | null;
    gltfPreviewPath?: string | null;
  } | null;

  // Specs data (step 4)
  specs?: {
    name?: string;
    category?: string;
    mpn?: string;
    manufacturer?: string;
    datasheetUrl?: string;
  } | null;

  // Package variant (for full publish)
  defaultVariantId: string | null;
  variants?: ComponentVariant[];
  componentReference?: ComponentReference | null;
  componentId?: Component["id"] | null;
}

export interface ComponentWorkspaceRecord {
  id: string;
  payload: WizardDraftPayload;
  componentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Store Interface
// ---------------------------------------------------------------------------

interface ComponentWizardState {
  // Draft state
  draftId: string | null;
  draft: WizardDraftPayload | null;
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: number | null;

  // Multi-variant state
  variants: WizardVariantDraft[];
  activeVariantId: string | null;

  // Step navigation
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;

  // Validation state
  validation: ValidationResult | null;
  isValidating: boolean;

  // Actions
  initDraft: (draftId?: string) => void;
  initFromExisting: (
    componentId: string,
    draft: WizardDraftPayload,
    variants: WizardVariantDraft[],
  ) => void;
  setDraft: (draft: WizardDraftPayload) => void;
  updateDraft: (updates: Partial<WizardDraftPayload>) => void;
  markDirty: () => void;
  markClean: () => void;
  setSaving: (saving: boolean) => void;
  setLastSaved: (timestamp: number) => void;

  // Variant actions
  addVariant: () => void;
  removeVariant: (id: string) => void;
  setActiveVariant: (id: string) => void;
  updateVariantMetadata: (
    id: string,
    updates: Partial<
      Pick<WizardVariantDraft, "canonicalCode" | "humanLabel" | "mountType">
    >,
  ) => void;
  updateVariantFootprint: (
    id: string,
    footprintDraft: FootprintDraft | null,
  ) => void;
  setDefaultVariant: (id: string) => void;
  getActiveVariant: () => WizardVariantDraft | null;

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

const STEP_ORDER: WizardStep[] = ["symbol", "footprint", "model", "specs"];

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

function createEmptyDraft(): WizardDraftPayload {
  return {
    displayLabel: "",
    description: "",
    symbolData: null,
    defaultVariantId: null,
    footprintData: null,
    modelData: null,
    specs: null,
  };
}

function createDefaultVariant(): WizardVariantDraft {
  return {
    id: crypto.randomUUID(),
    canonicalCode: "default",
    humanLabel: "Default",
    mountType: "smd",
    isDefault: true,
    footprintDraft: null,
  };
}

// ---------------------------------------------------------------------------
// Store Factory
// ---------------------------------------------------------------------------

export const useComponentWizardStore = create<ComponentWizardState>(
  (set, get) => ({
    // Initial state
    draftId: null,
    draft: null,
    isDirty: false,
    isSaving: false,
    lastSavedAt: null,
    currentStep: "symbol",
    completedSteps: new Set<WizardStep>(),
    validation: null,
    isValidating: false,

    // Multi-variant state
    variants: [],
    activeVariantId: null,

    // Draft actions
    initDraft: (draftId) => {
      const defaultVariant = createDefaultVariant();
      set({
        draftId: draftId ?? crypto.randomUUID(),
        draft: createEmptyDraft(),
        isDirty: false,
        currentStep: "symbol",
        completedSteps: new Set<WizardStep>(),
        validation: null,
        lastSavedAt: null,
        variants: [defaultVariant],
        activeVariantId: defaultVariant.id,
      });
    },

    initFromExisting: (componentId, draft, variants) => {
      const activeId =
        variants.find((v) => v.isDefault)?.id ?? variants[0]?.id ?? null;
      set({
        draftId: componentId,
        draft,
        isDirty: false,
        currentStep: "symbol",
        completedSteps: new Set<WizardStep>(),
        validation: null,
        lastSavedAt: null,
        variants,
        activeVariantId: activeId,
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

    // Variant actions
    addVariant: () => {
      const state = get();
      const variantCount = state.variants.length;
      const newVariant: WizardVariantDraft = {
        id: crypto.randomUUID(),
        canonicalCode: `variant-${variantCount + 1}`,
        humanLabel: `Variant ${variantCount + 1}`,
        mountType: "smd",
        isDefault: false,
        footprintDraft: null,
      };
      set({
        variants: [...state.variants, newVariant],
        activeVariantId: newVariant.id,
        isDirty: true,
      });
    },

    removeVariant: (id) => {
      const state = get();
      if (state.variants.length <= 1) return;

      const filtered = state.variants.filter((v) => v.id !== id);
      const removedWasDefault = state.variants.find(
        (v) => v.id === id,
      )?.isDefault;
      const removedWasActive = state.activeVariantId === id;

      let newVariants = filtered;
      if (removedWasDefault && newVariants.length > 0) {
        newVariants = newVariants.map((v, i) =>
          i === 0 ? { ...v, isDefault: true } : v,
        );
      }

      set({
        variants: newVariants,
        activeVariantId: removedWasActive
          ? newVariants[0]?.id ?? null
          : state.activeVariantId,
        isDirty: true,
      });
    },

    setActiveVariant: (id) => {
      const state = get();
      if (!state.variants.find((v) => v.id === id)) return;
      set({ activeVariantId: id });
    },

    updateVariantMetadata: (id, updates) => {
      const state = get();
      set({
        variants: state.variants.map((v) =>
          v.id === id ? { ...v, ...updates } : v,
        ),
        isDirty: true,
      });
    },

    updateVariantFootprint: (id, footprintDraft) => {
      const state = get();
      set({
        variants: state.variants.map((v) =>
          v.id === id ? { ...v, footprintDraft } : v,
        ),
        isDirty: true,
      });
    },

    setDefaultVariant: (id) => {
      const state = get();
      set({
        variants: state.variants.map((v) => ({
          ...v,
          isDefault: v.id === id,
        })),
        isDirty: true,
      });
    },

    getActiveVariant: () => {
      const state = get();
      return state.variants.find((v) => v.id === state.activeVariantId) ?? null;
    },

    // Reset
    reset: () => {
      set({
        draftId: null,
        draft: null,
        isDirty: false,
        isSaving: false,
        lastSavedAt: null,
        currentStep: "symbol",
        completedSteps: new Set<WizardStep>(),
        validation: null,
        isValidating: false,
        variants: [],
        activeVariantId: null,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Selector Hooks
// ---------------------------------------------------------------------------

export const useDraftId = () => useComponentWizardStore((s) => s.draftId);
export const useDraft = () => useComponentWizardStore((s) => s.draft);
export const useIsDirty = () => useComponentWizardStore((s) => s.isDirty);
export const useIsSaving = () => useComponentWizardStore((s) => s.isSaving);
export const useLastSavedAt = () =>
  useComponentWizardStore((s) => s.lastSavedAt);

export const useCurrentStep = () =>
  useComponentWizardStore((s) => s.currentStep);
export const useCompletedSteps = () =>
  useComponentWizardStore((s) => s.completedSteps);

export const useValidation = () => useComponentWizardStore((s) => s.validation);
export const useIsValidating = () =>
  useComponentWizardStore((s) => s.isValidating);

export const useCanNavigateToStep = (step: WizardStep) =>
  useComponentWizardStore((s) => s.canNavigateToStep(step));

export const useVariants = () => useComponentWizardStore((s) => s.variants);
export const useActiveVariantId = () =>
  useComponentWizardStore((s) => s.activeVariantId);
export const useActiveVariant = () =>
  useComponentWizardStore((s) => s.getActiveVariant());
