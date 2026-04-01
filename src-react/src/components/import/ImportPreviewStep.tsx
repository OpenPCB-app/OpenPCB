import { AlertCircle, AlertTriangle, CheckCircle2, FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ImportPreviewGroup, ImportWarning } from "@/hooks/useImportPreview";

interface ImportPreviewStepProps {
  groups: ImportPreviewGroup[];
  ungroupedFiles: string[];
  totalWarnings: number;
  totalBlockers: number;
}

export function ImportPreviewStep({
  groups,
  ungroupedFiles,
  totalWarnings,
  totalBlockers,
}: ImportPreviewStepProps) {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "text-success";
    if (confidence >= 0.5) return "text-warning";
    return "text-destructive";
  };

  const getSeverityBadge = (warning: ImportWarning) => {
    if (warning.severity === "blocker") {
      return (
        <Badge variant="destructive" className="text-[10px]">
          Blocker
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-[10px] border-warning text-warning">
        Warning
      </Badge>
    );
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-[900px] space-y-6">
        <div>
          <h2 className="text-lg font-medium text-text-primary">Import Preview</h2>
          <p className="text-sm text-text-muted mt-1">
            Review grouped component families and resolve any issues before importing
          </p>
        </div>

        {/* Summary alerts */}
        {totalBlockers > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Import Blocked</AlertTitle>
            <AlertDescription>
              {totalBlockers} blocker{totalBlockers > 1 ? "s" : ""} must be resolved before importing
            </AlertDescription>
          </Alert>
        )}

        {totalWarnings > 0 && totalBlockers === 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertTitle>Warnings Found</AlertTitle>
            <AlertDescription>
              {totalWarnings} warning{totalWarnings > 1 ? "s" : ""} detected. Review before proceeding.
            </AlertDescription>
          </Alert>
        )}

        {groups.length === 0 && ungroupedFiles.length === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No components found</AlertTitle>
            <AlertDescription>
              Unable to parse any valid component families from the uploaded files
            </AlertDescription>
          </Alert>
        )}

        {/* Component groups */}
        {groups.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-secondary">
              Component Families ({groups.length})
            </h3>
            {groups.map((group, groupIndex) => (
              <div
                key={groupIndex}
                className="rounded-lg border border-border-default bg-bg-elevated overflow-hidden"
              >
                {/* Group header */}
                <div className="px-4 py-3 border-b border-border-default bg-bg-secondary">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-text-primary">
                        {group.suggestedFamilyLabel}
                      </h4>
                      <Badge variant="secondary" className="text-[10px]">
                        {group.suggestedCanonicalKey}
                      </Badge>
                    </div>
                    {group.symbolFileName && (
                      <div className="flex items-center gap-1.5 text-xs text-text-muted">
                        <FileIcon className="h-3 w-3" />
                        {group.symbolFileName}
                      </div>
                    )}
                  </div>
                </div>

                {/* Variants */}
                <div className="p-4 space-y-3">
                  {group.variants.map((variant, variantIndex) => (
                    <div
                      key={variantIndex}
                      className="rounded-md border border-border-default bg-bg-input p-3"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-text-primary">
                              {variant.suggestedHumanLabel}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {variant.suggestedCanonicalCode}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span
                            className={cn(
                              "text-xs font-medium",
                              getConfidenceColor(variant.confidence),
                            )}
                          >
                            {Math.round(variant.confidence * 100)}% match
                          </span>
                        </div>
                      </div>

                      {/* Files */}
                      <div className="space-y-1 mt-2">
                        {variant.footprintFileNames.map((fp, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs text-text-muted">
                            <FileIcon className="h-3 w-3" />
                            <span>{fp}</span>
                            <Badge variant="secondary" className="text-[9px]">
                              Footprint
                            </Badge>
                          </div>
                        ))}
                        {variant.model3dFileNames.map((model, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs text-text-muted">
                            <FileIcon className="h-3 w-3" />
                            <span>{model}</span>
                            <Badge variant="secondary" className="text-[9px]">
                              3D Model
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Group warnings */}
                {group.warnings.length > 0 && (
                  <div className="px-4 pb-4 space-y-2">
                    <h5 className="text-xs font-medium text-text-secondary">Issues</h5>
                    {group.warnings.map((warning, wIndex) => (
                      <div
                        key={wIndex}
                        className="flex items-start gap-2 text-xs rounded-md bg-bg-input px-3 py-2"
                      >
                        {getSeverityBadge(warning)}
                        <span className="text-text-secondary flex-1">{warning.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Ungrouped files */}
        {ungroupedFiles.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-text-secondary">
              Ungrouped Files ({ungroupedFiles.length})
            </h3>
            <Alert>
              <AlertTriangle className="h-4 w-4 text-warning" />
              <AlertTitle>Unable to group files</AlertTitle>
              <AlertDescription>
                <div className="space-y-1 mt-2">
                  {ungroupedFiles.map((file, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <FileIcon className="h-3 w-3" />
                      {file}
                    </div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Success state */}
        {groups.length > 0 && totalBlockers === 0 && (
          <Alert>
            <CheckCircle2 className="h-4 w-4 text-success" />
            <AlertTitle>Ready to Import</AlertTitle>
            <AlertDescription>
              {groups.length} component {groups.length > 1 ? "families" : "family"} ready to import
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
