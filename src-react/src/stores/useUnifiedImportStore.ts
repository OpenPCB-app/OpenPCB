/**
 * Unified Import Store
 *
 * Manages state for the unified ZIP-based component import flow:
 * - Upload state
 * - Job progress tracking
 * - Preview data
 * - Conflict resolution
 * - Import approval
 */

import { create } from "zustand";
import { getBackendURL } from "@/../../src-ts/shared/sdk/mutator";

// Local type definitions (avoid cross-package imports)
export type ImportJobStatus =
  | "pending"
  | "uploading"
  | "extracting"
  | "parsing"
  | "preview_ready"
  | "conflict_check"
  | "awaiting_approval"
  | "saving"
  | "completed"
  | "failed"
  | "cancelled";

export type ConflictStatus =
  | "none"
  | "name_exists"
  | "mpn_exists"
  | "both_exist";

export type UserResolution =
  | "pending"
  | "create_new"
  | "update_existing"
  | "skip";

export interface ImportWarning {
  code: string;
  message: string;
  fileName?: string;
}

export interface ImportMetadata {
  componentName: string;
  mpn?: string;
  manufacturer?: string;
  description?: string;
  referencePrefix: string;
}

export interface ImportSymbolPreview {
  name: string;
  referencePrefix: string;
  pinCount: number;
}

export interface ImportFootprintPreview {
  name: string;
  padCount: number;
  mountType: "smd" | "through_hole" | "unknown";
  description?: string;
}

export interface ImportModel3dPreview {
  fileName: string;
  fileId: string;
  size: number;
}

export interface ImportConflict {
  type: ConflictStatus;
  existingComponent: {
    id: string;
    displayLabel: string;
    mpn?: string;
  };
}

export interface ImportPreviewData {
  jobId: string;
  status: ImportJobStatus;
  extractedMetadata: ImportMetadata;
  symbol: ImportSymbolPreview;
  footprint: ImportFootprintPreview;
  model3d?: ImportModel3dPreview;
  conflicts?: ImportConflict;
  warnings: ImportWarning[];
}

type ImportStep =
  | "upload"
  | "processing"
  | "preview"
  | "conflict"
  | "success"
  | "error";

interface MetadataOverrides {
  componentName?: string;
  mpn?: string;
  manufacturer?: string;
  description?: string;
  referencePrefix?: string;
}

interface UnifiedImportState {
  // Current job
  jobId: string | null;
  jobStatus: ImportJobStatus | null;
  progress: number;
  progressStage: string | null;

  // Preview data
  previewData: ImportPreviewData | null;

  // UI state
  isModalOpen: boolean;
  currentStep: ImportStep;
  error: string | null;

  // User inputs
  selectedResolution: UserResolution | null;
  metadataOverrides: MetadataOverrides;

  // Actions
  openModal: () => void;
  closeModal: () => void;
  reset: () => void;
  uploadZip: (file: File, workspaceId: string) => Promise<void>;
  pollJobStatus: (jobId: string) => Promise<void>;
  resolveConflict: (resolution: UserResolution) => Promise<void>;
  approveImport: () => Promise<void>;
  cancelImport: () => Promise<void>;
  setMetadataOverride: (field: keyof MetadataOverrides, value: string) => void;
}

function getApiBase(): string {
  const url = getBackendURL();
  if (!url) throw new Error("Backend not ready");
  return `${url.replace(/\/$/, "")}/api`;
}

export const useUnifiedImportStore = create<UnifiedImportState>((set, get) => ({
  // Initial state
  jobId: null,
  jobStatus: null,
  progress: 0,
  progressStage: null,
  previewData: null,
  isModalOpen: false,
  currentStep: "upload",
  error: null,
  selectedResolution: null,
  metadataOverrides: {},

  // Actions
  openModal: () => set({ isModalOpen: true }),

  closeModal: () => {
    const { cancelImport, jobId } = get();
    if (jobId) {
      cancelImport();
    }
    set({ isModalOpen: false });
    get().reset();
  },

  reset: () =>
    set({
      jobId: null,
      jobStatus: null,
      progress: 0,
      progressStage: null,
      previewData: null,
      currentStep: "upload",
      error: null,
      selectedResolution: null,
      metadataOverrides: {},
    }),

  uploadZip: async (file: File, workspaceId: string) => {
    try {
      set({ currentStep: "processing", progress: 0, error: null });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("workspaceId", workspaceId);

      const response = await fetch(`${getApiBase()}/components/import-zip`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Upload failed");
      }

      const data = await response.json();
      const jobId = data.job.jobId;

      set({
        jobId,
        jobStatus: data.job.status,
        progress: data.job.progress,
      });

      // Start polling for status
      get().pollJobStatus(jobId);
    } catch (err) {
      set({
        currentStep: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  },

  pollJobStatus: async (jobId: string) => {
    const poll = async () => {
      try {
        const response = await fetch(
          `${getApiBase()}/components/import-zip/${jobId}/status`,
        );

        if (!response.ok) {
          throw new Error("Failed to get job status");
        }

        const data = await response.json();
        const status = data.status;

        set({
          jobStatus: status.status,
          progress: status.progress,
        });

        // Check if processing is complete
        if (
          status.status === "preview_ready" ||
          status.status === "conflict_check"
        ) {
          // Fetch preview data
          const previewResponse = await fetch(
            `${getApiBase()}/components/import-zip/${jobId}/preview`,
          );

          if (previewResponse.ok) {
            const previewData = await previewResponse.json();
            set({
              previewData: previewData.preview,
              currentStep:
                status.status === "conflict_check" ? "conflict" : "preview",
            });
          }
          return;
        }

        // Check for terminal states
        if (
          status.status === "completed" ||
          status.status === "failed" ||
          status.status === "cancelled"
        ) {
          if (status.status === "completed") {
            set({ currentStep: "success" });
          } else if (status.status === "failed") {
            set({
              currentStep: "error",
              error: status.errorMessage || "Import failed",
            });
          }
          return;
        }

        // Continue polling
        setTimeout(poll, 1000);
      } catch (err) {
        set({
          currentStep: "error",
          error: err instanceof Error ? err.message : "Polling failed",
        });
      }
    };

    poll();
  },

  resolveConflict: async (resolution: UserResolution) => {
    const { jobId } = get();
    if (!jobId) return;

    try {
      const response = await fetch(
        `${getApiBase()}/components/import-zip/${jobId}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolution }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to resolve conflict");
      }

      set({ selectedResolution: resolution });

      if (resolution === "skip") {
        set({ currentStep: "upload" });
      } else {
        // Refresh preview
        get().pollJobStatus(jobId);
      }
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to resolve conflict",
      });
    }
  },

  approveImport: async () => {
    const { jobId, metadataOverrides } = get();
    if (!jobId) return;

    try {
      set({ currentStep: "processing" });

      const response = await fetch(
        `${getApiBase()}/components/import-zip/${jobId}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: metadataOverrides }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to save component");
      }

      set({ currentStep: "success" });
    } catch (err) {
      set({
        currentStep: "error",
        error: err instanceof Error ? err.message : "Failed to save component",
      });
    }
  },

  cancelImport: async () => {
    const { jobId } = get();
    if (!jobId) return;

    try {
      await fetch(`${getApiBase()}/components/import-zip/${jobId}/cancel`, {
        method: "POST",
      });
    } catch {
      // Ignore errors on cancel
    }

    get().reset();
  },

  setMetadataOverride: (field: keyof MetadataOverrides, value: string) => {
    set((state) => ({
      metadataOverrides: {
        ...state.metadataOverrides,
        [field]: value,
      },
    }));
  },
}));
