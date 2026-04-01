/**
 * Import Confirm Hook
 *
 * React hook for confirming and executing component import after preview.
 */

import { useState, useCallback } from "react";

export interface ImportConfirmInput {
  groups: Array<{
    familyLabel: string;
    canonicalKey: string;
    symbolFileName: string | null;
    variants: Array<{
      canonicalCode: string;
      humanLabel: string;
      footprintFileNames: string[];
      model3dFileNames: string[];
    }>;
  }>;
  duplicateStrategy: "skip" | "overwrite" | "rename";
}

export interface ImportConfirmResult {
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: Array<{
    familyLabel: string;
    variantLabel: string;
    message: string;
  }>;
}

export interface UseImportConfirmState {
  isImporting: boolean;
  error: Error | null;
  result: ImportConfirmResult | null;
  progress: number;
}

export function useImportConfirm() {
  const [state, setState] = useState<UseImportConfirmState>({
    isImporting: false,
    error: null,
    result: null,
    progress: 0,
  });

  const confirmImport = useCallback(async (input: ImportConfirmInput): Promise<ImportConfirmResult | null> => {
    setState({
      isImporting: true,
      error: null,
      result: null,
      progress: 0,
    });

    try {
      const response = await fetch("/api/components/import/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.message || `Import failed: ${response.statusText}`);
      }

      const data = await response.json();
      const result = data.data?.result as ImportConfirmResult;

      setState({
        isImporting: false,
        error: null,
        result,
        progress: 100,
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      setState({
        isImporting: false,
        error,
        result: null,
        progress: 0,
      });

      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      isImporting: false,
      error: null,
      result: null,
      progress: 0,
    });
  }, []);

  return {
    ...state,
    confirmImport,
    reset,
  };
}
