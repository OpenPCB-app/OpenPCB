import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ImportLinkingStep() {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-[800px] space-y-6">
        <div>
          <h2 className="text-lg font-medium text-text-primary">Symbol-Footprint Linking</h2>
          <p className="text-sm text-text-muted mt-1">
            Manually link symbols to footprints if automatic matching failed
          </p>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Automatic Linking</AlertTitle>
          <AlertDescription>
            All symbols and footprints have been automatically linked based on naming conventions.
            Manual linking will be implemented in a future release.
          </AlertDescription>
        </Alert>

        <div className="rounded-lg border border-border-default bg-bg-input p-8 text-center">
          <p className="text-sm text-text-muted">
            Manual linking interface coming soon
          </p>
        </div>
      </div>
    </div>
  );
}
