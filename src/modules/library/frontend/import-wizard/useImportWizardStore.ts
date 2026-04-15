import { create } from "zustand";
import type {
  FootprintRenderModel,
  FootprintRenderSource,
} from "../../../../shared/rendering/types";
import type {
  DensityLevel,
  GeneratedFootprintMetadata,
  PackageFamily,
} from "../../../../shared/rendering/ipc7351b";
import type { InspectPayload } from "../types";

export type InspectStatus = "idle" | "loading" | "success" | "error";

export interface ImportWizardState {
  currentStep: number;
  symbolFile: File | null;
  footprintFiles: File[];

  inspectData: InspectPayload | null;
  inspectStatus: InspectStatus;
  inspectError: string | null;
  loadingCommit: boolean;
  commitError: string | null;
  commitResult: {
    componentId: string;
    componentName: string;
    reused: boolean;
  } | null;

  selectedSymbolId: string;
  selectedFootprintId: string;
  componentName: string;
  description: string;
  componentNameDirty: boolean;
  descriptionDirty: boolean;

  footprintSource: "import" | "preset";
  presetFamily: PackageFamily | null;
  presetSize: string | null;
  presetDensity: DensityLevel;
  generatedFootprint: {
    source: FootprintRenderSource;
    model: FootprintRenderModel;
    metadata: GeneratedFootprintMetadata;
  } | null;

  symbolGridVisible: boolean;
  footprintGridVisible: boolean;

  setSymbolFile: (file: File | null) => void;
  setFootprintFiles: (files: File[]) => void;
  beginInspect: () => void;
  setInspectData: (data: InspectPayload | null) => void;
  finishInspectSuccess: () => void;
  finishInspectError: (error: string) => void;
  clearInspectError: () => void;
  resetInspectSession: () => void;

  completeInspect: (patch: {
    inspectData: InspectPayload;
    selectedSymbolId: string;
    selectedFootprintId: string;
    componentName?: string;
    description?: string;
  }) => void;

  setSelectedSymbolId: (id: string) => void;
  setSelectedFootprintId: (id: string) => void;
  setComponentName: (name: string, markDirty?: boolean) => void;
  setDescription: (desc: string, markDirty?: boolean) => void;
  resetMetadataDraftFlags: () => void;

  setLoadingCommit: (loading: boolean) => void;
  setCommitError: (error: string | null) => void;
  clearCommitError: () => void;
  setCommitResult: (
    result: {
      componentId: string;
      componentName: string;
      reused: boolean;
    } | null,
  ) => void;

  setFootprintSource: (source: "import" | "preset") => void;
  setPresetFamily: (family: PackageFamily | null) => void;
  setPresetSize: (size: string | null) => void;
  setPresetDensity: (density: DensityLevel) => void;
  setGeneratedFootprint: (
    fp: {
      source: FootprintRenderSource;
      model: FootprintRenderModel;
      metadata: GeneratedFootprintMetadata;
    } | null,
  ) => void;

  setSymbolGridVisible: (visible: boolean) => void;
  setFootprintGridVisible: (visible: boolean) => void;
  goNext: () => void;
  goBack: () => void;
  goToStep: (step: number) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  currentStep: 0,
  symbolFile: null,
  footprintFiles: [],
  inspectData: null,
  inspectStatus: "idle" as InspectStatus,
  inspectError: null,
  loadingCommit: false,
  commitError: null,
  commitResult: null,
  selectedSymbolId: "",
  selectedFootprintId: "",
  componentName: "",
  description: "",
  componentNameDirty: false,
  descriptionDirty: false,
  footprintSource: "import" as const,
  presetFamily: null,
  presetSize: null,
  presetDensity: "nominal" as DensityLevel,
  generatedFootprint: null,
  symbolGridVisible: true,
  footprintGridVisible: true,
};

export const useImportWizardStore = create<ImportWizardState>((set) => ({
  ...INITIAL_STATE,

  setSymbolFile: (file) => set({ symbolFile: file }),
  setFootprintFiles: (files) => set({ footprintFiles: files }),

  beginInspect: () =>
    set({
      inspectStatus: "loading",
      inspectError: null,
      inspectData: null,
      commitError: null,
    }),
  setInspectData: (data) => set({ inspectData: data }),
  finishInspectSuccess: () =>
    set({ inspectStatus: "success", inspectError: null }),
  finishInspectError: (error) =>
    set({
      inspectStatus: "error",
      inspectError: error,
      inspectData: null,
      selectedSymbolId: "",
      selectedFootprintId: "",
    }),
  clearInspectError: () => set({ inspectError: null }),
  resetInspectSession: () =>
    set({
      inspectData: null,
      inspectStatus: "idle",
      inspectError: null,
      selectedSymbolId: "",
      selectedFootprintId: "",
      commitError: null,
    }),

  completeInspect: (patch) =>
    set((state) => ({
      inspectData: patch.inspectData,
      inspectStatus: "success" as InspectStatus,
      inspectError: null,
      selectedSymbolId: patch.selectedSymbolId,
      selectedFootprintId: patch.selectedFootprintId,
      componentName:
        patch.componentName !== undefined && !state.componentNameDirty
          ? patch.componentName
          : state.componentName,
      componentNameDirty:
        patch.componentName !== undefined && !state.componentNameDirty
          ? false
          : state.componentNameDirty,
      description:
        patch.description !== undefined && !state.descriptionDirty
          ? patch.description
          : state.description,
      descriptionDirty:
        patch.description !== undefined && !state.descriptionDirty
          ? false
          : state.descriptionDirty,
    })),

  setSelectedSymbolId: (id) => set({ selectedSymbolId: id }),
  setSelectedFootprintId: (id) => set({ selectedFootprintId: id }),
  setComponentName: (name, markDirty = true) =>
    set({ componentName: name, componentNameDirty: markDirty }),
  setDescription: (desc, markDirty = true) =>
    set({ description: desc, descriptionDirty: markDirty }),
  resetMetadataDraftFlags: () =>
    set({ componentNameDirty: false, descriptionDirty: false }),

  setLoadingCommit: (loading) => set({ loadingCommit: loading }),
  setCommitError: (error) => set({ commitError: error }),
  clearCommitError: () => set({ commitError: null }),
  setCommitResult: (result) => set({ commitResult: result }),

  setFootprintSource: (source) =>
    set({ footprintSource: source, generatedFootprint: null }),
  setPresetFamily: (family) =>
    set({ presetFamily: family, presetSize: null, generatedFootprint: null }),
  setPresetSize: (size) => set({ presetSize: size }),
  setPresetDensity: (density) => set({ presetDensity: density }),
  setGeneratedFootprint: (fp) => set({ generatedFootprint: fp }),

  setSymbolGridVisible: (visible) => set({ symbolGridVisible: visible }),
  setFootprintGridVisible: (visible) => set({ footprintGridVisible: visible }),

  goNext: () =>
    set((state) => ({
      currentStep: Math.min(state.currentStep + 1, 3),
    })),
  goBack: () =>
    set((state) => ({
      currentStep: Math.max(state.currentStep - 1, 0),
    })),
  goToStep: (step) => set({ currentStep: Math.max(0, Math.min(step, 3)) }),

  reset: () => set({ ...INITIAL_STATE }),
}));
