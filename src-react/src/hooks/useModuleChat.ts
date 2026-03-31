import { useStreamChat } from "@/hooks/useStreamChat";
import { useCallback, useState, useEffect, useRef } from "react";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { useAppStore } from "@/stores/app-store";
import { useChatStore } from "@/stores/chat-store";

/**
 * Options for the useModuleChat hook.
 */
export interface UseModuleChatOptions {
  /** Unique identifier of the module using this hook */
  moduleId: string;

  /** Generic entity ID this chat is scoped to (e.g., a node, document, or item) */
  contextId: string;

  /** Display title used when creating a new chat */
  title: string;

  /** If a chat already exists for this context, pass its ID to load messages */
  existingChatId?: string | null;

  /** Function that returns the system prompt for this module's AI behavior */
  systemPromptBuilder?: () => string;

  /** Called after a new chat is created, before messages are loaded */
  onChatCreated?: (chatId: string) => Promise<void>;
}

/**
 * Return type for the useModuleChat hook.
 */
export interface UseModuleChatReturn {
  /** The active chat ID (null if not yet initialized) */
  chatId: string | null;

  /** Call this to initialize or load the chat (lazy initialization) */
  initializeChat: () => Promise<void>;

  /** Whether chat initialization is in progress */
  isInitializing: boolean;

  /** Current system prompt value */
  systemPrompt: string;

  /** Currently selected provider ID */
  provider: string;

  /** Currently selected model ID */
  model: string;

  /** Chat messages */
  messages: ReturnType<typeof useStreamChat>["messages"];

  /** Current streaming/connection status */
  status: ReturnType<typeof useStreamChat>["status"];

  /** Model loading state (for Ollama local models, etc.) */
  modelLoadingState: ReturnType<typeof useStreamChat>["modelLoadingState"];

  /** Submit a new message to the chat */
  submitMessage: ReturnType<typeof useStreamChat>["submitMessage"];

  /** Abort the current stream */
  abort: ReturnType<typeof useStreamChat>["abort"];

  /** Load messages for a given chat ID */
  loadMessages: ReturnType<typeof useStreamChat>["loadMessages"];
}

/**
 * Generalized hook for module-scoped AI chat.
 *
 * Provides lazy chat creation, streaming, and message management
 * for any module that needs embedded AI chat. Generalizes the pattern
 * from the brainstorming module's useNodeChat into a reusable hook.
 *
 * @param options - Module chat configuration
 * @returns Chat state and actions
 *
 * @example
 * ```tsx
 * function MyModuleDetail({ item }: { item: { id: string; title: string; chatId?: string } }) {
 *   const {
 *     chatId,
 *     initializeChat,
 *     isInitializing,
 *     messages,
 *     status,
 *     modelLoadingState,
 *     submitMessage,
 *     abort,
 *     provider,
 *     model,
 *     systemPrompt,
 *   } = useModuleChat({
 *     moduleId: "my-module",
 *     contextId: item.id,
 *     title: item.title,
 *     existingChatId: item.chatId,
 *     systemPromptBuilder: () => `You are helping with: ${item.title}`,
 *     onChatCreated: async (newChatId) => {
 *       await linkChatToItem(item.id, newChatId);
 *     },
 *   });
 *
 *   useEffect(() => { initializeChat(); }, [initializeChat]);
 *
 *   return (
 *     <ChatInterface config={{
 *       messages,
 *       status,
 *       behavior: {
 *         onSubmit: (msg) => submitMessage({
 *           chatId: chatId!,
 *           provider,
 *           model,
 *           text: msg.text,
 *           systemPrompt,
 *         }),
 *         onStop: abort,
 *         modelLoading: { state: modelLoadingState },
 *       },
 *     }} />
 *   );
 * }
 * ```
 */
export function useModuleChat(options: UseModuleChatOptions): UseModuleChatReturn {
  const {
    moduleId,
    contextId,
    title,
    existingChatId,
  } = options;

  const [chatId, setChatId] = useState<string | null>(existingChatId ?? null);
  const [isInitializing, setIsInitializing] = useState(false);

  const { backendURL } = useBackendURL();
  const workspaceId = useAppStore((state) => state.activeWorkspaceId);
  const pendingModelSelection = useChatStore(
    (state) => state.pendingModelSelection,
  );
  const streamChat = useStreamChat();
  const { loadMessages, resetState } = streamChat;

  const selectedProvider = pendingModelSelection?.provider ?? "openai";
  const selectedModel =
    pendingModelSelection?.model ?? "gpt-4o-mini-2024-07-18";

  const systemPromptBuilderRef = useRef(options.systemPromptBuilder);
  useEffect(() => {
    systemPromptBuilderRef.current = options.systemPromptBuilder;
  }, [options.systemPromptBuilder]);

  const systemPrompt = options.systemPromptBuilder?.() ?? "";

  const onChatCreatedRef = useRef(options.onChatCreated);
  useEffect(() => {
    onChatCreatedRef.current = options.onChatCreated;
  }, [options.onChatCreated]);

  const systemPromptValueRef = useRef(systemPrompt);
  useEffect(() => {
    systemPromptValueRef.current = systemPrompt;
  }, [systemPrompt]);

  const attemptRef = useRef(false);

  const chatIdRef = useRef(chatId);
  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  const initializeChat = useCallback(async () => {
    if (chatIdRef.current || attemptRef.current) return;

    attemptRef.current = true;
    setIsInitializing(true);

    try {
      if (existingChatId) {
        setChatId(existingChatId);
        await loadMessages(existingChatId);
      } else {
        const response = await fetch(`${backendURL}/api/chats`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            category: `module_${moduleId}`,
            workspaceId: workspaceId || "default-workspace",
            config: {
              systemPrompt: systemPromptValueRef.current,
              provider: selectedProvider,
              model: selectedModel,
            },
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `Failed to create chat: ${response.status} ${text}`,
          );
        }

        const data = await response.json();

        let chat = data.chat;
        if (!chat && data.data?.chat) {
          chat = data.data.chat;
        }

        if (!chat || !chat.id) {
          throw new Error("Invalid API response: missing chat object");
        }

        if (onChatCreatedRef.current) {
          await onChatCreatedRef.current(chat.id);
        }

        setChatId(chat.id);
      }
    } catch (err) {
      console.error(
        `[useModuleChat] Failed to initialize chat for module=${moduleId}, context=${contextId}:`,
        err,
      );
    } finally {
      setIsInitializing(false);
    }
  }, [
    existingChatId,
    title,
    moduleId,
    contextId,
    backendURL,
    workspaceId,
    selectedProvider,
    selectedModel,
    loadMessages,
  ]);

  useEffect(() => {
    if (existingChatId !== chatId) {
      attemptRef.current = false;
      setChatId(existingChatId ?? null);
      resetState();
    }
  }, [contextId, existingChatId, chatId, resetState]);

  return {
    chatId,
    initializeChat,
    isInitializing,
    systemPrompt,
    provider: selectedProvider,
    model: selectedModel,
    messages: streamChat.messages,
    status: streamChat.status,
    modelLoadingState: streamChat.modelLoadingState,
    submitMessage: streamChat.submitMessage,
    abort: streamChat.abort,
    loadMessages: streamChat.loadMessages,
  };
}
