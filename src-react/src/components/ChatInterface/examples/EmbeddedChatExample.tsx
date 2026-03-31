import { ChatInterface } from "@/components/ChatInterface";
import { createEmbeddedChat } from "@/components/ChatInterface/presets";
import { useStreamChat } from "@/hooks/useStreamChat";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

/**
 * Minimal embedded chat using createEmbeddedChat() factory.
 * Compact layout, no tools/attachments/mentions — just text chat.
 */
export function EmbeddedChatExample({
  chatId,
  onSubmit,
  onStop,
}: {
  chatId: string;
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  onStop: () => void;
}) {
  const { messages, status, modelLoadingState } = useStreamChat();

  const config = createEmbeddedChat({
    maxHeight: "400px",
    overrides: {
      messages,
      status,
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
