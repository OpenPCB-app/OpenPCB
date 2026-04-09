import { useEffect } from 'react';
import { useChatStore } from '@/stores/chat-store';
import type { ChatMetadata } from '@shared/types';

export interface UseActiveChatReturn {
    activeChatId: string | null;
    setActiveChatId: (id: string | null) => void;
    activeChat: ChatMetadata | null;
    loading: boolean;
    error: string | null;
}

/**
 * Parse chat ID from URL hash (#chat-{id})
 */
function getChatIdFromHash(): string | null {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash;
    if (hash.startsWith('#chat-')) {
        return hash.substring(6); // Remove '#chat-'
    }
    return null;
}

/**
 * Set chat ID in URL hash
 */
function setChatIdInHash(id: string | null) {
    if (typeof window === 'undefined') return;
    if (id) {
        window.location.hash = `#chat-${id}`;
    } else {
        history.pushState("", document.title, window.location.pathname + window.location.search);
    }
}

export function useActiveChat(): UseActiveChatReturn {
    const {
        activeChatId,
        activeChat,
        isLoading,
        error,
        setActiveChatId: setStoreActiveChatId
    } = useChatStore();


    // Initial sync from hash
    useEffect(() => {
        const hashId = getChatIdFromHash();
        if (hashId && hashId !== activeChatId) {
            setStoreActiveChatId(hashId);
        }
    }, []); // Run once on mount

    // Sync activeChatId with URL hash
    const setActiveChatId = (id: string | null) => {
        setStoreActiveChatId(id);
        setChatIdInHash(id);
    };

    // Listen to hash changes (browser back/forward)
    useEffect(() => {
        const handleHashChange = () => {
            const chatId = getChatIdFromHash();
            if (chatId !== activeChatId) {
                setStoreActiveChatId(chatId);
            }
        };

        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, [activeChatId, setStoreActiveChatId]);

    // Store handles data fetching automatically when ID changes

    return {
        activeChatId,
        setActiveChatId,
        activeChat,
        loading: isLoading,
        error,
    };
}
