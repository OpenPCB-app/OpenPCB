import { create } from 'zustand';

/**
 * Model loading state for a provider
 */
export interface ModelLoadingState {
    status: 'idle' | 'checking' | 'loading' | 'ready' | 'error';
    modelName?: string;
    modelSize?: number;  // bytes
    vramUsed?: number;   // bytes
    error?: string;
}

/**
 * Pending retry information
 */
export interface PendingRetry {
    providerId: string;
    modelId: string;
    originalMessage: string;
    chatId: string;
}

/**
 * Model loading store interface
 */
interface ModelLoadingStore {
    // Per-provider loading states
    providerStates: Record<string, ModelLoadingState>;

    // Actions
    setProviderState: (providerId: string, state: ModelLoadingState) => void;
    getProviderState: (providerId: string) => ModelLoadingState;
    clearProviderState: (providerId: string) => void;

    // Pending retry info
    pendingRetry: PendingRetry | null;
    setPendingRetry: (retry: PendingRetry | null) => void;
    clearPendingRetry: () => void;

    // Helper to update state from SSE event
    handleModelLoadingEvent: (providerId: string, event: {
        status: string;
        modelName?: string;
        modelSize?: number;
        vramUsed?: number;
        error?: string;
    }) => void;
}

const DEFAULT_STATE: ModelLoadingState = { status: 'idle' };

export const useModelLoadingStore = create<ModelLoadingStore>((set, get) => ({
    providerStates: {},

    setProviderState: (providerId, state) =>
        set(s => ({
            providerStates: { ...s.providerStates, [providerId]: state }
        })),

    getProviderState: (providerId) =>
        get().providerStates[providerId] || DEFAULT_STATE,

    clearProviderState: (providerId) =>
        set(s => {
            const { [providerId]: _, ...rest } = s.providerStates;
            return { providerStates: rest };
        }),

    pendingRetry: null,

    setPendingRetry: (retry) => set({ pendingRetry: retry }),

    clearPendingRetry: () => set({ pendingRetry: null }),

    handleModelLoadingEvent: (providerId, event) => {
        const state: ModelLoadingState = {
            status: event.status as ModelLoadingState['status'],
            modelName: event.modelName,
            modelSize: event.modelSize,
            vramUsed: event.vramUsed,
            error: event.error,
        };
        set(s => ({
            providerStates: { ...s.providerStates, [providerId]: state }
        }));
    },
}));
