import { create } from 'zustand';
import type { ChatMetadata, UpdateChatInput } from '@shared/types';
import { getChat, updateChat } from '@/lib/api/chat-api';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';

interface PendingModelSelection {
    provider: string;
    model: string;
}

interface PendingInitialMessage {
    chatId: string;
    message: PromptInputMessage;
}

interface ChatState {
    activeChatId: string | null;
    activeChat: ChatMetadata | null;
    isLoading: boolean;
    error: string | null;
    pendingModelSelection: PendingModelSelection | null;
    /** Project default model selection - set when viewing a project */
    projectDefaultModel: PendingModelSelection | null;
    /** Whether the active chat is currently streaming */
    isStreaming: boolean;
    /** Pending initial message for chats created from project screen */
    pendingInitialMessage: PendingInitialMessage | null;

    setActiveChatId: (id: string | null) => void;
    loadActiveChat: () => Promise<void>;
    updateActiveChat: (input: UpdateChatInput) => Promise<void>;
    updateActiveChatLocal: (input: UpdateChatInput) => void;
    refreshActiveChat: () => Promise<void>;
    setPendingModelSelection: (selection: PendingModelSelection | null) => void;
    applyPendingModelSelection: () => Promise<void>;
    /** Set project default model (called when opening a project) */
    setProjectDefaultModel: (selection: PendingModelSelection | null) => void;
    /** Set pending selection from project default (if no active selection) */
    syncProjectDefaultToPending: () => void;
    /** Set streaming status (called by useStreamChat) */
    setIsStreaming: (isStreaming: boolean) => void;
    /** Set pending initial message for a new chat */
    setPendingInitialMessage: (message: PendingInitialMessage | null) => void;
    /** Clear pending initial message */
    clearPendingInitialMessage: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
    activeChatId: null,
    activeChat: null,
    isLoading: false,
    error: null,
    pendingModelSelection: null,
    projectDefaultModel: null,
    isStreaming: false,
    pendingInitialMessage: null,

    setActiveChatId: (id) => {
        set({ activeChatId: id, activeChat: null, error: null, pendingModelSelection: null });
        if (id) {
            get().loadActiveChat();
        }
    },

    loadActiveChat: async () => {
        const { activeChatId } = get();
        if (!activeChatId) return;

        set({ isLoading: true, error: null });
        try {
            const chat = await getChat(activeChatId);
            set({ activeChat: chat, isLoading: false });
        } catch (err) {
            set({
                error: err instanceof Error ? err.message : 'Failed to load chat',
                isLoading: false
            });
        }
    },

    updateActiveChat: async (input: UpdateChatInput) => {
        const { activeChatId, activeChat } = get();
        if (!activeChatId || !activeChat) return;

        // Optimistic update
        const previousChat = activeChat;
        set({
            activeChat: {
                ...activeChat,
                ...input, // This is a shallow merge, might need deeper merge for nested config if partial
                config: {
                    ...activeChat.config,
                    ...(input.config || {})
                }
            }
        });

        try {
            const updated = await updateChat(activeChatId, input);
            set({ activeChat: updated });
        } catch (err) {
            // Revert on error
            set({ activeChat: previousChat });
            console.error('Failed to update chat:', err);
        }
    },

    updateActiveChatLocal: (input: UpdateChatInput) => {
        const { activeChat } = get();
        if (!activeChat) return;

        // Local-only update (no API call, no persistence)
        set({
            activeChat: {
                ...activeChat,
                ...input,
                config: {
                    ...activeChat.config,
                    ...(input.config || {})
                }
            }
        });
    },

    refreshActiveChat: async () => {
        await get().loadActiveChat();
    },

    setPendingModelSelection: (selection) => {
        set({ pendingModelSelection: selection });
    },

    applyPendingModelSelection: async () => {
        const { pendingModelSelection, activeChatId, activeChat } = get();
        if (!pendingModelSelection || !activeChatId || !activeChat) return;

        try {
            await get().updateActiveChat({
                config: {
                    provider: pendingModelSelection.provider,
                    model: pendingModelSelection.model,
                }
            });
            // Clear pending selection after successful application
            set({ pendingModelSelection: null });
        } catch (err) {
            console.error('Failed to apply pending model selection:', err);
            throw err;
        }
    },

    setIsStreaming: (isStreaming) => {
        set({ isStreaming });
    },

    setProjectDefaultModel: (selection) => {
        set({ projectDefaultModel: selection });
    },

    syncProjectDefaultToPending: () => {
        const { projectDefaultModel, pendingModelSelection, activeChat } = get();
        // Only sync if no active chat and no pending selection already set
        if (!activeChat && !pendingModelSelection && projectDefaultModel) {
            set({ pendingModelSelection: projectDefaultModel });
        }
    },

    setPendingInitialMessage: (message) => {
        set({ pendingInitialMessage: message });
    },

    clearPendingInitialMessage: () => {
        set({ pendingInitialMessage: null });
    },
}));
