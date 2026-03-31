import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatInterface } from "@/components/ChatInterface";
import { useActiveChat } from "@/hooks/useActiveChat";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useChatStore } from "@/stores/chat-store";
import { useChatOperations } from "@/hooks/useChatOperations";
import { useAppStore } from "@/stores/app-store";
import { getWorkspace } from "@/lib/api/workspace-api";
import { useBackendURL } from "@/contexts/BackendURLContext";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import type { MentionReference } from "@shared/types";

export default function Home() {
  const { activeChatId, setActiveChatId, activeChat } = useActiveChat();
  const { createNewChat } = useChatOperations();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  // Local state to trigger sidebar refresh
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [toolsEnabled, setToolsEnabled] = useState(false);

  const {
    messages,
    status,
    error,
    isLoading,
    modelLoadingState,
    submitMessage,
    abort,
    loadMessages,
    resetState,
  } = useStreamChat();

  // Get streaming sync from chat store
  const { setIsStreaming, pendingModelSelection, setPendingModelSelection } =
    useChatStore();

  // Determine current model and provider (for empty state)
  // Priority: Pending Selection -> Active Chat Config -> Workspace Defaults -> Fallback
  const currentConfig = useMemo(() => {
    if (activeChat) {
      return {
        model: activeChat.config.model,
        provider: activeChat.config.provider,
      };
    }
    if (pendingModelSelection) {
      return pendingModelSelection;
    }
    // We can't easily get workspace defaults synchronously here without causing side effects or prop drilling.
    // For now, we'll rely on the fact that ModelSelector syncs pendingModelSelection on mount/change if needed,
    // or we default to 'gpt-4o'/'openai' visual fallbacks if really nothing is known.
    // Ideally we would read from a cached workspace object in store if available.
    return {
      model: "gpt-4o",
      provider: "openai",
    };
  }, [activeChat, pendingModelSelection]);

  // Sync streaming status to store (for components outside this tree like ModelSelector)
  useEffect(() => {
    setIsStreaming(status === "streaming" || status === "submitted");
  }, [status, setIsStreaming]);

  // Track creation to prevent resetting state when switching to new chat
  const isCreatingRef = useRef(false);

  // Reset state and load messages when chat ID changes
  useEffect(() => {
    // If we are in the process of creating a chat, don't reset state
    // (to preserve optimistic messages and stream status)
    if (isCreatingRef.current && activeChatId) {
      isCreatingRef.current = false;
      return;
    }

    // Always reset state first to clear any previous chat's streaming state
    resetState();

    if (activeChatId) {
      loadMessages(activeChatId);
    }
  }, [activeChatId, resetState, loadMessages]);

  // Handle message submission
  const handleSubmit = async (message: PromptInputMessage) => {
    let targetChatId = activeChatId;

    // Capture config to use for submission
    let provider = activeChat?.config.provider;
    let model = activeChat?.config.model;
    let systemPrompt = activeChat?.config.systemPrompt;

    // If no active chat, create one first
    if (!targetChatId) {
      try {
        // Get defaults if available (starts with pending selection or fallback)
        let config = { ...currentConfig };

        // If we don't have a pending selection, try to fetch workspace defaults
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
            console.error("Failed to fetch workspace defaults", e);
          }
        }

        // Mark as creating to prevent useEffect from resetting state
        isCreatingRef.current = true;

        // Create chat with resolved config
        const newChat = await createNewChat(
          message.text?.slice(0, 30) || "New Chat",
          config,
        );

        if (newChat) {
          targetChatId = newChat.id;
          setActiveChatId(newChat.id);
          setRefreshTrigger((prev) => prev + 1); // Trigger sidebar refresh

          // CRITICAL: Use the RESOLVED config for the first message.
          // Do NOT rely on currentConfig (which reverts when pending is cleared)
          // or newChat.config (in case of backend normalization issues).
          // We trust 'config' because we just used it to create the chat.
          provider = config.provider;
          model = config.model;
          systemPrompt = newChat.config.systemPrompt;

          // Clear pending selection as it's now applied to the chat
          if (pendingModelSelection) {
            setPendingModelSelection(null);
          }
        } else {
          console.error("Failed to create chat");
          isCreatingRef.current = false; // Reset flag on failure
          return;
        }
      } catch (err) {
        console.error("Error creating chat on submit", err);
        isCreatingRef.current = false; // Reset flag on error
        return;
      }
    }

    if (!targetChatId) return;

    // Fallback if missing (should not happen with above logic)
    provider = provider || currentConfig.provider || "openai";
    model = model || currentConfig.model || "gpt-4o";

    await submitMessage({
      chatId: targetChatId,
      provider,
      model,
      text: message.text || "",
      files: message.files,
      systemPrompt: systemPrompt || undefined,
      workspaceId: activeWorkspaceId ?? undefined,
      projectId: activeChat?.projectId ?? null,
      toolChoice: toolsEnabled ? "auto" : "none",
    });
  };

  const { backendURL } = useBackendURL();

  const handleMentionClick = useCallback(
    async (mention: MentionReference) => {
      if (!backendURL) return;

      try {
        const response = await fetch(
          `${backendURL}/api/mentions/navigate/${mention.entityType}/${mention.entityId}`,
        );
        if (!response.ok) return;

        const data = await response.json();
        if (data.path) {
          window.dispatchEvent(
            new CustomEvent("openpcb:navigate", {
              detail: { path: data.path, entityType: mention.entityType },
            }),
          );
        }
      } catch (err) {
        console.warn("[Home] Failed to navigate to mention:", err);
      }
    },
    [backendURL],
  );

  return (
    <div className="flex h-full w-full">
      {/* Left sidebar with chat list */}
      <ChatSidebar
        activeChatId={activeChatId}
        onChatSelect={setActiveChatId}
        refreshTrigger={refreshTrigger}
      />

      {/* Main content area */}
      <div className="flex flex-1 flex-col">
        <ChatInterface config={{
          messages,
          status,
          modelName: currentConfig.model,
          ui: {
            placeholder: activeChat
              ? "Type your message..."
              : `Message ${currentConfig.model}...`,
            emptyState: {
              title: activeChat ? activeChat.title : "Start a new conversation",
              description: isLoading
                ? "Loading messages..."
                : error
                  ? `Error: ${error}`
                  : activeChat
                    ? "Start a conversation in this chat"
                    : "Type a message to create a new chat",
            },
          },
          features: {
            tools: {
              enabled: toolsEnabled,
              onToolsEnabledChange: setToolsEnabled,
            },
            mentions: {
              onMentionClick: handleMentionClick,
            },
          },
          context: {
            chatId: activeChatId ?? undefined,
            workspaceId: activeWorkspaceId ?? undefined,
          },
          behavior: {
            onSubmit: handleSubmit,
            onStop: abort,
            modelLoading: {
              state: modelLoadingState,
              onRetry: () => {},
            },
          },
        }} />
      </div>
    </div>
  );
}
