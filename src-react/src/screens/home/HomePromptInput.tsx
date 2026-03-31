import { useCallback, useMemo } from "react";
import {
  AIChatPromptInput,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { useChatOperations } from "@/hooks/useChatOperations";
import { useChatStore } from "@/stores/chat-store";
import { useNavigationStore } from "@/stores/navigation-store";
import { useAppStore } from "@/stores/app-store";
import { getWorkspace } from "@/lib/api/workspace-api";

export function HomePromptInput() {
  const { createNewChat, isCreating } = useChatOperations();
  const { pendingModelSelection, setPendingInitialMessage } = useChatStore();
  const { navigateToChat, currentScreen } = useNavigationStore();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const isVisible = currentScreen === "home";

  const currentConfig = useMemo(() => {
    if (pendingModelSelection) {
      return pendingModelSelection;
    }
    return {
      model: "gpt-4o",
      provider: "openai",
    };
  }, [pendingModelSelection]);

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (!message.text?.trim() && !message.files?.length) return;

      let config = { ...currentConfig };

      if (!pendingModelSelection && activeWorkspaceId) {
        try {
          const ws = await getWorkspace(activeWorkspaceId);
          if (ws?.settings) {
            config = {
              model: ws.settings.defaultModel || "gpt-4o",
              provider: ws.settings.defaultProvider || "openai",
            };
          }
        } catch (e) {
          console.warn("Failed to fetch workspace defaults", e);
        }
      }

      const newChat = await createNewChat(
        message.text?.slice(0, 30) || "New Chat",
        config,
      );

      if (newChat) {
        setPendingInitialMessage({
          chatId: newChat.id,
          message,
        });
        navigateToChat(newChat.id);
      }
    },
    [
      createNewChat,
      currentConfig,
      pendingModelSelection,
      activeWorkspaceId,
      setPendingInitialMessage,
      navigateToChat,
    ],
  );

  return (
    <div className="fixed bottom-0 left-[75px] right-[75px] z-20 bg-gradient-to-t from-background via-background to-transparent pt-6 pb-4 px-8">
      <div className="mx-auto max-w-xl">
        <AIChatPromptInput
          onSubmit={handleSubmit}
          placeholder={`Message ${currentConfig.model.split("/").pop() || currentConfig.model}...`}
          status={isCreating ? "submitted" : "ready"}
          workspaceId={activeWorkspaceId ?? undefined}
          accept="image/*,application/pdf"
          autoFocus
          autoFocusKey={isVisible ? "home-visible" : "home-hidden"}
        />
      </div>
    </div>
  );
}
