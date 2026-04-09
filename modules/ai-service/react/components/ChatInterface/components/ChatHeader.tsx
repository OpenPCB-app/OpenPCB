import type { ProjectRecord } from "@shared/types";
import type { ModelLoadingState } from "@/stores/model-loading-store";
import { BackButton } from "./BackButton";
import { ProjectBadge } from "./ProjectBadge";
import { ModelBadge } from "./ModelBadge";

export interface ChatHeaderProps {
  showBack?: boolean;
  onBack?: () => void;
  projectContext?: ProjectRecord | null;
  projectContextError?: boolean;
  modelName?: string;
  modelLoadingState?: ModelLoadingState | null;
}

export function ChatHeader({
  showBack,
  onBack,
  projectContext,
  projectContextError,
  modelName,
  modelLoadingState,
}: ChatHeaderProps) {
  return (
    <>
      {showBack && onBack && <BackButton onBack={onBack} />}

      {(projectContext || projectContextError) && (
        <ProjectBadge
          project={projectContext ?? null}
          error={projectContextError}
        />
      )}

      {modelName && !projectContext && (
        <ModelBadge
          modelName={modelName}
          loadingState={modelLoadingState ?? null}
        />
      )}
    </>
  );
}
