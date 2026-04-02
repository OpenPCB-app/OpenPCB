import { useCallback, useMemo, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  importComponentsFromFiles,
  type ComponentImportExecutionResult,
} from "@/lib/api/component-api";

interface UnifiedImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported?: (result: ComponentImportExecutionResult) => void;
}

type ImportState = "idle" | "importing" | "success" | "error";

export function UnifiedImportModal({
  isOpen,
  onClose,
  onImported,
}: UnifiedImportModalProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [state, setState] = useState<ImportState>("idle");
  const [result, setResult] = useState<ComponentImportExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSummary = useMemo(
    () => selectedFiles.map((file) => file.name).join(", "),
    [selectedFiles],
  );

  const reset = useCallback(() => {
    setSelectedFiles([]);
    setIsDragging(false);
    setState("idle");
    setResult(null);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const updateFiles = useCallback((files: FileList | File[]) => {
    setSelectedFiles(Array.from(files));
    setState("idle");
    setResult(null);
    setError(null);
  }, []);

  const handleImport = useCallback(async () => {
    if (selectedFiles.length === 0) {
      return;
    }

    setState("importing");
    setError(null);

    try {
      const importResult = await importComponentsFromFiles(selectedFiles);
      setResult(importResult);
      setState("success");
      onImported?.(importResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import components");
      setState("error");
    }
  }, [onImported, selectedFiles]);

  if (!isOpen) {
    return null;
  }

  const isImporting = state === "importing";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-lg bg-bg-elevated shadow-xl">
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              Import Components
            </h2>
            <p className="text-sm text-text-secondary">
              One create-only import path for KiCad source files or a single ZIP archive.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-text-tertiary transition-colors hover:text-text-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <button
            type="button"
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              updateFiles(event.dataTransfer.files);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            className={cn(
              "w-full cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors",
              isDragging
                ? "border-brand bg-brand/5"
                : "border-border-default bg-bg-secondary hover:bg-bg-hover",
            )}
            onClick={() => document.getElementById("component-import-input")?.click()}
          >
            <Upload className="mx-auto mb-4 h-12 w-12 text-text-muted" />
            <p className="mb-2 text-sm text-text-secondary">
              Drop KiCad files here, or click to browse
            </p>
            <p className="text-xs text-text-tertiary">
              Accepts .kicad_sym, .kicad_mod, optional .step/.stp/.wrl, or one .zip archive
            </p>
            <input
              id="component-import-input"
              type="file"
              accept=".zip,.kicad_sym,.kicad_mod,.step,.stp,.wrl"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) {
                  updateFiles(event.target.files);
                }
              }}
            />
          </button>

          {selectedFiles.length > 0 && (
            <div className="mt-6 rounded-lg border border-border-default bg-bg-secondary p-4">
              <h3 className="text-sm font-medium text-text-primary">Ready to import</h3>
              <p className="mt-2 text-sm text-text-secondary">{selectedSummary}</p>
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-lg border border-error/30 bg-error/10 p-4 text-sm text-error">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-success/30 bg-success/10 p-4">
                <h3 className="text-sm font-medium text-text-primary">
                  Imported {result.components.length} component
                  {result.components.length === 1 ? "" : "s"}
                </h3>
                <ul className="mt-3 space-y-2 text-sm text-text-secondary">
                  {result.components.map((component) => (
                    <li key={component.componentId}>
                      {component.displayLabel} · {component.variantCount} variant
                      {component.variantCount === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
              </div>

              {result.warnings.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
                  <h3 className="text-sm font-medium text-text-primary">Warnings</h3>
                  <ul className="mt-3 space-y-2 text-sm text-text-secondary">
                    {result.warnings.map((warning) => (
                      <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.ungroupedFiles.length > 0 && (
                <div className="rounded-lg border border-border-default bg-bg-secondary p-4">
                  <h3 className="text-sm font-medium text-text-primary">
                    Skipped files
                  </h3>
                  <ul className="mt-3 space-y-2 text-sm text-text-secondary">
                    {result.ungroupedFiles.map((fileName) => (
                      <li key={fileName}>{fileName}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border-default px-6 py-4">
          <button
            type="button"
            onClick={reset}
            className="text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            Reset
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="text-sm text-text-secondary transition-colors hover:text-text-primary"
            >
              {state === "success" ? "Done" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={selectedFiles.length === 0 || isImporting}
              className="flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isImporting ? "Importing..." : "Import now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
