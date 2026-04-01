/**
 * Import Preview Hook
 *
 * React hook for generating KiCAD import preview via multipart/form-data upload.
 */

import { useState, useCallback } from "react";

export interface ImportPreviewVariant {
  suggestedCanonicalCode: string;
  suggestedHumanLabel: string;
  footprintFileNames: string[];
  model3dFileNames: string[];
  confidence: number;
}

export interface ImportWarning {
  code: string;
  message: string;
  severity: "warning" | "blocker";
  context: Record<string, string>;
}

export interface ImportPreviewGroup {
  suggestedFamilyLabel: string;
  suggestedCanonicalKey: string;
  variants: ImportPreviewVariant[];
  warnings: ImportWarning[];
  symbolFileName: string | null;
}

export interface ImportPreviewResult {
  groups: ImportPreviewGroup[];
  ungroupedFiles: string[];
  totalWarnings: number;
  totalBlockers: number;
}

export interface UseImportPreviewState {
  isLoading: boolean;
  error: Error | null;
  preview: ImportPreviewResult | null;
}

export function useImportPreview() {
  const [state, setState] = useState<UseImportPreviewState>({
    isLoading: false,
    error: null,
    preview: null,
  });

  const generatePreview = useCallback(async (files: File[]): Promise<ImportPreviewResult | null> => {
    setState({
      isLoading: true,
      error: null,
      preview: null,
    });

    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch("/api/components/import/preview", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.message || `Import preview failed: ${response.statusText}`);
      }

      const data = await response.json();
      const preview = data.data?.preview as ImportPreviewResult;

      setState({
        isLoading: false,
        error: null,
        preview,
      });

      return preview;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      setState({
        isLoading: false,
        error,
        preview: null,
      });

      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      isLoading: false,
      error: null,
      preview: null,
    });
  }, []);

  return {
    ...state,
    generatePreview,
    reset,
  };
}
