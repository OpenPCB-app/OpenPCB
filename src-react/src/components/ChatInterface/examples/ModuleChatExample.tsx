import { useEffect } from "react";
import { ChatInterface } from "@/components/ChatInterface";
import { useModuleChat } from "@/hooks/useModuleChat";

/**
 * Module-embedded chat using useModuleChat hook.
 * Demonstrates lazy initialization and system prompt builder pattern.
 */
export function ModuleChatExample({
  item,
  onLinkChat,
}: {
  item: { id: string; title: string; chatId?: string };
  onLinkChat: (itemId: string, chatId: string) => Promise<void>;
}) {
  const {
    chatId,
    initializeChat,
    isInitializing,
    messages,
    status,
    modelLoadingState,
    submitMessage,
    abort,
    provider,
    model,
    systemPrompt,
  } = useModuleChat({
    moduleId: "my-module",
    contextId: item.id,
    title: item.title,
    existingChatId: item.chatId,
    systemPromptBuilder: () =>
      `You are helping the user with: ${item.title}`,
    onChatCreated: async (newChatId) => {
      await onLinkChat(item.id, newChatId);
    },
  });

  useEffect(() => {
    initializeChat();
  }, [initializeChat]);

  if (isInitializing) return <div>Loading chat...</div>;

  return (
    <ChatInterface config={{
      messages,
      status,
      ui: {
        placeholder: "Ask about this item...",
        emptyState: {
          title: "Start a conversation",
          description: "Ask questions about this item",
        },
      },
      behavior: {
        onSubmit: async (message) => {
          if (!chatId) return;
          await submitMessage({
            chatId,
            provider,
            model,
            text: message.text || "",
            files: message.files,
            systemPrompt,
          });
        },
        onStop: abort,
        modelLoading: { state: modelLoadingState },
      },
    }} />
  );
}
