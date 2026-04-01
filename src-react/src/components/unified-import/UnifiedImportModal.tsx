import { X } from "lucide-react";
import { useUnifiedImportStore } from "../../stores/useUnifiedImportStore";
import { UploadStep } from "./UploadStep";
import { ProcessingIndicator } from "./ProcessingIndicator";
import { PreviewScreen } from "./PreviewScreen";
import { SuccessScreen } from "./SuccessScreen";
import { ErrorScreen } from "./ErrorScreen";

interface UnifiedImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
}

export function UnifiedImportModal({ isOpen, onClose, workspaceId }: UnifiedImportModalProps) {
  const currentStep = useUnifiedImportStore((s: { currentStep: string }) => s.currentStep);

  if (!isOpen) return null;

  const renderStep = () => {
    switch (currentStep) {
      case "upload":
        return <UploadStep workspaceId={workspaceId} />;
      case "processing":
        return <ProcessingIndicator />;
      case "preview":
      case "conflict":
        return <PreviewScreen />;
      case "success":
        return <SuccessScreen />;
      case "error":
        return <ErrorScreen />;
      default:
        return <UploadStep workspaceId={workspaceId} />;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-elevated rounded-lg w-full max-w-3xl h-[80vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
          <h2 className="text-lg font-semibold text-text-primary">
            Import Component
          </h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {renderStep()}
        </div>
      </div>
    </div>
  );
}
