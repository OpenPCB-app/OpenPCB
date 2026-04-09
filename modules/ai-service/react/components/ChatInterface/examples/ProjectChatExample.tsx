import { ChatInterface } from "@/components/ChatInterface";
import { createProjectChat } from "@/components/ChatInterface/presets";
import { useStreamChat } from "@/hooks/useStreamChat";
import type { ProjectRecord } from "@shared/types";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

/**
 * Project-scoped chat with back navigation and project badge.
 * Uses createProjectChat() factory for project-specific defaults.
 */
export function ProjectChatExample({
  project,
  chatId,
  onBack,
  onSubmit,
  onStop,
}: {
  project: ProjectRecord;
  chatId: string;
  onBack: () => void;
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  onStop: () => void;
}) {
  const { messages, status, modelLoadingState } = useStreamChat();

  const config = createProjectChat({
    projectContext: project,
    projectId: project.id,
    onBack,
    overrides: {
      messages,
      status,
      modelName: "gpt-4o",
      context: { chatId },
      behavior: {
        onSubmit,
        onStop,
        modelLoading: { state: modelLoadingState },
      },
    },
  });

  return <ChatInterface config={config} />;
}
