import { ChatInterface } from "@/components/ChatInterface";
import { useStreamChat } from "@/hooks/useStreamChat";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

/**
 * Full-featured main chat — the standard usage pattern.
 * Uses ChatConfig directly (no preset) since main chat has
 * dynamic empty state and chat-creation logic.
 */
export function MainChatExample({
  activeChatId,
  workspaceId,
  modelName,
  onSubmit,
  onStop,
}: {
  activeChatId?: string;
  workspaceId?: string;
  modelName: string;
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  onStop: () => void;
}) {
  const { messages, status, modelLoadingState } = useStreamChat();

  return (
    <ChatInterface config={{
      messages,
      status,
      modelName,
      ui: {
        placeholder: activeChatId
          ? "Type your message..."
          : `Message ${modelName}...`,
        emptyState: {
          title: "Start a new conversation",
          description: "Type a message to create a new chat",
        },
      },
      features: {
        tools: { enabled: true, onToolsEnabledChange: () => {} },
        mentions: { enabled: true },
      },
      context: {
        chatId: activeChatId,
        workspaceId,
      },
      behavior: {
        onSubmit,
        onStop,
        modelLoading: { state: modelLoadingState },
      },
    }} />
  );
}
