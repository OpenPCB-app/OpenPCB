/**
 * AI Settings Storage
 *
 * Manages default provider and model preferences in localStorage
 * Used as fallback when creating new chats
 */

import type { ProviderId } from '@shared/types';

export interface AISettings {
    provider: ProviderId;
    model: string;
}

const AI_SETTINGS_KEY = 'ai-settings';

/**
 * Default AI settings (OpenAI with gpt-4o-mini - cheap and fast)
 * Requires OPENAI_API_KEY environment variable
 */
export const DEFAULT_AI_SETTINGS: AISettings = {
    provider: 'openai',
    model: 'gpt-4o-mini-2024-07-18',
};

/**
 * Get default AI settings from localStorage
 */
export function getDefaultAISettings(): AISettings {
    try {
        const stored = localStorage.getItem(AI_SETTINGS_KEY);
        if (!stored) return DEFAULT_AI_SETTINGS;

        const parsed = JSON.parse(stored);
        return {
            provider: parsed.provider || DEFAULT_AI_SETTINGS.provider,
            model: parsed.model || DEFAULT_AI_SETTINGS.model,
        };
    } catch (error) {
        console.error('Failed to load AI settings:', error);
        return DEFAULT_AI_SETTINGS;
    }
}

/**
 * Save default AI settings to localStorage
 */
export function setDefaultAISettings(settings: AISettings): void {
    try {
        localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
        console.error('Failed to save AI settings:', error);
    }
}
