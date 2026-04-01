import { CheckCircle } from "lucide-react";
import { useUnifiedImportStore } from "../../stores/useUnifiedImportStore";

export function SuccessScreen() {
  const previewData = useUnifiedImportStore((s: { previewData: ReturnType<typeof useUnifiedImportStore.getState>['previewData'] }) => s.previewData);
  const closeModal = useUnifiedImportStore((s: { closeModal: () => void }) => s.closeModal);
  const reset = useUnifiedImportStore((s: { reset: () => void }) => s.reset);

  const handleClose = () => {
    closeModal();
    reset();
  };

  const handleImportAnother = () => {
    reset();
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <CheckCircle className="h-16 w-16 text-success mb-4" />
      <h2 className="text-xl font-semibold text-text-primary mb-2">
        Component Imported Successfully!
      </h2>
      <p className="text-sm text-text-secondary mb-6">
        {previewData?.extractedMetadata.componentName} has been added to your component library.
      </p>

      <div className="flex gap-3">
        <button
          onClick={handleClose}
          className="px-4 py-2 bg-brand text-white rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Done
        </button>
        <button
          onClick={handleImportAnother}
          className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary border border-border-default rounded-md transition-colors"
        >
          Import Another
        </button>
      </div>
    </div>
  );
}
