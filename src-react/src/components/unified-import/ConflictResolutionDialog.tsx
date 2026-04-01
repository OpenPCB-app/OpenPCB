import { X, AlertTriangle } from "lucide-react";
import { useUnifiedImportStore, type ImportConflict } from "../../stores/useUnifiedImportStore";

interface ConflictResolutionDialogProps {
  conflict: ImportConflict;
  onClose: () => void;
}

export function ConflictResolutionDialog({ conflict, onClose }: ConflictResolutionDialogProps) {
  const resolveConflict = useUnifiedImportStore((s: { resolveConflict: (resolution: "create_new" | "update_existing" | "skip") => Promise<void> }) => s.resolveConflict);

  const handleResolve = (resolution: "create_new" | "update_existing" | "skip") => {
    resolveConflict(resolution);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-elevated rounded-lg max-w-md w-full p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="h-6 w-6 text-warning" />
          <h2 className="text-lg font-semibold text-text-primary">
            Component Already Exists
          </h2>
        </div>

        <p className="text-sm text-text-secondary mb-4">
          A component with this {" "}
          {conflict.type === "name_exists"
            ? "name"
            : conflict.type === "mpn_exists"
              ? "MPN"
              : "name and MPN"}{" "}
          already exists in your library:
        </p>

        <div className="bg-bg-secondary rounded-lg p-4 mb-6 border border-border-default">
          <p className="font-medium text-text-primary">
            {conflict.existingComponent.displayLabel}
          </p>
          {conflict.existingComponent.mpn && (
            <p className="text-sm text-text-tertiary">
              MPN: {conflict.existingComponent.mpn}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <button
            onClick={() => handleResolve("create_new")}
            className="w-full text-left px-4 py-3 rounded-lg border border-border-default hover:bg-bg-secondary transition-colors"
          >
            <p className="font-medium text-text-primary">Create New Component</p>
            <p className="text-xs text-text-tertiary">
              Import as a separate component with a different name
            </p>
          </button>

          <button
            onClick={() => handleResolve("update_existing")}
            className="w-full text-left px-4 py-3 rounded-lg border border-border-default hover:bg-bg-secondary transition-colors"
          >
            <p className="font-medium text-text-primary">Update Existing</p>
            <p className="text-xs text-text-tertiary">
              Replace the existing component with this import
            </p>
          </button>

          <button
            onClick={() => handleResolve("skip")}
            className="w-full text-left px-4 py-3 rounded-lg border border-border-default hover:bg-bg-secondary transition-colors"
          >
            <p className="font-medium text-text-primary">Skip</p>
            <p className="text-xs text-text-tertiary">
              Cancel this import and keep the existing component
            </p>
          </button>
        </div>

        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-tertiary hover:text-text-secondary"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
