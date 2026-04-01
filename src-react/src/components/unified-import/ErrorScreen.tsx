import { AlertCircle } from "lucide-react";
import { useUnifiedImportStore } from "../../stores/useUnifiedImportStore";

export function ErrorScreen() {
  const error = useUnifiedImportStore((s: { error: string | null }) => s.error);
  const reset = useUnifiedImportStore((s: { reset: () => void }) => s.reset);

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <AlertCircle className="h-16 w-16 text-error mb-4" />
      <h2 className="text-xl font-semibold text-text-primary mb-2">
        Import Failed
      </h2>
      <p className="text-sm text-text-secondary mb-6 max-w-md">
        {error || "An unexpected error occurred during import."}
      </p>

      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 bg-brand text-white rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
