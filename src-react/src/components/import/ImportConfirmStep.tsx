import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ImportPreviewGroup } from "@/hooks/useImportPreview";

interface ImportConfirmStepProps {
  groups: ImportPreviewGroup[];
  duplicateStrategy: "skip" | "overwrite" | "rename";
  onDuplicateStrategyChange: (strategy: "skip" | "overwrite" | "rename") => void;
}

export function ImportConfirmStep({
  groups,
  duplicateStrategy,
  onDuplicateStrategyChange,
}: ImportConfirmStepProps) {
  const totalVariants = groups.reduce((acc, g) => acc + g.variants.length, 0);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-[800px] space-y-6">
        <div>
          <h2 className="text-lg font-medium text-text-primary">Confirm Import</h2>
          <p className="text-sm text-text-muted mt-1">
            Review final settings and start the import process
          </p>
        </div>

        {/* Duplicate handling */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-text-secondary">
            Duplicate Handling
          </label>
          <div className="space-y-2">
            <button
              className={cn(
                "w-full rounded-md border px-4 py-3 text-left transition-colors",
                duplicateStrategy === "skip"
                  ? "border-brand bg-brand-bg"
                  : "border-border-default bg-bg-elevated hover:bg-bg-input",
              )}
              onClick={() => onDuplicateStrategyChange("skip")}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center",
                    duplicateStrategy === "skip"
                      ? "border-brand bg-brand"
                      : "border-border-default",
                  )}
                >
                  {duplicateStrategy === "skip" && (
                    <div className="h-2 w-2 rounded-full bg-white" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">Skip Duplicates</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Do not import components that already exist in the library
                  </p>
                </div>
              </div>
            </button>

            <button
              className={cn(
                "w-full rounded-md border px-4 py-3 text-left transition-colors",
                duplicateStrategy === "overwrite"
                  ? "border-brand bg-brand-bg"
                  : "border-border-default bg-bg-elevated hover:bg-bg-input",
              )}
              onClick={() => onDuplicateStrategyChange("overwrite")}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center",
                    duplicateStrategy === "overwrite"
                      ? "border-brand bg-brand"
                      : "border-border-default",
                  )}
                >
                  {duplicateStrategy === "overwrite" && (
                    <div className="h-2 w-2 rounded-full bg-white" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">Overwrite Existing</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Replace existing components with imported versions
                  </p>
                </div>
              </div>
            </button>

            <button
              className={cn(
                "w-full rounded-md border px-4 py-3 text-left transition-colors",
                duplicateStrategy === "rename"
                  ? "border-brand bg-brand-bg"
                  : "border-border-default bg-bg-elevated hover:bg-bg-input",
              )}
              onClick={() => onDuplicateStrategyChange("rename")}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center",
                    duplicateStrategy === "rename"
                      ? "border-brand bg-brand"
                      : "border-border-default",
                  )}
                >
                  {duplicateStrategy === "rename" && (
                    <div className="h-2 w-2 rounded-full bg-white" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">Rename Duplicates</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Automatically rename duplicates with a suffix (e.g., Component_1)
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Import summary */}
        <div className="rounded-lg border border-border-default bg-bg-elevated p-4 space-y-3">
          <h3 className="text-sm font-medium text-text-secondary">Import Summary</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Component families</span>
              <span className="font-medium text-text-primary">{groups.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Total variants</span>
              <span className="font-medium text-text-primary">{totalVariants}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Symbol files</span>
              <span className="font-medium text-text-primary">
                {groups.filter((g) => g.symbolFileName).length}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Footprint files</span>
              <span className="font-medium text-text-primary">
                {groups.reduce(
                  (acc, g) =>
                    acc + g.variants.reduce((a, v) => a + v.footprintFileNames.length, 0),
                  0,
                )}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">3D model files</span>
              <span className="font-medium text-text-primary">
                {groups.reduce(
                  (acc, g) =>
                    acc + g.variants.reduce((a, v) => a + v.model3dFileNames.length, 0),
                  0,
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Ready to import */}
        <div className="rounded-lg border border-success bg-success/10 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">Ready to Import</p>
              <p className="text-xs text-text-muted mt-1">
                Click "Import Components" to add these components to your library
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
