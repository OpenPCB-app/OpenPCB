/**
 * useChatOperations Hook
 * 
 * Provides functions for chat CRUD operations with optimistic updates
 * Uses active workspace from zustand store
 */

import { useState, useCallback } from 'react';
import { createChat, updateChat, deleteChat, deleteChats, moveChatToProject } from '@/lib/api/chat-api';
import { getWorkspace } from '@/lib/api/workspace-api';
import type { ChatMetadata, CreateChatInput, UpdateChatInput } from '@shared/types';
import { useAppStore } from '@/stores/app-store';

export interface UseChatOperationsReturn {
    createNewChat: (title?: string, configOverride?: { model?: string, provider?: string }) => Promise<ChatMetadata | null>;
    renameChat: (id: string, newTitle: string) => Promise<ChatMetadata | null>;
    removeChat: (id: string) => Promise<boolean>;
    removeChats: (ids: string[]) => Promise<number>;
    moveToProject: (chatId: string, projectId: string | null) => Promise<ChatMetadata | null>;
    isCreating: boolean;
    isUpdating: boolean;
    isDeleting: boolean;
    error: string | null;
}

export function useChatOperations(
    onSuccess?: () => void
): UseChatOperationsReturn {
    const [isCreating, setIsCreating] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get activeWorkspaceId from zustand store
    const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

    const createNewChat = useCallback(async (title?: string, configOverride?: { model?: string, provider?: string }): Promise<ChatMetadata | null> => {
        if (!activeWorkspaceId) {
            setError('No workspace selected');
            return null;
        }

        try {
            setIsCreating(true);
            setError(null);

            // Fetch workspace settings to get defaults
            let defaultConfig: { model?: string; provider?: string } = {};
            try {
                if (activeWorkspaceId) {
                    const ws = await getWorkspace(activeWorkspaceId);
                    if (ws?.settings) {
                        defaultConfig = {
                            model: ws.settings.defaultModel,
                            provider: ws.settings.defaultProvider,
                        };
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch workspace settings for defaults', e);
            }

            const input: CreateChatInput = {
                title: title || 'New Chat',
                config: {
                    model: configOverride?.model || defaultConfig.model,
                    provider: configOverride?.provider || defaultConfig.provider,
                }
            };

            const chat = await createChat(input, activeWorkspaceId);
            onSuccess?.();
            return chat;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to create chat';
            setError(errorMsg);
            console.error('Error creating chat:', err);
            return null;
        } finally {
            setIsCreating(false);
        }
    }, [activeWorkspaceId, onSuccess]);

    const renameChat = useCallback(async (
        id: string,
        newTitle: string
    ): Promise<ChatMetadata | null> => {
        try {
            setIsUpdating(true);
            setError(null);

            const input: UpdateChatInput = {
                title: newTitle,
            };

            const chat = await updateChat(id, input);
            onSuccess?.();
            return chat;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to rename chat';
            setError(errorMsg);
            console.error('Error renaming chat:', err);
            return null;
        } finally {
            setIsUpdating(false);
        }
    }, [onSuccess]);

    const removeChat = useCallback(async (id: string): Promise<boolean> => {
        try {
            setIsDeleting(true);
            setError(null);

            await deleteChat(id);
            onSuccess?.();
            return true;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to delete chat';
            setError(errorMsg);
            console.error('Error deleting chat:', err);
            return false;
        } finally {
            setIsDeleting(false);
        }
    }, [onSuccess]);

    const removeChats = useCallback(async (ids: string[]): Promise<number> => {
        try {
            setIsDeleting(true);
            setError(null);

            const count = await deleteChats(ids);
            onSuccess?.();
            return count;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to delete chats';
            setError(errorMsg);
            console.error('Error deleting chats:', err);
            return 0;
        } finally {
            setIsDeleting(false);
        }
    }, [onSuccess]);

    const moveToProject = useCallback(async (
        chatId: string,
        projectId: string | null
    ): Promise<ChatMetadata | null> => {
        try {
            setIsUpdating(true);
            setError(null);

            const chat = await moveChatToProject(chatId, projectId);
            onSuccess?.();
            return chat;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to move chat to project';
            setError(errorMsg);
            console.error('Error moving chat:', err);
            return null;
        } finally {
            setIsUpdating(false);
        }
    }, [onSuccess]);

    return {
        createNewChat,
        renameChat,
        removeChat,
        removeChats,
        moveToProject,
        isCreating,
        isUpdating,
        isDeleting,
        error,
    };
}
