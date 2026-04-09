import { ModelLoadingBadge } from "@/components/ai/ModelLoadingBadge";
import type { ModelLoadingState } from "@/stores/model-loading-store";
import { cn } from "@/lib/utils";

export interface ModelBadgeProps {
  modelName: string;
  loadingState: ModelLoadingState | null;
  className?: string;
}

export function ModelBadge({ modelName, loadingState, className }: ModelBadgeProps) {
  return (
    <div className={cn("absolute top-4 left-1/2 -translate-x-1/2 z-10", className)}>
      <ModelLoadingBadge
        modelName={modelName}
        loadingState={loadingState}
        className="bg-surface-muted/50 backdrop-blur-sm border border-border/50 shadow-sm"
      />
    </div>
  );
}
