import { Loader2 } from "lucide-react";
import { useUnifiedImportStore } from "../../stores/useUnifiedImportStore";

const STAGE_LABELS: Record<string, string> = {
  extracting: "Extracting ZIP contents...",
  parsing_symbol: "Parsing schematic symbol...",
  parsing_footprint: "Parsing PCB footprint...",
  processing_3d_model: "Processing 3D model...",
  extracting_metadata: "Extracting metadata...",
  checking_conflicts: "Checking for conflicts...",
  preview_ready: "Ready for preview",
  awaiting_resolution: "Awaiting your decision...",
  saving: "Saving to library...",
};

export function ProcessingIndicator() {
  const progress = useUnifiedImportStore((s: { progress: number }) => s.progress);
  const progressStage = useUnifiedImportStore((s: { progressStage: string | null }) => s.progressStage);

  const stageLabel = progressStage ? STAGE_LABELS[progressStage] || "Processing..." : "Starting...";

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <Loader2 className="h-12 w-12 text-brand animate-spin mb-4" />
      <p className="text-sm text-text-secondary mb-2">{stageLabel}</p>
      <div className="w-64 h-2 bg-bg-elevated rounded-full overflow-hidden">
        <div
          className="h-full bg-brand transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-xs text-text-tertiary mt-2">{progress}%</p>
    </div>
  );
}
