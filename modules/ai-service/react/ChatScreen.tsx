import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { CollapsibleChatSidebar } from "openpcb-app/src/components/chat/CollapsibleChatSidebar";
import { ChatInterface } from "openpcb-app/src/components/ChatInterface";
import { useStreamChat } from "openpcb-app/src/hooks/useStreamChat";
import { useChatStore } from "openpcb-app/src/stores/chat-store";
import { useChatOperations } from "openpcb-app/src/hooks/useChatOperations";
import { useAppStore } from "openpcb-app/src/stores/app-store";
import { useNavigationStore } from "openpcb-app/src/stores/navigation-store";
import { getWorkspace } from "openpcb-app/src/lib/api/workspace-api";
import { getChat, forkChat } from "openpcb-app/src/lib/api/chat-api";
import type { PromptInputMessage } from "openpcb-app/src/components/ai-elements/prompt-input";
import type {
  ChatMetadata,
  MentionReference,
  ProjectRecord,
} from "src-ts/shared/types";
import { useBackendURL } from "openpcb-app/src/contexts/BackendURLContext";
import { useMessageActions } from "openpcb-app/src/hooks/useMessageActions";
import { useBookmarks } from "openpcb-app/src/hooks/useBookmarks";
import type {
  MessageAction,
  MessageActionPayload,
} from "openpcb-app/src/components/ChatInterface/types";
import { useToast } from "openpcb-app/src/components/ui/use-toast";
import { ChatMediaSidebar } from "openpcb-app/src/components/ChatMediaSidebar";

export function ChatScreen() {
  const { chatId, navigateToChat } = useNavigationStore();
  // Projects feature is temporarily disabled
  // const navigateToProject = useNavigationStore((s) => s.navigateToProject);
  const { createNewChat } = useChatOperations();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  // Projects feature is temporarily disabled
  // const projects = useAppStore((state) => state.projects);

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeChat, setActiveChat] = useState<ChatMetadata | null>(null);
  // Projects feature is temporarily disabled
  const [projectContext, _setProjectContext] = useState<ProjectRecord | null>(
    null,
  );
  const [projectContextError, _setProjectContextError] = useState(false);
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const { toast } = useToast();
  const [isMediaSidebarOpen, setIsMediaSidebarOpen] = useState(false);
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId) {
      setIsMediaSidebarOpen(false);
    }
  }, [chatId]);

  useEffect(() => {
    if (chatId) {
      getChat(chatId)
        .then(setActiveChat)
        .catch(() => setActiveChat(null));
    } else {
      setActiveChat(null);
    }
  }, [chatId]);

  // Projects feature is temporarily disabled
  // useEffect(() => {
  //   setProjectContext(null);
  //   setProjectContextError(false);
  // }, [chatId]);

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

  const {
    setIsStreaming,
    pendingModelSelection,
    setPendingModelSelection,
    pendingInitialMessage,
    clearPendingInitialMessage,
  } = useChatStore();

  const messageActions = useMessageActions();
  const { add: addBookmark } = useBookmarks();

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
    return {
      model: "gpt-4o",
      provider: "openai",
    };
  }, [activeChat, pendingModelSelection]);

  useEffect(() => {
    setIsStreaming(status === "streaming" || status === "submitted");
  }, [status, setIsStreaming]);

  const isCreatingRef = useRef(false);
  const processedPendingMessageRef = useRef<string | null>(null);

  useEffect(() => {
    // Prevent any processing while we're in the middle of creating/sending
    if (isCreatingRef.current) {
      return;
    }

    // Check if there's a pending initial message for this chat (from ProjectScreen)
    if (chatId && pendingInitialMessage?.chatId === chatId) {
      // Prevent duplicate processing of the same pending message
      const messageKey = `${chatId}-${pendingInitialMessage.message.text?.slice(0, 50)}`;
      if (processedPendingMessageRef.current === messageKey) {
        return;
      }
      processedPendingMessageRef.current = messageKey;

      isCreatingRef.current = true;
      const { message } = pendingInitialMessage;
      clearPendingInitialMessage();

      // Send the pending message
      const provider = activeChat?.config.provider || currentConfig.provider;
      const model = activeChat?.config.model || currentConfig.model;
      const systemPrompt = activeChat?.config.systemPrompt;

      submitMessage({
        chatId,
        provider,
        model,
        text: message.text || "",
        files: message.files,
        systemPrompt: systemPrompt || undefined,
        workspaceId: activeWorkspaceId ?? undefined,
        projectId: activeChat?.projectId ?? null,
        toolChoice: toolsEnabled ? "auto" : "none",
      }).finally(() => {
        isCreatingRef.current = false;
      });

      return;
    }

    processedPendingMessageRef.current = null;
    resetState();

    if (chatId) {
      loadMessages(chatId);
    }
  }, [
    chatId,
    resetState,
    loadMessages,
    pendingInitialMessage,
    clearPendingInitialMessage,
    activeChat,
    currentConfig,
    activeWorkspaceId,
    submitMessage,
    toolsEnabled,
  ]);

  const handleSubmit = async (message: PromptInputMessage) => {
    let targetChatId = chatId;

    let provider = activeChat?.config.provider;
    let model = activeChat?.config.model;
    let systemPrompt = activeChat?.config.systemPrompt;

    if (!targetChatId) {
      try {
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
            console.error("Failed to fetch workspace defaults", e);
          }
        }

        isCreatingRef.current = true;

        const newChat = await createNewChat(
          message.text?.slice(0, 30) || "New Chat",
          config,
        );

        if (newChat) {
          targetChatId = newChat.id;
          navigateToChat(newChat.id);
          setRefreshTrigger((prev) => prev + 1);

          provider = config.provider;
          model = config.model;
          systemPrompt = newChat.config.systemPrompt;

          if (pendingModelSelection) {
            setPendingModelSelection(null);
          }
        } else {
          console.error("Failed to create chat");
          isCreatingRef.current = false;
          return;
        }
      } catch (err) {
        console.error("Error creating chat on submit", err);
        isCreatingRef.current = false;
        return;
      }
    }

    if (!targetChatId) return;

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

  const handleNewChat = () => {
    navigateToChat(null);
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
        console.warn("[ChatScreen] Failed to navigate to mention:", err);
      }
    },
    [backendURL],
  );

  const handleMessageAction = useCallback(
    async (
      messageId: string,
      action: MessageAction,
      payload?: MessageActionPayload,
    ) => {
      try {
        switch (action) {
          case "edit": {
            const content = payload?.content?.trim();
            if (!content) {
              toast({
                variant: "destructive",
                title: "Edit Failed",
                description: "Message content cannot be empty.",
              });
              return;
            }
            await messageActions.editMessage(messageId, content);
            if (chatId) {
              await loadMessages(chatId);
            }
            toast({
              title: "Message Updated",
              description: "Created a new branch from your edit.",
            });
            break;
          }
          case "resend":
            await messageActions.resendMessage(messageId);
            if (chatId) {
              await loadMessages(chatId);
            }
            toast({
              title: "Retry Started",
              description: "Retrying assistant response.",
            });
            break;
          case "regenerate":
            await messageActions.regenerateMessage(messageId);
            if (chatId) {
              await loadMessages(chatId);
            }
            toast({
              title: "Regeneration Started",
              description: "Generating an alternative response.",
            });
            break;
          case "bookmark":
            if (chatId) await addBookmark(messageId, chatId);
            break;
          case "fork":
            if (!chatId) return;
            setForkingMessageId(messageId);
            try {
              const { chat } = await forkChat(chatId, messageId);
              toast({
                title: "Chat Forked",
                description: "New chat created from this message.",
              });
              navigateToChat(chat.id);
              setRefreshTrigger((prev) => prev + 1);
            } catch (err) {
              toast({
                variant: "destructive",
                title: "Fork Failed",
                description:
                  err instanceof Error ? err.message : "Unknown error",
              });
            } finally {
              setForkingMessageId(null);
            }
            break;
        }
      } catch (err) {
        console.error(`Failed to ${action} message:`, err);
        toast({
          variant: "destructive",
          title: "Action Failed",
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [messageActions, chatId, loadMessages, addBookmark, toast, navigateToChat],
  );

  return (
    <div className="flex h-full w-full relative">
      {
        <CollapsibleChatSidebar
          activeChatId={chatId}
          onChatSelect={navigateToChat}
          onNewChat={handleNewChat}
          refreshTrigger={refreshTrigger}
        />
      }

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <ChatInterface
          config={{
            messages,
            status,
            modelName: currentConfig.model,
            projectContext,
            projectContextError,
            ui: {
              placeholder: activeChat
                ? "Type your message..."
                : `Message ${currentConfig.model}...`,
              emptyState: {
                title: activeChat
                  ? activeChat.title
                  : "Start a new conversation",
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
              chatId: chatId ?? undefined,
              workspaceId: activeWorkspaceId ?? undefined,
            },
            behavior: {
              onSubmit: handleSubmit,
              onStop: abort,
              // Projects feature is temporarily disabled
              onBack: undefined,
              onMessageAction: handleMessageAction,
              onBranchChange: () => {
                if (chatId) {
                  void loadMessages(chatId);
                }
              },
              forkingMessageId,
              messageActions: {
                activeAction: messageActions.activeAction,
                activeMessageId: messageActions.activeMessageId,
                isBusy: messageActions.isBusy,
              },
              modelLoading: {
                state: modelLoadingState,
                onRetry: () => {},
              },
            },
          }}
        />
      </div>

      <ChatMediaSidebar
        chatId={chatId ?? undefined}
        open={isMediaSidebarOpen}
        onOpenChange={setIsMediaSidebarOpen}
      />
    </div>
  );
}
